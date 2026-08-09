
import { reactive, watch } from "vue";
import { TX } from "../tx.js";

const QUIET = 350;
const LIMIT = 100;
const TAIL = 8;

const status = reactive({
  canUndo: false,
  canRedo: false,
  undoLabel: "",
  redoLabel: "",
  depth: 0,
});

let past = [];
let future = [];
let present = null;
let pendingLabel = "";
let pendingAt = 0;
let timer = null;
let stopWatch = null;

const fingerprint = snap => JSON.stringify({
  images: snap.images,
  marks: snap.marks,
  textures: snap.textures,
  settings: snap.settings,
  pending: snap.pending,
  pixels: [...snap.pixels].map(([id, asset]) => `${id}:${asset.version}`),
});
const stepOf = (label, snap) => ({ label, at: Date.now(), snap, print: fingerprint(snap) });

function sync() {
  status.canUndo = past.length > 0;
  status.canRedo = future.length > 0;
  status.undoLabel = past.length && present ? labelText(present.label) : "";
  status.redoLabel = future.length ? labelText(future[future.length - 1].label) : "";
  status.depth = past.length;
}


const SETTING_NAMES = {
  gridSize: "history.setting.gridSize",
  snapToGrid: "history.setting.snapToGrid",
  snapToEdges: "history.setting.snapToEdges",
  showGrid: "history.setting.showGrid",
  weldRadius: "history.setting.weldRadius",
  supersample: "history.setting.supersample",
  padding: "history.setting.padding",
  powerOfTwo: "history.setting.powerOfTwo",
  exportMaps: "history.setting.exportMaps",
  ai: "history.setting.ai",
  material: "history.setting.material",
};

const SKIP_SETTINGS = new Set([
  "preview", "views", "depth", "props", "locale", "loupeSample", "sway",
]);

const countLabel = (count, one, other) => ({ id: count === 1 ? one : other, vars: { count } });

const labelText = label => {
  if (!label) return "";
  if (typeof label === "string") return TX.t(label);
  return TX.t(label.id, label.vars);
};

const isGroup = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const byId = list => new Map(list.map(entry => [entry.id, entry]));
const same = (a, b, pick) => JSON.stringify(pick(a)) === JSON.stringify(pick(b));

function fieldChange(before, after, key, tests) {
  const was = byId(before[key]);
  for (const entry of after[key]) {
    const previous = was.get(entry.id);
    if (!previous) continue;
    for (const test of tests) {
      if (!same(previous, entry, test.pick)) return test.label;
    }
  }
  return null;
}

const MARK_TESTS = [
  { pick: m => m.points, label: "history.move_mark" },
  { pick: m => m.domain, label: "history.local_space" },
  { pick: m => m.curve, label: "history.bend_edge" },
];

const TEXTURE_TESTS = [
  { pick: t => t.delight, label: "history.lighting" },
  { pick: t => t.tiling, label: "history.tiling" },
  { pick: t => t.flip, label: "history.flip_texture" },
  { pick: t => [t.x, t.y], label: "history.move_texture" },
  { pick: t => [t.scaleX, t.scaleY], label: "history.scale_texture" },
  { pick: t => t.rotation, label: "history.rotate_texture" },
  { pick: t => t.name, label: "history.rename_texture" },
];

const IMAGE_TESTS = [
  { pick: i => i.lens, label: "history.lens_correction" },
  { pick: i => [i.x, i.y], label: "history.move_photo" },
  { pick: i => i.name, label: "history.rename_photo" },
];

function describe(before, after) {
  const images = after.images.length - before.images.length;
  if (images > 0) {
    return countLabel(images, "history.import_image_one", "history.import_image_other");
  }
  if (images < 0) {
    return countLabel(-images, "history.delete_image_one", "history.delete_image_other");
  }

  const marks = after.marks.length - before.marks.length;
  if (marks > 0) return countLabel(marks, "history.add_mark_one", "history.add_mark_other");
  if (marks < 0) {
    return countLabel(-marks, "history.delete_mark_one", "history.delete_mark_other");
  }

  const textures = after.textures.length - before.textures.length;
  if (textures > 0) {
    return countLabel(textures, "history.add_texture_one", "history.add_texture_other");
  }
  if (textures < 0) {
    return countLabel(-textures, "history.delete_texture_one", "history.delete_texture_other");
  }

  const points = after.pending.points.length - before.pending.points.length;
  if (points > 0) return "history.place_point";
  if (points < 0) return before.pending.points.length ? "history.clear_points" : "history.move_point";

  return fieldChange(before, after, "marks", MARK_TESTS)
    || fieldChange(before, after, "textures", TEXTURE_TESTS)
    || fieldChange(before, after, "images", IMAGE_TESTS)
    || settingChange(before, after)
    || pixelChange(before, after)
    || "history.edit";
}

function settingChange(before, after) {
  for (const [key, value] of Object.entries(after.settings)) {
    if (SKIP_SETTINGS.has(key)) continue;
    const was = before.settings[key];
    if (was === value) continue;
    if (isGroup(was) && isGroup(value) && JSON.stringify(was) === JSON.stringify(value)) continue;
    return SETTING_NAMES[key] || key;
  }
  return null;
}

const pixelChange = (before, after) => {
  if (!before.pixels || !after.pixels) return null;
  for (const [id, asset] of after.pixels) {
    const was = before.pixels.get(id);
    if (was && was.version !== asset.version) return "history.re_extract";
  }
  return null;
};


function schedule() {
  clearTimeout(timer);
  timer = setTimeout(commit, QUIET);
}

function commit() {
  clearTimeout(timer);
  timer = null;
  if (!present) return false;

  const snap = TX.store.documentSnapshot();
  const print = fingerprint(snap);
  if (print === present.print) {
    pendingLabel = "";
    return false;
  }

  const label = claimLabel() || describe(present.snap, snap);
  past.push(present);
  if (past.length > LIMIT) past.shift();
  present = { label, at: Date.now(), snap, print };
  future = [];
  sync();
  return true;
}

function moveTo(step) {
  TX.store.applyDocumentSnapshot(step.snap);
  step.snap = TX.store.documentSnapshot();
  step.print = fingerprint(step.snap);
  clearTimeout(timer);
  timer = null;
}

function name(label) {
  commit();
  pendingLabel = label || "";
  pendingAt = Date.now();
}

const claimLabel = () => {
  const label = Date.now() - pendingAt < 2000 ? pendingLabel : "";
  pendingLabel = "";
  return label;
};

function undo() {
  commit();
  if (!past.length) return null;
  const undone = present.label;
  future.push(present);
  present = past.pop();
  moveTo(present);
  sync();
  return labelText(undone);
}

function redo() {
  commit();
  if (!future.length) return null;
  past.push(present);
  present = future.pop();
  moveTo(present);
  sync();
  return labelText(present.label);
}

function start() {
  if (stopWatch) return;
  const state = TX.store.state;
  present = stepOf("", TX.store.documentSnapshot());
  past = [];
  future = [];
  stopWatch = watch(
    () => [
      state.images, state.marks, state.textures, state.settings,
      state.pending, state.pixelEpoch,
    ],
    schedule,
    { deep: true },
  );
  sync();
}

function stop() {
  if (stopWatch) stopWatch();
  stopWatch = null;
  clearTimeout(timer);
  timer = null;
}

function clear() {
  past = [];
  future = [];
  pendingLabel = "";
  if (present) present = stepOf("", TX.store.documentSnapshot());
  sync();
}


const encoded = new WeakMap();

const blobFor = canvas => {
  if (!encoded.has(canvas)) encoded.set(canvas, TX.io.canvasToBlob(canvas));
  return encoded.get(canvas);
};

const decodeBlob = blob => TX.io.decodeBlob(blob);

async function persistable() {
  if (!present) return null;

  const steps = [...past, present, ...future.slice().reverse()];
  const at = past.length;
  const from = Math.max(0, at - TAIL);
  const kept = steps.slice(from, Math.min(steps.length, at + TAIL + 1));

  const blobs = [];
  const seen = new Map();
  const put = async (key, encode) => {
    if (!key) return -1;
    if (seen.has(key)) return seen.get(key);
    let blob = null;
    try {
      blob = await encode(key);
    } catch (err) {
      return -1;
    }
    if (!(blob instanceof Blob)) return -1;
    seen.set(key, blobs.length);
    blobs.push(blob);
    return blobs.length - 1;
  };

  const out = [];
  for (const step of kept) {
    const files = {};
    for (const [id, held] of step.snap.sources) {
      const index = await put(held.file, file => file);
      if (index >= 0) files[id] = index;
    }
    const canvases = {};
    for (const [id, asset] of step.snap.pixels) {
      const index = await put(asset.canvas, blobFor);
      if (index >= 0) canvases[id] = index;
    }
    out.push({
      label: step.label,
      at: step.at,
      doc: {
        images: step.snap.images,
        marks: step.snap.marks,
        textures: step.snap.textures,
        settings: step.snap.settings,
        selection: step.snap.selection,
        pending: step.snap.pending,
      },
      files,
      canvases,
    });
  }

  return { version: TX.schema.history, index: at - from, blobs, steps: out };
}

async function adopt(payload) {
  if (!payload || payload.version !== TX.schema.history
    || !Array.isArray(payload.steps)) return false;
  if (!payload.steps.length) return false;

  const blobs = Array.isArray(payload.blobs) ? payload.blobs : [];
  const elements = new Map();
  const canvases = new Map();

  const elementAt = async index => {
    if (elements.has(index)) return elements.get(index);
    const blob = blobs[index];
    if (!(blob instanceof Blob)) return null;
    let element = null;
    try {
      element = await decodeBlob(blob);
    } catch (err) {
      element = null;
    }
    elements.set(index, element);
    return element;
  };

  const canvasAt = async index => {
    if (canvases.has(index)) return canvases.get(index);
    const element = await elementAt(index);
    if (!element) return null;
    const canvas = document.createElement("canvas");
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    canvas.getContext("2d").drawImage(element, 0, 0);
    canvases.set(index, canvas);
    return canvas;
  };

  const rebuilt = [];
  for (const saved of payload.steps) {
    if (!saved || !saved.doc) continue;
    const sources = new Map();
    for (const [id, index] of Object.entries(saved.files || {})) {
      const element = await elementAt(index);
      if (element) sources.set(id, { element, file: blobs[index] });
    }
    const pixels = new Map();
    for (const [id, index] of Object.entries(saved.canvases || {})) {
      const canvas = await canvasAt(index);
      if (canvas) pixels.set(id, { canvas, version: 0 });
    }
    rebuilt.push({
      label: typeof saved.label === "string" || (saved.label && saved.label.id)
        ? saved.label
        : "",
      at: saved.at || Date.now(),
      snap: { ...saved.doc, sources, pixels },
    });
  }

  if (!rebuilt.length) return false;

  const index = Math.max(0, Math.min(rebuilt.length - 1, Number(payload.index) || 0));
  past = rebuilt.slice(0, index);
  future = rebuilt.slice(index + 1).reverse();
  present = stepOf(rebuilt[index].label, TX.store.documentSnapshot());
  sync();
  return true;
}

TX.history = {
  status,
  start,
  stop,
  clear,
  name,
  commit,
  undo,
  redo,
  persistable,
  adopt,
  describe: (before, after) => labelText(describe(before, after)),
  labelText,
  relabel: sync,
};

