
import { TX } from "../tx.js";

const AXES = ["xy", "x", "y"];

const defaults = () => ({ mode: "none", band: 0.15, axis: "xy" });

const axisOf = tiling => {
  const value = tiling && tiling.axis;
  return AXES.includes(value) ? value : "xy";
};

const canvasOf = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
};

const imageDataOf = source => {
  const ctx = canvasOf(source.width, source.height).getContext("2d");
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, source.width, source.height);
};

// Premultiplied RGBA blend for seam feathering.
function blendInto(out, at, data, ai, bi, weightB) {
  const wa = 1 - weightB;
  const aA = data[ai + 3] / 255;
  const aB = data[bi + 3] / 255;
  const alpha = aA * wa + aB * weightB;

  if (alpha <= 0) {
    out[at] = 0; out[at + 1] = 0; out[at + 2] = 0; out[at + 3] = 0;
    return;
  }

  for (let c = 0; c < 3; c++) {
    out[at + c] = Math.round((data[ai + c] * aA * wa + data[bi + c] * aB * weightB) / alpha);
  }
  out[at + 3] = Math.round(alpha * 255);
}

// Weight 0.5 at outermost pixel makes opposite edges identical.
function featherEdges(source, bandFraction, axis) {
  const width = source.width;
  const height = source.height;
  const fraction = Math.max(0, Math.min(0.5, bandFraction));
  const which = AXES.includes(axis) ? axis : "xy";

  const bx = which === "y" ? 0 : Math.min(Math.floor(width / 2), Math.round(width * fraction));
  const by = which === "x" ? 0 : Math.min(Math.floor(height / 2), Math.round(height * fraction));

  const input = imageDataOf(source);
  let data = input.data;

  if (bx > 0) {
    const out = new Uint8ClampedArray(data);
    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      for (let i = 0; i < bx; i++) {
        const weight = 0.5 * (1 - i / bx);
        const left = row + i * 4;
        const right = row + (width - 1 - i) * 4;
        blendInto(out, left, data, left, right, weight);
        blendInto(out, right, data, right, left, weight);
      }
    }
    data = out;
  }

  if (by > 0) {
    const out = new Uint8ClampedArray(data);
    for (let x = 0; x < width; x++) {
      const column = x * 4;
      for (let i = 0; i < by; i++) {
        const weight = 0.5 * (1 - i / by);
        const top = i * width * 4 + column;
        const bottom = (height - 1 - i) * width * 4 + column;
        blendInto(out, top, data, top, bottom, weight);
        blendInto(out, bottom, data, bottom, top, weight);
      }
    }
    data = out;
  }

  const result = canvasOf(width, height);
  result.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
  return result;
}

function mirrorTile(source) {
  const width = source.width;
  const height = source.height;
  const result = canvasOf(width * 2, height * 2);
  const ctx = result.getContext("2d");

  const stamp = (x0, y0, flipX, flipY) => {
    ctx.save();
    ctx.translate(flipX ? x0 + width : x0, flipY ? y0 + height : y0);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  };

  stamp(0, 0, false, false);
  stamp(width, 0, true, false);
  stamp(0, height, false, true);
  stamp(width, height, true, true);
  return result;
}

function apply(source, tiling) {
  const settings = tiling || defaults();
  if (settings.mode === "feather") return featherEdges(source, settings.band, axisOf(settings));
  if (settings.mode === "mirror") return mirrorTile(source);
  return source;
}


const cache = new Map(); // textureId -> { key, canvas }

const keyOf = (tiling, version) => {
  const settings = tiling || defaults();
  const feather = settings.mode === "feather";
  return `${settings.mode}:${feather ? settings.band : 0}:${feather ? axisOf(settings) : "-"}:${version || 0}`;
};

function resolve(textureId, source, tiling, version) {
  const settings = tiling || defaults();
  if (settings.mode === "none") {
    cache.delete(textureId);
    return source;
  }

  const key = keyOf(settings, version);
  const hit = cache.get(textureId);
  if (hit && hit.key === key) return hit.canvas;

  const canvas = apply(source, settings);
  cache.set(textureId, { key, canvas });
  return canvas;
}

const invalidate = textureId => {
  if (textureId == null) cache.clear();
  else cache.delete(textureId);
};


function seamErrors(source) {
  const { data } = imageDataOf(source);
  const width = source.width;
  const height = source.height;
  let x = 0;
  let y = 0;

  for (let row = 0; row < height; row++) {
    const left = (row * width) * 4;
    const right = (row * width + width - 1) * 4;
    for (let c = 0; c < 4; c++) x = Math.max(x, Math.abs(data[left + c] - data[right + c]));
  }
  for (let col = 0; col < width; col++) {
    const top = col * 4;
    const bottom = ((height - 1) * width + col) * 4;
    for (let c = 0; c < 4; c++) y = Math.max(y, Math.abs(data[top + c] - data[bottom + c]));
  }
  return { x, y };
}

const seamError = source => {
  const { x, y } = seamErrors(source);
  return Math.max(x, y);
};

TX.tiling = {
  defaults, axisOf, featherEdges, mirrorTile, apply, resolve, invalidate,
  seamError, seamErrors, keyOf, AXES,
};

