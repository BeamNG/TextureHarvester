import { TX } from "../tx.js";

TX.components = TX.components || {};

TX.components.PropsGroup = {
  props: {
    title: { type: String, required: true },
    open: { type: Boolean, default: false },
    badge: { type: String, default: "" },
    hint: { type: String, default: "" },
  },
  emits: ["toggle"],
  setup() {
    return { i18n: TX.i18n.status };
  },
  computed: {
    tip() {
      void this.i18n.locale;
      const state = this.badge
        ? this.t("props_group.currently", { badge: this.badge }) : "";
      const action = this.open ? this.t("props_group.fold") : this.t("props_group.open");
      return `${this.hint || this.title}.${state} ${action}`;
    },
  },
  template: `
    <section class="tx-group" :class="{ 'tx-group-on': open }">
      <button type="button" class="tx-group-head" :aria-expanded="open ? 'true' : 'false'"
              v-tip="tip" @click="$emit('toggle')">
        <svg class="tx-group-caret" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6l6 6-6 6z" fill="currentColor" />
        </svg>
        <span class="tx-group-title">{{ title }}</span>
        <em v-if="badge" class="tx-group-badge">{{ badge }}</em>
      </button>
      <div v-if="open" class="tx-group-body"><slot /></div>
    </section>
  `,
};
