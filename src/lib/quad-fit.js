
import { TX } from "../tx.js";

const TRACE_MAX = 512;

const MIN_IOU = 0.9;

const CORNER_TRIM = 0.15;

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

const areaOf = ring => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return Math.abs(sum) / 2;
};

function shrink(mask, limit) {
  const scale = Math.min(1, limit / Math.max(mask.width, mask.height));
  if (scale >= 1) return { data: mask.data, width: mask.width, height: mask.height, scale: 1 };

  const width = Math.max(2, Math.round(mask.width * scale));
  const height = Math.max(2, Math.round(mask.height * scale));
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mask.height - 1, Math.floor(((y + 0.5) * mask.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mask.width - 1, Math.floor(((x + 0.5) * mask.width) / width));
      data[y * width + x] = mask.data[sy * mask.width + sx] > 0.5 ? 1 : 0;
    }
  }
  return { data, width, height, scale: width / mask.width };
}

function componentAt(mask, seed) {
  const { data, width, height } = mask;
  const seen = new Uint8Array(width * height);
  const start = seed
    ? Math.min(height - 1, Math.max(0, Math.round(seed.y))) * width
      + Math.min(width - 1, Math.max(0, Math.round(seed.x)))
    : -1;

  if (start < 0 || !data[start]) {
    let any = 0;
    for (let i = 0; i < data.length; i++) if (data[i]) { seen[i] = 1; any++; }
    return any ? seen : null;
  }

  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const at = stack.pop();
    const x = at % width;
    const y = (at - x) / width;
    const step = (to, ok) => {
      if (ok && data[to] && !seen[to]) { seen[to] = 1; stack.push(to); }
    };
    step(at - 1, x > 0);
    step(at + 1, x < width - 1);
    step(at - width, y > 0);
    step(at + width, y < height - 1);
  }
  return seen;
}

function edgePoints(component, width, height) {
  const points = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!component[i]) continue;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1
        || !component[i - 1] || !component[i + 1]
        || !component[i - width] || !component[i + width]) points.push({ x, y });
    }
  }
  return points;
}

// Andrew's monotone chain.
function hullOf(points) {
  if (points.length < 3) return points.slice();
  const sorted = points.slice().sort((l, r) => (l.x - r.x) || (l.y - r.y));

  const half = list => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };

  return half(sorted).concat(half(sorted.slice().reverse()));
}

function reduceToQuad(ring) {
  const points = ring.slice();
  while (points.length > 4) {
    let victim = 0;
    let least = Infinity;
    for (let i = 0; i < points.length; i++) {
      const lost = Math.abs(cross(
        points[(i - 1 + points.length) % points.length],
        points[i],
        points[(i + 1) % points.length],
      )) / 2;
      if (lost < least) {
        least = lost;
        victim = i;
      }
    }
    points.splice(victim, 1);
  }
  return points;
}

// Total least squares — vertical sides fit as well as horizontal.
function fitLine(points) {
  if (points.length < 2) return null;
  let cx = 0;
  let cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length;
  cy /= points.length;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx + syy < 1e-12) return null;

  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const a = -Math.sin(theta);
  const b = Math.cos(theta);
  return { a, b, c: a * cx + b * cy };
}

const lineThrough = (p, qq) => {
  const dx = qq.x - p.x;
  const dy = qq.y - p.y;
  const length = Math.hypot(dx, dy) || 1;
  const a = -dy / length;
  const b = dx / length;
  return { a, b, c: a * p.x + b * p.y };
};

function intersect(first, second) {
  const det = first.a * second.b - second.a * first.b;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (first.c * second.b - second.c * first.b) / det,
    y: (first.a * second.c - second.a * first.c) / det,
  };
}

function agreement(quad, component, mask) {
  let both = 0;
  let either = 0;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const set = component[y * mask.width + x] === 1;
      const covered = TX.geom.pointInQuad({ x: x + 0.5, y: y + 0.5 }, quad);
      if (set || covered) either++;
      if (set && covered) both++;
    }
  }
  return { both, either, iou: either ? both / either : 0 };
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function refine(corners, hull) {
  const sides = [[], [], [], []];
  for (const p of hull) {
    let best = 0;
    let nearest = Infinity;
    for (let i = 0; i < 4; i++) {
      const away = distanceToSegment(p, corners[i], corners[(i + 1) % 4]);
      if (away < nearest) {
        nearest = away;
        best = i;
      }
    }
    sides[best].push(p);
  }

  const lines = sides.map((points, i) => {
    const from = corners[i];
    const to = corners[(i + 1) % 4];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const middle = length > 0 ? points.filter(p => {
      const t = ((p.x - from.x) * dx + (p.y - from.y) * dy) / (length * length);
      return t >= CORNER_TRIM && t <= 1 - CORNER_TRIM;
    }) : [];
    return fitLine(middle.length >= 2 ? middle : points) || lineThrough(from, to);
  });

  return corners.map((corner, i) => intersect(lines[(i + 3) % 4], lines[i]) || corner);
}

function quadFor(mask, seed) {
  if (!mask || !mask.data || !(mask.width >= 2) || !(mask.height >= 2)) return null;

  const small = shrink(mask, TRACE_MAX);
  const component = componentAt(small, seed
    ? { x: seed.x * small.scale, y: seed.y * small.scale } : null);
  if (!component) return null;

  const hull = hullOf(edgePoints(component, small.width, small.height));
  if (hull.length < 3) return null;

  const coarse = reduceToQuad(hull);
  if (coarse.length !== 4) return null;

  const usable = candidate => candidate.length === 4
    && candidate.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    && areaOf(candidate) > 0;
  if (!usable(coarse)) return null;

  const refined = refine(coarse, hull);
  const scoreOf = candidate => agreement(candidate, component, small);
  const coarseScore = scoreOf(coarse);
  const refinedScore = usable(refined) ? scoreOf(refined) : null;

  const better = refinedScore && refinedScore.iou > coarseScore.iou;
  const quad = better ? refined : coarse;
  const { both, either } = better ? refinedScore : coarseScore;

  const ordered = TX.geom.orderQuad(quad.map(p => ({
    x: (p.x + 0.5) / small.scale,
    y: (p.y + 0.5) / small.scale,
  })));
  if (!ordered) return null;

  return {
    quad: ordered,
    iou: either ? both / either : 0,
    coverage: both / (small.width * small.height),
  };
}

TX.quadFit = {
  TRACE_MAX,
  MIN_IOU,
  quadFor,
  hullOf,
  reduceToQuad,
  refine,
  fitLine,
  agreement,
  areaOf,
};

