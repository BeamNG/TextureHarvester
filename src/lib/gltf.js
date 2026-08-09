
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { TX } from "../tx.js";

const upload = (source, colour) => {
  const texture = new THREE.CanvasTexture(source);
  // Default flipY — GLTFExporter bakes the flip into the file.
  texture.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
};

function buildScene(textureId) {
  const store = TX.store;
  const node = store.findTexture(textureId);
  const asset = store.assets.textures.get(textureId);
  const albedo = store.textureCanvas(textureId);
  if (!node || !asset || !albedo) return null;

  const settings = TX.material.settingsOf(store.state.settings.material);
  const derived = TX.material.maps(
    textureId, albedo, asset.canvas, node.delight, settings, asset.version, { maxSide: 0 });

  const material = new THREE.MeshStandardMaterial({
    name: TX.io.safeFilename(node.name, "texture"),
    color: 0xffffff,
    roughness: derived && derived.roughness ? 1 : settings.roughness,
    metalness: settings.metalness,
    side: THREE.DoubleSide,
    map: upload(albedo, true),
  });
  if (derived && derived.normal) material.normalMap = upload(derived.normal, false);
  if (derived && derived.occlusion) material.aoMap = upload(derived.occlusion, false);
  if (derived && derived.roughness) material.roughnessMap = upload(derived.roughness, false);

  const geometry = TX.material.withAoUvs(TX.material.geometryFor(
    settings.shape, albedo.width, albedo.height,
    store.reliefFor(textureId, settings), node.rotation));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = TX.io.safeFilename(node.name, "texture");

  const scene = new THREE.Scene();
  scene.name = mesh.name;
  scene.add(mesh);
  scene.add(...TX.material.studioRig());

  return {
    scene,
    mesh,
    material,
    shape: settings.shape,
    dispose() {
      geometry.dispose();
      for (const slot of ["map", "normalMap", "aoMap", "roughnessMap"]) {
        if (material[slot]) material[slot].dispose();
      }
      material.dispose();
    },
  };
}

async function textureToGlb(textureId) {
  return writeGlb(buildScene(textureId));
}

const SCENE_TEXTURE_MAX = 2048;

function fittedCanvas(element, limit) {
  const width = element.naturalWidth || element.width;
  const height = element.naturalHeight || element.height;
  if (!(width > 0) || !(height > 0)) return null;

  const scale = Math.min(1, limit / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d").drawImage(element, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function buildPhotoScene(imageId) {
  const store = TX.store;
  const image = store.findImage(imageId);
  const depth = store.imageDepth(imageId);
  const asset = store.assets.sources.get(imageId);
  if (!image || !depth || !asset || !asset.element) return null;

  const settings = TX.depthScene.settingsOf(store.state.settings.depth);
  const geometry = TX.depthScene.build(depth, settings);
  if (!geometry) return null;

  const fitted = fittedCanvas(asset.element, SCENE_TEXTURE_MAX);
  const name = TX.io.safeFilename(image.name, "scene");
  const material = new THREE.MeshBasicMaterial({
    name,
    color: 0xffffff,
    side: THREE.DoubleSide,
    map: fitted ? upload(fitted, true) : null,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  const scene = new THREE.Scene();
  scene.name = name;
  scene.add(mesh);

  return {
    scene,
    mesh,
    material,
    triangles: geometry.userData.triangles,
    dispose() {
      geometry.dispose();
      if (material.map) material.map.dispose();
      material.dispose();
    },
  };
}

const photoToGlb = imageId => writeGlb(buildPhotoScene(imageId));

async function writeGlb(built) {
  if (!built) return null;
  try {
    const exporter = new GLTFExporter();
    const buffer = await exporter.parseAsync(built.scene, { binary: true });
    return buffer instanceof ArrayBuffer ? buffer : null;
  } finally {
    built.dispose();
  }
}


const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN"

function readGlb(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;

  const version = view.getUint32(4, true);
  const total = view.getUint32(8, true);
  if (total !== buffer.byteLength) return null;

  let offset = 12;
  let json = null;
  let binary = 0;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > buffer.byteLength) return null;
    if (type === CHUNK_JSON) {
      const text = new TextDecoder().decode(new Uint8Array(buffer, start, length));
      try {
        json = JSON.parse(text);
      } catch (err) {
        return null;
      }
    } else if (type === CHUNK_BIN) {
      binary = length;
    }
    offset = start + length + (4 - (length % 4)) % 4;
  }

  return json ? { version, json, binary, bytes: buffer.byteLength } : null;
}

TX.gltf = {
  SCENE_TEXTURE_MAX,
  buildScene,
  buildPhotoScene,
  textureToGlb,
  photoToGlb,
  readGlb,
};

