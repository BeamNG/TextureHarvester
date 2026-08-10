import { TX } from "../tx.js";

TX.components = TX.components || {};

const hint = (keys, label) => ({ keys, label });

const SELECTED_NOUNS = {
  texture: ["status.usage.textures_one", "status.usage.textures_other"],
  image: ["status.usage.images_one", "status.usage.images_other"],
  mark: ["status.hint.mark.n_selected_one", "status.hint.mark.n_selected_other"],
};

function megabytes(bytes) {
  if (!(bytes > 0)) return TX.t("status.usage.zero_mb");
  const mb = bytes / (1024 * 1024);
  if (mb < 1) {
    return TX.t("status.usage.kb", { n: Math.max(1, Math.round(bytes / 1024)) });
  }
  return TX.t("status.usage.mb", { n: mb < 10 ? mb.toFixed(1) : Math.round(mb) });
}

function markHints(stats) {
  const touch = TX.device.touch;
  const placeKey = touch ? "status.hint.keys.long_press" : "status.hint.keys.ctrl_click";
  const placeNext = touch ? "status.hint.keys.tap" : "status.hint.keys.ctrl_click";
  const edgeKey = touch ? "status.hint.keys.long_press" : "status.hint.keys.ctrl_drag";
  if (!stats.images) {
    if (touch) {
      return [hint(TX.t("status.hint.keys.drop"), TX.t("status.hint.mark.drop"))];
    }
    return [
      hint(TX.t("status.hint.keys.shift_a"), TX.t("status.hint.mark.import_images")),
      hint(TX.t("status.hint.keys.drop"), TX.t("status.hint.mark.drop")),
    ];
  }
  if (stats.pending) {
    const list = [
      hint(TX.t("status.hint.mark.points_frac", { pending: stats.pending }),
        TX.t("status.hint.mark.points_placed")),
      hint(TX.t(placeNext), TX.t("status.hint.mark.place_next")),
    ];
    if (!touch) {
      list.push(hint(TX.t("status.hint.keys.right_click"), TX.t("status.hint.mark.abandon")));
    }
    return list;
  }
  if (stats.kind === "mark") {
    const marks = stats.selected;
    if (touch) {
      return [
        hint(TX.t(marks === 1 ? "status.hint.mark.n_selected_one" : "status.hint.mark.n_selected_other",
          { count: marks }), TX.t("status.hint.mark.selected")),
        hint(TX.t("status.hint.keys.drag"), TX.t("status.hint.mark.move")),
        hint(TX.t("status.hint.keys.handles"), TX.t("status.hint.mark.handles")),
      ];
    }
    return [
      hint(TX.t(marks === 1 ? "status.hint.mark.n_selected_one" : "status.hint.mark.n_selected_other",
        { count: marks }), TX.t("status.hint.mark.selected")),
      hint(TX.t("status.hint.keys.drag"), TX.t("status.hint.mark.move")),
      hint(TX.t("status.hint.keys.handles"), TX.t("status.hint.mark.handles")),
      hint(TX.t("status.hint.keys.shift_drag"), TX.t("status.hint.mark.precision")),
      hint(TX.t("status.hint.keys.del"), TX.t("status.hint.mark.remove")),
      hint(TX.t("status.hint.keys.esc"), TX.t("status.hint.mark.deselect")),
    ];
  }
  const hints = [
    hint(TX.t(placeKey), TX.t("status.hint.mark.place_corner")),
    hint(TX.t(edgeKey), TX.t("status.hint.mark.mark_edge")),
  ];
  if (touch) {
    hints.push(hint(TX.t("status.hint.keys.pinch"), TX.t("status.hint.tiling.zoom")));
    if (stats.marks) {
      hints.push(hint(TX.t("status.hint.keys.tap"), TX.t("status.hint.mark.select")));
    }
    return hints;
  }
  if (stats.marks) {
    hints.push(
      hint(TX.t("status.hint.keys.click"), TX.t("status.hint.mark.select")),
      hint(TX.t("status.hint.keys.shift_drag"), TX.t("status.hint.mark.precision")),
      hint(TX.t("status.hint.keys.alt_click"), TX.t("status.hint.mark.remove_one")));
  }
  return hints;
}

function atlasHints(stats) {
  const touch = TX.device.touch;
  if (!stats.textures) {
    return [hint(
      TX.t(touch ? "status.hint.keys.long_press" : "status.hint.keys.ctrl_click"),
      TX.t("status.hint.atlas.mark_in_source"),
    )];
  }
  if (!stats.selectedTextures) {
    if (touch) {
      return [hint(TX.t("status.hint.keys.tap"), TX.t("status.hint.atlas.select"))];
    }
    return [
      hint(TX.t("status.hint.keys.click"), TX.t("status.hint.atlas.select")),
      hint(TX.t("status.hint.keys.shift_drag"), TX.t("status.hint.atlas.marquee")),
      hint(TX.t("status.hint.keys.ctrl_a"), TX.t("status.hint.atlas.select_all")),
      hint(TX.t("status.hint.keys.ctrl_e"), TX.t("status.hint.atlas.export")),
    ];
  }
  if (touch) {
    return [
      hint(TX.t("status.hint.keys.drag"), TX.t("status.hint.atlas.move")),
    ];
  }
  return [
    hint(TX.t("status.hint.keys.drag"), TX.t("status.hint.atlas.move")),
    hint(TX.t("status.hint.keys.arrows"), TX.t("status.hint.atlas.rotate")),
    hint(TX.t("status.hint.keys.shift_xy"), TX.t("status.hint.atlas.flip")),
    hint(TX.t("status.hint.keys.l"), TX.t("status.hint.atlas.flatten")),
    hint(TX.t("status.hint.keys.d"), TX.t("status.hint.atlas.duplicate")),
    hint(TX.t("status.hint.keys.del"), TX.t("status.hint.atlas.remove")),
    hint(TX.t("status.hint.keys.ctrl_g"), TX.t("status.hint.atlas.export_model")),
  ];
}

function tilingHints(stats) {
  const touch = TX.device.touch;
  if (stats.selectedTextures !== 1) {
    return [hint(
      TX.t(touch ? "status.hint.keys.tap" : "status.hint.keys.click"),
      TX.t("status.hint.tiling.select_one"),
    )];
  }
  if (touch) {
    return [
      hint(TX.t("status.hint.keys.drag"), TX.t("status.hint.tiling.pan")),
      hint(TX.t("status.hint.keys.pinch"), TX.t("status.hint.tiling.zoom")),
    ];
  }
  return [
    hint(TX.t("status.hint.keys.drag"), TX.t("status.hint.tiling.pan")),
    hint(TX.t("status.hint.keys.scroll"), TX.t("status.hint.tiling.zoom")),
    hint(TX.t("status.hint.keys.double_click"), TX.t("status.hint.tiling.fit")),
    hint(TX.t("status.hint.keys.toolbar_above"), TX.t("status.hint.tiling.toolbar")),
  ];
}

function preview3dHints(stats) {
  const touch = TX.device.touch;
  if (stats.selectedTextures !== 1 && stats.kind !== "image") {
    return [hint(
      TX.t(touch ? "status.hint.keys.tap" : "status.hint.keys.click"),
      TX.t("status.hint.preview3d.select_one"),
    )];
  }
  if (touch) {
    return [
      hint(TX.t("status.hint.keys.drag"), TX.t("status.hint.preview3d.orbit")),
      hint(TX.t("status.hint.keys.pinch"), TX.t("status.hint.preview3d.zoom")),
      hint(TX.t("status.hint.keys.two_fingers"), TX.t("status.hint.preview3d.pan")),
    ];
  }
  return [
    hint(TX.t("status.hint.keys.drag"), TX.t("status.hint.preview3d.orbit")),
    hint(TX.t("status.hint.keys.scroll"), TX.t("status.hint.preview3d.zoom")),
    hint(TX.t("status.hint.keys.right_drag"), TX.t("status.hint.preview3d.pan")),
    hint(TX.t("status.hint.keys.ctrl_g"), TX.t("status.hint.preview3d.export_glb")),
  ];
}

function propertiesHints(stats) {
  const touch = TX.device.touch;
  if (stats.kind === "mark" && stats.selected === 1) {
    const list = [
      hint(TX.t("status.hint.keys.editing"), TX.t("status.hint.properties.editing_mark")),
      hint(TX.t("status.hint.keys.handles"), TX.t("status.hint.properties.handles")),
    ];
    if (!touch) list.push(hint(TX.t("status.hint.keys.ctrl_z"), TX.t("status.hint.properties.undo")));
    return list;
  }
  if (stats.kind === "image" && stats.selected === 1) {
    return [
      hint(TX.t("status.hint.keys.editing"), TX.t("status.hint.properties.editing_photo")),
      hint(TX.t("status.hint.keys.depth"), TX.t("status.hint.properties.depth")),
    ];
  }
  if (stats.selectedTextures === 1) {
    if (touch) return [];
    return [
      hint(TX.t("status.hint.keys.ctrl_z"), TX.t("status.hint.properties.undo")),
      hint(TX.t("status.hint.keys.alt_drag"), TX.t("status.hint.properties.local_space")),
    ];
  }
  return [hint(
    TX.t(touch ? "status.hint.keys.tap" : "status.hint.keys.click"),
    TX.t("status.hint.properties.select"),
  )];
}

const PANEL_HINTS = {
  mark: markHints,
  atlas: atlasHints,
  tiling: tilingHints,
  preview3d: preview3dHints,
  properties: propertiesHints,
};

TX.components.StatusBar = {
  props: {
    storageKind: { type: String, default: "" },
    stats: { type: Object, required: true },
    activePanel: { type: String, default: "mark" },
    panelTitle: { type: String, default: "" },
  },
  emits: ["reveal"],
  setup() {
    return {
      icons: TX.icons.app,
      state: TX.store.state,
      i18n: TX.i18n.status,
      device: TX.device.status,
    };
  },
  data() {
    return { problemsOpen: false };
  },
  methods: {
    reveal(entry) {
      if (!entry.textureIds.length) return;
      this.problemsOpen = false;
      this.$emit("reveal", entry);
    },
  },
  computed: {
    problems() {
      const epoch = this.state.pixelEpoch;
      void this.i18n.locale;
      return TX.problems.inspect(this.state, epoch);
    },
    problemColor() {
      const { errors, warnings } = TX.problems.countOf(this.problems);
      if (errors) return "error";
      return warnings ? "warning" : "success";
    },
    problemLabel() {
      void this.i18n.locale;
      const { errors, warnings } = TX.problems.countOf(this.problems);
      if (!errors && !warnings) return this.t("status.problems.none");
      const parts = [];
      if (errors) {
        parts.push(this.t(errors === 1 ? "status.problems.count_one" : "status.problems.count_other",
          { count: errors }));
      }
      if (warnings) {
        parts.push(this.t(warnings === 1
          ? "status.problems.warnings_one" : "status.problems.warnings_other",
          { count: warnings }));
      }
      return parts.join(", ");
    },
    problemHint() {
      void this.i18n.locale;
      if (!this.problems.length) return this.t("status.problems.hint_clean");
      return this.t("status.problems.hint_list", { label: this.problemLabel });
    },
    hints() {
      void this.i18n.locale;
      void this.device.touch;
      void this.device.compact;
      const build = PANEL_HINTS[this.activePanel] || PANEL_HINTS.mark;
      const list = build(this.stats);
      return this.device.compact ? list.slice(0, 2) : list;
    },
    storageWarning() {
      void this.i18n.locale;
      if (this.storageKind === "memory") return this.t("status.storage.memory");
      // file:// normally uses localStorage — that is not a degraded fallback to announce.
      if (this.storageKind === "localstorage" && location.protocol !== "file:") {
        return this.t("status.storage.localstorage");
      }
      return "";
    },
    storageColor() {
      return this.storageKind === "memory" ? "warning" : "info";
    },
    storageHint() {
      void this.i18n.locale;
      if (this.storageKind === "memory") return this.t("status.storage.memory.tip");
      return this.t("status.storage.localstorage.tip");
    },

    usage() {
      const epoch = this.state.pixelEpoch;
      return TX.store.usage(epoch);
    },
    counts() {
      void this.i18n.locale;
      const u = this.usage;
      const maps = u.textures.maps
        ? this.t("status.usage.maps", { count: u.textures.maps }) : "";
      return {
        images: this.t(u.images.count === 1
          ? "status.usage.images_one" : "status.usage.images_other",
          { count: u.images.count }),
        imageBytes: megabytes(u.images.bytes),
        regions: this.t(u.marks.count === 1
          ? "status.usage.regions_one" : "status.usage.regions_other",
          { count: u.marks.count }),
        textures: this.t(u.textures.count === 1
          ? "status.usage.textures_one" : "status.usage.textures_other",
          { count: u.textures.count }) + maps,
        textureBytes: megabytes(u.textures.bytes),
      };
    },
    statsHint() {
      void this.i18n.locale;
      const u = this.usage;
      const count = this.stats.selected;
      const nouns = SELECTED_NOUNS[this.stats.kind];
      const parts = [count && nouns
        ? this.t(count === 1 ? "status.stats.selected_one" : "status.stats.selected_other",
          { what: this.t(nouns[count === 1 ? 0 : 1], { count }) })
        : this.t("status.stats.nothing_selected")];
      if (this.stats.dirty) {
        parts.push(this.t(this.stats.dirty === 1
          ? "status.stats.dirty_one" : "status.stats.dirty_other",
          { count: this.stats.dirty }));
      }
      const maps = u.textures.maps
        ? this.t(u.textures.maps === 1
          ? "status.stats.maps_one" : "status.stats.maps_other",
          { count: u.textures.maps })
        : "";
      return this.t("status.stats.hint", {
        bytes: megabytes(u.bytes),
        maps,
        parts: parts.join(", "),
      });
    },
  },
  template: `
    <div class="tx-footer">
      <span class="tx-status-panel" v-tip="t('status.panel.tip')">
        {{ panelTitle }}
      </span>

      <div class="tx-status-hints" v-tip="t('status.hints.tip')">
        <span v-for="h in hints" :key="h.keys + h.label" class="tx-status-hint">
          <kbd>{{ h.keys }}</kbd>{{ h.label }}
        </span>
      </div>

      <span class="tx-stats" v-tip="statsHint">
        <span>{{ counts.images }}</span><em>{{ counts.imageBytes }}</em>
        <span>{{ counts.regions }}</span>
        <span>{{ counts.textures }}</span><em>{{ counts.textureBytes }}</em>
      </span>

      <v-menu v-model="problemsOpen" location="top end" :close-on-content-click="false">
        <template #activator="{ props }">
          <v-chip v-bind="props" size="x-small" variant="tonal" :color="problemColor"
                  class="tx-problems" :class="{ 'tx-problems--clean': !problems.length }"
                  v-tip="problemHint">
            <v-icon :icon="problems.length ? icons.warning : icons.check" size="13"
                    class="mr-1" />{{ problemLabel }}
          </v-chip>
        </template>

        <div class="tx-problem-list">
          <p v-if="!problems.length" class="tx-problem-empty">
            {{ t('status.problems.empty') }}
          </p>
          <button v-for="p in problems" :key="p.key" type="button" class="tx-problem"
                  :class="'tx-problem--' + p.severity"
                  v-tip="p.textureIds.length ? t('status.problems.reveal.tip')
                                             : t('status.problems.reveal.tip_none')"
                  @click="reveal(p)">
            <v-icon :icon="icons.warning" size="14" />
            <span>
              <strong>{{ p.title }}</strong>
              <em>{{ p.detail }}</em>
            </span>
          </button>
        </div>
      </v-menu>

      <v-chip v-if="storageWarning" size="x-small" variant="tonal" :color="storageColor"
              class="tx-storage" v-tip="storageHint">
        {{ storageWarning }}
      </v-chip>
    </div>
  `,
};
