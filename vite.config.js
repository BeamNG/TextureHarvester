import { readFileSync, createReadStream, existsSync, cpSync } from "node:fs";
import { join, normalize, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const examplesDir = join(root, "examples");

const BUNDLED = [
  ["vue", "node_modules/vue/LICENSE"],
  ["vuetify", "node_modules/vuetify/LICENSE.md"],
  ["three", "node_modules/three/LICENSE"],
];

// MIT notices must be inlined — the output is a single self-contained file.
function licenseBanner() {
  const notices = BUNDLED.map(([name, path]) => {
    const version = pkg.dependencies[name].replace(/^[^\d]*/, "");
    const text = readFileSync(join(root, path), "utf8").trim();
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
    readFileSync(join(root, "LICENSE"), "utf8").trim(),
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

// Example photos stay outside the single HTML; serve them in dev and copy into dist/.
function examplesStatic() {
  return {
    name: "tx-examples",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith("/examples/")) return next();
        const rel = decodeURIComponent(req.url.slice("/examples/".length).split("?")[0]);
        if (!rel || rel.includes("..") || rel.includes("/") || rel.includes("\\")) return next();
        const file = normalize(join(examplesDir, rel));
        if (!file.startsWith(examplesDir + sep) || !existsSync(file)) return next();
        res.setHeader("Content-Type", "image/jpeg");
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(output) {
      if (!existsSync(examplesDir)) return;
      cpSync(examplesDir, join(output.dir || join(root, "dist"), "examples"), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [viteSingleFile(), licenseNotice(), examplesStatic()],
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
