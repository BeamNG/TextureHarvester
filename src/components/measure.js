import { TX } from "../tx.js";

TX.components = TX.components || {};

TX.components.Measure = {
  setup() {
    return { state: TX.store.state, icons: TX.icons.app, i18n: TX.i18n.status };
  },
  computed: {
    modes() {
      void this.i18n.locale;
      return TX.viewOverlay.modes();
    },
    settings() {
      return this.state.settings.views;
    },
    active() {
      return this.settings.mode !== "off";
    },
    modeHint() {
      void this.i18n.locale;
      const current = this.modes.find(m => m.value === this.settings.mode);
      if (!current || !this.active) return this.t("measure.mode.hint_off");
      return this.t("measure.mode.hint", { title: current.title, subtitle: current.subtitle });
    },
    numbersHint() {
      void this.i18n.locale;
      if (this.settings.mode === "correspond") {
        return this.settings.numbers
          ? this.t("measure.numbers.correspond_on") : this.t("measure.numbers.correspond_off");
      }
      return this.settings.numbers
        ? this.t("measure.numbers.on") : this.t("measure.numbers.off");
    },
  },
  methods: {
    itemProps: item => ({ title: item.title, subtitle: item.subtitle }),

    redraw() {
      const app = TX.app;
      if (!app) return;
      for (const panel of [app.mark, app.atlas, app.tilingPanel]) {
        if (panel && panel.stage) panel.stage.requestRender();
      }
    },
    setMode(mode) {
      return TX.viewOverlay.choose(mode);
    },
    setOverlay(value) {
      this.settings.overlay = Math.max(0, Math.min(1, Number(value) / 100));
      this.redraw();
    },
    toggleNumbers() {
      this.settings.numbers = !this.settings.numbers;
      this.redraw();
    },
  },
  template: `
    <div class="tx-measure">
      <v-select :model-value="settings.mode" @update:model-value="setMode($event)"
                :items="modes" item-title="title" item-value="value"
                :item-props="itemProps"
                density="compact" variant="outlined" hide-details
                class="tx-measure-mode" v-tip="modeHint" />

      <template v-if="active">
        <input type="range" min="10" max="100" class="tx-measure-strength"
               :value="Math.round(settings.overlay * 100)"
               v-tip="t('measure.overlay.tip')"
               @input="setOverlay($event.target.value)" />
        <v-btn :icon="icons.measure" size="x-small" variant="text"
               :class="{ 'tx-measure-on': settings.numbers }"
               v-tip="numbersHint"
               @click="toggleNumbers" />
      </template>
    </div>
  `,
};
