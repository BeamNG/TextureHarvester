
import { TX } from "../tx.js";

const MODE_META = [
  { value: "off", title: "overlay.off.title" },
  {
    value: "density",
    title: "overlay.density.title",
    short: "overlay.density.short",
    subtitle: "overlay.density.subtitle",
  },
  {
    value: "correspond",
    title: "overlay.correspond.title",
    short: "overlay.correspond.short",
    subtitle: "overlay.correspond.subtitle",
  },
  {
    value: "delta",
    title: "overlay.delta.title",
    short: "overlay.delta.short",
    subtitle: "overlay.delta.subtitle",
  },
  {
    value: "atlas",
    title: "overlay.atlas.title",
    short: "overlay.atlas.short",
    subtitle: "overlay.atlas.subtitle",
  },
  {
    value: "normal",
    title: "overlay.normal.title",
    short: "overlay.normal.short",
    subtitle: "overlay.normal.subtitle",
    channel: "normal",
  },
  {
    value: "roughness",
    title: "overlay.roughness.title",
    short: "overlay.roughness.short",
    subtitle: "overlay.roughness.subtitle",
    channel: "roughness",
  },
  {
    value: "occlusion",
    title: "overlay.occlusion.title",
    short: "overlay.occlusion.short",
    subtitle: "overlay.occlusion.subtitle",
    channel: "occlusion",
  },
  {
    value: "height",
    title: "overlay.height.title",
    short: "overlay.height.short",
    subtitle: "overlay.height.subtitle",
    channel: "height",
  },
  {
    value: "shading",
    title: "overlay.shading.title",
    short: "overlay.shading.short",
    subtitle: "overlay.shading.subtitle",
    channel: "shading",
  },
];

function modes() {
  return MODE_META.map(m => ({
    value: m.value,
    title: TX.t(m.title),
    short: m.short ? TX.t(m.short) : "",
    subtitle: m.subtitle ? TX.t(m.subtitle) : "",
    channel: m.channel,
  }));
}

const MODES = MODE_META;

const ATLAS_MODES = new Set(["atlas"]);
const PER_TEXTURE = new Set(["density", "delta", "correspond"]);

const MEASURED = new Set(["density", "delta"]);

const MARK_MODES = new Set([
  ...PER_TEXTURE,
  ...MODE_META.filter(m => m.channel).map(m => m.value),
]);

const CHANNELS = new Map(MODE_META.filter(m => m.channel).map(m => [m.value, m.channel]));

const CHANNEL_SOURCE = {
  normal: "overlay.source.normal",
  roughness: "overlay.source.roughness",
  occlusion: "overlay.source.occlusion",
  height: "overlay.source.height",
  shading: "overlay.source.shading",
};

const MARK_PATCHES = 16;

const cache = new Map();

function cached(key, build) {
  if (cache.has(key)) return cache.get(key);
  const value = build();
  if (cache.size > 96) cache.clear();
  cache.set(key, value);
  return value;
}

const pct = value => `${(value * 100).toFixed(value < 0.1 && value > 0 ? 1 : 0)}%`;

const ratio = value => {
  if (!Number.isFinite(value)) return "—";
  if (value >= 100) return `${Math.round(value)}×`;
  if (value >= 10) return `${value.toFixed(1)}×`;
  return `${value.toFixed(2)}×`;
};

const settings = () => TX.store.state.settings.views;

const modeOf = () => {
  const mode = settings().mode;
  return MODE_META.some(m => m.value === mode) ? mode : "off";
};


function densityOf(texture, grid) {
  const store = TX.store;
  const mark = texture.markId && store.findMark(texture.markId);
  const asset = store.assets.textures.get(texture.id);
  if (!mark || !asset) return null;
  const image = store.findImage(mark.imageId);
  const source = image && store.assets.sources.get(image.id);
  return TX.views.densityField({
    quad: mark.points,
    domain: mark.domain,
    curve: mark.curve,
    lens: TX.lens.forImage(image),
    width: asset.canvas.width,
    height: asset.canvas.height,
    scale: source && source.source ? source.source.scale : 1,
    grid,
  });
}

// Mirrored tiling doubles dimensions; compare against delight stage, not tiled output.
function deltaPair(texture) {
  const store = TX.store;
  const asset = store.assets.textures.get(texture.id);
  if (!asset) return null;
  const raw = asset.canvas;
  const output = store.textureCanvas(texture.id);
  if (output && output.width === raw.width && output.height === raw.height) {
    return { before: raw, after: output };
  }
  return {
    before: raw,
    after: TX.delight.resolve(texture.id, raw, texture.delight, asset.version),
  };
}

function keyFor(texture) {
  const store = TX.store;
  const asset = store.assets.textures.get(texture.id);
  if (!asset) return "";
  const mark = texture.markId && store.findMark(texture.markId);
  return [
    texture.id,
    store.state.pixelEpoch,
    asset.version,
    store.textureKey(texture.id),
    mark ? JSON.stringify([mark.points, mark.domain, mark.curve]) : "",
  ].join("|");
}

function fieldFor(texture, mode) {
  if (!texture || !MEASURED.has(mode)) return null;
  const key = keyFor(texture);
  if (!key) return null;
  return cached(`${mode}:${key}`, () => {
    if (mode === "density") return densityOf(texture);
    const pair = deltaPair(texture);
    return pair ? TX.views.colourDelta(pair.before, pair.after) : null;
  });
}

const paintedFor = (texture, mode, field) => cached(
  `paint:${mode}:${keyFor(texture)}`, () => TX.views.paintField(field, field.kind));


const mapperOfQuad = quad => (u, v) => ({
  x: quad[0].x + (quad[1].x - quad[0].x) * u + (quad[3].x - quad[0].x) * v,
  y: quad[0].y + (quad[1].y - quad[0].y) * u + (quad[3].y - quad[0].y) * v,
});

function outlineOf(at, steps) {
  const n = Math.max(1, steps);
  const path = [];
  for (let i = 0; i < n; i++) path.push(at(i / n, 0));
  for (let i = 0; i < n; i++) path.push(at(1, i / n));
  for (let i = 0; i < n; i++) path.push(at(1 - i / n, 1));
  for (let i = 0; i < n; i++) path.push(at(0, 1 - i / n));
  return path;
}

const clipTo = (ctx, path) => {
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.closePath();
  ctx.clip();
};

function drawThrough(ctx, image, at, patches) {
  const n = Math.max(1, patches);
  const sw = image.width / n;
  const sh = image.height / n;

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const p00 = at(col / n, row / n);
      const p10 = at((col + 1) / n, row / n);
      const p01 = at(col / n, (row + 1) / n);

      // Per source pixel, not unit square — 1×1 dest blits filter to nothing.
      const across = Math.hypot(p10.x - p00.x, p10.y - p00.y);
      const down = Math.hypot(p01.x - p00.x, p01.y - p00.y);
      // Half a screen pixel overlap in source pixels.
      const bx = across > 0 ? (0.5 * sw) / across : 0;
      const by = down > 0 ? (0.5 * sh) / down : 0;

      ctx.save();
      ctx.transform(
        (p10.x - p00.x) / sw, (p10.y - p00.y) / sw,
        (p01.x - p00.x) / sh, (p01.y - p00.y) / sh,
        p00.x, p00.y,
      );
      ctx.drawImage(image, col * sw, row * sh, sw, sh, 0, 0, sw + bx, sh + by);
      ctx.restore();
    }
  }
}

const formatValue = (field, value) =>
  (field.kind === "density" ? ratio(value) : value.toFixed(1));

function sample(field, u, v) {
  const col = Math.min(field.cols - 1, Math.max(0, Math.floor(u * field.cols)));
  const row = Math.min(field.rows - 1, Math.max(0, Math.floor(v * field.rows)));
  return field.data[row * field.cols + col];
}

function drawReadings(ctx, field, at) {
  const width = Math.hypot(at(1, 0.5).x - at(0, 0.5).x, at(1, 0.5).y - at(0, 0.5).y);
  const height = Math.hypot(at(0.5, 1).x - at(0.5, 0).x, at(0.5, 1).y - at(0.5, 0).y);
  const step = 76;
  const cols = Math.round(width / step);
  const rows = Math.round(height / step);
  if (cols < 1 || rows < 1 || cols * rows > 64) return;

  ctx.font = "600 10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const u = (col + 0.5) / cols;
      const v = (row + 0.5) / rows;
      const value = sample(field, u, v);
      if (value == null) continue;
      const { x, y } = at(u, v);
      const text = formatValue(field, value);
      const w = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x - w / 2 - 4, y - 8, w + 8, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, x, y + 0.5);
    }
  }
}

const OVERLAY_SIDES = [256, 512, 1024];

const derivedAt = new Map(); // only climbs; re-deriving on zoom-out is wasted work

function overlaySideFor(textureId, screen) {
  const wanted = Math.max(1, screen || 0) * 1.25;
  const needed = OVERLAY_SIDES.find(side => side >= wanted)
    || OVERLAY_SIDES[OVERLAY_SIDES.length - 1];
  const side = Math.max(needed, derivedAt.get(textureId) || 0);
  derivedAt.set(textureId, side);
  return side;
}

function channelFor(texture, mode, screen) {
  const slot = CHANNELS.get(mode);
  if (!slot || !texture) return null;
  const store = TX.store;
  const asset = store.assets.textures.get(texture.id);
  const albedo = store.textureCanvas(texture.id);
  if (!asset || !albedo) return null;
  const settings_ = TX.material.settingsOf(store.state.settings.material);
  const maps = TX.material.maps(texture.id, albedo, asset.canvas, texture.delight, settings_,
    asset.version, { maxSide: overlaySideFor(texture.id, screen) });
  return (maps && maps[slot]) || null;
}

const perTexture = mode => PER_TEXTURE.has(mode) || CHANNELS.has(mode);

async function choose(mode) {
  const state = TX.store.state;
  state.settings.views.mode = MODE_META.some(m => m.value === mode) ? mode : "off";

  if (CHANNELS.has(mode) && state.textures.length > 1) {
    const definition = modes().find(m => m.value === mode);
    await TX.progress.run(TX.t("overlay.progress.deriving", {
      name: definition ? definition.short : mode,
    }),
      () => TX.progress.each(state.textures,
        (texture, i, total) => TX.t("actions.progress.encoding_texture", {
          name: texture.name, index: i + 1, total,
        }),
        texture => channelFor(texture, mode)));
  }

  const app = TX.app;
  if (!app) return;
  for (const panel of [app.mark, app.atlas, app.tilingPanel]) {
    if (panel && panel.stage) panel.stage.requestRender();
  }
}

const SURFACE_SIDE = 1024;

function surfaceFor(texture, mode) {
  if (!texture || mode === "off" || mode === "correspond" || ATLAS_MODES.has(mode)) return null;
  if (CHANNELS.has(mode)) return channelFor(texture, mode);

  const field = fieldFor(texture, mode);
  const painted = field ? paintedFor(texture, mode, field) : null;
  if (!painted) return null;

  const albedo = TX.store.textureCanvas(texture.id);
  if (!albedo) return null;
  const strength = settings().overlay;
  return cached(`surface:${mode}:${keyFor(texture)}:${strength.toFixed(2)}`, () => {
    const level = TX.display.levelFor(albedo, SURFACE_SIDE);
    const base = TX.display.canvasAt(albedo, level);
    const canvas = document.createElement("canvas");
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(base, 0, 0);
    ctx.globalAlpha = strength;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(painted, 0, 0, canvas.width, canvas.height);
    return canvas;
  });
}

const colourOf = (texture, alpha) =>
  TX.views.itemColour(TX.store.state.textures.findIndex(t => t.id === texture.id), alpha);

function drawItemTint(ctx, texture, at) {
  const view = settings();
  const path = outlineOf(at, 24);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.closePath();
  ctx.fillStyle = colourOf(texture, 0.10 + 0.30 * view.overlay);
  ctx.fill();
  ctx.strokeStyle = colourOf(texture, 0.85);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  if (view.numbers) {
    const { x, y } = at(0.5, 0.5);
    const text = texture.name || "";
    if (!text) return true;
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(x - w / 2 - 5, y - 9, w + 10, 18);
    ctx.fillStyle = colourOf(texture, 1);
    ctx.fillText(text, x, y + 0.5);
  }
  return true;
}

function screenBoxOf(at) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outlineOf(at, 8)) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, size: Math.max(maxX - minX, maxY - minY) };
}

const PATCH_PIXELS = 96;

function drawTexture(stage, texture, at, maxPatches) {
  const mode = modeOf();
  const view = settings();
  const ctx = stage.ctx;
  const box = screenBoxOf(at);

  if (box.maxX < 0 || box.minX > stage.view.width
    || box.maxY < 0 || box.minY > stage.view.height) return false;

  if (mode === "correspond") return drawItemTint(ctx, texture, at);

  const map = CHANNELS.has(mode) ? channelFor(texture, mode, box.size) : null;
  const field = map ? null : fieldFor(texture, mode);
  const painted = field ? paintedFor(texture, mode, field) : null;
  const image = map || painted;
  if (!image) return false;

  const patches = Math.max(1, Math.min(maxPatches, Math.ceil(box.size / PATCH_PIXELS)));

  ctx.save();
  clipTo(ctx, outlineOf(at, patches > 1 ? patches : 1));
  ctx.globalAlpha = map ? 0.55 + 0.45 * view.overlay : view.overlay;
  ctx.imageSmoothingEnabled = true;
  drawThrough(ctx, TX.display.canvasAt(image, TX.display.levelFor(image, box.size)), at, patches);
  ctx.restore();

  if (field && view.numbers && mode !== "density") drawReadings(ctx, field, at);
  return true;
}

const drawTextureInQuad = (stage, texture, quad) =>
  drawTexture(stage, texture, mapperOfQuad(quad), 1);

function drawOccupancy(ctx, stage) {
  const state = TX.store.state;
  const report = TX.views.atlasOccupancy(state.textures);
  if (!report || !report.width || !report.height) return null;

  const { origin } = report;
  const a = stage.worldToScreen(origin.x, origin.y);
  const b = stage.worldToScreen(origin.x + report.width, origin.y + report.height);
  ctx.save();
  ctx.globalAlpha = settings().overlay;
  ctx.fillStyle = "rgba(192,57,43,0.55)";
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);

  ctx.globalCompositeOperation = "destination-out";
  for (const box of report.boxes) {
    const p = stage.worldToScreen(origin.x + box.left, origin.y + box.top);
    const q = stage.worldToScreen(origin.x + box.right, origin.y + box.bottom);
    ctx.fillStyle = "#000";
    ctx.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
  }
  ctx.restore();
  return report;
}


function readoutRows(field) {
  if (!field) return [];
  if (field.kind === "density") {
    return [
      [TX.t("overlay.readout.median"), ratio(field.median)],
      [TX.t("overlay.readout.range"), `${ratio(field.p05)} – ${ratio(field.p95)}`],
      [TX.t("overlay.readout.worst"), ratio(field.min), field.min < 0.5],
      [TX.t("overlay.readout.interpolated"), pct(field.magnified), field.magnified > 0.25],
      [TX.t("overlay.readout.unevenness"), ratio(field.unevenness), field.unevenness > 4],
    ];
  }
  if (field.kind === "delta") {
    return [
      [TX.t("overlay.readout.mean_delta_e"), field.mean.toFixed(2)],
      [TX.t("overlay.readout.p95"), field.p95.toFixed(2)],
      [TX.t("overlay.readout.max"), field.max.toFixed(2), field.max > 20],
      [TX.t("overlay.readout.visibly_changed"), pct(field.visible)],
    ];
  }
  return [];
}

const RAMPS = {
  density: field => ({
    colour: t => TX.views.diverging(t * 2 - 1),
    labels: field
      ? (stops => [ratio(2 ** -stops), TX.t("overlay.ramp.one_to_one"), ratio(2 ** stops)])(
        TX.views.densityStops(field))
      : [TX.t("overlay.ramp.short"), TX.t("overlay.ramp.one_to_one"), TX.t("overlay.ramp.spare")],
  }),
  delta: () => ({
    colour: t => TX.views.heat(t),
    labels: [TX.t("overlay.ramp.delta_zero"), "", TX.t("overlay.ramp.ge_p95")],
  }),
};

const rampFor = (mode, field) => (RAMPS[mode] ? RAMPS[mode](field) : null);

const LEGENDS = {
  atlas: [["#c0392b", "overlay.legend.wasted"]],
  normal: [["#8080ff", "overlay.legend.flat"], ["#ff80ff", "overlay.legend.pm_x"],
    ["#80ffff", "overlay.legend.pm_y"]],
  roughness: [["#101010", "overlay.legend.mirror"], ["#f0f0f0", "overlay.legend.matte"]],
  occlusion: [["#101010", "overlay.legend.occluded"], ["#f0f0f0", "overlay.legend.open"]],
  height: [["#101010", "overlay.legend.low"], ["#f0f0f0", "overlay.legend.high"]],
  shading: [["#101010", "overlay.legend.shadow"], ["#f0f0f0", "overlay.legend.lit"]],
};

function legendFor(mode) {
  if (mode !== "correspond") {
    const rows = LEGENDS[mode];
    return rows ? rows.map(([colour, id]) => [colour, TX.t(id)]) : rows;
  }
  return [0, 1, 2, 3].map(i => [TX.views.itemColour(i),
    i === 3 ? TX.t("overlay.legend.same_colour") : ""]);
}

const RAMP_HEIGHT = 7;

function drawRamp(ctx, ramp, x, y, width) {
  const steps = Math.max(2, Math.round(width));
  for (let i = 0; i < steps; i++) {
    const [r, g, b] = ramp.colour(i / (steps - 1));
    ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    ctx.fillRect(x + i, y, 1, RAMP_HEIGHT);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, RAMP_HEIGHT - 1);

  const [low, middle, high] = ramp.labels;
  ctx.font = "9px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  if (low) ctx.fillText(low, x, y + RAMP_HEIGHT + 2);
  if (high) {
    ctx.textAlign = "right";
    ctx.fillText(high, x + width, y + RAMP_HEIGHT + 2);
  }
  if (middle) {
    ctx.textAlign = "center";
    ctx.fillText(middle, x + width / 2, y + RAMP_HEIGHT + 2);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
}

function drawCard(ctx, stage, title, subtitle, rows, legend, ramp) {
  const pad = 8;
  const lineHeight = 14;
  ctx.font = "600 11px system-ui, sans-serif";
  const width = Math.max(
    132,
    ctx.measureText(title).width + pad * 2,
    ...rows.map(r => {
      ctx.font = "10px ui-monospace, monospace";
      return ctx.measureText(`${r[0]}    ${r[1]}`).width + pad * 2;
    }),
  );
  const rampHeight = ramp ? RAMP_HEIGHT + 14 : 0;
  const height = pad * 2 + lineHeight * (1 + (subtitle ? 1 : 0) + rows.length)
    + (legend && legend.length ? lineHeight : 0) + rampHeight;

  const x = 10;
  const y = stage.view.height - height - 10;
  if (y < 4) return;

  ctx.fillStyle = "rgba(12,13,16,0.82)";
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, width, height, 5);
  ctx.fill();
  ctx.stroke();

  let cursor = y + pad + 4;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(title, x + pad, cursor);
  cursor += lineHeight;

  if (subtitle) {
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.42)";
    ctx.fillText(subtitle, x + pad, cursor);
    cursor += lineHeight;
  }

  ctx.font = "10px ui-monospace, monospace";
  for (const [label, value, warn] of rows) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(label, x + pad, cursor);
    ctx.textAlign = "right";
    ctx.fillStyle = warn ? "#ff8a65" : "rgba(255,255,255,0.9)";
    ctx.fillText(value, x + width - pad, cursor);
    ctx.textAlign = "left";
    cursor += lineHeight;
  }

  if (ramp) {
    drawRamp(ctx, ramp, x + pad, cursor - 3, width - pad * 2);
    cursor += rampHeight;
  }

  if (legend && legend.length) {
    let swatch = x + pad;
    for (const [colour, label] of legend) {
      ctx.fillStyle = colour;
      ctx.fillRect(swatch, cursor - 4, 9, 8);
      swatch += 12;
      if (label) {
        ctx.font = "9px system-ui, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fillText(label, swatch, cursor);
        swatch += ctx.measureText(label).width + 8;
      }
    }
  }
}


function paintAtlas(stage, corners) {
  const mode = modeOf();
  if (mode === "off") return;
  const ctx = stage.ctx;
  const state = TX.store.state;
  const definition = modes().find(m => m.value === mode);

  let occupancy = null;
  let subject = null;
  let drew = 0;
  if (mode === "atlas") {
    occupancy = drawOccupancy(ctx, stage);
  } else {
    for (const texture of state.textures) {
      if (drawTextureInQuad(stage, texture, corners(texture))) drew++;
    }
  }

  let rows = [];
  if (mode === "atlas" && occupancy) {
    rows = [
      [TX.t("overlay.readout.bounds"), `${Math.round(occupancy.width)}×${Math.round(occupancy.height)}`],
      [TX.t("overlay.readout.efficiency"), pct(occupancy.efficiency), occupancy.efficiency < 0.6],
      [TX.t("overlay.readout.wasted"), `${Math.round((occupancy.width * occupancy.height - occupancy.used) / 1000)}k px`],
      [TX.t("overlay.readout.overlaps"), String(occupancy.overlaps.length), occupancy.overlaps.length > 0],
    ];
  } else if (mode === "correspond") {
    const paired = state.textures.filter(t => t.markId).length;
    rows = [
      [TX.t("overlay.readout.slices"), String(state.textures.length)],
      [TX.t("overlay.readout.traced"), `${paired} / ${state.textures.length}`],
      [TX.t("overlay.readout.also_on"), TX.t("overlay.readout.also_on_value")],
    ];
  } else if (CHANNELS.has(mode)) {
    rows = [[TX.t("overlay.readout.slices_showing"), `${drew} / ${state.textures.length}`, drew === 0]];
    if (!drew) rows.push([TX.t("overlay.readout.turn_on_with"), TX.t(CHANNEL_SOURCE[mode] || "—")]);
  } else {
    subject = fieldFor(TX.store.soleSelected("texture"), mode);
    rows = readoutRows(subject);
  }

  drawCard(ctx, stage, definition.title, definition.subtitle, rows, legendFor(mode),
    rampFor(mode, subject));
}

function paintTile(stage, tileWidth, tileHeight) {
  const mode = modeOf();
  if (!perTexture(mode)) return;
  const texture = TX.store.soleSelected("texture");
  if (!texture) return;

  const a = stage.worldToScreen(0, 0);
  const b = stage.worldToScreen(tileWidth, 0);
  const d = stage.worldToScreen(0, tileHeight);
  const quad = [a, b, { x: b.x + d.x - a.x, y: b.y + d.y - a.y }, d];
  if (!drawTextureInQuad(stage, texture, quad)) return;

  const definition = modes().find(m => m.value === mode);
  drawCard(stage.ctx, stage, definition.title, TX.t("overlay.subtitle.source_tile"), [],
    legendFor(mode), rampFor(mode, fieldFor(texture, mode)));
}

function paintMarks(stage, mapperFor) {
  const mode = modeOf();
  if (mode === "off") return;
  const definition = modes().find(m => m.value === mode);

  if (!MARK_MODES.has(mode)) {
    drawCard(stage.ctx, stage, definition.title, TX.t("overlay.subtitle.whole_sheet"),
      [[TX.t("overlay.readout.shown_on"), TX.t("overlay.readout.shown_on_atlas")]]);
    return;
  }

  const state = TX.store.state;
  let drew = false;

  for (const texture of state.textures) {
    if (!texture.markId) continue;
    const mark = TX.store.findMark(texture.markId);
    if (!mark) continue;
    const at = mapperFor(mark);
    if (!at) continue;
    if (drawTexture(stage, texture, at, MARK_PATCHES)) drew = true;
  }

  if (!drew) return;
  drawCard(stage.ctx, stage, definition.title, TX.t("overlay.subtitle.on_photo"), [],
    legendFor(mode), rampFor(mode, fieldFor(TX.store.soleSelected("texture"), mode)));
}

TX.viewOverlay = {
  MODES,
  modes,
  ATLAS_MODES,
  PER_TEXTURE,
  MARK_MODES,
  CHANNELS,
  perTexture,
  modeOf,
  choose,
  legendFor,
  fieldFor,
  channelFor,
  surfaceFor,
  readoutRows,
  paintAtlas,
  paintTile,
  paintMarks,
  ratio,
  pct,
};

