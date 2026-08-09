import { TX } from "../tx.js";

const defaults = () => ({ k1: 0, k2: 0 });

const num = (value, fallback, min, max) => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, n));
};

const settingsOf = lens => ({
  k1: num(lens && lens.k1, 0, -0.5, 0.5),
  k2: num(lens && lens.k2, 0, -0.25, 0.25),
});

const isIdentity = lens => {
  const s = settingsOf(lens);
  return s.k1 === 0 && s.k2 === 0;
};

const keyOf = lens => {
  const s = settingsOf(lens);
  return isIdentity(s) ? "-" : `${s.k1.toFixed(5)}:${s.k2.toFixed(5)}`;
};

function project(lens, width, height) {
  const s = settingsOf(lens);
  const cx = width / 2;
  const cy = height / 2;
  const scale = Math.hypot(width, height) / 2 || 1;
  const identity = s.k1 === 0 && s.k2 === 0;

  const factor = r2 => 1 + s.k1 * r2 + s.k2 * r2 * r2;

  // ideal -> actual; must match warp shader distort()
  const toActual = p => {
    if (identity) return { x: p.x, y: p.y };
    const dx = (p.x - cx) / scale;
    const dy = (p.y - cy) / scale;
    const f = factor(dx * dx + dy * dy);
    return { x: cx + dx * f * scale, y: cy + dy * f * scale };
  };

  const toIdeal = p => {
    if (identity) return { x: p.x, y: p.y };
    const dx = (p.x - cx) / scale;
    const dy = (p.y - cy) / scale;
    const target = Math.hypot(dx, dy);
    if (target < 1e-12) return { x: p.x, y: p.y };

    let r = target;
    for (let i = 0; i < 8; i++) {
      const r2 = r * r;
      const f = factor(r2);
      const value = r * f - target;
      const slope = 1 + 3 * s.k1 * r2 + 5 * s.k2 * r2 * r2;
      if (Math.abs(slope) < 1e-9) break;
      const step = value / slope;
      r -= step;
      if (Math.abs(step) < 1e-12) break;
    }
    if (!(r > 0) || !Number.isFinite(r)) return { x: p.x, y: p.y };

    const k = r / target;
    return { x: cx + dx * k * scale, y: cy + dy * k * scale };
  };

  return { ...s, identity, cx, cy, scale, toActual, toIdeal };
}

function forImage(image) {
  if (!image || isIdentity(image.lens)) return null;
  const width = image.width;
  const height = image.height;
  if (!(width > 0) || !(height > 0)) return null;
  return project(image.lens, width, height);
}


function straightness(points) {
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-9)) return 0;

  let worst = 0;
  let sum = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const away = Math.abs((p.x - first.x) * dy - (p.y - first.y) * dx) / length;
    sum += away * away;
    worst = Math.max(worst, away);
  }
  return Math.sqrt(sum / Math.max(1, points.length - 2)) / length + worst / length * 0.25;
}

function tracedLines(marks, samples) {
  const n = Math.max(4, samples || 12);
  const lines = [];
  for (const mark of marks) {
    const curve = TX.geom.curveOf(mark.curve);
    const h = TX.geom.squareToQuad(mark.points);
    if (!h) continue;
    for (let edge = 0; edge < 4; edge++) {
      if (TX.geom.isStraight(curve[edge])) continue;
      const points = [];
      for (let i = 0; i <= n; i++) {
        const local = TX.geom.edgePoint(curve, edge, i / n);
        points.push(TX.geom.applyHomography(h, local.x, local.y));
      }
      lines.push(points);
    }
  }
  return lines;
}

function fit(marks, width, height, options) {
  const opts = options || {};
  const lines = tracedLines(marks, opts.samples);
  if (!lines.length || !(width > 0) || !(height > 0)) return null;

  const cost = k1 => {
    const lens = project({ k1, k2: 0 }, width, height);
    let total = 0;
    for (const line of lines) total += straightness(line.map(lens.toIdeal));
    return total / lines.length;
  };

  const limit = 0.5;
  let best = 0;
  let bestCost = cost(0);
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const k = -limit + (2 * limit * i) / steps;
    const value = cost(k);
    if (value < bestCost) {
      bestCost = value;
      best = k;
    }
  }

  const span = (2 * limit) / steps;
  let low = Math.max(-limit, best - span);
  let high = Math.min(limit, best + span);
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40 && high - low > 1e-6; i++) {
    const a = high - (high - low) * phi;
    const b = low + (high - low) * phi;
    if (cost(a) < cost(b)) high = b;
    else low = a;
  }
  const k1 = (low + high) / 2;

  const before = cost(0);
  const after = cost(k1);
  return {
    k1,
    residual: after,
    before,
    improvement: before > 1e-12 ? Math.max(0, 1 - after / before) : 0,
    lines: lines.length,
  };
}

TX.lens = {
  defaults,
  settingsOf,
  isIdentity,
  keyOf,
  project,
  forImage,
  straightness,
  tracedLines,
  fit,
};

