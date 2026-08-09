import { TX } from "../tx.js";

TX.components = TX.components || {};

const clampCount = value => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(16, n)) : 1;
};

TX.components.TilingBar = {
  props: {
    preview: { type: Object, default: null },
  },
  setup() {
    return { state: TX.store.state, icons: TX.icons.app, i18n: TX.i18n.status };
  },
  computed: {
    settings() {
      return this.state.settings.preview;
    },
    single() {
      const ids = TX.store.selectedIds("texture");
      return ids.length === 1 ? TX.store.findTexture(ids[0]) : null;
    },
    summary() {
      void this.i18n.locale;
      const node = this.single;
      if (!node) return "";
      const canvas = TX.store.textureCanvas(node.id);
      const tiling = node.tiling || TX.tiling.defaults();
      const axis = TX.tiling.axisOf(tiling);
      const seam = tiling.mode === "none" ? this.t("tiling_bar.summary.not_welded")
        : (axis === "xy"
          ? this.t("tiling_bar.summary.welded_both")
          : this.t("tiling_bar.summary.welded_axis", { axis: axis.toUpperCase() }));
      return canvas
        ? this.t("tiling_bar.summary.size", {
          width: canvas.width, height: canvas.height, seam,
        })
        : seam;
    },
  },
  methods: {
    setCount(key, value) {
      this.settings[key] = clampCount(value);
    },
    setWrap(wrap) {
      this.settings.wrap = wrap;
    },
    toggleSeams() {
      this.settings.showSeams = !this.settings.showSeams;
    },
    fit() {
      if (this.preview) this.preview.fit();
    },
  },
  template: `
    <div class="tx-panel-bar tx-tiling-bar">
      <label class="tx-bar-count" v-tip="t('tiling_bar.cols.tip')">
        <v-icon :icon="icons.columns" size="14" />
        <input type="number" min="1" max="16" step="1" :value="settings.cols"
               @change="setCount('cols', $event.target.value)" />
      </label>
      <label class="tx-bar-count" v-tip="t('tiling_bar.rows.tip')">
        <v-icon :icon="icons.rows" size="14" />
        <input type="number" min="1" max="16" step="1" :value="settings.rows"
               @change="setCount('rows', $event.target.value)" />
      </label>

      <span class="tx-bar-sep"></span>

      <v-btn :icon="icons.repeat" size="x-small" variant="text"
             :class="{ 'tx-bar-on': settings.wrap === 'repeat' }"
             v-tip="t('tiling_bar.wrap_repeat.tip')"
             @click="setWrap('repeat')" />
      <v-btn :icon="icons.mirror" size="x-small" variant="text"
             :class="{ 'tx-bar-on': settings.wrap === 'mirror' }"
             v-tip="t('tiling_bar.wrap_mirror.tip')"
             @click="setWrap('mirror')" />

      <span class="tx-bar-sep"></span>

      <v-btn :icon="icons.seams" size="x-small" variant="text"
             :class="{ 'tx-bar-on': settings.showSeams }"
             v-tip="t('tiling_bar.seams.tip')"
             @click="toggleSeams" />
      <v-btn :icon="icons.fit" size="x-small" variant="text"
             v-tip="t('tiling_bar.fit.tip')"
             @click="fit" />

      <span class="tx-bar-summary" v-tip="t('tiling_bar.summary.tip')">{{ summary }}</span>
    </div>
  `,
};
