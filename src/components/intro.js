import { TX } from "../tx.js";

TX.components = TX.components || {};

const INTRO_KEY = "texture-extract:intro";

TX.schema.intro = 1;

function loadSeen() {
  const data = TX.durable.read(INTRO_KEY, TX.schema.intro);
  return !!(data && data.seen);
}

function saveSeen() {
  TX.durable.write(INTRO_KEY, TX.schema.intro, { seen: true });
}

TX.intro = { loadSeen, saveSeen, INTRO_KEY };

TX.components.Intro = {
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ["update:modelValue", "start", "examples"],
  setup() {
    return {
      version: TX.version,
      device: TX.device.status,
      i18n: TX.i18n.status,
      icons: TX.icons.app,
    };
  },
  computed: {
    steps() {
      void this.i18n.locale;
      void this.device.touch;
      void this.device.compact;
      const touch = this.device.touch;
      const compact = this.device.compact;
      const markKeys = touch
        ? [
          { kind: "kbd", label: this.t("status.hint.keys.long_press_drag") },
        ]
        : [
          { kind: "kbd", label: this.t("status.hint.keys.ctrl_click") },
          { kind: "kbd", label: this.t("status.hint.keys.ctrl_drag") },
        ];
      const panelControls = compact
        ? [
          { kind: "tab", label: this.t("panels.atlas.title_short") },
          { kind: "tab", label: this.t("panels.tiling.title_short") },
          { kind: "tab", label: this.t("panels.preview3d.title_short") },
          { kind: "tab", label: this.t("panels.properties.title_short") },
        ]
        : [
          { kind: "tab", label: this.t("panels.tiling.title_short") },
          { kind: "tab", label: this.t("panels.preview3d.title_short") },
          { kind: "tab", label: this.t("panels.properties.title_short") },
        ];
      return [
        {
          title: this.t("intro.step.import.title"),
          body: this.t(touch ? "intro.step.import.body_touch" : "intro.step.import.body"),
          controls: [
            {
              kind: "btn",
              variant: "flat",
              color: "primary",
              icon: this.icons.load,
              label: this.t("toolbar.import"),
            },
          ],
        },
        {
          title: this.t("intro.step.mark.title"),
          body: this.t(touch ? "intro.step.mark.body_touch" : "intro.step.mark.body"),
          controls: markKeys,
        },
        {
          title: this.t("intro.step.atlas.title"),
          body: this.t("intro.step.atlas.body"),
          controls: [
            { kind: "tab", label: this.t("panels.atlas.title_short"), live: true },
          ],
        },
        {
          title: this.t("intro.step.panels.title"),
          body: this.t(compact ? "intro.step.panels.body_mobile" : "intro.step.panels.body"),
          controls: panelControls,
        },
        {
          title: this.t("intro.step.export.title"),
          body: this.t("intro.step.export.body"),
          controls: [
            {
              kind: "btn",
              variant: "tonal",
              color: "primary",
              icon: this.icons.download,
              label: this.t("toolbar.export"),
            },
            {
              kind: "btn",
              variant: "text",
              icon: this.icons.pack,
              label: this.t("toolbar.pack"),
            },
          ],
        },
      ];
    },
  },
  methods: {
    close(start) {
      saveSeen();
      this.$emit("update:modelValue", false);
      if (start) this.$emit("start");
    },
    startExamples() {
      saveSeen();
      this.$emit("update:modelValue", false);
      this.$emit("examples");
    },
  },
  template: `
    <div v-if="modelValue" class="tx-intro" role="dialog" aria-modal="true"
         :aria-label="t('intro.title')">
      <div class="tx-intro-card">
        <p class="tx-intro-brand">{{ t('intro.brand', { version }) }}</p>
        <h2 class="tx-intro-title">{{ t('intro.title') }}</h2>
        <p class="tx-intro-lead">{{ t('intro.lead') }}</p>

        <ol class="tx-intro-steps">
          <li v-for="(step, i) in steps" :key="i" class="tx-intro-step">
            <span class="tx-intro-num" aria-hidden="true">{{ i + 1 }}</span>
            <div class="tx-intro-step-body">
              <strong>{{ step.title }}</strong>
              <p>{{ step.body }}</p>
              <div v-if="step.controls && step.controls.length" class="tx-intro-controls">
                <template v-for="(c, j) in step.controls" :key="j">
                  <v-btn v-if="c.kind === 'btn'" :variant="c.variant || 'tonal'"
                         :color="c.color" size="small" class="tx-action tx-intro-demo"
                         :prepend-icon="c.icon" tabindex="-1" @click.prevent>
                    {{ c.label }}
                  </v-btn>
                  <span v-else-if="c.kind === 'tab'" class="tx-intro-tab"
                        :class="{ 'tx-intro-tab--live': c.live }">
                    {{ c.label }}
                    <span v-if="c.live" class="tx-dock-tab-live" aria-hidden="true"></span>
                  </span>
                  <kbd v-else-if="c.kind === 'kbd'" class="tx-intro-kbd">{{ c.label }}</kbd>
                </template>
              </div>
            </div>
          </li>
        </ol>

        <div class="tx-intro-actions">
          <v-btn variant="text" class="tx-intro-skip" @click="close(false)">
            {{ t('intro.skip') }}
          </v-btn>
          <v-btn variant="flat" color="primary" class="tx-action"
                 :prepend-icon="icons.load" @click="close(true)">
            {{ t('intro.start') }}
          </v-btn>
          <v-btn variant="tonal" color="primary" class="tx-action"
                 :prepend-icon="icons.layers" @click="startExamples">
            {{ t('intro.examples') }}
          </v-btn>
        </div>
      </div>
    </div>
  `,
};
