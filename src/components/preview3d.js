import { TX } from "../tx.js";

TX.components = TX.components || {};

const SHAPE_META = [
  { value: "plane", icon: "plane", title: "preview3d.shape.plane.title", tip: "preview3d.shape.plane.tip" },
  { value: "box", icon: "cube", title: "preview3d.shape.box.title", tip: "preview3d.shape.box.tip" },
  { value: "cylinder", icon: "cylinder", title: "preview3d.shape.cylinder.title", tip: "preview3d.shape.cylinder.tip" },
  { value: "sphere", icon: "sphere", title: "preview3d.shape.sphere.title", tip: "preview3d.shape.sphere.tip" },
];

const setting = key => ({
  get() {
    return TX.material.settingsOf(this.state.settings.material)[key];
  },
  set(value) {
    this.state.settings.material[key] = value;
  },
});


TX.components.Preview3d = {
  props: {
    actions: { type: Object, default: null },
  },
  setup() {
    return {
      state: TX.store.state,
      icons: TX.icons.app,
      i18n: TX.i18n.status,
    };
  },
  data() {
    return { view: null, exporting: false };
  },
  computed: {
    shapes() {
      void this.i18n.locale;
      return SHAPE_META.map(s => ({
        value: s.value,
        icon: s.icon,
        title: this.t(s.title),
        tip: this.t(s.tip),
      }));
    },
  shape: setting("shape"),

  sway: {
    get() {
      return this.state.settings.sway !== false;
    },
    set(value) {
      this.state.settings.sway = !!value;
    },
  },

    exportHint() {
      void this.i18n.locale;
      if (this.photo) {
        return this.photoDepth
          ? this.t("preview3d.export.hint_photo")
          : this.t("preview3d.export.hint_photo_no_depth");
      }
      return this.single
        ? this.t("preview3d.export.hint")
        : this.t("preview3d.export.hint_none");
    },
    hasSubject() {
      return !!this.single || !!(this.photo && this.photoDepth);
    },

    single() {
      return TX.store.soleSelected("texture");
    },
    photo() {
      if (this.single) return null;
      const image = TX.store.soleSelected("image");
      if (image) return image;
      const mark = TX.store.soleSelected("mark");
      return mark ? TX.store.findImage(mark.imageId) : null;
    },
    photoDepthKey() {
      return this.photo ? `${this.photo.id}:${this.state.depthEpoch}` : "";
    },
    photoDepth() {
      return this.photoDepthKey ? TX.store.imageDepth(this.photo.id) : null;
    },
    photoBusy() {
      const busy = this.state.depthBusy;
      return busy && this.photo && busy.imageId === this.photo.id ? busy : null;
    },
    photoProgress() {
      const busy = this.photoBusy;
      return busy && busy.total ? `${Math.round((busy.loaded / busy.total) * 100)}%` : "";
    },
  },
  methods: {
    fit() {
      if (this.view) this.view.fit();
    },

    estimateDepth() {
      if (!this.photo) return;
      this.state.settings.depth.enabled = true;
      TX.depthModel.estimate(this.photo.id);
    },

    async exportScene() {
      if (!this.photo || !this.actions || this.exporting) return;
      this.exporting = true;
      try {
        await this.actions.exportSceneGlb(this.photo.id);
      } finally {
        this.exporting = false;
      }
    },
    async exportGlb() {
      if (!this.single || !this.actions || this.exporting) return;
      this.exporting = true;
      try {
        await this.actions.exportGlb(this.single.id);
      } finally {
        this.exporting = false;
      }
    },
  },
  mounted() {
    this.$nextTick(() => {
      const stage = this.$refs.stage;
      if (!stage) return;
      this.view = TX.preview3d.createPreview3d(stage);
    });
  },
  beforeUnmount() {
    if (this.view) this.view.dispose();
    this.view = null;
  },
  template: `
    <div class="tx-props tx-3d">
      <div class="tx-3d-viewport" ref="stage"
           v-tip="t('preview3d.viewport.tip')">
        <div v-if="!hasSubject" class="tx-3d-empty">
          <template v-if="photoBusy">
            {{ t('preview3d.empty.estimating', { progress: photoProgress }) }}
          </template>
          <template v-else>
            <template v-if="photo">
              <p>{{ t('preview3d.empty.no_depth') }}</p>
              <p v-if="!state.settings.ai" class="tx-3d-error">{{ t('depth.error.ai_off') }}</p>
              <v-btn v-else variant="tonal" size="small" class="tx-action"
                     :prepend-icon="icons.measure"
                     v-tip="t('preview3d.estimate_depth.tip')"
                     @click="estimateDepth">{{ t('preview3d.estimate_depth') }}</v-btn>
              <p v-if="state.depthError" class="tx-3d-error">{{ state.depthError }}</p>
            </template>
            <p v-else>{{ t('preview3d.empty.select') }}</p>
          </template>
        </div>

        <div class="tx-viewport-tools tx-3d-tools">
          <template v-if="!photo">
            <v-btn v-for="option in shapes" :key="option.value"
                   :icon="icons[option.icon]" size="x-small" variant="text"
                   density="comfortable"
                   :class="{ 'tx-viewport-tool--on': shape === option.value }"
                   v-tip="option.tip" @click="shape = option.value" />
            <span class="tx-viewport-tools-gap"></span>
          </template>
          <v-btn v-if="!photo" :icon="icons.sway" size="x-small" variant="text"
                 density="comfortable" class="tx-3d-sway"
                 :class="{ 'tx-viewport-tool--on': sway }"
                 v-tip="t('preview3d.sway.tip')" @click="sway = !sway" />
          <v-btn :icon="icons.fit" size="x-small" variant="text" density="comfortable"
                 v-tip="t('preview3d.fit.tip')"
                 @click="fit" />
          <v-btn :icon="icons.download" size="x-small" variant="text" density="comfortable"
                 :loading="exporting" :disabled="photo ? !photoDepth : !single"
                 v-tip="exportHint"
                 @click="photo ? exportScene() : exportGlb()" />
        </div>
      </div>

    </div>
  `,
};
