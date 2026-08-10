import { TX } from "../tx.js";

TX.components = TX.components || {};

TX.components.SettingsMenu = {
  props: {
    settings: { type: Object, required: true },
    panels: { type: Array, default: () => [] },
  },
  emits: ["toggle-panel", "reset-layout", "show-shortcuts", "show-intro"],
  setup() {
    return {
      icons: TX.icons.app,
      i18n: TX.i18n.status,
      model: TX.depthModel.MODEL,
      device: TX.device.status,
    };
  },
  data() {
    return { open: false };
  },
  computed: {
    supersample() {
      void this.i18n.locale;
      return [1, 2, 3, 4].map(value => ({
        value,
        title: this.t(`settings.supersample.${value}x`),
      }));
    },
    locales() {
      void this.i18n.locale;
      const auto = TX.i18n.fromBrowser();
      const autoName = (TX.i18n.catalogs()[auto] || {})["meta.language_name"] || auto;
      return [
        { code: "auto", name: this.t("settings.language.auto", { language: autoName }) },
        ...TX.i18n.locales(),
      ];
    },
    modelUrl() {
      return `https://huggingface.co/${this.model}`;
    },
    hint() {
      void this.i18n.locale;
      const s = this.settings;
      const parts = [
        this.t("settings.hint.grid", { size: s.gridSize }),
        this.t("settings.hint.sampling", { n: s.supersample }),
      ];
      if (s.padding) parts.push(this.t("settings.hint.padding", { n: s.padding }));
      if (s.powerOfTwo) parts.push(this.t("settings.hint.power_of_two"));
      return this.t("settings.hint", { parts: parts.join(", ") });
    },
  },
  methods: {
    clamp(field, value, min, max, fallback) {
      const n = Math.round(Number(value));
      this.settings[field] = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    },
    setLocale(code) {
      this.settings.locale = code;
      TX.i18n.setLocale(code);
    },
    setAi(on) {
      this.settings.ai = on;
      if (!on) TX.depthModel.dispose();
    },
    resetLayout() {
      this.$emit("reset-layout");
      this.open = false;
    },
    showShortcuts() {
      this.$emit("show-shortcuts");
      this.open = false;
    },
    showIntro() {
      this.$emit("show-intro");
      this.open = false;
    },
  },
  template: `
    <v-dialog v-model="open" fullscreen :transition="false"
              class="tx-settings-dialog">
      <template #activator="{ props }">
        <v-btn v-bind="props" variant="text" size="small" density="comfortable"
               class="tx-settings-btn" :icon="icons.settings"
               :aria-label="t('settings.aria')" v-tip="hint" />
      </template>

      <div class="tx-settings-page">
        <header class="tx-settings-bar">
          <h2 class="tx-settings-title">{{ t('settings.aria') }}</h2>
          <v-btn variant="tonal" size="small" class="tx-settings-close"
                 :prepend-icon="icons.close"
                 :aria-label="t('settings.close')"
                 @click="open = false">{{ t('settings.done') }}</v-btn>
        </header>

        <div class="tx-settings-menu">
          <div class="tx-settings-section">{{ t('settings.section.panels') }}</div>
          <button v-for="panel in panels" :key="panel.id" type="button"
                  class="tx-settings-item"
                  :class="{ 'tx-settings-item--on': panel.visible }"
                  :aria-pressed="panel.visible ? 'true' : 'false'"
                  v-tip="panel.hint" @click="$emit('toggle-panel', panel.id)">
            <v-icon :icon="panel.visible ? icons.check : ''" size="14" />
            <span>{{ panel.title }}</span>
          </button>
          <button type="button" class="tx-settings-item tx-settings-reset"
                  v-tip="t('settings.reset_layout.tip')"
                  @click="resetLayout">
            <v-icon :icon="icons.reset" size="14" />
            <span>{{ t('settings.reset_layout') }}</span>
          </button>

          <v-divider class="my-2" />

          <div class="tx-settings-section">{{ t('settings.language') }}</div>
          <label class="tx-settings-row tx-settings-row--wide" v-tip="t('settings.language.tip')">
            <span>{{ t('settings.language') }}</span>
            <v-select :model-value="settings.locale"
                      @update:model-value="setLocale($event)"
                      :items="locales" item-title="name" item-value="code"
                      density="compact" variant="outlined" hide-details />
          </label>

          <v-divider class="my-2" />

          <div class="tx-settings-section">{{ t('settings.section.grid') }}</div>
          <label class="tx-settings-row" v-tip="t('settings.grid.cell_size.tip')">
            <span>{{ t('settings.grid.cell_size') }}</span>
            <input type="number" min="1" max="1024" step="1" :value="settings.gridSize"
                   @change="clamp('gridSize', $event.target.value, 1, 1024, 16)" />
            <em>px</em>
          </label>
          <v-switch v-model="settings.snapToGrid" :label="t('settings.grid.snap')"
                    density="compact" hide-details color="primary" class="tx-props-switch"
                    v-tip="t('settings.grid.snap.tip')" />
          <v-switch v-model="settings.showGrid" :label="t('settings.grid.draw')"
                    density="compact" hide-details color="primary" class="tx-props-switch"
                    v-tip="t('settings.grid.draw.tip')" />

          <v-divider class="my-2" />

          <div class="tx-settings-section">{{ t('settings.section.marking') }}</div>
          <label class="tx-settings-row" v-tip="t('settings.weld_radius.tip')">
            <span>{{ t('settings.weld_radius') }}</span>
            <input type="number" min="0" max="64" step="1" :value="settings.weldRadius"
                   @change="clamp('weldRadius', $event.target.value, 0, 64, 8)" />
            <em>px</em>
          </label>

          <v-divider class="my-2" />

          <div class="tx-settings-section">{{ t('settings.section.extraction') }}</div>
          <label class="tx-settings-row tx-settings-row--wide"
                 v-tip="t('settings.supersample.tip')">
            <span>{{ t('settings.supersample') }}</span>
            <v-select :model-value="settings.supersample"
                      @update:model-value="settings.supersample = $event"
                      :items="supersample" item-title="title" item-value="value"
                      density="compact" variant="outlined" hide-details />
          </label>
          <p class="tx-props-note">{{ t('settings.supersample.note') }}</p>

          <v-divider class="my-2" />

          <div class="tx-settings-section">{{ t('settings.section.packing') }}</div>
          <label class="tx-settings-row" v-tip="t('settings.padding.tip')">
            <span>{{ t('settings.padding') }}</span>
            <input type="number" min="0" max="256" step="1" :value="settings.padding"
                   @change="clamp('padding', $event.target.value, 0, 256, 2)" />
            <em>px</em>
          </label>
          <v-switch v-model="settings.powerOfTwo" :label="t('settings.power_of_two')"
                    density="compact" hide-details color="primary" class="tx-props-switch"
                    v-tip="t('settings.power_of_two.tip')" />

          <v-divider class="my-2" />

          <div class="tx-settings-section">{{ t('settings.section.export') }}</div>
          <v-switch v-model="settings.exportMaps" :label="t('settings.export_maps')"
                    density="compact" hide-details color="primary"
                    class="tx-props-switch tx-export-maps"
                    v-tip="t('settings.export_maps.tip')" />
          <p class="tx-props-note">{{ t('settings.export_maps.note') }}</p>

          <v-divider class="my-2" />

          <div class="tx-settings-section">{{ t('settings.section.material') }}</div>
          <v-switch v-model="settings.autoPbr" :label="t('settings.auto_pbr')"
                    density="compact" hide-details color="primary"
                    class="tx-props-switch"
                    v-tip="t('settings.auto_pbr.tip')" />
          <p class="tx-props-note">{{ t('settings.auto_pbr.note') }}</p>

          <v-divider class="my-2" />

          <div class="tx-settings-section">{{ t('settings.section.ai') }}</div>
          <v-switch :model-value="settings.ai" @update:model-value="setAi($event)"
                    :label="t('settings.ai')"
                    density="compact" hide-details color="primary"
                    class="tx-props-switch tx-settings-ai"
                    v-tip="t('settings.ai.tip')" />
          <p class="tx-props-note">
            {{ t('settings.ai.note') }}
            <a :href="modelUrl" target="_blank" rel="noopener noreferrer">{{ model }}</a>
          </p>
          <p class="tx-props-note">{{ t('settings.ai.rest', {
            flatten: t('context.flatten_lighting'), pbr: t('props.material.generate_pbr'),
          }) }}</p>

          <v-divider class="my-2" />

          <div class="tx-settings-section">{{ t('settings.section.help') }}</div>
          <button type="button" class="tx-settings-item"
                  v-tip="t('settings.intro.tip')"
                  @click="showIntro">
            <v-icon :icon="icons.help" size="14" />
            <span>{{ t('settings.intro') }}</span>
          </button>
          <button type="button" class="tx-settings-item tx-settings-shortcuts"
                  v-tip="t('settings.shortcuts.tip')"
                  @click="showShortcuts">
            <v-icon :icon="icons.help" size="14" />
            <span>{{ t('settings.shortcuts') }}</span>
            <kbd v-if="!device.touch">F1</kbd>
          </button>
        </div>
      </div>
    </v-dialog>
  `,
};
