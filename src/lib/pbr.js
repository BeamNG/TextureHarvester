
import { TX } from "../tx.js";

const clamp01 = value => (value < 0 ? 0 : (value > 1 ? 1 : value));

const canvasOf = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
};

function lumaOf(source) {
  const width = source.width;
  const height = source.height;
  const canvas = canvasOf(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  const out = new Float32Array(width * height);
  const alpha = new Float32Array(width * height);
  for (let i = 0, p = 0; p < out.length; p++, i += 4) {
    out[p] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    alpha[p] = data[i + 3] / 255;
  }
  return { luma: out, alpha, width, height };
}

const edge = (i, n) => (i < 0 ? 0 : (i >= n ? n - 1 : i));

function blur(values, width, height, radius) {
  const r = Math.max(1, Math.round(radius));
  const span = r * 2 + 1;
  let src = Float32Array.from(values);
  let dst = new Float32Array(values.length);

  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[row + edge(x, width)];
      for (let x = 0; x < width; x++) {
        dst[row + x] = sum / span;
        sum -= src[row + edge(x - r, width)];
        sum += src[row + edge(x + r + 1, width)];
      }
    }
    [src, dst] = [dst, src];

    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += src[edge(y, height) * width + x];
      for (let y = 0; y < height; y++) {
        dst[y * width + x] = sum / span;
        sum -= src[edge(y - r, height) * width + x];
        sum += src[edge(y + r + 1, height) * width + x];
      }
    }
    [src, dst] = [dst, src];
  }

  return src;
}

const detailRadius = (width, height) => Math.max(1, Math.round(Math.min(width, height) * 0.012));
const cavityRadius = (width, height) => Math.max(2, Math.round(Math.min(width, height) * 0.06));

const DETAIL_FLOOR = 0.01;


const cache = new Map();

function decompose(textureId, albedo, key) {
  const id = `${textureId}@${albedo.width}x${albedo.height}`;
  const hit = cache.get(id);
  if (hit && hit.key === key) return hit.value;

  const { luma, alpha, width, height } = lumaOf(albedo);
  const fine = blur(luma, width, height, detailRadius(width, height));
  const coarse = blur(luma, width, height, cavityRadius(width, height));

  const detail = new Float32Array(luma.length);
  let energy = 0;
  for (let i = 0; i < luma.length; i++) {
    detail[i] = luma[i] - fine[i];
    energy += Math.abs(detail[i]);
  }
  energy /= luma.length || 1;

  const value = { luma, alpha, detail, coarse, energy, width, height };
  if (cache.size > 16) cache.clear();
  cache.set(id, { key, value });
  return value;
}

const invalidate = textureId => {
  if (textureId == null) {
    cache.clear();
    return;
  }
  const prefix = `${textureId}@`;
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
};


const write = (parts, width, height) => {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let p = 0, i = 0; p < parts.length; p++, i += 4) {
    const value = Math.round(clamp01(parts[p]) * 255);
    out[i] = value;
    out[i + 1] = value;
    out[i + 2] = value;
    out[i + 3] = 255;
  }
  const canvas = canvasOf(width, height);
  canvas.getContext("2d").putImageData(new ImageData(out, width, height), 0, 0);
  return canvas;
};

function heightField(parts, strength) {
  const { detail, energy, width, height } = parts;
  const scale = strength / (4 * Math.max(energy, DETAIL_FLOOR));
  const data = new Float32Array(detail.length);
  for (let i = 0; i < detail.length; i++) data[i] = 0.5 + detail[i] * scale;
  return { data, width, height };
}

function heightMap(parts, strength) {
  const field = heightField(parts, strength);
  return write(field.data, field.width, field.height);
}

function roughnessFrom(parts, base, amount) {
  const { detail, luma, energy, width, height } = parts;
  const reference = Math.max(energy, DETAIL_FLOOR);
  const out = new Float32Array(detail.length);

  for (let i = 0; i < detail.length; i++) {
    const relative = Math.log2(Math.max(Math.abs(detail[i]), 1e-5) / reference) / 2;
    const rough = clamp01(0.5 + relative * 0.5);
    const specular = clamp01((luma[i] - 0.82) / 0.18);
    out[i] = clamp01(base + amount * ((rough - 0.5) - specular * 0.6));
  }
  return write(out, width, height);
}

function cavityFrom(parts, amount) {
  const { luma, coarse, width, height } = parts;
  const out = new Float32Array(luma.length);
  for (let i = 0; i < luma.length; i++) {
    const below = Math.max(0, coarse[i] - luma[i]);
    out[i] = clamp01(1 - amount * Math.min(below / 0.25, 1));
  }
  return write(out, width, height);
}


function suggest(textureId, albedo, version) {
  if (!albedo || !albedo.width) return null;
  const key = TX.store.textureKey(textureId) || `v${version}`;
  const parts = decompose(textureId, albedo, key);
  const { luma, detail, energy } = parts;

  let mean = 0;
  for (let i = 0; i < luma.length; i++) mean += luma[i];
  mean /= luma.length || 1;

  let variance = 0;
  for (let i = 0; i < luma.length; i++) variance += (luma[i] - mean) ** 2;
  const spread = Math.sqrt(variance / (luma.length || 1));

  let hot = 0;
  for (let i = 0; i < luma.length; i++) if (luma[i] > 0.86) hot++;
  hot /= luma.length || 1;

  const coarse = clamp01((energy - DETAIL_FLOOR) / 0.03);
  const printed = clamp01((energy - 0.05) / 0.04);
  const busy = coarse * (1 - 0.55 * printed);

  return {
    reading: { mean, spread, energy, highlights: hot },
    settings: {
      roughness: Number(clamp01(0.82 - hot * 0.45).toFixed(2)),
      metalness: 0,
      detailNormal: Number((0.35 + busy * 0.65).toFixed(2)),
      roughnessAmount: Number((0.25 + busy * 0.45).toFixed(2)),
      cavity: Number((0.2 + busy * 0.4).toFixed(2)),
    },
  };
}

TX.pbr = {
  DETAIL_FLOOR,
  write,
  lumaOf,
  blur,
  decompose,
  invalidate,
  heightField,
  heightMap,
  roughnessFrom,
  cavityFrom,
  suggest,
  detailRadius,
  cavityRadius,
};

