import { createApp } from "vue";
import { createVuetify } from "vuetify";
import "vuetify/styles";

// String templates: Vuetify tags are not statically visible, so components are listed explicitly.
import {
  VApp,
  VBtn,
  VBtnToggle,
  VCard,
  VCardActions,
  VCardText,
  VCardTitle,
  VChip,
  VDialog,
  VDivider,
  VIcon,
  VList,
  VListItem,
  VListItemTitle,
  VListSubheader,
  VMenu,
  VSelect,
  VSnackbar,
  VSpacer,
  VSwitch,
} from "vuetify/components";

import { TX } from "./tx.js";

import "./core.js";
import "./components/icons.js";
import "./components/tooltip.js";
import "./components/toolbar.js";
import "./components/settings-menu.js";
import "./components/footer.js";
import "./components/context-menu.js";
import "./components/intro.js";
import "./components/dock.js";
import "./components/histogram.js";
import "./components/progress.js";
import "./components/props-group.js";
import "./components/properties.js";
import "./components/measure.js";
import "./components/atlas-bar.js";
import "./components/tiling-bar.js";
import "./components/preview3d.js";
import "./components/app.js";

// Unlayered styles outrank Vuetify's cascade layers.
import "./app.css";

const vuetify = createVuetify({
  components: {
    VApp,
    VBtn,
    VBtnToggle,
    VCard,
    VCardActions,
    VCardText,
    VCardTitle,
    VChip,
    VDialog,
    VDivider,
    VIcon,
    VList,
    VListItem,
    VListItemTitle,
    VListSubheader,
    VMenu,
    VSelect,
    VSnackbar,
    VSpacer,
    VSwitch,
  },
  icons: {
    defaultSet: "svg",
    aliases: TX.icons.aliases,
  },
  defaults: {
    global: { ripple: false },
    VBtn: { rounded: "md" },
  },
  theme: {
    defaultTheme: "txDark",
    themes: {
      txDark: {
        dark: true,
        colors: {
          background: "#141518",
          surface: "#1b1d21",
          "surface-bright": "#24272c",
          primary: "#4fc3f7",
          secondary: "#66bb6a",
          success: "#66bb6a",
          warning: "#ffb300",
          error: "#ef5350",
          info: "#4fc3f7",
        },
      },
    },
  },
});

const app = createApp(TX.components.App);
app.use(vuetify);
app.config.globalProperties.t = (...args) => TX.t(...args);
app.directive("tip", TX.tooltip.directive);
app.component("DockNode", TX.components.DockNode);
TX.vuetify = vuetify;
TX.app = app.mount("#app");
