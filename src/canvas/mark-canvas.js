
import * as THREE from "three";
import { watch } from "vue";
import { TX } from "../tx.js";

const { snapTo, nodeCorners, nodeCenter, worldToLocal, localToWorld, hitTestNode, nodeBounds, unionBounds, makeQuadGeometry } = TX.stage;

const POINT_RADIUS = 6;
const POINT_GRAB = 10;
const PIVOT_RADIUS = 4.5;
const PIVOT_GRAB = 9;
const CURVE_STEPS = 12;
const HOVER_SLOP = 10;
const LINE_DRAG_MIN = 6;
const TOUCH_MOVE_MAX = 10;
const LONG_PRESS_MS = 420;
const PRECISION_FACTOR = 0.2;
const LOUPE_RADIUS = 80;
const LOUPE_SAMPLE_MIN = 12;
const LOUPE_SAMPLE_MAX = 1024;
const LOUPE_SAMPLE_DEFAULT = 32;
const zoomLabel = z => (z >= 10 ? z.toFixed(0) : z >= 1 ? z.toFixed(1) : z.toFixed(2));

const COLORS = {
  grid: "rgba(255,255,255,0.06)",
  axis: "rgba(255,255,255,0.16)",
  imageOutline: "rgba(255,255,255,0.22)",
  imageSelected: "#4fc3f7",
  mark: "#66bb6a",
  markDirty: "#ffb300",
  markSelected: "#4fc3f7",
  markFill: "rgba(102,187,106,0.14)",
  markFillDirty: "rgba(255,179,0,0.14)",
  markBase: "rgba(255,255,255,0.28)",
  localGrid: "rgba(255,255,255,0.28)",
  point: "#ffffff",
  pointStroke: "#222222",
  pivot: "#ffd54f",
  pivotBent: "#ffa000",
  handleLine: "rgba(255,213,79,0.35)",
  handleLineBent: "rgba(255,160,0,0.7)",
  handleCurve: "rgba(255,213,79,0.5)",
  weld: "#4fc3f7",
  pending: "#ff7043",
  label: "rgba(255,255,255,0.75)",
};

function createMarkCanvas(container, hooks) {
  const store = TX.store;
  const state = store.state;
  let drag = null;
  let hold = null;
  const clearHold = () => {
    if (hold && hold.timer) clearTimeout(hold.timer);
    hold = null;
  };
  const stage = TX.stage.createStage(container, {
    onViewChange: hooks.onViewChange,
    onPinchStart: () => {
      clearHold();
      drag = null;
      marquee = null;
      weldTarget = null;
      setMarking(null);
    },
  });
  const geometry = makeQuadGeometry();
  const meshes = new Map();

  stage.view.panX = 400;
  stage.view.panY = 300;

  function syncMeshes() {
    const seen = new Set();

    state.images.forEach((image, index) => {
      seen.add(image.id);
      const asset = store.assets.sources.get(image.id);
      if (!asset) return;

      let mesh = meshes.get(image.id);
      if (!mesh) {
        mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
          map: asset.source.texture,
          transparent: true,
          side: THREE.DoubleSide,
          toneMapped: false,
        }));
        meshes.set(image.id, mesh);
        stage.scene.add(mesh);
      }

      const center = nodeCenter(image);
      mesh.position.set(center.x, center.y, index * 0.001);
      mesh.rotation.z = image.rotation;
      mesh.scale.set(image.width * image.scaleX, image.height * image.scaleY, 1);
    });

    for (const [id, mesh] of meshes) {
      if (seen.has(id)) continue;
      stage.scene.remove(mesh);
      mesh.material.dispose();
      meshes.delete(id);
    }

    stage.requestRender();
  }


  function markWorldPoints(image, mark) {
    return mark.points.map(p => localToWorld(image, p));
  }

  function markGeometry(image, mark) {
    const lens = TX.lens.forImage(image);
    const h = TX.geom.fitQuad(mark.points, lens);
    if (!h) return null;
    const curve = TX.geom.curveOf(mark.curve);
    const domain = TX.geom.domainOf(mark.domain);
    // atLocal: project only; do not run curved points through Coons again.
    const project = local => {
      const world = localToWorld(image, local);
      return stage.worldToScreen(world.x, world.y);
    };
    const at = (u, v) => project(TX.geom.localToImage(h, curve, u, v, lens));
    const atLocal = p => project(
      lens ? lens.toActual(TX.geom.applyHomography(h, p.x, p.y))
        : TX.geom.applyHomography(h, p.x, p.y));
    return { h, curve, domain, lens, at, atLocal };
  }

  const strokePath = (ctx, path) => {
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.closePath();
  };

  function paintLocalGrid(ctx, mark, geo) {
    const step = state.settings.gridSize;
    if (step <= 0) return;
    const size = TX.geom.quadDimensions(
      TX.geom.effectiveQuad(mark.points, geo.domain, geo.curve, geo.lens));
    const { u0, v0, u1, v1 } = geo.domain;
    const cols = Math.min(64, Math.floor(size.width / step));
    const rows = Math.min(64, Math.floor(size.height / step));
    const steps = TX.geom.isFlatCurve(geo.curve) && !geo.lens ? 1 : 10;

    ctx.save();
    ctx.beginPath();
    for (let i = 1; i <= cols; i++) {
      const u = u0 + ((u1 - u0) * i) / (cols + 1);
      for (let s = 0; s <= steps; s++) {
        const p = geo.at(u, v0 + ((v1 - v0) * s) / steps);
        if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
    }
    for (let i = 1; i <= rows; i++) {
      const v = v0 + ((v1 - v0) * i) / (rows + 1);
      for (let s = 0; s <= steps; s++) {
        const p = geo.at(u0 + ((u1 - u0) * s) / steps, v);
        if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.localGrid;
    ctx.stroke();
    ctx.restore();
  }

  const REVEAL_MS = 1100;

  const revealFade = markId => {
    if (markId !== revealedMarkId) return 0;
    const left = 1 - (performance.now() - revealedAt) / REVEAL_MS;
    if (left <= 0) {
      revealedMarkId = null;
      return 0;
    }
    return left;
  };

  function paintMark(ctx, image, mark) {
    const geo = markGeometry(image, mark);
    const corners = markWorldPoints(image, mark).map(p => stage.worldToScreen(p.x, p.y));
    const dirty = mark.dirty;

    if (!geo) {
      strokePath(ctx, corners);
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.markDirty;
      ctx.stroke();
      return;
    }

    const extended = !TX.geom.isUnitDomain(geo.domain);
    const bent = !TX.geom.isFlatCurve(geo.curve);

    const outline = TX.geom
      .outlinePath(mark.points, geo.domain, geo.curve, 14, geo.lens)
      .map(p => {
        const world = localToWorld(image, p);
        return stage.worldToScreen(world.x, world.y);
      });

    const selected = store.isSelected("mark", mark.id);
    const revealing = revealFade(mark.id);

    strokePath(ctx, outline);
    ctx.fillStyle = dirty ? COLORS.markFillDirty : COLORS.markFill;
    ctx.fill();
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = selected
      ? COLORS.markSelected
      : (dirty ? COLORS.markDirty : COLORS.mark);
    ctx.stroke();

    if (revealing > 0) {
      strokePath(ctx, outline);
      ctx.lineWidth = 2 + revealing * 6;
      ctx.strokeStyle = `rgba(79,195,247,${(revealing * 0.55).toFixed(3)})`;
      ctx.stroke();
      stage.requestRender();
    }

    if (extended) {
      strokePath(ctx, corners);
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = COLORS.markBase;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (mark.id === hoveredMarkId || selected) paintLocalGrid(ctx, mark, geo);

    for (const p of corners) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.point;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COLORS.pointStroke;
      ctx.stroke();
    }

    if (mark.id === hoveredMarkId || selected || bent) paintHandles(ctx, geo, corners);
  }

  function paintHandles(ctx, geo, corners) {
    for (let k = 0; k < 4; k++) {
      const controls = TX.geom.edgeControls(geo.curve, k);
      const ends = [corners[k], corners[(k + 1) % 4]];
      const straight = TX.geom.isStraight(geo.curve[k]);

      for (let i = 0; i < 2; i++) {
        const p = geo.atLocal(controls[i]);

        ctx.beginPath();
        ctx.moveTo(ends[i].x, ends[i].y);
        ctx.lineTo(p.x, p.y);
        ctx.lineWidth = 1;
        ctx.strokeStyle = straight ? COLORS.handleLine : COLORS.handleLineBent;
        ctx.setLineDash(straight ? [3, 3] : []);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(p.x, p.y, PIVOT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = straight ? COLORS.pivot : COLORS.pivotBent;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COLORS.pointStroke;
        ctx.stroke();
      }
    }

    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i <= CURVE_STEPS; i++) {
        const p = geo.atLocal(TX.geom.edgePoint(geo.curve, k, i / CURVE_STEPS));
        if (k === 0 && i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
    }
    ctx.closePath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.handleCurve;
    ctx.stroke();
  }

  function paint() {
    const ctx = stage.ctx;

    if (state.settings.showGrid) {
      stage.drawGrid(state.settings.gridSize, COLORS.grid, COLORS.axis,
        state.images.map(image => nodeCorners(image).map(c => stage.worldToScreen(c.x, c.y))));
    }

    stage.useScreenTransform();
    ctx.lineJoin = "round";

    TX.viewOverlay.paintMarks(stage, mark => {
      const image = store.findImage(mark.imageId);
      if (!image) return null;
      const geo = markGeometry(image, mark);
      if (!geo) return null;
      const { u0, v0, u1, v1 } = geo.domain;
      return (u, v) => geo.at(u0 + (u1 - u0) * u, v0 + (v1 - v0) * v);
    });

    for (const image of state.images) {
      const selected = store.isSelected("image", image.id);
      const corners = nodeCorners(image).map(c => stage.worldToScreen(c.x, c.y));

      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeStyle = selected ? COLORS.imageSelected : COLORS.imageOutline;
      ctx.stroke();

      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = COLORS.label;
      ctx.textBaseline = "bottom";
      ctx.fillText(image.name, corners[0].x, corners[0].y - 4);

      for (const mark of store.marksOfImage(image.id)) paintMark(ctx, image, mark);
    }

    if (weldTarget) {
      ctx.beginPath();
      ctx.arc(weldTarget.x, weldTarget.y, POINT_RADIUS + 4, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.weld;
      ctx.stroke();
    }

    if (state.pending.imageId && state.pending.points.length) {
      const image = store.findImage(state.pending.imageId);
      if (image) {
        const pts = state.pending.points.map(p => {
          const w = localToWorld(image, p);
          return stage.worldToScreen(w.x, w.y);
        });
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = COLORS.pending;
        ctx.stroke();
        ctx.setLineDash([]);

        pts.forEach((p, i) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = COLORS.pending;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = COLORS.pointStroke;
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.font = "10px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), p.x, p.y);
          ctx.textAlign = "start";
        });
      }
    }

    if (drag && drag.type === "line" && drag.moved) {
      ctx.beginPath();
      ctx.moveTo(drag.from.x, drag.from.y);
      ctx.lineTo(drag.to.x, drag.to.y);
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.pending;
      ctx.stroke();
      for (const p of [drag.from, drag.to]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.pending;
        ctx.fill();
      }
    }

    if (marquee) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = COLORS.imageSelected;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.min(marquee.from.x, marquee.to.x),
        Math.min(marquee.from.y, marquee.to.y),
        Math.abs(marquee.to.x - marquee.from.x),
        Math.abs(marquee.to.y - marquee.from.y),
      );
      ctx.setLineDash([]);
    }

    const loupe = loupeGesture();
    if (loupe) paintLoupe(ctx, loupe);
  }

  function paintLoupe(ctx, gesture) {
    const image = store.findImage(gesture.imageId);
    const local = loupeSampleLocal(gesture);
    const asset = image && store.assets.sources.get(image.id);
    if (!image || !local || !asset || !asset.element) return;

    const world = localToWorld(image, local);
    const anchor = stage.worldToScreen(world.x, world.y);
    const r = LOUPE_RADIUS;
    const pad = 12;
    let cx = anchor.x + r + pad;
    let cy = anchor.y - r - pad;
    if (cx + r > stage.view.width - 8) cx = anchor.x - r - pad;
    if (cy - r < 8) cy = anchor.y + r + pad;
    cx = Math.max(r + 8, Math.min(stage.view.width - r - 8, cx));
    cy = Math.max(r + 8, Math.min(stage.view.height - r - 8, cy));

    const sample = loupeSampleOf();
    const zoom = (r * 2) / sample;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = zoom < 1;
    ctx.drawImage(
      asset.element,
      local.x - sample / 2, local.y - sample / 2, sample, sample,
      cx - r, cy - r, r * 2, r * 2,
    );
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.stroke();

    const cell = zoom;
    if (cell >= 4) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < sample; i++) {
        const x = cx - r + i * cell;
        const y = cy - r + i * cell;
        ctx.moveTo(x, cy - r);
        ctx.lineTo(x, cy + r);
        ctx.moveTo(cx - r, y);
        ctx.lineTo(cx + r, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,80,60,0.95)";
    ctx.stroke();

    paintLoupeNotes(ctx, cx, cy - r - 30, r * 2 + 8,
      [TX.t("mark.loupe.zoom", { zoom: zoomLabel(zoom) })]);

    const notes = [];
    if (gesture.type !== "place" && !gesture.precision) notes.push(TX.t("mark.loupe.shift_hint"));
    notes.push(TX.t("mark.loupe.wheel_hint"));
    paintLoupeNotes(ctx, cx, cy + r + 8, r * 2 + 8, notes);
  }

  function loupeSampleOf() {
    const n = Number(state.settings.loupeSample);
    if (!Number.isFinite(n)) return LOUPE_SAMPLE_DEFAULT;
    return Math.max(LOUPE_SAMPLE_MIN, Math.min(LOUPE_SAMPLE_MAX, Math.round(n)));
  }

  function paintLoupeNotes(ctx, cx, top, maxWidth, notes) {
    if (!notes.length) return;
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const gap = 4;
    const th = 22;
    let y = top;
    for (const note of notes) {
      const tw = Math.min(maxWidth, ctx.measureText(note).width + 16);
      const left = cx - tw / 2;
      const boxTop = Math.max(6, Math.min(y, stage.view.height - th - 6));
      ctx.fillStyle = "rgba(22, 24, 28, 0.92)";
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const rr = 6;
      ctx.moveTo(left + rr, boxTop);
      ctx.arcTo(left + tw, boxTop, left + tw, boxTop + th, rr);
      ctx.arcTo(left + tw, boxTop + th, left, boxTop + th, rr);
      ctx.arcTo(left, boxTop + th, left, boxTop, rr);
      ctx.arcTo(left, boxTop, left + tw, boxTop, rr);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fillText(note, cx, boxTop + 5);
      y = boxTop + th + gap;
    }
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  function loupeSampleLocal(gesture) {
    const image = store.findImage(gesture.imageId);
    if (gesture.type === "place") {
      if (!image) return null;
      const world = stage.screenToWorld(gesture.screen.x, gesture.screen.y);
      return worldToLocal(image, world);
    }
    const mark = store.findMark(gesture.markId);
    if (!mark || !image) return null;
    if (gesture.type === "point") return mark.points[gesture.index] || null;
    const geo = markGeometry(image, mark);
    if (!geo) return null;
    const controls = TX.geom.edgeControls(geo.curve, gesture.index);
    const unit = controls[gesture.which];
    if (!unit) return null;
    const mapped = TX.geom.applyHomography(geo.h, unit.x, unit.y);
    return geo.lens ? geo.lens.toActual(mapped) : mapped;
  }


  const imagesTopFirst = () => state.images.slice().reverse();

  function imageAt(world) {
    return imagesTopFirst().find(image => hitTestNode(image, world)) || null;
  }

  function pointAt(screen) {
    for (const image of imagesTopFirst()) {
      for (const mark of store.marksOfImage(image.id)) {
        for (let i = 0; i < mark.points.length; i++) {
          const world = localToWorld(image, mark.points[i]);
          const at = stage.worldToScreen(world.x, world.y);
          if (Math.hypot(at.x - screen.x, at.y - screen.y) <= POINT_GRAB) {
            return { markId: mark.id, index: i, imageId: image.id };
          }
        }
      }
    }
    return null;
  }

  const distToSegment = (p, a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  };

  function markNear(screen) {
    for (const image of imagesTopFirst()) {
      for (const mark of store.marksOfImage(image.id)) {
        const corners = mark.points.map(p => {
          const world = localToWorld(image, p);
          return stage.worldToScreen(world.x, world.y);
        });
        for (let i = 0; i < 4; i++) {
          if (distToSegment(screen, corners[i], corners[(i + 1) % 4]) <= HOVER_SLOP) {
            return mark;
          }
        }
      }
    }
    return null;
  }

  function pivotAt(screen) {
    for (const image of imagesTopFirst()) {
      for (const mark of store.marksOfImage(image.id)) {
        if (mark.id !== hoveredMarkId && !store.isSelected("mark", mark.id)
            && TX.geom.isFlatCurve(mark.curve)) continue;
        const geo = markGeometry(image, mark);
        if (!geo) continue;
        for (let k = 0; k < 4; k++) {
          const controls = TX.geom.edgeControls(geo.curve, k);
          for (let i = 0; i < 2; i++) {
            const at = geo.atLocal(controls[i]);
            if (Math.hypot(at.x - screen.x, at.y - screen.y) <= PIVOT_GRAB) {
              return { markId: mark.id, index: k, which: i, imageId: image.id };
            }
          }
        }
      }
    }
    return null;
  }

  function markAt(world) {
    for (const image of imagesTopFirst()) {
      const local = worldToLocal(image, world);
      const lens = TX.lens.forImage(image);
      for (const mark of store.marksOfImage(image.id)) {
        const quad = TX.geom.effectiveQuad(mark.points, mark.domain, mark.curve, lens);
        if (TX.geom.pointInQuad(local, quad) || TX.geom.pointInQuad(local, mark.points)) {
          return mark;
        }
      }
    }
    return null;
  }

  function weldCandidate(image, screen, exclude) {
    const radius = state.settings.weldRadius;
    if (!(radius > 0)) return null;

    let best = null;
    let bestDistance = radius;
    for (const mark of store.marksOfImage(image.id)) {
      for (let i = 0; i < mark.points.length; i++) {
        if (exclude && exclude.markId === mark.id && exclude.index === i) continue;
        const world = localToWorld(image, mark.points[i]);
        const at = stage.worldToScreen(world.x, world.y);
        const distance = Math.hypot(at.x - screen.x, at.y - screen.y);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = { point: { ...mark.points[i] }, screen: at };
        }
      }
    }
    return best;
  }


  let marquee = null;
  let marking = null;
  let hoveredMarkId = null;
  let weldTarget = null;
  let revealedMarkId = null;
  let revealedAt = 0;

  let extractPending = false;
  let draftedMarkId = null;
  function requestExtract(markId) {
    draftedMarkId = markId;
    if (extractPending || !hooks || !hooks.onMarkGeometryChange) return;
    extractPending = true;
    requestAnimationFrame(() => {
      extractPending = false;
      hooks.onMarkGeometryChange(markId, { draft: true });
    });
  }

  function finishExtract() {
    const markId = draftedMarkId;
    draftedMarkId = null;
    if (markId == null || !hooks || !hooks.onMarkGeometryChange) return;
    hooks.onMarkGeometryChange(markId, { draft: false });
  }

  function setMarking(next) {
    if (!next && !marking) return;
    marking = next;
    stage.requestRender();
  }

  const markingAt = (event, screen) => {
    const touch = event.pointerType === "touch";
    const placeMod = event.ctrlKey || event.metaKey
      || (touch && state.pending.points.length > 0);
    if (!placeMod) return null;
    const image = imageAt(stage.screenToWorld(screen.x, screen.y));
    if (!image) return null;
    if (state.pending.points.length && state.pending.imageId !== image.id) return null;
    return { type: "place", imageId: image.id, screen };
  };

  function loupeGesture() {
    if (drag && (drag.type === "point" || drag.type === "pivot")) return drag;
    if (drag && drag.type !== "line") return null;
    return marking;
  }

  function addPendingPoint(image, world, screen) {
    const local = worldToLocal(image, world);
    const weld = screen ? weldCandidate(image, screen, null) : null;
    const point = weld ? weld.point : { x: local.x, y: local.y };

    if (state.pending.imageId !== image.id) {
      state.pending.imageId = image.id;
      state.pending.points = [];
    }
    state.pending.points.push(point);

    if (state.pending.points.length === 4) {
      const ordered = TX.geom.orderQuad(state.pending.points);
      store.clearPending();
      if (ordered) {
        const mark = store.addMark(image.id, ordered);
        if (hooks && hooks.onMarkCreated) hooks.onMarkCreated(mark.id);
      } else if (hooks && hooks.onNotice) {
        hooks.onNotice(TX.t("mark.notice.bad_quad"), "warning");
      }
    }
    stage.requestRender();
  }

  function onPointerDown(event) {
    if (stage.isPinching()) return;
    const screen = stage.pointerPosition(event);
    const world = stage.screenToWorld(screen.x, screen.y);
    container.focus();
    clearHold();

    if (event.button === 1) {
      drag = { type: "pan", last: screen };
      overlaySetPointerCapture(event);
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;

    const touch = event.pointerType === "touch";
    const placeMod = event.ctrlKey || event.metaKey
      || (touch && state.pending.points.length > 0);

    if (event.altKey) {
      const mark = markAt(world);
      if (mark) {
        store.removeMark(mark.id);
        stage.requestRender();
      }
      return;
    }

    const grabbed = pointAt(screen);
    if (grabbed) {
      drag = {
        type: "point",
        ...grabbed,
        startScreen: { x: screen.x, y: screen.y },
        precision: !!event.shiftKey,
      };
      overlaySetPointerCapture(event);
      stage.requestRender();
      return;
    }

    const pivot = pivotAt(screen);
    if (pivot) {
      drag = {
        type: "pivot",
        ...pivot,
        startScreen: { x: screen.x, y: screen.y },
        precision: !!event.shiftKey,
      };
      overlaySetPointerCapture(event);
      stage.requestRender();
      return;
    }

    if (placeMod) {
      const image = imageAt(world);
      if (image && (!state.pending.points.length || state.pending.imageId === image.id)) {
        drag = { type: "line", imageId: image.id, from: screen, to: screen, moved: false };
        setMarking({ type: "place", imageId: image.id, screen });
        overlaySetPointerCapture(event);
        return;
      }
    }

    const mark = markAt(world);
    if (mark) {
      if (event.shiftKey) store.toggleSelected("mark", mark.id);
      else if (!store.isSelected("mark", mark.id)) store.select("mark", mark.id);
      drag = {
        type: "mark",
        origin: world,
        start: store.selectedItems("mark").map(node => ({
          id: node.id,
          imageId: node.imageId,
          points: node.points.map(p => ({ x: p.x, y: p.y })),
        })),
      };
      overlaySetPointerCapture(event);
      stage.requestRender();
      return;
    }

    const image = imageAt(world);
    if (image) {
      if (touch) {
        drag = {
          type: "touch-pending",
          imageId: image.id,
          origin: world,
          startScreen: { x: screen.x, y: screen.y },
          moved: false,
        };
        overlaySetPointerCapture(event);
        hold = {
          pointerId: event.pointerId,
          screen: { x: screen.x, y: screen.y },
          imageId: image.id,
          timer: setTimeout(() => {
            if (!hold || hold.pointerId !== event.pointerId) return;
            hold = null;
            if (!drag || drag.type !== "touch-pending") return;
            drag = {
              type: "line",
              imageId: image.id,
              from: screen,
              to: screen,
              moved: false,
            };
            setMarking({ type: "place", imageId: image.id, screen });
            stage.requestRender();
            if (navigator.vibrate) navigator.vibrate(12);
          }, LONG_PRESS_MS),
        };
        return;
      }
      if (event.shiftKey) store.toggleSelected("image", image.id);
      else if (!store.isSelected("image", image.id)) store.select("image", image.id);
      drag = {
        type: "image",
        origin: world,
        start: store.selectedItems("image").map(node => ({
          id: node.id, x: node.x, y: node.y,
        })),
      };
      overlaySetPointerCapture(event);
      return;
    }

    if (event.shiftKey) {
      marquee = { from: screen, to: screen };
      drag = { type: "marquee" };
      overlaySetPointerCapture(event);
      return;
    }

    store.clearSelection();
    drag = { type: "pan", last: screen };
    overlaySetPointerCapture(event);
    stage.requestRender();
  }

  function overlaySetPointerCapture(event) {
    try {
      stage.overlay.setPointerCapture(event.pointerId);
    } catch (err) {
    }
  }

  function precisionWorld(screen, event) {
    if (drag.type !== "point" && drag.type !== "pivot") {
      return stage.screenToWorld(screen.x, screen.y);
    }
    const precise = !!event.shiftKey;
    if (precise !== !!drag.precision) {
      drag.startScreen = { x: screen.x, y: screen.y };
      drag.precision = precise;
    }
    if (!drag.startScreen) drag.startScreen = { x: screen.x, y: screen.y };
    const factor = drag.precision ? PRECISION_FACTOR : 1;
    return stage.screenToWorld(
      drag.startScreen.x + (screen.x - drag.startScreen.x) * factor,
      drag.startScreen.y + (screen.y - drag.startScreen.y) * factor,
    );
  }

  function onPointerMove(event) {
    if (stage.isPinching()) {
      clearHold();
      drag = null;
      return;
    }
    const screen = stage.pointerPosition(event);

    if (drag && drag.type === "touch-pending") {
      const dist = Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y);
      if (dist > TOUCH_MOVE_MAX) {
        clearHold();
        const image = store.findImage(drag.imageId);
        if (!image) {
          drag = null;
          return;
        }
        if (!store.isSelected("image", image.id)) store.select("image", image.id);
        drag = {
          type: "image",
          origin: drag.origin,
          start: store.selectedItems("image").map(node => ({
            id: node.id, x: node.x, y: node.y,
          })),
        };
      }
      return;
    }

    if (!drag) {
      setMarking(markingAt(event, screen));
      const world_ = stage.screenToWorld(screen.x, screen.y);
      const over = markAt(world_) || markNear(screen);
      const id = over ? over.id : null;
      if (id !== hoveredMarkId) {
        hoveredMarkId = id;
        stage.requestRender();
      }
      stage.cursor = pointAt(screen) || pivotAt(screen) ? "grab" : "default";
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

    if (drag.type === "line") {
      drag.to = screen;
      marking = { type: "place", imageId: drag.imageId, screen };
      if (Math.hypot(screen.x - drag.from.x, screen.y - drag.from.y) > LINE_DRAG_MIN) {
        drag.moved = true;
      }
      stage.requestRender();
      return;
    }

    const world = precisionWorld(screen, event);

    if (drag.type === "point") {
      const image = store.findImage(drag.imageId);
      if (!image) return;
      const local = worldToLocal(image, world);
      const weld = drag.precision ? null : weldCandidate(image, screen, drag);
      weldTarget = weld ? weld.screen : null;
      store.setMarkPoint(drag.markId, drag.index, weld ? weld.point : {
        x: Math.max(0, Math.min(image.width, local.x)),
        y: Math.max(0, Math.min(image.height, local.y)),
      });
      requestExtract(drag.markId);
      stage.requestRender();
      return;
    }

    if (drag.type === "pivot") {
      const image = store.findImage(drag.imageId);
      const mark = store.findMark(drag.markId);
      if (!image || !mark) return;
      const lens = TX.lens.forImage(image);
      const fitted = TX.geom.fitQuad(mark.points, lens);
      const inverse = fitted ? TX.geom.invert3(fitted) : null;
      if (!inverse) return;
      const local = worldToLocal(image, world);
      const unit = TX.geom.imageToLocal(inverse, lens, local);
      store.setMarkControl(drag.markId, drag.index, drag.which,
        TX.geom.controlOffset(drag.index, drag.which, unit));
      requestExtract(drag.markId);
      stage.requestRender();
      return;
    }

    if (drag.type === "mark") {
      const step = state.settings.snapToGrid ? state.settings.gridSize : 0;
      for (const entry of drag.start) {
        const image = store.findImage(entry.imageId);
        if (!image) continue;
        const from = worldToLocal(image, drag.origin);
        const to = worldToLocal(image, world);
        const dx = snapTo(to.x - from.x, step);
        const dy = snapTo(to.y - from.y, step);
        entry.points.forEach((point, index) => {
          store.setMarkPoint(entry.id, index, { x: point.x + dx, y: point.y + dy });
        });
        requestExtract(entry.id);
      }
      stage.requestRender();
      return;
    }

    if (drag.type === "image") {
      const dx = world.x - drag.origin.x;
      const dy = world.y - drag.origin.y;
      const step = state.settings.snapToGrid ? state.settings.gridSize : 0;
      for (const entry of drag.start) {
        const node = store.findImage(entry.id);
        if (!node) continue;
        node.x = snapTo(entry.x + dx, step);
        node.y = snapTo(entry.y + dy, step);
      }
      stage.requestRender();
    }
  }

  function onPointerUp(event) {
    if (stage.isPinching()) {
      clearHold();
      drag = null;
      return;
    }

    if (drag && drag.type === "touch-pending") {
      clearHold();
      const image = store.findImage(drag.imageId);
      const screen = drag.startScreen;
      const world = stage.screenToWorld(screen.x, screen.y);
      drag = null;
      if (image) {
        if (state.pending.points.length && state.pending.imageId === image.id) {
          addPendingPoint(image, world, screen);
        } else if (event.shiftKey) {
          store.toggleSelected("image", image.id);
        } else {
          store.select("image", image.id);
        }
      }
      stage.requestRender();
      try {
        stage.overlay.releasePointerCapture(event.pointerId);
      } catch (err) {
      }
      return;
    }

    if (drag && (drag.type === "point" || drag.type === "pivot")
        && hooks && hooks.onMarkGeometryChange) {
      hooks.onMarkGeometryChange(drag.markId);
    }
    if (drag && drag.type === "mark" && hooks && hooks.onMarkGeometryChange) {
      for (const entry of drag.start) hooks.onMarkGeometryChange(entry.id);
    }

    if (drag && drag.type === "line") {
      const image = store.findImage(drag.imageId);
      if (image) {
        const toWorld = s => stage.screenToWorld(s.x, s.y);
        if (drag.moved) {
          addPendingPoint(image, toWorld(drag.from), drag.from);
          addPendingPoint(image, toWorld(drag.to), drag.to);
        } else {
          addPendingPoint(image, toWorld(drag.from), drag.from);
        }
      }
    }

    if (drag && drag.type === "marquee" && marquee) {
      const minX = Math.min(marquee.from.x, marquee.to.x);
      const maxX = Math.max(marquee.from.x, marquee.to.x);
      const minY = Math.min(marquee.from.y, marquee.to.y);
      const maxY = Math.max(marquee.from.y, marquee.to.y);
      store.select("image", state.images
        .filter(image => {
          const b = nodeBounds(image);
          const a = stage.worldToScreen(b.minX, b.minY);
          const c = stage.worldToScreen(b.maxX, b.maxY);
          return a.x < maxX && c.x > minX && a.y < maxY && c.y > minY;
        })
        .map(image => image.id));
    }
    marquee = null;
    drag = null;
    weldTarget = null;
    finishExtract();
    stage.requestRender();
    try {
      stage.overlay.releasePointerCapture(event.pointerId);
    } catch (err) {
    }
  }

  function onWheel(event) {
    event.preventDefault();
    if (loupeGesture()) {
      const cur = loupeSampleOf();
      const next = Math.round(cur * Math.exp(event.deltaY * 0.003));
      state.settings.loupeSample = Math.max(LOUPE_SAMPLE_MIN, Math.min(LOUPE_SAMPLE_MAX, next));
      stage.requestRender();
      return;
    }
    const factor = Math.exp(-event.deltaY * 0.0015);
    stage.setZoom(stage.view.zoom * factor, stage.pointerPosition(event));
  }

  function onContextMenu(event) {
    event.preventDefault();
    if (drag) return;
    if (state.pending.points.length) {
      store.clearPending();
      stage.requestRender();
      return;
    }
    if (!hooks || !hooks.onContextMenu) return;

    const screen = stage.pointerPosition(event);
    const world = stage.screenToWorld(screen.x, screen.y);
    const mark = markAt(world);
    hooks.onContextMenu(event, {
      pane: "mark",
      markId: mark ? mark.id : null,
      imageId: mark ? mark.imageId : (imageAt(world) || {}).id || null,
    });
  }

  stage.overlay.addEventListener("pointerdown", onPointerDown);
  stage.overlay.addEventListener("pointermove", onPointerMove);
  stage.overlay.addEventListener("pointerup", onPointerUp);
  stage.overlay.addEventListener("pointercancel", onPointerUp);
  stage.overlay.addEventListener("pointerleave", () => setMarking(null));
  stage.overlay.addEventListener("wheel", onWheel, { passive: false });
  stage.overlay.addEventListener("contextmenu", onContextMenu);

  stage.setOverlayPainter(paint);

  const stopWatch = watch(
    () => [state.images.length, state.images.map(i => `${i.x},${i.y},${i.scaleX},${i.scaleY},${i.rotation}`).join("|")],
    syncMeshes,
    { flush: "post" },
  );
  const stopRepaint = watch(
    () => [state.marks, state.pending, state.selection, state.settings],
    () => stage.requestRender(),
    { deep: true },
  );

  syncMeshes();


  async function loadFiles(files) {
    const accepted = Array.from(files).filter(f => /^image\/(png|jpeg|jpg|bmp|webp)$/i.test(f.type) || /\.(png|jpe?g|bmp|webp)$/i.test(f.name));
    if (!accepted.length) {
      if (hooks && hooks.onNotice) hooks.onNotice(TX.t("mark.notice.no_images"), "warning");
      return 0;
    }

    const firstImport = !state.images.length;
    let placeX = state.images.reduce((max, image) => Math.max(max, image.x + image.width * image.scaleX), 0);
    if (state.images.length) placeX += 32;

    let added = 0;
    const loaded = [];
    for (const file of accepted) {
      try {
        const element = await decodeFile(file);
        const source = TX.warp.createSource(element);
        const image = store.addImage({
          name: file.name,
          width: element.naturalWidth,
          height: element.naturalHeight,
          x: placeX,
          y: 0,
          file,
        });
        store.assets.sources.set(image.id, { element, source });
        loaded.push(image.id);
        placeX += element.naturalWidth + 32;
        added++;
      } catch (err) {
        if (hooks && hooks.onNotice) {
          hooks.onNotice(TX.t("mark.notice.load_failed", { name: file.name }), "error");
        }
      }
    }

    if (TX.depthScene.settingsOf(state.settings.depth).enabled) {
      for (const id of loaded) TX.depthModel.estimate(id);
    }

    syncMeshes();
    if (added && firstImport) fitAll();
    return added;
  }

  const decodeFile = file => TX.io.decodeBlob(file);

  function fitAll() {
    const bounds = unionBounds(state.images.map(nodeBounds));
    if (bounds) stage.fitTo(bounds);
    else {
      stage.view.zoom = 1;
      stage.view.panX = 400;
      stage.view.panY = 300;
      stage.requestRender();
    }
  }

  function revealMark(markId) {
    const mark = store.findMark(markId);
    const image = mark && store.findImage(mark.imageId);
    if (!mark || !image) return;

    revealedMarkId = markId;
    revealedAt = performance.now();

    const points = markWorldPoints(image, mark).map(p => stage.worldToScreen(p.x, p.y));
    const margin = 24;
    const inside = points.every(p =>
      p.x > margin && p.y > margin
      && p.x < stage.view.width - margin && p.y < stage.view.height - margin);
    if (!inside) {
      const bounds = points.reduce((box, p) => ({
        minX: Math.min(box.minX, p.x), minY: Math.min(box.minY, p.y),
        maxX: Math.max(box.maxX, p.x), maxY: Math.max(box.maxY, p.y),
      }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      const centre = stage.screenToWorld(
        (bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
      stage.centreOn(centre.x, centre.y);
    }
    stage.requestRender();
  }

  function selectAll() {
    store.selectAllOf(store.selectedKind() === "mark" ? "mark" : "image");
    stage.requestRender();
  }

  function deleteSelected() {
    const marks = store.selectedIds("mark").slice();
    if (marks.length) {
      for (const id of marks) store.removeMark(id);
      syncMeshes();
      return marks.length;
    }
    const ids = store.selectedIds("image").slice();
    for (const id of ids) store.removeImage(id);
    syncMeshes();
    return ids.length;
  }

  function dispose() {
    stopWatch();
    stopRepaint();
    stage.dispose();
    geometry.dispose();
  }

  return {
    stage, loadFiles, fitAll, revealMark, selectAll, deleteSelected, syncMeshes, dispose,
  };
}

TX.markCanvas = { createMarkCanvas };

