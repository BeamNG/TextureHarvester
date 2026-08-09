
import { TX } from "../tx.js";

const GRID = 192;

const MAGNIFIED_AT = 0.8;

const gridFor = (width, height, budget) => {
  const scale = Math.min(1, (budget || GRID) / Math.max(width, height));
  return { cols: Math.max(1, Math.round(width * scale)), rows: Math.max(1, Math.round(height * scale)) };
};


function summarise(values) {
  const sorted = Float64Array.from(values).sort();
  const n = sorted.length;
  if (!n) return { min: 0, max: 0, median: 0, p05: 0, p95: 0, mean: 0, count: 0 };
  const at = q => sorted[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))];
  let total = 0;
  for (let i = 0; i < n; i++) total += sorted[i];
  return {
    min: sorted[0],
    max: sorted[n - 1],
    median: at(0.5),
    p05: at(0.05),
    p95: at(0.95),
    mean: total / n,
    count: n,
  };
}

function densityField(options) {
  const { quad, domain, curve, width, height } = options;
  const s = options.scale == null ? 1 : options.scale;
  if (!quad || quad.length !== 4 || !(width >= 1) || !(height >= 1)) return null;
  const lens = options.lens || null;
  const h = TX.geom.fitQuad(quad.map(p => ({ x: p.x * s, y: p.y * s })), lens);
  if (!h) return null;

  const d = TX.geom.domainOf(domain);
  const c = TX.geom.curveOf(curve);
  const spanU = d.u1 - d.u0;
  const spanV = d.v1 - d.v0;

  const texelArea = Math.abs((spanU / width) * (spanV / height));

  const { cols, rows } = gridFor(width, height, options.grid);
  const data = new Float32Array(cols * rows);
  const at = (u, v) => TX.geom.localToImage(h, c, u, v, lens);

  const stepU = Math.abs(spanU) * 1e-4 || 1e-4;
  const stepV = Math.abs(spanV) * 1e-4 || 1e-4;

  for (let row = 0; row < rows; row++) {
    const v = d.v0 + spanV * ((row + 0.5) / rows);
    for (let col = 0; col < cols; col++) {
      const u = d.u0 + spanU * ((col + 0.5) / cols);
      const du = at(u + stepU, v);
      const dv = at(u, v + stepV);
      const mu = at(u - stepU, v);
      const mv = at(u, v - stepV);
      const xu = (du.x - mu.x) / (2 * stepU);
      const yu = (du.y - mu.y) / (2 * stepU);
      const xv = (dv.x - mv.x) / (2 * stepV);
      const yv = (dv.y - mv.y) / (2 * stepV);
      const jacobian = Math.abs(xu * yv - xv * yu);
      data[row * cols + col] = Number.isFinite(jacobian) ? jacobian * texelArea : 0;
    }
  }

  const stats = summarise(data);
  let magnified = 0;
  for (let i = 0; i < data.length; i++) if (data[i] < MAGNIFIED_AT) magnified++;

  return {
    kind: "density",
    data,
    cols,
    rows,
    width,
    height,
    ...stats,
    magnified: magnified / data.length,
    unevenness: stats.p05 > 0 ? stats.p95 / stats.p05 : Infinity,
  };
}


const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const labF = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

function toLab(r, g, b) {
  const rl = LINEAR[r];
  const gl = LINEAR[g];
  const bl = LINEAR[b];
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const scratch = document.createElement("canvas");
const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });

function sampled(canvas, cols, rows) {
  scratch.width = cols;
  scratch.height = rows;
  scratchCtx.imageSmoothingEnabled = false;
  scratchCtx.drawImage(canvas, 0, 0, cols, rows);
  return scratchCtx.getImageData(0, 0, cols, rows).data;
}

function colourDelta(before, after) {
  if (!before || !after) return null;
  if (before.width !== after.width || before.height !== after.height) return null;

  const { cols, rows } = gridFor(before.width, before.height);
  const a = sampled(before, cols, rows);
  const b = sampled(after, cols, rows);
  const data = new Float32Array(cols * rows);

  let opaque = 0;
  let shiftR = 0;
  let shiftG = 0;
  let shiftB = 0;
  const deltas = [];

  for (let p = 0; p < cols * rows; p++) {
    const i = p * 4;
    if (a[i + 3] < 128 || b[i + 3] < 128) continue;

    const la = toLab(a[i], a[i + 1], a[i + 2]);
    const lb = toLab(b[i], b[i + 1], b[i + 2]);
    const delta = Math.hypot(lb[0] - la[0], lb[1] - la[1], lb[2] - la[2]);
    data[p] = delta;
    deltas.push(delta);

    shiftR += b[i] - a[i];
    shiftG += b[i + 1] - a[i + 1];
    shiftB += b[i + 2] - a[i + 2];
    opaque++;
  }

  const stats = summarise(deltas);
  let visible = 0;
  for (const delta of deltas) if (delta >= 2) visible++;

  return {
    kind: "delta",
    data,
    cols,
    rows,
    width: before.width,
    height: before.height,
    ...stats,
    visible: opaque ? visible / opaque : 0,
    shift: opaque
      ? { r: shiftR / opaque, g: shiftG / opaque, b: shiftB / opaque }
      : { r: 0, g: 0, b: 0 },
  };
}


function coverage(canvas) {
  if (!canvas) return null;
  const { cols, rows } = gridFor(canvas.width, canvas.height);
  const data = sampled(canvas, cols, rows);
  const field = new Float32Array(cols * rows);

  let opaque = 0;
  let partial = 0;
  let empty = 0;

  for (let p = 0; p < cols * rows; p++) {
    const alpha = data[p * 4 + 3];
    field[p] = alpha / 255;
    if (alpha >= 250) opaque++;
    else if (alpha <= 5) empty++;
    else partial++;
  }

  const total = cols * rows;
  return {
    kind: "coverage",
    data: field,
    cols,
    rows,
    width: canvas.width,
    height: canvas.height,
    opaque: opaque / total,
    partial: partial / total,
    empty: empty / total,
  };
}


const cornersOf = node => {
  const w = node.width * (node.scaleX == null ? 1 : node.scaleX);
  const h = node.height * (node.scaleY == null ? 1 : node.scaleY);
  const cos = Math.cos(node.rotation || 0);
  const sin = Math.sin(node.rotation || 0);
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => ({
    x: node.x + x * cos - y * sin,
    y: node.y + x * sin + y * cos,
  }));
};

function atlasOccupancy(nodes) {
  const boxes = (nodes || []).map(node => {
    const corners = cornersOf(node);
    const xs = corners.map(p => p.x);
    const ys = corners.map(p => p.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);
    return { id: node.id, name: node.name, left, top, right, bottom, area: (right - left) * (bottom - top) };
  });

  if (!boxes.length) {
    return {
      kind: "atlas",
      origin: { x: 0, y: 0 },
      boxes,
      width: 0,
      height: 0,
      used: 0,
      efficiency: 0,
      overlaps: [],
    };
  }

  const left = Math.min(...boxes.map(b => b.left));
  const top = Math.min(...boxes.map(b => b.top));
  const right = Math.max(...boxes.map(b => b.right));
  const bottom = Math.max(...boxes.map(b => b.bottom));
  const width = right - left;
  const height = bottom - top;

  const used = boxes.reduce((sum, b) => sum + b.area, 0);

  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0.5 && h > 0.5) {
        overlaps.push({ a: a.name, b: b.name, ids: [a.id, b.id], area: w * h });
      }
    }
  }

  const canvas = width * height;
  return {
    kind: "atlas",
    origin: { x: left, y: top },
    boxes: boxes.map(b => ({
      ...b,
      left: b.left - left,
      top: b.top - top,
      right: b.right - left,
      bottom: b.bottom - top,
    })),
    width,
    height,
    used,
    efficiency: canvas > 0 ? used / canvas : 0,
    overlaps,
  };
}


const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);

const NEUTRAL = [122, 130, 136];
const SHORT = [235, 70, 55];
const OVER = [60, 150, 235];

function diverging(t) {
  const k = clamp01(Math.abs(t));
  const target = t < 0 ? SHORT : OVER;
  return [0, 1, 2].map(i => NEUTRAL[i] + (target[i] - NEUTRAL[i]) * k);
}

const DENSITY_FLOOR = 90;

const DENSITY_MIN_STOPS = 0.08;
const DENSITY_MAX_STOPS = 2;

function densityStops(field) {
  if (!field) return DENSITY_MAX_STOPS;
  const low = Math.abs(Math.log2(Math.max(field.p05 || 0, 1e-6)));
  const high = Math.abs(Math.log2(Math.max(field.p95 || 0, 1e-6)));
  return Math.min(DENSITY_MAX_STOPS, Math.max(DENSITY_MIN_STOPS, low, high));
}

function heat(t) {
  const k = clamp01(t);
  if (k < 0.5) return [40 + 200 * (k / 0.5), 60 + 150 * (k / 0.5), 220 - 180 * (k / 0.5)];
  return [240, 210 - 190 * ((k - 0.5) / 0.5), 40];
}

function paintField(field, mode) {
  if (!field) return null;
  const canvas = document.createElement("canvas");
  canvas.width = field.cols;
  canvas.height = field.rows;
  const image = new ImageData(field.cols, field.rows);

  const cap = Math.max(4, field.p95 || 0);
  const stops = mode === "density" ? densityStops(field) : 0;

  for (let i = 0; i < field.data.length; i++) {
    const value = field.data[i];
    let rgb;
    let alpha = 255;
    if (mode === "density") {
      const t = Math.log2(Math.max(value, 1e-6)) / stops;
      rgb = diverging(t);
      alpha = DENSITY_FLOOR + (255 - DENSITY_FLOOR) * clamp01(Math.abs(t));
    } else {
      rgb = heat(value / cap);
      alpha = value < 0.5 ? 90 : 255; // unchanged pixels recede
    }
    const at = i * 4;
    image.data[at] = rgb[0];
    image.data[at + 1] = rgb[1];
    image.data[at + 2] = rgb[2];
    image.data[at + 3] = alpha;
  }

  canvas.getContext("2d").putImageData(image, 0, 0);
  return canvas;
}

const itemColour = (index, alpha) => {
  const hue = ((((index || 0) * 137.508) % 360) + 360) % 360;
  return alpha == null || alpha >= 1
    ? `hsl(${hue}, 78%, 55%)`
    : `hsla(${hue}, 78%, 55%, ${alpha})`;
};

TX.views = {
  densityField,
  densityStops,
  DENSITY_MIN_STOPS,
  DENSITY_MAX_STOPS,
  colourDelta,
  coverage,
  atlasOccupancy,
  paintField,
  diverging,
  heat,
  itemColour,
  summarise,
  toLab,
  GRID,
};

