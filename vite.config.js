import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const BUNDLED = [
  ["vue", "node_modules/vue/LICENSE"],
  ["vuetify", "node_modules/vuetify/LICENSE.md"],
  ["three", "node_modules/three/LICENSE"],
];

// MIT notices must be inlined — the output is a single self-contained file.
function licenseBanner() {
  const notices = BUNDLED.map(([name, path]) => {
    const version = pkg.dependencies[name].replace(/^[^\d]*/, "");
    const text = readFileSync(new URL(path, import.meta.url), "utf8").trim();
    return `${name} ${version}\n${"-".repeat(60)}\n${text}`;
  });

  return [
    `${pkg.name} ${pkg.version}`,
    pkg.description,
    "",
    `Copyright (c) ${new Date().getUTCFullYear()} ${pkg.author}`,
    "Released under the MIT licence. The full text, and the notices for everything",
    "bundled into this file, follow.",
    "",
    readFileSync(new URL("./LICENSE", import.meta.url), "utf8").trim(),
    "",
    "",
    "Bundled third-party software",
    "=".repeat(60),
    "",
    notices.join("\n\n"),
  ].join("\n");
}

const licenseNotice = () => ({
  name: "tx-license-notice",
  enforce: "post",
  transformIndexHtml: {
    order: "post",
    handler: html => `<!--\n${licenseBanner().replace(/--+>/g, "-->")}\n-->\n${html}`,
  },
});

export default defineConfig({
  plugins: [viteSingleFile(), licenseNotice()],
  server: { port: 5173 },
  resolve: {
    alias: {
      // Vue needs the runtime compiler — templates are strings in this app.
      vue: "vue/dist/vue.esm-bundler.js",
    },
  },
  define: {
    __TX_VERSION__: JSON.stringify(pkg.version),
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
  build: {
    target: "es2022",
    emptyOutDir: !process.env.TX_KEEP,
    reportCompressedSize: false,
    rollupOptions: {
      input: process.env.TX_PAGE || "index.html",
    },
  },
});
