// Decoded images/textures live in plain Maps; Vue must not deep-proxy GPU data.

import { reactive, watch } from "vue";
import { TX } from "./tx.js";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`);

const assets = {
  sources: new Map(),
  textures: new Map(),
  depth: new Map(),
};

const defaultSettings = () => ({
  locale: "auto",
  gridSize: 16,
  snapToGrid: true,
  snapToEdges: true,
  showGrid: true,
  weldRadius: 8,
  loupeSample: 32,
  supersample: 2,
  padding: 2,
  powerOfTwo: false,
  exportMaps: false,
  preview: { cols: 3, rows: 3, wrap: "repeat", showSeams: true },
  views: { mode: "off", overlay: 0.8, numbers: true },
  sway: true,
  material: TX.material.defaults(),
  ai: false,
  depth: TX.depthScene.defaults(),
  props: {
    transform: true, local: false, lens: false, lighting: true, material: true,
    tiling: true, depth: false, scene: true, sceneMesh: false,
  },
});

const defaultViewports = () => ({ mark: null, atlas: null, tiling: null });

const state = reactive({
  images: [],
  marks: [],
  textures: [],
  settings: defaultSettings(),
  selection: { kind: null, ids: [] },
  pending: { imageId: null, points: [] },
  viewports: defaultViewports(),
  camera3d: null,
  activePanel: "mark",
  storageKind: "…",
  busy: false,
  // Plain Map pixels are not reactive; bump so dependents invalidate.
  pixelEpoch: 0,
  depthEpoch: 0,
  depthBusy: null,
  depthError: null,
  sceneStats: null,
});

const cameraOf = camera => {
  if (!camera) return null;
  const triple = value => Array.isArray(value) && value.length === 3
    && value.every(n => typeof n === "number" && Number.isFinite(n));
  if (!triple(camera.position) || !triple(camera.target)) return null;
  const spread = Math.hypot(...camera.position.map((n, i) => n - camera.target[i]));
  // Reject degenerate camera (no view direction).
  return spread > 1e-6
    ? { position: camera.position.slice(), target: camera.target.slice() } : null;
};

const setCamera3d = camera => {
  state.camera3d = cameraOf(camera);
};

function setViewport(key, viewport) {
  if (!(key in state.viewports)) return;
  state.viewports[key] = viewport
    ? { panX: viewport.panX, panY: viewport.panY, zoom: viewport.zoom }
    : null;
}

const findImage = id => state.images.find(i => i.id === id);
const findMark = id => state.marks.find(m => m.id === id);
const findTexture = id => state.textures.find(t => t.id === id);
const marksOfImage = id => state.marks.filter(m => m.imageId === id);

const KINDS = ["image", "mark", "texture"];

const collectionOf = kind => {
  if (kind === "image") return state.images;
  if (kind === "mark") return state.marks;
  if (kind === "texture") return state.textures;
  return null;
};

const selectedKind = () => state.selection.kind;

const selectedIds = kind => (state.selection.kind === kind ? state.selection.ids : []);

const isSelected = (kind, id) =>
  state.selection.kind === kind && state.selection.ids.includes(id);

const selectionCount = kind =>
  (kind === undefined || state.selection.kind === kind ? state.selection.ids.length : 0);

function soleSelected(kind) {
  if (state.selection.kind !== kind || state.selection.ids.length !== 1) return null;
  const collection = collectionOf(kind);
  return (collection && collection.find(item => item.id === state.selection.ids[0])) || null;
}

function selectedItems(kind) {
  const collection = collectionOf(kind);
  if (!collection || state.selection.kind !== kind) return [];
  const wanted = new Set(state.selection.ids);
  return collection.filter(item => wanted.has(item.id));
}

function select(kind, ids) {
  const list = ids == null ? [] : (Array.isArray(ids) ? ids : [ids]);
  const collection = collectionOf(kind);
  const live = collection
    ? list.filter(id => collection.some(item => item.id === id))
    : [];
  if (!live.length) {
    state.selection = { kind: null, ids: [] };
    return;
  }
  state.selection = { kind, ids: [...new Set(live)] };
}

function toggleSelected(kind, id) {
  if (state.selection.kind !== kind) {
    select(kind, id);
    return;
  }
  const ids = state.selection.ids;
  select(kind, ids.includes(id) ? ids.filter(s => s !== id) : ids.concat(id));
}

const clearSelection = () => {
  state.selection = { kind: null, ids: [] };
};

const selectAllOf = kind => {
  const collection = collectionOf(kind);
  select(kind, collection ? collection.map(item => item.id) : []);
};

function pruneSelection() {
  const collection = collectionOf(state.selection.kind);
  if (!collection) {
    if (state.selection.kind !== null) clearSelection();
    return;
  }
  const live = state.selection.ids.filter(id => collection.some(item => item.id === id));
  if (live.length !== state.selection.ids.length) select(state.selection.kind, live);
}

const selectionOf = value => {
  const kind = value && KINDS.includes(value.kind) ? value.kind : null;
  const ids = kind && Array.isArray(value.ids)
    ? value.ids.filter(id => typeof id === "string")
    : [];
  return ids.length ? { kind, ids } : { kind: null, ids: [] };
};

function addImage(entry) {
  const image = {
    id: entry.id || uid(),
    name: entry.name,
    x: entry.x || 0,
    y: entry.y || 0,
    width: entry.width,
    height: entry.height,
    rotation: entry.rotation || 0,
    scaleX: entry.scaleX == null ? 1 : entry.scaleX,
    scaleY: entry.scaleY == null ? 1 : entry.scaleY,
    file: entry.file || null,
    lens: TX.lens.settingsOf(entry.lens),
  };
  state.images.push(image);
  return image;
}

function setLens(id, patch) {
  const image = findImage(id);
  if (!image) return;
  image.lens = TX.lens.settingsOf({ ...image.lens, ...patch });
  // Lens change dirties every mark on this image.
  for (const mark of marksOfImage(id)) mark.dirty = true;
}

function removeImage(id) {
  const index = state.images.findIndex(i => i.id === id);
  if (index === -1) return;

  for (const mark of marksOfImage(id)) removeMark(mark.id);
  state.images.splice(index, 1);
  pruneSelection();
  if (state.pending.imageId === id) clearPending();

  const asset = assets.sources.get(id);
  if (asset && asset.source && asset.source.texture) asset.source.texture.dispose();
  assets.sources.delete(id);
  setImageDepth(id, null);
}

function addMark(imageId, points, extra) {
  const mark = {
    id: uid(),
    imageId,
    points,
    dirty: true,
    domain: TX.geom.unitDomain(),
    curve: TX.geom.flatCurve(),
    ...extra,
  };
  state.marks.push(mark);
  return mark;
}

function setMarkDomain(id, patch) {
  const mark = findMark(id);
  if (!mark) return;
  mark.domain = TX.geom.domainOf({ ...mark.domain, ...patch });
  mark.dirty = true;
}

function setMarkCurve(id, index, value) {
  const mark = findMark(id);
  if (!mark || index < 0 || index > 3) return;
  const curve = TX.geom.curveOf(mark.curve);
  curve[index] = TX.geom.controlsOf(value);
  mark.curve = curve;
  mark.dirty = true;
}

function setMarkControl(id, index, which, offset) {
  const mark = findMark(id);
  if (!mark || index < 0 || index > 3) return;
  const curve = TX.geom.curveOf(mark.curve);
  curve[index][which ? "b" : "a"] = {
    x: (offset && offset.x) || 0,
    y: (offset && offset.y) || 0,
  };
  mark.curve = curve;
  mark.dirty = true;
}

function resetMarkLocalSpace(id) {
  const mark = findMark(id);
  if (!mark) return;
  mark.domain = TX.geom.unitDomain();
  mark.curve = TX.geom.flatCurve();
  mark.dirty = true;
}

function removeMark(id) {
  const index = state.marks.findIndex(m => m.id === id);
  if (index === -1) return;
  state.marks.splice(index, 1);
  pruneSelection();
  for (const texture of state.textures.filter(t => t.markId === id)) removeTexture(texture.id);
}

function setMarkPoint(id, index, point) {
  const mark = findMark(id);
  if (!mark || !mark.points[index]) return;
  mark.points[index] = point;
  mark.dirty = true;
}

function setMarkDirty(id, dirty) {
  const mark = findMark(id);
  if (mark) mark.dirty = dirty;
}

function addTexture(entry) {
  const texture = {
    id: entry.id || uid(),
    markId: entry.markId || null,
    name: entry.name,
    x: entry.x || 0,
    y: entry.y || 0,
    width: entry.width,
    height: entry.height,
    rotation: entry.rotation || 0,
    scaleX: entry.scaleX == null ? 1 : entry.scaleX,
    scaleY: entry.scaleY == null ? 1 : entry.scaleY,
    tiling: entry.tiling ? { ...TX.tiling.defaults(), ...entry.tiling } : TX.tiling.defaults(),
    delight: TX.delight.settingsOf(entry.delight),
    flip: TX.flip.settingsOf(entry.flip),
  };
  state.textures.push(texture);
  return texture;
}

function setTextureCanvas(id, canvas) {
  const previous = assets.textures.get(id);
  assets.textures.set(id, { canvas, version: (previous ? previous.version : 0) + 1 });
  TX.tiling.invalidate(id);
  TX.delight.invalidate(id);
  TX.flip.invalidate(id);
  state.pixelEpoch++;
}

// Delight before tiling; flip last so welded seam matches feathered edge.
function textureCanvas(id) {
  const texture = findTexture(id);
  const asset = assets.textures.get(id);
  if (!texture || !asset) return null;
  const flattened = TX.delight.resolve(id, asset.canvas, texture.delight, asset.version);
  const lit = TX.delight.keyOf(texture.delight, asset.version);
  const tiled = TX.tiling.resolve(id, flattened, texture.tiling, lit);
  return TX.flip.resolve(id, tiled, texture.flip, TX.tiling.keyOf(texture.tiling, lit));
}

function textureKey(id) {
  const texture = findTexture(id);
  const asset = assets.textures.get(id);
  if (!texture || !asset) return "";
  return TX.flip.keyOf(texture.flip, TX.tiling.keyOf(
    texture.tiling, TX.delight.keyOf(texture.delight, asset.version)));
}

function setImageDepth(imageId, depth) {
  if (depth) assets.depth.set(imageId, depth);
  else if (!assets.depth.delete(imageId)) return;
  state.depthEpoch++;
}

const imageDepth = imageId => assets.depth.get(imageId) || null;

function reliefField(textureId, resolution) {
  const texture = findTexture(textureId);
  const mark = texture ? findMark(texture.markId) : null;
  const image = mark ? findImage(mark.imageId) : null;
  const depth = mark ? imageDepth(mark.imageId) : null;
  if (!depth || !image) return null;

  const n = Math.max(2, Math.round(resolution || 64));
  return TX.depth.heightField({
    depth,
    photo: { width: image.width, height: image.height },
    quad: mark.points,
    domain: mark.domain,
    curve: mark.curve,
    lens: image.lens,
    cols: n,
    rows: n,
  });
}

function reliefFor(textureId, settings) {
  const s = TX.material.settingsOf(settings);
  if (!s.useDepth || !(s.bow > 0)) return null;
  const field = reliefField(textureId, s.subdivision + 1);
  return field ? { field, amount: s.bow, segments: s.subdivision } : null;
}

function setTiling(id, patch) {
  const texture = findTexture(id);
  if (!texture) return;
  texture.tiling = { ...TX.tiling.defaults(), ...texture.tiling, ...patch };
}

function setDelight(id, patch) {
  const texture = findTexture(id);
  if (!texture) return;
  texture.delight = TX.delight.settingsOf({ ...texture.delight, ...patch });
}

function setFlip(id, patch) {
  const texture = findTexture(id);
  if (!texture) return;
  texture.flip = TX.flip.settingsOf({ ...texture.flip, ...patch });
}

function removeTexture(id) {
  const index = state.textures.findIndex(t => t.id === id);
  if (index === -1) return;
  state.textures.splice(index, 1);
  pruneSelection();
  assets.textures.delete(id);
  TX.tiling.invalidate(id);
}

function clearPending() {
  state.pending.imageId = null;
  state.pending.points = [];
}

function reset() {
  for (const image of state.images.slice()) removeImage(image.id);
  for (const texture of state.textures.slice()) removeTexture(texture.id);
  state.images = [];
  state.marks = [];
  state.textures = [];
  clearSelection();
  clearPending();
  TX.tiling.invalidate();
}

function resetAll() {
  reset();
  resetSettings();
  state.viewports = defaultViewports();
  state.camera3d = null;
  state.activePanel = "mark";
}

// structuredClone refuses Vue proxies; copy nested settings explicitly for IndexedDB.
const numberOr = (value, fallback) =>
  (typeof value === "number" && Number.isFinite(value) ? value : fallback);

const pointsOf = points => (Array.isArray(points) ? points : [])
  .filter(p => p && typeof p === "object")
  .map(p => ({ x: numberOr(p.x, 0), y: numberOr(p.y, 0) }));

const viewportOf = viewport => {
  if (!viewport || typeof viewport !== "object") return null;
  const panX = numberOr(viewport.panX, null);
  const panY = numberOr(viewport.panY, null);
  const zoom = numberOr(viewport.zoom, null);
  if (panX === null || panY === null || zoom === null || zoom <= 0) return null;
  return { panX, panY, zoom };
};

const transformOf = node => ({
  id: node.id,
  name: node.name,
  x: numberOr(node.x, 0),
  y: numberOr(node.y, 0),
  rotation: numberOr(node.rotation, 0),
  scaleX: numberOr(node.scaleX, 1),
  scaleY: numberOr(node.scaleY, 1),
});

const plainImage = image => ({
  ...transformOf(image),
  width: numberOr(image.width, 0),
  height: numberOr(image.height, 0),
  lens: TX.lens.settingsOf(image.lens),
});

const plainMark = mark => ({
  id: mark.id,
  imageId: mark.imageId,
  dirty: !!mark.dirty,
  points: pointsOf(mark.points),
  domain: TX.geom.domainOf(mark.domain),
  curve: TX.geom.curveOf(mark.curve),
});

const plainTexture = texture => ({
  ...transformOf(texture),
  markId: texture.markId || null,
  width: numberOr(texture.width, 0),
  height: numberOr(texture.height, 0),
  tiling: { ...TX.tiling.defaults(), ...texture.tiling },
  delight: TX.delight.settingsOf(texture.delight),
  flip: TX.flip.settingsOf(texture.flip),
});

const isGroup = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const plainSettings = () => {
  const out = {};
  for (const [key, value] of Object.entries(state.settings)) {
    out[key] = isGroup(value) ? { ...value } : value;
  }
  return out;
};

// Merge into live group objects; replacing them orphans panel refs (e.g. settings.preview).
function resetSettings() {
  const defaults = defaultSettings();
  for (const [key, value] of Object.entries(defaults)) {
    if (isGroup(value) && isGroup(state.settings[key])) {
      for (const name of Object.keys(state.settings[key])) {
        if (!(name in value)) delete state.settings[key][name];
      }
      Object.assign(state.settings[key], value);
    } else {
      state.settings[key] = value;
    }
  }
}

function applySettings(saved) {
  if (!saved || typeof saved !== "object") return;
  for (const [key, value] of Object.entries(saved)) {
    if (isGroup(state.settings[key])) {
      if (isGroup(value)) Object.assign(state.settings[key], value);
    } else if (!isGroup(value)) {
      state.settings[key] = value;
    }
  }
}

const canvasToBlob = canvas => TX.io.canvasToBlob(canvas);

// Depth stored as raw float bytes, not 8-bit image (relief would terracing).
const depthRecord = imageId => {
  const depth = assets.depth.get(imageId);
  return depth
    ? { blob: new Blob([depth.data]), width: depth.width, height: depth.height }
    : null;
};

async function depthFromRecord(record) {
  if (!record || !(record.blob instanceof Blob)) return null;
  if (!(record.width >= 2) || !(record.height >= 2)) return null;
  const data = new Float32Array(await record.blob.arrayBuffer());
  return data.length === record.width * record.height
    ? { data, width: record.width, height: record.height }
    : null;
}

const encoded = new Map();

async function encodedPixels(textureId, asset) {
  const hit = encoded.get(textureId);
  if (hit && hit.version === asset.version) return hit.blob;
  const blob = await canvasToBlob(asset.canvas);
  // Re-check version after async encode; re-extraction may have landed meanwhile.
  if (asset.version === (assets.textures.get(textureId) || asset).version) {
    encoded.set(textureId, { version: asset.version, blob });
  }
  return blob;
}

async function snapshot() {
  const textures = [];
  for (const texture of state.textures) {
    const asset = assets.textures.get(texture.id);
    if (!asset) continue;
    textures.push({ ...plainTexture(texture), blob: await encodedPixels(texture.id, asset) });
  }
  for (const id of [...encoded.keys()]) {
    if (!assets.textures.has(id)) encoded.delete(id);
  }
  return {
    version: TX.schema.document,
    savedAt: Date.now(),
    images: state.images.map(i => ({
      ...plainImage(i),
      file: i.file || null,
      depth: depthRecord(i.id),
    })),
    marks: state.marks.map(plainMark),
    textures,
    settings: plainSettings(),
    history: await TX.history.persistable(),
  };
}

const decodeBlob = blob => TX.io.decodeBlob(blob);

async function restore(saved) {
  if (!saved || saved.version !== TX.schema.document) return false;

  reset();
  resetSettings();
  applySettings(saved.settings);

  for (const image of saved.images || []) {
    if (!image || !image.id || !(image.file instanceof Blob)) continue;
    try {
      const element = await decodeBlob(image.file);
      assets.sources.set(image.id, { element, source: TX.warp.createSource(element) });
      const { depth, ...rest } = image;
      setImageDepth(image.id, await depthFromRecord(depth));
      state.images.push({
        ...rest,
        ...transformOf(image),
        width: numberOr(image.width, element.naturalWidth),
        height: numberOr(image.height, element.naturalHeight),
      });
    } catch (err) {
    }
  }

  const liveImages = new Set(state.images.map(i => i.id));
  for (const mark of saved.marks || []) {
    if (!mark || !mark.id || !liveImages.has(mark.imageId)) continue;
    const points = pointsOf(mark.points);
    if (points.length !== 4) continue;
    state.marks.push({ ...plainMark(mark), points });
  }

  for (const texture of saved.textures || []) {
    if (!texture || !texture.id || !(texture.blob instanceof Blob)) continue;
    try {
      const element = await decodeBlob(texture.blob);
      const canvas = document.createElement("canvas");
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      canvas.getContext("2d").drawImage(element, 0, 0);
      const { blob, ...rest } = texture;
      setTextureCanvas(texture.id, canvas);
      state.textures.push({
        ...rest,
        ...transformOf(rest),
        markId: rest.markId || null,
        width: canvas.width,
        height: canvas.height,
        tiling: { ...TX.tiling.defaults(), ...rest.tiling },
        delight: TX.delight.settingsOf(rest.delight),
      });
    } catch (err) {
    }
  }

  return true;
}

// Key predates the Texture Harvester rename; changing it would drop the view record.
const VIEW_KEY = "texture-extract:view";

function viewRecord() {
  return {
    savedAt: Date.now(),
    settings: plainSettings(),
    viewports: {
      mark: viewportOf(state.viewports.mark),
      atlas: viewportOf(state.viewports.atlas),
      tiling: viewportOf(state.viewports.tiling),
    },
    camera3d: cameraOf(state.camera3d),
    activePanel: state.activePanel,
    selection: { kind: state.selection.kind, ids: state.selection.ids.slice() },
    pending: { imageId: state.pending.imageId, points: pointsOf(state.pending.points) },
    images: state.images.map(plainImage),
    marks: state.marks.map(plainMark),
    textures: state.textures.map(plainTexture),
  };
}

const saveViewRecord = () => TX.durable.write(VIEW_KEY, TX.schema.view, viewRecord());
const loadViewRecord = () => TX.durable.read(VIEW_KEY, TX.schema.view);
const clearViewRecord = () => TX.durable.remove(VIEW_KEY);

const applyTransform = (node, saved) => {
  node.x = numberOr(saved.x, node.x);
  node.y = numberOr(saved.y, node.y);
  node.rotation = numberOr(saved.rotation, node.rotation);
  node.scaleX = numberOr(saved.scaleX, node.scaleX) || 1;
  node.scaleY = numberOr(saved.scaleY, node.scaleY) || 1;
  if (typeof saved.name === "string" && saved.name) node.name = saved.name;
};

function applyViewRecord(record, documentSavedAt) {
  if (!record || typeof record !== "object") return false;

  applySettings(record.settings);

  const viewports = record.viewports || {};
  state.viewports = {
    mark: viewportOf(viewports.mark),
    atlas: viewportOf(viewports.atlas),
    tiling: viewportOf(viewports.tiling),
  };
  state.camera3d = cameraOf(record.camera3d);
  if (typeof record.activePanel === "string") state.activePanel = record.activePanel;

  const authoritative = (numberOr(record.savedAt, 0)) >= numberOr(documentSavedAt, 0);

  const savedImages = new Map((record.images || []).map(i => [i.id, i]));
  const savedMarks = new Map((record.marks || []).map(m => [m.id, m]));
  const savedTextures = new Map((record.textures || []).map(t => [t.id, t]));

  if (authoritative) {
    for (const image of state.images.slice()) {
      if (!savedImages.has(image.id)) removeImage(image.id);
    }
    for (const mark of state.marks.slice()) {
      if (!savedMarks.has(mark.id)) removeMark(mark.id);
    }
    for (const texture of state.textures.slice()) {
      if (!savedTextures.has(texture.id)) removeTexture(texture.id);
    }
  }

  for (const image of state.images) {
    const saved = savedImages.get(image.id);
    if (!saved) continue;
    applyTransform(image, saved);
    image.lens = TX.lens.settingsOf(saved.lens);
  }

  for (const mark of state.marks) {
    const saved = savedMarks.get(mark.id);
    if (!saved) continue;
    const points = pointsOf(saved.points);
    if (points.length === 4) mark.points = points;
    mark.domain = TX.geom.domainOf(saved.domain);
    mark.curve = TX.geom.curveOf(saved.curve);
    mark.dirty = !!saved.dirty;
  }

  for (const texture of state.textures) {
    const saved = savedTextures.get(texture.id);
    if (!saved) continue;
    applyTransform(texture, saved);
    texture.tiling = { ...TX.tiling.defaults(), ...saved.tiling };
    texture.delight = TX.delight.settingsOf(saved.delight);
    texture.flip = TX.flip.settingsOf(saved.flip);
  }

  const liveImages = new Set(state.images.map(i => i.id));
  const saved = selectionOf(record.selection);
  select(saved.kind, saved.ids);

  const pending = record.pending || {};
  const pendingPoints = pointsOf(pending.points);
  if (pending.imageId && liveImages.has(pending.imageId) && pendingPoints.length < 4) {
    state.pending.imageId = pending.imageId;
    state.pending.points = pendingPoints;
  } else {
    clearPending();
  }

  return true;
}

const VIEW_ONLY_SETTINGS = new Set([
  "preview", "views", "props", "depth", "locale", "loupeSample", "sway",
]);

const documentSettings = () => {
  const out = {};
  for (const [key, value] of Object.entries(state.settings)) {
    if (VIEW_ONLY_SETTINGS.has(key)) continue;
    out[key] = isGroup(value) ? { ...value } : value;
  }
  return out;
};

const bytesOf = canvas => (canvas && canvas.width ? canvas.width * canvas.height * 4 : 0);

function usage() {
  let imageBytes = 0;
  for (const image of state.images) {
    const asset = assets.sources.get(image.id);
    if (asset) imageBytes += bytesOf(asset.element);
  }

  let textureBytes = 0;
  const kinds = new Set();
  for (const node of state.textures) {
    const asset = assets.textures.get(node.id);
    if (!asset) continue;
    textureBytes += bytesOf(asset.canvas);
    const shown = textureCanvas(node.id);
    if (shown && shown !== asset.canvas) textureBytes += bytesOf(shown);
    for (const { slot, canvas } of TX.material.held(node.id)) {
      textureBytes += bytesOf(canvas);
      kinds.add(`${node.id}:${slot}`);
    }
  }

  return {
    images: { count: state.images.length, bytes: imageBytes },
    marks: { count: state.marks.length },
    textures: { count: state.textures.length, maps: kinds.size, bytes: textureBytes },
    bytes: imageBytes + textureBytes,
  };
}

function documentSnapshot() {
  const sources = new Map();
  for (const image of state.images) {
    const asset = assets.sources.get(image.id);
    if (asset) {
      sources.set(image.id, {
        element: asset.element,
        file: image.file || null,
        depth: assets.depth.get(image.id) || null,
      });
    }
  }

  const pixels = new Map();
  for (const texture of state.textures) {
    const asset = assets.textures.get(texture.id);
    if (asset) pixels.set(texture.id, asset);
  }

  return {
    images: state.images.map(plainImage),
    marks: state.marks.map(plainMark),
    textures: state.textures.map(plainTexture),
    settings: documentSettings(),
    selection: { kind: state.selection.kind, ids: state.selection.ids.slice() },
    pending: { imageId: state.pending.imageId, points: pointsOf(state.pending.points) },
    sources,
    pixels,
  };
}

function applyDocumentSnapshot(snap) {
  if (!snap || typeof snap !== "object") return false;

  applySettings(snap.settings);

  const wantImages = new Map(snap.images.map(i => [i.id, i]));
  const wantMarks = new Map(snap.marks.map(m => [m.id, m]));
  const wantTextures = new Map(snap.textures.map(t => [t.id, t]));

  for (const image of state.images.slice()) {
    if (!wantImages.has(image.id)) removeImage(image.id);
  }
  for (const mark of state.marks.slice()) {
    if (!wantMarks.has(mark.id)) removeMark(mark.id);
  }
  for (const texture of state.textures.slice()) {
    if (!wantTextures.has(texture.id)) removeTexture(texture.id);
  }

  for (const saved of snap.images) {
    if (findImage(saved.id)) continue;
    const held = snap.sources.get(saved.id);
    if (!held || !held.element) continue;
    assets.sources.set(saved.id, {
      element: held.element,
      source: TX.warp.createSource(held.element),
    });
    addImage({ ...saved, file: held.file });
    setImageDepth(saved.id, held.depth || null);
  }

  for (const saved of snap.marks) {
    if (findMark(saved.id) || !findImage(saved.imageId)) continue;
    addMark(saved.imageId, pointsOf(saved.points), {
      id: saved.id,
      dirty: !!saved.dirty,
      domain: TX.geom.domainOf(saved.domain),
      curve: TX.geom.curveOf(saved.curve),
    });
  }

  for (const saved of snap.textures) {
    if (findTexture(saved.id)) continue;
    const held = snap.pixels.get(saved.id);
    if (!held) continue;
    addTexture({ ...saved });
    setTextureCanvas(saved.id, held.canvas);
  }

  for (const image of state.images) {
    const saved = wantImages.get(image.id);
    if (!saved) continue;
    applyTransform(image, saved);
    image.width = numberOr(saved.width, image.width);
    image.height = numberOr(saved.height, image.height);
    image.lens = TX.lens.settingsOf(saved.lens);
  }

  for (const mark of state.marks) {
    const saved = wantMarks.get(mark.id);
    if (!saved) continue;
    const points = pointsOf(saved.points);
    if (points.length === 4) mark.points = points;
    mark.domain = TX.geom.domainOf(saved.domain);
    mark.curve = TX.geom.curveOf(saved.curve);
    mark.dirty = !!saved.dirty;
  }

  for (const texture of state.textures) {
    const saved = wantTextures.get(texture.id);
    if (!saved) continue;
    applyTransform(texture, saved);
    texture.width = numberOr(saved.width, texture.width);
    texture.height = numberOr(saved.height, texture.height);
    texture.tiling = { ...TX.tiling.defaults(), ...saved.tiling };
    texture.delight = TX.delight.settingsOf(saved.delight);
    texture.flip = TX.flip.settingsOf(saved.flip);
    const held = snap.pixels.get(texture.id);
    const live = assets.textures.get(texture.id);
    if (held && live && live.canvas !== held.canvas) setTextureCanvas(texture.id, held.canvas);
  }

  const images = snap.images.map(s => findImage(s.id)).filter(Boolean);
  const marks = snap.marks.map(s => findMark(s.id)).filter(Boolean);
  const textures = snap.textures.map(s => findTexture(s.id)).filter(Boolean);
  state.images = images;
  state.marks = marks;
  state.textures = textures;

  const liveImages = new Set(images.map(i => i.id));
  const restored = selectionOf(snap.selection);
  select(restored.kind, restored.ids);

  const pending = snap.pending || {};
  if (pending.imageId && liveImages.has(pending.imageId)) {
    state.pending.imageId = pending.imageId;
    state.pending.points = pointsOf(pending.points);
  } else {
    clearPending();
  }

  return true;
}

let saveTimer = null;
let pixelTimer = null;
let inFlight = null;
let queued = null;

async function writeDocument() {
  try {
    await TX.persist.save(await snapshot());
  } catch (err) {
  }
}

function flush() {
  if (!inFlight) {
    inFlight = writeDocument().finally(() => { inFlight = null; });
    return inFlight;
  }
  if (!queued) {
    queued = inFlight.then(() => {
      queued = null;
      return flush();
    });
  }
  return queued;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 700);
}

function schedulePixelSave() {
  clearTimeout(pixelTimer);
  pixelTimer = setTimeout(flush, 250);
}

const pixelSignature = () => [
  state.images.map(i => i.id).join(","),
  state.textures.map(t => {
    const asset = assets.textures.get(t.id);
    return `${t.id}:${asset ? asset.version : 0}`;
  }).join(","),
  `depth:${state.depthEpoch}`,
].join("|");

function watchForSave() {
  const record = TX.durable.throttled(saveViewRecord, 200);

  watch(
    () => [
      state.images, state.marks, state.textures, state.settings,
      state.selection, state.pending,
      state.viewports, state.camera3d, state.activePanel,
    ],
    () => record.poke(),
    { deep: true },
  );

  watch(pixelSignature, () => schedulePixelSave());

  watch(
    () => [state.images, state.marks, state.textures, state.settings],
    scheduleSave,
    { deep: true },
  );

  TX.durable.onFlush(() => {
    clearTimeout(saveTimer);
    clearTimeout(pixelTimer);
    flush();
  });

  return record;
}

TX.store = {
  state,
  assets,
  usage,
  uid,
  findImage,
  findMark,
  findTexture,
  marksOfImage,
  KINDS,
  selectedKind,
  selectedIds,
  isSelected,
  selectionCount,
  soleSelected,
  selectedItems,
  select,
  toggleSelected,
  clearSelection,
  selectAllOf,
  pruneSelection,
  selectionOf,
  addImage,
  removeImage,
  addMark,
  removeMark,
  setMarkPoint,
  setMarkDirty,
  setMarkDomain,
  setMarkCurve,
  setMarkControl,
  resetMarkLocalSpace,
  addTexture,
  setTextureCanvas,
  textureCanvas,
  textureKey,
  setImageDepth,
  imageDepth,
  reliefField,
  reliefFor,
  setTiling,
  setDelight,
  setFlip,
  setLens,
  removeTexture,
  clearPending,
  setViewport,
  setCamera3d,
  cameraOf,
  reset,
  resetAll,
  snapshot,
  restore,
  viewRecord,
  documentSnapshot,
  applyDocumentSnapshot,
  saveViewRecord,
  loadViewRecord,
  clearViewRecord,
  applyViewRecord,
  scheduleSave,
  flush,
  watchForSave,
  defaultSettings,
};
