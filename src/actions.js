import { TX } from "./tx.js";

const { snapTo } = TX.stage;

const MAX_REPROJECTION = 4096;

function create(deps) {
  const store = TX.store;
  const state = store.state;
  const { mark, atlas, notify, onFirstExtract } = deps;

  function snappedScale(size) {
    if (!state.settings.snapToGrid) return 1;
    const step = state.settings.gridSize;
    if (step <= 0) return 1;
    return Math.max(step, snapTo(size, step)) / size;
  }

  function nextFreeX() {
    return state.textures.reduce((max, t) => Math.max(max, t.x + t.width * t.scaleX), 0);
  }

  async function convert(scope) {
    const chosen = scope === "selected" ? store.selectedItems("image") : [];
    const images = chosen.length ? chosen : state.images.slice();

    if (!images.length) {
      notify(TX.t("actions.import_first"), "warning");
      return 0;
    }

    const jobs = [];
    for (const image of images) {
      for (const m of store.marksOfImage(image.id)) {
        if (m.dirty) jobs.push({ image, mark: m });
      }
    }

    if (!jobs.length) {
      notify(TX.t("actions.no_modified_marks"), "warning");
      return 0;
    }

    TX.history.name(jobs.length === 1 ? "history.extract" : { id: "history.extract_n", vars: { count: jobs.length } });

    const firstOnSheet = !state.textures.length;

    state.busy = true;
    let placeX = nextFreeX();
    let done = 0;
    let failed = 0;

    try {
      await TX.progress.run(jobs.length === 1 ? TX.t("actions.progress.extracting") : TX.t("actions.progress.extracting_n", { count: jobs.length }),
        () => TX.progress.each(jobs,
          (job, i, total) => TX.t("actions.progress.extract_item", { name: job.image.name, index: i + 1, total }),
          job => {
            const asset = store.assets.sources.get(job.image.id);
            if (!asset) {
              failed++;
              return;
            }

            let canvas = null;
            try {
              canvas = TX.warp.warpQuad(asset.source, job.mark.points, {
                supersample: state.settings.supersample,
                domain: job.mark.domain,
                curve: job.mark.curve,
                lens: job.image.lens,
              });
            } catch (err) {
              canvas = null;
            }

            if (!canvas) {
              failed++;
              return;
            }

            const existing = state.textures.find(t => t.markId === job.mark.id);
            if (existing) {
              store.setTextureCanvas(existing.id, canvas);
              existing.width = canvas.width;
              existing.height = canvas.height;
              atlas.refreshTexture(existing.id);
            } else {
              const scaleX = snappedScale(canvas.width);
              const scaleY = snappedScale(canvas.height);
              const texture = store.addTexture({
                markId: job.mark.id,
                name: textureName(job.image.name, job.mark.id),
                width: canvas.width,
                height: canvas.height,
                x: snapTo(placeX, state.settings.snapToGrid ? state.settings.gridSize : 0),
                y: 0,
                scaleX,
                scaleY,
              });
              store.setTextureCanvas(texture.id, canvas);
              placeX += canvas.width * scaleX + Math.max(2, state.settings.padding);
            }

            store.setMarkDirty(job.mark.id, false);
            done++;
          }));
    } finally {
      state.busy = false;
    }

    atlas.syncMeshes();
    if (done && firstOnSheet) {
      if (state.textures.length) store.select("texture", state.textures[0].id);
      if (typeof onFirstExtract === "function") onFirstExtract();
      else atlas.fitAll();
    }

    if (failed) {
      notify(TX.t(done === 1 ? "actions.extracted_with_fail_one" : "actions.extracted_with_fail_other",
        { done, failed }), "warning");
    } else {
      notify(TX.t(done === 1 ? "actions.extracted_one" : "actions.extracted_other", { count: done }),
        "success");
    }
    return done;
  }

  const DRAFT_SIDE = 1024;

  function reextract(markId, options) {
    const opts = options || {};
    const m = store.findMark(markId);
    if (!m) return false;
    const asset = store.assets.sources.get(m.imageId);
    const existing = state.textures.find(t => t.markId === markId);
    if (!asset || !existing) return false;

    let canvas = null;
    try {
      canvas = TX.warp.warpQuad(asset.source, m.points, {
        supersample: opts.draft ? 1 : state.settings.supersample,
        maxSide: opts.draft ? DRAFT_SIDE : 0,
        domain: m.domain,
        curve: m.curve,
        lens: (store.findImage(m.imageId) || {}).lens,
      });
    } catch (err) {
      canvas = null;
    }
    if (!canvas) return false;

    store.setTextureCanvas(existing.id, canvas, { quiet: !!opts.draft });
    if (!opts.draft) {
      const scaledWidth = existing.width * existing.scaleX;
      const scaledHeight = existing.height * existing.scaleY;
      existing.width = canvas.width;
      existing.height = canvas.height;
      existing.scaleX = scaledWidth / canvas.width;
      existing.scaleY = scaledHeight / canvas.height;
      store.setMarkDirty(markId, false);
    }
    atlas.refreshTexture(existing.id);
    atlas.syncMeshes();
    return true;
  }

  async function reprojectImage(markId) {
    const sole = store.soleSelected("mark");
    const quad = store.findMark(markId || (sole && sole.id));
    if (!quad) {
      notify(TX.t("actions.select_mark_rectify"), "warning");
      return null;
    }
    const image = store.findImage(quad.imageId);
    const asset = store.assets.sources.get(quad.imageId);
    if (!image || !asset) {
      notify(TX.t("actions.photo_gone"), "warning");
      return null;
    }

    const plan = TX.geom.rectifyPlan(quad.points, image.width, image.height, {
      maxSide: MAX_REPROJECTION,
      lens: TX.lens.forImage(image),
    });
    if (!plan) {
      notify(TX.t("actions.mark_too_flat"), "warning");
      return null;
    }

    const rectified = await TX.progress.run(TX.t("actions.progress.rectifying"), async report => {
      await report(0.1, TX.t("actions.progress.resampling", { width: plan.size.width, height: plan.size.height }));
      let out = null;
      try {
        out = TX.warp.warpQuad(asset.source, quad.points, {
          supersample: state.settings.supersample,
          domain: plan.domain,
          curve: null,
          lens: image.lens,
          size: plan.size,
        });
      } catch (err) {
        out = null;
      }
      if (!out) return null;
      await report(0.6, TX.t("actions.progress.encoding_photo"));
      const encoded = await TX.io.canvasToBlob(out);
      await report(0.85, TX.t("actions.progress.loading_back"));
      return { canvas: out, blob: encoded, element: await TX.io.decodeBlob(encoded) };
    });

    if (!rectified) {
      notify(TX.t("actions.rectify_empty"), "warning");
      return null;
    }
    const { canvas, blob, element } = rectified;
    const base = String(image.name || "photo").replace(/\.[^.]+$/, "");
    const name = `${base}-rectified.png`;

    TX.history.name("history.rectify_photograph");
    const added = store.addImage({
      name,
      width: canvas.width,
      height: canvas.height,
      x: image.x + image.width * image.scaleX + 32,
      y: image.y,
      file: new File([blob], name, { type: "image/png" }),
    });
    store.assets.sources.set(added.id, { element, source: TX.warp.createSource(element) });
    mark.syncMeshes();
    store.select("image", added.id);

    const percent = Math.round(plan.coverage * 100);
    notify(plan.clipped
      ? TX.t("actions.rectified_partial", { percent })
      : TX.t("actions.rectified_whole", { width: canvas.width, height: canvas.height }), "success");
    return added;
  }

  function textureName(imageName, markId) {
    const base = String(imageName || "texture").replace(/\.[^.]+$/, "");
    const index = state.textures.filter(t => t.name && t.name.startsWith(base)).length + 1;
    return `${base}-${String(index).padStart(2, "0")}`;
  }

  const wantsMaps = () => !!state.settings.exportMaps;

  function sameSize(source, width, height) {
    if (source.width === width && source.height === height) return source;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function atlasChannels(report) {
    const sheets = [];
    const channels = TX.material.EXPORT_CHANNELS;
    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];
      await report(0.2 + (0.6 * i) / channels.length, TX.t("actions.progress.deriving_sheet", { suffix: channel.suffix }));
      const sheet = atlas.compositeAll({
        surfaceOf: node => {
          const derived = TX.material.full(node.id);
          return derived ? derived[channel.slot] : null;
        },
        backdrop: channel.backdrop,
      });
      if (sheet) sheets.push({ channel, sheet });
    }
    return sheets;
  }

  async function exportAtlas() {
    const result = atlas.compositeAll();
    if (!result) {
      notify(TX.t("actions.nothing_to_export"), "warning");
      return;
    }

    if (!wantsMaps()) {
      const blob = await TX.progress.run(TX.t("actions.progress.exporting_atlas"), async report => {
        await report(null, TX.t("actions.progress.encoding_size", { width: result.width, height: result.height }));
        return TX.io.canvasToBlob(result.canvas);
      });
      TX.io.saveBlob(blob, "atlas.png");
      notify(TX.t("actions.exported_atlas", { width: result.width, height: result.height }), "success");
      return;
    }

    const entries = await TX.progress.run(TX.t("actions.progress.exporting_atlas_maps"), async report => {
      await report(0.1, TX.t("actions.progress.encoding_colour", { width: result.width, height: result.height }));
      const written = [
        { name: "atlas-colour.png", bytes: await TX.io.canvasToBytes(result.canvas) },
      ];
      for (const { channel, sheet } of await atlasChannels(report)) {
        await report(0.85, TX.t("actions.progress.encoding_sheet", { suffix: channel.suffix }));
        written.push({
          name: `atlas-${channel.suffix}.png`,
          bytes: await TX.io.canvasToBytes(sheet.canvas),
        });
      }
      return written;
    });

    TX.io.saveBlob(TX.zip.createZip(entries), "atlas.zip");
    notify(TX.t("actions.exported_sheets", { count: entries.length, width: result.width, height: result.height }), "success");
  }

  async function exportImage(imageId) {
    const id = imageId || store.selectedIds("image")[0];
    const image = id ? store.findImage(id) : null;
    if (!image) {
      notify(TX.t("actions.select_photo_save"), "warning");
      return false;
    }

    const base = TX.io.safeFilename(String(image.name || "photo").replace(/\.[^.]+$/, ""), "photo");
    if (image.file instanceof Blob) {
      const extension = /\.([a-z0-9]+)$/i.exec(String(image.name || ""));
      TX.io.saveBlob(image.file, `${base}.${extension ? extension[1] : "png"}`);
      notify(TX.t("actions.saved", { name: base }), "success");
      return true;
    }

    const asset = store.assets.sources.get(image.id);
    if (!asset || !asset.element) {
      notify(TX.t("actions.photo_pixels_gone"), "warning");
      return false;
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d").drawImage(asset.element, 0, 0, canvas.width, canvas.height);
    const blob = await TX.progress.run(TX.t("actions.progress.saving", { name: base }), async report => {
      await report(null, TX.t("actions.progress.encoding_size", { width: canvas.width, height: canvas.height }));
      return TX.io.canvasToBlob(canvas);
    });
    TX.io.saveBlob(blob, `${base}.png`);
    notify(TX.t("actions.saved_png", { name: base }), "success");
    return true;
  }

  async function exportIndividually() {
    const items = atlas.selectedAsCanvases();
    if (!items.length) {
      notify(TX.t("actions.nothing_to_export"), "warning");
      return;
    }

    if (items.length === 1 && !wantsMaps()) {
      const blob = await TX.io.canvasToBlob(items[0].canvas);
      TX.io.saveBlob(blob, `${TX.io.safeFilename(items[0].node.name, "texture")}.png`);
      notify(TX.t("actions.exported_one_texture"), "success");
      return;
    }

    const used = new Map();
    const entries = [];
    const maps = wantsMaps();
    await TX.progress.run(
      maps ? TX.t("actions.progress.exporting_textures_maps", { count: items.length })
        : TX.t("actions.progress.exporting_textures", { count: items.length }),
      () => TX.progress.each(items,
        (item, i, total) => TX.t(maps
          ? "actions.progress.deriving_encoding_texture" : "actions.progress.encoding_texture",
        { name: item.node.name, index: i + 1, total }),
        async item => {
          let name = TX.io.safeFilename(item.node.name, "texture");
          const seen = used.get(name) || 0;
          used.set(name, seen + 1);
          if (seen) name = `${name}-${seen + 1}`;
          entries.push({
            name: `${name}${maps ? "-colour" : ""}.png`,
            bytes: await TX.io.canvasToBytes(item.canvas),
          });
          if (!maps) return;

          const derived = TX.material.full(item.node.id);
          for (const channel of TX.material.EXPORT_CHANNELS) {
            const canvas = derived && derived[channel.slot];
            if (!canvas) continue;
            entries.push({
              name: `${name}-${channel.suffix}.png`,
              bytes: await TX.io.canvasToBytes(
                sameSize(canvas, item.canvas.width, item.canvas.height)),
            });
          }
        }));

    TX.io.saveBlob(TX.zip.createZip(entries), "textures.zip");
    notify(TX.t(entries.length === 1 ? "actions.exported_zip_one" : "actions.exported_zip_other", { count: entries.length }), "success");
  }

  async function exportGlb(textureId) {
    const id = textureId || store.selectedIds("texture")[0];
    const node = id ? store.findTexture(id) : null;
    if (!node) {
      notify(TX.t("actions.select_texture_model"), "warning");
      return false;
    }

    let buffer = null;
    try {
      buffer = await TX.progress.run(TX.t("actions.progress.exporting_named", { name: node.name }),
        async report => {
          await report(null, TX.t("actions.progress.deriving_material"));
          return TX.gltf.textureToGlb(node.id);
        });
    } catch (err) {
      buffer = null;
    }
    if (!buffer) {
      notify(TX.t("actions.model_build_failed"), "warning");
      return false;
    }

    const name = TX.io.safeFilename(node.name, "texture");
    TX.io.saveBlob(new Blob([buffer], { type: "model/gltf-binary" }), `${name}.glb`);
    notify(TX.t("actions.exported_glb", {
      name, kb: Math.max(1, Math.round(buffer.byteLength / 1024)),
    }), "success");
    return true;
  }

  async function exportSceneGlb(imageId) {
    const selectedMark = store.soleSelected("mark");
    const id = imageId || store.selectedIds("image")[0]
      || (selectedMark ? selectedMark.imageId : null);
    const image = id ? store.findImage(id) : null;
    if (!image) {
      notify(TX.t("actions.select_photo_depth_model"), "warning");
      return false;
    }
    if (!store.imageDepth(id)) {
      notify(TX.t("actions.no_depth_yet"), "warning");
      return false;
    }

    let buffer = null;
    try {
      buffer = await TX.gltf.photoToGlb(id);
    } catch (err) {
      buffer = null;
    }
    if (!buffer) {
      notify(TX.t("actions.depth_model_failed"), "warning");
      return false;
    }

    const name = `${TX.io.safeFilename(image.name, "scene")}-depth`;
    TX.io.saveBlob(new Blob([buffer], { type: "model/gltf-binary" }), `${name}.glb`);
    notify(TX.t("actions.exported_glb", {
      name, kb: Math.max(1, Math.round(buffer.byteLength / 1024)),
    }), "success");
    return true;
  }

  function packAtlas() {
    TX.history.name("history.pack_atlas");
    const result = atlas.packAll();
    if (!result) {
      notify(TX.t("actions.nothing_to_pack"), "warning");
      return;
    }
    notify(TX.t("actions.packed", { width: result.width, height: result.height }), "success");
  }

  async function clearSession() {
    TX.history.name("history.clear_session");
    store.resetAll();
    mark.syncMeshes();
    atlas.syncMeshes();
    mark.fitAll();
    atlas.fitAll();
    store.clearViewRecord();
    await TX.persist.clear();
    notify(TX.t("actions.session_cleared"), "success");
  }

  // Async exports need a catch: click handlers have nowhere to put a rejected promise.
  const reported = fn => async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      notify(TX.t("actions.failed", { message: (error && error.message) || String(error) }), "error");
      return null;
    }
  };

  return {
    convert: reported(convert),
    reextract,
    reprojectImage: reported(reprojectImage),
    exportAtlas: reported(exportAtlas),
    exportIndividually: reported(exportIndividually),
    exportImage: reported(exportImage),
    exportGlb: reported(exportGlb),
    exportSceneGlb: reported(exportSceneGlb),
    packAtlas,
    clearSession: reported(clearSession),
  };
}

TX.actions = { create };
