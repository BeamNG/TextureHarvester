import { reactive } from "vue";
import { TX } from "../tx.js";

TX.components = TX.components || {};

const tree = TX.dockTree;

// Key predates the Texture Harvester rename; changing it would reset the dock layout.
const LAYOUT_KEY = "texture-extract:layout";
const LAYOUT_KEY_MOBILE = "texture-extract:layout-mobile";
const MIN_FRACTION = 0.08;
const EDGE_THRESHOLD = 26;
const DRAG_THRESHOLD = 4;

const content = new Map();
let parking = null;

function parkingHost() {
  if (!parking) {
    parking = document.createElement("div");
    parking.className = "tx-dock-parking";
    document.body.appendChild(parking);
  }
  return parking;
}

function register(panelId, element) {
  element.classList.add("tx-dock-content");
  content.set(panelId, element);
  parkingHost().appendChild(element);
}

function syncHosts(rootEl) {
  if (!rootEl) return;
  const slots = new Map();
  for (const slot of rootEl.querySelectorAll("[data-dock-slot]")) {
    slots.set(slot.getAttribute("data-dock-slot"), slot);
  }
  for (const [panelId, element] of content) {
    const slot = slots.get(panelId) || parkingHost();
    if (element.parentElement !== slot) slot.appendChild(element);
  }
}

function keyFor(mode) {
  return mode === "mobile" ? LAYOUT_KEY_MOBILE : LAYOUT_KEY;
}

function load(mode = "desktop") {
  return TX.durable.read(keyFor(mode), TX.schema.layout);
}

function save(state) {
  TX.durable.write(keyFor(state.mode || "desktop"), TX.schema.layout, {
    root: state.root,
    floating: state.floating.map(w => ({ ...w })),
    maximized: state.maximized,
  });
}

function applySaved(state, knownPanels, factory, saved) {
  if (saved && tree.isValid(saved.root)) {
    const reconciled = tree.reconcile(saved.root, knownPanels);
    state.root = reconciled ? tree.reid(reconciled) : factory();
    state.floating = (saved.floating || []).filter(w =>
      Array.isArray(w.panels) && w.panels.every(p => knownPanels.includes(p)));
    if (state.mode === "mobile") state.floating = [];
    state.maximized = knownPanels.includes(saved.maximized) ? saved.maximized : null;

    const placed = new Set(tree.collectPanels(state.root));
    for (const win of state.floating) for (const p of win.panels) placed.add(p);
    for (const panelId of knownPanels) {
      if (placed.has(panelId)) continue;
      if (state.mode === "mobile" && state.root && state.root.type === "tabs") {
        state.root.panels.push(panelId);
      } else {
        state.root = tree.insertAtRootEdge(state.root, panelId, "right");
      }
    }
  } else {
    state.root = factory();
    state.floating = [];
    state.maximized = null;
  }
}

function createState(desktopFactory, knownPanels, mobileFactory) {
  const mobileRoot = mobileFactory || desktopFactory;
  const state = reactive({
    root: null,
    floating: [],
    maximized: null,
    drag: null,
    drop: null,
    mode: TX.device && TX.device.compact ? "mobile" : "desktop",
  });

  const factoryOf = () => (state.mode === "mobile" ? mobileRoot : desktopFactory)();

  state.reset = () => {
    state.root = factoryOf();
    state.floating = [];
    state.maximized = null;
    state.drag = null;
    state.drop = null;
    save(state);
  };

  state.setMode = mode => {
    const next = mode === "mobile" ? "mobile" : "desktop";
    if (state.mode === next) return;
    save(state);
    state.mode = next;
    state.drag = null;
    state.drop = null;
    applySaved(state, knownPanels, factoryOf, load(next));
  };

  TX.durable.onFlush(() => save(state));
  applySaved(state, knownPanels, factoryOf, load(state.mode));
  if (!state.root) state.reset();

  return state;
}

const asRect = domRect => ({
  left: domRect.left, top: domRect.top, width: domRect.width, height: domRect.height,
});

TX.dock = {
  content, register, syncHosts, createState, save, load,
  LAYOUT_KEY, LAYOUT_KEY_MOBILE,
};

TX.components.DockNode = {
  name: "DockNode",
  props: { node: { type: Object, required: true } },
  inject: ["dock"],
  methods: {
    cellStyle(index) {
      return { flexGrow: this.node.sizes[index], flexBasis: "0px" };
    },
  },
  template: `
    <div v-if="node.type === 'split'"
         class="tx-dock-split" :class="'tx-dock-split--' + node.dir"
         :data-dock-node="node.id">
      <template v-for="(child, i) in node.children" :key="child.id">
        <div class="tx-dock-cell" :style="cellStyle(i)">
          <dock-node :node="child" />
        </div>
        <div v-if="i < node.children.length - 1"
             class="tx-dock-gutter" :class="'tx-dock-gutter--' + node.dir"
             @pointerdown="dock.startSplitDrag(node, i, $event)"></div>
      </template>
    </div>

    <div v-else class="tx-dock-group" :data-dock-node="node.id" :data-dock-group="node.id">
      <div class="tx-dock-tabs" :data-dock-tabbar="node.id">
        <div v-for="panelId in node.panels" :key="panelId"
             class="tx-dock-tab"
             :class="{
               'tx-dock-tab--active': panelId === node.active,
               'tx-dock-tab--live': dock.live(panelId),
             }"
             :data-dock-tab="panelId" v-tip="dock.hint(panelId)"
             @pointerdown="dock.startTabDrag(panelId, $event)">
          <span>{{ dock.title(panelId) }}</span>
          <span v-if="dock.live(panelId)" class="tx-dock-tab-live" aria-hidden="true"></span>
          <button v-if="dock.closable(panelId)" class="tx-dock-x"
                  v-tip="t('dock.close_panel.tip')"
                  @pointerdown.stop @click.stop="dock.close(panelId)">&times;</button>
        </div>
        <div class="tx-dock-tabfill" v-tip="t('dock.drag_group.tip')"></div>
        <button v-if="!dock.compact()" class="tx-dock-btn" v-tip="t('dock.maximize.tip')"
                @click="dock.maximize(node.active)">&#9744;</button>
      </div>
      <div class="tx-dock-body" :data-dock-slot="node.active"></div>
    </div>
  `,
};

TX.components.Dock = {
  name: "Dock",
  components: { DockNode: TX.components.DockNode },
  props: {
    state: { type: Object, required: true },
    panels: { type: Object, required: true },
    compact: { type: Boolean, default: false },
    signals: { type: Object, default: () => ({}) },
  },
  data() {
    return { api: null };
  },
  // Vue evaluates provide() before created(); build api here so children do not inject null.
  provide() {
    this.api = this.buildApi();
    return { dock: this.api };
  },
  computed: {
    rootEmpty() {
      return !this.state.root || tree.collectPanels(this.state.root).length === 0;
    },
    indicatorStyle() {
      const drop = this.state.drop;
      if (!drop || !drop.rect || !this.$refs.surface) return { display: "none" };
      const host = this.$refs.surface.getBoundingClientRect();
      return {
        left: `${drop.rect.left - host.left}px`,
        top: `${drop.rect.top - host.top}px`,
        width: `${drop.rect.width}px`,
        height: `${drop.rect.height}px`,
      };
    },
    ghostStyle() {
      const drag = this.state.drag;
      if (!drag) return { display: "none" };
      return { left: `${drag.x + 12}px`, top: `${drag.y + 12}px` };
    },
  },
  methods: {
    buildApi() {
      return {
        title: id => (this.panels[id] ? this.panels[id].title : id),
        hint: id => {
          const own = this.panels[id] && this.panels[id].hint;
          const suffix = TX.t("dock.tab.hint_suffix");
          return own ? `${own}. ${suffix}` : suffix;
        },
        closable: id => !this.compact
          && (!this.panels[id] || this.panels[id].closable !== false),
        live: id => !!this.signals[id],
        activate: id => { this.state.root = tree.setActive(this.state.root, id); },
        close: id => this.closePanel(id),
        open: id => this.openPanel(id),
        maximize: id => { this.state.maximized = this.state.maximized === id ? null : id; },
        startTabDrag: (id, event) => this.startTabDrag(id, event),
        startSplitDrag: (node, index, event) => this.startSplitDrag(node, index, event),
        compact: () => this.compact,
      };
    },

    floatStyle(win) {
      if (win.maximized) return { left: "0px", top: "0px", width: "100%", height: "100%" };
      return { left: `${win.x}px`, top: `${win.y}px`, width: `${win.w}px`, height: `${win.h}px` };
    },

    closePanel(panelId) {
      const win = this.state.floating.find(w => w.panels.includes(panelId));
      if (win) {
        win.panels = win.panels.filter(p => p !== panelId);
        if (!win.panels.length) this.state.floating = this.state.floating.filter(w => w !== win);
        else if (win.active === panelId) win.active = win.panels[0];
      } else {
        const next = tree.removePanel(this.state.root, panelId);
        if (next) this.state.root = next;
      }
      if (this.state.maximized === panelId) this.state.maximized = null;
      this.persist();
    },

    openPanel(panelId) {
      if (tree.collectPanels(this.state.root).includes(panelId)) {
        this.state.root = tree.setActive(this.state.root, panelId);
        return;
      }
      if (this.state.floating.some(w => w.panels.includes(panelId))) return;
      if (this.compact) {
        const root = this.state.root;
        if (root && root.type === "tabs") {
          root.panels = root.panels.concat(panelId);
          root.active = panelId;
          this.persist();
          return;
        }
        this.state.root = tree.tabs(
          tree.collectPanels(root).concat(panelId),
          panelId,
        );
        this.persist();
        return;
      }
      this.state.root = tree.insertAtRootEdge(this.state.root, panelId, "right");
      this.persist();
    },

    detach(panelId, x, y) {
      const next = tree.removePanel(this.state.root, panelId);
      this.state.root = next || tree.tabs([]);
      this.state.floating.push({
        id: `f${Date.now()}${Math.round(Math.random() * 1000)}`,
        panels: [panelId],
        active: panelId,
        x: Math.max(0, x),
        y: Math.max(0, y),
        w: 420,
        h: 320,
        maximized: false,
      });
      this.persist();
    },

    startTabDrag(panelId, event) {
      if (event.button !== 0) return;
      if (this.compact) {
        this.api.activate(panelId);
        return;
      }
      const origin = { x: event.clientX, y: event.clientY };
      let started = false;

      const move = e => {
        if (!started) {
          if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_THRESHOLD) return;
          started = true;
          this.state.drag = { panelId, x: e.clientX, y: e.clientY };
        }
        this.state.drag.x = e.clientX;
        this.state.drag.y = e.clientY;
        this.state.drop = this.resolveDrop(e.clientX, e.clientY, panelId);
      };

      const up = e => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.classList.remove("tx-dock-dragging");

        if (!started) {
          this.api.activate(panelId);
        } else {
          this.applyDrop(panelId, this.resolveDrop(e.clientX, e.clientY, panelId), e);
        }
        this.state.drag = null;
        this.state.drop = null;
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      document.body.classList.add("tx-dock-dragging");
    },

    resolveDrop(x, y, panelId) {
      const surface = this.$refs.surface;
      if (!surface) return null;
      const host = surface.getBoundingClientRect();

      const outside = x < host.left || x > host.right || y < host.top || y > host.bottom;
      if (outside) return { kind: "float", rect: null };

      const edges = [
        { edge: "left", d: x - host.left },
        { edge: "right", d: host.right - x },
        { edge: "top", d: y - host.top },
        { edge: "bottom", d: host.bottom - y },
      ].sort((a, b) => a.d - b.d);

      if (edges[0].d < EDGE_THRESHOLD) {
        const edge = edges[0].edge;
        const rect = asRect(host);
        if (edge === "left") rect.width = host.width * 0.25;
        if (edge === "right") { rect.left = host.left + host.width * 0.75; rect.width = host.width * 0.25; }
        if (edge === "top") rect.height = host.height * 0.25;
        if (edge === "bottom") { rect.top = host.top + host.height * 0.75; rect.height = host.height * 0.25; }
        return { kind: "rootEdge", edge, rect };
      }

      for (const bar of surface.querySelectorAll("[data-dock-tabbar]")) {
        const barRect = bar.getBoundingClientRect();
        if (x < barRect.left || x > barRect.right || y < barRect.top || y > barRect.bottom) continue;
        const nodeId = bar.getAttribute("data-dock-tabbar");
        const tabsEls = Array.from(bar.querySelectorAll("[data-dock-tab]"));
        let index = tabsEls.length;
        for (let i = 0; i < tabsEls.length; i++) {
          const r = tabsEls[i].getBoundingClientRect();
          if (x < r.left + r.width / 2) { index = i; break; }
        }
        const caret = tabsEls[Math.min(index, tabsEls.length - 1)];
        const caretRect = caret ? caret.getBoundingClientRect() : barRect;
        return {
          kind: "tabbar",
          nodeId,
          index,
          rect: {
            left: index >= tabsEls.length ? caretRect.right : caretRect.left,
            top: caretRect.top,
            width: 2,
            height: caretRect.height,
          },
        };
      }

      for (const group of surface.querySelectorAll("[data-dock-group]")) {
        const rect = group.getBoundingClientRect();
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
        const resolved = tree.zoneAt(asRect(rect), { x, y });
        return { kind: "group", nodeId: group.getAttribute("data-dock-group"), ...resolved };
      }

      return { kind: "center", rect: asRect(host) };
    },

    applyDrop(panelId, drop, event) {
      if (!drop) return;
      const surface = this.$refs.surface;
      const host = surface ? surface.getBoundingClientRect() : { left: 0, top: 0 };

      const fromFloat = this.state.floating.find(w => w.panels.includes(panelId));

      const dockIt = mutate => {
        if (fromFloat) {
          fromFloat.panels = fromFloat.panels.filter(p => p !== panelId);
          if (!fromFloat.panels.length) this.state.floating = this.state.floating.filter(w => w !== fromFloat);
          else if (fromFloat.active === panelId) fromFloat.active = fromFloat.panels[0];
          this.state.root = mutate(this.state.root, true);
        } else {
          this.state.root = mutate(this.state.root, false);
        }
        this.persist();
      };

      if (drop.kind === "float") {
        if (fromFloat) {
          fromFloat.x = event.clientX - host.left - 40;
          fromFloat.y = event.clientY - host.top - 12;
          this.persist();
        } else {
          this.detach(panelId, event.clientX - host.left - 40, event.clientY - host.top - 12);
        }
        return;
      }

      if (drop.kind === "rootEdge" || drop.kind === "center") {
        const edge = drop.edge || "right";
        dockIt((root, wasFloating) => (wasFloating
          ? tree.insertAtRootEdge(root, panelId, edge)
          : tree.insertAtRootEdge(tree.removePanel(root, panelId) || tree.tabs([]), panelId, edge)));
        return;
      }

      if (drop.kind === "tabbar") {
        dockIt((root, wasFloating) => {
          const holder = tree.findPanel(root, panelId);
          if (!wasFloating && holder && holder.id === drop.nodeId) {
            return tree.setActive(tree.reorderTab(root, panelId, drop.index), panelId);
          }
          const inserted = wasFloating
            ? tree.insertPanel(root, panelId, drop.nodeId, "center")
            : tree.movePanel(root, panelId, drop.nodeId, "center");
          return tree.setActive(tree.reorderTab(inserted, panelId, drop.index), panelId);
        });
        return;
      }

      if (drop.kind === "group") {
        dockIt((root, wasFloating) => {
          const holder = tree.findPanel(root, panelId);
          if (!wasFloating && holder && holder.id === drop.nodeId
            && (drop.zone === "center" || holder.panels.length === 1)) {
            return tree.setActive(root, panelId);
          }
          const next = wasFloating
            ? tree.insertPanel(root, panelId, drop.nodeId, drop.zone)
            : tree.movePanel(root, panelId, drop.nodeId, drop.zone);
          return tree.setActive(next, panelId);
        });
      }
    },

    startSplitDrag(node, index, event) {
      if (event.button !== 0) return;
      event.preventDefault();
      const container = this.$refs.surface.querySelector(`[data-dock-node="${node.id}"]`);
      if (!container) return;

      const horizontal = node.dir === "row";
      const rect = container.getBoundingClientRect();
      const gutters = (node.children.length - 1) * 6;
      const available = (horizontal ? rect.width : rect.height) - gutters;
      if (available <= 0) return;

      const start = horizontal ? event.clientX : event.clientY;
      const initial = node.sizes.slice();
      const pairTotal = initial[index] + initial[index + 1];

      const move = e => {
        const delta = ((horizontal ? e.clientX : e.clientY) - start) / available;
        const first = Math.max(MIN_FRACTION, Math.min(pairTotal - MIN_FRACTION, initial[index] + delta));
        const sizes = initial.slice();
        sizes[index] = first;
        sizes[index + 1] = pairTotal - first;
        this.state.root = tree.setSizes(this.state.root, node.id, sizes);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.classList.remove("tx-dock-resizing");
        this.persist();
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      document.body.classList.add("tx-dock-resizing");
    },

    startFloatMove(win, event) {
      if (event.button !== 0 || win.maximized) return;
      const origin = { x: event.clientX - win.x, y: event.clientY - win.y };
      const host = this.$refs.surface.getBoundingClientRect();

      const move = e => {
        win.x = Math.max(-win.w + 80, Math.min(host.width - 40, e.clientX - origin.x));
        win.y = Math.max(0, Math.min(host.height - 28, e.clientY - origin.y));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.persist();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      event.preventDefault();
    },

    startFloatResize(win, dirX, dirY, event) {
      if (event.button !== 0 || win.maximized) return;
      event.preventDefault();
      event.stopPropagation();
      const start = { x: event.clientX, y: event.clientY, w: win.w, h: win.h, ox: win.x, oy: win.y };

      const move = e => {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (dirX > 0) win.w = Math.max(220, start.w + dx);
        if (dirX < 0) {
          const w = Math.max(220, start.w - dx);
          win.x = start.ox + (start.w - w);
          win.w = w;
        }
        if (dirY > 0) win.h = Math.max(140, start.h + dy);
        if (dirY < 0) {
          const h = Math.max(140, start.h - dy);
          win.y = start.oy + (start.h - h);
          win.h = h;
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.persist();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },

    redock(win, panelId) {
      win.panels = win.panels.filter(p => p !== panelId);
      if (!win.panels.length) this.state.floating = this.state.floating.filter(w => w !== win);
      else if (win.active === panelId) win.active = win.panels[0];
      this.state.root = tree.insertAtRootEdge(this.state.root, panelId, "right");
      this.persist();
    },

    persist() {
      TX.dock.save(this.state);
    },
  },

  mounted() {
    syncHosts(this.$refs.surface);
    this.observer = new ResizeObserver(() => syncHosts(this.$refs.surface));
    this.observer.observe(this.$refs.surface);
  },
  updated() {
    syncHosts(this.$refs.surface);
  },
  beforeUnmount() {
    if (this.observer) this.observer.disconnect();
  },

  template: `
    <div class="tx-dock" ref="surface" :class="{ 'tx-dock--compact': compact }">
      <div v-if="state.maximized" class="tx-dock-group tx-dock-group--max">
        <div class="tx-dock-tabs">
          <div class="tx-dock-tab tx-dock-tab--active">
            <span>{{ api.title(state.maximized) }}</span>
          </div>
          <div class="tx-dock-tabfill"></div>
          <button v-if="!compact" class="tx-dock-btn" v-tip="t('dock.restore.tip')"
                  @click="state.maximized = null">&#9635;</button>
        </div>
        <div class="tx-dock-body" :data-dock-slot="state.maximized"></div>
      </div>

      <template v-else>
        <div v-if="rootEmpty" class="tx-dock-empty">
          {{ t('dock.empty') }}
        </div>
        <dock-node v-else :node="state.root" />

        <div v-for="win in state.floating" :key="win.id" class="tx-dock-float" :style="floatStyle(win)">
          <div class="tx-dock-tabs tx-dock-tabs--float" @pointerdown="startFloatMove(win, $event)">
            <div v-for="panelId in win.panels" :key="panelId"
                 class="tx-dock-tab"
                 :class="{
                   'tx-dock-tab--active': panelId === win.active,
                   'tx-dock-tab--live': api.live(panelId),
                 }"
                 :data-dock-tab="panelId" v-tip="api.hint(panelId)"
                 @pointerdown.stop="api.startTabDrag(panelId, $event)"
                 @click.stop="win.active = panelId">
              <span>{{ api.title(panelId) }}</span>
              <span v-if="api.live(panelId)" class="tx-dock-tab-live" aria-hidden="true"></span>
            </div>
            <div class="tx-dock-tabfill" v-tip="t('dock.float.move.tip')"></div>
            <button class="tx-dock-btn" v-tip="t('dock.float.redock.tip')"
                    @pointerdown.stop @click.stop="redock(win, win.active)">&#8690;</button>
            <button class="tx-dock-btn"
                    v-tip="win.maximized ? t('dock.float.shrink.tip') : t('dock.float.maximize.tip')"
                    @pointerdown.stop
                    @click.stop="win.maximized = !win.maximized">&#9744;</button>
            <button class="tx-dock-btn" v-tip="t('dock.float.close.tip')" @pointerdown.stop
                    @click.stop="closePanel(win.active)">&times;</button>
          </div>
          <div class="tx-dock-body" :data-dock-slot="win.active"></div>
          <template v-if="!win.maximized">
            <div class="tx-dock-edge tx-dock-edge--e" @pointerdown="startFloatResize(win, 1, 0, $event)"></div>
            <div class="tx-dock-edge tx-dock-edge--w" @pointerdown="startFloatResize(win, -1, 0, $event)"></div>
            <div class="tx-dock-edge tx-dock-edge--s" @pointerdown="startFloatResize(win, 0, 1, $event)"></div>
            <div class="tx-dock-edge tx-dock-edge--n" @pointerdown="startFloatResize(win, 0, -1, $event)"></div>
            <div class="tx-dock-corner tx-dock-corner--se" @pointerdown="startFloatResize(win, 1, 1, $event)"></div>
            <div class="tx-dock-corner tx-dock-corner--sw" @pointerdown="startFloatResize(win, -1, 1, $event)"></div>
            <div class="tx-dock-corner tx-dock-corner--ne" @pointerdown="startFloatResize(win, 1, -1, $event)"></div>
            <div class="tx-dock-corner tx-dock-corner--nw" @pointerdown="startFloatResize(win, -1, -1, $event)"></div>
          </template>
        </div>
      </template>

      <div v-if="state.drop && state.drop.rect" class="tx-dock-indicator"
           :class="'tx-dock-indicator--' + state.drop.kind" :style="indicatorStyle"></div>
      <div v-if="state.drag" class="tx-dock-ghost" :style="ghostStyle">
        {{ api.title(state.drag.panelId) }}
        <em v-if="state.drop && state.drop.kind === 'float'">{{ t('dock.ghost.float') }}</em>
      </div>
    </div>
  `,
};
