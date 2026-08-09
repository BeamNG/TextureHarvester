
import { TX } from "../tx.js";

const HEADROOM = 1.5;

const FLOOR = 256;

const MAX_LEVEL = 5;

function levelFor(source, wanted) {
  if (!source || !source.width || !source.height) return 0;
  const longest = Math.max(source.width, source.height);
  const needed = Math.max(1, wanted) * HEADROOM;
  let level = 0;
  while (level < MAX_LEVEL
    && longest / 2 ** (level + 1) >= needed
    && longest / 2 ** (level + 1) >= FLOOR) {
    level++;
  }
  return level;
}

const sizeAt = (source, level) => ({
  width: Math.max(1, Math.round(source.width / 2 ** level)),
  height: Math.max(1, Math.round(source.height / 2 ** level)),
});

const pyramids = new WeakMap(); // source canvas -> Map<level, canvas>

function canvasAt(source, level) {
  if (!source || !(level > 0)) return source;
  const want = Math.min(MAX_LEVEL, Math.round(level));

  let levels = pyramids.get(source);
  if (!levels) {
    levels = new Map();
    pyramids.set(source, levels);
  }
  const hit = levels.get(want);
  if (hit) return hit;

  let from = source;
  for (let step = 1; step <= want; step++) {
    const cached = levels.get(step);
    if (cached) {
      from = cached;
      continue;
    }
    const size = sizeAt(source, step);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(from, 0, 0, size.width, size.height);
    levels.set(step, canvas);
    from = canvas;
  }
  return from;
}

function forScreen(source, screenLongSide) {
  const level = levelFor(source, screenLongSide);
  return { level, canvas: canvasAt(source, level) };
}

const shouldReupload = (current, wanted) =>
  wanted < current || wanted > current + 1;

TX.display = {
  HEADROOM,
  FLOOR,
  MAX_LEVEL,
  levelFor,
  sizeAt,
  canvasAt,
  forScreen,
  shouldReupload,
};

