import { TX } from "../tx.js";

TX.components = TX.components || {};

const WIDTH = 256;
const HEIGHT = 68;

TX.components.Histogram = {
  props: {
    stats: { type: Object, default: null },
    reference: { type: Object, default: null },
    channels: { type: Boolean, default: true },
  },
  setup() {
    return { i18n: TX.i18n.status };
  },
  data() {
    return {};
  },
  computed: {
    canvasHint() {
      void this.i18n.locale;
      if (this.reference) return this.t("histogram.canvas.tip_with_ref");
      if (this.stats) return this.t("histogram.canvas.tip_no_ref");
      return this.t("histogram.canvas.tip");
    },
  },
  watch: {
    stats: { handler() { this.$nextTick(() => this.draw()); }, deep: false },
    reference: { handler() { this.$nextTick(() => this.draw()); }, deep: false },
    channels() { this.$nextTick(() => this.draw()); },
  },
  mounted() {
    this.stopDisplay = TX.device.onDisplayChange(() => this.draw());
    this.draw();
  },
  beforeUnmount() {
    if (this.stopDisplay) this.stopDisplay();
  },
  methods: {
    // Clip peaks at the 98th percentile so one flat region does not flatten everything else.
    scaleFor(hist) {
      const sorted = Array.from(hist).sort((a, b) => a - b);
      return Math.max(1, sorted[Math.floor(sorted.length * 0.98)] || sorted[sorted.length - 1]);
    },
    plot(ctx, hist, scale, style, fill) {
      ctx.beginPath();
      ctx.moveTo(0, HEIGHT);
      for (let v = 0; v < 256; v++) {
        const h = Math.min(1, hist[v] / scale) ** 0.75 * (HEIGHT - 2);
        ctx.lineTo((v / 255) * WIDTH, HEIGHT - h);
      }
      ctx.lineTo(WIDTH, HEIGHT);
      if (fill) {
        ctx.fillStyle = style;
        ctx.fill();
      } else {
        ctx.closePath();
        ctx.strokeStyle = style;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },
    draw() {
      const canvas = this.$refs.canvas;
      if (!canvas) return;
      const ratio = TX.device.pixelRatio();
      canvas.width = WIDTH * ratio;
      canvas.height = HEIGHT * ratio;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const x = Math.round((WIDTH * i) / 4) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, HEIGHT);
        ctx.stroke();
      }

      if (!this.stats || !this.stats.count) return;

      if (this.reference && this.reference.count) {
        this.plot(ctx, this.reference.hist.l, this.scaleFor(this.reference.hist.l),
          "rgba(255,255,255,0.35)", false);
      }

      if (this.channels) {
        const scale = Math.max(
          this.scaleFor(this.stats.hist.r),
          this.scaleFor(this.stats.hist.g),
          this.scaleFor(this.stats.hist.b),
        );
        ctx.globalCompositeOperation = "lighter";
        this.plot(ctx, this.stats.hist.r, scale, "rgba(255,64,64,0.55)", true);
        this.plot(ctx, this.stats.hist.g, scale, "rgba(64,255,64,0.55)", true);
        this.plot(ctx, this.stats.hist.b, scale, "rgba(64,128,255,0.55)", true);
        ctx.globalCompositeOperation = "source-over";
      } else {
        this.plot(ctx, this.stats.hist.l, this.scaleFor(this.stats.hist.l),
          "rgba(255,255,255,0.5)", true);
      }

      const mean = Math.round((this.stats.mean.l / 255) * WIDTH) + 0.5;
      ctx.strokeStyle = "rgba(79,195,247,0.9)";
      ctx.beginPath();
      ctx.moveTo(mean, 0);
      ctx.lineTo(mean, HEIGHT);
      ctx.stroke();
    },
  },
  template: `
    <div class="tx-hist">
      <canvas ref="canvas" class="tx-hist-canvas" v-tip="canvasHint"
              :style="{ width: 256 + 'px', height: 68 + 'px' }"></canvas>
      <div v-if="stats && stats.count" class="tx-hist-legend">
        <span v-tip="t('histogram.mean.tip')">
          {{ t('histogram.mean', { value: Math.round(stats.mean.l) }) }}</span>
        <span v-tip="t('histogram.spread.tip')">
          {{ t('histogram.spread', { value: Math.round(stats.contrast) }) }}</span>
        <span v-tip="t('histogram.range.tip')">
          {{ t('histogram.range', { min: stats.range[0], max: stats.range[1] }) }}</span>
        <span v-if="stats.clipped.high > 0.005" class="tx-hist-warn"
              v-tip="t('histogram.blown.tip')">
          {{ t('histogram.blown', { percent: Math.round(stats.clipped.high * 100) }) }}
        </span>
        <span v-if="stats.cast > 0.08" class="tx-hist-warn"
              v-tip="t('histogram.cast.tip')">
          {{ t('histogram.cast', { percent: Math.round(stats.cast * 100) }) }}
        </span>
      </div>
    </div>
  `,
};
