
import * as THREE from "three";
import { watch } from "vue";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { TX } from "../tx.js";


const STUDIO_FOV = 38;

const CLOSEST = 0.4;

const FARTHEST = 8;

const SWAY_YAW = 0.16;
const SWAY_PITCH = 0.05;
const SWAY_YAW_PERIOD = 11;
const SWAY_PITCH_PERIOD = 7;

function isSupported() {
  if (!TX.warp.isSupported()) return false;
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2", { failIfMajorPerformanceCaveat: false });
    return !!gl;
  } catch (err) {
    return false;
  }
}

function createPreview3d(container) {
  const store = TX.store;
  const state = store.state;

  const canvas = document.createElement("canvas");
  canvas.className = "tx-3d-canvas";
  container.appendChild(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (err) {
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    return null;
  }
  if (!renderer.getContext()) {
    renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    return null;
  }
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(STUDIO_FOV, 1, 0.01, 100);
  camera.position.set(0.9, 0.7, 1.5);

  scene.add(...TX.material.studioRig());

  let environment = null;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    pmrem.dispose();
  } catch (err) {
// Software WebGL can refuse the float render targets this needs. The directional
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.65,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  let geometry = TX.material.withAoUvs(TX.material.geometryFor("plane", 1, 1));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  scene.add(mesh);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = CLOSEST;
  controls.maxDistance = FARTHEST;
  controls.target.set(0, 0, 0);

  let needsRender = true;
  let disposed = false;
  let frame = 0;
  let moving = false;
  const requestRender = () => { needsRender = true; };
  controls.addEventListener("change", () => {
    moving = true;
    requestRender();
  });

  const storeCamera = () => store.setCamera3d({
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [controls.target.x, controls.target.y, controls.target.z],
  });

  function restoreCamera() {
    const saved = TX.store.cameraOf(state.camera3d);
    if (!saved) return false;
    camera.position.set(...saved.position);
    controls.target.set(...saved.target);
    controls.update();
    return true;
  }

  let restored = restoreCamera();

  const sceneMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  const sceneNormals = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  let sceneGeometry = new THREE.BufferGeometry();
  const sceneMesh = new THREE.Mesh(sceneGeometry, sceneMaterial);
  sceneMesh.visible = false;
  scene.add(sceneMesh);

  const textures = { map: null, normalMap: null, aoMap: null, roughnessMap: null };
  let currentKey = "";
  let currentMesh = "";
  let sceneTexture = null;
  let sceneKey = "";
  let sceneSubject = "";

  function upload(source, colour) {
    const texture = new THREE.CanvasTexture(source);
// Left at the three.js default so the exporter bakes the flip into the file it writes.
    texture.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    return texture;
  }

  function clearTextures() {
    for (const slot of Object.keys(textures)) {
      if (textures[slot]) textures[slot].dispose();
      textures[slot] = null;
      material[slot] = null;
    }
  }

  const selected = () => store.soleSelected("texture");

  const selectedImage = () => {
    const image = store.soleSelected("image");
    if (image) return image;
    const mark = store.soleSelected("mark");
    return mark ? store.findImage(mark.imageId) : null;
  };

  function hideScene() {
    sceneMesh.visible = false;
    sceneKey = "";
    state.sceneStats = null;
  }

  function refreshScene(force) {
    const image = selectedImage();
    const depth = image ? store.imageDepth(image.id) : null;
    const asset = image ? store.assets.sources.get(image.id) : null;
    if (!depth || !asset || !asset.element) {
      hideScene();
      requestRender();
      return false;
    }

    const settings = TX.depthScene.settingsOf(state.settings.depth);
    const wanted = `${image.id}:${state.depthEpoch}:${TX.depthScene.keyOf(settings)}`;
    const subjectChanged = image.id !== sceneSubject;

    if (force || wanted !== sceneKey) {
      const next = TX.depthScene.build(depth, settings);
      if (!next) {
        hideScene();
        requestRender();
        return false;
      }
      sceneKey = wanted;
      sceneMesh.geometry = next;
      sceneGeometry.dispose();
      sceneGeometry = next;
      state.sceneStats = { ...next.userData };

      if (subjectChanged || !sceneTexture) {
        if (sceneTexture) sceneTexture.dispose();
        sceneTexture = upload(asset.element, true);
        sceneMaterial.map = sceneTexture;
        sceneMaterial.needsUpdate = true;
        sceneSubject = image.id;
      }
    }

    if (settings.display === "normals") {
      sceneMesh.material = sceneNormals;
    } else {
      sceneMaterial.wireframe = settings.display === "wireframe";
      sceneMaterial.map = settings.display === "wireframe" ? null : sceneTexture;
      sceneMaterial.needsUpdate = true;
      sceneMesh.material = sceneMaterial;
    }

    sceneMesh.visible = true;
    requestRender();
    return subjectChanged || force;
  }

  function refresh(force) {
    const node = selected();
    if (!node) {
      mesh.visible = false;
      currentKey = "";
      currentMesh = "";
      clearTextures();
      return refreshScene(force);
    }
    hideScene();

    const asset = store.assets.textures.get(node.id);
    const albedo = store.textureCanvas(node.id);
    if (!asset || !albedo) {
      mesh.visible = false;
      requestRender();
      return false;
    }

    const settings = TX.material.settingsOf(state.settings.material);
    const pixelKey = store.textureKey(node.id);
    const overlayMode = TX.viewOverlay.modeOf();
    const wanted = `${node.id}:${TX.material.keyOf(settings, pixelKey)}:${overlayMode}`;

    if (force || wanted !== currentKey) {
      currentKey = wanted;
      clearTextures();
      const derived = TX.material.maps(
        node.id, albedo, asset.canvas, node.delight, settings, asset.version);

      const shown = TX.viewOverlay.surfaceFor(node, overlayMode);
      const surface = shown || albedo;
      const wantedSide = Math.max(canvas.clientWidth, canvas.clientHeight) || 512;
      textures.map = upload(
        TX.display.canvasAt(surface, TX.display.levelFor(surface, wantedSide)), !shown);
      material.map = textures.map;
      material.emissive = new THREE.Color(shown ? 0xffffff : 0x000000);
      material.emissiveMap = shown ? textures.map : null;
      material.emissiveIntensity = shown ? 1 : 0;
      if (derived && derived.normal) {
        textures.normalMap = upload(derived.normal, false);
        material.normalMap = textures.normalMap;
      }
      if (derived && derived.occlusion) {
        textures.aoMap = upload(derived.occlusion, false);
        material.aoMap = textures.aoMap;
      }
      if (derived && derived.roughness) {
        textures.roughnessMap = upload(derived.roughness, false);
        material.roughnessMap = textures.roughnessMap;
      }
      material.needsUpdate = true;
    }

    const rotation = Number.isFinite(node.rotation) ? node.rotation : 0;
    const meshKey = `${node.id}:${settings.shape}:${albedo.width}x${albedo.height}`
      + `@${rotation.toFixed(4)}:${settings.useDepth ? settings.bow : "flat"}`
      + `:${settings.subdivision}:${state.depthEpoch}`;
    const rebuilt = meshKey !== currentMesh || force;
    if (rebuilt) {
      currentMesh = meshKey;
      const next = TX.material.withAoUvs(TX.material.geometryFor(
        settings.shape, albedo.width, albedo.height,
        store.reliefFor(node.id, settings), rotation));
      mesh.geometry = next;
      geometry.dispose();
      geometry = next;
    }

    // glTF multiplies roughness by the map — factor must be 1 when a map is set.
    material.roughness = material.roughnessMap ? 1 : settings.roughness;
    material.metalness = settings.metalness;
    mesh.visible = true;
    requestRender();
    return rebuilt;
  }

  const FRAME_MARGIN = 1.06;

  function photoFov(fov) {
    const half = degrees => Math.tan((degrees * Math.PI) / 360);
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    const wanted = Math.max(half(fov.vertical), half(fov.horizontal) / aspect) * FRAME_MARGIN;
    return THREE.MathUtils.clamp((Math.atan(wanted) * 360) / Math.PI, 10, 150);
  }

  function fit() {
    resize();

    const subject = sceneMesh.visible ? sceneMesh : mesh;
    subject.geometry.computeBoundingSphere();
    const sphere = subject.geometry.boundingSphere;
    const radius = sphere && sphere.radius > 0 ? sphere.radius : TX.material.UNIT;
    const taken = sceneMesh.visible ? subject.geometry.userData : null;

    if (taken && taken.viewpoint && taken.fov) {
      camera.fov = photoFov(taken.fov);
      camera.position.set(taken.viewpoint.x, taken.viewpoint.y, taken.viewpoint.z);
      controls.minDistance = Math.min(CLOSEST, camera.position.length() * 0.5);
    } else {
      camera.fov = STUDIO_FOV;
      controls.minDistance = CLOSEST;
      const half = THREE.MathUtils.degToRad(camera.fov) / 2;
      const aspect = camera.aspect > 0 ? camera.aspect : 1;
      const narrowest = Math.min(half, Math.atan(Math.tan(half) * aspect));
      const distance = radius / Math.sin(narrowest) * 1.5;
      const direction = new THREE.Vector3(0.55, 0.42, 0.95).normalize();
      camera.position.copy(direction.multiplyScalar(distance));
    }

    controls.maxDistance = Math.max(FARTHEST, camera.position.length());
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
    requestRender();
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setPixelRatio(TX.device.pixelRatio());
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }

  const onScreen = () => (canvas.checkVisibility ? canvas.checkVisibility() : true);

  let swaying = false;
  function sway(now) {
    if (!state.settings.sway || !mesh.visible || !onScreen()) {
      if (swaying) {
        swaying = false;
        mesh.rotation.set(0, 0, 0);
        requestRender();
      }
      return;
    }
    swaying = true;
    const t = (now || 0) / 1000;
    mesh.rotation.y = Math.sin((t * 2 * Math.PI) / SWAY_YAW_PERIOD) * SWAY_YAW;
    mesh.rotation.x = Math.sin((t * 2 * Math.PI) / SWAY_PITCH_PERIOD) * SWAY_PITCH;
    requestRender();
  }

  function tick(now) {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    sway(now);
    const stillMoving = controls.update();
    if (moving && !stillMoving) {
      moving = false;
      storeCamera();
    }
    if (!needsRender) return;
    needsRender = false;
    renderer.render(scene, camera);
  }

  let onLost = null;
  let stopWatch = null;

  const onContextLost = event => {
    event.preventDefault();
    if (disposed) return;
    if (onLost) onLost();
  };
  canvas.addEventListener("webglcontextlost", onContextLost, false);

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const stopDisplay = TX.device.onDisplayChange(resize);
  resize();
  frame = requestAnimationFrame(tick);

  stopWatch = watch(
    () => {
      const node = selected();
      const pixels = node ? `${node.id}:${store.textureKey(node.id)}` : "none";
      const placed = node ? String(node.rotation) : "none";
      const material = JSON.stringify(TX.material.settingsOf(state.settings.material));
      const image = node ? null : selectedImage();
      const photo = image ? image.id : "none";
      const depth = JSON.stringify(TX.depthScene.settingsOf(state.settings.depth));
      return `${pixels}|${placed}|${material}|${state.depthEpoch}|${photo}|${depth}`
        + `|${state.settings.views.mode}`;
    },
    () => {
      const had = mesh.visible || sceneMesh.visible;
      const rebuilt = refresh(false);
      if ((mesh.visible || sceneMesh.visible) && (!had || rebuilt)) {
        if (restored) restored = false;
        else fit();
      }
    },
    { immediate: true },
  );

  return {
    renderer,
    scene,
    camera,
    controls,
    mesh,
    material,
    sceneMesh,
    sceneMaterial,
    refresh,
    fit,
    sway,
    set onLost(fn) { onLost = fn; },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      if (stopWatch) stopWatch();
      observer.disconnect();
      if (stopDisplay) stopDisplay();
      controls.dispose();
      clearTextures();
      if (sceneTexture) sceneTexture.dispose();
      sceneMaterial.dispose();
      sceneNormals.dispose();
      sceneGeometry.dispose();
      material.dispose();
      geometry.dispose();
      if (environment) environment.dispose();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}

TX.preview3d = { createPreview3d, isSupported };

