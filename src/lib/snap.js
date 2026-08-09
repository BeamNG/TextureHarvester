
import { TX } from "../tx.js";

const TOLERANCE = 7;

const settingsOf = patch => ({
  grid: patch ? patch.snapToGrid !== false : true,
  edges: patch ? patch.snapToEdges !== false : true,
});

const linesOf = (min, max) => [min, (min + max) / 2, max];

function nearest(moving, targets, tolerance) {
  let best = null;
  for (const from of moving) {
    for (const target of targets) {
      const delta = target.at - from;
      const away = Math.abs(delta);
      if (away > tolerance) continue;
      if (best && away >= Math.abs(best.delta)) continue;
      best = { delta, at: target.at, from, source: target.source };
    }
  }
  return best;
}

function solve(options) {
  const opts = options || {};
  const box = opts.box;
  if (!box) return { dx: 0, dy: 0, guides: [] };

  const tolerance = opts.tolerance > 0 ? opts.tolerance : 0;
  const step = opts.step > 0 ? opts.step : 0;
  const useGrid = opts.grid !== false && step > 0;
  const useEdges = opts.edges !== false;
  const others = useEdges ? (opts.others || []) : [];
  const useOrigin = useEdges && opts.origin !== false;

  const guides = [];

  const axis = (label, min, max, pick) => {
    if (tolerance > 0 && useEdges) {
      const targets = [];
      if (useOrigin) targets.push({ at: 0, source: null });
      for (const other of others) {
        const extent = pick(other);
        for (const at of linesOf(extent.min, extent.max)) targets.push({ at, source: other });
      }
      const found = nearest(linesOf(min, max), targets, tolerance);
      if (found) {
        guides.push({ axis: label, at: found.at, box: found.source });
        return found.delta;
      }
    }
    if (!useGrid) return 0;
    return Math.round(min / step) * step - min;
  };

  return {
    dx: axis("x", box.minX, box.maxX, b => ({ min: b.minX, max: b.maxX })),
    dy: axis("y", box.minY, box.maxY, b => ({ min: b.minY, max: b.maxY })),
    guides,
  };
}

TX.snap = { TOLERANCE, settingsOf, linesOf, nearest, solve };

