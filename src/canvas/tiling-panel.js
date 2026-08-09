
import * as THREE from "three";
import { watch } from "vue";
import { TX } from "../tx.js";

const COLORS = {
  seam: "rgba(255, 112, 67, 0.85)",
  bounds: "rgba(79, 195, 247, 0.55)",
  source: "rgba(124, 217, 146, 0.9)",
  label: "rgba(255,255,255,0.7)",
  empty: "rgba(255,255,255,0.35)",
};

function createTilingPanel(container, hooks) {
  const store = TX.store;
  const state = store.state;
  let drag = null;
  const stage = TX.stage.createStage(container, {
    onViewChange: view_ => {
      refresh(false);
      const onView = (hooks || {}).onViewChange;
      if (onView) onView(view_);
    },
    onPinchStart: () => { drag = null; },
  });

  const geometry = TX.stage.makeQuadGeometry();
  const material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  stage.scene.add(mesh);

  let texture = null;
  let currentKey = "";
  let tileWidth = 1;
  let tileHeight = 1;

  const view = () => state.settings.preview;

  const selectedTexture = () => store.soleSelected("texture");

  const offsetOf = count => Math.floor((Math.max(1, count) - 1) / 2);

  function bounds() {
    const options = view();
    const left = -offsetOf(options.cols) * tileWidth;
    const top = -offsetOf(options.rows) * tileHeight;
    return {
      minX: left,
      minY: top,
      maxX: left + tileWidth * options.cols,
      maxY: top + tileHeight * options.rows,
    };
  }

  function refresh(force) {
    const node = selectedTexture();
    if (!node) {
      mesh.visible = false;
      currentKey = "";
      stage.requestRender();
      return;
    }

    const asset = store.assets.textures.get(node.id);
    if (!asset) {
      mesh.visible = false;
      stage.requestRender();
      return;
    }

    const options = view();
    const source = store.textureCanvas(node.id) || asset.canvas;
    const onScreen = Math.max(source.width, source.height) * stage.view.zoom;
    const level = TX.display.levelFor(source, onScreen);
    const key = `${node.id}:${store.textureKey(node.id)}:${options.wrap}:${level}`;

    if (force || key !== currentKey) {
      currentKey = key;
      if (texture) texture.dispose();
      texture = new THREE.CanvasTexture(TX.display.canvasAt(source, level));
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = stage.renderer.capabilities.getMaxAnisotropy();
      const wrap = options.wrap === "mirror" ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
      texture.wrapS = wrap;
      texture.wrapT = wrap;
      material.map = texture;
      material.needsUpdate = true;
      tileWidth = source.width;
      tileHeight = source.height;
    }

    texture.repeat.set(options.cols, options.rows);
    texture.offset.set(-offsetOf(options.cols), -offsetOf(options.rows));

    const box = bounds();
    mesh.visible = true;
    mesh.position.set((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, 0);
    mesh.scale.set(box.maxX - box.minX, box.maxY - box.minY, 1);
    stage.requestRender();
  }

  function paint() {
    const ctx = stage.ctx;
    const node = selectedTexture();

    if (!node || !mesh.visible) {
      stage.useScreenTransform();
      ctx.fillStyle = COLORS.empty;
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const message = store.selectionCount("texture") > 1
        ? TX.t("tiling.empty.one")
        : TX.t("tiling.empty.none");
      ctx.fillText(message, stage.view.width / 2, stage.view.height / 2);
      ctx.textAlign = "start";
      return;
    }

    const options = view();
    stage.useScreenTransform();

    TX.viewOverlay.paintTile(stage, tileWidth, tileHeight);

    const box = bounds();

    if (options.showSeams) {
      ctx.strokeStyle = COLORS.seam;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (let c = 1; c < options.cols; c++) {
        const x = Math.round(stage.worldToScreen(box.minX + c * tileWidth, 0).x) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, stage.view.height);
      }
      for (let r = 1; r < options.rows; r++) {
        const y = Math.round(stage.worldToScreen(0, box.minY + r * tileHeight).y) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(stage.view.width, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const a = stage.worldToScreen(box.minX, box.minY);
    const b = stage.worldToScreen(box.maxX, box.maxY);
    ctx.strokeStyle = COLORS.bounds;
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);

    if (options.cols > 1 || options.rows > 1) {
      const from = stage.worldToScreen(0, 0);
      const to = stage.worldToScreen(tileWidth, tileHeight);
      ctx.strokeStyle = COLORS.source;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        Math.round(from.x) + 0.5, Math.round(from.y) + 0.5,
        Math.round(to.x - from.x), Math.round(to.y - from.y),
      );
    }

    ctx.fillStyle = COLORS.label;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textBaseline = "bottom";
    const tiling = node.tiling || TX.tiling.defaults();
    const seam = tiling.mode === "none" ? "raw" : `${tiling.mode} ${TX.tiling.axisOf(tiling)}`;
    ctx.fillText(`${tileWidth} x ${tileHeight}  ·  ${seam}  ·  ${options.wrap}`, a.x, a.y - 4);
  }

  function fit() {
    stage.fitTo(bounds(), 24);
  }

  let skipAutoFit = false;

  stage.overlay.addEventListener("pointerdown", event => {
    if (stage.isPinching()) return;
    if (event.button !== 0 && event.button !== 1) return;
    drag = { last: stage.pointerPosition(event) };
    try {
      stage.overlay.setPointerCapture(event.pointerId);
    } catch (err) {
    }
    event.preventDefault();
  });
  stage.overlay.addEventListener("pointermove", event => {
    if (stage.isPinching()) {
      drag = null;
      return;
    }
    if (!drag) return;
    const at = stage.pointerPosition(event);
    stage.panBy(at.x - drag.last.x, at.y - drag.last.y);
    drag.last = at;
  });
  const endDrag = () => { drag = null; };
  stage.overlay.addEventListener("pointerup", endDrag);
  stage.overlay.addEventListener("pointercancel", endDrag);
  stage.overlay.addEventListener("wheel", event => {
    event.preventDefault();
    stage.setZoom(stage.view.zoom * Math.exp(-event.deltaY * 0.0015), stage.pointerPosition(event));
  }, { passive: false });
  stage.overlay.addEventListener("dblclick", fit);

  stage.setOverlayPainter(paint);

  const stopWatch = watch(
    () => {
      const node = selectedTexture();
      const options = view();
      const source = node ? `${node.id}:${store.textureKey(node.id)}` : "none";
      return `${source}|${options.cols}x${options.rows}|${options.wrap}|${options.showSeams}`;
    },
    (next, previous) => {
      const had = mesh.visible;
      const wrapChanged = !previous || String(previous).split("|")[2] !== view().wrap;
      refresh(wrapChanged);
      if (!had && mesh.visible) {
        if (skipAutoFit) skipAutoFit = false;
        else fit();
      }
    },
    { immediate: true },
  );

  return {
    stage,
    get view() { return view(); },
    refresh,
    fit,
    skipAutoFitOnce() { skipAutoFit = true; },
    dispose() {
      stopWatch();
      if (texture) texture.dispose();
      material.dispose();
      geometry.dispose();
      stage.dispose();
    },
  };
}

TX.tilingPanel = { createTilingPanel };

