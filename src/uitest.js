// Synthetic pointer events; headless needs repaint + overlay cleanup
import { nextTick } from "vue";
import { TX } from "./tx.js";
import "./main.js";

const lines = [];
let failures = 0;

const store = TX.store;

function check(name, ok, detail) {
  if (!ok) failures++;
  lines.push(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = async () => { await nextTick(); await sleep(16); };

const repaint = stage => {
  stage.requestRender();
  stage.renderNow();
};

const waitFor = async predicate => {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return true;
    await sleep(20);
  }
  return false;
};

// Headless: hide closed Vuetify overlays (leave transition never runs)
const dismissOverlays = () => {
  for (const overlay of document.querySelectorAll(".v-overlay")) {
    const shown = overlay.classList.contains("v-overlay--active");
    for (const el of overlay.querySelectorAll(".v-overlay__content, .v-overlay__scrim")) {
      el.style.display = shown ? "" : "none";
    }
  }
};

const settingsMenu = () => {
  const el = document.querySelector(".tx-settings-menu");
  const overlay = el && el.closest(".v-overlay");
  return overlay && overlay.classList.contains("v-overlay--active") ? el : null;
};

const closeSettingsMenu = async () => {
  if (!settingsMenu()) return;
  const close = document.querySelector(".tx-settings-close");
  if (close) close.click();
  else document.querySelector(".tx-settings-btn")?.click();
  await waitFor(() => !settingsMenu());
  dismissOverlays();
};

const centreOf = el => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

const pointer = (type, x, y) => new PointerEvent(type, {
  bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, clientX: x, clientY: y,
});

async function dragFrom(el, to) {
  const from = centreOf(el);
  el.dispatchEvent(pointer("pointerdown", from.x, from.y));
  // Two moves: the first crosses the drag threshold, the second settles the target.
  window.dispatchEvent(pointer("pointermove", (from.x + to.x) / 2, (from.y + to.y) / 2));
  window.dispatchEvent(pointer("pointermove", to.x, to.y));
  await settle();
  window.dispatchEvent(pointer("pointerup", to.x, to.y));
  await settle();
}

const tabOf = panelId => document.querySelector(`[data-dock-tab="${panelId}"]`);
const groupOf = panelId => {
  const node = TX.dockTree.findPanel(TX.app.dockState.root, panelId);
  return node ? document.querySelector(`[data-dock-group="${node.id}"]`) : null;
};
const panelsWith = panelId => {
  const node = TX.dockTree.findPanel(TX.app.dockState.root, panelId);
  return node ? node.panels.join(",") : "(not docked)";
};

async function run() {
  const ready = await waitFor(() => window.TX && TX.app && TX.app.dockState && TX.app.tilingPanel);
  check("the app mounts and builds a dock", ready);
  if (!ready) return;
  await settle();

  const app = TX.app;
  if (app.introOpen) {
    app.introOpen = false;
    TX.intro.saveSeen();
    await settle();
  }
  const dock = TX.dockTree;

  // ---- default layout ----------------------------------------------------
  const panelIds = ["mark", "atlas", "tiling", "preview3d", "properties"];
  check("every panel is in the default layout",
    dock.collectPanels(app.dockState.root).sort().join(",") === panelIds.slice().sort().join(","),
    dock.collectPanels(app.dockState.root).join(","));

  for (const id of panelIds) {
    const el = TX.dock.content.get(id);
    const node = dock.findPanel(app.dockState.root, id);
    const onScreen = !!el && !!el.closest("[data-dock-slot]");
    const expected = !!node && node.active === id;
    check(`${id} content is registered and ${expected ? "on screen" : "parked"}`,
      !!el && onScreen === expected,
      el ? (el.parentElement && el.parentElement.className) : "missing");
  }

  check("the properties panel rendered its controls",
    !!TX.dock.content.get("properties").querySelector(".tx-props"));
  check("the properties panel shows the empty-selection hint",
    /Select something to edit it/.test(TX.dock.content.get("properties").textContent));

  const tilingEl = TX.dock.content.get("tiling");
  const glCanvas = tilingEl.querySelector("canvas.tx-layer--gl");
  check("the tiling panel has a WebGL canvas", !!glCanvas);
  check("its renderer context is not lost",
    !app.tilingPanel.stage.renderer.getContext().isContextLost());
  const sizeBefore = `${glCanvas.width}x${glCanvas.height}`;
  check("the WebGL canvas was sized by its container", glCanvas.width > 1 && glCanvas.height > 1,
    sizeBefore);

  // ---- drag a tab into another group (tab drop) --------------------------
  const markGroup = groupOf("mark");
  const markBody = markGroup.querySelector(".tx-dock-body");
  await dragFrom(tabOf("tiling"), centreOf(markBody));

  check("dropping on a panel body joins that tab group",
    panelsWith("tiling") === "mark,tiling", panelsWith("tiling"));
  check("the dropped panel becomes active",
    dock.findPanel(app.dockState.root, "tiling").active === "tiling");
  check("moving a panel does not duplicate it",
    dock.collectPanels(app.dockState.root).filter(p => p === "tiling").length === 1);

  check("the WebGL canvas survived the move as the same element",
    tilingEl.querySelector("canvas.tx-layer--gl") === glCanvas);
  check("the context is still alive after the move",
    !app.tilingPanel.stage.renderer.getContext().isContextLost());
  check("the moved panel is inside its new group",
    tilingEl.closest("[data-dock-group]") === groupOf("tiling"));

  const markEl = TX.dock.content.get("mark");
  check("the hidden sibling is parked rather than discarded",
    !!markEl.closest(".tx-dock-parking") && !!app.mark.stage,
    markEl.parentElement ? markEl.parentElement.className : "detached");

  // ---- split a group by dropping near one of its inner edges -------------
  const propsRect = groupOf("properties").getBoundingClientRect();
  await dragFrom(tabOf("tiling"),
    { x: propsRect.left + 5, y: propsRect.top + propsRect.height / 2 });

  check("an edge drop splits instead of tabbing",
    panelsWith("tiling") === "tiling" && panelsWith("properties") === "properties",
    `${panelsWith("properties")} / ${panelsWith("tiling")}`);
  const row = app.dockState.root;
  const propsIndex = row.children.findIndex(
    c => c.type === "tabs" && c.panels.includes("properties"));
  check("a same-direction split extends the existing row",
    row.dir === "row" && row.children.length === 3, `${row.dir} children=${row.children.length}`);
  check("the panel landed on the side it was dropped",
    propsIndex > 0 && row.children[propsIndex - 1].panels.join(",") === "tiling",
    row.children.map(c => (c.panels || []).join("+")).join(" | "));
  check("the canvas still survived the split",
    tilingEl.querySelector("canvas.tx-layer--gl") === glCanvas
    && !app.tilingPanel.stage.renderer.getContext().isContextLost());

  // ---- dock against the outer edge of the whole window -------------------
  const surfaceRect = document.querySelector(".tx-dock").getBoundingClientRect();
  await dragFrom(tabOf("tiling"), {
    x: surfaceRect.left + surfaceRect.width / 2,
    y: surfaceRect.bottom - 4,
  });

  const rooted = app.dockState.root;
  check("dropping at the window edge wraps the whole layout",
    rooted.dir === "col" && rooted.children.length === 2
    && rooted.children[1].panels.join(",") === "tiling",
    `${rooted.dir} ${rooted.children.map(c => c.type).join("/")}`);
  check("the edge panel takes the smaller share",
    rooted.sizes[1] < rooted.sizes[0], rooted.sizes.map(s => s.toFixed(2)).join("/"));

  // ---- split perpendicular to the parent --------------------------------
  const markRect = groupOf("mark").getBoundingClientRect();
  await dragFrom(tabOf("tiling"), {
    x: markRect.left + markRect.width / 2,
    y: markRect.bottom - 5,
  });
  const markParent = dock.findParent(app.dockState.root, dock.findPanel(app.dockState.root, "mark").id);
  const markAt = markParent
    ? markParent.children.findIndex(c => c.panels && c.panels.includes("mark")) : -1;
  check("a perpendicular split nests a new column",
    !!markParent && markParent.dir === "col" && markAt >= 0
    && markParent.children[markAt + 1]
    && markParent.children[markAt + 1].panels.join(",") === "tiling",
    markParent ? `${markParent.dir} ${markParent.children.map(c => (c.panels || []).join("+")).join("/")}` : "none");

  // ---- tear a panel off into a floating window ---------------------------
  await dragFrom(tabOf("properties"), { x: 300, y: 2 });

  check("dragging outside the dock creates a floating window",
    app.dockState.floating.length === 1, `floating=${app.dockState.floating.length}`);
  check("the floated panel left the tree",
    !dock.collectPanels(app.dockState.root).includes("properties"),
    dock.collectPanels(app.dockState.root).join(","));

  const floatEl = document.querySelector(".tx-dock-float");
  check("the floating window is rendered", !!floatEl);
  check("its content moved into the floating window",
    !!floatEl && TX.dock.content.get("properties").closest(".tx-dock-float") === floatEl);
  check("the teleported controls came with it",
    !!TX.dock.content.get("properties").querySelector(".tx-props"));

  // ---- move and resize the floating window -------------------------------
  const win = app.dockState.floating[0];
  const before = { x: win.x, y: win.y, w: win.w, h: win.h };
  const header = floatEl.querySelector(".tx-dock-tabfill");
  const headerAt = centreOf(header);
  header.dispatchEvent(pointer("pointerdown", headerAt.x, headerAt.y));
  window.dispatchEvent(pointer("pointermove", headerAt.x + 70, headerAt.y + 50));
  window.dispatchEvent(pointer("pointerup", headerAt.x + 70, headerAt.y + 50));
  await settle();
  check("the floating window can be dragged",
    Math.abs(win.x - before.x - 70) < 2 && Math.abs(win.y - before.y - 50) < 2,
    `${before.x},${before.y} -> ${win.x},${win.y}`);

  const corner = floatEl.querySelector(".tx-dock-corner--se");
  const cornerAt = centreOf(corner);
  corner.dispatchEvent(pointer("pointerdown", cornerAt.x, cornerAt.y));
  window.dispatchEvent(pointer("pointermove", cornerAt.x + 60, cornerAt.y + 40));
  window.dispatchEvent(pointer("pointerup", cornerAt.x + 60, cornerAt.y + 40));
  await settle();
  check("the floating window can be resized",
    Math.abs(win.w - before.w - 60) < 2 && Math.abs(win.h - before.h - 40) < 2,
    `${before.w}x${before.h} -> ${win.w}x${win.h}`);

  // ---- drag it back into the dock ----------------------------------------
  await dragFrom(tabOf("properties"), centreOf(groupOf("mark").querySelector(".tx-dock-body")));
  check("a floating panel can be docked again",
    app.dockState.floating.length === 0 && panelsWith("properties").includes("properties"),
    `floating=${app.dockState.floating.length} group=${panelsWith("properties")}`);
  check("re-docking does not lose the panel",
    dock.collectPanels(app.dockState.root).sort().join(",") === panelIds.slice().sort().join(","),
    dock.collectPanels(app.dockState.root).join(","));

  // ---- splitters ---------------------------------------------------------
  const rootNode = app.dockState.root;
  check("the root is a split", rootNode.type === "split", rootNode.type);
  if (rootNode.type === "split") {
    const gutter = document.querySelector(`[data-dock-node="${rootNode.id}"] > .tx-dock-gutter`);
    check("the root split has a gutter", !!gutter);
    if (gutter) {
      const sizesBefore = app.dockState.root.sizes.slice();
      const at = centreOf(gutter);
      const dx = rootNode.dir === "row" ? 90 : 0;
      const dy = rootNode.dir === "row" ? 0 : 90;
      gutter.dispatchEvent(pointer("pointerdown", at.x, at.y));
      window.dispatchEvent(pointer("pointermove", at.x + dx, at.y + dy));
      window.dispatchEvent(pointer("pointerup", at.x + dx, at.y + dy));
      await settle();
      const sizesAfter = app.dockState.root.sizes;
      check("dragging a gutter grows the pane before it",
        sizesAfter[0] > sizesBefore[0] + 0.01, `${sizesBefore[0].toFixed(3)} -> ${sizesAfter[0].toFixed(3)}`);
      check("gutter drag keeps the sizes normalised",
        Math.abs(sizesAfter.reduce((a, b) => a + b, 0) - 1) < 1e-6,
        sizesAfter.map(s => s.toFixed(3)).join("/"));
    }
  }

  // ---- maximise, close and reopen ---------------------------------------
  const maxButton = groupOf("atlas").querySelector(".tx-dock-btn");
  maxButton.click();
  await settle();
  check("maximising shows a single panel", app.dockState.maximized === "atlas",
    String(app.dockState.maximized));
  check("the maximised panel holds the content",
    TX.dock.content.get("atlas").closest(".tx-dock-group--max") !== null);
  document.querySelector(".tx-dock-group--max .tx-dock-btn").click();
  await settle();
  check("restoring returns the panel to its group",
    app.dockState.maximized === null && !!TX.dock.content.get("atlas").closest("[data-dock-slot]"));

  const dockComponent = app.$refs.dock;
  dockComponent.closePanel("tiling");
  await settle();
  check("closing removes the panel from the layout",
    !dock.collectPanels(app.dockState.root).includes("tiling"),
    dock.collectPanels(app.dockState.root).join(","));
  check("a closed panel keeps its content parked",
    !!TX.dock.content.get("tiling").closest(".tx-dock-parking"));
  check("the menu reports it as hidden", !app.isPanelVisible("tiling"));

  dockComponent.openPanel("tiling");
  await settle();
  check("reopening docks it again", app.isPanelVisible("tiling"));
  check("its canvas is still the original element with a live context",
    tilingEl.querySelector("canvas.tx-layer--gl") === glCanvas
    && !app.tilingPanel.stage.renderer.getContext().isContextLost());

  // ---- and the same thing from the menu it is offered in -----------------
  document.querySelector(".tx-settings-btn").click();
  await settle();
  check("the settings menu opens", !!settingsMenu());
  if (settingsMenu()) {
    const rowFor = title => [...settingsMenu().querySelectorAll(".tx-settings-item")]
      .find(el => el.textContent.trim() === title);

    check("it lists a row per panel",
      panelIds.every(id => !!rowFor(app.panelDefs[id].title)),
      [...settingsMenu().querySelectorAll(".tx-settings-item")].map(el => el.textContent.trim())
        .join(","));
    check("and offers to put the layout back", !!rowFor("Reset layout"));

    const tilingRow = () => rowFor(app.panelDefs.tiling.title);
    check("the showing ones are ticked",
      !!tilingRow() && tilingRow().classList.contains("tx-settings-item--on"));

    tilingRow().click();
    await settle();
    check("clicking a row closes that panel", !app.isPanelVisible("tiling"));
    check("and the menu is still up to click the next one", !!settingsMenu());
    check("with the row no longer ticked",
      !!tilingRow() && !tilingRow().classList.contains("tx-settings-item--on"));

    tilingRow().click();
    await settle();
    check("clicking it again brings the panel back", app.isPanelVisible("tiling"));

    rowFor("Reset layout").click();
    check("resetting the layout closes the menu, having nothing left to offer",
      await waitFor(() => !settingsMenu()));
  }
  await closeSettingsMenu();

  // ---- persistence -------------------------------------------------------
  const saved = TX.dock.load(app.dockState.mode || "desktop");
  check("the layout is persisted", !!saved && TX.dockTree.isValid(saved.root));
  localStorage.setItem(TX.dock.LAYOUT_KEY, JSON.stringify({ v: 999, data: saved }));
  check("a layout from another version is refused", TX.dock.load("desktop") === null);
  TX.dock.save(app.dockState);
  check("saving again makes it readable", !!TX.dock.load(app.dockState.mode || "desktop"));
  check("the persisted layout matches what is on screen",
    !!saved && dock.collectPanels(saved.root).sort().join(",")
      === dock.collectPanels(app.dockState.root).sort().join(","),
    saved ? dock.collectPanels(saved.root).join(",") : "none");

  check("reconcile survives a stale saved layout",
    dock.reconcile(saved.root, ["mark", "atlas"]) !== null);

  app.dockState.reset();
  await settle();
  check("resetting restores every panel",
    dock.collectPanels(app.dockState.root).sort().join(",") === panelIds.slice().sort().join(","),
    dock.collectPanels(app.dockState.root).join(","));
  check("panels are still alive after a reset",
    !app.tilingPanel.stage.renderer.getContext().isContextLost()
    && !!TX.dock.content.get("properties").querySelector(".tx-props"));

  await runViewportChecks(app);
  await runLocalSpaceChecks(app);
}

async function runLocalSpaceChecks(app) {
  const store = TX.store;
  const state = store.state;
  const overlay = TX.dock.content.get("mark").querySelector(".tx-layer--overlay");
  check("the mark panel has an overlay to draw on", !!overlay);
  if (!overlay) return;

  store.resetAll();
  app.mark.syncMeshes();
  app.atlas.syncMeshes();
  await settle();

  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, 100, 100);
  ctx.fillStyle = "#00ff00"; ctx.fillRect(100, 0, 100, 100);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  await app.mark.loadFiles([new File([blob], "ui-source.png", { type: "image/png" })]);
  await settle();
  check("a source image loaded into the mark panel", state.images.length === 1,
    String(state.images.length));
  if (!state.images.length) return;

  {
    const tips = [...document.querySelectorAll(".tx-source-tip")];
    check("both first-time tips are showing", tips.length === 2, String(tips.length));
    for (const tip of tips) {
      const host = tip.closest(".tx-source-empty-host");
      const card = tip.getBoundingClientRect();
      const panel = host.getBoundingClientRect();
      check("a tip can use the width of the panel it sits over",
        card.width > panel.width * 0.5,
        `${Math.round(card.width)} of ${Math.round(panel.width)}`);
      check("and is still centred in it",
        Math.abs((card.left - panel.left) - (panel.right - card.right)) < 2,
        `${Math.round(card.left - panel.left)} vs ${Math.round(panel.right - card.right)}`);
    }
  }

  const image = state.images[0];
  const stage = app.mark.stage;
  stage.setViewport({ panX: 30, panY: 30, zoom: 2 });
  await settle();
  const box = overlay.getBoundingClientRect();
  const at = (x, y) => {
    const world = TX.stage.localToWorld(image, { x, y });
    const screen = stage.worldToScreen(world.x, world.y);
    return { x: box.left + screen.x, y: box.top + screen.y };
  };
  const ctrl = (type, p) => new PointerEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 2,
    clientX: p.x, clientY: p.y, ctrlKey: true,
  });
  const plain = (type, p, init) => new PointerEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 2,
    clientX: p.x, clientY: p.y, ...init,
  });

  {
    const hover = (p, mods) => new PointerEvent("pointermove", {
      bubbles: true, cancelable: true, buttons: 0, pointerId: 3,
      clientX: p.x, clientY: p.y, ...mods,
    });
    const ink = () => {
      repaint(stage);
      const pixels = stage.overlay.getContext("2d")
        .getImageData(0, 0, stage.overlay.width, stage.overlay.height).data;
      let lit = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 8) lit++;
      return lit;
    };
    const middle = at(50, 50);
    overlay.dispatchEvent(hover(middle));
    await settle();
    const bare = ink();
    overlay.dispatchEvent(hover(middle, { ctrlKey: true }));
    await settle();
    const withLoupe = ink();
    check("holding Ctrl over a photograph raises the loupe",
      withLoupe > bare + 5000, `${bare} -> ${withLoupe} lit pixels`);

    const zoomBefore = stage.view.zoom;
    const sampleBefore = state.settings.loupeSample;
    overlay.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, cancelable: true, deltaY: 240, ctrlKey: true,
      clientX: middle.x, clientY: middle.y,
    }));
    await settle();
    check("and the wheel zooms the loupe rather than the panel",
      state.settings.loupeSample > sampleBefore && stage.view.zoom === zoomBefore,
      `${sampleBefore} -> ${state.settings.loupeSample}`);
    state.settings.loupeSample = sampleBefore;

    overlay.dispatchEvent(hover(middle));
    await settle();
    const released = ink();
    check("and letting go of Ctrl puts it away", released < bare + 1000,
      `${released} vs ${bare} lit pixels`);
  }

  overlay.dispatchEvent(ctrl("pointerdown", at(10, 10)));
  overlay.dispatchEvent(ctrl("pointermove", at(90, 10)));
  overlay.dispatchEvent(ctrl("pointerup", at(90, 10)));
  await settle();
  check("dragging a line places both of its ends", state.pending.points.length === 2,
    String(state.pending.points.length));

  overlay.dispatchEvent(ctrl("pointerdown", at(90, 80)));
  overlay.dispatchEvent(ctrl("pointermove", at(10, 80)));
  overlay.dispatchEvent(ctrl("pointerup", at(10, 80)));
  await settle();
  check("two lines complete a mark", state.marks.length === 1 && !state.pending.points.length,
    `marks=${state.marks.length} pending=${state.pending.points.length}`);
  if (!state.marks.length) return;

  {
    const first = store.soleSelected("texture");
    check("the first extraction selects the slice it made",
      !!first && first.markId === state.marks[0].id, first ? first.name : "nothing selected");
    const framed = { ...app.tilingPanel.stage.view };
    app.tilingPanel.fit();
    const view = app.tilingPanel.stage.view;
    check("and the tiling preview has already framed it",
      view.zoom === framed.zoom && view.panX === framed.panX && view.panY === framed.panY,
      `zoom ${framed.zoom.toFixed(3)} -> ${view.zoom.toFixed(3)}`);
  }

  const mark = state.marks[0];
  check("the mark starts with default local space",
    TX.geom.isUnitDomain(mark.domain) && TX.geom.isFlatCurve(mark.curve));

  state.settings.weldRadius = 12;
  store.addMark(image.id, [
    { x: 150, y: 10 }, { x: 190, y: 10 }, { x: 190, y: 80 }, { x: 150, y: 80 },
  ]);
  await settle();
  const neighbour = state.marks[1];
  const target = { ...mark.points[1] };
  overlay.dispatchEvent(plain("pointerdown", at(neighbour.points[0].x, neighbour.points[0].y)));
  overlay.dispatchEvent(plain("pointermove", at(target.x + 2, target.y + 2)));
  overlay.dispatchEvent(plain("pointerup", at(target.x + 2, target.y + 2)));
  await settle();
  check("a dragged corner welds onto the one it was dropped near",
    neighbour.points[0].x === target.x && neighbour.points[0].y === target.y,
    `${neighbour.points[0].x},${neighbour.points[0].y} vs ${target.x},${target.y}`);

  state.settings.weldRadius = 0;
  const dropAt = { x: target.x + 3, y: target.y + 3 };
  overlay.dispatchEvent(plain("pointerdown", at(neighbour.points[1].x, neighbour.points[1].y)));
  overlay.dispatchEvent(plain("pointermove", at(dropAt.x, dropAt.y)));
  overlay.dispatchEvent(plain("pointerup", at(dropAt.x, dropAt.y)));
  await settle();
  check("welding can be turned off",
    Math.abs(neighbour.points[1].x - dropAt.x) < 0.01
    && Math.abs(neighbour.points[1].y - dropAt.y) < 0.01,
    `${neighbour.points[1].x},${neighbour.points[1].y} vs ${dropAt.x},${dropAt.y}`);
  store.removeMark(neighbour.id);
  state.settings.weldRadius = 8;

  const h = TX.geom.squareToQuad(mark.points);
  const controlAt = u => TX.geom.applyHomography(h, u, 0);

  const dragHandle = async (from, dy) => {
    overlay.dispatchEvent(plain("pointermove", at(from.x, from.y)));
    await settle();
    overlay.dispatchEvent(plain("pointerdown", at(from.x, from.y)));
    overlay.dispatchEvent(plain("pointermove", at(from.x, from.y + dy)));
    overlay.dispatchEvent(plain("pointerup", at(from.x, from.y + dy)));
    await settle();
  };

  await dragHandle(controlAt(1 / 3), -20);
  check("dragging a handle bends its edge", !TX.geom.isFlatCurve(mark.curve),
    JSON.stringify(mark.curve[0]));
  check("it moved the handle it was holding and not the other one",
    Math.abs(mark.curve[0].a.y) > 0.01 && mark.curve[0].b.y === 0,
    `a=${mark.curve[0].a.y.toFixed(3)} b=${mark.curve[0].b.y.toFixed(3)}`);
  check("bending only touches the edge that was dragged",
    [1, 2, 3].every(k => TX.geom.isStraight(mark.curve[k])),
    JSON.stringify(mark.curve.slice(1)));
  check("bending leaves nothing waiting to be extracted", mark.dirty === false);

  const controls = TX.geom.edgeControls(mark.curve, 0);
  const landed = TX.geom.applyHomography(h, controls[0].x, controls[0].y);
  const wanted = controlAt(1 / 3);
  check("the handle lands where it was dropped",
    Math.hypot(landed.x - wanted.x, landed.y - (wanted.y - 20)) < 1.5,
    `${landed.x.toFixed(1)},${landed.y.toFixed(1)} vs `
    + `${wanted.x.toFixed(1)},${(wanted.y - 20).toFixed(1)}`);

  await dragHandle(controlAt(2 / 3), 20);
  const edgeMiddle = TX.geom.edgePoint(TX.geom.curveOf(mark.curve), 0, 0.5);
  check("opposite handles make an S-curve rather than a bow",
    mark.curve[0].a.y < -0.01 && mark.curve[0].b.y > 0.01 && Math.abs(edgeMiddle.y) < 0.02,
    `a=${mark.curve[0].a.y.toFixed(3)} b=${mark.curve[0].b.y.toFixed(3)} `
    + `mid=${edgeMiddle.y.toFixed(3)}`);

  store.resetMarkLocalSpace(mark.id);

  await app.actions.convert("all");
  await settle();
  const texture = state.textures.find(t => t.markId === mark.id);
  check("the marked quad extracted", !!texture);
  if (!texture) return;

  store.select("texture", texture.id);
  app.atlas.stage.setViewport({ panX: 30, panY: 30, zoom: 1 });
  await settle();

  // ---- reshaping the mark updates the atlas without being asked ----------
  const cornerBefore = { ...mark.points[0] };
  const pixelsBefore = store.assets.textures.get(texture.id).canvas;
  const stageSizeBefore = texture.width * texture.scaleX;
  const dropCorner = { x: cornerBefore.x + 18, y: cornerBefore.y + 12 };
  TX.history.commit();
  await settle();
  const depthBefore = TX.history.status.depth;

  overlay.dispatchEvent(plain("pointerdown", at(cornerBefore.x, cornerBefore.y)));
  overlay.dispatchEvent(plain("pointermove", at(dropCorner.x, dropCorner.y)));
  await settle();
  overlay.dispatchEvent(plain("pointerup", at(dropCorner.x, dropCorner.y)));
  await settle();

  check("dragging a corner moved it",
    Math.abs(mark.points[0].x - dropCorner.x) < 1 && Math.abs(mark.points[0].y - dropCorner.y) < 1,
    `${mark.points[0].x.toFixed(1)},${mark.points[0].y.toFixed(1)}`);
  check("moving the source rect re-warps the texture without pressing Extract",
    store.assets.textures.get(texture.id).canvas !== pixelsBefore);
  check("and leaves nothing waiting to be extracted", mark.dirty === false,
    String(mark.dirty));
  check("the slice keeps the size it had on the sheet",
    Math.abs(texture.width * texture.scaleX - stageSizeBefore) < 0.01,
    `${(texture.width * texture.scaleX).toFixed(2)} vs ${stageSizeBefore.toFixed(2)}`);
  TX.history.commit();
  await settle();
  check("the whole drag is a single step on the timeline",
    TX.history.status.depth === depthBefore + 1,
    `${depthBefore} -> ${TX.history.status.depth}`);

  store.setMarkPoint(mark.id, 0, cornerBefore);
  app.actions.reextract(mark.id);
  await settle();
  const shift = (type, p) => new PointerEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 2,
    clientX: p.x, clientY: p.y, shiftKey: true,
  });
  overlay.dispatchEvent(shift("pointerdown", at(cornerBefore.x, cornerBefore.y)));
  overlay.dispatchEvent(shift("pointermove", at(dropCorner.x, dropCorner.y)));
  await settle();
  {
    const precise = Math.hypot(
      mark.points[0].x - cornerBefore.x, mark.points[0].y - cornerBefore.y);
    const full = Math.hypot(dropCorner.x - cornerBefore.x, dropCorner.y - cornerBefore.y);
    check("Shift+drag moves a corner more slowly than a plain drag",
      precise > 0.5 && precise < full * 0.45,
      `precise ${precise.toFixed(1)} vs full ${full.toFixed(1)}`);
  }
  {
    const sampleBefore = state.settings.loupeSample;
    const wheel = delta => overlay.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, cancelable: true, deltaY: delta,
      clientX: box.left + 40, clientY: box.top + 40,
    }));
    const zoomBefore = stage.view.zoom;
    for (let i = 0; i < 40; i++) wheel(120);
    await settle();
    check("the wheel zooms the loupe out far past a single texel",
      state.settings.loupeSample >= 512, String(state.settings.loupeSample));
    check("and leaves the stage zoom alone while a corner is moving",
      stage.view.zoom === zoomBefore);
    for (let i = 0; i < 60; i++) wheel(-120);
    await settle();
    check("and back in to a handful of source pixels",
      state.settings.loupeSample <= 12, String(state.settings.loupeSample));
    state.settings.loupeSample = sampleBefore;
  }
  overlay.dispatchEvent(shift("pointerup", at(dropCorner.x, dropCorner.y)));
  await settle();
  store.setMarkPoint(mark.id, 0, cornerBefore);
  app.actions.reextract(mark.id);
  await settle();

  const bendBefore = store.assets.textures.get(texture.id).canvas;
  const bendControl = TX.geom.edgeControls(mark.curve, 2)[0];
  const bendPivot = TX.geom.applyHomography(
    TX.geom.squareToQuad(mark.points), bendControl.x, bendControl.y);
  overlay.dispatchEvent(plain("pointermove", at(bendPivot.x, bendPivot.y)));
  await settle();
  overlay.dispatchEvent(plain("pointerdown", at(bendPivot.x, bendPivot.y)));
  overlay.dispatchEvent(plain("pointermove", at(bendPivot.x, bendPivot.y - 14)));
  overlay.dispatchEvent(plain("pointerup", at(bendPivot.x, bendPivot.y - 14)));
  await settle();
  check("bending an edge re-warps it too",
    store.assets.textures.get(texture.id).canvas !== bendBefore && mark.dirty === false);

  for (let k = 0; k < 4; k++) store.setMarkCurve(mark.id, k, null);
  store.setMarkPoint(mark.id, 0, cornerBefore);
  app.actions.reextract(mark.id);
  await settle();

  const atlasOverlay = TX.dock.content.get("atlas").querySelector(".tx-layer--overlay");
  const atlasBox = atlasOverlay.getBoundingClientRect();
  const rightEdge = TX.stage.nodeCenter(texture);
  const edgeWorld = { x: texture.x + texture.width * texture.scaleX, y: rightEdge.y };
  const edgeScreen = app.atlas.stage.worldToScreen(edgeWorld.x, edgeWorld.y);
  const from = { x: atlasBox.left + edgeScreen.x, y: atlasBox.top + edgeScreen.y };
  const widthBefore = texture.width;

  atlasOverlay.dispatchEvent(plain("pointerdown", from, { altKey: true }));
  atlasOverlay.dispatchEvent(plain("pointermove", { x: from.x + 60, y: from.y }, { altKey: true }));
  atlasOverlay.dispatchEvent(plain("pointerup", { x: from.x + 60, y: from.y }, { altKey: true }));
  await settle();

  check("alt-dragging the edge handle extends the domain in local space",
    mark.domain.u1 > 1.05, `u1=${mark.domain.u1.toFixed(3)}`);
  check("the other three sides are untouched",
    mark.domain.u0 === 0 && mark.domain.v0 === 0 && mark.domain.v1 === 1,
    JSON.stringify(mark.domain));
  check("extending re-warps the texture rather than scaling it",
    texture.width > widthBefore, `${widthBefore} -> ${texture.width}`);

  const before = { ...mark.domain };
  const middle = TX.stage.nodeCenter(texture);
  const middleScreen = app.atlas.stage.worldToScreen(middle.x, middle.y);
  const bodyFrom = { x: atlasBox.left + middleScreen.x, y: atlasBox.top + middleScreen.y };
  atlasOverlay.dispatchEvent(plain("pointerdown", bodyFrom, { altKey: true }));
  atlasOverlay.dispatchEvent(plain("pointermove", { x: bodyFrom.x + 40, y: bodyFrom.y }, { altKey: true }));
  atlasOverlay.dispatchEvent(plain("pointerup", { x: bodyFrom.x + 40, y: bodyFrom.y }, { altKey: true }));
  await settle();
  check("alt-dragging the body slides the window",
    mark.domain.u0 > before.u0 + 0.01
    && Math.abs((mark.domain.u1 - mark.domain.u0) - (before.u1 - before.u0)) < 0.01,
    `${JSON.stringify(before)} -> ${JSON.stringify(mark.domain)}`);

  check("local space survives the view record", (() => {
    const record = store.viewRecord();
    store.resetMarkLocalSpace(mark.id);
    store.applyViewRecord(record, 0);
    return Math.abs(mark.domain.u0 - before.u0) > 0.001 || mark.domain.u1 > 1.05;
  })(), JSON.stringify(mark.domain));

  await runLightingChecks(app, texture);
  await runOverlayChecks(app, texture);
  await runTilingBarChecks(app, texture);
  await runStatusBarChecks(app, texture);
  await runPreview3dChecks(app, texture);
  await runLivePreviewChecks(app, texture);
  await runPropertyGroupChecks(texture);
  await runSelectionChecks(app, mark, texture);
  await runRectifyChecks(app, mark);
  await runLensChecks(app, mark);
  await runFadeChecks(app, texture);
  await runSnapChecks(app, texture);
  await runSaveImageChecks(app, mark);
  await runDetailChecks(app, texture);
  await runProgressChecks(app, texture);
  await runTooltipChecks(app);
  runLicenceChecks();
  await runHistoryChecks(app, texture);
}

async function runSnapChecks(app, texture) {
  const store = TX.store;
  const state = store.state;
  const overlay = TX.dock.content.get("atlas").querySelector("canvas.tx-layer--overlay");
  if (!overlay) {
    check("the atlas has an overlay to drag on", false);
    return;
  }

  const anchor = store.addTexture({
    name: "snap-anchor", width: 103, height: 61, x: 0, y: 0, scaleX: 1, scaleY: 1,
  });
  const canvas = document.createElement("canvas");
  canvas.width = 103;
  canvas.height = 61;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#446688";
  ctx.fillRect(0, 0, 103, 61);
  store.setTextureCanvas(anchor.id, canvas);

  const mover = store.findTexture(texture.id);
  Object.assign(mover, { scaleX: 1, scaleY: 1, rotation: 0, y: 0 });
  app.atlas.syncMeshes();
  store.select("texture", mover.id);
  Object.assign(state.settings, { gridSize: 16, snapToGrid: true, snapToEdges: true });
  await settle();

  app.atlas.stage.setViewport({ panX: 40, panY: 40, zoom: 1 });
  await settle();

  const box = overlay.getBoundingClientRect();
  const pointer = (type, world, buttons) => {
    const at = app.atlas.stage.worldToScreen(world.x, world.y);
    return new PointerEvent(type, {
      clientX: box.left + at.x,
      clientY: box.top + at.y,
      button: 0,
      buttons: buttons == null ? 1 : buttons,
      pointerId: 21,
      bubbles: true,
    });
  };

  const dragTo = async left => {
    const from = { x: mover.x + mover.width / 2, y: mover.y + mover.height / 2 };
    overlay.dispatchEvent(pointer("pointerdown", from));
    const to = { x: left + mover.width / 2, y: from.y };
    overlay.dispatchEvent(pointer("pointermove", to));
    await settle();
    const landed = mover.x;
    overlay.dispatchEvent(pointer("pointerup", to, 0));
    await settle();
    return landed;
  };

  mover.x = 400;
  await settle();
  const snapped = await dragTo(107);
  check("a slice dropped near a neighbour's edge lands flush against it",
    Math.abs(snapped - 103) < 0.5, `${snapped.toFixed(2)}, wanted 103`);

  state.settings.snapToEdges = false;
  mover.x = 400;
  await settle();
  const gridded = await dragTo(107);
  check("with edges off it rounds to the grid instead",
    Math.abs(gridded - 112) < 0.5, `${gridded.toFixed(2)}, wanted 112`);

  state.settings.snapToGrid = false;
  mover.x = 400;
  await settle();
  const free = await dragTo(107);
  check("with both off it lands exactly where it was dropped",
    Math.abs(free - 107) < 0.5, `${free.toFixed(2)}, wanted 107`);

  // ---- the switches ---------------------------------------------------------
  const tools = [...TX.dock.content.get("atlas").querySelectorAll(".tx-atlas-tools .v-btn")];
  check("the atlas viewport carries an icon strip like the 3D panel's", tools.length === 4,
    String(tools.length));
  check("and it is the same strip, not a lookalike",
    !!TX.dock.content.get("atlas").querySelector(".tx-viewport-tools"));

  const covered = tools.filter(button => {
    const at = button.getBoundingClientRect();
    if (!at.width || !at.height) return true;
    const hit = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
    return !hit || !button.contains(hit);
  });
  check("its buttons are reachable rather than under the canvas", covered.length === 0,
    `${covered.length} of ${tools.length} covered: ` + covered.map(button => {
      const at = button.getBoundingClientRect();
      if (!at.width || !at.height) return "zero-sized";
      const hit = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
      return hit ? (hit.className || hit.tagName) : "nothing";
    }).join(" / "));

  if (tools.length === 4) {
    tools[0].click();
    await settle();
    check("the first switch turns edge snapping back on", state.settings.snapToEdges === true);
    check("and lights up to say so",
      tools[0].classList.contains("tx-viewport-tool--on"));
    tools[1].click();
    await settle();
    check("the second switches the grid", state.settings.snapToGrid === true);
  }

  store.removeTexture(anchor.id);
  Object.assign(state.settings, { snapToGrid: true, snapToEdges: true });
  store.select("texture", texture.id);
  app.atlas.syncMeshes();
  app.atlas.fitAll();
  await settle();
}

async function runSaveImageChecks(app, mark) {
  const store = TX.store;
  const image = store.findImage(mark.imageId);
  const overlay = TX.dock.content.get("mark").querySelector("canvas.tx-layer--overlay");
  if (!image || !overlay) {
    check("there is a photo and a panel to right-click on", false);
    return;
  }

  app.mark.fitAll();
  await settle();
  store.clearSelection();
  await settle();

  const box = overlay.getBoundingClientRect();
  const world = TX.stage.localToWorld(image, { x: image.width / 2, y: image.height / 2 });
  const at = app.mark.stage.worldToScreen(world.x, world.y);
  overlay.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: box.left + at.x,
    clientY: box.top + at.y,
  }));
  await settle();

  const entry = (app.menu.items || []).find(item => /^Save /.test(item.title || ""));
  check("right-clicking a photo offers to save it", !!entry,
    (app.menu.items || []).map(i => i.title).filter(Boolean).join(" | "));
  if (!entry) return;
  check("named after the photo under the pointer, not the selection",
    entry.title === `Save ${image.name}` && entry.disabled !== true, entry.title);

  const saved = [];
  const realSave = TX.io.saveBlob;
  TX.io.saveBlob = (blob, filename) => saved.push({ blob, filename });
  try {
    await entry.action();
    await settle();
  } finally {
    TX.io.saveBlob = realSave;
  }

  check("it writes one file, named after the photo", saved.length === 1
    && saved[0].filename.startsWith(image.name.replace(/\.[^.]+$/, "")),
    saved.map(s => s.filename).join(","));
  check("and it is the file that was loaded, not a re-encode",
    saved.length === 1 && saved[0].blob === image.file,
    saved.length ? `${saved[0].blob.size} bytes vs ${image.file && image.file.size}` : "none");
}

async function runDetailChecks(app, texture) {
  const store = TX.store;

  const master = document.createElement("canvas");
  master.width = 1600;
  master.height = 1200;
  const ctx = master.getContext("2d");
  ctx.fillStyle = "#2244cc";
  ctx.fillRect(0, 0, 1600, 1200);
  ctx.fillStyle = "#ffcc22";
  ctx.fillRect(0, 0, 800, 1200);

  const node = store.addTexture({
    name: "detail-check", width: 1600, height: 1200, x: 4000, y: 0,
  });
  store.setTextureCanvas(node.id, master);
  app.atlas.syncMeshes();
  await settle();

  const close = (rgb, wanted) => wanted.every((v, i) => Math.abs(rgb[i] - v) <= 10);

  const meshOf = id => app.atlas.stage.scene.children
    .find(o => o.isMesh && o.userData.textureId === id);
  const at = async zoom => {
    app.atlas.stage.setZoom(zoom, { x: 10, y: 10 });
    app.atlas.syncDetail();
    await settle();
    const mesh = meshOf(node.id);
    return { image: mesh && mesh.material.map.image, level: mesh && mesh.userData.level };
  };

  const mapUuid = () => {
    const mesh = meshOf(node.id);
    return mesh && mesh.material.map && mesh.material.map.uuid;
  };

  const far = await at(0.05);
  const farUuid = mapUuid();
  const near_ = await at(4);
  const nearUuid = mapUuid();

  check("zoomed out, the atlas uploads less than the master",
    !!far.image && far.image.width < master.width && far.level > 0,
    `${far.image && far.image.width} of ${master.width} at level ${far.level}`);
  check("zoomed in, it goes back to the master itself",
    near_.image === master && near_.level === 0, `level ${near_.level}`);
  check("a level change replaces the GL texture, not just its image",
    !!farUuid && !!nearUuid && farUuid !== nearUuid,
    `${farUuid} -> ${nearUuid}`);

  check("the reduced copy is the same picture", (() => {
    if (!far.image) return false;
    const px = (x, y) => Array.from(far.image.getContext("2d").getImageData(x, y, 1, 1).data);
    const left = px(Math.round(far.image.width * 0.25), Math.round(far.image.height / 2));
    const right = px(Math.round(far.image.width * 0.75), Math.round(far.image.height / 2));
    return close(left, [255, 204, 34]) && close(right, [34, 68, 204]);
  })());

  const reduced = await at(0.05);
  check("the panel is showing a reduced copy at this point",
    !!reduced.image && reduced.image !== master);

  store.select("texture", node.id);
  await settle();
  const items = app.atlas.selectedAsCanvases();
  const wanted = Math.round(node.width * node.scaleX);
  check("an individual export is still at the slice's own resolution",
    items.length === 1 && items[0].canvas.width === wanted,
    items.map(i => `${i.canvas.width} vs ${wanted}`).join(", "));
  check("and its pixels are the master's, not the reduced copy's", (() => {
    if (!items.length) return false;
    const canvas = items[0].canvas;
    const px = (x, y) => Array.from(canvas.getContext("2d").getImageData(x, y, 1, 1).data);
    return close(px(Math.round(canvas.width * 0.25), Math.round(canvas.height / 2)),
      [255, 204, 34]);
  })());

  const composed = app.atlas.compositeAll();
  check("and the sheet is built at the slices' own size",
    !!composed && composed.width >= wanted, composed && `${composed.width}x${composed.height}`);

  store.removeTexture(node.id);
  store.select("texture", texture.id);
  app.atlas.syncMeshes();
  app.atlas.fitAll();
  await settle();
}

async function runProgressChecks(app, texture) {
  const progress = TX.progress;
  const state = TX.store.state;

  let release = null;
  const held = progress.run("Holding still", async report => {
    await report(0.4, "a step with a name");
    await new Promise(resolve => { release = resolve; });
  });

  await settle();
  await settle();

  const early = document.querySelector(".tx-progress");
  check("the window is blocked from the moment the work starts", !!early);
  check("but nothing is shown yet",
    !!early && getComputedStyle(early).opacity === "0" && !early.querySelector(".tx-progress-card"),
    early && getComputedStyle(early).opacity);

  await waitFor(() => progress.state.visible);
  await settle();

  const overlay = document.querySelector(".tx-progress");
  check("a long operation puts a modal bar on screen",
    !!overlay && getComputedStyle(overlay).opacity === "1"
    && !!overlay.querySelector(".tx-progress-card"),
    overlay && getComputedStyle(overlay).opacity);
  check("it says what is happening",
    !!overlay && /Holding still/.test(overlay.textContent)
    && /a step with a name/.test(overlay.textContent),
    overlay && overlay.textContent.replace(/\s+/g, " ").trim());
  check("and how far along it is", !!overlay && /40%/.test(overlay.textContent));

  check("it blocks the window underneath it", (() => {
    if (!overlay) return false;
    const at = document.elementFromPoint(Math.round(window.innerWidth / 2),
      Math.round(window.innerHeight / 2));
    return !!at && (at === overlay || overlay.contains(at));
  })());

  if (release) release();
  await held;
  await settle();
  check("and it comes down when the work is done",
    !document.querySelector(".tx-progress") && progress.state.active === false
    && progress.state.visible === false);

  // ---- the operation that prompted all this -------------------------------
  TX.store.select("texture", texture.id);
  state.settings.props.material = true;
  Object.assign(state.settings.material, { detailNormal: 0, roughnessAmount: 0, cavity: 0 });
  await settle();

  const button = [...document.querySelectorAll(".tx-props-root .v-btn")]
    .find(el => el.textContent.trim() === "Generate PBR");
  check("the Material group offers Generate PBR", !!button);
  if (!button) return;

  const runs = [];
  const realRun = progress.run;
  progress.run = (title, worker) => {
    runs.push(title);
    return realRun(title, worker);
  };
  try {
    button.click();
    await waitFor(() => progress.state.active === false && !runs.length === false);
    await settle();
  } finally {
    progress.run = realRun;
  }

  check("pressing it runs under the progress bar",
    runs.includes("Generating PBR maps"), runs.join(","));

  const thumbs = [...document.querySelectorAll(".tx-props-root .tx-pbr-map")];
  check("the derived maps are shown as thumbnails", thumbs.length >= 2,
    thumbs.map(t => t.textContent.trim()).join(","));
  const normalThumb = thumbs.find(t => t.textContent.trim() === "Normal");
  if (normalThumb) {
    normalThumb.click();
    await waitFor(() => state.settings.views.mode === "normal");
    await settle();
    check("clicking one puts that map on every viewport",
      state.settings.views.mode === "normal", state.settings.views.mode);
    check("and the thumbnail says it is the one being shown",
      normalThumb.classList.contains("tx-pbr-map--on")
      && normalThumb.getAttribute("aria-pressed") === "true");

    normalThumb.click();
    await waitFor(() => state.settings.views.mode === "off");
    await settle();
    check("clicking it again puts the colour back", state.settings.views.mode === "off",
      state.settings.views.mode);
  }
  check("and it still sets the strengths it inferred",
    state.settings.material.detailNormal > 0 && state.settings.material.roughnessAmount > 0
    && state.settings.material.cavity > 0,
    `${state.settings.material.detailNormal}/${state.settings.material.roughnessAmount}`
    + `/${state.settings.material.cavity}`);
  check("the maps it derived are waiting in the cache rather than for the next render",
    !!TX.material.warm(texture.id));
  check("nothing is left on screen afterwards", !document.querySelector(".tx-progress"));
}

async function runHistoryChecks(app, subject) {
  const store = TX.store;
  const state = store.state;
  const history = TX.history;
  const id = subject.id;

  const undoButton = document.querySelector(".tx-undo");
  const redoButton = document.querySelector(".tx-redo");
  check("the toolbar offers undo and redo", !!undoButton && !!redoButton);
  if (!undoButton || !redoButton) return;

  const meshX = () => {
    const mesh = app.atlas.stage.scene.children
      .find(o => o.isMesh && o.userData.textureId === id);
    return mesh ? mesh.position.x : null;
  };
  const liveX = () => {
    const node = store.findTexture(id);
    return node ? node.x : null;
  };

  store.select("texture", id);
  state.activePanel = "atlas";
  app.atlas.stage.setViewport({ panX: 30, panY: 30, zoom: 1 });
  await settle();
  history.commit();

  const overlay = TX.dock.content.get("atlas").querySelector(".tx-layer--overlay");
  const box = overlay.getBoundingClientRect();
  const centre = TX.stage.nodeCenter(store.findTexture(id));
  const screen = app.atlas.stage.worldToScreen(centre.x, centre.y);
  const from = { x: box.left + screen.x, y: box.top + screen.y };

  const startX = liveX();
  const depth = history.status.depth;

  overlay.dispatchEvent(pointer("pointerdown", from.x, from.y));
  for (let i = 1; i <= 12; i++) {
    overlay.dispatchEvent(pointer("pointermove", from.x + i * 4, from.y));
    await sleep(6);
  }
  overlay.dispatchEvent(pointer("pointerup", from.x + 48, from.y));
  await settle();

  const movedX = liveX();
  check("dragging a texture in the atlas moved it", movedX > startX + 10,
    `${startX} -> ${movedX}`);

  // Nothing asks for a commit here: the quiet window has to close on its own.
  await sleep(500);
  check("a twelve-move drag becomes exactly one undo step",
    history.status.depth === depth + 1, `${depth} -> ${history.status.depth}`);
  check("the step is named after the gesture", history.status.undoLabel === "Move texture",
    history.status.undoLabel);
  check("the undo button is live and the redo button is not",
    !undoButton.disabled && redoButton.disabled);

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
  await settle();
  check("undoing a move does not undo the extraction that made it",
    !!store.findTexture(id));
  check("ctrl+z rewinds the whole drag", liveX() !== null && Math.abs(liveX() - startX) < 0.001,
    `${liveX()} vs ${startX}`);
  check("the atlas mesh moved with it",
    meshX() !== null && Math.abs(meshX() - TX.stage.nodeCenter(store.findTexture(id)).x) < 0.001,
    `${meshX()}`);
  check("undoing reports it in the snackbar", /undid move texture/i.test(app.notice.text),
    app.notice.text);

  window.dispatchEvent(new KeyboardEvent("keydown", {
    key: "z", ctrlKey: true, shiftKey: true, bubbles: true,
  }));
  await settle();
  check("ctrl+shift+z puts it back", Math.abs(liveX() - movedX) < 0.001,
    `${liveX()} vs ${movedX}`);

  undoButton.click();
  await settle();
  check("the toolbar button undoes as well", Math.abs(liveX() - startX) < 0.001, String(liveX()));
  redoButton.click();
  await settle();
  check("and redoes", Math.abs(liveX() - movedX) < 0.001, String(liveX()));

  const count = state.textures.length;
  store.select("texture", id);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  await settle();
  check("delete removed the texture", state.textures.length === count - 1 && !store.findTexture(id),
    `${count} -> ${state.textures.length}`);
  check("and its mesh went with it", meshX() === null);

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
  await settle();
  check("ctrl+z brings a deleted texture back",
    state.textures.length === count && !!store.findTexture(id),
    `${state.textures.length}/${count}`);
  check("with its pixels", !!store.textureCanvas(id));
  check("and back into the atlas view", meshX() !== null);

  const held = history.status.depth;
  state.settings.props.lighting = !state.settings.props.lighting;
  state.settings.views.mode = state.settings.views.mode === "density" ? "delta" : "density";
  await sleep(500);
  check("panel state changes stay off the timeline", history.status.depth === held,
    `${held} -> ${history.status.depth}`);
}

async function runDepthChecks(texture, view) {
  const store = TX.store;
  const state = store.state;
  const mark = store.findMark(texture.markId);
  const image = mark ? store.findImage(mark.imageId) : null;
  check("the selected texture still knows its photograph", !!image);
  if (!image) return;

  const panel = TX.dock.content.get("properties");
  const depthGroup = () => [...panel.querySelectorAll(".tx-group")]
    .find(g => g.querySelector(".tx-group-title").textContent.trim() === "Depth");

  check("the properties panel has a depth group", !!depthGroup());
  if (!depthGroup()) return;

  depthGroup().querySelector(".tx-group-head").click();
  await settle();

  const bowSlider = () => [...depthGroup().querySelectorAll(".tx-props-slider")]
    .find(el => el.textContent.trim().startsWith("Bow"));

  check("with AI off the group withdraws the offer and says why",
    !/Estimate depth/.test(depthGroup().textContent)
    && /AI features are off/.test(depthGroup().textContent),
    depthGroup().textContent.replace(/\s+/g, " ").trim());

  const refused = await TX.depthModel.estimate(image.id);
  check("and the estimator refuses without reaching for a worker",
    refused === null && /AI features are off/.test(state.depthError || ""),
    String(state.depthError));
  check("leaving the photograph with no depth", !store.imageDepth(image.id));

  state.settings.ai = true;
  state.depthError = null;
  await settle();
  check("allowing AI offers to estimate some",
    /Estimate depth/.test(depthGroup().textContent));
  check("and shows no bow slider until there is", !bowSlider());

  check("the folded heading says there is none",
    depthGroup().querySelector(".tx-group-badge").textContent.trim() === "none",
    depthGroup().querySelector(".tx-group-badge").textContent.trim());

  // ---- and the same offer where the empty panel is --------------------------
  {
    const view3d = TX.dock.content.get("preview3d");
    store.select("image", image.id);
    await settle();
    const empty = view3d.querySelector(".tx-3d-empty");
    const button = empty && [...empty.querySelectorAll(".v-btn")]
      .find(el => /Estimate depth/.test(el.textContent));
    check("the 3D panel offers to estimate a photo's depth itself", !!button,
      empty ? empty.textContent.replace(/\s+/g, " ").trim() : "no empty state");
    check("and does not also tell you to go and select a photo",
      !!empty && !/Select a single texture/.test(empty.textContent),
      empty ? empty.textContent.replace(/\s+/g, " ").trim() : "");

    if (button) {
      const box = button.getBoundingClientRect();
      const at = box.width && box.height
        ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        : null;
      check("the button is reachable through the layer it sits on",
        !!at && button.contains(at),
        at ? at.className || at.tagName : "nothing there");

      const asked = [];
      const realEstimate = TX.depthModel.estimate;
      TX.depthModel.estimate = id => asked.push(id);
      const wasEnabled = state.settings.depth.enabled;
      state.settings.depth.enabled = false;
      try {
        button.click();
        await settle();
      } finally {
        TX.depthModel.estimate = realEstimate;
      }
      check("pressing it asks for this photograph's depth",
        asked.length === 1 && asked[0] === image.id, asked.join(","));
      check("and turns depth on, so later imports estimate themselves",
        state.settings.depth.enabled === true);
      state.settings.depth.enabled = wasEnabled;
    }

    // ---- and this panel's offer answers to the same switch --------------------
    state.settings.ai = false;
    await settle();
    const off = view3d.querySelector(".tx-3d-empty");
    check("with AI off the 3D panel stops offering to estimate",
      !!off && !/Estimate depth/.test(off.textContent),
      off ? off.textContent.replace(/\s+/g, " ").trim() : "no empty state");
    check("and says why, and where the switch is",
      !!off && /AI features are off/.test(off.textContent) && /Settings/.test(off.textContent),
      off ? off.textContent.replace(/\s+/g, " ").trim() : "");

    state.settings.ai = true;
    await settle();
    check("switching it back on restores the offer",
      /Estimate depth/.test(view3d.querySelector(".tx-3d-empty").textContent));

    state.settings.ai = false;
    store.select("texture", texture.id);
    await settle();
  }

  const width = Math.max(2, Math.round(image.width));
  const height = Math.max(2, Math.round(image.height));
  const cx = mark.points.reduce((sum, p) => sum + p.x, 0) / 4;
  const cy = mark.points.reduce((sum, p) => sum + p.y, 0) / 4;
  const radius = Math.max(8, TX.geom.dist(mark.points[0], mark.points[2]) / 2);
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = Math.hypot(x - cx, y - cy) / radius;
      data[y * width + x] = 4 + 0.01 * x + Math.max(0, 1 - t * t);
    }
  }
  store.setImageDepth(image.id, { data, width, height });
  await settle();

  // ---- the switch ------------------------------------------------------------
  const useDepth = () => depthGroup().querySelector(".tx-use-depth input[type=checkbox]");

  check("a depth map offers to use it", !!useDepth());
  check("and the panel reports how far the surface sat off the plane",
    /of the scene's depth range/.test(depthGroup().textContent));
  if (!useDepth()) return;

  const vertices = () => view.mesh.geometry.getAttribute("position").count;
  const bowOf = () => {
    view.mesh.geometry.computeBoundingBox();
    const box = view.mesh.geometry.boundingBox;
    return box.max.z - box.min.z;
  };

  const flatVertices = vertices();
  check("the mesh stays flat until the depth is asked for",
    bowOf() < 1e-9 && !bowSlider() && state.settings.material.bow > 0,
    `${bowOf().toFixed(6)}, bow ${state.settings.material.bow}`);
  check("the folded heading says the depth is there but off",
    depthGroup().querySelector(".tx-group-badge").textContent.trim() === "off",
    depthGroup().querySelector(".tx-group-badge").textContent.trim());

  useDepth().click();
  await settle();

  check("switching it on bows the mesh without touching a slider",
    vertices() > flatVertices && bowOf() > 0.01,
    `${flatVertices} -> ${vertices()} vertices, ${bowOf().toFixed(4)} deep`);
  check("and the amounts appear underneath it", !!bowSlider());
  if (!bowSlider()) return;

  const gentle = bowOf();
  const input = bowSlider().querySelector("input[type=range]");
  input.value = "80";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();

  check("dragging the bow lifts it further out of the plane", bowOf() > gentle,
    `${gentle.toFixed(4)} -> ${bowOf().toFixed(4)}`);
  check("the heading now says how far it is bowed",
    /^bow 80%/.test(depthGroup().querySelector(".tx-group-badge").textContent.trim()),
    depthGroup().querySelector(".tx-group-badge").textContent.trim());

  const coarse = vertices();
  [...depthGroup().querySelectorAll(".v-btn")]
    .find(b => b.textContent.trim() === "128").click();
  await settle();
  check("picking a finer mesh detail rebuilds it with more vertices", vertices() > coarse,
    `${coarse} -> ${vertices()}`);

  useDepth().click();
  await settle();
  check("switching it off returns the single flat quad, bow and all",
    vertices() === flatVertices && bowOf() < 1e-9, `${vertices()} / ${bowOf().toFixed(6)}`);
  check("and the amount it had is still there when it comes back",
    state.settings.material.bow === 0.8, String(state.settings.material.bow));

  // ---- the photograph as a surface, seen from where it was taken --------------
  store.select("image", image.id);
  await settle();
  check("selecting the photograph shows it as a surface", view.sceneMesh.visible);
  if (view.sceneMesh.visible) {
    const taken = view.sceneMesh.geometry.userData;
    const eye = view.camera.position;
    check("and the view opens from where the camera that took it was",
      !!taken.viewpoint
      && Math.abs(eye.x - taken.viewpoint.x) < 1e-4
      && Math.abs(eye.y - taken.viewpoint.y) < 1e-4
      && Math.abs(eye.z - taken.viewpoint.z) < 1e-4,
      `${eye.x.toFixed(4)},${eye.y.toFixed(4)},${eye.z.toFixed(4)} vs `
      + (taken.viewpoint ? `${taken.viewpoint.x.toFixed(4)},${taken.viewpoint.y.toFixed(4)},`
        + `${taken.viewpoint.z.toFixed(4)}` : "nowhere"));
    check("wide enough to get the whole photograph in",
      view.camera.fov >= taken.fov.vertical && view.camera.fov < taken.fov.vertical * 3,
      `${view.camera.fov.toFixed(1)}° for a ${taken.fov.vertical.toFixed(1)}° photo`);
  }

  store.select("texture", texture.id);
  await settle();
  check("and going back to a slice puts the studio lens back",
    Math.abs(view.camera.fov - 38) < 1e-6, String(view.camera.fov));

  store.setImageDepth(image.id, null);
  Object.assign(state.settings.material, {
    subdivision: TX.material.defaults().subdivision,
    bow: TX.material.defaults().bow,
  });
  await settle();
}

async function runPreview3dChecks(app, texture) {
  const store = TX.store;
  const state = store.state;

  const tab = tabOf("preview3d");
  check("the 3D preview has a tab", !!tab);
  if (tab) {
    const at = centreOf(tab);
    tab.dispatchEvent(pointer("pointerdown", at.x, at.y));
    window.dispatchEvent(pointer("pointerup", at.x, at.y));
    await settle();
  }

  const panel = TX.dock.content.get("preview3d");
  check("the 3D panel rendered", !!panel && !!panel.querySelector(".tx-3d"));
  check("the 3D panel is on screen once its tab is picked",
    !!panel && !!panel.closest("[data-dock-slot]"),
    panel && panel.parentElement && panel.parentElement.className);

  const component = app.$refs.preview3d;
  const view = component && component.view;
  check("the viewport built a renderer", !!view);
  if (!view || !panel) return;

  const canvas = panel.querySelector("canvas.tx-3d-canvas");
  check("it has its own WebGL canvas", !!canvas);
  check("that context is alive", !view.renderer.getContext().isContextLost());
  check("the camera is perspective, not the flat one the other panels use",
    view.camera.isPerspectiveCamera === true);
  check("the studio rig is in the scene",
    view.scene.children.filter(c => c.isDirectionalLight).length === 3,
    String(view.scene.children.filter(c => c.isDirectionalLight).length));
  check("it can be orbited", !!view.controls && view.controls.enabled !== false);

  {
    const stage = view.renderer.domElement.parentElement;
    stage.getBoundingClientRect = () => ({
      width: 180, height: 620, left: 0, top: 0, right: 180, bottom: 620, x: 0, y: 0,
    });
    view.fit();

    const subject = view.sceneMesh.visible ? view.sceneMesh : view.mesh;
    const radius = subject.geometry.boundingSphere.radius;
    const distance = view.camera.position.length();
    const halfV = (view.camera.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * view.camera.aspect);
    check("a narrow panel is framed on its narrow side",
      view.camera.aspect < 1 && distance * Math.sin(halfH) > radius,
      `${(distance * Math.sin(halfH)).toFixed(2)} of ${radius.toFixed(2)} across,`
      + ` aspect ${view.camera.aspect.toFixed(2)}`);
    check("and the orbit's ceiling is lifted to where that put the camera",
      view.controls.maxDistance >= distance,
      `${view.controls.maxDistance.toFixed(2)} vs ${distance.toFixed(2)}`);

    delete stage.getBoundingClientRect;
    view.fit();
  }

  const frames = () => new Promise(resolve => requestAnimationFrame(
    () => requestAnimationFrame(resolve)));
  state.camera3d = null;
  view.camera.position.set(1.25, 0.8, 1.9);
  view.controls.target.set(0.05, -0.1, 0.15);
  view.controls.dispatchEvent({ type: "change" });
  await frames();
  check("orbiting writes the camera into the store",
    !!state.camera3d && Math.abs(state.camera3d.position[0] - 1.25) < 1e-3
      && Math.abs(state.camera3d.target[2] - 0.15) < 1e-3,
    JSON.stringify(state.camera3d));

  store.clearSelection();
  await settle();
  check("with nothing selected it asks for a selection and shows no mesh",
    /Select a single texture/.test(panel.textContent) && view.mesh.visible === false);

  store.select("texture", texture.id);
  await settle();
  check("selecting a texture puts a lit mesh on screen", view.mesh.visible === true);
  check("the mesh wears the texture as its base colour", !!view.material.map);
  check("and the maps derived from the recovered shading",
    !!view.material.normalMap && !!view.material.aoMap);

  const meshRatio = () => {
    const geometry = view.mesh.geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    return (box.max.x - box.min.x) / (box.max.y - box.min.y);
  };
  const albedoRatio = id => {
    const canvas = store.textureCanvas(id);
    return canvas.width / canvas.height;
  };

  check("the plane in front of the camera is the texture's aspect ratio",
    Math.abs(meshRatio() - albedoRatio(texture.id)) < 1e-4,
    `${meshRatio().toFixed(4)} vs ${albedoRatio(texture.id).toFixed(4)}`);

  const oddCanvas = document.createElement("canvas");
  oddCanvas.width = 40;
  oddCanvas.height = 160;
  const oddCtx = oddCanvas.getContext("2d");
  oddCtx.fillStyle = "#8844cc";
  oddCtx.fillRect(0, 0, 40, 160);
  const odd = store.addTexture({ name: "tall-probe", width: 40, height: 160 });
  store.setTextureCanvas(odd.id, oddCanvas);
  await settle();

  store.select("texture", odd.id);
  await settle();
  check("selecting a differently shaped slice rebuilds the mesh to match",
    Math.abs(meshRatio() - albedoRatio(odd.id)) < 1e-4,
    `${meshRatio().toFixed(4)} vs ${albedoRatio(odd.id).toFixed(4)} wanted`);

  store.select("texture", texture.id);
  await settle();
  check("and going back restores the first one's shape",
    Math.abs(meshRatio() - albedoRatio(texture.id)) < 1e-4,
    `${meshRatio().toFixed(4)} vs ${albedoRatio(texture.id).toFixed(4)} wanted`);

  const twinCanvas = document.createElement("canvas");
  twinCanvas.width = store.textureCanvas(texture.id).width;
  twinCanvas.height = store.textureCanvas(texture.id).height;
  twinCanvas.getContext("2d").drawImage(store.textureCanvas(texture.id), 0, 0);
  const twin = store.addTexture({
    name: "twin-probe", width: twinCanvas.width, height: twinCanvas.height,
  });
  store.setTextureCanvas(twin.id, twinCanvas);
  await settle();
  const firstGeometry = view.mesh.geometry;
  store.select("texture", twin.id);
  await settle();
  check("a same-sized slice still gets its own geometry",
    view.mesh.geometry !== firstGeometry);

  store.removeTexture(twin.id);
  store.removeTexture(odd.id);
  store.select("texture", texture.id);
  await settle();

  // --- the controls ---
  const props = TX.dock.content.get("properties");
  const materialGroup = () => [...props.querySelectorAll(".tx-group")]
    .find(el => el.textContent.trim().startsWith("Material"));
  check("the material has its own group in Properties", !!materialGroup());

  const sliders = [...(materialGroup() || props).querySelectorAll(".tx-props-slider")]
    .map(el => el.textContent.replace(/\s+/g, " ").trim());
  check("it offers roughness, metalness, relief and occlusion",
    ["Roughness", "Metalness", "Relief", "Occlusion"].every(
      label => sliders.some(s => s.startsWith(label))),
    sliders.join(" | "));
  check("and the 3D panel no longer carries them",
    !panel.querySelector(".tx-props-slider") && !panel.querySelector(".tx-3d-shape"));

  const tools = [...panel.querySelectorAll(".tx-3d-tools .v-btn")];
  check("the viewport has an icon strip instead", tools.length === 7, String(tools.length));

  const covered = tools.filter(button => {
    const box = button.getBoundingClientRect();
    if (!box.width || !box.height) return true;
    const at = document.elementFromPoint(
      box.left + box.width / 2, box.top + box.height / 2);
    return !at || !button.contains(at);
  });
  check("and every button in it is what a pointer there would actually hit",
    covered.length === 0, `${covered.length} of ${tools.length} covered by the canvas`);

  const rough = [...materialGroup().querySelectorAll(".tx-props-slider")]
    .find(el => el.textContent.trim().startsWith("Roughness"))
    .querySelector("input[type=range]");
  rough.value = "20";
  rough.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  check("dragging the roughness slider reaches the live material",
    Math.abs(view.material.roughness - 0.2) < 1e-6, String(view.material.roughness));

  const flatVertices = view.mesh.geometry.getAttribute("position").count;
  tools[3].click();
  await settle();
  check("the sphere button reaches the material's shape",
    state.settings.material.shape === "sphere", state.settings.material.shape);
  check("picking another shape rebuilds the mesh",
    view.mesh.geometry.getAttribute("position").count > flatVertices,
    `${flatVertices} -> ${view.mesh.geometry.getAttribute("position").count}`);
  check("the texture stays on it", !!view.material.map && view.mesh.visible);
  check("and the button it came from is lit",
    tools[3].classList.contains("tx-viewport-tool--on"));

  tools[0].click();
  await settle();
  check("the plane button puts it back", state.settings.material.shape === "plane",
    state.settings.material.shape);

  {
    const swayButton = panel.querySelector(".tx-3d-sway");
    check("the icon strip offers a sway toggle", !!swayButton);
    check("and it is on to begin with",
      state.settings.sway === true
      && !!swayButton && swayButton.classList.contains("tx-viewport-tool--on"));

    view.sway(0);
    const start = { x: view.mesh.rotation.x, y: view.mesh.rotation.y };
    let moved = 0;
    for (let ms = 500; ms <= 11000; ms += 500) {
      view.sway(ms);
      moved = Math.max(moved, Math.abs(view.mesh.rotation.x - start.x)
        + Math.abs(view.mesh.rotation.y - start.y));
    }
    check("the object sways on its own", moved > 0.05, moved.toFixed(4));

    if (swayButton) swayButton.click();
    await settle();
    view.sway(3000);
    check("switching it off leaves the object square",
      view.mesh.rotation.x === 0 && view.mesh.rotation.y === 0,
      `${view.mesh.rotation.x}, ${view.mesh.rotation.y}`);
    check("and stops it moving",
      !state.settings.sway
      && !swayButton.classList.contains("tx-viewport-tool--on"));
    if (swayButton) swayButton.click();
    await settle();
  }

  state.settings.material.shape = "plane";
  state.settings.material.normal = 0;
  await settle();
  check("turning the relief off drops the normal map from the preview",
    !view.material.normalMap);
  state.settings.material.normal = 0.6;
  await settle();
  check("and turning it back on restores it", !!view.material.normalMap);

  await runDepthChecks(texture, view);

  // --- the export button ---
  check("the viewport's icon strip offers a GLB export",
    panel.querySelectorAll(".tx-3d-tools .v-btn").length === 7);
  document.querySelector(".tx-export-btn").click();
  await settle();
  const exportRows = [...document.querySelectorAll(".tx-export-menu .v-list-item")];
  check("the toolbar gathers the exports under one button",
    exportRows.map(el => el.textContent.replace(/Ctrl\+\w/, "").trim()).join(",")
      === "Atlas,Individually,Model",
    exportRows.map(el => el.textContent.trim()).join(" | "));
  const modelRow = exportRows.find(el => /^Model/.test(el.textContent.trim()));
  check("the model row is live while one texture is selected",
    !!modelRow && !modelRow.classList.contains("v-list-item--disabled"),
    modelRow ? modelRow.className : "no row");
  document.querySelector(".tx-export-btn").click();
  await waitFor(() => !document.querySelector(".v-overlay--active .tx-export-menu"));
  dismissOverlays();
  const saved = [];
  const realSave = TX.io.saveBlob;
  TX.io.saveBlob = (blob, filename) => saved.push({ blob, filename });
  try {
    await component.exportGlb();
    check("the button's action writes a model file", saved.length === 1, String(saved.length));
    check("it is a binary glTF named after the texture",
      saved[0] && /\.glb$/.test(saved[0].filename)
      && saved[0].blob.type === "model/gltf-binary",
      saved[0] && `${saved[0].filename} ${saved[0].blob.type}`);
    const parsed = saved.length ? TX.gltf.readGlb(await saved[0].blob.arrayBuffer()) : null;
    check("the written file holds a mesh with a textured material",
      !!parsed && parsed.json.meshes.length === 1
      && !!parsed.json.materials[0].pbrMetallicRoughness.baseColorTexture,
      parsed ? `${parsed.bytes} bytes` : "unreadable");
    check("the file carries the roughness the slider was left on",
      !!parsed && Math.abs(parsed.json.materials[0].pbrMetallicRoughness.roughnessFactor - 0.2) < 1e-6,
      parsed && String(parsed.json.materials[0].pbrMetallicRoughness.roughnessFactor));
  } finally {
    TX.io.saveBlob = realSave;
  }

  // ---- turning the slice reaches the mesh ------------------------------------
  const spanOf = () => {
    view.mesh.geometry.computeBoundingBox();
    const box = view.mesh.geometry.boundingBox;
    return { x: box.max.x - box.min.x, y: box.max.y - box.min.y };
  };
  const upright = spanOf();
  const heldRotation = texture.rotation;
  texture.rotation = Math.PI / 2;
  await settle();
  const turned = spanOf();
  check("turning the slice a quarter turns the plane with it",
    Math.abs(turned.x - upright.y) < 1e-3 && Math.abs(turned.y - upright.x) < 1e-3,
    `${turned.x.toFixed(3)} x ${turned.y.toFixed(3)}, `
    + `was ${upright.x.toFixed(3)} x ${upright.y.toFixed(3)}`);

  texture.rotation = heldRotation;
  await settle();
  check("and turning it back puts the plane back",
    Math.abs(spanOf().x - upright.x) < 1e-3 && Math.abs(spanOf().y - upright.y) < 1e-3,
    `${spanOf().x.toFixed(3)} x ${spanOf().y.toFixed(3)}`);

  const history = TX.history;
  history.commit();
  const depth = history.status.depth;
  state.settings.material.metalness = 0.5;
  await settle();
  history.commit();
  check("a material change lands on the undo timeline",
    history.status.depth === depth + 1, `${depth} -> ${history.status.depth}`);
  check("and it is named for what it changed", history.status.undoLabel === "3D material",
    history.status.undoLabel);
  history.undo();
  await settle();
  check("undoing puts the material back",
    Math.abs(view.material.metalness) < 1e-6, String(view.material.metalness));

  state.settings.material.roughness = 0.65;
  await settle();
}

async function runOverlayChecks(app, texture) {
  const store = TX.store;
  const state = store.state;
  const overlay = TX.viewOverlay;

  const select = document.querySelector(".tx-measure-mode");
  check("the measurement picker is in the toolbar", !!select);
  const measurements = overlay.MODES.filter(m => !m.channel).map(m => m.value).join(",");
  const channels = overlay.MODES.filter(m => m.channel).map(m => m.value).join(",");
  check("it offers every measurement plus off",
    measurements === "off,density,correspond,delta,atlas", measurements);
  check("and every channel of the material",
    channels === "normal,roughness,occlusion,height,shading", channels);
  check("it starts off", overlay.modeOf() === "off", overlay.modeOf());

  store.select("texture", texture.id);
  await settle();

  const painted = stage => {
    const canvas = stage.overlay;
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) count++;
    return count;
  };

  const maximisedBefore = app.dockState.maximized;
  app.dockState.maximized = "atlas";
  await settle();
  await settle();
  app.atlas.fitSelection();
  await settle();

  const setMode = async mode => {
    state.settings.views.mode = mode;
    await settle();
    repaint(app.atlas.stage);
    repaint(app.mark.stage);
  };

  const paintedOnTexture = stage => {
    const centre = TX.stage.nodeCenter(texture);
    const at = stage.worldToScreen(centre.x, centre.y);
    const half = 12;
    const x = Math.round(at.x - half);
    const y = Math.round(at.y - half);
    const canvas = stage.overlay;
    if (x < 0 || y < 0 || x + half * 2 > canvas.width || y + half * 2 > canvas.height) return -1;
    const { data } = canvas.getContext("2d").getImageData(x, y, half * 2, half * 2);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) count++;
    return count;
  };

  const pixelOnTexture = stage => {
    const centre = TX.stage.nodeCenter(texture);
    const at = stage.worldToScreen(centre.x, centre.y);
    const { data } = stage.overlay.getContext("2d")
      .getImageData(Math.round(at.x), Math.round(at.y), 1, 1);
    return `${data[0]},${data[1]},${data[2]},${data[3]}`;
  };

  await setMode("off");
  const bare = painted(app.atlas.stage);
  const bareStrict = paintedOnTexture(app.atlas.stage);
  check("the overlay off leaves only the atlas' own chrome", bareStrict < 576 / 4,
    `${bareStrict} of 576 px, centre rgba ${pixelOnTexture(app.atlas.stage)}`);

  for (const mode of ["density", "correspond", "delta", "atlas"]) {
    await setMode(mode);
    check(`the ${mode} view paints over the atlas`,
      paintedOnTexture(app.atlas.stage) > 400,
      `${paintedOnTexture(app.atlas.stage)} of 576 px over the slice`);
  }

  // ---- what came from where ------------------------------------------------
  await setMode("correspond");
  state.settings.views.numbers = false;
  await setMode("correspond");
  const sheetTint = pixelOnTexture(app.atlas.stage).split(",").map(Number);
  check("the pairing paints a tint rather than a fill",
    sheetTint[3] > 8 && sheetTint[3] < 160, `alpha ${sheetTint[3]} of 255`);
  check("and the tint is the slice's own colour", (() => {
    const wanted = TX.views.itemColour(state.textures.findIndex(t => t.id === texture.id));
    const hue = Number(wanted.match(/hsla?\(([\d.]+)/)[1]);
    const max = Math.max(sheetTint[0], sheetTint[1], sheetTint[2]);
    const min = Math.min(sheetTint[0], sheetTint[1], sheetTint[2]);
    if (max === min) return false;
    const d = max - min;
    let h = 0;
    if (max === sheetTint[0]) h = ((sheetTint[1] - sheetTint[2]) / d + 6) % 6;
    else if (max === sheetTint[1]) h = (sheetTint[2] - sheetTint[0]) / d + 2;
    else h = (sheetTint[0] - sheetTint[1]) / d + 4;
    const apart = Math.abs(h * 60 - hue) % 360;
    return Math.min(apart, 360 - apart) < 40;
  })(), `painted rgba ${sheetTint.join(",")}`);
  state.settings.views.numbers = true;

  const material = state.settings.material;
  Object.assign(material, { detailNormal: 0, roughnessAmount: 0, cavity: 0 });
  await setMode("roughness");
  check("a channel that is off paints no more than the overlay being off does",
    paintedOnTexture(app.atlas.stage) <= bareStrict,
    `${paintedOnTexture(app.atlas.stage)} vs ${bareStrict} px with no overlay at all`);
  check("a channel the material is not deriving has nothing to show",
    !overlay.channelFor(texture, "roughness") && !overlay.channelFor(texture, "height"));
  check("while the channels the lighting derives are there regardless",
    !!overlay.channelFor(texture, "normal") && !!overlay.channelFor(texture, "occlusion"));

  const flatNormals = overlay.channelFor(texture, "normal");
  const sampleNormals = canvas => {
    const px = canvas.getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let spread = 0;
    for (let i = 0; i < px.length; i += 4) {
      spread = Math.max(spread, Math.abs(px[i] - 128), Math.abs(px[i + 1] - 128));
    }
    return spread;
  };

  Object.assign(material, { detailNormal: 1, roughnessAmount: 0.6, cavity: 0.5 });
  for (const mode of ["normal", "roughness", "occlusion", "height"]) {
    await setMode(mode);
    check(`the ${mode} channel paints over the atlas`,
      paintedOnTexture(app.atlas.stage) > 400,
      `${paintedOnTexture(app.atlas.stage)} of 576 px over the slice`);
  }

  const withDetail = overlay.channelFor(texture, "normal");
  check("the colour's relief is combined into the normal map",
    sampleNormals(withDetail) > sampleNormals(flatNormals),
    `±${sampleNormals(flatNormals)} -> ±${sampleNormals(withDetail)}`);
  check("the height the normals were built from is not a flat sheet",
    sampleNormals(overlay.channelFor(texture, "height")) > 4,
    `±${sampleNormals(overlay.channelFor(texture, "height"))}`);

  Object.assign(material, { detailNormal: 0, roughnessAmount: 0, cavity: 0 });

  await setMode("density");
  const densityOnSlice = paintedOnTexture(app.atlas.stage);
  await setMode("off");
  check("turning it off clears the atlas again",
    paintedOnTexture(app.atlas.stage) < densityOnSlice / 2,
    `${paintedOnTexture(app.atlas.stage)} vs ${densityOnSlice} with the field on`);

  const field = overlay.fieldFor(texture, "density");
  const rows = overlay.readoutRows(field).map(r => r[0]);
  check("the density readout still reports a median and what was interpolated",
    rows.includes("Median") && rows.includes("Interpolated"), rows.join(","));

  // ---- the grid stays off the pictures --------------------------------------
  await setMode("off");
  state.settings.showGrid = true;
  repaint(app.atlas.stage);
  const overGrid = paintedOnTexture(app.atlas.stage);
  state.settings.showGrid = false;
  repaint(app.atlas.stage);
  const withoutGrid = paintedOnTexture(app.atlas.stage);
  check("switching the grid on paints nothing over a slice",
    overGrid >= 0 && overGrid === withoutGrid,
    `${overGrid} with the grid, ${withoutGrid} without`);

  const emptyCorner = stage => {
    const canvas = stage.overlay;
    const { data } = canvas.getContext("2d").getImageData(4, 4, 60, 60);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 4) count++;
    return count;
  };
  state.settings.showGrid = true;
  repaint(app.atlas.stage);
  const emptyWith = emptyCorner(app.atlas.stage);
  state.settings.showGrid = false;
  repaint(app.atlas.stage);
  const emptyWithout = emptyCorner(app.atlas.stage);
  check("but it is still drawn on the empty sheet around them",
    emptyWith > emptyWithout, `${emptyWith} with the grid, ${emptyWithout} without`);
  state.settings.showGrid = true;
  await settle();

  // ---- the colour bar -------------------------------------------------------
  const sampleSlice = () => {
    const centre = TX.stage.nodeCenter(texture);
    const at = app.atlas.stage.worldToScreen(centre.x, centre.y);
    const canvas = app.atlas.stage.overlay;
    const x = Math.round(at.x - 40);
    const y = Math.round(at.y - 24);
    if (x < 0 || y < 0 || x + 80 > canvas.width || y + 48 > canvas.height) return "off screen";
    const { data } = canvas.getContext("2d").getImageData(x, y, 80, 48);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum = (sum * 31 + data[i]) % 2147483647;
    return String(sum);
  };
  const withLabels = async mode => {
    state.settings.views.numbers = true;
    await setMode(mode);
    const on = sampleSlice();
    state.settings.views.numbers = false;
    await setMode(mode);
    const off = sampleSlice();
    state.settings.views.numbers = true;
    return { on, off };
  };

  const densityLabels = await withLabels("density");
  check("texel density draws no readings over the slice",
    densityLabels.on !== "off screen" && densityLabels.on === densityLabels.off,
    `${densityLabels.on} with labels, ${densityLabels.off} without`);

  const deltaLabels = await withLabels("delta");
  check("and the toggle still reaches the mode that does print them",
    deltaLabels.on !== "off screen" && deltaLabels.on !== deltaLabels.off,
    `${deltaLabels.on} with labels, ${deltaLabels.off} without`);

  check("the ramp modes have no hand-written swatch legend left",
    !overlay.legendFor("density") && !overlay.legendFor("delta"),
    `${JSON.stringify(overlay.legendFor("density"))} / `
    + `${JSON.stringify(overlay.legendFor("delta"))}`);
  check("and the field's own ramp is what a legend can be drawn from", (() => {
    const cold = TX.views.diverging(-1);
    const middle = TX.views.diverging(0);
    const warm = TX.views.diverging(1);
    return cold[0] > cold[2] + 100 && warm[2] > warm[0] + 100
      && Math.abs(middle[0] - middle[2]) < 20;
  })());

  await setMode("off");

  check("a retired mode measures nothing",
    overlay.fieldFor(texture, "coverage") === null
    && overlay.fieldFor(texture, "compare") === null
    && overlay.readoutRows(null).length === 0);

  // ---- and the object wears it too ----------------------------------------
  const preview = app.$refs.preview3d && app.$refs.preview3d.view;
  if (preview) {
    Object.assign(state.settings.material, { normal: 1 });
    const shownMap = () => preview.material.map && preview.material.map.image;
    await setMode("off");
    await settle();
    const withColour = shownMap();
    await setMode("normal");
    await settle();
    const withChannel = shownMap();
    check("the 3D object wears the chosen mode",
      !!withChannel && withChannel !== withColour,
      withChannel === withColour ? "still the colour" : "a different surface");
    check("and shows it flat rather than lit",
      !!preview.material.emissiveMap && preview.material.emissiveIntensity > 0);
    await setMode("density");
    await settle();
    const surface = overlay.surfaceFor(texture, "density");
    const albedo = TX.store.textureCanvas(texture.id);
    check("a measured field is composited over the colour before the object wears it", (() => {
      if (!surface || !albedo || surface.width !== albedo.width) return false;
      const from = surface.getContext("2d").getImageData(0, 0, surface.width, surface.height).data;
      const under = albedo.getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, albedo.width, albedo.height).data;
      let opaque = 0;
      for (let i = 3; i < under.length; i += 4) {
        if (under[i] < 255) continue;
        opaque++;
        if (from[i] < 255) return false;
      }
      return opaque > 100;
    })(), surface && `${surface.width}x${surface.height}`);

    await setMode("off");
    await settle();
    check("turning the mode off puts the colour back",
      shownMap() === withColour && !preview.material.emissiveMap);
  }

  {
    const big = document.createElement("canvas");
    big.width = 1800;
    big.height = 1200;
    big.getContext("2d").drawImage(TX.store.textureCanvas(texture.id), 0, 0, 1800, 1200);
    const node = TX.store.addTexture({ name: "size-probe", width: 1800, height: 1200, x: 9000 });
    TX.store.setTextureCanvas(node.id, big);
    Object.assign(state.settings.material, { normal: 1 });

    const coarse = overlay.channelFor(node, "normal", 120);
    const fine = overlay.channelFor(node, "normal", 1400);
    const again = overlay.channelFor(node, "normal", 120);
    check("a slice shown small has its channel derived small",
      !!coarse && coarse.width < 1800, coarse && String(coarse.width));
    check("zoomed in, it is derived finer",
      !!fine && fine.width > coarse.width, fine && `${coarse.width} -> ${fine.width}`);
    check("and zooming back out keeps the finer one rather than re-deriving",
      again === fine);
    TX.store.removeTexture(node.id);
    TX.store.select("texture", texture.id);
  }

  // ---- and now the photo ---------------------------------------------------
  const markViewBefore = { ...app.mark.stage.view };
  app.dockState.maximized = "mark";
  await settle();
  await settle();
  app.mark.stage.resize();
  app.mark.fitAll();
  await settle();

  const onPhoto = async mode => {
    state.settings.views.mode = mode;
    await settle();
    repaint(app.mark.stage);
    return painted(app.mark.stage);
  };

  check("the photo's panel is large enough to measure something",
    app.mark.stage.view.height > 100,
    `${app.mark.stage.view.width}x${app.mark.stage.view.height}`);

  const barePhoto = await onPhoto("off");
  const densityOnPhoto = await onPhoto("density");
  check("the field is drawn on the photo too, not only the atlas",
    densityOnPhoto > barePhoto, `${densityOnPhoto} with, ${barePhoto} without`);

  const pairedOnPhoto = await onPhoto("correspond");
  check("the pairing colours reach the mark on the photo",
    pairedOnPhoto > barePhoto, `${pairedOnPhoto} with, ${barePhoto} without`);

  Object.assign(state.settings.material, { normal: 1 });
  const channelOnPhoto = await onPhoto("normal");
  check("a material channel reaches the mark on the photo too",
    channelOnPhoto > barePhoto, `${channelOnPhoto} with, ${barePhoto} without`);
  check("the mark panel no longer refuses any mode but the sheet's own",
    overlay.MARK_MODES.has("normal") && overlay.MARK_MODES.has("roughness")
    && overlay.MARK_MODES.has("delta") && !overlay.MARK_MODES.has("atlas"),
    [...overlay.MARK_MODES].join(","));
  await onPhoto("off");

  state.settings.views.mode = "off";
  app.dockState.maximized = maximisedBefore;
  await settle();
  app.mark.stage.resize();
  app.mark.stage.setViewport(markViewBefore);
  await settle();
}

function runLicenceChecks() {
  const banner = [...document.childNodes]
    .filter(node => node.nodeType === Node.COMMENT_NODE)
    .map(node => node.nodeValue)
    .join("\n");

  check("the page carries its own licence", banner.includes("MIT License")
    && banner.includes("Copyright (c) 2026 Thomas Fischer"),
    `${banner.length} chars of comment`);

  for (const [name, holder] of [
    ["vue", "Yuxi (Evan) You"],
    ["vuetify", "Vuetify"],
    ["three", "three.js authors"],
  ]) {
    check(`${name}'s notice travels with the file`, banner.includes(holder), holder);
  }

  check("the permission notice is there in full, not just the copyright line",
    (banner.match(/Permission is hereby granted/g) || []).length >= 4,
    String((banner.match(/Permission is hereby granted/g) || []).length));

  check("the build stamps a real version into the app",
    /^\d+\.\d+\.\d+$/.test(TX.version) && banner.includes(TX.version), TX.version);
}

async function runLensChecks(app, mark) {
  const props = TX.dock.content.get("properties");
  const image = store.findImage(mark.imageId);
  const group = () => [...props.querySelectorAll(".tx-group")]
    .find(el => el.textContent.trim().startsWith("Lens"));

  store.select("mark", mark.id);
  await settle();
  check("the Lens group is there with a mark selected", !!group());
  if (!group()) return;

  store.select("image", image.id);
  await settle();
  check("and with the photograph selected too", !!group());

  store.select("mark", mark.id);
  await settle();

  if (!group().querySelector("input[type=range]")) {
    group().querySelector(".tx-group-head").click();
    await settle();
  }
  check("opening it reveals the coefficients",
    !!group().querySelector("input[type=range]"));

  const slider = () => group().querySelector("input[type=range]");
  const texture = store.state.textures.find(t => t.markId === mark.id);
  const before = texture ? store.textureKey(texture.id) : "";

  slider().value = "-180";
  slider().dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  check("dragging the slider reaches the photograph, not the mark",
    Math.abs(store.findImage(image.id).lens.k1 + 0.18) < 1e-9,
    JSON.stringify(store.findImage(image.id).lens));
  check("and every mark on it owes a re-extraction",
    store.marksOfImage(image.id).every(m => m.dirty || !!store.state.textures
      .find(t => t.markId === m.id)),
    store.marksOfImage(image.id).map(m => m.dirty).join(","));

  if (texture) {
    check("the correction reaches the extracted pixels",
      store.textureKey(texture.id) !== before,
      `${before} -> ${store.textureKey(texture.id)}`);
  }

  check("the heading says what it is set to",
    /k1 -0\.180/.test(group().querySelector(".tx-group-badge").textContent),
    group().querySelector(".tx-group-badge").textContent.trim());

  const fitButton = () => group().querySelector(".tx-lens-fit");
  check("the fit is offered but refused with nothing traced",
    !!fitButton() && fitButton().disabled === true);

  store.setMarkCurve(mark.id, 0, { x: 0, y: -0.05 });
  await settle();
  check("bending an edge gives it something to fit from",
    !!fitButton() && fitButton().disabled !== true);

  fitButton().click();
  await settle();
  check("fitting writes a coefficient and reports it",
    /Fitted k1|already as straight/.test(group().textContent),
    group().textContent.replace(/\s+/g, " ").slice(-90));

  const clear = [...group().querySelectorAll(".v-btn")]
    .find(b => b.textContent.trim() === "Clear");
  if (clear) {
    clear.click();
    await settle();
  } else {
    TX.store.setLens(image.id, TX.lens.defaults());
  }
  check("clearing puts the photograph back as shot",
    TX.lens.isIdentity(store.findImage(image.id).lens),
    JSON.stringify(store.findImage(image.id).lens));

  for (let k = 0; k < 4; k++) store.setMarkCurve(mark.id, k, null);
  await app.actions.convert("all");
  await settle();
}

async function runFadeChecks(app, texture) {
  const meshOf = id => app.atlas.stage.scene.children
    .find(o => o.isMesh && o.userData.textureId === id);

  const existing = store.state.textures.find(t => t.id !== texture.id);
  const other = existing || store.findTexture(app.atlas.duplicateTexture(texture.id));
  await settle();
  check("there is a second slice to hold back", !!other && !!meshOf(other.id),
    other ? other.id : "none");
  if (!other || !meshOf(other.id)) return;

  store.clearSelection();
  await settle();
  check("with nothing selected every slice is at full strength",
    meshOf(texture.id).material.opacity === 1 && meshOf(other.id).material.opacity === 1,
    `${meshOf(texture.id).material.opacity} / ${meshOf(other.id).material.opacity}`);

  store.select("texture", texture.id);
  await settle();
  check("selecting one holds the others back",
    meshOf(texture.id).material.opacity === 1 && meshOf(other.id).material.opacity < 1,
    `selected ${meshOf(texture.id).material.opacity}, other ${meshOf(other.id).material.opacity}`);
  check("but not so far that they cannot be arranged against it",
    meshOf(other.id).material.opacity > 0.3,
    String(meshOf(other.id).material.opacity));

  store.select("texture", [texture.id, other.id]);
  await settle();
  check("selecting both brings both back",
    meshOf(texture.id).material.opacity === 1 && meshOf(other.id).material.opacity === 1);

  store.select("texture", texture.id);
  await settle();
  const sheet = app.atlas.compositeAll();
  check("the atlas still composites", !!sheet && sheet.width > 0);
  if (sheet) {
    const inside = TX.stage.nodeCenter(other);
    const bounds = TX.stage.unionBounds(store.state.textures.map(TX.stage.nodeBounds));
    const x = Math.round(inside.x - bounds.minX);
    const y = Math.round(inside.y - bounds.minY);
    const { data } = sheet.canvas.getContext("2d").getImageData(x, y, 1, 1);
    check("and the fade never reaches the export", data[3] === 255,
      `alpha ${data[3]} at ${x},${y} inside the unselected slice`);
  }

  store.select("texture", texture.id);
  await settle();
}

async function runRectifyChecks(app, mark) {
  const image = store.findImage(mark.imageId);
  const before = store.state.images.length;

  const plan = TX.geom.rectifyPlan(mark.points, image.width, image.height, { maxSide: 4096 });
  check("the mark yields a plan to rectify its photo through", !!plan);
  if (!plan) return;

  const added = await app.actions.reprojectImage(mark.id);
  await settle();
  check("it arrives as a new photograph rather than changing this one",
    !!added && store.state.images.length === before + 1 && !!store.findImage(image.id),
    `${before} -> ${store.state.images.length}`);
  if (!added) return;

  check("at the size the plan asked for",
    added.width === plan.size.width && added.height === plan.size.height,
    `${added.width}x${added.height} vs ${plan.size.width}x${plan.size.height}`);
  check("with pixels the warp actually produced",
    store.assets.sources.has(added.id));
  check("and a file behind it, so a reload can bring it back",
    added.file instanceof Blob && added.file.type === "image/png",
    added.file ? added.file.type : "none");
  check("the new photo is what the selection lands on",
    store.selectedKind() === "image" && store.selectedIds("image").join() === added.id);

  const element = store.assets.sources.get(added.id).element;
  const rectified = document.createElement("canvas");
  rectified.width = added.width;
  rectified.height = added.height;
  rectified.getContext("2d").drawImage(element, 0, 0);

  const { domain } = plan;
  const perU = added.width / (domain.u1 - domain.u0);
  const perV = added.height / (domain.v1 - domain.v0);
  const centreOfMark = {
    x: Math.round((0.5 - domain.u0) * perU),
    y: Math.round((0.5 - domain.v0) * perV),
  };

  const direct = TX.warp.warpQuad(
    store.assets.sources.get(image.id).source, mark.points, { supersample: 1 });
  check("the same mark still extracts on its own", !!direct);
  if (!direct) return;

  const pixel = (canvas, x, y) => Array.from(
    canvas.getContext("2d").getImageData(x, y, 1, 1).data);
  const here = pixel(rectified, centreOfMark.x, centreOfMark.y);
  const there = pixel(direct, Math.round(direct.width / 2), Math.round(direct.height / 2));
  check("the middle of the mark is the same colour in both",
    here[3] > 200 && Math.abs(here[0] - there[0]) < 24
    && Math.abs(here[1] - there[1]) < 24 && Math.abs(here[2] - there[2]) < 24,
    `${here.join(",")} rectified vs ${there.join(",")} extracted`);

  check("what fell outside the photo came back transparent",
    pixel(rectified, 0, 0)[3] < 250 || plan.coverage > 0.999,
    `alpha ${pixel(rectified, 0, 0)[3]}, coverage ${plan.coverage.toFixed(3)}`);

  TX.history.commit();
  await settle();
  const depth = TX.history.status.depth;
  TX.history.undo();
  await settle();
  check("undo removes the rectified photo again",
    !store.findImage(added.id) && store.state.images.length === before,
    `${store.state.images.length} images, depth was ${depth}`);
  TX.history.redo();
  await settle();
  check("and redo brings it back with its pixels",
    !!store.findImage(added.id) && store.assets.sources.has(added.id));

  store.removeImage(added.id);
  store.select("mark", mark.id);
  await settle();
}

async function runSelectionChecks(app, mark, texture) {
  const props = TX.dock.content.get("properties");
  const overlay = TX.dock.content.get("mark").querySelector("canvas.tx-layer--overlay");
  const image = store.findImage(mark.imageId);
  const box = overlay.getBoundingClientRect();

  const at = (x, y) => {
    const world = TX.stage.localToWorld(image, { x, y });
    const screen = app.mark.stage.worldToScreen(world.x, world.y);
    return { x: box.left + screen.x, y: box.top + screen.y };
  };
  const plain = (type, point) => new PointerEvent(type, {
    clientX: point.x, clientY: point.y, button: 0, buttons: 1, pointerId: 5, bubbles: true,
  });

  const centre = mark.points.reduce((sum, p) => ({
    x: sum.x + p.x / 4, y: sum.y + p.y / 4,
  }), { x: 0, y: 0 });
  store.clearSelection();
  overlay.dispatchEvent(plain("pointerdown", at(centre.x, centre.y)));
  overlay.dispatchEvent(plain("pointerup", at(centre.x, centre.y)));
  await settle();
  check("clicking a mark selects it",
    store.selectedKind() === "mark" && store.selectedIds("mark").join() === mark.id,
    `${store.selectedKind()}:${store.selectionCount()}`);

  check("the Properties panel follows it onto the mark",
    /Mark/.test(props.textContent) && /Local space/.test(props.textContent),
    props.textContent.slice(0, 60));
  check("and offers only the groups a mark actually has",
    !/Seamless tiling/.test(props.textContent) && !/Transform/.test(props.textContent));

  check("the status bar describes the mark rather than the photo", (() => {
    store.state.activePanel = "mark";
    return app.stats.kind === "mark" && app.stats.selected === 1;
  })());

  store.select("texture", texture.id);
  await settle();
  check("selecting a texture drops the mark selection",
    store.selectedKind() === "texture" && store.selectionCount("mark") === 0);
  check("the Properties panel is back on the texture",
    /Seamless tiling/.test(props.textContent), props.textContent.slice(0, 60));

  const viewBefore = app.mark.stage.getViewport();
  store.clearSelection();
  await settle();
  app.mark.stage.setViewport({ panX: -4000, panY: -4000, zoom: viewBefore.zoom });
  await settle();
  store.select("texture", texture.id);
  await settle();
  const viewAfter = app.mark.stage.getViewport();
  check("selecting a slice brings its mark into view",
    Math.abs(viewAfter.panX + 4000) > 100 || Math.abs(viewAfter.panY + 4000) > 100,
    `${Math.round(viewAfter.panX)},${Math.round(viewAfter.panY)}`);
  check("and leaves the slice itself selected",
    store.selectedKind() === "texture" && store.selectedIds("texture").join() === texture.id);
  app.mark.stage.setViewport(viewBefore);

  store.select("texture", texture.id);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  check("escape clears the selection", store.selectedKind() === null);

  const spare = store.addMark(mark.imageId, [
    { x: 4, y: 4 }, { x: 14, y: 4 }, { x: 14, y: 14 }, { x: 4, y: 14 },
  ]);
  const markCount = store.state.marks.length;
  store.select("mark", spare.id);
  store.state.activePanel = "mark";
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  await settle();
  check("delete removes a selected mark",
    store.state.marks.length === markCount - 1 && !store.findMark(spare.id),
    `${markCount} -> ${store.state.marks.length}`);
  check("and the selection does not outlive it", store.selectedKind() === null);

  store.select("texture", texture.id);
  await settle();
}

async function runTooltipChecks(app) {
  const tooltip = TX.tooltip;

  const controls = [...document.querySelectorAll(
    ".tx-toolbar .v-btn, .tx-toolbar input, .tx-toolbar .v-select,"
    + " .tx-props .v-btn, .tx-props input, .tx-props .v-switch, .tx-props .v-select,"
    + " .tx-props .tx-group-head,"
    + " .tx-panel-bar .v-btn, .tx-panel-bar label,"
    + " .tx-measure input, .tx-measure .v-select,"
    + " .tx-footer .tx-stats, .tx-footer .tx-storage,"
    + " .tx-dock-tab, .tx-dock-btn",
  )].filter(el => el.offsetParent !== null || el.closest(".tx-dock-tab"));

  check("there are controls on screen to check", controls.length > 20,
    String(controls.length));

  const bare = controls.filter(el => !el.closest("[data-tip]"));
  check("every control on screen carries a tooltip", bare.length === 0,
    bare.slice(0, 6).map(el =>
      `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}`
      + `[${(el.textContent || "").trim().slice(0, 18)}]`).join(" / "));

  const tips = [...document.querySelectorAll("[data-tip]")]
    .map(el => el.getAttribute("data-tip"));
  check("the tooltips explain rather than repeat the label",
    tips.length > 30 && tips.every(t => t.length > 12),
    `${tips.length} tips, shortest "${tips.reduce((a, b) => (b.length < a.length ? b : a))}"`);

  const disabled = [...document.querySelectorAll(".tx-toolbar .v-btn--disabled")];
  check("disabled buttons say why they are disabled",
    disabled.length > 0 && disabled.every(el => /select|nothing|no /i.test(
      tooltip.textOf(el))),
    disabled.map(el => tooltip.textOf(el).slice(0, 28)).join(" / ") || "none disabled");

  const hovered = document.querySelector(".tx-toolbar .v-btn:last-child");
  tooltip.showNow(hovered);
  await settle();
  check("hovering a control shows its tooltip",
    tooltip.visible() === tooltip.textOf(hovered), tooltip.visible());
  check("the tooltip is placed on screen", (() => {
    const box = document.querySelector(".tx-tip").getBoundingClientRect();
    return box.width > 0 && box.left >= 0 && box.right <= window.innerWidth
      && box.top >= 0 && box.bottom <= window.innerHeight;
  })());

  tooltip.hide();
  await settle();
  check("moving away takes it down", tooltip.visible() === "");
  check("there is only ever one tooltip element",
    document.querySelectorAll(".tx-tip").length === 1,
    String(document.querySelectorAll(".tx-tip").length));
}

async function runTilingBarChecks(app, texture) {
  const store = TX.store;
  store.select("texture", texture.id);
  await settle();

  const bar = document.querySelector(".tx-tiling-bar");
  check("the tiling preview carries its own controls", !!bar);
  if (!bar) return;

  check("the options are no longer in the Properties panel",
    !/Tiling preview/.test(TX.dock.content.get("properties").textContent));

  const mesh = app.tilingPanel.stage.scene.children.find(c => c.isMesh);
  const sampler = () => mesh.material.map;
  const counts = [...bar.querySelectorAll('input[type="number"]')];
  check("it has a count for each axis", counts.length === 2, String(counts.length));

  const before = mesh.scale.x;
  counts[0].value = "6";
  counts[0].dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  check("typing a column count widens the sheet", mesh.scale.x > before * 1.5,
    `${before} -> ${mesh.scale.x}`);
  check("and the sampler repeats to match", sampler().repeat.x === 6,
    String(sampler().repeat.x));

  const tall = mesh.scale.y;
  counts[1].value = "4";
  counts[1].dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  check("typing a row count deepens it",
    mesh.scale.y > tall && sampler().repeat.y === 4,
    `${tall} -> ${mesh.scale.y}, repeat ${sampler().repeat.y}`);

  counts[0].value = "900";
  counts[0].dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  check("an absurd count is clamped", store.state.settings.preview.cols === 16,
    String(store.state.settings.preview.cols));

  const buttons = [...bar.querySelectorAll(".v-btn")];
  const press = el => {
    el.dispatchEvent(pointer("pointerdown", 0, 0));
    el.dispatchEvent(pointer("pointerup", 0, 0));
    el.click();
  };

  press(buttons[1]);
  await settle();
  check("the mirror button reaches the sampler's wrap mode",
    sampler().wrapS === 1002 && sampler().wrapT === 1002,
    `${sampler().wrapS}/${sampler().wrapT}`);
  check("and the button lights up", buttons[1].classList.contains("tx-bar-on"));

  press(buttons[0]);
  await settle();
  check("the repeat button puts it back", sampler().wrapS === 1000, String(sampler().wrapS));

  const seams = store.state.settings.preview.showSeams;
  press(buttons[2]);
  await settle();
  check("the seam button toggles the tile boundaries",
    store.state.settings.preview.showSeams === !seams);

  press(buttons[3]);
  await settle();
  check("the frame button leaves the sheet in view",
    app.tilingPanel.stage.view.zoom > 0 && Number.isFinite(app.tilingPanel.stage.view.panX),
    `zoom=${app.tilingPanel.stage.view.zoom}`);

  // ---- the source tile in the middle ---------------------------------------
  Object.assign(store.state.settings.preview, { cols: 3, rows: 3, wrap: "repeat" });
  await settle();
  const tileW = mesh.scale.x / 3;
  const tileH = mesh.scale.y / 3;
  check("the source tile is the middle one of an odd sheet",
    Math.abs(mesh.position.x - tileW / 2) < 0.01 && Math.abs(mesh.position.y - tileH / 2) < 0.01,
    `sheet centred at ${mesh.position.x.toFixed(1)},${mesh.position.y.toFixed(1)}`
    + ` for a ${tileW.toFixed(0)}x${tileH.toFixed(0)} tile`);

  Object.assign(store.state.settings.preview, { wrap: "mirror" });
  await settle();
  check("and under mirrored repeat it is the tile that is not reflected", (() => {
    const map = sampler();
    const preview = store.state.settings.preview;
    if (!map) return false;
    const periodX = Math.floor((preview.cols - 1) / 2) + map.offset.x;
    const periodY = Math.floor((preview.rows - 1) / 2) + map.offset.y;
    return Number.isInteger(periodX) && Number.isInteger(periodY)
      && periodX % 2 === 0 && periodY % 2 === 0;
  })(), `offset ${sampler().offset.x},${sampler().offset.y}`
    + ` for ${store.state.settings.preview.cols}x${store.state.settings.preview.rows}`);

  Object.assign(store.state.settings.preview, { cols: 2, rows: 2, wrap: "repeat" });
  await settle();
  check("an even sheet puts the source just left of centre",
    Math.abs(mesh.position.x - mesh.scale.x / 2) < 0.01,
    `centred at ${mesh.position.x.toFixed(1)} for a sheet ${mesh.scale.x.toFixed(0)} wide`);

  Object.assign(store.state.settings.preview, { cols: 3, rows: 3, wrap: "repeat", showSeams: true });
  await settle();
}

async function runStatusBarChecks(app, texture) {
  const state = TX.store.state;
  const bar = document.querySelector(".tx-footer");
  check("there is a status bar", !!bar);
  if (!bar) return;

  const hints = () => [...bar.querySelectorAll(".tx-status-hint")]
    .map(el => el.textContent.replace(/\s+/g, " ").trim());

  store.select("texture", texture.id);
  state.activePanel = "atlas";
  await settle();
  const atlas = hints();
  check("the atlas offers what you can do to a selection",
    atlas.some(h => /rotate/i.test(h)) && atlas.some(h => /flatten/i.test(h)),
    atlas.join(" | "));

  store.clearSelection();
  await settle();
  check("with nothing selected it stops offering to rotate it",
    !hints().some(h => /rotate/i.test(h)), hints().join(" | "));

  state.activePanel = "mark";
  await settle();
  check("the mark panel offers marking instead",
    hints().some(h => /place a corner/i.test(h)), hints().join(" | "));

  store.select("texture", texture.id);
  state.activePanel = "preview3d";
  await settle();
  check("the 3D panel offers orbiting", hints().some(h => /orbit/i.test(h)), hints().join(" | "));

  check("the counts are there", /\d+ image/.test(bar.textContent), bar.textContent.trim());
  check("and each group says what it costs",
    (bar.textContent.match(/\d+(\.\d+)?\s*(kB|MB)/g) || []).length >= 2,
    bar.querySelector(".tx-stats").textContent.replace(/\s+/g, " ").trim());
  check("marks are counted as regions, since that is what they are",
    /\d+ region/.test(bar.textContent), bar.querySelector(".tx-stats").textContent.trim());
  check("and the derived maps are counted with the slices that grew them", (() => {
    const before = TX.store.usage().textures;
    TX.material.warm(texture.id);
    const after = TX.store.usage().textures;
    return after.maps >= before.maps && after.bytes >= before.bytes;
  })(), `${TX.store.usage().textures.maps} maps, `
    + `${Math.round(TX.store.usage().textures.bytes / 1024)} kB`);

  check("nothing is said about saving while it is working",
    !bar.querySelector(".tx-storage"),
    bar.querySelector(".tx-storage") ? bar.querySelector(".tx-storage").textContent.trim() : "");

  check("the grid settings are no longer in the bar", !bar.querySelector("input[type=number]"));
  const settingsBtn = document.querySelector(".tx-settings-btn");
  check("they are behind a Settings button", !!settingsBtn);
  if (settingsBtn) {
    settingsBtn.click();
    await settle();
    const menu = settingsMenu();
    check("the settings menu opens", !!menu);
    if (menu) {
      const labels = [...menu.querySelectorAll(".tx-settings-section")].map(el => el.textContent);
      check("it groups them by what they affect",
        labels.join(",") === "Panels,Language,Grid,Marking,Extraction,Packing,Export,AI,Help",
        labels.join(","));
      const grid = menu.querySelector("input[type=number]");
      grid.value = "32";
      grid.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
      check("editing one reaches the store", state.settings.gridSize === 32,
        String(state.settings.gridSize));
      state.settings.gridSize = 16;

      // ---- the AI switch ---------------------------------------------------
      const ai = menu.querySelector(".tx-settings-ai input[type=checkbox]");
      check("the menu carries the AI switch, off by default",
        !!ai && !ai.checked && state.settings.ai === false, String(state.settings.ai));
      const link = menu.querySelector(".tx-props-note a");
      check("and links the one model it means",
        !!link && link.href === `https://huggingface.co/${TX.depthModel.MODEL}`
        && link.rel.includes("noopener"),
        link ? `${link.href} rel=${link.rel}` : "no link");
      check("and says what is not AI, using those features' own names",
        menu.textContent.includes(TX.t("props.material.generate_pbr"))
        && menu.textContent.includes(TX.t("context.flatten_lighting")),
        menu.textContent.replace(/\s+/g, " ").slice(-260));

      if (ai) {
        TX.history.commit();
        ai.click();
        await settle();
        check("switching it on reaches the store", state.settings.ai === true);
        TX.history.commit();
        check("and undo names it", TX.history.status.undoLabel === "AI features",
          TX.history.status.undoLabel);
        ai.click();
        await settle();
        check("and it goes off again", state.settings.ai === false);
      }

      check("the toolbar no longer carries a help button by itself",
        ![...document.querySelectorAll(".tx-toolbar .v-btn")]
          .some(el => /keyboard shortcut/i.test(TX.tooltip.textOf(el))));
      const shortcuts = menu.querySelector(".tx-settings-shortcuts");
      check("the menu offers them instead", !!shortcuts);
      if (shortcuts) {
        shortcuts.click();
        await settle();
        check("and opening them puts the dialog up", app.helpOpen === true);
        check("with the shortcuts themselves in it",
          document.querySelectorAll(".tx-help-row").length > 20
          && /Flatten the selection/.test(document.body.textContent),
          String(document.querySelectorAll(".tx-help-row").length));

        const f1 = () => window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "F1", bubbles: true }));
        f1();
        await settle();
        check("F1 closes it again", app.helpOpen === false);
        f1();
        await settle();
        check("and opens it, which is what the row and the status bar say it does",
          app.helpOpen === true);
        app.helpOpen = false;
        await settle();
      }
    }
    await closeSettingsMenu();
  }

  state.activePanel = "atlas";
  store.select("texture", texture.id);
  await settle();
}

async function runLightingChecks(app, texture) {
  const store = TX.store;
  store.select("texture", texture.id);
  await settle();

  const panel = TX.dock.content.get("properties");
  const groups = [...panel.querySelectorAll(".tx-group-title")].map(el => el.textContent.trim());
  check("the properties panel has a lighting group", groups.includes("Lighting"),
    groups.join(","));
  check("the histogram is drawn for the selected texture",
    !!panel.querySelector(".tx-hist-canvas"));
  check("the histogram reports the texture's statistics",
    /mean \d+/.test(panel.querySelector(".tx-hist-legend") ?
      panel.querySelector(".tx-hist-legend").textContent : ""),
    panel.querySelector(".tx-hist-legend") ?
      panel.querySelector(".tx-hist-legend").textContent.replace(/\s+/g, " ").trim() : "none");

  const modeButton = label => [...panel.querySelectorAll(".tx-props-toggle button")]
    .find(b => b.textContent.trim() === label);
  check("the lighting modes are offered",
    !!modeButton("Off") && !!modeButton("Gradient") && !!modeButton("Local"));

  const before = store.textureCanvas(texture.id);
  modeButton("Gradient").click();
  await settle();
  check("clicking a mode sets it on the texture", texture.delight.mode === "gradient",
    texture.delight.mode);
  check("the displayed canvas changes with it",
    store.textureCanvas(texture.id) !== before);

  const sliderFor = label => [...panel.querySelectorAll(".tx-props-slider")]
    .find(el => el.querySelector("span").textContent.trim() === label);
  const amount = sliderFor("Amount");
  check("an amount slider appears once a mode is chosen", !!amount);
  if (amount) {
    const input = amount.querySelector("input");
    input.value = "40";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    check("dragging the amount slider changes the strength",
      Math.abs(texture.delight.strength - 0.4) < 1e-6, String(texture.delight.strength));
  }
  check("the gradient mode offers a falloff, not a radius",
    !!sliderFor("Falloff") && !sliderFor("Radius"));

  modeButton("Local").click();
  await settle();
  check("the local mode swaps in a radius instead",
    !!sliderFor("Radius") && !sliderFor("Falloff"));

  const shadingBefore = store.state.textures.length;
  const shadingButton = [...panel.querySelectorAll("button")]
    .find(b => /Extract shading map/.test(b.textContent));
  check("the shading map can be extracted from the panel", !!shadingButton);
  if (shadingButton) {
    shadingButton.click();
    await settle();
    check("extracting adds a texture", store.state.textures.length === shadingBefore + 1,
      `${shadingBefore} -> ${store.state.textures.length}`);
    const added = store.state.textures[store.state.textures.length - 1];
    check("the extracted map is named after its source", /-shading$/.test(added.name), added.name);
    check("extracting selects what it just made",
      store.selectedIds("texture").join() === added.id, store.selectedIds("texture").join());
    store.removeTexture(added.id);
    store.select("texture", texture.id);
    await settle();
  }

  modeButton("Off").click();
  await settle();
  check("turning it off restores the extraction untouched",
    store.textureCanvas(texture.id) === store.assets.textures.get(texture.id).canvas);

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
  await settle();
  check("the L key flattens the selection", texture.delight.mode === "gradient",
    texture.delight.mode);
  check("the panel followed the keyboard", (() => {
    const active = panel.querySelector(".tx-props-toggle .v-btn--active");
    return !!active && active.textContent.trim() === "Gradient";
  })());
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
  await settle();
  check("pressing it again turns it back off", texture.delight.mode === "none",
    texture.delight.mode);
}

async function runLivePreviewChecks(app, texture) {
  const store = TX.store;
  const panel = TX.dock.content.get("properties");
  store.select("texture", texture.id);
  store.setDelight(texture.id, { mode: "none", strength: 0.5 });
  await settle();

  const atlasImage = () => {
    const mesh = app.atlas.stage.scene.children
      .find(o => o.isMesh && o.userData.textureId === texture.id);
    return mesh ? mesh.material.map.image : null;
  };
  const previewImage = () => {
    const mesh = app.tilingPanel.stage.scene.children.find(o => o.isMesh);
    return mesh && mesh.material.map ? mesh.material.map.image : null;
  };

  const raw = store.assets.textures.get(texture.id).canvas;
  check("the atlas starts on the extracted pixels", atlasImage() === raw);
  check("and so does the tiling preview", previewImage() === raw);

  const modeButton = label => [...panel.querySelectorAll(".tx-props-toggle button")]
    .find(b => b.textContent.trim() === label);
  modeButton("Gradient").click();
  await settle();

  const flattened = store.textureCanvas(texture.id);
  check("flattening derives a different canvas", flattened !== raw);
  check("the atlas shows the flattened texture, not the photo's light",
    atlasImage() === flattened);
  check("the tiling preview shows it too", previewImage() === flattened);

  const amount = [...panel.querySelectorAll(".tx-props-slider")]
    .find(el => el.querySelector("span").textContent.trim() === "Amount");
  check("the amount slider is there to drag", !!amount);
  if (amount) {
    const input = amount.querySelector("input");
    input.value = "25";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();

    const weaker = store.textureCanvas(texture.id);
    check("a weaker amount re-derives the pixels", weaker !== flattened);
    check("the atlas follows the amount slider", atlasImage() === weaker);
    check("the tiling preview follows it", previewImage() === weaker);
  }

  store.setDelight(texture.id, { mode: "none" });
  await settle();
  check("turning it off puts the extraction back in both panels",
    atlasImage() === raw && previewImage() === raw);
}

async function runPropertyGroupChecks(texture) {
  const store = TX.store;
  const settings = store.state.settings.props;
  store.select("texture", texture.id);
  settings.lighting = true;
  settings.local = false;
  await settle();

  const panel = TX.dock.content.get("properties");
  const groupFor = title => [...panel.querySelectorAll(".tx-group")]
    .find(g => g.querySelector(".tx-group-title").textContent.trim() === title);
  const bodyOf = title => {
    const group = groupFor(title);
    return group ? group.querySelector(".tx-group-body") : null;
  };

  const titles = [...panel.querySelectorAll(".tx-group-title")].map(el => el.textContent.trim());
  check("the properties are split into groups",
    ["Atlas transform", "Local space", "Lighting", "Seamless tiling"]
      .every(t => titles.includes(t)), titles.join(","));
  check("the placement group says which space it is about",
    titles.includes("Atlas transform") && !titles.includes("Transform"), titles.join(","));
  check("an open group shows its controls", !!bodyOf("Lighting"));
  check("a folded one shows only its heading", !bodyOf("Local space"));

  const badge = groupFor("Lighting").querySelector(".tx-group-badge");
  check("a group states what it is set to without being opened",
    !!badge && /off|gradient|local/.test(badge.textContent),
    badge ? badge.textContent.trim() : "none");

  groupFor("Lighting").querySelector(".tx-group-head").click();
  await settle();
  check("clicking a heading folds the group away",
    !bodyOf("Lighting") && settings.lighting === false, String(settings.lighting));
  groupFor("Local space").querySelector(".tx-group-head").click();
  await settle();
  check("and unfolds another", !!bodyOf("Local space") && settings.local === true,
    `body=${!!bodyOf("Local space")} local=${settings.local}`);

  const record = store.viewRecord();
  check("the open groups ride along in the view record",
    !!record.settings.props && record.settings.props.lighting === false
    && record.settings.props.local === true,
    JSON.stringify(record.settings.props));

  settings.lighting = true;
  settings.local = false;
  await settle();

  // ---- the explanations, which are now in the headings ----------------------
  check("the help toggle is gone", !panel.querySelector(".tx-props-hints"));
  check("and it took the prose with it", panel.querySelectorAll(".tx-props-note").length < 4,
    String(panel.querySelectorAll(".tx-props-note").length));

  const headings = [...panel.querySelectorAll(".tx-group-head")];
  const tipOf = head => TX.tooltip.textOf(head);
  const thin = headings.filter(head => tipOf(head).length < 80);
  check("every group's heading explains itself instead", thin.length === 0,
    thin.map(head => head.textContent.replace(/\s+/g, " ").trim()).join(" | ")
    || `${headings.length} headings`);

  check("and the explanation says what the group is set to as well", (() => {
    const tip = tipOf(groupFor("Lighting").querySelector(".tx-group-head"));
    return /Currently:/.test(tip) && /albedo|illumination/.test(tip);
  })(), tipOf(groupFor("Lighting").querySelector(".tx-group-head")).slice(0, 100));
}

async function runViewportChecks(app) {
  const store = TX.store;
  const stage = app.mark.stage;

  stage.setViewport({ panX: 100, panY: 50, zoom: 1 });
  stage.panBy(40, 24);
  await settle();

  const viewport = store.state.viewports.mark;
  check("panning reports the viewport into the store", !!viewport, JSON.stringify(viewport));
  check("the stored viewport matches the stage",
    !!viewport && viewport.panX === stage.getViewport().panX
    && viewport.panY === stage.getViewport().panY,
    `${JSON.stringify(viewport)} vs ${JSON.stringify(stage.getViewport())}`);

  check("zooming reports too", (() => {
    stage.setZoom(2, { x: 10, y: 10 });
    return store.state.viewports.mark.zoom === 2;
  })(), String(store.state.viewports.mark.zoom));

  check("a restored viewport is applied",
    stage.setViewport({ panX: 7, panY: 8, zoom: 1.25 })
    && stage.getViewport().panX === 7 && stage.getViewport().zoom === 1.25,
    JSON.stringify(stage.getViewport()));
  check("an invalid viewport is refused",
    stage.setViewport({ panX: NaN, panY: 0, zoom: 1 }) === false
    && stage.setViewport(null) === false
    && stage.getViewport().panX === 7);

  await sleep(600);
  store.clearViewRecord();
  check("clearing the record works", store.loadViewRecord() === null);
  stage.panBy(11, 13);
  await settle();
  const written = store.loadViewRecord();
  check("the first change of a burst is written on the spot",
    !!written && !!written.viewports.mark,
    written ? JSON.stringify(written.viewports.mark) : "none");
  check("the written record matches the live viewport",
    !!written && written.viewports.mark.panX === stage.getViewport().panX,
    written ? `${written.viewports.mark.panX} vs ${stage.getViewport().panX}` : "none");

  stage.panBy(29, 31);
  await settle();
  TX.durable.runFlushers();
  const flushed = store.loadViewRecord();
  check("an unload flush captures the last change",
    !!flushed && flushed.viewports.mark.panX === stage.getViewport().panX,
    flushed ? `${flushed.viewports.mark.panX} vs ${stage.getViewport().panX}` : "none");
  check("the flush also captured the active panel and settings",
    !!flushed && typeof flushed.activePanel === "string" && !!flushed.settings,
    flushed ? flushed.activePanel : "none");

  TX.dock.content.get("atlas").dispatchEvent(pointer("pointerdown", 10, 10));
  await settle();
  check("clicking a panel records it as active", store.state.activePanel === "atlas",
    store.state.activePanel);

  const record = store.viewRecord();
  store.state.viewports.mark = null;
  store.state.activePanel = "mark";
  store.applyViewRecord(record, 0);
  check("applying the record restores the viewport and active panel",
    store.state.viewports.mark
    && store.state.viewports.mark.panX === stage.getViewport().panX
    && store.state.activePanel === "atlas",
    JSON.stringify(store.state.viewports.mark));
}

function report() {
  lines.push("");
  lines.push(failures ? `RESULT: ${failures} FAILURE(S)` : "RESULT: ALL PASSED");
  const pre = document.createElement("pre");
  pre.id = "results";
  pre.textContent = lines.join("\n");
  document.body.appendChild(pre);
}

run().then(report).catch(err => {
  failures++;
  lines.push(`FAIL  threw: ${err && err.message}`);
  lines.push(String(err && err.stack).split("\n").slice(0, 5).join("\n"));
  report();
});
