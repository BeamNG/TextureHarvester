// E2E through canvases/store; results in DOM for --dump-dom
import { TX } from "./tx.js";
import "./core.js";

const lines = [];
let failures = 0;

// flush() so --dump-dom mid-run shows progress
function flush() {
  document.getElementById("results").textContent = lines.join("\n");
}

function check(name, ok, detail) {
  if (!ok) failures++;
  lines.push(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  flush();
}

function step(label) {
  lines.push(`....  ${label}`);
  flush();
}

function report() {
  lines.push("");
  lines.push(failures ? `RESULT: ${failures} FAILURE(S)` : "RESULT: ALL PASSED");
  flush();
}

function host() {
  const el = document.createElement("div");
  el.style.cssText = "position:absolute;width:400px;height:300px;left:0;top:0;";
  document.body.appendChild(el);
  return el;
}

function sourceCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, 100, 50);
  ctx.fillStyle = "#00ff00"; ctx.fillRect(100, 0, 100, 50);
  ctx.fillStyle = "#0000ff"; ctx.fillRect(0, 50, 100, 50);
  ctx.fillStyle = "#ffff00"; ctx.fillRect(100, 50, 100, 50);
  return canvas;
}

const toFile = canvas => new Promise(resolve =>
  canvas.toBlob(blob => resolve(new File([blob], "sample.png", { type: "image/png" })), "image/png"));

const pixel = (canvas, x, y) => {
  const d = canvas.getContext("2d").getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
};
const near = (got, want, tol) => Math.abs(got[0] - want[0]) <= tol
  && Math.abs(got[1] - want[1]) <= tol && Math.abs(got[2] - want[2]) <= tol;

async function run() {
  const store = TX.store;
  const state = store.state;
  state.settings.autoPbr = false;
  TX.material.cancelAuto();

  const notices = [];
  const mark = TX.markCanvas.createMarkCanvas(host(), {});
  const atlas = TX.atlasCanvas.createAtlasCanvas(host(), {});
  const actions = TX.actions.create({ mark, atlas, notify: (text, color) => notices.push(`${color}:${text}`) });

  // ---- loading -----------------------------------------------------------
  step("encoding source png via canvas.toBlob");
  const file = await toFile(sourceCanvas());
  step("decoding it back through loadFiles");
  const added = await mark.loadFiles([file]);
  check("loadFiles accepted the png", added === 1, `added=${added}`);
  check("image is in the store", state.images.length === 1);
  check("image dimensions read from the file",
    state.images[0].width === 200 && state.images[0].height === 100,
    `${state.images[0].width}x${state.images[0].height}`);
  check("gpu source was created for the image", store.assets.sources.has(state.images[0].id));

  const image = state.images[0];

  // ---- marking -----------------------------------------------------------
  store.addMark(image.id, [
    { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 50 }, { x: 100, y: 50 },
  ]);
  check("mark was added and is dirty", state.marks.length === 1 && state.marks[0].dirty);

  // ---- the progress overlay's bookkeeping ---------------------------------
  step("reporting progress");
  {
    const progress = TX.progress;
    const seen = [];
    const result = await progress.run("Outer", async report => {
      seen.push([progress.state.active, progress.state.title, progress.state.value]);
      await report(0.5, "halfway");
      seen.push([progress.state.active, progress.state.title, progress.state.value]);
      await progress.run("Inner", async () => {
        seen.push([progress.state.active, progress.state.title, progress.state.value]);
      });
      seen.push([progress.state.active, progress.state.title, progress.state.value]);
      return "done";
    });

    check("the worker's return value comes back out", result === "done", String(result));
    check("it is active from the start, with no position until one is reported",
      seen[0][0] === true && seen[0][1] === "Outer" && seen[0][2] === null,
      JSON.stringify(seen[0]));
    check("reporting moves the bar", seen[1][2] === 0.5 && progress.state.detail === "",
      JSON.stringify(seen[1]));
    check("a nested run renames the overlay rather than replacing it",
      seen[2][0] === true && seen[2][1] === "Inner", JSON.stringify(seen[2]));
    check("and hands the name back when it finishes",
      seen[3][0] === true && seen[3][1] === "Outer", JSON.stringify(seen[3]));
    check("nothing is left up at the end",
      progress.state.active === false && progress.state.title === ""
      && progress.state.value === null);

    let threw = false;
    try {
      await progress.run("Doomed", async () => { throw new Error("nope"); });
    } catch (err) {
      threw = err.message === "nope";
    }
    check("a failure is rethrown rather than swallowed", threw);
    check("and the overlay still comes down", progress.state.active === false);

    const fractions = [];
    const labels = [];
    await progress.run("Each", async () => {
      await progress.each(["a", "b", "c", "d"], (item, i, total) => `${item} ${i + 1}/${total}`,
        () => {
          fractions.push(progress.state.value);
          labels.push(progress.state.detail);
        });
    });
    check("each item is a step of its own",
      fractions.join(",") === "0,0.25,0.5,0.75", fractions.join(","));
    check("and is named as it is worked on", labels[2] === "c 3/4", labels.join(" | "));
  }

  // ---- extraction --------------------------------------------------------
  step("running actions.convert");
  const converted = await actions.convert("all");
  check("convert reported one extraction", converted === 1, `converted=${converted}`);
  check("texture exists in the store", state.textures.length === 1);
  check("mark was cleared of its dirty flag", state.marks[0].dirty === false);

  const texture = state.textures[0];
  const asset = store.assets.textures.get(texture.id);
  check("texture canvas was stored", !!asset);
  check("texture is 100x50", texture.width === 100 && texture.height === 50,
    `${texture.width}x${texture.height}`);

  if (asset) {
    const centre = pixel(asset.canvas, 50, 25);
    check("extracted texture is the green quadrant", near(centre, [0, 255, 0], 6), centre.join(","));
  }

  check("texture scale snapped to the grid",
    Math.abs(texture.width * texture.scaleX - 96) < 0.001
    && Math.abs(texture.height * texture.scaleY - 48) < 0.001,
    `${(texture.width * texture.scaleX).toFixed(2)}x${(texture.height * texture.scaleY).toFixed(2)}`);

  // ---- re-extracting a modified mark replaces, not duplicates ------------
  store.setMarkPoint(state.marks[0].id, 0, { x: 100, y: 0 });
  check("editing a point marks it dirty again", state.marks[0].dirty === true);
  await actions.convert("all");
  check("re-extracting reuses the same texture", state.textures.length === 1,
    `count=${state.textures.length}`);

  // ---- atlas composite ---------------------------------------------------
  const composed = atlas.compositeAll();
  check("composite produced a canvas", !!composed);
  if (composed) {
    check("composite is 96x48", composed.width === 96 && composed.height === 48,
      `${composed.width}x${composed.height}`);
    const centre = pixel(composed.canvas, 48, 24);
    check("composite pixels are the extracted green", near(centre, [0, 255, 0], 8), centre.join(","));
    const corner = pixel(composed.canvas, 1, 1);
    check("composite has no transparent border", corner[3] === 255, `alpha=${corner[3]}`);
  }

  // ---- selection driven individual export --------------------------------
  store.select("texture", texture.id);
  const items = atlas.selectedAsCanvases();
  check("selected export returns one item", items.length === 1);
  if (items.length) {
    check("individual export honours the scaled size",
      items[0].canvas.width === 96 && items[0].canvas.height === 48,
      `${items[0].canvas.width}x${items[0].canvas.height}`);
    const bytes = await TX.io.canvasToBytes(items[0].canvas);
    check("png encodes with a valid signature",
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47,
      `${bytes.length} bytes`);
    const zip = TX.zip.createZip([{ name: "t.png", bytes }]);
    check("zip wraps the encoded png", zip.size > bytes.length, `zip=${zip.size} png=${bytes.length}`);
  }

  // ---- the flat exports, with and without the material's maps -------------
  step("exporting with and without the PBR maps");
  {
    const written = [];
    const realSave = TX.io.saveBlob;
    TX.io.saveBlob = (blob, filename) => written.push({ blob, filename });
    Object.assign(state.settings.material,
      { normal: 1, occlusion: 0.8, detailNormal: 0.6, roughnessAmount: 0.5, cavity: 0.4 });
    store.select("texture", texture.id);

    try {
      state.settings.exportMaps = false;
      await actions.exportAtlas();
      check("the atlas is one PNG when the maps are not wanted",
        written.length === 1 && written[0].filename === "atlas.png",
        written.map(w => w.filename).join(","));

      await actions.exportIndividually();
      check("and a single texture is one PNG too",
        written.length === 2 && /\.png$/.test(written[1].filename),
        written.map(w => w.filename).join(","));

      written.length = 0;
      state.settings.exportMaps = true;
      await actions.exportAtlas();
      check("asking for the maps makes the atlas a zip",
        written.length === 1 && written[0].filename === "atlas.zip",
        written.map(w => w.filename).join(","));

      const named = async blob => {
        const text = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
        return (text.match(/atlas-[a-z]+\.png/g) || []).filter((n, i, all) => all.indexOf(n) === i);
      };
      const sheets = written.length ? await named(written[0].blob) : [];
      check("with a sheet for the colour and one for every channel",
        sheets.includes("atlas-colour.png") && sheets.includes("atlas-normal.png")
        && sheets.includes("atlas-roughness.png") && sheets.includes("atlas-occlusion.png"),
        sheets.join(","));

      written.length = 0;
      await actions.exportIndividually();
      check("and an individual export becomes a zip as well",
        written.length === 1 && written[0].filename === "textures.zip",
        written.map(w => w.filename).join(","));
      const files = written.length
        ? await (async () => {
          const text = new TextDecoder("latin1")
            .decode(new Uint8Array(await written[0].blob.arrayBuffer()));
          return (text.match(/[\w-]+\.png/g) || []).filter((n, i, all) => all.indexOf(n) === i);
        })()
        : [];
      check("naming the colour and its maps after the texture",
        files.some(n => /-colour\.png$/.test(n)) && files.some(n => /-normal\.png$/.test(n))
        && files.some(n => /-roughness\.png$/.test(n))
        && files.some(n => /-occlusion\.png$/.test(n)),
        files.join(","));
    } finally {
      TX.io.saveBlob = realSave;
      state.settings.exportMaps = false;
    }

    {
      const raised = notices.length;
      const realEncode = TX.io.canvasToBlob;
      TX.io.canvasToBlob = () => Promise.reject(new Error("encoder refused"));
      let rejected = false;
      await actions.exportAtlas().catch(() => { rejected = true; });
      TX.io.canvasToBlob = realEncode;
      check("an export that cannot encode does not reject into nowhere", !rejected);
      check("and says so where the user is looking",
        notices.slice(raised).some(n => n.startsWith("error") && /encoder refused/.test(n)),
        notices.slice(raised).join(" / ") || "nothing");
      // Deliberate, so it must not count against the run's own "no error notices" check.
      notices.length = raised;
    }

    const derived = TX.material.full(texture.id);
    check("the maps are derived at the texture's full resolution",
      !!derived && !!derived.normal
      && derived.normal.width === store.assets.textures.get(texture.id).canvas.width,
      derived && derived.normal ? `${derived.normal.width} vs `
        + `${store.assets.textures.get(texture.id).canvas.width}` : "none");
    check("and the colour they accompany is a different size, which is why they are resized",
      atlas.selectedAsCanvases()[0].canvas.width !== derived.normal.width,
      `${atlas.selectedAsCanvases()[0].canvas.width} vs ${derived.normal.width}`);

    Object.assign(state.settings.material,
      { normal: 0.6, occlusion: 0.8, detailNormal: 0, roughnessAmount: 0, cavity: 0 });
  }

  // ---- packing -----------------------------------------------------------
  store.addMark(image.id, [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 },
  ]);
  await actions.convert("all");
  check("second mark extracted", state.textures.length === 2, `count=${state.textures.length}`);

  const packResult = atlas.packAll();
  check("pack returned bounds", !!packResult && packResult.width > 0 && packResult.height > 0,
    packResult ? `${packResult.width}x${packResult.height}` : "null");

  const boxes = state.textures.map(t => ({
    x: t.x, y: t.y, w: t.width * t.scaleX, h: t.height * t.scaleY,
  }));
  const overlapping = boxes[0].x < boxes[1].x + boxes[1].w && boxes[0].x + boxes[0].w > boxes[1].x
    && boxes[0].y < boxes[1].y + boxes[1].h && boxes[0].y + boxes[0].h > boxes[1].y;
  check("packed textures do not overlap", !overlapping,
    boxes.map(b => `${b.x},${b.y} ${b.w}x${b.h}`).join(" | "));

  const both = atlas.compositeAll();
  check("composite covers both textures", !!both && both.width >= 96 && both.height >= 48,
    both ? `${both.width}x${both.height}` : "null");

  // ---- local space through the real extraction path -----------------------
  const localMark = store.addMark(image.id, [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 },
  ]);
  await actions.convert("all");
  const localTexture = state.textures.find(t => t.markId === localMark.id);
  check("the local-space mark extracted", !!localTexture && localTexture.width === 100,
    localTexture ? `${localTexture.width}x${localTexture.height}` : "none");
  check("it starts out entirely red",
    near(pixel(store.assets.textures.get(localTexture.id).canvas, 95, 25), [255, 0, 0], 6));

  const stageWidthBefore = localTexture.width * localTexture.scaleX;
  store.setMarkDomain(localMark.id, { u1: 2 });
  check("changing the domain marks it for re-extraction", localMark.dirty === true);
  check("re-extraction succeeds", actions.reextract(localMark.id) === true);
  check("doubling the domain doubles the pixels", localTexture.width === 200,
    String(localTexture.width));
  check("the texture keeps the size it had on the stage",
    Math.abs(localTexture.width * localTexture.scaleX - stageWidthBefore) < 0.01,
    `${(localTexture.width * localTexture.scaleX).toFixed(2)} vs ${stageWidthBefore.toFixed(2)}`);

  const extendedCanvas = store.assets.textures.get(localTexture.id).canvas;
  check("the original half is still red", near(pixel(extendedCanvas, 40, 25), [255, 0, 0], 6),
    pixel(extendedCanvas, 40, 25).join(","));
  check("the extension sampled the neighbouring quadrant",
    near(pixel(extendedCanvas, 160, 25), [0, 255, 0], 6), pixel(extendedCanvas, 160, 25).join(","));

  store.setMarkDomain(localMark.id, { u0: 1, u1: 2 });
  actions.reextract(localMark.id);
  const slid = store.assets.textures.get(localTexture.id).canvas;
  check("sliding the window keeps the size", slid.width === 100, String(slid.width));
  check("sliding the window moves onto the next quadrant",
    near(pixel(slid, 50, 25), [0, 255, 0], 6), pixel(slid, 50, 25).join(","));

  store.resetMarkLocalSpace(localMark.id);
  actions.reextract(localMark.id);
  check("resetting local space returns the original extraction",
    localTexture.width === 100
    && near(pixel(store.assets.textures.get(localTexture.id).canvas, 50, 25), [255, 0, 0], 6),
    `${localTexture.width}`);

  store.setMarkCurve(localMark.id, 0, { x: 0, y: -0.3 });
  actions.reextract(localMark.id);
  const bentCanvas = store.assets.textures.get(localTexture.id).canvas;
  check("bending an edge reaches outside the photo",
    pixel(bentCanvas, 50, 2)[3] < 128, `alpha=${pixel(bentCanvas, 50, 2)[3]}`);
  check("bending one edge leaves the far side intact",
    near(pixel(bentCanvas, 50, 46), [255, 0, 0], 6), pixel(bentCanvas, 50, 46).join(","));
  store.resetMarkLocalSpace(localMark.id);
  actions.reextract(localMark.id);

  // ---- drafting, which is what a drag actually does -----------------------
  {
    store.setMarkDomain(localMark.id, { u1: 1.5 });
    const finalWidth = localTexture.width;
    check("a draft re-extraction succeeds",
      actions.reextract(localMark.id, { draft: true }) === true);
    const drafted = store.assets.textures.get(localTexture.id).canvas;
    check("the draft is the same picture", near(pixel(drafted, 10, 10), [255, 0, 0], 10),
      pixel(drafted, 10, 10).join(","));
    check("the draft leaves the texture's dimensions alone",
      localTexture.width === finalWidth, `${localTexture.width} vs ${finalWidth}`);
    check("and leaves it owing a real extraction", localMark.dirty === true);

    actions.reextract(localMark.id);
    const finished = store.assets.textures.get(localTexture.id).canvas;
    check("finishing replaces the draft with full-size pixels",
      finished !== drafted && finished.width === localTexture.width,
      `${finished.width} vs ${localTexture.width}`);
    check("and clears what it owed", localMark.dirty === false);

    store.resetMarkLocalSpace(localMark.id);
    actions.reextract(localMark.id);
  }

  const plainCopy = atlas.duplicateTexture(localTexture.id);
  check("duplicating makes an independent texture",
    !!plainCopy && plainCopy !== localTexture.id && state.textures.length > 0);
  if (plainCopy) {
    const copyNode = store.findTexture(plainCopy);
    check("the duplicate has its own pixels",
      store.assets.textures.get(plainCopy).canvas !== store.assets.textures.get(localTexture.id).canvas
      && near(pixel(store.assets.textures.get(plainCopy).canvas, 50, 25), [255, 0, 0], 6));
    check("the duplicate is not tied to the mark", !copyNode.markId, String(copyNode.markId));
    store.removeTexture(plainCopy);
  }

  // ---- delighting through the real display and export paths ---------------
  const litSource = document.createElement("canvas");
  litSource.width = 200;
  litSource.height = 100;
  const litCtx = litSource.getContext("2d");
  litCtx.fillStyle = "#3c9f56";
  litCtx.fillRect(0, 0, 200, 100);
  for (let x = 0; x < 200; x++) {
    litCtx.fillStyle = `rgba(0,0,0,${0.6 * (x / 199)})`;
    litCtx.fillRect(x, 0, 1, 100);
  }
  const litFile = new File(
    [await new Promise(r => litSource.toBlob(r, "image/png"))], "lit.png", { type: "image/png" });
  await mark.loadFiles([litFile]);
  const litImage = state.images[state.images.length - 1];
  const litMark = store.addMark(litImage.id, [
    { x: 10, y: 10 }, { x: 190, y: 10 }, { x: 190, y: 90 }, { x: 10, y: 90 },
  ]);
  await actions.convert("all");
  const litTexture = state.textures.find(t => t.markId === litMark.id);
  check("the unevenly lit mark extracted", !!litTexture);

  const rawStats = TX.delight.analyze(store.assets.textures.get(litTexture.id).canvas);
  check("the extraction really is unevenly lit", rawStats.contrast > 20,
    `contrast=${rawStats.contrast.toFixed(1)}`);
  check("delighting off returns the extraction itself",
    store.textureCanvas(litTexture.id) === store.assets.textures.get(litTexture.id).canvas);

  store.setDelight(litTexture.id, { mode: "gradient", strength: 1 });
  const flattened = store.textureCanvas(litTexture.id);
  check("delighting produces a different canvas",
    flattened !== store.assets.textures.get(litTexture.id).canvas);
  check("delighting preserves the dimensions",
    flattened.width === litTexture.width && flattened.height === litTexture.height,
    `${flattened.width}x${flattened.height}`);
  const flatStats = TX.delight.analyze(flattened);
  check("the displayed canvas is the flattened one",
    flatStats.contrast < rawStats.contrast / 4,
    `${rawStats.contrast.toFixed(1)} -> ${flatStats.contrast.toFixed(1)}`);
  check("the derived canvas is cached rather than rebuilt",
    store.textureCanvas(litTexture.id) === flattened);

  store.select("texture", litTexture.id);
  const litExport = atlas.selectedAsCanvases();
  check("export picks up the flattened canvas",
    litExport.length === 1
    && TX.delight.analyze(litExport[0].canvas).contrast < rawStats.contrast / 3,
    litExport.length ? TX.delight.analyze(litExport[0].canvas).contrast.toFixed(1) : "none");

  store.setTiling(litTexture.id, { mode: "feather", band: 0.2 });
  const stacked = store.textureCanvas(litTexture.id);
  check("tiling still closes the seam on a flattened texture",
    TX.tiling.seamError(stacked) === 0, `seam=${TX.tiling.seamError(stacked)}`);
  check("the tiled canvas is also the flattened one",
    TX.delight.analyze(stacked).contrast < rawStats.contrast / 3,
    TX.delight.analyze(stacked).contrast.toFixed(1));
  store.setDelight(litTexture.id, { strength: 0.25 });
  const weaker = store.textureCanvas(litTexture.id);
  check("changing the lighting invalidates the tiled canvas above it", weaker !== stacked);
  check("and the weaker setting really is weaker",
    TX.delight.analyze(weaker).contrast > TX.delight.analyze(stacked).contrast,
    `${TX.delight.analyze(stacked).contrast.toFixed(1)} -> ${TX.delight.analyze(weaker).contrast.toFixed(1)}`);

  store.setTiling(litTexture.id, { mode: "none" });
  store.setDelight(litTexture.id, { mode: "gradient", strength: 1 });

  const shadingId = atlas.addShadingTexture(litTexture.id);
  check("the shading map becomes its own texture", !!shadingId);
  if (shadingId) {
    const shading = store.assets.textures.get(shadingId).canvas;
    check("the shading map is brighter where the light was",
      pixel(shading, 5, 40)[0] > pixel(shading, 175, 40)[0] + 30,
      `${pixel(shading, 5, 40)[0]} vs ${pixel(shading, 175, 40)[0]}`);
    check("the shading map is not tied to the mark",
      !store.findTexture(shadingId).markId);
    store.removeTexture(shadingId);
  }

  const before = store.textureCanvas(litTexture.id);
  store.setMarkDomain(litMark.id, { u1: 0.6 });
  actions.reextract(litMark.id);
  check("re-extraction invalidates the flattened canvas",
    store.textureCanvas(litTexture.id) !== before);
  store.resetMarkLocalSpace(litMark.id);
  actions.reextract(litMark.id);

  store.removeImage(litImage.id);
  store.clearSelection();

  // ---- seamless tiling through the real display and export paths ----------
  store.addMark(image.id, [
    { x: 50, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 50 }, { x: 50, y: 50 },
  ]);
  await actions.convert("all");
  const striped = state.textures[state.textures.length - 1];
  const stripedAsset = store.assets.textures.get(striped.id);
  check("straddling mark extracted", !!stripedAsset && striped.width === 100,
    `${striped.width}x${striped.height}`);

  const rawSeam = TX.tiling.seamError(stripedAsset.canvas);
  check("the straddling texture starts with a real seam", rawSeam > 200, `seam=${rawSeam}`);
  check("tiling off returns the extraction itself",
    store.textureCanvas(striped.id) === stripedAsset.canvas);

  store.setTiling(striped.id, { mode: "feather", band: 0.25 });
  const tiled = store.textureCanvas(striped.id);
  check("tiling produces a different canvas", tiled !== stripedAsset.canvas);
  check("tiling preserves the dimensions", tiled.width === 100 && tiled.height === 50,
    `${tiled.width}x${tiled.height}`);
  check("tiling closes the seam end to end", TX.tiling.seamError(tiled) === 0,
    `seam=${TX.tiling.seamError(tiled)}`);
  const edge = pixel(tiled, 0, 25);
  check("the joined edge is the blend of both sides", near(edge, [128, 128, 0], 6), edge.join(","));

  store.select("texture", striped.id);
  const tiledExport = atlas.selectedAsCanvases();
  check("export picks up the tiled canvas",
    tiledExport.length === 1 && near(pixel(tiledExport[0].canvas, 0, 24), [128, 128, 0], 40),
    tiledExport.length ? pixel(tiledExport[0].canvas, 0, 24).join(",") : "none");

  store.setTiling(striped.id, { mode: "none" });
  check("turning tiling off restores the extraction",
    store.textureCanvas(striped.id) === stripedAsset.canvas);

  const mirroredCopy = atlas.duplicateMirrored(striped.id);
  check("mirrored duplicate is a new texture",
    !!mirroredCopy && mirroredCopy.id !== striped.id, mirroredCopy ? mirroredCopy.name : "null");
  if (mirroredCopy) {
    check("mirrored duplicate doubles the dimensions",
      mirroredCopy.width === 200 && mirroredCopy.height === 100,
      `${mirroredCopy.width}x${mirroredCopy.height}`);
    check("mirrored duplicate tiles seamlessly",
      TX.tiling.seamError(store.textureCanvas(mirroredCopy.id)) === 0);
    check("mirrored duplicate leaves the original alone",
      striped.width === 100 && store.textureCanvas(striped.id) === stripedAsset.canvas);
  }

  // ---- the view record: everything a reload has to bring back ------------
  state.viewports.mark = { panX: 12.5, panY: -34, zoom: 2.25 };
  state.viewports.atlas = { panX: 8, panY: 9, zoom: 0.5 };
  state.activePanel = "atlas";
  store.select("texture", striped.id);
  state.settings.gridSize = 32;
  state.settings.views.mode = "delta";
  state.settings.views.overlay = 0.35;
  state.settings.props.lighting = false;
  state.settings.props.local = true;
  store.setTiling(striped.id, { mode: "feather", band: 0.3 });
  striped.x = 123.5;
  striped.rotation = 0.25;
  striped.scaleX = 1.5;
  store.addMark(image.id, [
    { x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 },
  ]);
  const markCount = state.marks.length;

  const record = store.viewRecord();
  // It has to be plain JSON: a Blob in here would silently serialise to {}.
  let serialised = null;
  try {
    serialised = JSON.stringify(record);
  } catch (err) {
    serialised = null;
  }
  check("the view record serialises", typeof serialised === "string" && serialised.length > 0);
  check("the view record carries no image files",
    record.images.every(i => !("file" in i)) && !/"file"/.test(serialised || ""));
  check("the view record covers every mark and texture",
    record.marks.length === markCount && record.textures.length === state.textures.length,
    `marks=${record.marks.length} textures=${record.textures.length}`);

  striped.x = 0;
  striped.rotation = 0;
  striped.scaleX = 1;
  store.setTiling(striped.id, { mode: "none" });
  store.clearSelection();
  state.viewports.mark = null;
  state.viewports.atlas = null;
  state.activePanel = "mark";
  state.settings.gridSize = 16;
  state.settings.views.mode = "density";
  state.settings.views.overlay = 0.8;
  state.settings.props.lighting = true;
  state.settings.props.local = false;
  state.marks[markCount - 1].points[0] = { x: 999, y: 999 };

  const applied = store.applyViewRecord(JSON.parse(serialised), 0);
  check("applying the record succeeds", applied === true);
  check("transforms come back",
    striped.x === 123.5 && Math.abs(striped.rotation - 0.25) < 1e-9 && striped.scaleX === 1.5,
    `${striped.x} ${striped.rotation} ${striped.scaleX}`);
  check("tiling settings come back",
    striped.tiling.mode === "feather" && Math.abs(striped.tiling.band - 0.3) < 1e-9,
    `${striped.tiling.mode}:${striped.tiling.band}`);
  check("the selection comes back",
    store.selectedIds("texture").join(",") === striped.id, store.selectedIds("texture").join(","));
  check("viewports come back",
    state.viewports.mark.panX === 12.5 && state.viewports.mark.zoom === 2.25
    && state.viewports.atlas.zoom === 0.5,
    JSON.stringify(state.viewports.mark));
  check("the active panel comes back", state.activePanel === "atlas", state.activePanel);
  check("settings come back", state.settings.gridSize === 32, String(state.settings.gridSize));
  check("the views panel comes back on the mode it was left on",
    state.settings.views.mode === "delta" && state.settings.views.overlay === 0.35,
    JSON.stringify(state.settings.views));
  check("the folded property groups come back folded",
    state.settings.props.lighting === false && state.settings.props.local === true,
    JSON.stringify(state.settings.props));

  const older = JSON.parse(serialised);
  delete older.settings.views;
  store.applyViewRecord(older, 0);
  check("a record with no views settings keeps the defaults",
    state.settings.views.mode === "delta" && state.settings.views.numbers === true,
    JSON.stringify(state.settings.views));

  const partial = JSON.parse(serialised);
  partial.settings.views = { numbers: false };
  store.applyViewRecord(partial, 0);
  check("a partial views record only changes what it names",
    state.settings.views.numbers === false && state.settings.views.mode === "delta",
    JSON.stringify(state.settings.views));
  state.settings.views.numbers = true;

  const mangled = JSON.parse(serialised);
  mangled.settings.views = 7;
  mangled.settings.gridSize = { nonsense: true };
  store.applyViewRecord(mangled, 0);
  check("a settings group cannot be replaced by a scalar",
    state.settings.views.mode === "delta" && typeof state.settings.gridSize === "number",
    `${JSON.stringify(state.settings.views)} ${JSON.stringify(state.settings.gridSize)}`);
  check("mark points come back",
    state.marks[markCount - 1].points[0].x === 10, String(state.marks[markCount - 1].points[0].x));
  check("the derived tiled canvas follows the restored settings",
    TX.tiling.seamError(store.textureCanvas(striped.id)) === 0);

  const corrupt = JSON.parse(serialised);
  corrupt.textures[corrupt.textures.length - 1] = {
    ...corrupt.textures[corrupt.textures.length - 1], x: "nonsense", scaleX: null,
  };
  corrupt.viewports.mark = { panX: 1, panY: 2, zoom: "big" };
  corrupt.marks[0].points = [{ x: 1, y: 2 }];
  store.applyViewRecord(corrupt, 0);
  const lastTexture = state.textures[state.textures.length - 1];
  check("a non-numeric transform is ignored", Number.isFinite(lastTexture.x) && lastTexture.scaleX > 0,
    `${lastTexture.x} ${lastTexture.scaleX}`);
  check("an invalid viewport is dropped rather than stored", state.viewports.mark === null);
  check("a mark that is no longer a quad is left alone",
    state.marks[0].points.length === 4, String(state.marks[0].points.length));
  check("nothing was lost to the corrupt record",
    state.marks.length === markCount && state.textures.length === record.textures.length,
    `marks=${state.marks.length} textures=${state.textures.length}`);

  const pruning = JSON.parse(serialised);
  pruning.savedAt = Date.now() + 5000;
  pruning.textures = pruning.textures.filter(t => t.id !== mirroredCopy.id);
  store.applyViewRecord(pruning, Date.now());
  check("a newer record prunes what was deleted", !store.findTexture(mirroredCopy.id));

  const stale = JSON.parse(serialised);
  stale.savedAt = 1;
  stale.textures = [];
  stale.marks = [];
  const survivors = state.textures.length;
  store.applyViewRecord(stale, Date.now());
  check("an older record does not prune", state.textures.length === survivors,
    `${survivors} -> ${state.textures.length}`);

  check("a missing record is refused", store.applyViewRecord(null, 0) === false);

  step("snapshotting the session");
  store.setDelight(striped.id, { mode: "local", strength: 0.6, radius: 0.09, perChannel: true });

  const depthWide = 24;
  const depthTall = 18;
  const savedDepth = new Float32Array(depthWide * depthTall);
  for (let i = 0; i < savedDepth.length; i++) savedDepth[i] = 3 + i * 0.25;
  store.setImageDepth(image.id, { data: savedDepth, width: depthWide, height: depthTall });

  {
    const first = await store.snapshot();
    const again = await store.snapshot();
    const blobsOf = doc => doc.textures.map(t => t.blob);
    check("saving twice does not encode the same pixels twice",
      first.textures.length > 0
      && blobsOf(first).every((blob, i) => blob === blobsOf(again)[i]),
      `${first.textures.length} textures`);

    const target = state.textures[0];
    if (target) {
      const canvas = document.createElement("canvas");
      canvas.width = store.assets.textures.get(target.id).canvas.width;
      canvas.height = store.assets.textures.get(target.id).canvas.height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#123456";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      store.setTextureCanvas(target.id, canvas);
      const third = await store.snapshot();
      const beforeBlob = first.textures.find(t => t.id === target.id).blob;
      const afterBlob = third.textures.find(t => t.id === target.id).blob;
      check("but new pixels are encoded afresh", beforeBlob !== afterBlob);
    }
  }

  const documentSnapshot = await store.snapshot();
  const depthRecord = documentSnapshot.images.find(i => i.id === image.id).depth;
  check("the snapshot carries the depth map as float bytes",
    !!depthRecord && depthRecord.blob instanceof Blob
      && depthRecord.blob.size === savedDepth.byteLength
      && depthRecord.width === depthWide && depthRecord.height === depthTall,
    depthRecord ? `${depthRecord.blob.size} bytes ${depthRecord.width}x${depthRecord.height}`
      : "none");
  const expected = {
    images: state.images.length,
    marks: state.marks.length,
    textures: state.textures.length,
    firstTextureId: state.textures[0].id,
    firstTexturePixel: pixel(store.assets.textures.get(state.textures[0].id).canvas, 5, 5),
    tilingMode: striped.tiling.mode,
    strippedX: striped.x,
    delight: { ...striped.delight },
  };
  check("the snapshot is stamped with a save time",
    typeof documentSnapshot.savedAt === "number" && documentSnapshot.savedAt > 0);
  // structuredClone rejects reactive proxies (IndexedDB save path)
  let cloneError = null;
  try {
    structuredClone(documentSnapshot);
  } catch (err) {
    cloneError = `${err.name}: ${err.message}`;
  }
  check("the snapshot survives a structured clone", cloneError === null, cloneError || "");
  check("the snapshot keeps the source files",
    documentSnapshot.images.every(i => i.file instanceof Blob));
  check("the snapshot carries texture pixels",
    documentSnapshot.textures.every(t => t.blob instanceof Blob && t.blob.size > 0));

  let recordCloneError = null;
  try {
    structuredClone(store.viewRecord());
  } catch (err) {
    recordCloneError = `${err.name}: ${err.message}`;
  }
  check("the view record survives a structured clone too",
    recordCloneError === null, recordCloneError || "");

  // ---- the 3D panel's own angle and settings -----------------------------
  step("carrying the 3D camera and the depth settings through the view record");
  Object.assign(state.settings.depth, {
    fov: 84, shift: 0.37, detail: 192, trim: 0.08, smooth: 0.02, edge: 0.21, display: "normals",
  });
  store.setCamera3d({ position: [1.5, -0.25, 2.75], target: [0.1, 0.2, -0.3] });

  const angled = store.viewRecord();
  check("the record carries the camera position and target",
    !!angled.camera3d && angled.camera3d.position[0] === 1.5
      && angled.camera3d.target[2] === -0.3,
    JSON.stringify(angled.camera3d));
  check("and every depth setting with it",
    angled.settings.depth && angled.settings.depth.fov === 84
      && angled.settings.depth.display === "normals" && angled.settings.depth.edge === 0.21,
    JSON.stringify(angled.settings.depth));

  store.setCamera3d({ position: [9, 9, 9], target: [0, 0, 0] });
  Object.assign(state.settings.depth, TX.depthScene.defaults());
  store.applyViewRecord(JSON.parse(JSON.stringify(angled)), 0);
  check("applying it puts the camera back where it was",
    state.camera3d && state.camera3d.position[0] === 1.5 && state.camera3d.target[1] === 0.2,
    JSON.stringify(state.camera3d));
  check("and the depth settings with it",
    TX.depthScene.settingsOf(state.settings.depth).fov === 84
      && TX.depthScene.settingsOf(state.settings.depth).display === "normals",
    JSON.stringify(state.settings.depth));

  check("a camera sitting on its own target is refused",
    store.cameraOf({ position: [1, 1, 1], target: [1, 1, 1] }) === null);
  check("so is one with a missing or non-numeric axis",
    store.cameraOf({ position: [1, 1], target: [0, 0, 0] }) === null
      && store.cameraOf({ position: [1, 1, NaN], target: [0, 0, 0] }) === null);
  check("and no camera at all is simply nothing", store.cameraOf(null) === null);

  Object.assign(state.settings.depth, TX.depthScene.defaults());

  step("saving and reading the document back through the storage layer");
  await TX.persist.save(documentSnapshot);
  const readBack = await TX.persist.load();
  check("the storage layer returns what it stored",
    !!readBack && readBack.images.length === state.images.length
    && readBack.textures.length === state.textures.length,
    readBack ? `${readBack.images.length}img/${readBack.textures.length}tex` : "nothing");

  const storedDepth = readBack && readBack.images.find(i => i.id === image.id).depth;
  check("the depth map came back out of storage too",
    !!storedDepth && storedDepth.blob instanceof Blob
      && storedDepth.blob.size === savedDepth.byteLength,
    storedDepth ? `${storedDepth.blob.size} bytes` : "none");

  // ---- deletion cascades -------------------------------------------------
  const beforeRemoval = state.textures.length;
  store.removeMark(state.marks[0].id);
  check("removing a mark removes its texture", state.textures.length === beforeRemoval - 1,
    `textures=${state.textures.length}`);

  store.removeImage(image.id);
  check("removing an image removes its marks", state.marks.length === 0);
  check("removing an image drops its gpu source", store.assets.sources.size === 0);

  // ---- reload: restoring the document from scratch ------------------------
  const groupsBefore = { ...state.settings };

  store.resetAll();
  check("resetting empties the store",
    !state.images.length && !state.marks.length && !state.textures.length
    && store.assets.sources.size === 0);
  check("resetting keeps the settings group objects",
    Object.keys(groupsBefore).every(k => state.settings[k] === groupsBefore[k]
      || typeof groupsBefore[k] !== "object"),
    Object.keys(groupsBefore).filter(k => typeof groupsBefore[k] === "object"
      && state.settings[k] !== groupsBefore[k]).join(","));
  check("and still puts their values back",
    state.settings.preview.cols === 3 && state.settings.views.mode === "off",
    JSON.stringify(state.settings.preview));

  step("restoring the snapshot");
  const restored = await store.restore(documentSnapshot);
  check("restoring keeps them too",
    Object.keys(groupsBefore).every(k => state.settings[k] === groupsBefore[k]
      || typeof groupsBefore[k] !== "object"),
    Object.keys(groupsBefore).filter(k => typeof groupsBefore[k] === "object"
      && state.settings[k] !== groupsBefore[k]).join(","));
  check("restore reports success", restored === true);
  check("every image came back", state.images.length === expected.images,
    `${state.images.length}/${expected.images}`);
  check("every mark came back", state.marks.length === expected.marks,
    `${state.marks.length}/${expected.marks}`);
  check("every texture came back", state.textures.length === expected.textures,
    `${state.textures.length}/${expected.textures}`);
  check("images got their gpu sources rebuilt", store.assets.sources.size === expected.images,
    String(store.assets.sources.size));

  const restoredTexture = store.findTexture(expected.firstTextureId);
  check("a texture keeps its identity", !!restoredTexture);
  if (restoredTexture) {
    const asset = store.assets.textures.get(restoredTexture.id);
    check("its pixels survived the encode and decode",
      !!asset && near(pixel(asset.canvas, 5, 5), expected.firstTexturePixel, 2),
      asset ? pixel(asset.canvas, 5, 5).join(",") : "none");
  }
  const restoredStriped = store.findTexture(striped.id);
  check("tiling settings survived the round trip",
    !!restoredStriped && restoredStriped.tiling.mode === expected.tilingMode
    && restoredStriped.x === expected.strippedX,
    restoredStriped ? `${restoredStriped.tiling.mode} x=${restoredStriped.x}` : "missing");
  check("lighting settings survived the round trip",
    !!restoredStriped
    && restoredStriped.delight.mode === expected.delight.mode
    && restoredStriped.delight.strength === expected.delight.strength
    && restoredStriped.delight.radius === expected.delight.radius
    && restoredStriped.delight.perChannel === expected.delight.perChannel,
    restoredStriped ? JSON.stringify(restoredStriped.delight) : "missing");
  check("marks are still quads", state.marks.every(m => m.points.length === 4));

  const restoredDepth = store.imageDepth(image.id);
  check("the depth map came back through the reload",
    !!restoredDepth && restoredDepth.width === depthWide && restoredDepth.height === depthTall,
    restoredDepth ? `${restoredDepth.width}x${restoredDepth.height}` : "none");
  check("with every value it was saved with",
    !!restoredDepth && restoredDepth.data.length === savedDepth.length
      && restoredDepth.data.every((v, i) => v === savedDepth[i]),
    restoredDepth ? `${restoredDepth.data[0]}…${restoredDepth.data[savedDepth.length - 1]}`
      : "none");
  await store.restore({
    ...documentSnapshot,
    images: documentSnapshot.images.map(i => (i.id === image.id
      ? { ...i, depth: { ...i.depth, width: depthWide + 5 } } : i)),
  });
  check("a depth record whose size disagrees with its bytes is dropped",
    store.imageDepth(image.id) === null);
  await store.restore(documentSnapshot);

  // ---- restore refuses what it cannot trust -------------------------------
  check("a document is stamped with the format it was written in",
    documentSnapshot.version === TX.schema.document
      && Number.isInteger(TX.schema.document),
    `${documentSnapshot.version} vs schema ${TX.schema.document}, app ${TX.version}`);
  check("a document from another format is refused",
    (await store.restore({ ...documentSnapshot, version: 99 })) === false);
  check("no document at all is refused", (await store.restore(null)) === false);

  const damaged = {
    ...documentSnapshot,
    images: [...documentSnapshot.images, { id: "ghost", name: "ghost.png", file: "not a blob" }],
    marks: [
      ...documentSnapshot.marks,
      { id: "short", imageId: documentSnapshot.images[0].id, points: [{ x: 1, y: 2 }] },
      { id: "orphan", imageId: "nobody", points: documentSnapshot.marks[0].points },
    ],
    textures: [...documentSnapshot.textures, { id: "noblob", name: "x" }],
  };
  await store.restore(damaged);
  check("an image with no usable file is skipped", !store.findImage("ghost"));
  check("a mark that is not a quad is skipped", !store.findMark("short"));
  check("a mark pointing at a missing image is skipped", !store.findMark("orphan"));
  check("a texture with no pixels is skipped", !store.findTexture("noblob"));
  check("the rest of a damaged document still loads",
    state.images.length === expected.images && state.textures.length === expected.textures,
    `images=${state.images.length} textures=${state.textures.length}`);

  await runGlbChecks(store, state, actions);
  await runHistoryChecks(store, state, actions);

  check("no error notices were raised", !notices.some(n => n.startsWith("error")), notices.join(" / "));

  mark.dispose();
  atlas.dispose();
}

async function runGlbChecks(store, state, actions) {
  step("building a 3D scene for the selected texture");

  const texture = state.textures[0];
  if (!texture) {
    check("there is a texture to export as a model", false);
    return;
  }
  store.select("texture", texture.id);
  state.settings.material = {
    shape: "plane", roughness: 0.4, metalness: 0.25, normal: 0.6, occlusion: 0.8,
  };

  // --- the scene, before it is written out ---
  const built = TX.gltf.buildScene(texture.id);
  check("a scene was built for the texture", !!built);
  if (!built) return;

  check("the scene holds the mesh and the studio rig",
    built.scene.children.length === 4 && built.scene.children.filter(c => c.isLight).length === 3,
    built.scene.children.map(c => c.type).join(","));
  check("the material carries the colour, the relief and the occlusion",
    !!built.material.map && !!built.material.normalMap && !!built.material.aoMap);
  check("the material took the roughness and metalness from the settings",
    built.material.roughness === 0.4 && built.material.metalness === 0.25,
    `${built.material.roughness}/${built.material.metalness}`);
  check("the mesh has the second UV set the occlusion map needs",
    !!built.mesh.geometry.getAttribute("uv1"));
  built.dispose();

  check("a texture that does not exist produces no scene",
    TX.gltf.buildScene("nope") === null);

  // --- the file ---
  step("writing a GLB through the three.js exporter");
  const buffer = await TX.gltf.textureToGlb(texture.id);
  check("the export produced bytes", buffer instanceof ArrayBuffer && buffer.byteLength > 0,
    buffer ? `${buffer.byteLength} bytes` : "nothing");

  const glb = TX.gltf.readGlb(buffer);
  check("the bytes parse as a binary glTF container", !!glb);
  if (!glb) return;
  check("it is glTF 2.0", glb.version === 2, String(glb.version));
  check("the container has a binary chunk holding the images", glb.binary > 0,
    `${glb.binary} bytes`);

  const json = glb.json;
  check("the file declares one mesh", json.meshes && json.meshes.length === 1,
    json.meshes ? String(json.meshes.length) : "none");

  const primitive = json.meshes[0].primitives[0];
  check("the mesh is indexed with positions, normals and UVs",
    primitive.indices !== undefined && primitive.attributes.POSITION !== undefined
    && primitive.attributes.NORMAL !== undefined && primitive.attributes.TEXCOORD_0 !== undefined,
    Object.keys(primitive.attributes).join(","));
  check("the mesh carries a second UV set for the occlusion map",
    primitive.attributes.TEXCOORD_1 !== undefined,
    Object.keys(primitive.attributes).join(","));

  const albedo = store.textureCanvas(texture.id);
  const bounds = json.accessors[primitive.attributes.POSITION];
  const width = bounds.max[0] - bounds.min[0];
  const height = bounds.max[1] - bounds.min[1];
  check("the exported plane is the texture's aspect ratio",
    Math.abs(width / height - albedo.width / albedo.height) < 1e-4,
    `${width.toFixed(4)}x${height.toFixed(4)} vs ${albedo.width}x${albedo.height}`);
  check("the exported plane is a unit across its longest side",
    Math.abs(Math.max(width, height) - 1) < 1e-4, Math.max(width, height).toFixed(4));
  check("the exported plane is flat",
    Math.abs(bounds.max[2] - bounds.min[2]) < 1e-9);

  const material = json.materials[primitive.material];
  const pbr = material.pbrMetallicRoughness;
  check("the material is PBR metallic-roughness", !!pbr);
  check("it has a base colour texture", pbr.baseColorTexture !== undefined);
  check("it has a normal texture", material.normalTexture !== undefined);
  check("it has an occlusion texture", material.occlusionTexture !== undefined);
  check("the roughness and metalness survived the round trip",
    Math.abs(pbr.roughnessFactor - 0.4) < 1e-6 && Math.abs(pbr.metallicFactor - 0.25) < 1e-6,
    `${pbr.roughnessFactor}/${pbr.metallicFactor}`);
  check("the material is double sided, as a single quad has to be", material.doubleSided === true);
  const expectedName = TX.io.safeFilename(texture.name, "texture");
  check("the material is named after the texture", material.name === expectedName,
    `${material.name} vs ${expectedName}`);

  check("three images were embedded, one per map",
    json.images && json.images.length === 3, json.images ? String(json.images.length) : "none");
  check("the images are embedded in the binary chunk rather than linked",
    json.images.every(i => i.bufferView !== undefined && !i.uri),
    json.images.map(i => i.mimeType).join(","));

  check("the studio lights were exported",
    (json.extensionsUsed || []).includes("KHR_lights_punctual"),
    (json.extensionsUsed || []).join(","));
  check("all three lights are in the file",
    json.extensions && json.extensions.KHR_lights_punctual
    && json.extensions.KHR_lights_punctual.lights.length === 3,
    json.extensions && json.extensions.KHR_lights_punctual
      ? json.extensions.KHR_lights_punctual.lights.map(l => l.name).join(",") : "none");

  // --- the settings really do steer the file ---
  step("re-exporting with a different shape and no derived maps");
  state.settings.material.shape = "sphere";
  state.settings.material.normal = 0;
  state.settings.material.occlusion = 0;
  const bare = TX.gltf.readGlb(await TX.gltf.textureToGlb(texture.id));
  check("a different shape exports different geometry",
    bare.json.meshes[0].primitives[0].attributes.POSITION
      !== undefined
    && bare.json.accessors[bare.json.meshes[0].primitives[0].attributes.POSITION].count
      > json.accessors[primitive.attributes.POSITION].count,
    `${bare.json.accessors[bare.json.meshes[0].primitives[0].attributes.POSITION].count} vertices`);
  const bareMaterial = bare.json.materials[bare.json.meshes[0].primitives[0].material];
  check("turning the relief off leaves the normal map out of the file",
    bareMaterial.normalTexture === undefined);
  check("turning the occlusion off leaves that map out too",
    bareMaterial.occlusionTexture === undefined);
  check("the base colour is still there", !!bareMaterial.pbrMetallicRoughness.baseColorTexture);
  check("and only one image was embedded", bare.json.images.length === 1,
    String(bare.json.images.length));

  // --- the bow the photograph's depth measured, in the written file ---
  step("exporting a bowed plane from a synthetic depth map");
  state.settings.material.shape = "plane";
  const bowMark = store.findMark(texture.markId);
  const bowImage = bowMark && store.findImage(bowMark.imageId);
  check("the texture still knows the photograph it came from", !!bowImage);
  if (bowImage) {
    const dw = Math.max(2, Math.round(bowImage.width));
    const dh = Math.max(2, Math.round(bowImage.height));
    const cx = bowMark.points.reduce((sum, p) => sum + p.x, 0) / 4;
    const cy = bowMark.points.reduce((sum, p) => sum + p.y, 0) / 4;
    const radius = Math.max(8, TX.geom.dist(bowMark.points[0], bowMark.points[2]) / 2);
    const field = new Float32Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const t = Math.hypot(x - cx, y - cy) / radius;
        field[y * dw + x] = 4 + 0.01 * x + Math.max(0, 1 - t * t);
      }
    }
    store.setImageDepth(bowImage.id, { data: field, width: dw, height: dh });

    check("a stored depth map is what the store hands back",
      store.imageDepth(bowImage.id) !== null);
    check("but a depth map alone is not a relief, until it is asked for",
      TX.material.settingsOf(state.settings.material).bow > 0
        && store.reliefFor(texture.id, state.settings.material) === null);

    state.settings.material.useDepth = true;
    state.settings.material.bow = 0.8;
    const bowed = TX.gltf.readGlb(await TX.gltf.textureToGlb(texture.id));
    const bowedPrimitive = bowed.json.meshes[0].primitives[0];
    const bowedBounds = bowed.json.accessors[bowedPrimitive.attributes.POSITION];
    check("the exported plane is no longer a single quad",
      bowedBounds.count > json.accessors[primitive.attributes.POSITION].count,
      `${bowedBounds.count} vertices`);
    check("and it is no longer flat",
      bowedBounds.max[2] - bowedBounds.min[2] > 0.01,
      (bowedBounds.max[2] - bowedBounds.min[2]).toFixed(4));
    check("while still fitting the texture's proportions",
      Math.abs((bowedBounds.max[0] - bowedBounds.min[0]) - (bounds.max[0] - bounds.min[0])) < 1e-6,
      `${(bowedBounds.max[0] - bowedBounds.min[0]).toFixed(4)}`);
    check("the second UV set survives the subdivision",
      bowedPrimitive.attributes.TEXCOORD_1 !== undefined,
      Object.keys(bowedPrimitive.attributes).join(","));

    // --- the depth scene itself, as a file ---
    step("exporting the depth scene for the photograph");
    const sceneBuffer = await TX.gltf.photoToGlb(bowImage.id);
    const sceneGlb = TX.gltf.readGlb(sceneBuffer);
    check("the depth scene writes a binary glTF", !!sceneGlb,
      sceneBuffer ? `${sceneBuffer.byteLength} bytes` : "nothing");
    if (sceneGlb) {
      const scenePrimitive = sceneGlb.json.meshes[0].primitives[0];
      const sceneBounds = sceneGlb.json.accessors[scenePrimitive.attributes.POSITION];
      check("it carries a mesh far larger than a quad", sceneBounds.count > 1000,
        `${sceneBounds.count} vertices`);
      check("with UVs, so the photograph lands on it",
        scenePrimitive.attributes.TEXCOORD_0 !== undefined,
        Object.keys(scenePrimitive.attributes).join(","));
      check("and real extent in every direction, depth included",
        sceneBounds.max[0] > sceneBounds.min[0] && sceneBounds.max[1] > sceneBounds.min[1]
          && sceneBounds.max[2] - sceneBounds.min[2] > 0.01,
        `${(sceneBounds.max[2] - sceneBounds.min[2]).toFixed(3)} deep`);
      check("the material is unlit rather than relit",
        (sceneGlb.json.extensionsUsed || []).includes("KHR_materials_unlit"),
        (sceneGlb.json.extensionsUsed || []).join(","));
      check("no lights were written with it",
        !(sceneGlb.json.extensionsUsed || []).includes("KHR_lights_punctual"));
      check("the photograph is embedded rather than linked",
        sceneGlb.json.images && sceneGlb.json.images.length === 1
          && sceneGlb.json.images[0].bufferView !== undefined,
        sceneGlb.json.images ? String(sceneGlb.json.images.length) : "none");
    }

    store.setImageDepth(bowImage.id, null);
    check("a photograph with no depth exports no scene",
      (await TX.gltf.photoToGlb(bowImage.id)) === null);
    store.setImageDepth(bowImage.id, { data: field, width: dw, height: dh });

    const beforeReload = TX.depthScene.build(store.imageDepth(bowImage.id),
      state.settings.depth);
    const reloaded = await store.snapshot();
    await store.restore(reloaded);
    const afterReload = TX.depthScene.build(store.imageDepth(bowImage.id),
      state.settings.depth);
    check("the depth scene rebuilds identically after a reload",
      !!beforeReload && !!afterReload
        && afterReload.getAttribute("position").count
          === beforeReload.getAttribute("position").count
        && afterReload.userData.triangles === beforeReload.userData.triangles,
      afterReload
        ? `${afterReload.userData.triangles} vs ${beforeReload.userData.triangles}` : "null");

    state.settings.material.bow = 0;
    const flattened = TX.gltf.readGlb(await TX.gltf.textureToGlb(texture.id));
    const flatBounds = flattened.json.accessors[
      flattened.json.meshes[0].primitives[0].attributes.POSITION];
    check("turning the bow off writes the flat quad again",
      flatBounds.count === 4 && Math.abs(flatBounds.max[2] - flatBounds.min[2]) < 1e-9,
      `${flatBounds.count} vertices`);

    state.settings.material.bow = 0.8;
    state.settings.material.useDepth = false;
    const switched = TX.gltf.readGlb(await TX.gltf.textureToGlb(texture.id));
    const switchedBounds = switched.json.accessors[
      switched.json.meshes[0].primitives[0].attributes.POSITION];
    check("and so does switching the depth off with the bow left up",
      switchedBounds.count === 4
        && Math.abs(switchedBounds.max[2] - switchedBounds.min[2]) < 1e-9,
      `${switchedBounds.count} vertices`);

    state.settings.material.bow = 0;
    state.settings.material.shape = "sphere";
  }

  // --- through the action the UI calls ---
  step("exporting through actions.exportGlb");
  const saved = [];
  const realSave = TX.io.saveBlob;
  TX.io.saveBlob = (blob, filename) => saved.push({ blob, filename });
  try {
    const ok = await actions.exportGlb(texture.id);
    check("the action reported success", ok === true);
    check("it saved one file", saved.length === 1, String(saved.length));
    check("named after the texture, with a glb extension",
      saved[0] && saved[0].filename === `${expectedName}.glb`, saved[0] && saved[0].filename);
    check("declared as a binary glTF",
      saved[0] && saved[0].blob.type === "model/gltf-binary", saved[0] && saved[0].blob.type);
    check("and the file has real contents", saved[0] && saved[0].blob.size > 1000,
      saved[0] && String(saved[0].blob.size));

    store.clearSelection();
    const refused = await actions.exportGlb();
    check("exporting with nothing selected is refused rather than writing an empty file",
      refused === false && saved.length === 1);
  } finally {
    TX.io.saveBlob = realSave;
  }

  store.select("texture", texture.id);
  state.settings.material = { shape: "plane", roughness: 0.65, metalness: 0, normal: 0.6, occlusion: 0.8 };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runHistoryChecks(store, state, actions) {
  const history = TX.history;
  history.start();
  history.clear();

  check("a fresh history has nothing to undo",
    !history.status.canUndo && !history.status.canRedo);

  const captured = store.documentSnapshot().settings;
  check("the timeline covers the settings that shape the output",
    ["gridSize", "padding", "supersample", "powerOfTwo", "weldRadius", "snapToGrid", "showGrid"]
      .every(key => key in captured),
    Object.keys(captured).join(","));
  check("and leaves out the ones that only shape the view",
    !("preview" in captured) && !("views" in captured) && !("props" in captured)
    && !("sway" in captured),
    Object.keys(captured).join(","));

  const texture = state.textures[0];
  const image = state.images[0];

  // ---- a plain field edit ------------------------------------------------
  const wasX = texture.x;
  texture.x = wasX + 137;
  history.commit();
  check("moving a texture is a step", history.status.canUndo);
  check("the step names itself by what changed", history.status.undoLabel === "Move texture",
    history.status.undoLabel);

  history.undo();
  check("undo puts the position back", store.findTexture(texture.id).x === wasX,
    String(store.findTexture(texture.id).x));
  check("undo makes a redo available", history.status.canRedo);
  history.redo();
  check("redo puts it back where it was",
    store.findTexture(texture.id).x === wasX + 137,
    String(store.findTexture(texture.id).x));
  history.undo();

  // ---- selection and view-only settings are not edits --------------------
  const depth = history.status.depth;
  store.select("texture", texture.id);
  state.settings.views.mode = "delta";
  state.settings.props.lighting = !state.settings.props.lighting;
  Object.assign(state.settings.preview, { cols: 5 });
  check("selecting and folding panels do not commit", history.commit() === false);
  check("and they leave the depth alone", history.status.depth === depth,
    `${depth} -> ${history.status.depth}`);

  // ---- an output setting is -----------------------------------------------
  const wasGrid = state.settings.gridSize;
  state.settings.gridSize = wasGrid === 32 ? 24 : 32;
  history.commit();
  check("an output setting is a step", history.status.undoLabel === "Grid size",
    history.status.undoLabel);
  history.undo();
  check("undo puts the setting back", state.settings.gridSize === wasGrid,
    String(state.settings.gridSize));

  // ---- lighting and tiling ------------------------------------------------
  const wasDelight = JSON.stringify(texture.delight);
  store.setDelight(texture.id, { mode: "gradient", strength: 0.75 });
  history.commit();
  check("a lighting change is a step", history.status.undoLabel === "Lighting",
    history.status.undoLabel);
  history.undo();
  check("undo puts the lighting back",
    JSON.stringify(store.findTexture(texture.id).delight) === wasDelight,
    JSON.stringify(store.findTexture(texture.id).delight));

  store.setTiling(texture.id, { mode: "feather", band: 0.25 });
  history.commit();
  check("a tiling change is a step", history.status.undoLabel === "Tiling",
    history.status.undoLabel);
  history.undo();
  check("undo puts the tiling back",
    store.findTexture(texture.id).tiling.mode !== "feather"
    || store.findTexture(texture.id).tiling.band !== 0.25,
    JSON.stringify(store.findTexture(texture.id).tiling));

  // ---- a drag is one step, not one per frame ------------------------------
  const beforeDrag = history.status.depth;
  const dragFrom = texture.x;
  for (let i = 1; i <= 24; i++) {
    texture.x = dragFrom + i;
    await sleep(4);
  }
  // quiet window must close without explicit commit
  await sleep(500);
  check("a drag commits itself without being asked", history.status.depth === beforeDrag + 1,
    `${beforeDrag} -> ${history.status.depth}`);
  history.undo();
  check("undoing a drag rewinds the whole gesture, not one frame",
    store.findTexture(texture.id).x === dragFrom,
    `${store.findTexture(texture.id).x} vs ${dragFrom}`);

  // ---- deleting a texture, pixels and all ---------------------------------
  const doomed = state.textures[state.textures.length - 1];
  const doomedId = doomed.id;
  const doomedIndex = state.textures.indexOf(doomed);
  const doomedPixel = pixel(store.assets.textures.get(doomedId).canvas, 2, 2);
  const textureCount = state.textures.length;

  store.removeTexture(doomedId);
  history.commit();
  check("deleting a texture is a step", history.status.undoLabel === "Delete 1 texture",
    history.status.undoLabel);
  check("the texture and its pixels are gone",
    !store.findTexture(doomedId) && !store.assets.textures.has(doomedId));

  history.undo();
  check("undo brings the texture back", !!store.findTexture(doomedId));
  check("it comes back in the same place in the stack",
    state.textures.indexOf(store.findTexture(doomedId)) === doomedIndex,
    `${state.textures.indexOf(store.findTexture(doomedId))} vs ${doomedIndex}`);
  check("its pixels come back with it",
    store.assets.textures.has(doomedId)
    && near(pixel(store.assets.textures.get(doomedId).canvas, 2, 2), doomedPixel, 2),
    store.assets.textures.has(doomedId)
      ? pixel(store.assets.textures.get(doomedId).canvas, 2, 2).join(",")
      : "no pixels");
  check("the count is back", state.textures.length === textureCount,
    `${state.textures.length}/${textureCount}`);

  // ---- deleting a photo, which cascades -----------------------------------
  const imageId = image.id;
  const cascadedMarks = store.marksOfImage(imageId).map(m => m.id);
  const cascadedTextures = state.textures
    .filter(t => cascadedMarks.includes(t.markId)).map(t => t.id);
  const imageCount = state.images.length;
  const markCount = state.marks.length;

  store.removeImage(imageId);
  history.commit();
  check("deleting a photo is a step", history.status.undoLabel === "Delete 1 image",
    history.status.undoLabel);
  check("it took its marks and textures with it",
    !store.findImage(imageId) && cascadedMarks.every(id => !store.findMark(id))
    && cascadedTextures.every(id => !store.findTexture(id)));

  history.undo();
  check("undo brings the photo back", !!store.findImage(imageId));
  check("and rebuilds its gpu source", store.assets.sources.has(imageId));
  check("and brings back everything that went with it",
    state.images.length === imageCount && state.marks.length === markCount
    && cascadedTextures.every(id => !!store.findTexture(id)),
    `images=${state.images.length}/${imageCount} marks=${state.marks.length}/${markCount}`);
  check("the resurrected textures still have their pixels",
    cascadedTextures.every(id => store.assets.textures.has(id)));

  // ---- re-extraction replaces pixels, so undo has to replace them back ----
  const live = store.findTexture(cascadedTextures[0]) || state.textures[0];
  if (live && live.markId) {
    const beforePixels = store.assets.textures.get(live.id).canvas;
    store.setMarkDomain(live.markId, { u1: 1.6 });
    actions.reextract(live.markId);
    history.commit();
    check("re-warping a mark is a step", history.status.canUndo);
    check("the pixels really were replaced",
      store.assets.textures.get(live.id).canvas !== beforePixels);
    history.undo();
    check("undo restores the earlier pixels, not just the geometry",
      store.assets.textures.get(live.id).canvas === beforePixels);
    check("and the domain that asked for them",
      Math.abs(store.findMark(live.markId).domain.u1 - 1) < 1e-9,
      String(store.findMark(live.markId).domain.u1));
  }

  // ---- a new edit clears the redo branch ----------------------------------
  const current = state.textures[0];
  current.y += 40;
  history.commit();
  history.undo();
  check("there is a redo to lose", history.status.canRedo);
  state.textures[0].y += 11;
  check("the fresh edit registered", history.commit() === true);
  check("a fresh edit drops the redo branch", !history.status.canRedo);

  // ---- undo runs out rather than falling over -----------------------------
  for (let i = 0; i < 200; i++) history.undo();
  check("undoing past the start is harmless", !history.status.canUndo);
  check("everything is still coherent",
    state.images.length > 0 && state.textures.every(t => store.assets.textures.has(t.id)),
    `images=${state.images.length} textures=${state.textures.length}`);

  // ---- across a reload ----------------------------------------------------
  while (history.status.canRedo) history.redo();

  const survivor = state.textures[0];
  const survivorId = survivor.id;
  const survivorPixel = pixel(store.assets.textures.get(survivorId).canvas, 2, 2);
  const before = state.textures.length;
  store.removeTexture(survivorId);
  history.commit();

  step("saving the session with its history and loading it back");
  const saved = await store.snapshot();
  check("the session document carries the history",
    !!saved.history && saved.history.steps.length > 1,
    saved.history ? `${saved.history.steps.length} steps` : "none");

  await store.restore(saved);
  history.stop();
  history.start();
  history.clear();
  const adopted = await history.adopt(saved.history);
  check("the history is adopted on the way back in", adopted === true);
  check("and there is something to undo again", history.status.canUndo,
    history.status.undoLabel);
  check("the step kept its name across the reload",
    history.status.undoLabel === "Delete 1 texture", history.status.undoLabel);

  history.undo();
  check("undoing a delete still works after a reload", !!store.findTexture(survivorId),
    `${state.textures.length}/${before}`);
  check("with the pixels it was deleted with",
    store.assets.textures.has(survivorId)
    && near(pixel(store.assets.textures.get(survivorId).canvas, 2, 2), survivorPixel, 2),
    store.assets.textures.has(survivorId)
      ? pixel(store.assets.textures.get(survivorId).canvas, 2, 2).join(",")
      : "no pixels");

  history.stop();
}

run().then(report).catch(err => {
  failures++;
  lines.push(`FAIL  threw: ${err && err.message}`);
  lines.push(String(err && err.stack).split("\n").slice(0, 5).join("\n"));
  report();
});
