import { TX } from "../tx.js";

TX.components = TX.components || {};

TX.components.ContextMenu = {
  props: {
    modelValue: { type: Boolean, default: false },
    position: { type: Array, default: () => [0, 0] },
    items: { type: Array, default: () => [] },
  },
  emits: ["update:modelValue"],
  methods: {
    run(item) {
      this.$emit("update:modelValue", false);
      if (item.action) item.action();
    },
  },
  template: `
    <v-menu :model-value="modelValue" :target="position" :close-on-content-click="true"
            @update:model-value="$emit('update:modelValue', $event)">
      <v-list density="compact" min-width="200">
        <template v-for="(item, index) in items" :key="index">
          <v-divider v-if="item.divider" class="my-1" />
          <v-list-item v-else :disabled="!!item.disabled" @click="run(item)">
            <template #prepend v-if="item.icon">
              <v-icon :icon="item.icon" size="16" />
            </template>
            <v-list-item-title>{{ item.title }}</v-list-item-title>
            <template #append v-if="item.hint">
              <span class="tx-menu-hint">{{ item.hint }}</span>
            </template>
          </v-list-item>
        </template>
      </v-list>
    </v-menu>
  `,
};

// [groupTitleKey, [[actionKey, keysKey], ...]]
const HELP_GROUPS = [
  ["help.group.history", [
    ["help.history.undo", "help.history.undo.keys"],
    ["help.history.redo", "help.history.redo.keys"],
  ]],
  ["help.group.navigation", [
    ["help.nav.pan", "help.nav.pan.keys"],
    ["help.nav.zoom", "help.nav.zoom.keys"],
    ["help.nav.fit", "help.nav.fit.keys"],
    ["help.nav.marquee", "help.nav.marquee.keys"],
    ["help.nav.toggle_one", "help.nav.toggle_one.keys"],
    ["help.nav.select_all", "help.nav.select_all.keys"],
    ["help.nav.delete", "help.nav.delete.keys"],
    ["help.nav.deselect", "help.nav.deselect.keys"],
    ["help.nav.context", "help.nav.context.keys"],
  ]],
  ["help.group.panels", [
    ["help.panels.move", "help.panels.move.keys"],
    ["help.panels.combine", "help.panels.combine.keys"],
    ["help.panels.split", "help.panels.split.keys"],
    ["help.panels.dock", "help.panels.dock.keys"],
    ["help.panels.float", "help.panels.float.keys"],
    ["help.panels.resize", "help.panels.resize.keys"],
    ["help.panels.maximise", "help.panels.maximise.keys"],
    ["help.panels.show_hide", "help.panels.show_hide.keys"],
  ]],
  ["help.group.mark", [
    ["help.mark.import", "help.mark.import.keys"],
    ["help.mark.add_point", "help.mark.add_point.keys"],
    ["help.mark.mark_edge", "help.mark.mark_edge.keys"],
    ["help.mark.abandon", "help.mark.abandon.keys"],
    ["help.mark.select", "help.mark.select.keys"],
    ["help.mark.rectify", "help.mark.rectify.keys"],
    ["help.mark.move", "help.mark.move.keys"],
    ["help.mark.delete", "help.mark.delete.keys"],
    ["help.mark.move_point", "help.mark.move_point.keys"],
    ["help.mark.precision", "help.mark.precision.keys"],
    ["help.mark.weld", "help.mark.weld.keys"],
    ["help.mark.bow", "help.mark.bow.keys"],
    ["help.mark.s_curve", "help.mark.s_curve.keys"],
    ["help.mark.lens", "help.mark.lens.keys"],
    ["help.mark.remove", "help.mark.remove.keys"],
    ["help.mark.rewarp", "help.mark.rewarp.keys"],
  ]],
  ["help.group.atlas", [
    ["help.atlas.move", "help.atlas.move.keys"],
    ["help.atlas.resize", "help.atlas.resize.keys"],
    ["help.atlas.resize_proportional", "help.atlas.resize_proportional.keys"],
    ["help.atlas.rotate", "help.atlas.rotate.keys"],
    ["help.atlas.rotate_15", "help.atlas.rotate_15.keys"],
    ["help.atlas.rotate_90", "help.atlas.rotate_90.keys"],
    ["help.atlas.rotate_5", "help.atlas.rotate_5.keys"],
    ["help.atlas.flip_x", "help.atlas.flip_x.keys"],
    ["help.atlas.flip_y", "help.atlas.flip_y.keys"],
    ["help.atlas.copy", "help.atlas.copy.keys"],
    ["help.atlas.duplicate", "help.atlas.duplicate.keys"],
    ["help.atlas.flatten", "help.atlas.flatten.keys"],
    ["help.atlas.export_png", "help.atlas.export_png.keys"],
    ["help.atlas.export_individually", "help.atlas.export_individually.keys"],
    ["help.atlas.export_glb", "help.atlas.export_glb.keys"],
  ]],
  ["help.group.preview3d", [
    ["help.preview3d.orbit", "help.preview3d.orbit.keys"],
    ["help.preview3d.zoom", "help.preview3d.zoom.keys"],
    ["help.preview3d.pan", "help.preview3d.pan.keys"],
    ["help.preview3d.reframe", "help.preview3d.reframe.keys"],
    ["help.preview3d.shape", "help.preview3d.shape.keys"],
    ["help.preview3d.material", "help.preview3d.material.keys"],
    ["help.preview3d.generate_pbr", "help.preview3d.generate_pbr.keys"],
    ["help.preview3d.inspect_map", "help.preview3d.inspect_map.keys"],
    ["help.preview3d.export", "help.preview3d.export.keys"],
  ]],
  ["help.group.local_space", [
    ["help.local.extend", "help.local.extend.keys"],
    ["help.local.slide", "help.local.slide.keys"],
    ["help.local.type", "help.local.type.keys"],
    ["help.local.grid", "help.local.grid.keys"],
    ["help.local.reset", "help.local.reset.keys"],
  ]],
  ["help.group.lighting", [
    ["help.lighting.flatten", "help.lighting.flatten.keys"],
    ["help.lighting.estimator", "help.lighting.estimator.keys"],
    ["help.lighting.cast", "help.lighting.cast.keys"],
    ["help.lighting.match", "help.lighting.match.keys"],
    ["help.lighting.shading", "help.lighting.shading.keys"],
  ]],
  ["help.group.tiling", [
    ["help.tiling.seamless", "help.tiling.seamless.keys"],
    ["help.tiling.edges", "help.tiling.edges.keys"],
    ["help.tiling.blend", "help.tiling.blend.keys"],
    ["help.tiling.preview_toolbar", "help.tiling.preview_toolbar.keys"],
    ["help.tiling.pan_zoom", "help.tiling.pan_zoom.keys"],
  ]],
  ["help.group.everywhere", [
    ["help.everywhere.hover", "help.everywhere.hover.keys"],
    ["help.everywhere.status", "help.everywhere.status.keys"],
    ["help.everywhere.problems", "help.everywhere.problems.keys"],
    ["help.everywhere.selection", "help.everywhere.selection.keys"],
    ["help.everywhere.settings", "help.everywhere.settings.keys"],
    ["help.everywhere.measure", "help.everywhere.measure.keys"],
    ["help.everywhere.this_list", "help.everywhere.this_list.keys"],
  ]],
];

TX.components.ShortcutsDialog = {
  props: { modelValue: { type: Boolean, default: false } },
  emits: ["update:modelValue"],
  setup() {
    return {
      version: TX.version,
      bundled: ["Vue", "Vuetify", "three.js"],
      i18n: TX.i18n.status,
    };
  },
  computed: {
    groups() {
      void this.i18n.locale;
      return HELP_GROUPS.map(([titleKey, rows]) => ({
        title: this.t(titleKey),
        rows: rows.map(([action, keys]) => [this.t(action), this.t(keys)]),
      }));
    },
    licenceBody() {
      void this.i18n.locale;
      return this.t("help.licence.body", {
        version: this.version,
        bundled: this.bundled.join(", "),
      });
    },
  },
  template: `
    <v-dialog :model-value="modelValue" max-width="620"
              @update:model-value="$emit('update:modelValue', $event)">
      <v-card>
        <v-card-title class="text-body-1">
          {{ t('help.title') }}
          <span class="tx-help-version">{{ t('help.product', { version }) }}</span>
        </v-card-title>
        <v-card-text>
          <div v-for="group in groups" :key="group.title" class="tx-help-group">
            <div class="tx-help-title">{{ group.title }}</div>
            <div v-for="row in group.rows" :key="row[0]" class="tx-help-row">
              <span>{{ row[0] }}</span><kbd>{{ row[1] }}</kbd>
            </div>
          </div>

          <div class="tx-help-group">
            <div class="tx-help-title">{{ t('help.licence.title') }}</div>
            <p class="tx-help-note">{{ licenceBody }}</p>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" v-tip="t('help.close.tip')"
                 @click="$emit('update:modelValue', false)">{{ t('help.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  `,
};
