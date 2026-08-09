
import * as THREE from "three";
import { TX } from "../tx.js";

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 64;

function createStage(container, options) {
  const settings = options || {};
  const glCanvas = document.createElement("canvas");
  glCanvas.className = "tx-layer tx-layer--gl";
  const overlay = document.createElement("canvas");
  overlay.className = "tx-layer tx-layer--overlay";
  container.appendChild(glCanvas);
  container.appendChild(overlay);

  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  const ctx = overlay.getContext("2d");

  const view = { panX: 0, panY: 0, zoom: 1, width: 1, height: 1, dpr: 1 };

  let drawOverlay = () => {};
  let needsRender = true;
  let frame = 0;
  let disposed = false;

  const requestRender = () => { needsRender = true; };

  const getViewport = () => ({ panX: view.panX, panY: view.panY, zoom: view.zoom });

  const viewportChanged = () => {
    if (settings.onViewChange) settings.onViewChange(getViewport());
  };

  function setViewport(viewport) {
    if (!viewport) return false;
    const { panX, panY, zoom } = viewport;
    if (![panX, panY, zoom].every(n => typeof n === "number" && Number.isFinite(n))) return false;
    view.panX = panX;
    view.panY = panY;
    view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    requestRender();
    return true;
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    view.width = width;
    view.height = height;
    view.dpr = dpr;

    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);

    overlay.width = Math.round(width * dpr);
    overlay.height = Math.round(height * dpr);
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;

    requestRender();
  }

  function updateCamera() {
    const halfW = view.width / (2 * view.zoom);
    const halfH = view.height / (2 * view.zoom);
    camera.left = view.panX - halfW;
    camera.right = view.panX + halfW;
// top < bottom flips the vertical axis so world y points down.
    camera.top = view.panY - halfH;
    camera.bottom = view.panY + halfH;
    camera.updateProjectionMatrix();
  }

  const screenToWorld = (sx, sy) => ({
    x: view.panX + (sx - view.width / 2) / view.zoom,
    y: view.panY + (sy - view.height / 2) / view.zoom,
  });

  const worldToScreen = (wx, wy) => ({
    x: (wx - view.panX) * view.zoom + view.width / 2,
    y: (wy - view.panY) * view.zoom + view.height / 2,
  });

  function pointerPosition(event) {
    const rect = overlay.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function visibleWorldBounds() {
    const min = screenToWorld(0, 0);
    const max = screenToWorld(view.width, view.height);
    return { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
  }

  function setZoom(nextZoom, anchor) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    if (clamped === view.zoom) return;
    if (anchor) {
      const before = screenToWorld(anchor.x, anchor.y);
      view.zoom = clamped;
      const after = screenToWorld(anchor.x, anchor.y);
      view.panX += before.x - after.x;
      view.panY += before.y - after.y;
    } else {
      view.zoom = clamped;
    }
    requestRender();
    viewportChanged();
  }

  function panBy(dxScreen, dyScreen) {
    view.panX -= dxScreen / view.zoom;
    view.panY -= dyScreen / view.zoom;
    requestRender();
    viewportChanged();
  }

  function centreOn(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    view.panX = x;
    view.panY = y;
    requestRender();
    viewportChanged();
  }

  function fitTo(bounds, margin) {
    if (!bounds) return;
    const pad = margin == null ? 48 : margin;
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const zoom = Math.min(
      (view.width - pad * 2) / width,
      (view.height - pad * 2) / height,
    );
    view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    view.panX = bounds.minX + width / 2;
    view.panY = bounds.minY + height / 2;
    requestRender();
    viewportChanged();
  }

  function useWorldTransform() {
    ctx.setTransform(
      view.dpr * view.zoom, 0, 0, view.dpr * view.zoom,
      view.dpr * (view.width / 2 - view.panX * view.zoom),
      view.dpr * (view.height / 2 - view.panY * view.zoom),
    );
  }

  function useScreenTransform() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }

  function drawGrid(step, color, axisColor, holes) {
    if (!step || step <= 0) return;
    let spacing = step;
    while (spacing * view.zoom < 6) spacing *= 2;

    const bounds = visibleWorldBounds();
    useScreenTransform();

    const cutouts = (holes || []).filter(poly => poly && poly.length > 2);
    if (cutouts.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, view.width, view.height);
      for (const poly of cutouts) {
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
      }
      ctx.clip("evenodd");
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.beginPath();

    const startX = Math.floor(bounds.minX / spacing) * spacing;
    for (let x = startX; x <= bounds.maxX; x += spacing) {
      const sx = Math.round(worldToScreen(x, 0).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, view.height);
    }
    const startY = Math.floor(bounds.minY / spacing) * spacing;
    for (let y = startY; y <= bounds.maxY; y += spacing) {
      const sy = Math.round(worldToScreen(0, y).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(view.width, sy);
    }
    ctx.stroke();

    if (axisColor) {
      ctx.strokeStyle = axisColor;
      ctx.beginPath();
      const origin = worldToScreen(0, 0);
      ctx.moveTo(Math.round(origin.x) + 0.5, 0);
      ctx.lineTo(Math.round(origin.x) + 0.5, view.height);
      ctx.moveTo(0, Math.round(origin.y) + 0.5);
      ctx.lineTo(view.width, Math.round(origin.y) + 0.5);
      ctx.stroke();
    }

    if (cutouts.length) ctx.restore();
  }

  function renderNow() {
    needsRender = false;
    updateCamera();
    renderer.render(scene, camera);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    drawOverlay();
  }

  function tick() {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    if (needsRender) renderNow();
  }

  // Two-finger pinch/pan — tablets have no scroll wheel.
  const touches = new Map();
  let pinch = null;
  let pinching = false;

  const clientToScreen = (clientX, clientY) => {
    const rect = overlay.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const touchPair = () => {
    if (touches.size < 2) return null;
    const pts = [];
    touches.forEach(p => pts.push(p));
    const a = pts[0];
    const b = pts[1];
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    };
  };

  const endPinch = () => {
    pinching = false;
    pinch = null;
  };

  function onTouchTrack(event) {
    if (event.pointerType !== "touch") return;
    if (event.type === "pointerdown" || event.type === "pointermove") {
      touches.set(event.pointerId, clientToScreen(event.clientX, event.clientY));
    } else {
      touches.delete(event.pointerId);
    }

    const pair = touchPair();
    if (!pair) {
      endPinch();
      return;
    }

    if (!pinching) {
      pinching = true;
      pinch = { dist: pair.dist, mid: pair.mid };
      if (settings.onPinchStart) settings.onPinchStart();
      return;
    }

    const last = pinch;
    pinch = { dist: pair.dist, mid: pair.mid };
    panBy(pair.mid.x - last.mid.x, pair.mid.y - last.mid.y);
    setZoom(view.zoom * (pair.dist / last.dist), pair.mid);
    event.preventDefault();
  }

  overlay.addEventListener("pointerdown", onTouchTrack, true);
  overlay.addEventListener("pointermove", onTouchTrack, true);
  overlay.addEventListener("pointerup", onTouchTrack, true);
  overlay.addEventListener("pointercancel", onTouchTrack, true);

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  frame = requestAnimationFrame(tick);

  function dispose() {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    overlay.removeEventListener("pointerdown", onTouchTrack, true);
    overlay.removeEventListener("pointermove", onTouchTrack, true);
    overlay.removeEventListener("pointerup", onTouchTrack, true);
    overlay.removeEventListener("pointercancel", onTouchTrack, true);
    renderer.dispose();
    glCanvas.remove();
    overlay.remove();
  }

  return {
    container,
    overlay,
    ctx,
    scene,
    camera,
    renderer,
    view,
    requestRender,
    screenToWorld,
    worldToScreen,
    pointerPosition,
    visibleWorldBounds,
    setZoom,
    panBy,
    fitTo,
    centreOn,
    resize,
    getViewport,
    setViewport,
    useWorldTransform,
    useScreenTransform,
    renderNow,
    drawGrid,
    dispose,
    isPinching: () => pinching,
    setOverlayPainter(fn) { drawOverlay = fn; requestRender(); },
    get cursor() { return overlay.style.cursor; },
    set cursor(value) { overlay.style.cursor = value; },
  };
}

function nodeCorners(node) {
  const halfW = (node.width * node.scaleX) / 2;
  const halfH = (node.height * node.scaleY) / 2;
  const cos = Math.cos(node.rotation);
  const sin = Math.sin(node.rotation);
  const cx = node.x + halfW;
  const cy = node.y + halfH;
  return [
    [-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH],
  ].map(([lx, ly]) => ({
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  }));
}

function nodeCenter(node) {
  return {
    x: node.x + (node.width * node.scaleX) / 2,
    y: node.y + (node.height * node.scaleY) / 2,
  };
}

function worldToLocal(node, point) {
  const center = nodeCenter(node);
  const cos = Math.cos(-node.rotation);
  const sin = Math.sin(-node.rotation);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return {
    x: lx / (node.scaleX || 1) + node.width / 2,
    y: ly / (node.scaleY || 1) + node.height / 2,
  };
}

function localToWorld(node, point) {
  const center = nodeCenter(node);
  const lx = (point.x - node.width / 2) * node.scaleX;
  const ly = (point.y - node.height / 2) * node.scaleY;
  const cos = Math.cos(node.rotation);
  const sin = Math.sin(node.rotation);
  return {
    x: center.x + lx * cos - ly * sin,
    y: center.y + lx * sin + ly * cos,
  };
}

function hitTestNode(node, point) {
  const local = worldToLocal(node, point);
  return local.x >= 0 && local.x <= node.width && local.y >= 0 && local.y <= node.height;
}

function nodeBounds(node) {
  const corners = nodeCorners(node);
  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function unionBounds(list) {
  if (!list.length) return null;
  return list.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX),
    maxY: Math.max(acc.maxY, b.maxY),
  }));
}

// image's first row (matching texture.flipY = false).
function makeQuadGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(
    [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

const snapTo = (value, step) => (step > 0 ? Math.round(value / step) * step : value);

TX.stage = {
  createStage,
  nodeCorners,
  nodeCenter,
  worldToLocal,
  localToWorld,
  hitTestNode,
  nodeBounds,
  unionBounds,
  makeQuadGeometry,
  snapTo,
  MIN_ZOOM,
  MAX_ZOOM,
};

