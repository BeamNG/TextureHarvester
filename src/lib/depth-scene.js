import * as THREE from "three";
import { TX } from "../tx.js";

const DETAILS = [64, 128, 192];

const EDGE_JUMP = 0.06;

const clamp = (value, low, high) => (value < low ? low : (value > high ? high : value));

const num = (value, fallback, low, high) =>
  (typeof value === "number" && Number.isFinite(value) ? clamp(value, low, high) : fallback);

const DISPLAYS = ["photo", "normals", "wireframe"];

const defaults = () => ({
  enabled: false,
  fov: 60,
  shift: 0.2,
  detail: 128,
  trim: 0,
  smooth: 0,
  edge: 0.06,
  display: "photo",
});

const settingsOf = patch => {
  const s = { ...defaults(), ...(patch && typeof patch === "object" ? patch : {}) };
  return {
    enabled: !!s.enabled,
    fov: num(s.fov, 60, 20, 120),
    shift: num(s.shift, 0.2, 0.02, 1),
    detail: DETAILS.includes(s.detail) ? s.detail : 128,
    trim: num(s.trim, 0, 0, 0.2),
    smooth: num(s.smooth, 0, 0, 0.05),
    edge: num(s.edge, 0.06, 0.005, 1),
    display: DISPLAYS.includes(s.display) ? s.display : "photo",
  };
};

const BUCKETS = 1024;

function rangeOf(depth, trim) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < depth.data.length; i++) {
    const value = depth.data[i];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!(max > min)) return null;
  if (!(trim > 0)) return { min, max };

  const span = max - min;
  const counts = new Uint32Array(BUCKETS);
  let total = 0;
  for (let i = 0; i < depth.data.length; i++) {
    const value = depth.data[i];
    if (!Number.isFinite(value)) continue;
    counts[Math.min(BUCKETS - 1, Math.floor(((value - min) / span) * BUCKETS))]++;
    total++;
  }

  const cut = total * trim;
  let low = min;
  let high = max;
  let seen = 0;
  for (let b = 0; b < BUCKETS; b++) {
    seen += counts[b];
    if (seen >= cut) {
      low = min + (b / BUCKETS) * span;
      break;
    }
  }
  seen = 0;
  for (let b = BUCKETS - 1; b >= 0; b--) {
    seen += counts[b];
    if (seen >= cut) {
      high = min + ((b + 1) / BUCKETS) * span;
      break;
    }
  }
  return high > low ? { min: low, max: high } : { min, max };
}

function build(depth, patch) {
  if (!depth || !depth.data || !(depth.width >= 2) || !(depth.height >= 2)) return null;
  const s = settingsOf(patch);

  const source = s.smooth > 0
    ? {
      data: TX.pbr.blur(depth.data, depth.width, depth.height,
        Math.max(1, Math.round(s.smooth * Math.min(depth.width, depth.height)))),
      width: depth.width,
      height: depth.height,
    }
    : depth;

  const range = rangeOf(source, s.trim);
  if (!range) return null;

  const span = range.max - range.min;
  const aspect = source.width / source.height;

  const wide = Math.min(s.detail, Math.max(source.width, source.height));
  const cols = Math.max(2, aspect >= 1 ? wide : Math.round(wide * aspect));
  const rows = Math.max(2, aspect >= 1 ? Math.round(wide / aspect) : wide);

  const focal = (aspect / 2) / Math.tan((s.fov * Math.PI) / 360);

  const count = cols * rows;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const disparity = new Float32Array(count);

  for (let row = 0; row < rows; row++) {
    const v = row / (rows - 1);
    for (let col = 0; col < cols; col++) {
      const u = col / (cols - 1);
      const i = row * cols + col;
      const value = TX.depth.sample(source, u * (source.width - 1), v * (source.height - 1));
      const dn = value == null ? 0 : clamp((value - range.min) / span, 0, 1);
      const z = 1 / (dn + s.shift);
      disparity[i] = dn;
      positions[i * 3] = ((u - 0.5) * aspect * z) / focal;
      positions[i * 3 + 1] = ((0.5 - v) * z) / focal;
      positions[i * 3 + 2] = -z;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = 1 - v;
    }
  }

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    cx += positions[i * 3];
    cy += positions[i * 3 + 1];
    cz += positions[i * 3 + 2];
  }
  cx /= count;
  cy /= count;
  cz /= count;

  let furthest = 0;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - cx;
    const dy = positions[i * 3 + 1] - cy;
    const dz = positions[i * 3 + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > furthest) furthest = d;
  }
  const scale = furthest > 0 ? 1 / Math.sqrt(furthest) : 1;

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (positions[i * 3] - cx) * scale;
    positions[i * 3 + 1] = (positions[i * 3 + 1] - cy) * scale;
    positions[i * 3 + 2] = (positions[i * 3 + 2] - cz) * scale;
  }

  const indices = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      const lo = Math.min(disparity[a], disparity[b], disparity[c], disparity[d]);
      const hi = Math.max(disparity[a], disparity[b], disparity[c], disparity[d]);
      if (hi - lo > s.edge) continue;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData = {
    cols,
    rows,
    triangles: indices.length / 3,
    viewpoint: { x: -cx * scale, y: -cy * scale, z: -cz * scale },
    fov: {
      horizontal: s.fov,
      vertical: (Math.atan(Math.tan((s.fov * Math.PI) / 360) / aspect) * 360) / Math.PI,
    },
  };
  return geometry;
}

const keyOf = patch => {
  const s = settingsOf(patch);
  return `${s.fov}:${s.shift}:${s.detail}:${s.trim}:${s.smooth}:${s.edge}`;
};

TX.depthScene = {
  DETAILS,
  DISPLAYS,
  EDGE_JUMP,
  defaults,
  settingsOf,
  keyOf,
  rangeOf,
  build,
};

