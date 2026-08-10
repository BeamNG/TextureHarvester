/**
 * Capture README feature stills/GIFs from a built dist/.
 * Usage: node build.mjs && node scripts/capture-readme.mjs
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const assets = join(root, "assets");
const tmp = join(root, "assets", "_capture");
const example = join(root, "examples", "sign-coffee-shop.jpg");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/index.html";
    const file = join(dist, path.replace(/^\//, ""));
    if (!file.startsWith(dist) || !existsSync(file)) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

function ffmpegGif(framesGlob, outPath, fps = 10) {
  const palette = join(tmp, "palette.png");
  const common = ["-y", "-framerate", String(fps), "-i", framesGlob];
  let r = spawnSync("ffmpeg", [...common, "-vf", "scale=960:-1:flags=lanczos,palettegen=stats_mode=diff", palette], {
    encoding: "utf8",
  });
  if (r.status) throw new Error(r.stderr || "palettegen failed");
  r = spawnSync("ffmpeg", [
    ...common, "-i", palette,
    "-lavfi", "scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3",
    "-loop", "0", outPath,
  ], { encoding: "utf8" });
  if (r.status) throw new Error(r.stderr || "gif encode failed");
}

function ffmpegCrossfade(a, b, outPath, hold = 1.1) {
  const r = spawnSync("ffmpeg", [
    "-y", "-loop", "1", "-t", String(hold), "-i", a,
    "-loop", "1", "-t", String(hold), "-i", b,
    "-filter_complex",
    `[0][1]xfade=transition=fade:duration=0.45:offset=${(hold - 0.45).toFixed(2)},scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
    "-loop", "0", outPath,
  ], { encoding: "utf8" });
  if (r.status) throw new Error(r.stderr || "crossfade failed");
}

async function waitApp(page) {
  await page.waitForFunction(() => window.TX && TX.app && TX.app.dockState && TX.app.mark && TX.app.actions, null, {
    timeout: 30000,
  });
  await page.evaluate(async () => {
    const app = TX.app;
    if (app.introOpen) {
      app.introOpen = false;
      TX.intro.saveSeen();
    }
    TX.store.state.settings.autoPbr = false;
    await new Promise(r => setTimeout(r, 80));
  });
}

async function loadExample(page) {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(example);
  await page.waitForFunction(() => TX.store.state.images.length > 0, null, { timeout: 20000 });
  await page.evaluate(async () => {
    TX.app.mark.fitAll();
    await new Promise(r => setTimeout(r, 120));
  });
}

async function markAndExtract(page) {
  await page.evaluate(async () => {
    const image = TX.store.state.images[0];
    const w = image.width;
    const h = image.height;
    // Coffee sign roughly centre — inset so we stay on the board.
    const points = [
      { x: w * 0.22, y: h * 0.18 },
      { x: w * 0.78, y: h * 0.20 },
      { x: w * 0.76, y: h * 0.78 },
      { x: w * 0.24, y: h * 0.76 },
    ];
    const mark = TX.store.addMark(image.id, points);
    TX.app.mark.syncMeshes();
    TX.app.mark.revealMark(mark.id);
    await TX.app.actions.convert("all");
    await new Promise(r => setTimeout(r, 200));
    if (TX.app.atlas) TX.app.atlas.fitSelection();
  });
  await page.waitForFunction(() => TX.store.state.textures.length > 0, null, { timeout: 60000 });
}

async function shot(page, name, clip) {
  const path = join(tmp, `${name}.png`);
  await page.evaluate(() => {
    for (const stage of [TX.app.mark?.stage, TX.app.atlas?.stage, TX.app.tilingPanel?.stage]) {
      if (stage) {
        stage.requestRender();
        stage.renderNow();
      }
    }
  });
  await page.waitForTimeout(80);
  await page.screenshot({ path, clip, type: "png" });
  return path;
}

async function panelClip(page, panelId) {
  return page.evaluate(id => {
    const el = document.querySelector(`[data-dock-slot="${id}"]`)
      || document.querySelector(`[data-dock-tab="${id}"]`)?.closest(".tx-dock-group")?.querySelector(".tx-dock-body");
    const host = el && (el.querySelector(".tx-canvas") || el);
    if (!host) return null;
    const r = host.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return null;
    return {
      x: Math.max(0, Math.floor(r.left)),
      y: Math.max(0, Math.floor(r.top)),
      width: Math.floor(r.width),
      height: Math.floor(r.height),
    };
  }, panelId);
}

async function focusPanel(page, panelId) {
  await page.evaluate(id => {
    const dock = TX.app.$refs.dock;
    if (dock) dock.openPanel(id);
    else TX.store.state.activePanel = id;
  }, panelId);
  await page.waitForTimeout(200);
}

async function main() {
  if (!existsSync(join(dist, "index.html"))) {
    console.error("dist/index.html missing — run node build.mjs first");
    process.exit(1);
  }
  if (!existsSync(example)) {
    console.error("examples/sign-coffee-shop.jpg missing");
    process.exit(1);
  }

  mkdirSync(assets, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  const { server, url } = await serve();
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await waitApp(page);
    await loadExample(page);

    // 1) Source with photo ready
    await focusPanel(page, "mark");
    let clip = await panelClip(page, "mark");
    const sourceReady = await shot(page, "01-source", clip);

    await markAndExtract(page);
    await focusPanel(page, "mark");
    clip = await panelClip(page, "mark");
    const sourceMarked = await shot(page, "02-marked", clip);

    await focusPanel(page, "atlas");
    await page.evaluate(() => {
      if (TX.app.atlas) TX.app.atlas.fitSelection();
    });
    await page.waitForTimeout(150);
    clip = await panelClip(page, "atlas");
    const atlasShot = await shot(page, "03-atlas", clip);

    // Edge-to-atlas story as a short GIF
    writeFileSync(join(tmp, "seq-mark-a.png"), readFileSync(sourceReady));
    writeFileSync(join(tmp, "seq-mark-b.png"), readFileSync(sourceMarked));
    writeFileSync(join(tmp, "seq-mark-c.png"), readFileSync(atlasShot));
    // Hold each frame by duplicating filenames for ffmpeg pattern
    for (const [i, src] of [["00", "seq-mark-a"], ["01", "seq-mark-a"], ["02", "seq-mark-b"], ["03", "seq-mark-b"], ["04", "seq-mark-c"], ["05", "seq-mark-c"]]) {
      writeFileSync(join(tmp, `markframe-${i}.png`), readFileSync(join(tmp, `${src}.png`)));
    }
    ffmpegGif(join(tmp, "markframe-%02d.png"), join(assets, "feature-mark-extract.gif"), 2);

    // 2) Flatten lighting before/after
    await page.evaluate(async () => {
      const id = TX.store.state.textures[0].id;
      TX.store.select("texture", id);
      TX.store.setDelight(id, { mode: "none", strength: 0.5 });
      TX.delight.invalidate(id);
      TX.store.state.pixelEpoch++;
      if (TX.app.atlas) TX.app.atlas.refreshTexture(id);
      await new Promise(r => setTimeout(r, 120));
    });
    await focusPanel(page, "atlas");
    clip = await panelClip(page, "atlas");
    const litOff = await shot(page, "04-lit-off", clip);
    await page.evaluate(async () => {
      const id = TX.store.state.textures[0].id;
      TX.store.setDelight(id, { mode: "gradient", strength: 0.85 });
      TX.delight.invalidate(id);
      TX.store.state.pixelEpoch++;
      if (TX.app.atlas) TX.app.atlas.refreshTexture(id);
      await new Promise(r => setTimeout(r, 200));
    });
    const litOn = await shot(page, "05-lit-on", clip);
    ffmpegCrossfade(litOff, litOn, join(assets, "feature-flatten-lighting.gif"));

    // 3) Auto PBR + 3D
    await page.evaluate(async () => {
      const id = TX.store.state.textures[0].id;
      TX.material.applySuggestion(id);
      TX.material.warm(id);
      TX.store.state.settings.material.shape = "box";
      TX.store.state.settings.sway = false;
      await new Promise(r => setTimeout(r, 400));
    });
    await focusPanel(page, "preview3d");
    await page.waitForTimeout(500);
    clip = await panelClip(page, "preview3d");
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => {
        const view = TX.app.$refs.preview3d && TX.app.$refs.preview3d.view;
        if (!view || !view.camera || !view.controls) return;
        const cam = view.camera;
        const t = view.controls.target;
        const dx = cam.position.x - t.x;
        const dy = cam.position.y - t.y;
        const dz = cam.position.z - t.z;
        const ang = 0.28;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        cam.position.set(
          t.x + dx * cos - dz * sin,
          t.y + dy,
          t.z + dx * sin + dz * cos,
        );
        view.controls.update();
        if (view.refresh) view.refresh();
      });
      await page.waitForTimeout(70);
      await shot(page, `3d-${String(i).padStart(2, "0")}`, clip);
    }
    ffmpegGif(join(tmp, "3d-%02d.png"), join(assets, "feature-3d-pbr.gif"), 8);

    // 4) Tiling seams
    await page.evaluate(() => {
      Object.assign(TX.store.state.settings.preview, { cols: 3, rows: 3, showSeams: true, wrap: "repeat" });
      const id = TX.store.state.textures[0].id;
      TX.store.setTiling(id, { mode: "none" });
      TX.tiling.invalidate(id);
      TX.store.state.pixelEpoch++;
    });
    await focusPanel(page, "tiling");
    await page.evaluate(() => {
      if (TX.app.tilingPanel) TX.app.tilingPanel.fit();
    });
    await page.waitForTimeout(200);
    clip = await panelClip(page, "tiling");
    const seamsOn = await shot(page, "06-seams-on", clip);
    await page.evaluate(async () => {
      const id = TX.store.state.textures[0].id;
      TX.store.setTiling(id, { mode: "mirror" });
      TX.tiling.invalidate(id);
      TX.store.state.pixelEpoch++;
      Object.assign(TX.store.state.settings.preview, { showSeams: true });
      if (TX.app.tilingPanel) TX.app.tilingPanel.fit();
      await new Promise(r => setTimeout(r, 200));
    });
    const seamsFix = await shot(page, "07-seams-fix", clip);
    ffmpegCrossfade(seamsOn, seamsFix, join(assets, "feature-tiling-seams.gif"));

    // 5) Pack — duplicate a couple slices then pack
    await page.evaluate(async () => {
      for (const t of TX.store.state.textures) {
        TX.store.setTiling(t.id, { mode: "none" });
        TX.tiling.invalidate(t.id);
      }
      TX.store.state.pixelEpoch++;
      const id = TX.store.state.textures[0].id;
      TX.store.select("texture", id);
      TX.app.atlas.duplicateTexture(id);
      TX.app.atlas.duplicateTexture(id);
      TX.store.state.textures.forEach((t, i) => {
        t.x = 40 + i * 160;
        t.y = 40 + (i % 2) * 110;
        t.scaleX = 0.2;
        t.scaleY = 0.2;
        t.rotation = 0;
      });
      for (const t of TX.store.state.textures) TX.app.atlas.refreshTexture(t.id);
      TX.app.atlas.syncMeshes();
      TX.app.atlas.fitAll();
      await new Promise(r => setTimeout(r, 200));
    });
    await focusPanel(page, "atlas");
    clip = await panelClip(page, "atlas");
    const beforePack = await shot(page, "08-before-pack", clip);
    await page.evaluate(() => {
      TX.app.actions.packAtlas();
      TX.app.atlas.fitAll();
    });
    await page.waitForTimeout(200);
    const afterPack = await shot(page, "09-after-pack", clip);
    ffmpegCrossfade(beforePack, afterPack, join(assets, "feature-pack-atlas.gif"));

    // 6) Full window hero still (replaces nothing; keep demo.gif)
    await page.screenshot({ path: join(assets, "feature-overview.png"), type: "png" });

    console.log("Wrote:");
    for (const name of [
      "feature-mark-extract.gif",
      "feature-flatten-lighting.gif",
      "feature-3d-pbr.gif",
      "feature-tiling-seams.gif",
      "feature-pack-atlas.gif",
      "feature-overview.png",
    ]) {
      const p = join(assets, name);
      console.log(`  ${name} (${existsSync(p) ? `${Math.round(readFileSync(p).length / 1024)} kB` : "MISSING"})`);
    }
  } finally {
    await browser.close();
    server.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
