import { TX } from "../tx.js";

TX.components = TX.components || {};

const round = (value, places) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

// HISTOGRAM_SAMPLES — cap for slider-driven histogram passes
const HISTOGRAM_SAMPLES = { maxSamples: 1200000 };

const LENS_GROUP = `
  <PropsGroup v-if="lensImage" :title="t('props.lens.title')" :open="groups.lens" :badge="lensBadge"
              :hint="lensHint"
              @toggle="toggle('lens')">
    <label class="tx-props-slider" v-tip="t('props.lens.distortion.tip')">
      <span>{{ t('props.lens.distortion') }}</span>
      <input type="range" min="-300" max="300" step="1"
             :value="Math.round(lens.k1 * 1000)"
             @input="setLens({ k1: Number($event.target.value) / 1000 })" />
      <em>{{ lens.k1.toFixed(3) }}</em>
    </label>
    <label class="tx-props-slider" v-tip="t('props.lens.fine.tip')">
      <span>{{ t('props.lens.fine') }}</span>
      <input type="range" min="-150" max="150" step="1"
             :value="Math.round(lens.k2 * 1000)"
             @input="setLens({ k2: Number($event.target.value) / 1000 })" />
      <em>{{ lens.k2.toFixed(3) }}</em>
    </label>

    <div class="tx-pbr-actions">
      <v-btn variant="tonal" size="x-small" class="tx-action tx-lens-fit"
             :prepend-icon="icons.measure" :disabled="!lensEvidence"
             v-tip="lensFitTip"
             @click="fitLens">{{ t('props.lens.fit') }}</v-btn>
      <v-btn v-if="!lensIdentity" variant="text" size="x-small" class="tx-action"
             :prepend-icon="icons.reset"
             v-tip="t('props.lens.clear.tip')"
             @click="resetLens">{{ t('props.lens.clear') }}</v-btn>
    </div>
    <p class="tx-props-note" v-if="lensReport">{{ lensReport }}</p>
  </PropsGroup>
`;

TX.components.Properties = {
  components: { Histogram: TX.components.Histogram, PropsGroup: TX.components.PropsGroup },
  props: {
    atlas: { type: Object, default: null },
    actions: { type: Object, default: null },
  },
  setup() {
    return { state: TX.store.state, icons: TX.icons.app, i18n: TX.i18n.status };
  },
  data() {
    return { generated: "", rectifying: false, lensReport: "" };
  },
  watch: {
    channels() { this.$nextTick(() => this.paintChannels()); },
  },
  mounted() {
    this.paintChannels();
  },
  computed: {
    selection() {
      return TX.store.selectedItems("texture");
    },
    single() {
      return TX.store.soleSelected("texture");
    },
    selectedMark() {
      return TX.store.soleSelected("mark");
    },
    markCount() {
      return TX.store.selectionCount("mark");
    },
    lensImage() {
      const photo = TX.store.soleSelected("image");
      if (photo) return photo;
      return (this.mark && TX.store.findImage(this.mark.imageId)) || null;
    },
    lens() {
      return TX.lens.settingsOf(this.lensImage && this.lensImage.lens);
    },
    lensBadge() {
      void this.i18n.locale;
      if (!this.lensImage) return "";
      if (this.lensIdentity) return this.t("props.lens.badge.none");
      return this.t("props.lens.badge.k1", { value: this.lens.k1.toFixed(3) });
    },
    lensIdentity() {
      return TX.lens.isIdentity(this.lens);
    },
    lensMarkCount() {
      return this.lensImage ? TX.store.marksOfImage(this.lensImage.id).length : 0;
    },
    lensEvidence() {
      if (!this.lensImage) return 0;
      return TX.lens.tracedLines(TX.store.marksOfImage(this.lensImage.id)).length;
    },
    texturesOfMark() {
      const mark = this.selectedMark;
      return mark ? this.state.textures.some(t => t.markId === mark.id) : false;
    },
    markSubtitle() {
      const mark = this.selectedMark;
      if (!mark) return "";
      const image = TX.store.findImage(mark.imageId);
      const size = TX.geom.quadDimensions(
        TX.geom.effectiveQuad(mark.points, mark.domain, mark.curve));
      return `${Math.round(size.width)} x ${Math.round(size.height)}`
        + `${image ? ` on ${image.name}` : ""}`;
    },
    groups() {
      return this.state.settings.props;
    },
    lensHint() {
      void this.i18n.locale;
      const marks = this.lensMarkCount;
      return this.t("props.lens.hint", {
        count: marks,
        plural: this.t(marks === 1 ? "props.lens.hint_plural_one" : "props.lens.hint_plural_other"),
      });
    },
    lensFitTip() {
      void this.i18n.locale;
      return this.lensEvidence
        ? this.t("props.lens.fit.tip", { count: this.lensEvidence })
        : this.t("props.lens.fit.tip_none");
    },
    sizeLabel() {
      const node = this.single;
      if (!node) return "";
      const w = Math.round(node.width * node.scaleX);
      const h = Math.round(node.height * node.scaleY);
      const base = `${node.width} x ${node.height}`;
      return w === node.width && h === node.height ? base : `${base}  →  ${w} x ${h}`;
    },
    tiling() {
      return (this.single && this.single.tiling) || TX.tiling.defaults();
    },
    bandPercent() {
      return Math.round(this.tiling.band * 100);
    },
    mark() {
      if (this.selectedMark) return this.selectedMark;
      return (this.single && this.single.markId && TX.store.findMark(this.single.markId)) || null;
    },
    domain() {
      return TX.geom.domainOf(this.mark && this.mark.domain);
    },
    extend() {
      const d = this.domain;
      return {
        left: round(-d.u0 * 100, 1),
        right: round((d.u1 - 1) * 100, 1),
        top: round(-d.v0 * 100, 1),
        bottom: round((d.v1 - 1) * 100, 1),
      };
    },
    isDefaultLocalSpace() {
      return !this.mark
        || (TX.geom.isUnitDomain(this.domain) && TX.geom.isFlatCurve(this.mark.curve));
    },
    bendPercent() {
      const curve = TX.geom.curveOf(this.mark && this.mark.curve);
      return curve.map((c, k) => {
        const a = TX.geom.UNIT_CORNERS[k];
        const b = TX.geom.UNIT_CORNERS[(k + 1) % 4];
        const mid = TX.geom.edgePoint(curve, k, 0.5);
        return round(Math.hypot(mid.x - (a.x + b.x) / 2, mid.y - (a.y + b.y) / 2) * 100, 1);
      });
    },
    delight() {
      return (this.single && this.single.delight) || TX.delight.defaults();
    },
    radiusPercent() {
      return Math.round(this.delight.radius * 100);
    },
    transformBadge() {
      const node = this.single;
      if (!node) return "";
      const parts = [];
      if (Math.round(node.x) || Math.round(node.y)) {
        parts.push(`${Math.round(node.x)}, ${Math.round(node.y)}`);
      }
      if (round(node.scaleX, 2) !== 1 || round(node.scaleY, 2) !== 1) {
        parts.push(`${round(node.scaleX, 2)}×${round(node.scaleY, 2)}`);
      }
      const degrees = this.rotationDegrees();
      if (degrees) parts.push(`${degrees}°`);
      return parts.join(" · ");
    },
    localBadge() {
      void this.i18n.locale;
      if (!this.mark) return this.t("props.local.badge.no_mark");
      if (this.isDefaultLocalSpace) return "";
      const e = this.extend;
      const parts = [];
      const widest = Math.max(...[e.left, e.right, e.top, e.bottom].map(Math.abs));
      if (widest) parts.push(`${widest}%`);
      if (!TX.geom.isFlatCurve(this.mark.curve)) parts.push(this.t("props.local.badge.bent"));
      return parts.join(" · ");
    },
    lightingBadge() {
      void this.i18n.locale;
      const d = this.delight;
      if (d.mode === "none") return this.t("props.lighting.badge.off");
      return this.t("props.lighting.badge", { mode: d.mode, percent: Math.round(d.strength * 100) });
    },
    tilingAxis() {
      return TX.tiling.axisOf(this.tiling);
    },
    tilingBadge() {
      void this.i18n.locale;
      if (this.tiling.mode === "none") return this.t("props.tiling.badge.off");
      const axis = this.tilingAxis;
      return this.t("props.tiling.badge", {
        axis: axis === "xy" ? this.t("props.tiling.badge.both") : axis,
        percent: this.bandPercent,
      });
    },
    material() {
      return TX.material.settingsOf(this.state.settings.material);
    },
    fromColour() {
      const m = this.material;
      return m.detailNormal > 0 || m.roughnessAmount > 0 || m.cavity > 0;
    },
    materialBadge() {
      void this.i18n.locale;
      const m = this.material;
      const parts = [this.t("props.material.badge.rough", { value: m.roughness.toFixed(2) })];
      if (m.metalness > 0) parts.push(this.t("props.material.badge.metal"));
      if (this.fromColour) parts.push(this.t("props.material.badge.pbr"));
      return parts.join(" · ");
    },
    derived() {
      const node = this.single;
      if (!node) return null;
      const asset = TX.store.assets.textures.get(node.id);
      const albedo = TX.store.textureCanvas(node.id);
      if (!asset || !albedo) return null;
      // void pixelEpoch — pixels live in a plain Map outside Vue's graph
      void this.state.pixelEpoch;
      return TX.material.maps(node.id, albedo, asset.canvas, node.delight, this.material,
        asset.version);
    },
    channels() {
      const maps = this.derived;
      if (!maps) return [];
      void this.i18n.locale;
      return [
        {
          key: "albedo",
          label: this.t("props.material.channel.colour"),
          mode: "off",
          canvas: maps.albedo,
          tip: this.t("props.material.channel.colour.tip"),
        },
        {
          key: "normal",
          label: this.t("props.material.channel.normal"),
          mode: "normal",
          canvas: maps.normal,
          tip: this.t("props.material.channel.normal.tip"),
        },
        {
          key: "roughness",
          label: this.t("props.material.channel.roughness"),
          mode: "roughness",
          canvas: maps.roughness,
          tip: this.t("props.material.channel.roughness.tip"),
        },
        {
          key: "occlusion",
          label: this.t("props.material.channel.occlusion"),
          mode: "occlusion",
          canvas: maps.occlusion,
          tip: this.t("props.material.channel.occlusion.tip"),
        },
      ].filter(c => !!c.canvas);
    },
    shownChannel() {
      return this.state.settings.views.mode;
    },
    subdivisions() {
      return TX.material.SUBDIVISIONS;
    },
    depthKey() {
      return this.mark ? `${this.mark.imageId}:${this.state.depthEpoch}` : "";
    },
    depthReady() {
      return Boolean(this.depthKey && TX.store.imageDepth(this.mark.imageId));
    },
    depthBusy() {
      const busy = this.state.depthBusy;
      return busy && this.mark && busy.imageId === this.mark.imageId ? busy : null;
    },
    depthProgress() {
      const busy = this.depthBusy;
      return busy && busy.total ? `${Math.round((busy.loaded / busy.total) * 100)}%` : "";
    },
    reliefField() {
      if (!this.depthReady || !this.single) return null;
      return TX.store.reliefField(this.single.id, this.material.subdivision + 1);
    },
    flatPercent() {
      return this.reliefField ? round(this.reliefField.flatness * 100, 1) : 0;
    },
    photo() {
      return TX.store.soleSelected("image");
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
    scene() {
      return TX.depthScene.settingsOf(this.state.settings.depth);
    },
    details() {
      return TX.depthScene.DETAILS;
    },
    displays() {
      return TX.depthScene.DISPLAYS;
    },
    sceneStats() {
      return this.state.sceneStats;
    },
    sceneBadge() {
      void this.i18n.locale;
      if (this.photoBusy) return this.t("props.scene.badge.estimating");
      if (!this.photoDepth) return this.t("props.scene.badge.none");
      const s = this.scene;
      return this.t("props.scene.badge", { fov: Math.round(s.fov), shift: s.shift.toFixed(2) });
    },
    sceneMeshBadge() {
      void this.i18n.locale;
      if (!this.photoDepth) return "";
      const stats = this.sceneStats;
      const s = this.scene;
      const display = this.t(`props.scene_mesh.display.${s.display}`);
      return stats
        ? this.t("props.scene_mesh.badge", {
          tris: stats.triangles.toLocaleString(), display,
        })
        : display;
    },
    depthBadge() {
      void this.i18n.locale;
      if (!this.mark) return this.t("props.depth.badge.no_mark");
      if (this.depthBusy) return this.t("props.depth.badge.estimating");
      if (!this.depthReady) return this.t("props.depth.badge.none");
      const m = this.material;
      if (!m.useDepth) return this.t("props.depth.badge.off");
      const parts = [];
      if (m.bow > 0) parts.push(this.t("props.depth.badge.bow", { percent: Math.round(m.bow * 100) }));
      if (m.depthNormal > 0) {
        parts.push(this.t("props.depth.badge.normal", { percent: Math.round(m.depthNormal * 100) }));
      }
      return parts.length ? parts.join(" · ") : this.t("props.depth.badge.off");
    },
    pixelKey() {
      const asset = this.single && TX.store.assets.textures.get(this.single.id);
      return asset ? `${this.single.id}:${this.state.pixelEpoch}:${asset.version}` : "";
    },
    analysisKey() {
      return this.pixelKey ? `${this.pixelKey}:${TX.delight.keyOf(this.delight, 0)}` : "";
    },
    analysis() {
      if (!this.analysisKey) return null;
      return TX.delight.analyze(TX.store.textureCanvas(this.single.id), HISTOGRAM_SAMPLES);
    },
    original() {
      if (!this.pixelKey || this.delight.mode === "none") return null;
      return TX.delight.analyze(TX.store.assets.textures.get(this.single.id).canvas,
        HISTOGRAM_SAMPLES);
    },
  },
  methods: {
    toggle(key) {
      this.groups[key] = !this.groups[key];
    },
    setNumber(field, value, min, max) {
      const node = this.single;
      if (!node) return;
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      node[field] = Math.max(min, Math.min(max, n));
    },
    setRotationDegrees(value) {
      const node = this.single;
      if (!node) return;
      const n = Number(value);
      if (Number.isFinite(n)) node.rotation = (n * Math.PI) / 180;
    },
    rotationDegrees() {
      return this.single ? round((this.single.rotation * 180) / Math.PI, 1) : 0;
    },
    setMode(mode) {
      if (this.single) TX.store.setTiling(this.single.id, { mode });
    },
    setBand(percent) {
      if (this.single) TX.store.setTiling(this.single.id, { band: Math.max(0, Math.min(50, percent)) / 100 });
    },
    setAxis(axis) {
      if (this.single) TX.store.setTiling(this.single.id, { axis });
    },
    extendHint(side) {
      const current = this.extend[side];
      const state = current > 0
        ? this.t("props.local.extend.taking", { percent: current })
        : (current < 0
          ? this.t("props.local.extend.trimming", { percent: -current })
          : this.t("props.local.extend.at_edge"));
      return this.t("props.local.extend.tip", { side: this.t(`props.local.side.${side}`), state });
    },
    setExtend(side, percent) {
      if (!this.mark) return;
      const n = Number(percent);
      if (!Number.isFinite(n)) return;
      const amount = Math.max(-90, Math.min(400, n)) / 100;
      const patch = {
        left: { u0: -amount },
        right: { u1: 1 + amount },
        top: { v0: -amount },
        bottom: { v1: 1 + amount },
      }[side];
      TX.store.setMarkDomain(this.mark.id, patch);
      this.reextract();
    },
    resetLocalSpace() {
      if (!this.mark) return;
      TX.history.name("history.reset_local_space");
      TX.store.resetMarkLocalSpace(this.mark.id);
      this.reextract();
    },
    resetCurve() {
      if (!this.mark) return;
      for (let k = 0; k < 4; k++) TX.store.setMarkCurve(this.mark.id, k, null);
      this.reextract();
    },
    reextract() {
      if (this.actions && this.mark) this.actions.reextract(this.mark.id);
    },
    setLens(patch) {
      if (!this.lensImage) return;
      TX.store.setLens(this.lensImage.id, patch);
      this.reextractImage();
    },
    reextractImage() {
      if (!this.actions || !this.lensImage) return;
      for (const mark of TX.store.marksOfImage(this.lensImage.id)) {
        this.actions.reextract(mark.id);
      }
    },
    fitLens() {
      const image = this.lensImage;
      if (!image) return;
      const found = TX.lens.fit(
        TX.store.marksOfImage(image.id), image.width, image.height);
      if (!found) {
        this.lensReport = this.t("props.lens.report.need_bend");
        return;
      }
      // Reject fits below 0.05 — nearly-straight edges still yield a number
      if (found.improvement < 0.05) {
        this.lensReport = this.t("props.lens.report.already_straight", { count: found.lines });
        return;
      }
      TX.history.name("history.fit_the_lens");
      TX.store.setLens(image.id, { k1: found.k1, k2: 0 });
      this.reextractImage();
      this.lensReport = this.t(found.lines === 1
        ? "props.lens.report.fitted_one" : "props.lens.report.fitted_other", {
        k1: found.k1.toFixed(4),
        count: found.lines,
        percent: Math.round(found.improvement * 100),
      });
    },
    resetLens() {
      if (!this.lensImage) return;
      TX.history.name("history.clear_lens");
      TX.store.setLens(this.lensImage.id, TX.lens.defaults());
      this.reextractImage();
      this.lensReport = "";
    },
    async rectify() {
      if (!this.actions || !this.mark || this.rectifying) return;
      this.rectifying = true;
      try {
        await this.actions.reprojectImage(this.mark.id);
      } finally {
        this.rectifying = false;
      }
    },
    setDelight(patch) {
      if (this.single) TX.store.setDelight(this.single.id, patch);
    },
    extractShading() {
      if (!this.single || !this.atlas) return;
      this.atlas.addShadingTexture(this.single.id);
    },
    mirrorDuplicate() {
      if (this.single && this.atlas) this.atlas.duplicateMirrored(this.single.id);
    },
    resetTransform() {
      if (this.atlas) this.atlas.resetTransforms();
    },
    rotateQuarter(steps) {
      const node = this.single;
      if (!node) return;
      TX.history.name(steps > 0 ? "history.rotate_right" : "history.rotate_left");
      const quarters = Math.round((node.rotation * 2) / Math.PI) + steps;
      node.rotation = (((quarters % 4) + 4) % 4) * (Math.PI / 2);
    },
    flip(axis) {
      if (!this.single) return;
      TX.history.name(axis === "x" ? "history.flip_horizontally" : "history.flip_vertically");
      TX.store.setFlip(this.single.id, { [axis]: !this.single.flip[axis] });
    },
    setMaterial(patch) {
      Object.assign(this.state.settings.material, patch);
    },
    async generatePbr() {
      const node = this.single;
      if (!node) return;
      const asset = TX.store.assets.textures.get(node.id);
      const albedo = TX.store.textureCanvas(node.id);
      if (!asset || !albedo) return;

      await TX.progress.run(this.t("props.material.progress.generating"), async report => {
        await report(0, this.t("props.material.progress.reading", { name: node.name }));
        const advice = TX.pbr.suggest(node.id, albedo, asset.version);
        if (!advice) return;

        TX.history.name("history.generate_pbr");
        this.setMaterial(advice.settings);
        const r = advice.reading;
        this.generated = this.t("props.material.generated", {
          mean: Math.round(r.mean * 100),
          detail: (r.energy * 1000).toFixed(1),
          highlights: Math.round(r.highlights * 100),
        });

        const others = this.state.textures.filter(t => t.id !== node.id);
        await TX.progress.each([node, ...others],
          (texture, i, total) => this.t("props.material.progress.deriving", {
            name: texture.name, index: i + 1, total,
          }),
          texture => TX.material.warm(texture.id));
      });
    },
    showChannel(channel) {
      const wanted = this.shownChannel === channel.mode ? "off" : channel.mode;
      return TX.viewOverlay.choose(wanted);
    },
    resetMaps() {
      TX.history.name("history.clear_generated_maps");
      this.setMaterial({ detailNormal: 0, roughnessAmount: 0, cavity: 0 });
      this.generated = "";
    },
    // Canvases are not reactive — thumbnails are painted, not bound
    paintChannels() {
      const hosts = this.$refs.channel;
      if (!hosts) return;
      const list = Array.isArray(hosts) ? hosts : [hosts];
      this.channels.forEach((channel, index) => {
        const canvas = list[index];
        if (!canvas || !channel.canvas) return;
        const size = 46;
        const scale = Math.min(size / channel.canvas.width, size / channel.canvas.height);
        const w = Math.max(1, Math.round(channel.canvas.width * scale));
        const h = Math.max(1, Math.round(channel.canvas.height * scale));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(channel.canvas, 0, 0, w, h);
      });
    },
    setScene(patch) {
      Object.assign(this.state.settings.depth, patch);
    },
    resetScene() {
      const { enabled } = this.state.settings.depth;
      Object.assign(this.state.settings.depth, TX.depthScene.defaults(), { enabled });
    },
    estimatePhotoDepth() {
      if (!this.photo) return;
      this.state.settings.depth.enabled = true;
      TX.depthModel.estimate(this.photo.id);
    },
    exportScene() {
      if (this.photo && this.actions) this.actions.exportSceneGlb(this.photo.id);
    },
    estimateDepth() {
      if (!this.mark) return;
      this.state.settings.depth.enabled = true;
      TX.depthModel.estimate(this.mark.imageId);
    },
  },
  template: `
    <div class="tx-props">
      <template v-if="!single && selection.length">
        <p class="tx-props-empty">{{ t('props.empty.multi_textures', { count: selection.length }) }}</p>
      </template>

      <template v-else-if="markCount > 1">
        <p class="tx-props-empty">{{ t('props.empty.multi_marks', { count: markCount }) }}</p>
      </template>

      <template v-else-if="!single && !photo && !selectedMark">
        <p class="tx-props-empty">{{ t('props.empty.none') }}</p>
      </template>

      <template v-else-if="photo">
        <div class="tx-props-head">
          <div class="tx-props-title">
            <div class="tx-props-name">{{ photo.name }}</div>
            <div class="tx-props-size">{{ Math.round(photo.width) }} x {{ Math.round(photo.height) }}</div>
          </div>
        </div>

        ${LENS_GROUP}

        <PropsGroup :title="t('props.scene.title')" :open="groups.scene" :badge="sceneBadge"
                    :hint="t('props.scene.hint')"
                    @toggle="toggle('scene')">
          <p class="tx-props-note" v-if="photoBusy">{{ t('props.scene.estimating', { progress: photoProgress }) }}</p>

          <template v-else-if="!photoDepth">
            <p class="tx-props-note" v-if="!state.settings.ai">{{ t('depth.error.ai_off') }}</p>
            <v-btn v-else size="x-small" variant="text" class="tx-props-btn"
                   :prepend-icon="icons.measure" @click="estimatePhotoDepth">{{ t('props.scene.estimate') }}</v-btn>
            <p class="tx-props-note" v-if="state.depthError">{{ state.depthError }}</p>
          </template>

          <template v-else>
            <div class="tx-props-sub">{{ t('props.scene.sub.camera') }}</div>
            <label class="tx-props-slider"
                   v-tip="t('props.scene.focal.tip')">
              <span>{{ t('props.scene.focal') }}</span>
              <input type="range" min="20" max="120" step="1" :value="Math.round(scene.fov)"
                     @input="setScene({ fov: Number($event.target.value) })" />
              <em>{{ Math.round(scene.fov) }}°</em>
            </label>
            <label class="tx-props-slider"
                   v-tip="t('props.scene.shift.tip')">
              <span>{{ t('props.scene.shift') }}</span>
              <input type="range" min="2" max="100" step="1"
                     :value="Math.round(scene.shift * 100)"
                     @input="setScene({ shift: Number($event.target.value) / 100 })" />
              <em>{{ scene.shift.toFixed(2) }}</em>
            </label>

            <div class="tx-props-sub">{{ t('props.scene.sub.range') }}</div>
            <label class="tx-props-slider"
                   v-tip="t('props.scene.trim.tip')">
              <span>{{ t('props.scene.trim') }}</span>
              <input type="range" min="0" max="20" step="1" :value="Math.round(scene.trim * 100)"
                     @input="setScene({ trim: Number($event.target.value) / 100 })" />
              <em>{{ Math.round(scene.trim * 100) }}%</em>
            </label>
            <label class="tx-props-slider"
                   v-tip="t('props.scene.smoothing.tip')">
              <span>{{ t('props.scene.smoothing') }}</span>
              <input type="range" min="0" max="50" step="1"
                     :value="Math.round(scene.smooth * 1000)"
                     @input="setScene({ smooth: Number($event.target.value) / 1000 })" />
              <em>{{ (scene.smooth * 100).toFixed(1) }}%</em>
            </label>
          </template>
        </PropsGroup>

        <PropsGroup v-if="photoDepth && !photoBusy" :title="t('props.scene_mesh.title')" :open="groups.sceneMesh"
                    :badge="sceneMeshBadge"
                    :hint="t('props.scene_mesh.hint')"
                    @toggle="toggle('sceneMesh')">
          <div class="tx-props-sub"
               v-tip="t('props.scene_mesh.display.tip')">{{ t('props.scene_mesh.display') }}</div>
          <v-btn-toggle :model-value="scene.display" density="compact" variant="outlined" divided
                        mandatory color="primary" class="tx-props-toggle"
                        @update:model-value="setScene({ display: $event })">
            <v-btn v-for="mode in displays" :key="mode" :value="mode" size="x-small">
              {{ t('props.scene_mesh.display.' + mode) }}</v-btn>
          </v-btn-toggle>

          <div class="tx-props-sub">{{ t('props.scene_mesh.detail') }}</div>
          <v-btn-toggle :model-value="scene.detail" density="compact" variant="outlined" divided
                        mandatory color="primary" class="tx-props-toggle"
                        @update:model-value="setScene({ detail: $event })">
            <v-btn v-for="n in details" :key="n" :value="n" size="x-small">{{ n }}</v-btn>
          </v-btn-toggle>

          <label class="tx-props-slider"
                 v-tip="t('props.scene_mesh.edge.tip')">
            <span>{{ t('props.scene_mesh.edge') }}</span>
            <input type="range" min="5" max="500" step="5" :value="Math.round(scene.edge * 1000)"
                   @input="setScene({ edge: Number($event.target.value) / 1000 })" />
            <em>{{ (scene.edge * 100).toFixed(1) }}%</em>
          </label>

          <p class="tx-props-note" v-if="sceneStats">
            {{ t('props.scene_mesh.stats', {
              cols: sceneStats.cols,
              rows: sceneStats.rows,
              kept: sceneStats.triangles.toLocaleString(),
              total: ((sceneStats.cols - 1) * (sceneStats.rows - 1) * 2).toLocaleString(),
            }) }}
          </p>

          <v-btn size="x-small" variant="text" class="tx-props-btn"
                 :prepend-icon="icons.download" @click="exportScene">{{ t('props.scene_mesh.export_glb') }}</v-btn>
          <v-btn size="x-small" variant="text" class="tx-props-btn"
                 :prepend-icon="icons.reset" @click="resetScene">{{ t('props.scene_mesh.reset') }}</v-btn>
        </PropsGroup>
      </template>

      <template v-else>
        <div class="tx-props-head">
          <div class="tx-props-title">
            <div class="tx-props-name">{{ single ? single.name : t('props.head.mark') }}</div>
            <div class="tx-props-size">{{ single ? sizeLabel : markSubtitle }}</div>
          </div>
        </div>

        <PropsGroup v-if="single" :title="t('props.transform.title')" :open="groups.transform"
                    :badge="transformBadge"
                    :hint="t('props.transform.hint')"
                    @toggle="toggle('transform')">
          <div class="tx-props-grid">
            <label v-tip="t('props.transform.xy.tip')">
              <span>{{ t('props.transform.x') }}</span>
              <input type="number" step="1" :value="Math.round(single.x)"
                     @change="setNumber('x', $event.target.value, -100000, 100000)" /></label>
            <label v-tip="t('props.transform.xy.tip')">
              <span>{{ t('props.transform.y') }}</span>
              <input type="number" step="1" :value="Math.round(single.y)"
                     @change="setNumber('y', $event.target.value, -100000, 100000)" /></label>
            <label v-tip="t('props.transform.scale.tip')">
              <span>{{ t('props.transform.scale_x') }}</span>
              <input type="number" step="0.01" min="0.02" :value="single.scaleX.toFixed(3)"
                     @change="setNumber('scaleX', $event.target.value, 0.02, 64)" /></label>
            <label v-tip="t('props.transform.scale.tip')">
              <span>{{ t('props.transform.scale_y') }}</span>
              <input type="number" step="0.01" min="0.02" :value="single.scaleY.toFixed(3)"
                     @change="setNumber('scaleY', $event.target.value, 0.02, 64)" /></label>
            <label v-tip="t('props.transform.rotation.tip')">
              <span>{{ t('props.transform.rotation') }}</span>
              <input type="number" step="1" :value="rotationDegrees()"
                     @change="setRotationDegrees($event.target.value)" /></label>
          </div>

          <div class="tx-props-icons">
            <v-btn :icon="icons.rotateLeft" size="x-small" variant="text" density="comfortable"
                   v-tip="t('props.transform.rotate_left.tip')"
                   @click="rotateQuarter(-1)" />
            <v-btn :icon="icons.rotateRight" size="x-small" variant="text" density="comfortable"
                   v-tip="t('props.transform.rotate_right.tip')"
                   @click="rotateQuarter(1)" />
            <span class="tx-props-icons-gap"></span>
            <v-btn :icon="icons.flipX" size="x-small" variant="text" density="comfortable"
                   :color="single.flip && single.flip.x ? 'primary' : ''"
                   v-tip="t('props.transform.flip_x.tip')"
                   @click="flip('x')" />
            <v-btn :icon="icons.flipY" size="x-small" variant="text" density="comfortable"
                   :color="single.flip && single.flip.y ? 'primary' : ''"
                   v-tip="t('props.transform.flip_y.tip')"
                   @click="flip('y')" />
          </div>
          <v-btn size="x-small" variant="text" class="tx-props-btn" :prepend-icon="icons.reset"
                 v-tip="t('props.transform.reset.tip')"
                 @click="resetTransform">{{ t('props.transform.reset') }}</v-btn>
        </PropsGroup>

        ${LENS_GROUP}

        <PropsGroup :title="t('props.local.title')" :open="groups.local" :badge="localBadge"
                    :hint="t('props.local.hint')"
                    @toggle="toggle('local')">
          <p class="tx-props-note" v-if="!mark">
            {{ t('props.local.orphan') }}
          </p>
          <template v-else>
            <div class="tx-props-grid">
              <label v-tip="extendHint('left')"><span>{{ t('props.local.left') }}</span>
                <input type="number" step="5" :value="extend.left"
                       @change="setExtend('left', $event.target.value)" /></label>
              <label v-tip="extendHint('right')"><span>{{ t('props.local.right') }}</span>
                <input type="number" step="5" :value="extend.right"
                       @change="setExtend('right', $event.target.value)" /></label>
              <label v-tip="extendHint('top')"><span>{{ t('props.local.top') }}</span>
                <input type="number" step="5" :value="extend.top"
                       @change="setExtend('top', $event.target.value)" /></label>
              <label v-tip="extendHint('bottom')"><span>{{ t('props.local.bottom') }}</span>
                <input type="number" step="5" :value="extend.bottom"
                       @change="setExtend('bottom', $event.target.value)" /></label>
            </div>
            <p class="tx-props-note" v-tip="t('props.local.bend.tip')">
              {{ t('props.local.bend', { values: bendPercent.join('% / ') }) }}
            </p>
            <v-btn size="x-small" variant="text" class="tx-props-btn" :disabled="isDefaultLocalSpace"
                   :prepend-icon="icons.reset"
                   v-tip="isDefaultLocalSpace ? t('props.local.reset.tip_already') : t('props.local.reset.tip')"
                   @click="resetLocalSpace">{{ t('props.local.reset') }}</v-btn>

            <v-btn size="x-small" variant="text" class="tx-props-btn tx-props-rectify"
                   :prepend-icon="icons.grid" :loading="rectifying"
                   v-tip="t('props.local.rectify.tip')"
                   @click="rectify">{{ t('props.local.rectify') }}</v-btn>
          </template>
        </PropsGroup>

        <PropsGroup v-if="single" :title="t('props.lighting.title')" :open="groups.lighting" :badge="lightingBadge"
                    :hint="t('props.lighting.hint')"
                    @toggle="toggle('lighting')">
          <Histogram :stats="analysis" :reference="original" />

          <v-btn-toggle :model-value="delight.mode" density="compact" variant="outlined"
                        divided mandatory color="primary" class="tx-props-toggle"
                        @update:model-value="setDelight({ mode: $event })">
            <v-btn value="none" size="x-small"
                   v-tip="t('props.lighting.mode.off.tip')">
              {{ t('props.lighting.mode.off') }}</v-btn>
            <v-btn value="gradient" size="x-small"
                   v-tip="t('props.lighting.mode.gradient.tip')">
              {{ t('props.lighting.mode.gradient') }}</v-btn>
            <v-btn value="local" size="x-small"
                   v-tip="t('props.lighting.mode.local.tip')">
              {{ t('props.lighting.mode.local') }}</v-btn>
          </v-btn-toggle>

          <template v-if="delight.mode !== 'none'">
            <label class="tx-props-slider"
                   v-tip="t('props.lighting.amount.tip')">
              <span>{{ t('props.lighting.amount') }}</span>
              <input type="range" min="0" max="100" step="5"
                     :value="Math.round(delight.strength * 100)"
                     @input="setDelight({ strength: Number($event.target.value) / 100 })" />
              <em>{{ Math.round(delight.strength * 100) }}%</em>
            </label>

            <label class="tx-props-slider" v-if="delight.mode === 'local'"
                   v-tip="t('props.lighting.radius.tip')">
              <span>{{ t('props.lighting.radius') }}</span>
              <input type="range" min="2" max="50" step="1" :value="radiusPercent"
                     @input="setDelight({ radius: Number($event.target.value) / 100 })" />
              <em>{{ radiusPercent }}%</em>
            </label>

            <label class="tx-props-slider" v-else
                   v-tip="t('props.lighting.falloff.tip')">
              <span>{{ t('props.lighting.falloff') }}</span>
              <input type="range" min="1" max="3" step="1" :value="delight.order"
                     @input="setDelight({ order: Number($event.target.value) })" />
              <em>{{ t('props.lighting.falloff.' + ['linear', 'curved', 'complex'][delight.order - 1]) }}</em>
            </label>

            <div class="tx-props-sub">{{ t('props.lighting.sub.colour') }}</div>
            <v-switch :model-value="delight.perChannel" :label="t('props.lighting.per_channel')"
                      density="compact" hide-details color="primary" class="tx-props-switch"
                      v-tip="t('props.lighting.per_channel.tip')"
                      @update:model-value="setDelight({ perChannel: $event })" />
            <v-switch :model-value="delight.balance" :label="t('props.lighting.balance')"
                      density="compact" hide-details color="primary" class="tx-props-switch"
                      v-tip="t('props.lighting.balance.tip')"
                      @update:model-value="setDelight({ balance: $event })" />

            <div class="tx-props-sub">{{ t('props.lighting.sub.exposure') }}</div>
            <label class="tx-props-slider"
                   v-tip="t('props.lighting.match_to.tip')">
              <span>{{ t('props.lighting.match_to') }}</span>
              <input type="range" min="0" max="220" step="2" :value="delight.exposure"
                     @input="setDelight({ exposure: Number($event.target.value) })" />
              <em>{{ delight.exposure ? delight.exposure : t('props.lighting.as_shot') }}</em>
            </label>

            <div class="tx-props-sub">{{ t('props.lighting.sub.shading') }}</div>
            <v-btn size="x-small" variant="text" class="tx-props-btn" :prepend-icon="icons.pack"
                   v-tip="t('props.lighting.extract_shading.tip')"
                   @click="extractShading">{{ t('props.lighting.extract_shading') }}</v-btn>
          </template>
        </PropsGroup>

        <PropsGroup v-if="single" :title="t('props.material.title')" :open="groups.material" :badge="materialBadge"
                    :hint="t('props.material.hint')"
                    @toggle="toggle('material')">
          <label class="tx-props-slider"
                 v-tip="material.roughnessAmount > 0 ? t('props.material.roughness.tip_mapped') : t('props.material.roughness.tip')">
            <span>{{ t('props.material.roughness') }}</span>
            <input type="range" min="0" max="100" :value="Math.round(material.roughness * 100)"
                   @input="setMaterial({ roughness: Number($event.target.value) / 100 })" />
            <em>{{ material.roughness.toFixed(2) }}</em>
          </label>
          <label class="tx-props-slider"
                 v-tip="t('props.material.metalness.tip')">
            <span>{{ t('props.material.metalness') }}</span>
            <input type="range" min="0" max="100" :value="Math.round(material.metalness * 100)"
                   @input="setMaterial({ metalness: Number($event.target.value) / 100 })" />
            <em>{{ material.metalness.toFixed(2) }}</em>
          </label>
          <label class="tx-props-slider"
                 v-tip="t('props.material.relief.tip')">
            <span>{{ t('props.material.relief') }}</span>
            <input type="range" min="0" max="200" :value="Math.round(material.normal * 50)"
                   @input="setMaterial({ normal: Number($event.target.value) / 50 })" />
            <em>{{ material.normal.toFixed(2) }}</em>
          </label>
          <label class="tx-props-slider"
                 v-tip="t('props.material.occlusion.tip')">
            <span>{{ t('props.material.occlusion') }}</span>
            <input type="range" min="0" max="100" :value="Math.round(material.occlusion * 100)"
                   @input="setMaterial({ occlusion: Number($event.target.value) / 100 })" />
            <em>{{ material.occlusion.toFixed(2) }}</em>
          </label>

          <div class="tx-props-sub">{{ t('props.material.sub.from_colour') }}</div>
          <div class="tx-pbr-actions">
            <v-btn variant="tonal" size="x-small" class="tx-action"
                   :prepend-icon="icons.layers"
                   v-tip="t('props.material.generate_pbr.tip')"
                   @click="generatePbr">{{ t('props.material.generate_pbr') }}</v-btn>
            <v-btn v-if="fromColour" variant="text" size="x-small" class="tx-action"
                   :prepend-icon="icons.reset"
                   v-tip="t('props.material.clear.tip')"
                   @click="resetMaps">{{ t('props.material.clear') }}</v-btn>
          </div>
          <p class="tx-props-note" v-if="generated">{{ generated }}</p>

          <template v-if="fromColour">
            <label class="tx-props-slider"
                   v-tip="t('props.material.fine_relief.tip')">
              <span>{{ t('props.material.fine_relief') }}</span>
              <input type="range" min="0" max="200"
                     :value="Math.round(material.detailNormal * 100)"
                     @input="setMaterial({ detailNormal: Number($event.target.value) / 100 })" />
              <em>{{ material.detailNormal.toFixed(2) }}</em>
            </label>
            <label class="tx-props-slider"
                   v-tip="t('props.material.roughness_map.tip')">
              <span>{{ t('props.material.roughness_map') }}</span>
              <input type="range" min="0" max="100"
                     :value="Math.round(material.roughnessAmount * 100)"
                     @input="setMaterial({ roughnessAmount: Number($event.target.value) / 100 })" />
              <em>{{ material.roughnessAmount.toFixed(2) }}</em>
            </label>
            <label class="tx-props-slider"
                   v-tip="t('props.material.cavity.tip')">
              <span>{{ t('props.material.cavity') }}</span>
              <input type="range" min="0" max="100" :value="Math.round(material.cavity * 100)"
                     @input="setMaterial({ cavity: Number($event.target.value) / 100 })" />
              <em>{{ material.cavity.toFixed(2) }}</em>
            </label>
          </template>

          <div v-if="channels.length" class="tx-pbr-maps">
            <button v-for="channel in channels" :key="channel.key" type="button"
                    class="tx-pbr-map"
                    :class="{ 'tx-pbr-map--on': shownChannel === channel.mode }"
                    :aria-pressed="shownChannel === channel.mode"
                    v-tip="channel.tip" @click="showChannel(channel)">
              <canvas ref="channel"></canvas>
              <span>{{ channel.label }}</span>
            </button>
          </div>
        </PropsGroup>

        <PropsGroup v-if="single" :title="t('props.tiling.title')" :open="groups.tiling" :badge="tilingBadge"
                    :hint="t('props.tiling.hint')"
                    @toggle="toggle('tiling')">
          <v-btn-toggle :model-value="tiling.mode" density="compact" variant="outlined"
                        divided mandatory color="primary" class="tx-props-toggle"
                        @update:model-value="setMode($event)">
            <v-btn value="none" size="x-small"
                   v-tip="t('props.tiling.mode.off.tip')">
              {{ t('props.tiling.mode.off') }}</v-btn>
            <v-btn value="feather" size="x-small"
                   v-tip="t('props.tiling.mode.auto.tip')">
              {{ t('props.tiling.mode.auto') }}</v-btn>
          </v-btn-toggle>

          <template v-if="tiling.mode === 'feather'">
            <div class="tx-props-sub"
                 v-tip="t('props.tiling.which_edges.tip')">{{ t('props.tiling.which_edges') }}</div>
            <v-btn-toggle :model-value="tilingAxis" density="compact" variant="outlined"
                          divided mandatory color="primary" class="tx-props-toggle"
                          @update:model-value="setAxis($event)">
              <v-btn value="xy" size="x-small"
                     v-tip="t('props.tiling.both.tip')">
                {{ t('props.tiling.both') }}</v-btn>
              <v-btn value="x" size="x-small"
                     v-tip="t('props.tiling.x.tip')">
                {{ t('props.tiling.x') }}</v-btn>
              <v-btn value="y" size="x-small"
                     v-tip="t('props.tiling.y.tip')">
                {{ t('props.tiling.y') }}</v-btn>
            </v-btn-toggle>

            <label class="tx-props-slider"
                   v-tip="t('props.tiling.blend.tip')">
              <span>{{ t('props.tiling.blend') }}</span>
              <input type="range" min="1" max="50" step="1" :value="bandPercent"
                     @input="setBand(Number($event.target.value))" />
              <em>{{ bandPercent }}%</em>
            </label>
          </template>

          <v-btn size="x-small" variant="text" class="tx-props-btn" :prepend-icon="icons.pack"
                 v-tip="t('props.tiling.mirror_2x2.tip')"
                 @click="mirrorDuplicate">{{ t('props.tiling.mirror_2x2') }}</v-btn>
        </PropsGroup>

        <PropsGroup :title="t('props.depth.title')" :open="groups.depth" :badge="depthBadge"
                    :hint="t('props.depth.hint')"
                    @toggle="toggle('depth')">
          <p class="tx-props-note" v-if="!mark">
            {{ t('props.depth.orphan') }}
          </p>
          <p class="tx-props-note" v-else-if="!single && !texturesOfMark">
            {{ t('props.depth.awaiting_extract') }}
          </p>

          <p class="tx-props-note" v-else-if="depthBusy">
            {{ t('props.depth.estimating', { progress: depthProgress }) }}
          </p>

          <template v-else-if="!depthReady">
            <p class="tx-props-note" v-if="!state.settings.ai">{{ t('depth.error.ai_off') }}</p>
            <v-btn v-else size="x-small" variant="text" class="tx-props-btn"
                   :prepend-icon="icons.measure"
                   v-tip="t('props.depth.estimate.tip')"
                   @click="estimateDepth">{{ t('props.depth.estimate') }}</v-btn>
            <p class="tx-props-note" v-if="state.depthError">{{ state.depthError }}</p>
          </template>

          <template v-else>
            <v-switch :model-value="material.useDepth"
                      :label="t('props.depth.use')"
                      density="compact" hide-details color="primary"
                      class="tx-props-switch tx-use-depth"
                      v-tip="t('props.depth.use.tip')"
                      @update:model-value="setMaterial({ useDepth: $event })" />

            <template v-if="material.useDepth">
              <label class="tx-props-slider"
                     v-tip="t('props.depth.bow.tip')">
                <span>{{ t('props.depth.bow') }}</span>
                <input type="range" min="0" max="100" step="1"
                       :value="Math.round(material.bow * 100)"
                       @input="setMaterial({ bow: Number($event.target.value) / 100 })" />
                <em>{{ Math.round(material.bow * 100) }}%</em>
              </label>
              <label class="tx-props-slider"
                     v-tip="t('props.depth.in_normal.tip')">
                <span>{{ t('props.depth.in_normal') }}</span>
                <input type="range" min="0" max="100" step="1"
                       :value="Math.round(material.depthNormal * 100)"
                       @input="setMaterial({ depthNormal: Number($event.target.value) / 100 })" />
                <em>{{ Math.round(material.depthNormal * 100) }}%</em>
              </label>

              <div class="tx-props-sub">{{ t('props.depth.mesh_detail') }}</div>
              <v-btn-toggle :model-value="material.subdivision" density="compact"
                            variant="outlined" divided mandatory color="primary"
                            class="tx-props-toggle"
                            @update:model-value="setMaterial({ subdivision: $event })">
                <v-btn v-for="n in subdivisions" :key="n" :value="n" size="x-small"
                       v-tip="t('props.depth.subdivision.tip', { n })">{{ n }}</v-btn>
              </v-btn-toggle>
            </template>

            <p class="tx-props-note" v-if="single">
              {{ t('props.depth.flatness', { percent: flatPercent }) }}
            </p>
            <p class="tx-props-note" v-else>
              {{ t('props.depth.extract_to_measure') }}
            </p>
          </template>
        </PropsGroup>
      </template>
    </div>
  `,
};
