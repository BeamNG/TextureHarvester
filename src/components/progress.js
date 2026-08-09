import { TX } from "../tx.js";

TX.components = TX.components || {};

// Hand-written, not v-overlay: must appear during synchronous work.
TX.components.Progress = {
  setup() {
    return { progress: TX.progress.state };
  },
  computed: {
    percent() {
      return this.progress.value == null ? null : Math.round(this.progress.value * 100);
    },
  },
  template: `
    <div v-if="progress.active" class="tx-progress"
         :class="{ 'tx-progress--shown': progress.visible }"
         role="alertdialog" aria-modal="true"
         aria-busy="true" :aria-label="progress.title">
      <div class="tx-progress-card" v-if="progress.visible">
        <div class="tx-progress-title">{{ progress.title }}</div>
        <div class="tx-progress-track"
             role="progressbar" aria-valuemin="0" aria-valuemax="100"
             :aria-valuenow="percent == null ? undefined : percent">
          <div class="tx-progress-fill"
               :class="{ 'tx-progress-fill--waiting': percent == null }"
               :style="percent == null ? null : { width: percent + '%' }" />
        </div>
        <div class="tx-progress-line">
          <span class="tx-progress-detail" aria-live="polite">{{ progress.detail || '&nbsp;' }}</span>
          <span class="tx-progress-percent" v-if="percent != null">{{ percent }}%</span>
        </div>
      </div>
    </div>
  `,
};
