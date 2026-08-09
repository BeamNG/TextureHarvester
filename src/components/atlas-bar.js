import { TX } from "../tx.js";

TX.components = TX.components || {};

TX.components.AtlasBar = {
  setup() {
    return { state: TX.store.state, icons: TX.icons.app, i18n: TX.i18n.status };
  },
  computed: {
    settings() {
      return this.state.settings;
    },
    gridHint() {
      void this.i18n.locale;
      return this.t("atlas_bar.snap_grid.tip", { size: this.settings.gridSize });
    },
  },
  methods: {
    toggle(key) {
      this.settings[key] = !this.settings[key];
    },
    fit() {
      const atlas = TX.app && TX.app.atlas;
      if (atlas) atlas.fitAll();
    },
  },
  template: `
    <div class="tx-viewport-tools tx-atlas-tools">
      <v-btn :icon="icons.snapEdges" size="x-small" variant="text" density="comfortable"
             :class="{ 'tx-viewport-tool--on': settings.snapToEdges }"
             v-tip="t('atlas_bar.snap_edges.tip')"
             @click="toggle('snapToEdges')" />
      <v-btn :icon="icons.magnet" size="x-small" variant="text" density="comfortable"
             :class="{ 'tx-viewport-tool--on': settings.snapToGrid }"
             v-tip="gridHint"
             @click="toggle('snapToGrid')" />

      <span class="tx-viewport-tools-gap"></span>

      <v-btn :icon="icons.grid" size="x-small" variant="text" density="comfortable"
             :class="{ 'tx-viewport-tool--on': settings.showGrid }"
             v-tip="t('atlas_bar.show_grid.tip')"
             @click="toggle('showGrid')" />
      <v-btn :icon="icons.fit" size="x-small" variant="text" density="comfortable"
             v-tip="t('atlas_bar.fit.tip')"
             @click="fit" />
    </div>
  `,
};
