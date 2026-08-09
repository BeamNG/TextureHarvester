
import { TX } from "../tx.js";

const SPREAD_SAMPLES = 20000;

const spreads = new WeakMap();

function spreadOf(depth) {
  const hit = spreads.get(depth);
  if (hit !== undefined) return hit;

  const { data, width, height } = depth;
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / SPREAD_SAMPLES)));
  const samples = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) samples.push(data[y * width + x]);
  }

  const stats = TX.views.summarise(samples);
  const spread = stats.p95 - stats.p05;
  const value = spread > 1e-9 ? spread : 0;
  spreads.set(depth, value);
  return value;
}

function sample(depth, x, y) {
  const { data, width, height } = depth;
  if (!(x >= 0) || !(y >= 0) || x > width - 1 || y > height - 1) return null;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;

  const top = data[y0 * width + x0] * (1 - tx) + data[y0 * width + x1] * tx;
  const bottom = data[y1 * width + x0] * (1 - tx) + data[y1 * width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

function fitPlane(values, px, py, valid) {
  const ata = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const atb = new Float64Array(3);
  const terms = [0, 0, 1];
  let n = 0;

  for (let i = 0; i < values.length; i++) {
    if (!valid[i]) continue;
    terms[0] = px[i];
    terms[1] = py[i];
    const z = values[i];
    for (let a = 0; a < 3; a++) {
      atb[a] += terms[a] * z;
      for (let b = 0; b < 3; b++) ata[a][b] += terms[a] * terms[b];
    }
    n++;
  }

  return n < 3 ? null : TX.delight.solve(ata, atb, 3);
}

function heightField(options) {
  const { depth, quad, domain, curve, photo } = options || {};
  if (!depth || !depth.data || !(depth.width >= 2) || !(depth.height >= 2)) return null;
  if (!quad || quad.length !== 4) return null;

  const cols = Math.max(2, Math.round(options.cols || 64));
  const rows = Math.max(2, Math.round(options.rows || 64));
  const sx = photo && photo.width > 0 ? depth.width / photo.width : 1;
  const sy = photo && photo.height > 0 ? depth.height / photo.height : 1;

  const lens = options.lens
    ? TX.lens.project(options.lens, depth.width, depth.height) : null;
  const h = TX.geom.fitQuad(quad.map(p => ({ x: p.x * sx, y: p.y * sy })), lens);
  if (!h) return null;

  const spread = spreadOf(depth);
  if (!spread) return null;

  const d = TX.geom.domainOf(domain);
  const c = TX.geom.curveOf(curve);
  const count = cols * rows;
  const values = new Float32Array(count);
  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const valid = new Uint8Array(count);
  let covered = 0;

  for (let row = 0; row < rows; row++) {
    const v = d.v0 + (d.v1 - d.v0) * (rows > 1 ? row / (rows - 1) : 0);
    for (let col = 0; col < cols; col++) {
      const u = d.u0 + (d.u1 - d.u0) * (cols > 1 ? col / (cols - 1) : 0);
      const p = TX.geom.localToImage(h, c, u, v, lens);
      const z = sample(depth, p.x, p.y);
      if (z == null || !Number.isFinite(z)) continue;
      const i = row * cols + col;
      values[i] = z;
      px[i] = p.x / (depth.width - 1);
      py[i] = p.y / (depth.height - 1);
      valid[i] = 1;
      covered++;
    }
  }

  const plane = fitPlane(values, px, py, valid);
  if (!plane) return null;

  const data = new Float32Array(count);
  const magnitudes = [];

  for (let i = 0; i < count; i++) {
    if (!valid[i]) continue;
    const fitted = plane[0] * px[i] + plane[1] * py[i] + plane[2];
    const residual = (values[i] - fitted) / spread;
    data[i] = residual;
    magnitudes.push(Math.abs(residual));
  }

  return {
    kind: "relief",
    data,
    cols,
    rows,
    coverage: covered / count,
    flatness: TX.views.summarise(magnitudes).p95,
  };
}

function at(field, u, v) {
  if (!field || !field.data) return 0;
  const { data, cols, rows } = field;
  const fx = Math.max(0, Math.min(cols - 1, u * (cols - 1)));
  const fy = Math.max(0, Math.min(rows - 1, v * (rows - 1)));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const top = data[y0 * cols + x0] * (1 - tx) + data[y0 * cols + x1] * tx;
  const bottom = data[y1 * cols + x0] * (1 - tx) + data[y1 * cols + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

TX.depth = {
  heightField,
  at,
  sample,
  spreadOf,
};

