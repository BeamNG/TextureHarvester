
import * as THREE from "three";
import { watch } from "vue";
import { TX } from "../tx.js";

const { snapTo, nodeCorners, nodeCenter, nodeBounds, unionBounds, hitTestNode, makeQuadGeometry } = TX.stage;

const HANDLE_SIZE = 8;
const HANDLE_GRAB = 11;
const ROTATE_OFFSET = 26;
const MIN_SCALE = 0.02;
const UNSELECTED_ALPHA = 0.45;

const COLORS = {
  grid: "rgba(255,255,255,0.06)",
  axis: "rgba(255,255,255,0.16)",
  outline: "rgba(255,255,255,0.18)",
  selected: "#4fc3f7",
  handleFill: "#ffffff",
  handleStroke: "#1d1d1d",
  bounds: "rgba(79,195,247,0.5)",
  label: "rgba(255,255,255,0.7)",
  local: "#7cd992",
  localFill: "rgba(124,217,146,0.10)",
  snap: "rgba(255,193,84,0.85)",
};

const HANDLE_DIRS = [
  { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 },
  { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
];

const CURSORS = ["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize", "ns-resize", "ew-resize", "ns-resize", "ew-resize"];

const rotate = (x, y, angle) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
};

function createAtlasCanvas(container, hooks) {
  const store = TX.store;
  const state = store.state;
  let drag = null;
  let pendingFit = null;
  const stage = TX.stage.createStage(container, {
    onViewChange: view => {
      syncDetail();
      if (hooks.onViewChange) hooks.onViewChange(view);
    },
    onPinchStart: () => { drag = null; marquee = null; },
    onResize: () => {
      if (!pendingFit || !atlasOnScreen()) return;
      if (flushFit(pendingFit)) pendingFit = null;
    },
  });
  const geometry = makeQuadGeometry();
  const meshes = new Map();

  stage.view.panX = 256;
  stage.view.panY = 256;

  const screenSizeOf = texture => Math.max(
    texture.width * Math.abs(texture.scaleX),
    texture.height * Math.abs(texture.scaleY),
  ) * stage.view.zoom;

  function uploadFor(texture, surface) {
    return TX.display.forScreen(surface, screenSizeOf(texture));
  }

  // texStorage2D is immutable — rebuild the texture when size/level changes.
  function makeMap(canvas) {
    const map = new THREE.CanvasTexture(canvas);
    map.flipY = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    return map;
  }

  function applySurface(mesh, surface, upload) {
    const prev = mesh.material.map;
    const next = upload.canvas;
    if (prev.image && prev.image.width === next.width && prev.image.height === next.height) {
      prev.image = next;
      prev.needsUpdate = true;
    } else {
      prev.dispose();
      mesh.material.map = makeMap(next);
      mesh.material.needsUpdate = true;
    }
    mesh.userData.surface = surface;
    mesh.userData.level = upload.level;
  }

  function syncMeshes() {
    const seen = new Set();

    state.textures.forEach((texture, index) => {
      seen.add(texture.id);
      const asset = store.assets.textures.get(texture.id);
      if (!asset) return;
      const surface = store.textureCanvas(texture.id) || asset.canvas;

      let mesh = meshes.get(texture.id);
      if (!mesh) {
        const upload = uploadFor(texture, surface);
        mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
          map: makeMap(upload.canvas),
          transparent: true,
          side: THREE.DoubleSide,
          toneMapped: false,
        }));
        mesh.userData.textureId = texture.id;
        mesh.userData.surface = surface;
        mesh.userData.level = upload.level;
        meshes.set(texture.id, mesh);
        stage.scene.add(mesh);
      } else if (mesh.userData.surface !== surface) {
        applySurface(mesh, surface, uploadFor(texture, surface));
      }

      const center = nodeCenter(texture);
      mesh.position.set(center.x, center.y, index * 0.001);
      mesh.rotation.z = texture.rotation;
      mesh.scale.set(texture.width * texture.scaleX, texture.height * texture.scaleY, 1);
    });

    for (const [id, mesh] of meshes) {
      if (seen.has(id)) continue;
      stage.scene.remove(mesh);
      mesh.material.map.dispose();
      mesh.material.dispose();
      meshes.delete(id);
    }

    syncFade();
    stage.requestRender();
  }

  function syncFade() {
    const anySelected = store.selectionCount("texture") > 0;
    for (const [id, mesh] of meshes) {
      const wanted = !anySelected || store.isSelected("texture", id) ? 1 : UNSELECTED_ALPHA;
      mesh.material.opacity = wanted;
    }
  }

  function refreshTexture(id) {
    const mesh = meshes.get(id);
    const surface = store.textureCanvas(id);
    const texture = store.findTexture(id);
    if (mesh && surface && texture) applySurface(mesh, surface, uploadFor(texture, surface));
    stage.requestRender();
  }

  function syncDetail() {
    let changed = false;
    for (const [id, mesh] of meshes) {
      const texture = store.findTexture(id);
      const surface = mesh.userData.surface;
      if (!texture || !surface) continue;
      const wanted = TX.display.levelFor(surface, screenSizeOf(texture));
      if (!TX.display.shouldReupload(mesh.userData.level, wanted)) continue;
      applySurface(mesh, surface, { level: wanted, canvas: TX.display.canvasAt(surface, wanted) });
      changed = true;
    }
    if (changed) stage.requestRender();
  }


  const singleSelection = () => store.soleSelected("texture");

  function handlePositions(node) {
    const corners = nodeCorners(node).map(c => stage.worldToScreen(c.x, c.y));
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const points = [
      corners[0], corners[1], corners[2], corners[3],
      mid(corners[0], corners[1]),
      mid(corners[1], corners[2]),
      mid(corners[2], corners[3]),
      mid(corners[3], corners[0]),
    ];

    const top = points[4];
    const bottom = points[6];
    const len = Math.hypot(top.x - bottom.x, top.y - bottom.y) || 1;
    const rotateHandle = {
      x: top.x + ((top.x - bottom.x) / len) * ROTATE_OFFSET,
      y: top.y + ((top.y - bottom.y) / len) * ROTATE_OFFSET,
    };

    return { points, rotateHandle };
  }

  function handleAt(screen) {
    const node = singleSelection();
    if (!node) return null;
    const { points, rotateHandle } = handlePositions(node);

    if (Math.hypot(rotateHandle.x - screen.x, rotateHandle.y - screen.y) <= HANDLE_GRAB) {
      return { kind: "rotate" };
    }
    for (let i = 0; i < points.length; i++) {
      if (Math.hypot(points[i].x - screen.x, points[i].y - screen.y) <= HANDLE_GRAB) {
        return { kind: "resize", index: i };
      }
    }
    return null;
  }

  function paintMeasurement(ctx, node) {
    const corners = nodeCorners(node).map(c => stage.worldToScreen(c.x, c.y));
    const width = Math.round(node.width * node.scaleX);
    const height = Math.round(node.height * node.scaleY);

    const pct = value => `${Math.round(value * 100)}%`;
    const uniform = Math.abs(node.scaleX - node.scaleY) < 0.005;
    const scale = uniform ? pct(node.scaleX) : `${pct(node.scaleX)} × ${pct(node.scaleY)}`;
    const atSize = Math.abs(node.scaleX - 1) < 0.005 && Math.abs(node.scaleY - 1) < 0.005;

    const text = atSize
      ? `${width} × ${height}  ·  1:1`
      : `${width} × ${height}  ·  ${scale} of ${node.width} × ${node.height}`;

    const centreX = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
    const bottom = Math.max(...corners.map(p => p.y));
    const y = bottom + HANDLE_SIZE + 11;

    ctx.font = "600 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const box = ctx.measureText(text).width;

    ctx.fillStyle = "rgba(12,13,16,0.78)";
    ctx.beginPath();
    ctx.roundRect(centreX - box / 2 - 7, y - 9, box + 14, 18, 4);
    ctx.fill();

    const starved = node.scaleX < 0.95 || node.scaleY < 0.95;
    ctx.fillStyle = starved ? "#ff8a65" : "rgba(255,255,255,0.92)";
    ctx.fillText(text, centreX, y + 0.5);
    ctx.textAlign = "start";
  }


  function paint() {
    const ctx = stage.ctx;

    if (state.settings.showGrid) {
      stage.drawGrid(state.settings.gridSize, COLORS.grid, COLORS.axis,
        state.textures.map(node => nodeCorners(node).map(c => stage.worldToScreen(c.x, c.y))));
    }

    stage.useScreenTransform();
    ctx.lineJoin = "round";

    TX.viewOverlay.paintAtlas(
      stage, texture => nodeCorners(texture).map(c => stage.worldToScreen(c.x, c.y)));

    for (const texture of state.textures) {
      const selected = store.isSelected("texture", texture.id);
      const corners = nodeCorners(texture).map(c => stage.worldToScreen(c.x, c.y));
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeStyle = selected ? COLORS.selected : COLORS.outline;
      ctx.stroke();
    }

    const bounds = unionBounds(state.textures.map(nodeBounds));
    if (bounds) {
      const a = stage.worldToScreen(bounds.minX, bounds.minY);
      const b = stage.worldToScreen(bounds.maxX, bounds.maxY);
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = COLORS.bounds;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.label;
      ctx.font = "12px system-ui, sans-serif";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        `${Math.ceil(bounds.maxX - bounds.minX)} x ${Math.ceil(bounds.maxY - bounds.minY)}`,
        a.x, a.y - 4,
      );
    }

    const node = singleSelection();
    if (node) {
      const { points, rotateHandle } = handlePositions(node);
      const top = points[4];
      const local = localHint || (drag && drag.type === "local");

      if (local) {
        const corners = nodeCorners(node).map(c => stage.worldToScreen(c.x, c.y));
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fillStyle = COLORS.localFill;
        ctx.fill();
        ctx.fillStyle = COLORS.local;
        ctx.font = "11px system-ui, sans-serif";
        ctx.textBaseline = "bottom";
        ctx.fillText("local space", corners[0].x, corners[0].y - 6);
      }

      ctx.strokeStyle = local ? COLORS.local : COLORS.selected;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(rotateHandle.x, rotateHandle.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(rotateHandle.x, rotateHandle.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
      ctx.fillStyle = local ? COLORS.local : COLORS.handleFill;
      ctx.fill();
      ctx.strokeStyle = COLORS.handleStroke;
      ctx.stroke();

      for (const p of points) {
        ctx.beginPath();
        ctx.rect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        ctx.fillStyle = local ? COLORS.local : COLORS.handleFill;
        ctx.fill();
        ctx.strokeStyle = COLORS.handleStroke;
        ctx.stroke();
      }

      paintMeasurement(ctx, node);
    }

    if (marquee) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.min(marquee.from.x, marquee.to.x),
        Math.min(marquee.from.y, marquee.to.y),
        Math.abs(marquee.to.x - marquee.from.x),
        Math.abs(marquee.to.y - marquee.from.y),
      );
      ctx.setLineDash([]);
    }

    paintGuides(ctx);
  }


  let marquee = null;
  let localHint = false;

  const texturesTopFirst = () => state.textures.slice().reverse();
  const textureAt = world => texturesTopFirst().find(t => hitTestNode(t, world)) || null;

  let guides = [];

  function applyMove(world) {
    const snap = TX.snap.settingsOf(state.settings);
    const moving = new Set(drag.start.map(entry => entry.id));
    const dx = world.x - drag.origin.x;
    const dy = world.y - drag.origin.y;

    const asked = drag.start.reduce((box, entry) => {
      const node = store.findTexture(entry.id);
      if (!node) return box;
      const at = nodeBounds({ ...node, x: entry.x + dx, y: entry.y + dy });
      return box ? unionBounds(box, at) : at;
    }, null);
    if (!asked) return;

    const found = TX.snap.solve({
      box: asked,
      others: state.textures.filter(t => !moving.has(t.id)).map(t => nodeBounds(t)),
      step: state.settings.gridSize,
      grid: snap.grid,
      edges: snap.edges,
      tolerance: snap.edges ? TX.snap.TOLERANCE / Math.max(stage.view.zoom, 1e-6) : 0,
    });
    guides = found.guides;

    for (const entry of drag.start) {
      const node = store.findTexture(entry.id);
      if (!node) continue;
      node.x = entry.x + dx + found.dx;
      node.y = entry.y + dy + found.dy;
    }
    stage.requestRender();
  }

  function paintGuides(ctx) {
    if (!guides.length || !drag) return;
    ctx.save();
    ctx.strokeStyle = COLORS.snap;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const guide of guides) {
      ctx.beginPath();
      if (guide.axis === "x") {
        const at = Math.round(stage.worldToScreen(guide.at, 0).x) + 0.5;
        ctx.moveTo(at, 0);
        ctx.lineTo(at, stage.view.height);
      } else {
        const at = Math.round(stage.worldToScreen(0, guide.at).y) + 0.5;
        ctx.moveTo(0, at);
        ctx.lineTo(stage.view.width, at);
      }
      ctx.stroke();
    }
    ctx.restore();
  }


  const localSpaceMark = node => {
    if (!node || !node.markId) return null;
    const m = store.findMark(node.markId);
    return m && store.assets.sources.get(m.imageId) ? m : null;
  };

  function beginLocalSpace(node, dir, world) {
    const m = localSpaceMark(node);
    if (!m) return;
    drag = {
      type: "local",
      id: node.id,
      markId: m.id,
      dir,
      origin: world,
      rotation: node.rotation,
      spanX: Math.max(1, node.width * node.scaleX),
      spanY: Math.max(1, node.height * node.scaleY),
      domain: TX.geom.domainOf(m.domain),
    };
    stage.requestRender();
  }

  let localPending = false;

  function requestLocalExtract(markId) {
    if (localPending) return;
    localPending = true;
    requestAnimationFrame(() => {
      localPending = false;
      if (hooks && hooks.onLocalSpaceChange) hooks.onLocalSpaceChange(markId, { draft: true });
    });
  }

  function applyLocalSpace(world) {
    const start = drag.domain;
    const moved = rotate(world.x - drag.origin.x, world.y - drag.origin.y, -drag.rotation);
    const du = (moved.x / drag.spanX) * (start.u1 - start.u0);
    const dv = (moved.y / drag.spanY) * (start.v1 - start.v0);
    const next = { ...start };

    if (drag.dir.x === 0 && drag.dir.y === 0) {
      next.u0 = start.u0 + du;
      next.u1 = start.u1 + du;
      next.v0 = start.v0 + dv;
      next.v1 = start.v1 + dv;
    } else {
      if (drag.dir.x > 0) next.u1 = Math.max(start.u0 + 0.02, start.u1 + du);
      if (drag.dir.x < 0) next.u0 = Math.min(start.u1 - 0.02, start.u0 + du);
      if (drag.dir.y > 0) next.v1 = Math.max(start.v0 + 0.02, start.v1 + dv);
      if (drag.dir.y < 0) next.v0 = Math.min(start.v1 - 0.02, start.v0 + dv);
    }

    store.setMarkDomain(drag.markId, next);
    requestLocalExtract(drag.markId);
    stage.requestRender();
  }

  function beginResize(node, index, world) {
    const dir = HANDLE_DIRS[index];
    const halfW = (node.width * node.scaleX) / 2;
    const halfH = (node.height * node.scaleY) / 2;
    const center = nodeCenter(node);
    const anchorLocal = { x: -dir.x * halfW, y: -dir.y * halfH };
    const offset = rotate(anchorLocal.x, anchorLocal.y, node.rotation);

    drag = {
      type: "resize",
      id: node.id,
      dir,
      anchor: { x: center.x + offset.x, y: center.y + offset.y },
      startScaledW: node.width * node.scaleX,
      startScaledH: node.height * node.scaleY,
      rotation: node.rotation,
    };
  }

  function applyResize(world, keepAspect) {
    const node = store.findTexture(drag.id);
    if (!node) return;

    const v = rotate(world.x - drag.anchor.x, world.y - drag.anchor.y, -drag.rotation);
    const step = state.settings.snapToGrid ? state.settings.gridSize : 0;

    let scaledW = drag.dir.x === 0 ? drag.startScaledW : Math.abs(v.x);
    let scaledH = drag.dir.y === 0 ? drag.startScaledH : Math.abs(v.y);

    if (step > 0) {
      if (drag.dir.x !== 0) scaledW = Math.max(step, snapTo(scaledW, step));
      if (drag.dir.y !== 0) scaledH = Math.max(step, snapTo(scaledH, step));
    }

    if (keepAspect && drag.dir.x !== 0 && drag.dir.y !== 0) {
      const ratio = Math.max(scaledW / drag.startScaledW, scaledH / drag.startScaledH);
      scaledW = drag.startScaledW * ratio;
      scaledH = drag.startScaledH * ratio;
    }

    const scaleX = Math.max(MIN_SCALE, scaledW / node.width);
    const scaleY = Math.max(MIN_SCALE, scaledH / node.height);
    const halfW = (node.width * scaleX) / 2;
    const halfH = (node.height * scaleY) / 2;

    const anchorLocal = { x: -drag.dir.x * halfW, y: -drag.dir.y * halfH };
    const offset = rotate(anchorLocal.x, anchorLocal.y, drag.rotation);
    const center = { x: drag.anchor.x - offset.x, y: drag.anchor.y - offset.y };

    node.scaleX = scaleX;
    node.scaleY = scaleY;
    node.x = center.x - halfW;
    node.y = center.y - halfH;
    stage.requestRender();
  }

  function onPointerDown(event) {
    if (stage.isPinching()) return;
    const screen = stage.pointerPosition(event);
    const world = stage.screenToWorld(screen.x, screen.y);
    container.focus();

    if (event.button === 1) {
      drag = { type: "pan", last: screen };
      capture(event);
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;

    const handle = handleAt(screen);
    if (handle && event.altKey && handle.kind !== "rotate" && localSpaceMark(singleSelection())) {
      capture(event);
      beginLocalSpace(singleSelection(), HANDLE_DIRS[handle.index], world);
      return;
    }

    if (handle) {
      const node = singleSelection();
      capture(event);
      if (handle.kind === "rotate") {
        const center = nodeCenter(node);
        drag = {
          type: "rotate",
          id: node.id,
          center,
          startAngle: Math.atan2(world.y - center.y, world.x - center.x),
          startRotation: node.rotation,
        };
      } else {
        beginResize(node, handle.index, world);
      }
      return;
    }

    const texture = textureAt(world);
    if (texture && event.altKey && localSpaceMark(texture)) {
      store.select("texture", texture.id);
      capture(event);
      beginLocalSpace(texture, { x: 0, y: 0 }, world);
      return;
    }

    if (texture) {
      if (event.shiftKey) store.toggleSelected("texture", texture.id);
      else if (!store.isSelected("texture", texture.id)) store.select("texture", texture.id);
      drag = {
        type: "move",
        origin: world,
        start: store.selectedItems("texture").map(node => ({
          id: node.id, x: node.x, y: node.y,
        })),
      };
      capture(event);
      return;
    }

    if (event.shiftKey) {
      marquee = { from: screen, to: screen };
      drag = { type: "marquee" };
      capture(event);
      return;
    }

    store.clearSelection();
    drag = { type: "pan", last: screen };
    capture(event);
    stage.requestRender();
  }

  function capture(event) {
    try {
      stage.overlay.setPointerCapture(event.pointerId);
    } catch (err) {
    }
  }

  function onPointerMove(event) {
    if (stage.isPinching()) {
      drag = null;
      return;
    }
    const screen = stage.pointerPosition(event);

    if (!drag) {
      const handle = handleAt(screen);
      const over = textureAt(stage.screenToWorld(screen.x, screen.y));
      const local = !!event.altKey && !!localSpaceMark(over || singleSelection());
      if (local !== localHint) {
        localHint = local;
        stage.requestRender();
      }
      if (local) stage.cursor = handle ? CURSORS[handle.index] : "crosshair";
      else if (handle) stage.cursor = handle.kind === "rotate" ? "grab" : CURSORS[handle.index];
      else stage.cursor = over ? "move" : "default";
      return;
    }

    if (drag.type === "pan") {
      stage.panBy(screen.x - drag.last.x, screen.y - drag.last.y);
      drag.last = screen;
      return;
    }

    if (drag.type === "marquee") {
      marquee.to = screen;
      stage.requestRender();
      return;
    }

    const world = stage.screenToWorld(screen.x, screen.y);

    if (drag.type === "move") {
      applyMove(world);
      return;
    }

    if (drag.type === "local") {
      applyLocalSpace(world);
      return;
    }

    if (drag.type === "resize") {
      applyResize(world, event.shiftKey);
      return;
    }

    if (drag.type === "rotate") {
      const node = store.findTexture(drag.id);
      if (!node) return;
      const angle = Math.atan2(world.y - drag.center.y, world.x - drag.center.x);
      let rotation = drag.startRotation + (angle - drag.startAngle);
      if (event.shiftKey) {
        const stepRad = Math.PI / 12;
        rotation = Math.round(rotation / stepRad) * stepRad;
      }
      node.rotation = rotation;
      stage.requestRender();
    }
  }

  function onPointerUp(event) {
    if (drag && drag.type === "local" && hooks && hooks.onLocalSpaceChange) {
      hooks.onLocalSpaceChange(drag.markId, { draft: false });
    }

    if (drag && drag.type === "marquee" && marquee) {
      const minX = Math.min(marquee.from.x, marquee.to.x);
      const maxX = Math.max(marquee.from.x, marquee.to.x);
      const minY = Math.min(marquee.from.y, marquee.to.y);
      const maxY = Math.max(marquee.from.y, marquee.to.y);
      store.select("texture", state.textures
        .filter(texture => {
          const b = nodeBounds(texture);
          const a = stage.worldToScreen(b.minX, b.minY);
          const c = stage.worldToScreen(b.maxX, b.maxY);
          return a.x < maxX && c.x > minX && a.y < maxY && c.y > minY;
        })
        .map(texture => texture.id));
    }
    marquee = null;
    drag = null;
    guides = [];
    stage.requestRender();
    try {
      stage.overlay.releasePointerCapture(event.pointerId);
    } catch (err) {
    }
  }

  function onWheel(event) {
    event.preventDefault();
    stage.setZoom(stage.view.zoom * Math.exp(-event.deltaY * 0.0015), stage.pointerPosition(event));
  }

  function onContextMenu(event) {
    event.preventDefault();
    if (hooks && hooks.onContextMenu) hooks.onContextMenu(event, { pane: "atlas" });
  }

  stage.overlay.addEventListener("pointerdown", onPointerDown);
  stage.overlay.addEventListener("pointermove", onPointerMove);
  stage.overlay.addEventListener("pointerup", onPointerUp);
  stage.overlay.addEventListener("pointercancel", onPointerUp);
  stage.overlay.addEventListener("wheel", onWheel, { passive: false });
  stage.overlay.addEventListener("contextmenu", onContextMenu);
  stage.setOverlayPainter(paint);

  const stopSync = watch(
    () => state.textures.map(t =>
      `${t.id}:${t.x},${t.y},${t.scaleX},${t.scaleY},${t.rotation},${store.textureKey(t.id)}`,
    ).join("|"),
    syncMeshes,
    { flush: "post" },
  );
  const stopRepaint = watch(
    () => [state.selection, state.settings],
    () => {
      syncFade();
      stage.requestRender();
    },
    { deep: true },
  );

  syncMeshes();


  function flushFit(kind) {
    if (kind === "selection") {
      const bounds = unionBounds(store.selectedItems("texture").map(nodeBounds));
      if (bounds) return !!stage.fitTo(bounds);
      kind = "all";
    }
    const bounds = unionBounds(state.textures.map(nodeBounds));
    if (bounds) return !!stage.fitTo(bounds);
    stage.view.zoom = 1;
    stage.view.panX = 256;
    stage.view.panY = 256;
    stage.requestRender();
    return true;
  }

  // Parked panels sit in a fixed 600×400 host — fit against that, then open the
  // real tab, and the slice stays tiny. Wait until the atlas is on-screen.
  function atlasOnScreen() {
    if (container.closest(".tx-dock-parking")) return false;
    return stage.view.width >= 64 && stage.view.height >= 64;
  }

  function fitAll() {
    if (!atlasOnScreen() || !flushFit("all")) pendingFit = "all";
    else pendingFit = null;
  }

  function fitSelection() {
    if (!atlasOnScreen() || !flushFit("selection")) pendingFit = "selection";
    else pendingFit = null;
  }

  function selectAll() {
    store.selectAllOf("texture");
    stage.requestRender();
  }

  function deleteSelected() {
    const ids = store.selectedIds("texture").slice();
    for (const id of ids) store.removeTexture(id);
    syncMeshes();
    return ids.length;
  }

  function resetTransforms() {
    TX.history.name("history.reset_transforms");
    const selected = store.selectedIds("texture");
    const ids = selected.length ? selected.slice() : state.textures.map(t => t.id);
    for (const id of ids) {
      const node = store.findTexture(id);
      if (!node) continue;
      node.rotation = 0;
      node.scaleX = 1;
      node.scaleY = 1;
    }
    syncMeshes();
  }

  function packAll() {
    if (!state.textures.length) return null;
    const items = state.textures.map(t => ({
      id: t.id,
      width: Math.ceil(t.width * t.scaleX),
      height: Math.ceil(t.height * t.scaleY),
    }));
    const result = TX.pack.shelfPack(items, {
      padding: state.settings.padding,
      powerOfTwo: state.settings.powerOfTwo,
    });
    for (const placement of result.placements) {
      const node = store.findTexture(placement.id);
      if (!node) continue;
      node.rotation = 0;
      node.x = placement.x;
      node.y = placement.y;
    }
    syncMeshes();
    fitAll();
    return result;
  }

  function composite(nodes, options) {
    if (!nodes.length) return null;
    const opts = options || {};
    const surfaceOf = opts.surfaceOf || (node => store.textureCanvas(node.id));
    const bounds = unionBounds(nodes.map(nodeBounds));
    const originX = Math.floor(bounds.minX);
    const originY = Math.floor(bounds.minY);
    let width = Math.max(1, Math.ceil(bounds.maxX) - originX);
    let height = Math.max(1, Math.ceil(bounds.maxY) - originY);

    if (state.settings.powerOfTwo) {
      width = TX.pack.nextPowerOfTwo(width);
      height = TX.pack.nextPowerOfTwo(height);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (opts.backdrop) {
      ctx.fillStyle = opts.backdrop;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    let drew = 0;
    for (const node of nodes) {
      const surface = surfaceOf(node);
      if (!surface) continue;
      const center = nodeCenter(node);
      const w = node.width * node.scaleX;
      const h = node.height * node.scaleY;
      ctx.save();
      ctx.translate(center.x - originX, center.y - originY);
      ctx.rotate(node.rotation);
      ctx.drawImage(surface, -w / 2, -h / 2, w, h);
      ctx.restore();
      drew++;
    }
    if (!drew) return null;

    return { canvas, width, height };
  }

  const compositeAll = options => composite(state.textures.slice(), options);
  const compositeSelected = options => composite(store.selectedItems("texture"), options);

  function selectedAsCanvases() {
    const selected = store.selectedItems("texture");
    const chosen = selected.length ? selected : state.textures.slice();

    return chosen.map(node => {
      const surface = store.textureCanvas(node.id);
      if (!surface) return null;
      const width = Math.max(1, Math.round(node.width * node.scaleX));
      const height = Math.max(1, Math.round(node.height * node.scaleY));
      if (width === surface.width && height === surface.height) {
        return { node, canvas: surface };
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(surface, 0, 0, width, height);
      return { node, canvas };
    }).filter(Boolean);
  }

  function duplicateMirrored(id) {
    const node = store.findTexture(id);
    const surface = store.textureCanvas(id);
    if (!node || !surface) return null;

    TX.history.name("history.mirror_2x2");
    const mirrored = TX.tiling.mirrorTile(surface);
    const copy = store.addTexture({
      name: `${node.name}-mirror`,
      width: mirrored.width,
      height: mirrored.height,
      x: node.x + node.width * node.scaleX + Math.max(2, state.settings.padding),
      y: node.y,
      scaleX: node.scaleX,
      scaleY: node.scaleY,
    });
    store.setTextureCanvas(copy.id, mirrored);
    syncMeshes();
    store.select("texture", copy.id);
    return copy;
  }

  function duplicateTexture(id) {
    const node = store.findTexture(id);
    const asset = store.assets.textures.get(id);
    if (!node || !asset) return null;

    const canvas = document.createElement("canvas");
    canvas.width = asset.canvas.width;
    canvas.height = asset.canvas.height;
    canvas.getContext("2d").drawImage(asset.canvas, 0, 0);

    const copy = store.addTexture({
      name: `${node.name}-copy`,
      width: canvas.width,
      height: canvas.height,
      x: node.x + node.width * node.scaleX + Math.max(2, state.settings.padding),
      y: node.y,
      scaleX: node.scaleX,
      scaleY: node.scaleY,
      rotation: node.rotation,
      tiling: { ...node.tiling },
    });
    store.setTextureCanvas(copy.id, canvas);
    syncMeshes();
    return copy.id;
  }

  function addShadingTexture(id) {
    const node = store.findTexture(id);
    const asset = store.assets.textures.get(id);
    if (!node || !asset) return null;

    const map = TX.delight.shadingMap(asset.canvas, node.delight);
    if (!map) return null;
    TX.history.name("history.extract_shading_map");

    const copy = store.addTexture({
      name: `${node.name}-shading`,
      width: map.width,
      height: map.height,
      x: node.x + node.width * node.scaleX + Math.max(2, state.settings.padding),
      y: node.y,
      scaleX: node.scaleX,
      scaleY: node.scaleY,
    });
    store.setTextureCanvas(copy.id, map);
    syncMeshes();
    store.select("texture", copy.id);
    return copy.id;
  }

  function dispose() {
    stopSync();
    stopRepaint();
    stage.dispose();
    geometry.dispose();
  }

  return {
    stage,
    syncMeshes,
    syncDetail,
    refreshTexture,
    fitAll,
    fitSelection,
    selectAll,
    deleteSelected,
    resetTransforms,
    packAll,
    compositeAll,
    compositeSelected,
    selectedAsCanvases,
    duplicateMirrored,
    duplicateTexture,
    addShadingTexture,
    dispose,
  };
}

TX.atlasCanvas = { createAtlasCanvas };

