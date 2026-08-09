
import { TX } from "../tx.js";

const defaults = () => ({ x: false, y: false });

const settingsOf = flip => ({
  x: !!(flip && flip.x),
  y: !!(flip && flip.y),
});

const isIdentity = flip => !flip || (!flip.x && !flip.y);

const cache = new Map(); // textureId -> { key, canvas }

const keyOf = (flip, version) => {
  const f = settingsOf(flip);
  return `${f.x ? "x" : ""}${f.y ? "y" : ""}${f.x || f.y ? "" : "-"}:${version || 0}`;
};

function apply(source, flip) {
  const f = settingsOf(flip);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  ctx.translate(f.x ? source.width : 0, f.y ? source.height : 0);
  ctx.scale(f.x ? -1 : 1, f.y ? -1 : 1);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function resolve(textureId, source, flip, version) {
  if (isIdentity(flip) || !source) {
    cache.delete(textureId);
    return source;
  }

  const key = keyOf(flip, version);
  const hit = cache.get(textureId);
  if (hit && hit.key === key) return hit.canvas;

  const canvas = apply(source, flip);
  cache.set(textureId, { key, canvas });
  return canvas;
}

const invalidate = textureId => {
  if (textureId == null) cache.clear();
  else cache.delete(textureId);
};

TX.flip = {
  defaults,
  settingsOf,
  isIdentity,
  keyOf,
  apply,
  resolve,
  invalidate,
};

