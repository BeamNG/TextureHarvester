import { TX } from "../tx.js";

TX.components = TX.components || {};

TX.components.Toolbar = {
  props: {
    busy: { type: Boolean, default: false },
    textureCount: { type: Number, default: 0 },
    selectedTextures: { type: Number, default: 0 },
    exportMaps: { type: Boolean, default: false },
    history: { type: Object, default: () => ({}) },
  },
  emits: ["import", "pack", "export-atlas", "export-selected", "export-model",
    "clear", "undo", "redo"],
  setup() {
    return { icons: TX.icons.app, version: TX.version, i18n: TX.i18n.status };
  },
  template: `
    <div class="tx-toolbar">
      <div class="tx-brand" v-tip="t('toolbar.brand.tip', { version })">
        Texture&nbsp;Harvester<span class="tx-version">{{ version }}</span>
      </div>

      <v-btn variant="text" size="small" class="tx-github" :prepend-icon="icons.github"
             href="https://github.com/BeamNG/TextureHarvester"
             target="_blank" rel="noopener noreferrer"
             v-tip="t('toolbar.github.tip')">{{ t('toolbar.github') }}</v-btn>

      <v-btn variant="tonal" size="small" class="tx-action" :prepend-icon="icons.load"
             v-tip="t('toolbar.import.tip')"
             @click="$emit('import')">{{ t('toolbar.import') }}</v-btn>

      <v-divider vertical class="tx-sep" />

      <v-btn variant="text" size="small" :icon="icons.undo" density="comfortable"
             class="tx-undo" :disabled="!history.canUndo"
             v-tip="undoHint" @click="$emit('undo')" />
      <v-btn variant="text" size="small" :icon="icons.redo" density="comfortable"
             class="tx-redo" :disabled="!history.canRedo"
             v-tip="redoHint" @click="$emit('redo')" />

      <v-divider vertical class="tx-sep" />

      <v-btn variant="text" size="small" class="tx-action" :prepend-icon="icons.pack"
             :disabled="!textureCount"
             v-tip="t('toolbar.pack.tip')"
             @click="$emit('pack')">{{ t('toolbar.pack') }}</v-btn>

      <v-menu location="bottom start">
        <template #activator="{ props }">
          <v-btn v-bind="props" variant="text" size="small"
                 class="tx-action tx-export-btn" :prepend-icon="icons.download"
                 :disabled="!textureCount" v-tip="exportHint">{{ t('toolbar.export') }}</v-btn>
        </template>
        <v-list density="compact" min-width="240" class="tx-export-menu">
          <v-list-item :disabled="!textureCount" v-tip="exportAtlasHint"
                       @click="$emit('export-atlas')">
            <v-list-item-title>{{ t('toolbar.export.atlas') }}</v-list-item-title>
            <template #append>
              <span class="tx-menu-hint">{{ t('toolbar.export.shortcut.atlas') }}</span>
            </template>
          </v-list-item>
          <v-list-item :disabled="!textureCount" v-tip="exportSelectedHint"
                       @click="$emit('export-selected')">
            <v-list-item-title>{{ t('toolbar.export.individually') }}</v-list-item-title>
            <template #append>
              <span class="tx-menu-hint">{{ t('toolbar.export.shortcut.individually') }}</span>
            </template>
          </v-list-item>
          <v-list-item :disabled="selectedTextures !== 1" v-tip="exportModelHint"
                       @click="$emit('export-model')">
            <v-list-item-title>{{ t('toolbar.export.model') }}</v-list-item-title>
            <template #append>
              <span class="tx-menu-hint">{{ t('toolbar.export.shortcut.model') }}</span>
            </template>
          </v-list-item>
        </v-list>
      </v-menu>

      <v-spacer />

      <slot name="view" />

      <v-btn variant="text" size="small" :icon="icons.trash" density="comfortable"
             v-tip="t('toolbar.clear.tip')"
             @click="$emit('clear')" />
    </div>
  `,
  computed: {
    undoHint() {
      void this.i18n.locale;
      return this.history.canUndo
        ? this.t("toolbar.undo.hint", { label: this.history.undoLabel.toLowerCase() })
        : this.t("toolbar.undo.hint_empty");
    },
    redoHint() {
      void this.i18n.locale;
      return this.history.canRedo
        ? this.t("toolbar.redo.hint", { label: this.history.redoLabel.toLowerCase() })
        : this.t("toolbar.redo.hint_empty");
    },
    exportHint() {
      void this.i18n.locale;
      if (!this.textureCount) return this.t("toolbar.export.hint_empty");
      return this.t("toolbar.export.hint");
    },
    withMaps() {
      return this.t("toolbar.export.with_maps");
    },
    exportAtlasHint() {
      void this.i18n.locale;
      if (!this.textureCount) return this.t("toolbar.export.atlas.hint_empty");
      return this.exportMaps
        ? this.t("toolbar.export.atlas.hint_maps", { with_maps: this.withMaps })
        : this.t("toolbar.export.atlas.hint");
    },
    exportSelectedHint() {
      void this.i18n.locale;
      if (!this.textureCount) return this.t("toolbar.export.individually.hint_empty");
      const withMaps = this.exportMaps
        ? this.t("toolbar.export.with_maps_suffix", { with_maps: this.withMaps }) : "";
      if (!this.selectedTextures) {
        return this.t("toolbar.export.individually.hint_all", { with_maps: withMaps });
      }
      return this.t(this.selectedTextures === 1
        ? "toolbar.export.individually.hint_selected_one"
        : "toolbar.export.individually.hint_selected_other",
        { count: this.selectedTextures, with_maps: withMaps });
    },
    exportModelHint() {
      void this.i18n.locale;
      if (this.selectedTextures === 1) return this.t("toolbar.export.model.hint");
      return this.selectedTextures
        ? this.t("toolbar.export.model.hint_many")
        : this.t("toolbar.export.model.hint_none");
    },
  },
};
