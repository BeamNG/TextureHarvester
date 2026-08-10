
import { TX } from "../tx.js";

const EPS = 1e-9;

// Derivation follows Heckbert, "Fundamentals of Texture Mapping and Image Warping".
const determinant3 = m =>
  m[0] * (m[4] * m[8] - m[5] * m[7])
  - m[1] * (m[3] * m[8] - m[5] * m[6])
  + m[2] * (m[3] * m[7] - m[4] * m[6]);

function nonSingular(m, quad) {
  if (!m || !m.every(Number.isFinite)) return null;
  const xs = quad.map(p => p.x);
  const ys = quad.map(p => p.y);
  const span = Math.max(
    Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!(span > 0)) return null;
  return Math.abs(determinant3(m)) > 1e-9 * span * span ? m : null;
}

function squareToQuad(quad) {
  const [p0, p1, p2, p3] = quad;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;

  if (Math.abs(sx) < EPS && Math.abs(sy) < EPS) {
    return nonSingular([
      p1.x - p0.x, p2.x - p1.x, p0.x,
      p1.y - p0.y, p2.y - p1.y, p0.y,
      0, 0, 1,
    ], quad);
  }

  const dx1 = p1.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dx2 = p3.x - p2.x;
  const dy2 = p3.y - p2.y;

  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < EPS) return null; // degenerate: three points collinear

  const g = (sx * dy2 - sy * dx2) / den;
  const h = (dx1 * sy - dy1 * sx) / den;

  return nonSingular([
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ], quad);
}

function applyHomography(m, u, v) {
  const w = m[6] * u + m[7] * v + m[8];
  return { x: (m[0] * u + m[1] * v + m[2]) / w, y: (m[3] * u + m[4] * v + m[5]) / w };
}

function invert3(m) {
  const a = m[4] * m[8] - m[5] * m[7];
  const b = m[5] * m[6] - m[3] * m[8];
  const c = m[3] * m[7] - m[4] * m[6];
  const det = m[0] * a + m[1] * b + m[2] * c;
  if (!Number.isFinite(det) || Math.abs(det) < EPS) return null;
  const k = 1 / det;
  return [
    a * k, (m[2] * m[7] - m[1] * m[8]) * k, (m[1] * m[5] - m[2] * m[4]) * k,
    b * k, (m[0] * m[8] - m[2] * m[6]) * k, (m[2] * m[3] - m[0] * m[5]) * k,
    c * k, (m[1] * m[6] - m[0] * m[7]) * k, (m[0] * m[4] - m[1] * m[3]) * k,
  ];
}

const quadToSquare = quad => {
  const h = squareToQuad(quad);
  return h ? invert3(h) : null;
};


const UNIT_CORNERS = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

const unitDomain = () => ({ u0: 0, v0: 0, u1: 1, v1: 1 });
const zero = () => ({ x: 0, y: 0 });
const flatCurve = () => [0, 1, 2, 3].map(() => ({ a: zero(), b: zero() }));

const isUnitDomain = d => !d
  || (d.u0 === 0 && d.v0 === 0 && d.u1 === 1 && d.v1 === 1);

const offsetOf = value => ({
  x: (value && Number.isFinite(value.x) && value.x) || 0,
  y: (value && Number.isFinite(value.y) && value.y) || 0,
});

const negligible = v => !v
  || ((!Number.isFinite(v.x) || Math.abs(v.x) < EPS)
    && (!Number.isFinite(v.y) || Math.abs(v.y) < EPS));

const isStraight = c => !c
  || (c.a === undefined && c.b === undefined
    ? negligible(c)
    : negligible(c.a) && negligible(c.b));

const isFlatCurve = curve => !curve || !curve.length || curve.every(isStraight);

const controlsOf = entry => {
  if (!entry) return { a: zero(), b: zero() };
  if (entry.a !== undefined || entry.b !== undefined) {
    return { a: offsetOf(entry.a), b: offsetOf(entry.b) };
  }
  const d = offsetOf(entry);
  const both = { x: (d.x * 4) / 3, y: (d.y * 4) / 3 };
  return { a: { ...both }, b: { ...both } };
};

const curveOf = curve => (Array.isArray(curve) && curve.length === 4
  ? curve.map(controlsOf)
  : flatCurve());

const domainOf = domain => {
  const d = domain || {};
  const num = (value, fallback) =>
    (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  return { u0: num(d.u0, 0), v0: num(d.v0, 0), u1: num(d.u1, 1), v1: num(d.v1, 1) };
};

function edgeControls(curve, index) {
  const a = UNIT_CORNERS[index];
  const b = UNIT_CORNERS[(index + 1) % 4];
  const entry = curve && curve[index];
  const c = entry && entry.a === undefined && entry.b === undefined
    ? controlsOf(entry) : { a: offsetOf(entry && entry.a), b: offsetOf(entry && entry.b) };
  return [
    { x: a.x + (b.x - a.x) / 3 + c.a.x, y: a.y + (b.y - a.y) / 3 + c.a.y },
    { x: a.x + ((b.x - a.x) * 2) / 3 + c.b.x, y: a.y + ((b.y - a.y) * 2) / 3 + c.b.y },
  ];
}

function controlOffset(index, which, point) {
  const a = UNIT_CORNERS[index];
  const b = UNIT_CORNERS[(index + 1) % 4];
  const along = which ? 2 / 3 : 1 / 3;
  return {
    x: point.x - (a.x + (b.x - a.x) * along),
    y: point.y - (a.y + (b.y - a.y) * along),
  };
}

function edgePoint(curve, index, t) {
  const a = UNIT_CORNERS[index];
  const b = UNIT_CORNERS[(index + 1) % 4];
  const [c1, c2] = edgeControls(curve, index);
  const s = 1 - t;
  const w0 = s * s * s;
  const w1 = 3 * s * s * t;
  const w2 = 3 * s * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x,
    y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y,
  };
}

function coonsPoint(curve, u, v) {
  const top = edgePoint(curve, 0, u);
  const right = edgePoint(curve, 1, v);
  const bottom = edgePoint(curve, 2, 1 - u); // edge 2 runs from corner 2 to corner 3
  const left = edgePoint(curve, 3, 1 - v); // edge 3 runs from corner 3 to corner 0
  const bilinearX = (1 - u) * (1 - v) * 0 + u * (1 - v) * 1 + u * v * 1 + (1 - u) * v * 0;
  const bilinearY = (1 - u) * (1 - v) * 0 + u * (1 - v) * 0 + u * v * 1 + (1 - u) * v * 1;
  return {
    x: (1 - v) * top.x + v * bottom.x + (1 - u) * left.x + u * right.x - bilinearX,
    y: (1 - v) * top.y + v * bottom.y + (1 - u) * left.y + u * right.y - bilinearY,
  };
}

function localToImage(h, curve, u, v, lens) {
  const p = isFlatCurve(curve) ? { x: u, y: v } : coonsPoint(curve, u, v);
  const ideal = applyHomography(h, p.x, p.y);
  return lens ? lens.toActual(ideal) : ideal;
}

function fitQuad(quad, lens) {
  return squareToQuad(lens ? quad.map(p => lens.toIdeal(p)) : quad);
}

function imageToLocal(inverse, lens, point) {
  const ideal = lens ? lens.toIdeal(point) : point;
  return applyHomography(inverse, ideal.x, ideal.y);
}

function effectiveQuad(quad, domain, curve, lens) {
  if (isUnitDomain(domain) && isFlatCurve(curve) && !lens) return quad;
  const h = fitQuad(quad, lens);
  if (!h) return quad;
  const d = domainOf(domain);
  const c = curveOf(curve);
  return [
    localToImage(h, c, d.u0, d.v0, lens),
    localToImage(h, c, d.u1, d.v0, lens),
    localToImage(h, c, d.u1, d.v1, lens),
    localToImage(h, c, d.u0, d.v1, lens),
  ];
}

function outlinePath(quad, domain, curve, steps, lens) {
  const h = fitQuad(quad, lens);
  if (!h) return quad.slice();
  const d = domainOf(domain);
  const c = curveOf(curve);
  const n = isFlatCurve(c) && !lens ? 1 : Math.max(2, steps || 12);
  const path = [];
  const at = (u, v) => path.push(localToImage(h, c, u, v, lens));
  for (let i = 0; i < n; i++) at(d.u0 + ((d.u1 - d.u0) * i) / n, d.v0);
  for (let i = 0; i < n; i++) at(d.u1, d.v0 + ((d.v1 - d.v0) * i) / n);
  for (let i = 0; i < n; i++) at(d.u1 - ((d.u1 - d.u0) * i) / n, d.v1);
  for (let i = 0; i < n; i++) at(d.u0, d.v1 - ((d.v1 - d.v0) * i) / n);
  return path;
}

const HORIZON_MARGIN = 0.08;
const MAX_UNITS = 64;

const polygonArea = points => {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
};

function clipHalfPlane(points, side) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const da = side(a);
    const db = side(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function rectifyPlan(quad, width, height, options) {
  const opts = options || {};
  const margin = Number.isFinite(opts.margin) ? Math.max(0.005, Math.min(0.9, opts.margin))
    : HORIZON_MARGIN;
  const budget = Math.max(256, Math.round(opts.maxSide || 4096));

  const lens = opts.lens || null;
  const h = fitQuad(quad, lens);
  const inverse = h ? invert3(h) : null;
  if (!inverse || !(width > 0) || !(height > 0)) return null;

  const depthAt = p => inverse[6] * p.x + inverse[7] * p.y + inverse[8];
  const centre = applyHomography(h, 0.5, 0.5);
  const reference = depthAt(centre);
  if (!Number.isFinite(reference) || Math.abs(reference) < EPS) return null;
  const sign = reference < 0 ? -1 : 1;
  const floor = Math.abs(reference) * margin;

  const frame = [
    { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height },
  ];
  const frameIdeal = lens ? frame.map(p => lens.toIdeal(p)) : frame;
  const visible = clipHalfPlane(frameIdeal, p => sign * depthAt(p) - floor);
  if (visible.length < 3) return null;

  let u0 = Infinity;
  let v0 = Infinity;
  let u1 = -Infinity;
  let v1 = -Infinity;
  for (const p of visible) {
    const local = applyHomography(inverse, p.x, p.y);
    if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return null;
    u0 = Math.min(u0, local.x);
    v0 = Math.min(v0, local.y);
    u1 = Math.max(u1, local.x);
    v1 = Math.max(v1, local.y);
  }

  u0 = Math.max(u0, -MAX_UNITS);
  v0 = Math.max(v0, -MAX_UNITS);
  u1 = Math.min(u1, 1 + MAX_UNITS);
  v1 = Math.min(v1, 1 + MAX_UNITS);
  const domain = {
    u0: Math.min(u0, 0), v0: Math.min(v0, 0), u1: Math.max(u1, 1), v1: Math.max(v1, 1),
  };

  const unit = quadDimensions(lens ? quad.map(p => lens.toIdeal(p)) : quad);
  let outWidth = (domain.u1 - domain.u0) * unit.width;
  let outHeight = (domain.v1 - domain.v0) * unit.height;
  if (!(outWidth > 0) || !(outHeight > 0)) return null;

  const shrink = Math.min(1, budget / Math.max(outWidth, outHeight));
  outWidth = Math.max(1, Math.round(outWidth * shrink));
  outHeight = Math.max(1, Math.round(outHeight * shrink));

  const coverage = polygonArea(visible) / (width * height);

  return {
    domain,
    size: { width: outWidth, height: outHeight },
    clipped: coverage < 0.999,
    coverage,
    scale: shrink,
  };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function quadDimensions(quad) {
  const [tl, tr, br, bl] = quad;
  return {
    width: (dist(tl, tr) + dist(br, bl)) * 0.5,
    height: (dist(tr, br) + dist(bl, tl)) * 0.5,
  };
}

// Corners closer than this share of the mark's span read as one handle.
const PINCH_RATIO = 0.05;

function pinchedCorners(points, ratio) {
  if (!points || points.length !== 4) return [];
  const span = Math.max(quadDimensions(points).width, quadDimensions(points).height, 1);
  const min = span * (typeof ratio === "number" ? ratio : PINCH_RATIO);
  const pairs = [];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (dist(points[i], points[j]) < min) pairs.push([i, j]);
    }
  }
  return pairs;
}

function orderQuad(points) {
  if (points.length !== 4) return null;

  const cx = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
  const cy = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;

  const ring = points
    .map(p => ({ p, a: Math.atan2(p.y - cy, p.x - cx) }))
    .sort((l, r) => l.a - r.a)
    .map(e => e.p);

  let start = 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const score = ring[i].x + ring[i].y;
    if (score < best) {
      best = score;
      start = i;
    }
  }

  return [0, 1, 2, 3].map(i => ring[(start + i) % 4]);
}

function pointInQuad(pt, quad) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = quad[i];
    const b = quad[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

TX.geom = {
  squareToQuad,
  quadToSquare,
  applyHomography,
  invert3,
  quadDimensions,
  orderQuad,
  pinchedCorners,
  PINCH_RATIO,
  pointInQuad,
  dist,
  UNIT_CORNERS,
  unitDomain,
  flatCurve,
  isUnitDomain,
  isFlatCurve,
  isStraight,
  curveOf,
  controlsOf,
  domainOf,
  edgeControls,
  controlOffset,
  edgePoint,
  coonsPoint,
  localToImage,
  fitQuad,
  imageToLocal,
  effectiveQuad,
  outlinePath,
  HORIZON_MARGIN,
  MAX_UNITS,
  clipHalfPlane,
  rectifyPlan,
};

