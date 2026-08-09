import { markRaw, watch } from "vue";
import { TX } from "../tx.js";

TX.components = TX.components || {};

const tree = TX.dockTree;

const isTypingTarget = target =>
  !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);

const PANEL_META = {
  mark: { closable: true },
  atlas: { closable: true },
  tiling: { closable: true },
  preview3d: { closable: true },
  properties: { closable: true },
};

function panelDefs() {
  const out = {};
  for (const id of Object.keys(PANEL_META)) {
    out[id] = {
      ...PANEL_META[id],
      title: TX.t(`panels.${id}.title`),
      hint: TX.t(`panels.${id}.hint`),
    };
  }
  return out;
}

const PANEL_IDS = Object.keys(PANEL_META);

const defaultLayout = () => tree.split("row", [
  tree.split("col", [
    tree.split("row", [tree.tabs(["atlas"]), tree.tabs(["preview3d"])], [0.5, 0.5]),
    tree.split("row", [tree.tabs(["mark"]), tree.tabs(["tiling"])], [0.5, 0.5]),
  ], [0.5, 0.5]),
  tree.tabs(["properties"]),
], [0.78, 0.22]);

function canvasHost() {
  const el = document.createElement("div");
  el.className = "tx-canvas";
  el.tabIndex = 0;
  return el;
}

TX.components.App = {
  components: {
    Toolbar: TX.components.Toolbar,
    StatusBar: TX.components.StatusBar,
    SettingsMenu: TX.components.SettingsMenu,
    Measure: TX.components.Measure,
    ContextMenu: TX.components.ContextMenu,
    ShortcutsDialog: TX.components.ShortcutsDialog,
    Dock: TX.components.Dock,
    Properties: TX.components.Properties,
    Preview3d: TX.components.Preview3d,
    AtlasBar: TX.components.AtlasBar,
    TilingBar: TX.components.TilingBar,
    Progress: TX.components.Progress,
  },
  setup() {
    return {
      state: TX.store.state,
      icons: TX.icons.app,
      history: TX.history.status,
      i18n: TX.i18n.status,
    };
  },
  data() {
    return {
      dockState: null,
      propertiesHost: null,
      preview3dHost: null,
      tilingBarHost: null,
      atlasBarHost: null,
      markEmptyHost: null,
      atlasEmptyHost: null,
      mark: null,
      atlas: null,
      tilingPanel: null,
      actions: null,
      dropDepth: 0,
      storedHistory: null,
      menu: { open: false, position: [0, 0], items: [] },
      helpOpen: false,
      notice: { open: false, text: "", color: "info" },
      unsupported: false,
    };
  },
  computed: {
    dirtyCount() {
      return this.state.marks.filter(m => m.dirty).length;
    },
    selectedLocalSpaceMark() {
      const node = TX.store.soleSelected("texture");
      return (node && node.markId && TX.store.findMark(node.markId)) || null;
    },
    stats() {
      return {
        images: this.state.images.length,
        marks: this.state.marks.length,
        textures: this.state.textures.length,
        kind: this.state.selection.kind,
        selected: this.state.selection.ids.length,
        selectedTextures: TX.store.selectionCount("texture"),
        dirty: this.dirtyCount,
        pending: this.state.pending.points.length,
      };
    },
    sourceEmpty() {
      return !this.state.images.length;
    },
    sourceTutorial() {
      return this.state.images.length > 0 && !this.state.marks.length;
    },
    atlasEmpty() {
      return !this.state.textures.length;
    },
    panelDefs() {
      void this.i18n.locale;
      return panelDefs();
    },
    activePanelTitle() {
      const panel = this.panelDefs[this.state.activePanel];
      return panel ? panel.title : "";
    },
    visiblePanels() {
      if (!this.dockState) return [];
      const ids = tree.collectPanels(this.dockState.root);
      for (const win of this.dockState.floating) ids.push(...win.panels);
      return ids;
    },
    panelList() {
      const panels = this.panelDefs;
      return PANEL_IDS.map(id => ({
        id,
        title: panels[id].title,
        hint: panels[id].hint,
        visible: this.isPanelVisible(id),
      }));
    },
  },
  methods: {
    notify(text, color) {
      this.notice = { open: true, text, color: color || "info" };
    },

    afterHistory() {
      if (this.mark) this.mark.syncMeshes();
      if (this.atlas) this.atlas.syncMeshes();
    },
    undo() {
      const label = TX.history.undo();
      if (!label && label !== "") {
        this.notify(this.t("app.notify.nothing_to_undo"), "info");
        return;
      }
      this.afterHistory();
      this.notify(label ? this.t("app.notify.undid", { label: label.toLowerCase() }) : this.t("app.notify.undone"), "info");
    },
    redo() {
      const label = TX.history.redo();
      if (!label && label !== "") {
        this.notify(this.t("app.notify.nothing_to_redo"), "info");
        return;
      }
      this.afterHistory();
      this.notify(label ? this.t("app.notify.redid", { label: label.toLowerCase() }) : this.t("app.notify.redone"), "info");
    },

    isPanelVisible(id) {
      return this.visiblePanels.includes(id);
    },
    togglePanel(id) {
      const dock = this.$refs.dock;
      if (!dock) return;
      if (this.isPanelVisible(id)) dock.closePanel(id);
      else dock.openPanel(id);
    },
    resetLayout() {
      this.dockState.reset();
      TX.dock.save(this.dockState);
      this.notify(this.t("app.notify.layout_reset"), "info");
    },

    pickFiles() {
      this.$refs.fileInput.click();
    },
    async onFiles(event) {
      const files = event.target.files;
      if (files && files.length) await this.loadFiles(files);
      event.target.value = "";
    },
    async loadFiles(files) {
      const added = await this.mark.loadFiles(files);
      if (added) this.notify(this.t(added === 1 ? "app.notify.imported_one" : "app.notify.imported_other", { count: added }), "success");
    },
    onDragEnter(event) {
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes("Files")) return;
      this.dropDepth++;
    },
    onDragLeave() {
      if (this.dropDepth > 0) this.dropDepth--;
    },
    async onDrop(event) {
      this.dropDepth = 0;
      const files = event.dataTransfer && event.dataTransfer.files;
      if (files && files.length) await this.loadFiles(files);
    },

    openMenu(event, context) {
      const items = context.pane === "mark"
        ? this.markMenuItems(context) : this.atlasMenuItems(context);
      this.menu = { open: false, position: [event.clientX, event.clientY], items };
      this.$nextTick(() => { this.menu.open = true; });
    },
    historyItems() {
      return [
        {
          title: this.history.canUndo
            ? this.t("context.undo_named", { label: this.history.undoLabel.toLowerCase() })
            : this.t("context.undo"),
          icon: this.icons.undo,
          hint: this.t("context.hint.undo"),
          disabled: !this.history.canUndo,
          action: () => this.undo(),
        },
        {
          title: this.history.canRedo
            ? this.t("context.redo_named", { label: this.history.redoLabel.toLowerCase() })
            : this.t("context.redo"),
          icon: this.icons.redo,
          hint: this.t("context.hint.redo"),
          disabled: !this.history.canRedo,
          action: () => this.redo(),
        },
        { divider: true },
      ];
    },
    markMenuItems(context) {
      const marks = TX.store.selectionCount("mark");
      const images = TX.store.selectionCount("image");
      const noun = marks ? "mark" : "image";
      const selected = marks || images;
      const under = context && context.imageId ? TX.store.findImage(context.imageId) : null;
      const target = under || TX.store.soleSelected("image");
      const deleteSelected = noun === "mark"
        ? (selected === 1 ? "context.delete_n_mark_one" : "context.delete_n_mark_other")
        : (selected === 1 ? "context.delete_n_image_one" : "context.delete_n_image_other");
      return [
        ...this.historyItems(),
        { title: this.t("context.import_images"), icon: this.icons.load, hint: this.t("context.hint.import"),
          action: () => this.pickFiles() },
        {
          title: this.t("context.extract_modified"),
          icon: this.icons.extract,
          hint: this.t("context.hint.extract"),
          disabled: !this.dirtyCount,
          action: () => this.actions.convert("all"),
        },
        { divider: true },
        {
          title: target
            ? this.t("context.save_photo_named", { name: target.name })
            : this.t("context.save_photo"),
          icon: this.icons.download,
          disabled: !target,
          action: () => this.actions.exportImage(target ? target.id : null),
        },
        {
          title: this.t("context.rectify_photo"),
          icon: this.icons.grid,
          disabled: marks !== 1,
          action: () => this.actions.reprojectImage(),
        },
        { divider: true },
        {
          title: marks ? this.t("context.select_all_marks") : this.t("context.select_all_images"),
          hint: this.t("context.hint.select_all"),
          action: () => this.mark.selectAll(),
        },
        {
          title: selected
            ? this.t(deleteSelected, { count: selected })
            : this.t(noun === "mark" ? "context.delete_selected_marks" : "context.delete_selected_images"),
          icon: this.icons.trash,
          hint: this.t("context.hint.delete"),
          disabled: !selected,
          action: () => this.deleteInPane("mark"),
        },
        { divider: true },
        { title: this.t("context.fit_view"), icon: this.icons.fit, action: () => this.mark.fitAll() },
      ];
    },
    atlasMenuItems() {
      const selected = TX.store.selectionCount("texture");
      const total = this.state.textures.length;
      const sole = TX.store.soleSelected("texture");
      const single = sole ? sole.id : null;
      return [
        ...this.historyItems(),
        { title: this.t("context.pack_atlas"), icon: this.icons.pack, disabled: !total,
          action: () => this.actions.packAtlas() },
        { title: this.t("context.export_atlas_png"), icon: this.icons.download,
          hint: this.t("context.hint.export_atlas"), disabled: !total,
          action: () => this.actions.exportAtlas() },
        {
          title: selected
            ? this.t("context.export_n_textures", { count: selected })
            : this.t("context.export_all_individually"),
          icon: this.icons.download,
          hint: this.t("context.hint.export_individually"),
          disabled: !total,
          action: () => this.actions.exportIndividually(),
        },
        {
          title: this.t("context.export_glb"),
          icon: this.icons.download,
          hint: this.t("context.hint.export_glb"),
          disabled: !single,
          action: () => single && this.actions.exportGlb(single),
        },
        { divider: true },
        {
          title: this.t("context.make_seamless"),
          disabled: !single,
          action: () => single && TX.store.setTiling(single, { mode: "feather" }),
        },
        {
          title: this.t("context.tiling_off"),
          disabled: !single,
          action: () => single && TX.store.setTiling(single, { mode: "none" }),
        },
        {
          title: this.t("context.mirror_2x2"),
          disabled: !single,
          action: () => single && this.atlas.duplicateMirrored(single),
        },
        { divider: true },
        {
          title: this.t("context.flatten_lighting"),
          hint: this.t("context.hint.flatten"),
          disabled: !selected,
          action: () => this.flattenSelectedLighting(),
        },
        {
          title: this.t("context.extract_shading"),
          disabled: !single,
          action: () => single && this.atlas.addShadingTexture(single),
        },
        { divider: true },
        {
          title: this.t("context.copy_clipboard"),
          hint: this.t("context.hint.copy"),
          disabled: !single,
          action: () => this.copySelectedTexture(),
        },
        {
          title: selected
            ? this.t("context.duplicate_n", { count: selected })
            : this.t("context.duplicate"),
          hint: this.t("context.hint.duplicate"),
          disabled: !selected,
          action: () => this.duplicateSelectedTextures(),
        },
        {
          title: this.t("context.reset_local_space"),
          hint: this.t("context.hint.reset_local"),
          disabled: !this.selectedLocalSpaceMark,
          action: () => {
            const m = this.selectedLocalSpaceMark;
            if (!m) return;
            TX.store.resetMarkLocalSpace(m.id);
            this.actions.reextract(m.id);
          },
        },
        { divider: true },
        {
          title: selected
            ? this.t("context.reset_transform_selection")
            : this.t("context.reset_all_transforms"),
          icon: this.icons.reset,
          disabled: !total,
          action: () => this.atlas.resetTransforms(),
        },
        { title: this.t("context.select_all_textures"), hint: this.t("context.hint.select_all"),
          disabled: !total, action: () => this.atlas.selectAll() },
        {
          title: selected
            ? this.t("context.delete_n_textures", { count: selected })
            : this.t("context.delete_selected_textures"),
          icon: this.icons.trash,
          hint: this.t("context.hint.delete"),
          disabled: !selected,
          action: () => this.deleteInPane("atlas"),
        },
        { divider: true },
        { title: this.t("context.fit_view"), icon: this.icons.fit, action: () => this.atlas.fitAll() },
      ];
    },

    async restoreSession() {
      let stored = null;
      try {
        stored = await TX.persist.load();
        if (stored) await TX.store.restore(stored);
      } catch (err) {
        this.notify(this.t("app.notify.restore_failed"), "warning");
      }
      this.storedHistory = (stored && stored.history) || null;

      try {
        const record = TX.store.loadViewRecord();
        if (record) TX.store.applyViewRecord(record, stored && stored.savedAt);
      } catch (err) {
      }

      this.mark.syncMeshes();
      this.atlas.syncMeshes();

      const viewports = this.state.viewports;
      if (!this.mark.stage.setViewport(viewports.mark)) this.mark.fitAll();
      if (!this.atlas.stage.setViewport(viewports.atlas)) this.atlas.fitAll();
      if (this.tilingPanel.stage.setViewport(viewports.tiling)) this.tilingPanel.skipAutoFitOnce();

      if (this.state.images.length || this.state.textures.length) {
        this.notify(this.t("app.notify.restored"), "info");
      }
    },

    async copySelectedTexture() {
      const id = TX.store.selectedIds("texture")[0];
      const canvas = id && TX.store.textureCanvas(id);
      if (!canvas) {
        this.notify(this.t("app.notify.select_to_copy"), "warning");
        return;
      }
      try {
        const blob = await TX.io.canvasToBlob(canvas);
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        this.notify(this.t("app.notify.copied"), "success");
      } catch (err) {
        this.notify(this.t("app.notify.clipboard_denied"), "warning");
      }
    },

    flattenSelectedLighting() {
      const ids = TX.store.selectedIds("texture").slice();
      if (!ids.length) {
        this.notify(this.t("app.notify.select_to_flatten"), "warning");
        return;
      }
      const on = ids.some(id => {
        const texture = TX.store.findTexture(id);
        return texture && texture.delight.mode === "none";
      });
      TX.history.name(on ? "history.flatten_lighting" : "history.restore_lighting");
      for (const id of ids) TX.store.setDelight(id, { mode: on ? "gradient" : "none" });
      this.notify(on
        ? this.t(ids.length === 1 ? "app.notify.flattened_one" : "app.notify.flattened_other", { count: ids.length })
        : this.t("app.notify.lighting_restored"), "success");
    },

    duplicateSelectedTextures() {
      const ids = TX.store.selectedIds("texture").slice();
      if (!ids.length) {
        this.notify(this.t("app.notify.select_to_duplicate"), "warning");
        return;
      }
      TX.history.name(ids.length === 1 ? { id: "history.duplicate_one", vars: { count: ids.length } } : { id: "history.duplicate_other", vars: { count: ids.length } });
      const copies = ids.map(id => this.atlas.duplicateTexture(id)).filter(Boolean);
      if (copies.length) {
        TX.store.select("texture", copies);
        this.notify(this.t(copies.length === 1 ? "app.notify.duplicated_one" : "app.notify.duplicated_other", { count: copies.length }), "success");
      }
    },

    rotateSelectedTextures(direction, fine) {
      const step = fine ? Math.PI / 36 : Math.PI / 2;
      for (const node of TX.store.selectedItems("texture")) {
        const next = node.rotation + direction * step;
        node.rotation = fine ? next : Math.round(next / step) * step;
      }
      this.atlas.syncMeshes();
    },

    flipSelectedTextures(axis) {
      TX.history.name(axis === "x" ? "history.flip_horizontally" : "history.flip_vertically");
      for (const node of TX.store.selectedItems("texture")) {
        TX.store.setFlip(node.id, { [axis]: !(node.flip && node.flip[axis]) });
      }
    },

    revealProblem(entry) {
      if (!entry || !entry.textureIds.length) return;
      TX.store.select("texture", entry.textureIds.slice());
      if (this.dockState) {
        this.dockState.root = tree.setActive(this.dockState.root, "atlas");
        this.state.activePanel = "atlas";
      }
      this.$nextTick(() => {
        if (this.atlas) this.atlas.fitSelection();
      });
    },

    deleteInPane(pane) {
      const removed = pane === "mark" ? this.mark.deleteSelected() : this.atlas.deleteSelected();
      if (removed) this.notify(this.t(removed === 1 ? "app.notify.deleted_one" : "app.notify.deleted_other", { count: removed }), "info");
    },

    confirmClear() {
      if (!this.state.images.length && !this.state.textures.length) return;
      this.actions.clearSession();
    },

    onKeyDown(event) {
      if (isTypingTarget(event.target)) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (key === "f1") {
        event.preventDefault();
        this.helpOpen = !this.helpOpen;
        return;
      }

      if (ctrl && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        this.redo();
        return;
      }
      if (ctrl && key === "z") {
        event.preventDefault();
        this.undo();
        return;
      }
      if (event.shiftKey && !ctrl && key === "a") {
        event.preventDefault();
        this.pickFiles();
        return;
      }
      if (event.shiftKey && !ctrl && key === "r") {
        event.preventDefault();
        this.actions.convert("all");
        return;
      }
      if (ctrl && key === "e") {
        event.preventDefault();
        this.actions.exportAtlas();
        return;
      }
      if (ctrl && key === "s") {
        event.preventDefault();
        this.actions.exportIndividually();
        return;
      }
      if (ctrl && key === "g") {
        event.preventDefault();
        this.actions.exportGlb();
        return;
      }
      if (ctrl && key === "a") {
        event.preventDefault();
        if (this.state.activePanel === "mark") this.mark.selectAll();
        else this.atlas.selectAll();
        return;
      }
      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        this.deleteInPane(this.state.activePanel === "mark" ? "mark" : "atlas");
        return;
      }
      if (!ctrl && key === "c") {
        event.preventDefault();
        this.copySelectedTexture();
        return;
      }
      if (!ctrl && key === "d") {
        event.preventDefault();
        this.duplicateSelectedTextures();
        return;
      }
      if (!ctrl && key === "l") {
        event.preventDefault();
        this.flattenSelectedLighting();
        return;
      }
      if (key === "arrowleft" || key === "arrowright") {
        if (!TX.store.selectionCount("texture")) return;
        event.preventDefault();
        this.rotateSelectedTextures(key === "arrowleft" ? -1 : 1, event.shiftKey);
        return;
      }
      if (event.shiftKey && !ctrl && (key === "x" || key === "y")) {
        if (!TX.store.selectionCount("texture")) return;
        event.preventDefault();
        this.flipSelectedTextures(key);
        return;
      }
      if (key === "escape") {
        if (!this.state.pending.points.length && this.state.selection.kind) {
          TX.store.clearSelection();
        }
        if (this.state.pending.points.length) {
          TX.store.clearPending();
          this.mark.stage.requestRender();
        }
        this.menu.open = false;
        this.helpOpen = false;
        if (this.dockState) this.dockState.maximized = null;
      }
    },
  },

  async mounted() {
    if (!TX.warp.isSupported()) {
      this.unsupported = true;
      return;
    }

    this.dockState = TX.dock.createState(defaultLayout, PANEL_IDS);

    const hooks = {
      onContextMenu: (event, context) => this.openMenu(event, context),
      onNotice: (text, color) => this.notify(text, color),
      onMarkCreated: () => {
        if (this.actions) this.actions.convert("all");
      },
      onLocalSpaceChange: (markId, options) => {
        if (this.actions) this.actions.reextract(markId, options);
      },
      onMarkGeometryChange: (markId, options) => {
        if (this.actions) this.actions.reextract(markId, options);
      },
    };

    const viewportHook = key => ({ onViewChange: v => TX.store.setViewport(key, v) });

    const markHost = canvasHost();
    const markEmptyHost = document.createElement("div");
    markEmptyHost.className = "tx-source-empty-host";
    const atlasHost = canvasHost();
    const atlasBarHost = document.createElement("div");
    atlasHost.append(atlasBarHost);
    const atlasEmptyHost = document.createElement("div");
    atlasEmptyHost.className = "tx-source-empty-host";
    const atlasStage = atlasHost;
    const tilingHost = document.createElement("div");
    tilingHost.className = "tx-panel-stack";
    const tilingBarHost = document.createElement("div");
    const tilingStage = canvasHost();
    tilingHost.append(tilingBarHost, tilingStage);
    const propertiesHost = document.createElement("div");
    propertiesHost.className = "tx-props-root";
    const preview3dHost = document.createElement("div");
    preview3dHost.className = "tx-3d-root";

    TX.dock.register("mark", markHost);
    TX.dock.register("atlas", atlasHost);
    TX.dock.register("tiling", tilingHost);
    TX.dock.register("properties", propertiesHost);
    TX.dock.register("preview3d", preview3dHost);

    await this.$nextTick();

    this.mark = markRaw(TX.markCanvas.createMarkCanvas(
      markHost, { ...hooks, ...viewportHook("mark") }));
    markHost.append(markEmptyHost);
    this.atlas = markRaw(TX.atlasCanvas.createAtlasCanvas(
      atlasStage, { ...hooks, ...viewportHook("atlas") }));
    atlasHost.append(atlasEmptyHost);
    this.tilingPanel = markRaw(TX.tilingPanel.createTilingPanel(
      tilingStage, viewportHook("tiling")));
    this.actions = markRaw(TX.actions.create({
      mark: this.mark,
      atlas: this.atlas,
      notify: (text, color) => this.notify(text, color),
    }));

    this.propertiesHost = propertiesHost;
    this.preview3dHost = preview3dHost;
    this.tilingBarHost = tilingBarHost;
    this.atlasBarHost = atlasBarHost;
    this.markEmptyHost = markEmptyHost;
    this.atlasEmptyHost = atlasEmptyHost;

    for (const [id, host] of Object.entries({
      mark: markHost,
      atlas: atlasHost,
      tiling: tilingHost,
      properties: propertiesHost,
      preview3d: preview3dHost,
    })) {
      host.addEventListener("pointerdown", () => { this.state.activePanel = id; }, true);
    }
    markHost.addEventListener("dblclick", () => this.mark.fitAll());
    atlasHost.addEventListener("dblclick", () => this.atlas.fitAll());
    window.addEventListener("keydown", this.onKeyDown);

    this.stopFollow = watch(
      () => (this.state.selection.kind === "texture" ? this.state.selection.ids[0] : null),
      id => {
        const node = id ? TX.store.findTexture(id) : null;
        const mark = node && node.markId ? TX.store.findMark(node.markId) : null;
        if (mark && this.mark) this.mark.revealMark(mark.id);
      },
    );

    TX.persist.kind().then(kind => { this.state.storageKind = kind; })
      .catch(() => { this.state.storageKind = "memory"; });

    await this.restoreSession();
    TX.i18n.setLocale(this.state.settings.locale);

    TX.store.watchForSave();
    TX.history.start();
    if (this.storedHistory) {
      try {
        await TX.history.adopt(this.storedHistory);
      } catch (err) {
      }
      this.storedHistory = null;
    }
  },

  beforeUnmount() {
    window.removeEventListener("keydown", this.onKeyDown);
    if (this.mark) this.mark.dispose();
    if (this.atlas) this.atlas.dispose();
    if (this.tilingPanel) this.tilingPanel.dispose();
  },

  template: `
    <v-app theme="txDark">
      <div v-if="unsupported" class="tx-unsupported">
        <div>
          <h2>{{ t('app.unsupported.title') }}</h2>
          <p>{{ t('app.unsupported.body') }}</p>
        </div>
      </div>

      <div v-else class="tx-shell"
           @dragenter.prevent="onDragEnter" @dragover.prevent
           @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
        <Toolbar :busy="state.busy"
                 :texture-count="state.textures.length"
                 :selected-textures="stats.selectedTextures"
                 :export-maps="state.settings.exportMaps"
                 :history="history"
                 @import="pickFiles"
                 @pack="actions.packAtlas()" @export-atlas="actions.exportAtlas()"
                 @export-selected="actions.exportIndividually()"
                 @export-model="actions.exportGlb()"
                 @undo="undo" @redo="redo"
                 @clear="confirmClear">
          <template #view>
            <Measure />

            <SettingsMenu :settings="state.settings" :panels="panelList"
                          @toggle-panel="togglePanel" @reset-layout="resetLayout"
                          @show-shortcuts="helpOpen = true" />
          </template>
        </Toolbar>

        <div class="tx-dock-area">
          <Dock v-if="dockState" ref="dock" :state="dockState" :panels="panelDefs" />
        </div>

        <StatusBar :storage-kind="state.storageKind" :stats="stats"
                   :active-panel="state.activePanel" :panel-title="activePanelTitle"
                   @reveal="revealProblem" />

        <div v-if="dropDepth > 0" class="tx-drop">{{ t('app.drop') }}</div>
      </div>

      <Teleport v-if="markEmptyHost" :to="markEmptyHost">
        <div v-if="sourceEmpty" class="tx-source-empty">
          <p class="tx-source-empty-lead">{{ t('source.empty.drop') }}</p>
          <v-btn variant="tonal" size="small" class="tx-action" :prepend-icon="icons.load"
                 @click="pickFiles">{{ t('toolbar.import') }}</v-btn>
          <p>{{ t('source.empty.or_import') }}</p>
        </div>
        <div v-else-if="sourceTutorial" class="tx-source-tip" role="status">
          <span class="tx-source-tip-emoji" aria-hidden="true">💡</span>
          <div class="tx-source-tip-body">
            <p class="tx-source-tip-lead">{{ t('source.empty.tutorial') }}</p>
            <p>{{ t('source.empty.tutorial_edge') }}</p>
          </div>
        </div>
      </Teleport>

      <Teleport v-if="atlasEmptyHost" :to="atlasEmptyHost">
        <div v-if="atlasEmpty" class="tx-source-tip" role="status">
          <span class="tx-source-tip-emoji" aria-hidden="true">✂️</span>
          <div class="tx-source-tip-body">
            <p class="tx-source-tip-lead">{{ t('atlas.empty.tutorial') }}</p>
            <p>{{ t('atlas.empty.tutorial_detail') }}</p>
          </div>
        </div>
      </Teleport>

      <Teleport v-if="propertiesHost" :to="propertiesHost">
        <Properties :atlas="atlas" :actions="actions" />
      </Teleport>

      <Teleport v-if="atlasBarHost" :to="atlasBarHost">
        <AtlasBar />
      </Teleport>

      <Teleport v-if="tilingBarHost" :to="tilingBarHost">
        <TilingBar :preview="tilingPanel" />
      </Teleport>

      <Teleport v-if="preview3dHost" :to="preview3dHost">
        <Preview3d ref="preview3d" :actions="actions" />
      </Teleport>

      <ContextMenu v-model="menu.open" :position="menu.position" :items="menu.items" />
      <ShortcutsDialog v-model="helpOpen" />

      <v-snackbar v-model="notice.open" :color="notice.color" timeout="2600" location="bottom right">
        {{ notice.text }}
      </v-snackbar>

      <Progress />

      <input ref="fileInput" type="file" multiple accept="image/png,image/jpeg,image/bmp,image/webp"
             class="tx-file-input" @change="onFiles" />
    </v-app>
  `,
};
