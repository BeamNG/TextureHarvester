
import * as THREE from "three";
import { TX } from "../tx.js";

const NEUTRAL = 128;

const clamp = (value, low, high) => (value < low ? low : (value > high ? high : value));

const num = (value, fallback, low, high) =>
  (typeof value === "number" && Number.isFinite(value) ? clamp(value, low, high) : fallback);

const SHAPES = ["plane", "box", "cylinder", "sphere"];

const SUBDIVISIONS = [32, 64, 128];

const FLAT_FLOOR = 0.01;

const BOW_PEAK = 0.25;

const DEPTH_GRID = 128;

const defaults = () => ({
  shape: "box",
  roughness: 0.65,
  metalness: 0,
  normal: 0.6,
  occlusion: 0.8,
  useDepth: false,
  bow: 0.6,
  subdivision: 64,
  detailNormal: 0,
  roughnessAmount: 0,
  cavity: 0,
  depthNormal: 0.5,
});

function settingsOf(patch) {
  const s = { ...defaults(), ...(patch && typeof patch === "object" ? patch : {}) };
  return {
    shape: SHAPES.includes(s.shape) ? s.shape : "box",
    roughness: num(s.roughness, 0.65, 0, 1),
    metalness: num(s.metalness, 0, 0, 1),
    normal: num(s.normal, 0.6, 0, 4),
    occlusion: num(s.occlusion, 0.8, 0, 1),
    useDepth: !!s.useDepth,
    bow: num(s.bow, 0.6, 0, 1),
    subdivision: SUBDIVISIONS.includes(s.subdivision) ? s.subdivision : 64,
    detailNormal: num(s.detailNormal, 0, 0, 2),
    roughnessAmount: num(s.roughnessAmount, 0, 0, 1),
    cavity: num(s.cavity, 0, 0, 1),
    depthNormal: num(s.depthNormal, 0.5, 0, 1),
  };
}

const canvasOf = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const dataOf = source => {
  const canvas = canvasOf(source.width, source.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, source.width, source.height);
};


// Tangent space +Y up; image rows down → ny = +dh/dv in normalMap().
const GRAIN_GAIN = 1;

function normalMap(shading, strength, options) {
  if (!shading || !shading.width || !shading.height) return null;
  const amount = num(strength, 0.6, 0, 4);
  const grain = !!(options && options.grain);
  const width = shading.width;
  const height = shading.height;
  const height01 = shading.data instanceof Float32Array
    ? shading.data
    : (() => {
      const { data } = dataOf(shading);
      const out = new Float32Array(width * height);
      for (let p = 0, i = 0; p < out.length; p++, i += 4) out[p] = data[i] / 255;
      return out;
    })();

  const out = new Uint8ClampedArray(width * height * 4);

  const at = (x, y) => height01[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];

  const scale = grain ? amount * GRAIN_GAIN : amount * Math.max(width, height);

  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      const du = (at(x + 1, y) - at(x - 1, y)) * 0.5 * scale;
      const dv = (at(x, y + 1) - at(x, y - 1)) * 0.5 * scale;
      const nx = -du;
      const ny = dv;
      const length = Math.hypot(nx, ny, 1) || 1;
      out[i] = Math.round((nx / length * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny / length * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }

  const canvas = canvasOf(width, height);
  canvas.getContext("2d").putImageData(new ImageData(out, width, height), 0, 0);
  return canvas;
}


// glTF occlusion: red channel, 1 = unoccluded.
function occlusionMap(shading, strength) {
  if (!shading || !shading.width || !shading.height) return null;
  const amount = num(strength, 0.8, 0, 1);
  const { data, width, height } = dataOf(shading);
  const out = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < out.length; i += 4) {
    const lit = Math.min(data[i] / NEUTRAL, 1);
    const value = Math.round((1 - amount * (1 - lit)) * 255);
    out[i] = value;
    out[i + 1] = value;
    out[i + 2] = value;
    out[i + 3] = 255;
  }

  const canvas = canvasOf(width, height);
  canvas.getContext("2d").putImageData(new ImageData(out, width, height), 0, 0);
  return canvas;
}


function depthHeightField(field, width, height, strength) {
  if (!field || !field.data || !(width >= 1) || !(height >= 1)) return null;
  const amount = num(strength, 0, 0, 1);
  if (!(amount > 0)) return null;

  const scale = (amount * 0.25) / Math.max(field.flatness || 0, FLAT_FLOOR);
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const v = height > 1 ? y / (height - 1) : 0;
    for (let x = 0; x < width; x++) {
      const u = width > 1 ? x / (width - 1) : 0;
      data[y * width + x] = 0.5 + TX.depth.at(field, u, v) * scale;
    }
  }
  return { data, width, height };
}


// Partial-derivative blend: add height gradients, don't average normals.
function combineNormals(first, second) {
  if (!first) return second;
  if (!second) return first;
  if (first.width !== second.width || first.height !== second.height) return first;

  const a = dataOf(first).data;
  const b = dataOf(second).data;
  const width = first.width;
  const height = first.height;
  const out = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < out.length; i += 4) {
    const x1 = a[i] / 127.5 - 1;
    const y1 = a[i + 1] / 127.5 - 1;
    const z1 = a[i + 2] / 127.5 - 1;
    const x2 = b[i] / 127.5 - 1;
    const y2 = b[i + 1] / 127.5 - 1;
    const z2 = b[i + 2] / 127.5 - 1;

    const x = x1 * z2 + x2 * z1;
    const y = y1 * z2 + y2 * z1;
    const z = z1 * z2;
    const length = Math.hypot(x, y, z) || 1;

    out[i] = Math.round((x / length * 0.5 + 0.5) * 255);
    out[i + 1] = Math.round((y / length * 0.5 + 0.5) * 255);
    out[i + 2] = Math.round((z / length * 0.5 + 0.5) * 255);
    out[i + 3] = 255;
  }

  const canvas = canvasOf(width, height);
  canvas.getContext("2d").putImageData(new ImageData(out, width, height), 0, 0);
  return canvas;
}

function combineOcclusion(first, second) {
  if (!first) return second;
  if (!second) return first;
  if (first.width !== second.width || first.height !== second.height) return first;

  const a = dataOf(first).data;
  const b = dataOf(second).data;
  const out = new Uint8ClampedArray(a.length);
  for (let i = 0; i < out.length; i += 4) {
    const value = Math.round((a[i] / 255) * (b[i] / 255) * 255);
    out[i] = value;
    out[i + 1] = value;
    out[i + 2] = value;
    out[i + 3] = 255;
  }

  const canvas = canvasOf(first.width, first.height);
  canvas.getContext("2d").putImageData(new ImageData(out, first.width, first.height), 0, 0);
  return canvas;
}


const cache = new Map(); // `${textureId}@${side}` -> entry

const keyOf = (material, delightKey) => {
  const s = settingsOf(material);
  return `${delightKey}|${s.normal.toFixed(3)}:${s.occlusion.toFixed(3)}`
    + `:${s.detailNormal.toFixed(3)}:${s.roughnessAmount.toFixed(3)}:${s.cavity.toFixed(3)}`
    + `:${s.roughness.toFixed(3)}`;
};

const WORKING_SIDE = 1024;

const reduced = new WeakMap(); // source canvas -> Map<`${w}x${h}`, canvas>

function reduce(source, width, height) {
  let sizes = reduced.get(source);
  if (!sizes) {
    sizes = new Map();
    reduced.set(source, sizes);
  }
  const key = `${width}x${height}`;
  const hit = sizes.get(key);
  if (hit) return hit;

  const canvas = canvasOf(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  sizes.set(key, canvas);
  return canvas;
}

function workingPair(albedo, extracted, maxSide) {
  const limit = maxSide > 0 ? maxSide : Infinity;
  const longest = Math.max(albedo.width, albedo.height);
  if (!(longest > limit)) return { albedo, extracted, side: longest };

  const scale = limit / longest;
  const shrink = source => reduce(source,
    Math.max(1, Math.round(source.width * scale)),
    Math.max(1, Math.round(source.height * scale)));
  return {
    albedo: shrink(albedo),
    extracted: extracted === albedo ? null : shrink(extracted),
    side: Math.round(longest * scale),
  };
}

function maps(textureId, albedo, extracted, delight, material, version, options) {
  if (!albedo || !extracted) return null;

  const s = settingsOf(material);
  const opts = options || {};
  const work = workingPair(albedo, extracted, opts.maxSide == null ? WORKING_SIDE : opts.maxSide);
  const workAlbedo = work.albedo;
  const workExtracted = work.extracted || work.albedo;
  const pixelKey = `${TX.store.textureKey(textureId) || TX.delight.keyOf(delight, version)}`
    + `@${work.side}`;

  const shapeKey = `${pixelKey}|${s.normal.toFixed(3)}:${s.occlusion.toFixed(3)}`
    + `:${s.detailNormal.toFixed(3)}:${s.cavity.toFixed(3)}`
    + `:${s.useDepth ? s.depthNormal.toFixed(3) : "off"}:${TX.store.state.depthEpoch}`;
  const roughKey = `${pixelKey}|${s.roughness.toFixed(3)}:${s.roughnessAmount.toFixed(3)}`;

  const cacheKey = `${textureId}@${work.side}`;
  const hit = cache.get(cacheKey) || {};

  const analysisKey = `${pixelKey}|${TX.delight.keyOf(delight, version)}`;
  const aligned = extracted.width === albedo.width && extracted.height === albedo.height;
  let analysis = hit.analysisKey === analysisKey ? hit.analysis : null;
  if (!analysis) {
    const shadingHeight = aligned ? TX.delight.shadingField(workExtracted, delight) : null;
    analysis = {
      shadingHeight,
      shading: shadingHeight ? TX.delight.shadingCanvas(shadingHeight) : null,
    };
  }

  const parts = () => TX.pbr.decompose(textureId, workAlbedo, pixelKey);

  let shape = hit.shapeKey === shapeKey ? hit.shape : null;
  if (!shape) {
    const { shadingHeight, shading } = analysis;

    let normal = shadingHeight && s.normal > 0 ? normalMap(shadingHeight, s.normal) : null;
    let occlusion = shading && s.occlusion > 0 ? occlusionMap(shading, s.occlusion) : null;

    const detailHeight = s.detailNormal > 0
      ? TX.pbr.heightField(parts(), s.detailNormal) : null;
    const height = detailHeight
      ? TX.pbr.write(detailHeight.data, detailHeight.width, detailHeight.height) : null;
    const cavity = s.cavity > 0 ? TX.pbr.cavityFrom(parts(), s.cavity) : null;

    const relief = aligned && s.useDepth && s.depthNormal > 0
      ? TX.store.reliefField(textureId, DEPTH_GRID) : null;
    const depthHeight = depthHeightField(relief, workAlbedo.width, workAlbedo.height,
      s.depthNormal);

    if (detailHeight) normal = combineNormals(normal, normalMap(detailHeight, 1, { grain: true }));
    if (depthHeight) normal = combineNormals(normal, normalMap(depthHeight, 1));
    if (cavity) occlusion = combineOcclusion(occlusion, cavity);

    shape = { shading, height, depthHeight, relief, cavity, normal, occlusion };
  }

  let rough = hit.roughKey === roughKey ? hit.rough : null;
  if (!rough) {
    rough = s.roughnessAmount > 0
      ? TX.pbr.roughnessFrom(parts(), s.roughness, s.roughnessAmount) : null;
  }

  cache.set(cacheKey, { analysisKey, analysis, shapeKey, shape, roughKey, rough });
  return { albedo, ...shape, roughness: rough };
}

function warm(textureId) {
  const store = TX.store;
  const node = store.findTexture(textureId);
  const asset = store.assets.textures.get(textureId);
  const albedo = node && store.textureCanvas(textureId);
  if (!node || !asset || !albedo) return null;
  return maps(textureId, albedo, asset.canvas, node.delight,
    settingsOf(store.state.settings.material), asset.version);
}

function colourMapsOn(settings) {
  const s = settingsOf(settings);
  return s.detailNormal > 0 || s.roughnessAmount > 0 || s.cavity > 0;
}

// Suggest + apply strengths. Caller warms maps under a progress bar.
function applySuggestion(textureId) {
  const store = TX.store;
  const node = store.findTexture(textureId);
  const asset = store.assets.textures.get(textureId);
  const albedo = node && store.textureCanvas(textureId);
  if (!node || !asset || !albedo) return null;

  const advice = TX.pbr.suggest(textureId, albedo, asset.version);
  if (!advice) return null;

  const before = settingsOf(store.state.settings.material);
  const next = advice.settings;
  const changed = before.roughness !== next.roughness
    || before.detailNormal !== next.detailNormal
    || before.roughnessAmount !== next.roughnessAmount
    || before.cavity !== next.cavity;

  if (changed) {
    TX.history.name("history.generate_pbr");
    Object.assign(store.state.settings.material, next);
  }

  advice.changed = changed;
  return advice;
}

function generateFrom(textureId) {
  const advice = applySuggestion(textureId);
  if (!advice) return null;
  warm(textureId);
  return advice;
}

const AUTO_MS = 500;
let autoTimer = null;
const autoPending = new Set();
let autoFocus = null;
let autoRunning = false;

function cancelAuto() {
  clearTimeout(autoTimer);
  autoTimer = null;
  autoPending.clear();
  autoFocus = null;
}

function autoEnabled() {
  return !!(TX.store.state.settings && TX.store.state.settings.autoPbr);
}

async function flushAuto() {
  autoTimer = null;
  if (autoRunning) return;
  if (!autoEnabled()) {
    autoPending.clear();
    autoFocus = null;
    return;
  }

  const ids = [...autoPending];
  const focus = autoFocus;
  autoPending.clear();
  autoFocus = null;
  if (!focus || !TX.store.findTexture(focus)) return;

  autoRunning = true;
  try {
    await TX.progress.run(TX.t("props.material.progress.generating"), async report => {
      const focusNode = TX.store.findTexture(focus);
      const labelOf = (id, index, total) => {
        const node = TX.store.findTexture(id);
        return TX.t("props.material.progress.deriving", {
          name: (node && node.name) || id,
          index,
          total,
        });
      };

      let changed = false;
      if (!colourMapsOn(TX.store.state.settings.material)) {
        await report(0, TX.t("props.material.progress.reading", {
          name: (focusNode && focusNode.name) || "",
        }));
        const advice = applySuggestion(focus);
        if (!advice) return;
        changed = !!advice.changed;
      }

      const rebuild = changed
        ? TX.store.state.textures.map(texture => texture.id)
        : [...new Set([focus, ...ids])].filter(id => TX.store.findTexture(id));
      if (!rebuild.length) return;

      await TX.progress.each(rebuild,
        (id, i, total) => labelOf(id, i + 1, total),
        id => { warm(id); });
    });
  } finally {
    autoRunning = false;
    if (autoPending.size && autoEnabled()) {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(flushAuto, AUTO_MS);
    }
  }
}

function scheduleAuto(textureId) {
  if (!textureId || !autoEnabled()) return;
  autoPending.add(textureId);
  autoFocus = textureId;
  if (autoRunning) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(flushAuto, AUTO_MS);
}

const EXPORT_CHANNELS = [
  {
    slot: "normal",
    suffix: "normal",
// Straight up in tangent space: the colour a flat surface encodes.
    backdrop: "rgb(128,128,255)",
  },
  {
    slot: "roughness",
    suffix: "roughness",
    backdrop: "rgb(128,128,128)",
  },
  {
    slot: "occlusion",
    suffix: "occlusion",
    backdrop: "rgb(255,255,255)",
  },
];

function full(textureId) {
  const store = TX.store;
  const node = store.findTexture(textureId);
  const asset = store.assets.textures.get(textureId);
  const albedo = node && store.textureCanvas(textureId);
  if (!node || !asset || !albedo) return null;
  return maps(textureId, albedo, asset.canvas, node.delight,
    settingsOf(store.state.settings.material), asset.version, { maxSide: 0 });
}

function held(textureId) {
  const prefix = `${textureId}@`;
  const found = [];
  for (const [key, entry] of cache) {
    if (!key.startsWith(prefix) || !entry) continue;
    const { shape, rough } = entry;
    const slots = {
      shading: shape && shape.shading,
      height: shape && shape.height,
      cavity: shape && shape.cavity,
      normal: shape && shape.normal,
      occlusion: shape && shape.occlusion,
      roughness: rough,
    };
    for (const [slot, canvas] of Object.entries(slots)) {
      if (canvas && canvas.width) found.push({ slot, canvas });
    }
  }
  return found;
}

function invalidate(textureId) {
  if (textureId == null) {
    cache.clear();
  } else {
    const prefix = `${textureId}@`;
    for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
  }
  TX.pbr.invalidate(textureId);
}


const UNIT = 1;

function extents(width, height) {
  if (!(width > 0) || !(height > 0)) return { x: UNIT, y: UNIT };
  return width >= height
    ? { x: UNIT, y: UNIT * height / width }
    : { x: UNIT * width / height, y: UNIT };
}

// Sheet y is down; three.js y is up — rotate the opposite way.
function turned(geometry, rotation) {
  const angle = Number.isFinite(rotation) ? rotation : 0;
  if (angle) geometry.rotateZ(-angle);
  return geometry;
}

function planeFor(size, relief) {
  const amount = relief ? num(relief.amount, 0, 0, 1) : 0;
  const field = relief ? relief.field : null;
  if (!field || !(amount > 0)) return new THREE.PlaneGeometry(size.x, size.y);

  const segments = SUBDIVISIONS.includes(relief.segments) ? relief.segments : 64;
  const geometry = new THREE.PlaneGeometry(size.x, size.y, segments, segments);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const scale = (amount * BOW_PEAK) / Math.max(field.flatness || 0, FLAT_FLOOR);

  for (let i = 0; i < position.count; i++) {
    position.setZ(i, TX.depth.at(field, uv.getX(i), 1 - uv.getY(i)) * scale);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function geometryFor(shape, width, height, relief, rotation) {
  const size = extents(width, height);
  if (shape === "box") {
    return new THREE.BoxGeometry(size.x, size.y, Math.min(size.x, size.y));
  }
  if (shape === "cylinder") {
    const radius = UNIT / 2;
    const wrapped = radius * 2 * Math.PI;
    const tall = width > 0 ? wrapped * (height / width) : UNIT;
    return new THREE.CylinderGeometry(radius, radius, Math.min(tall, 2), 96, 1, true);
  }
  if (shape === "sphere") {
    return new THREE.SphereGeometry(UNIT / 2, 96, 64);
  }
  return turned(planeFor(size, relief), rotation);
}

function withAoUvs(geometry) {
  const uv = geometry.getAttribute("uv");
  if (uv && !geometry.getAttribute("uv1")) geometry.setAttribute("uv1", uv.clone());
  return geometry;
}

function studioRig() {
  const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
  key.position.set(2.5, 3, 2.2);
  key.name = "key";
  const fill = new THREE.DirectionalLight(0xdce6ff, 0.8);
  fill.position.set(-3, 0.4, 1.6);
  fill.name = "fill";
  const rim = new THREE.DirectionalLight(0xffffff, 1.4);
  rim.position.set(-1.2, 1.6, -2.6);
  rim.name = "rim";
  return [key, fill, rim];
}

TX.material = {
  EXPORT_CHANNELS,
  SHAPES,
  SUBDIVISIONS,
  UNIT,
  FLAT_FLOOR,
  BOW_PEAK,
  DEPTH_GRID,
  depthHeightField,
  defaults,
  settingsOf,
  normalMap,
  occlusionMap,
  combineNormals,
  combineOcclusion,
  maps,
  warm,
  full,
  held,
  keyOf,
  generateFrom,
  applySuggestion,
  scheduleAuto,
  cancelAuto,
  colourMapsOn,
  invalidate,
  extents,
  geometryFor,
  withAoUvs,
  studioRig,
};

