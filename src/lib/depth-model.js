import { TX } from "../tx.js";

const RUNTIME = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4";
const MODEL = "onnx-community/depth-anything-v2-small-ONNX";

// Worker from blob URL (single-file build has no separate worker file).
const WORKER_SOURCE = `
import { pipeline, RawImage, env } from ${JSON.stringify(RUNTIME)};

env.allowLocalModels = false;

let estimator = null;

self.onmessage = async ({ data }) => {
  try {
    if (!estimator) {
      estimator = await pipeline("depth-estimation", ${JSON.stringify(MODEL)}, {
        device: data.device,
        dtype: data.dtype,
        progress_callback: p => self.postMessage({
          type: "progress", status: p.status, loaded: p.loaded, total: p.total,
        }),
      });
    }
    const image = await RawImage.fromBlob(data.blob);
    const { predicted_depth: tensor } = await estimator(image);
    const depth = Float32Array.from(tensor.data);
    self.postMessage(
      { type: "done", depth, dims: Array.from(tensor.dims) }, [depth.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", message: String((err && err.message) || err) });
  }
};
`;

let worker = null;
let workerUrl = null;

function spawn() {
  if (worker) return worker;
  workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  worker = new Worker(workerUrl, { type: "module" });
  return worker;
}

function dispose() {
  if (worker) worker.terminate();
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  worker = null;
  workerUrl = null;
}

const accelerated = () => Boolean(navigator.gpu);

const available = () => typeof Worker === "function" && typeof Blob === "function";

// Depth tensor dims: [batch, height, width] — use the last two.
function mapOf(result) {
  if (!result || !(result.depth instanceof Float32Array)) return null;
  const dims = Array.isArray(result.dims) ? result.dims : [];
  const height = dims[dims.length - 2];
  const width = dims[dims.length - 1];
  if (!(width >= 2) || !(height >= 2)) return null;
  if (result.depth.length !== width * height) return null;
  return { data: result.depth, width, height };
}

function run(blob) {
  return new Promise((resolve, reject) => {
    const instance = spawn();

    const stop = () => {
      instance.removeEventListener("message", onMessage);
      instance.removeEventListener("error", onError);
    };

    const onMessage = ({ data }) => {
      if (data.type === "progress") {
        const busy = TX.store.state.depthBusy;
        if (busy) {
          busy.status = data.status || busy.status;
          busy.loaded = data.loaded || 0;
          busy.total = data.total || 0;
        }
        return;
      }
      stop();
      if (data.type === "error") reject(new Error(data.message));
      else resolve(data);
    };

    const onError = event => {
      stop();
      dispose();
      reject(new Error(event.message || "the depth model could not be loaded"));
    };

    instance.addEventListener("message", onMessage);
    instance.addEventListener("error", onError);
    instance.postMessage({
      blob,
      device: accelerated() ? "webgpu" : "wasm",
      dtype: accelerated() ? "fp16" : "fp32",
    });
  });
}

async function estimateOne(imageId) {
  const store = TX.store;
  const state = store.state;
  const image = store.findImage(imageId);

  if (!image) return null;
  const held = store.imageDepth(imageId);
  if (held) return held;

  if (!state.settings.ai) {
    state.depthError = TX.t("depth.error.ai_off");
    return null;
  }
  if (!available()) {
    state.depthError = TX.t("depth.error.no_runtime");
    return null;
  }
  if (!(image.file instanceof Blob)) {
    state.depthError = TX.t("depth.error.no_file");
    return null;
  }
  if (state.depthBusy) return null;

  state.depthError = null;
  state.depthBusy = { imageId, status: "loading", loaded: 0, total: 0 };

  try {
    const depth = mapOf(await run(image.file));
    if (!depth) throw new Error("the model returned a depth map of an unexpected shape");
    store.setImageDepth(imageId, depth);
    return depth;
  } catch (err) {
    state.depthError = String((err && err.message) || err);
    return null;
  } finally {
    state.depthBusy = null;
  }
}

let queue = Promise.resolve(null);

function estimate(imageId) {
  queue = queue.then(() => estimateOne(imageId)).catch(() => null);
  return queue;
}

TX.depthModel = {
  RUNTIME,
  MODEL,
  available,
  accelerated,
  estimate,
  mapOf,
  dispose,
};

