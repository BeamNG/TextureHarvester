// Headless Chrome; results in DOM for --dump-dom
import * as THREE from "three";
import { TX } from "./tx.js";
import "./core.js";

const lines = [];
let failures = 0;

function check(name, ok, detail) {
  if (!ok) failures++;
  lines.push(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
}

function makeSourceCanvas() {
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

const q = pts => pts.map(([x, y]) => ({ x, y }));

function pixelAt(canvas, x, y) {
  const d = canvas.getContext("2d").getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

const near = (got, want, tol) =>
  Math.abs(got[0] - want[0]) <= tol && Math.abs(got[1] - want[1]) <= tol && Math.abs(got[2] - want[2]) <= tol;

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const YELLOW = [255, 255, 0];

function run() {
  check("WebGL2 available", TX.warp.isSupported());
  if (!TX.warp.isSupported()) return;

  const source = TX.warp.createSource(makeSourceCanvas());
  check("source uploaded at full size", source.width === 200 && source.height === 100,
    `${source.width}x${source.height} scale=${source.scale}`);

  // --- identity warp: output must match the source exactly, unflipped ---
  const identity = TX.warp.warpQuad(source, q([[0, 0], [200, 0], [200, 100], [0, 100]]), { supersample: 1 });
  check("identity warp returns a canvas", !!identity);

  if (identity) {
    check("identity warp size is 200x100", identity.width === 200 && identity.height === 100,
      `${identity.width}x${identity.height}`);

    const tl = pixelAt(identity, 25, 12);
    const tr = pixelAt(identity, 175, 12);
    const bl = pixelAt(identity, 25, 87);
    const br = pixelAt(identity, 175, 87);

    check("identity: top-left is red", near(tl, RED, 6), tl.join(","));
    check("identity: top-right is green", near(tr, GREEN, 6), tr.join(","));
    check("identity: bottom-left is blue", near(bl, BLUE, 6), bl.join(","));
    check("identity: bottom-right is yellow", near(br, YELLOW, 6), br.join(","));
    check("identity: fully opaque", tl[3] === 255 && br[3] === 255, `${tl[3]},${br[3]}`);
  }

  // --- quadrant crop: marking only the top-right quadrant must yield solid green ---
  const crop = TX.warp.warpQuad(source, q([[100, 0], [200, 0], [200, 50], [100, 50]]), { supersample: 1 });
  if (crop) {
    check("crop size is 100x50", crop.width === 100 && crop.height === 50, `${crop.width}x${crop.height}`);
    const centre = pixelAt(crop, 50, 25);
    check("crop of top-right quadrant is green", near(centre, GREEN, 6), centre.join(","));
    const corner = pixelAt(crop, 3, 3);
    check("crop stays inside the quadrant", near(corner, GREEN, 6), corner.join(","));
  }

  // --- rotated marking order: quad given as BR,BL,TL,TR must be normalised ---
  const rotatedOrder = TX.geom.orderQuad(q([[200, 100], [0, 100], [0, 0], [200, 0]]));
  const reordered = TX.warp.warpQuad(source, rotatedOrder, { supersample: 1 });
  if (reordered) {
    const tl = pixelAt(reordered, 25, 12);
    check("point order is normalised before warping", near(tl, RED, 6), tl.join(","));
  }

  // --- perspective warp: a keystone must still land its corners on the right colours ---
  const keystone = TX.warp.warpQuad(source, q([[40, 10], [160, 25], [180, 80], [20, 70]]), { supersample: 2 });
  check("perspective warp returns a canvas", !!keystone);
  if (keystone) {
    const w = keystone.width;
    const h = keystone.height;
    const tl = pixelAt(keystone, 4, 4);
    const br = pixelAt(keystone, w - 5, h - 5);
    check("keystone: near top-left corner is red", near(tl, RED, 24), tl.join(","));
    check("keystone: near bottom-right corner is yellow", near(br, YELLOW, 24), br.join(","));
  }

  // --- out-of-bounds marking must produce transparency, not smeared edge pixels ---
  const outside = TX.warp.warpQuad(source, q([[-100, -60], [100, -60], [100, 40], [-100, 40]]), { supersample: 1 });
  if (outside) {
    const off = pixelAt(outside, 10, 10);
    check("outside the source image is transparent", off[3] === 0, `alpha=${off[3]}`);
    const on = pixelAt(outside, outside.width - 10, outside.height - 10);
    check("inside the source image still samples", on[3] === 255 && near(on, RED, 8), on.join(","));
  }

  // --- supersampling must not change dimensions ---
  const ss = TX.warp.warpQuad(source, q([[0, 0], [200, 0], [200, 100], [0, 100]]), { supersample: 4 });
  if (ss) {
    check("supersample keeps output dimensions", ss.width === 200 && ss.height === 100,
      `${ss.width}x${ss.height}`);
    const tl = pixelAt(ss, 25, 12);
    check("supersample keeps orientation", near(tl, RED, 8), tl.join(","));
  }

  // --- degenerate quad must be rejected rather than throwing ---
  let degenerate = "threw";
  try {
    degenerate = TX.warp.warpQuad(source, q([[0, 0], [10, 10], [20, 20], [30, 30]]), { supersample: 1 });
  } catch (err) {
    degenerate = "threw";
  }
  check("degenerate quad returns null", degenerate === null, String(degenerate));

  // --- zip ---
  const zipBlob = TX.zip.createZip([{ name: "a.txt", bytes: new TextEncoder().encode("hello") }]);
  check("zip is produced", zipBlob instanceof Blob && zipBlob.size > 60, `size=${zipBlob && zipBlob.size}`);

  // --- packer ---
  const packed = TX.pack.shelfPack(
    [{ id: "a", width: 64, height: 64 }, { id: "b", width: 32, height: 32 }, { id: "c", width: 128, height: 16 }],
    { padding: 2 },
  );
  check("packer places every item", packed.placements.length === 3);
  check("packer reports positive bounds", packed.width > 0 && packed.height > 0,
    `${packed.width}x${packed.height}`);
  const overlaps = (a, b) => {
    const ai = packed.placements.find(p => p.id === a);
    const bi = packed.placements.find(p => p.id === b);
    const as = { a: 64, b: 32, c: 128 };
    const hs = { a: 64, b: 32, c: 16 };
    return ai.x < bi.x + as[b] && ai.x + as[a] > bi.x && ai.y < bi.y + hs[b] && ai.y + hs[a] > bi.y;
  };
  check("packed items do not overlap", !overlaps("a", "b") && !overlaps("a", "c") && !overlaps("b", "c"));

  // --- stage geometry round trip ---
  const node = { x: 10, y: 20, width: 100, height: 50, rotation: 0.7, scaleX: 1.5, scaleY: 0.8 };
  const round = TX.stage.worldToLocal(node, TX.stage.localToWorld(node, { x: 33, y: 11 }));
  check("worldToLocal inverts localToWorld",
    Math.abs(round.x - 33) < 1e-6 && Math.abs(round.y - 11) < 1e-6,
    `${round.x.toFixed(4)},${round.y.toFixed(4)}`);
  check("hitTestNode accepts an interior point",
    TX.stage.hitTestNode(node, TX.stage.localToWorld(node, { x: 50, y: 25 })));
  check("hitTestNode rejects an exterior point",
    !TX.stage.hitTestNode(node, TX.stage.localToWorld(node, { x: 150, y: 25 })));

  runTilingChecks();
  runSnapChecks();
  runDisplayChecks();
  runLensChecks();
  runRectifyChecks();
  runFlipChecks();
  runProblemChecks();
  runSelectionChecks();
  runDockChecks();
  runDurableChecks();
  runLocalSpaceChecks(source);
  runProjectionChecks();
  runShaderAgreementChecks();
  runDelightChecks();
  runViewChecks();
  runMaterialChecks();
  runPbrChecks();
  runHistoryLabelChecks();
}

// ---- undo step names -----------------------------------------------------

function runHistoryLabelChecks() {
  const doc = over => ({
    images: [],
    marks: [],
    textures: [],
    settings: {},
    pending: { imageId: null, points: [] },
    pixels: new Map(),
    ...over,
  });

  const photo = (id, over) => ({ id, name: `${id}.png`, x: 0, y: 0, width: 8, height: 8, ...over });
  const quad = (id, over) => ({
    id,
    imageId: "a",
    dirty: false,
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    domain: { u0: 0, v0: 0, u1: 1, v1: 1 },
    curve: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    ...over,
  });
  const slice = (id, over) => ({
    id,
    name: id,
    markId: null,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: 4,
    height: 4,
    tiling: { mode: "none", band: 0.15 },
    delight: { mode: "none", strength: 1 },
    ...over,
  });

  const named = (name, before, after, want) => {
    const got = TX.history.describe(before, after);
    check(name, got === want, `${got} vs ${want}`);
  };

  named("importing one photo",
    doc(), doc({ images: [photo("a")] }), "Import 1 image");
  named("importing several is pluralised",
    doc(), doc({ images: [photo("a"), photo("b"), photo("c")] }), "Import 3 images");
  named("deleting a photo",
    doc({ images: [photo("a"), photo("b")] }), doc({ images: [photo("a")] }), "Delete 1 image");

  named("adding a mark",
    doc({ images: [photo("a")] }),
    doc({ images: [photo("a")], marks: [quad("m")] }),
    "Add 1 mark");
  named("deleting two marks",
    doc({ marks: [quad("m"), quad("n"), quad("o")] }), doc({ marks: [quad("m")] }),
    "Delete 2 marks");
  named("adding a texture",
    doc(), doc({ textures: [slice("t")] }), "Add 1 texture");
  named("deleting a texture",
    doc({ textures: [slice("t")] }), doc(), "Delete 1 texture");

  named("a cascade is named after the photo, not its debris",
    doc({ images: [photo("a")], marks: [quad("m")], textures: [slice("t")] }),
    doc(),
    "Delete 1 image");

  named("moving a mark corner",
    doc({ marks: [quad("m")] }),
    doc({ marks: [quad("m", { points: [{ x: 5, y: 5 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] })] }),
    "Move mark");
  named("extending the sampled window",
    doc({ marks: [quad("m")] }),
    doc({ marks: [quad("m", { domain: { u0: 0, v0: 0, u1: 1.5, v1: 1 } })] }),
    "Local space");
  named("bending an edge",
    doc({ marks: [quad("m")] }),
    doc({ marks: [quad("m", { curve: [{ x: 0, y: 0.3 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] })] }),
    "Bend edge");

  named("moving a texture",
    doc({ textures: [slice("t")] }), doc({ textures: [slice("t", { x: 40 })] }),
    "Move texture");
  named("scaling a texture",
    doc({ textures: [slice("t")] }), doc({ textures: [slice("t", { scaleX: 2 })] }),
    "Scale texture");
  named("rotating a texture",
    doc({ textures: [slice("t")] }), doc({ textures: [slice("t", { rotation: 0.4 })] }),
    "Rotate texture");
  named("changing the tiling",
    doc({ textures: [slice("t")] }),
    doc({ textures: [slice("t", { tiling: { mode: "feather", band: 0.15 } })] }),
    "Tiling");
  named("changing the lighting",
    doc({ textures: [slice("t")] }),
    doc({ textures: [slice("t", { delight: { mode: "gradient", strength: 1 } })] }),
    "Lighting");
  named("a move that also rotates is still a move",
    doc({ textures: [slice("t")] }),
    doc({ textures: [slice("t", { x: 40, rotation: 0 })] }),
    "Move texture");

  named("placing a mark point",
    doc({ images: [photo("a")] }),
    doc({ images: [photo("a")], pending: { imageId: "a", points: [{ x: 1, y: 1 }] } }),
    "Place point");
  named("abandoning a half-placed mark",
    doc({ pending: { imageId: "a", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] } }),
    doc(),
    "Clear points");

  named("a known setting reads as its label",
    doc({ settings: { gridSize: 16 } }), doc({ settings: { gridSize: 32 } }), "Grid size");
  named("a setting nobody has named yet still names itself",
    doc({ settings: { newFangled: 1 } }), doc({ settings: { newFangled: 2 } }), "newFangled");

  const pixels = version => new Map([["t", { canvas: null, version }]]);
  named("replacing the pixels of a texture that did not otherwise move",
    doc({ textures: [slice("t")], pixels: pixels(1) }),
    doc({ textures: [slice("t")], pixels: pixels(2) }),
    "Re-extract");
  named("something with no obvious cause still gets a name",
    doc({ textures: [slice("t")] }), doc({ textures: [slice("t", { markId: "m" })] }), "Edit");
}

// ---- projective geometry -------------------------------------------------

const close = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol);
const samePoint = (a, b, tol) => close(a.x, b.x, tol) && close(a.y, b.y, tol);
const fmt = p => (p ? `${p.x.toFixed(3)},${p.y.toFixed(3)}` : "null");

function intersect(a, b, c, d) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  return { x: a.x + t * rx, y: a.y + t * ry };
}

function bend(a, b, c) {
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const scale = Math.max(TX.geom.dist(a, b), TX.geom.dist(b, c), TX.geom.dist(a, c));
  return scale > 0 ? area / (scale * scale) : 0;
}

const crossRatio = (a, b, c, d) => (TX.geom.dist(a, c) * TX.geom.dist(b, d))
  / (TX.geom.dist(b, c) * TX.geom.dist(a, d));

const shoelace = ring => ring.reduce((sum, p, i) => {
  const n = ring[(i + 1) % ring.length];
  return sum + (p.x * n.y - n.x * p.y);
}, 0);

function permutations(items) {
  if (items.length <= 1) return [items];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

function runProjectionChecks() {
  const geom = TX.geom;

  const rect = q([[0, 0], [200, 0], [200, 100], [0, 100]]);
  const keystone = q([[40, 20], [190, 50], [160, 95], [70, 80]]);
  const parallelogram = q([[20, 10], [120, 30], [140, 90], [40, 70]]);

  // --- the defining property: the unit square's corners land on the quad's ---
  for (const [label, quad] of [["rectangle", rect], ["keystone", keystone], ["parallelogram", parallelogram]]) {
    const h = geom.squareToQuad(quad);
    const mapped = geom.UNIT_CORNERS.map(c => geom.applyHomography(h, c.x, c.y));
    const worst = Math.max(...mapped.map((p, i) => geom.dist(p, quad[i])));
    check(`the ${label}'s four corners map exactly`, worst < 1e-9, `worst=${worst.toExponential(2)}`);
  }

  check("a parallelogram gets no perspective term", (() => {
    const h = geom.squareToQuad(parallelogram);
    return h[6] === 0 && h[7] === 0 && h[8] === 1;
  })(), geom.squareToQuad(parallelogram).slice(6).join(","));
  check("a real keystone does get one", (() => {
    const h = geom.squareToQuad(keystone);
    return Math.abs(h[6]) > 1e-6 || Math.abs(h[7]) > 1e-6;
  })(), geom.squareToQuad(keystone).slice(6, 8).map(v => v.toExponential(2)).join(","));

  check("an axis-aligned rectangle is a plain scale and offset", (() => {
    const h = geom.squareToQuad(q([[10, 20], [110, 20], [110, 70], [10, 70]]));
    return close(h[0], 100) && close(h[1], 0) && close(h[2], 10)
      && close(h[3], 0) && close(h[4], 50) && close(h[5], 20)
      && h[6] === 0 && h[7] === 0;
  })(), geom.squareToQuad(q([[10, 20], [110, 20], [110, 70], [10, 70]])).join(","));

  // --- degenerate input has to be refused, not approximated ---
  check("four collinear points are refused",
    geom.squareToQuad(q([[0, 0], [10, 10], [20, 20], [30, 30]])) === null);
  check("three collinear corners are refused, in every position", [
    [[0, 0], [10, 10], [20, 20], [0, 40]],
    [[0, 0], [10, 10], [0, 40], [20, 20]],
    [[10, 10], [0, 0], [20, 20], [0, 40]],
    [[0, 40], [0, 0], [10, 10], [20, 20]],
  ].every(pts => geom.squareToQuad(q(pts)) === null));
  check("a quad collapsed onto one point is refused",
    geom.squareToQuad(q([[5, 5], [5, 5], [5, 5], [5, 5]])) === null);
  check("a quad collapsed onto one edge is refused",
    geom.squareToQuad(q([[0, 0], [10, 0], [10, 0], [0, 0]])) === null);
  check("a degenerate quad never reaches the warp",
    TX.warp.warpQuad(TX.warp.createSource(makeSourceCanvas()),
      q([[0, 0], [10, 10], [20, 20], [0, 40]]), {}) === null);
  check("but a legitimately thin quad is not mistaken for one",
    geom.squareToQuad(q([[0, 0], [500, 0.4], [500, 1.6], [0, 1]])) !== null);

  // --- projective invariants ---
  const h = geom.squareToQuad(keystone);

  check("straight lines stay straight", (() => {
    let worst = 0;
    for (let v = 0; v <= 1.0001; v += 0.25) {
      const a = geom.applyHomography(h, 0, v);
      const b = geom.applyHomography(h, 1, v);
      for (let t = 0.1; t < 0.95; t += 0.1) {
        worst = Math.max(worst, bend(a, b, geom.applyHomography(h, t, v)));
      }
    }
    const d0 = geom.applyHomography(h, 0, 0);
    const d1 = geom.applyHomography(h, 1, 1);
    for (let t = 0.1; t < 0.95; t += 0.1) {
      worst = Math.max(worst, bend(d0, d1, geom.applyHomography(h, t, t)));
    }
    return worst < 1e-9;
  })());

  check("the cross-ratio of four points on a line is preserved", (() => {
    const us = [0.1, 0.35, 0.6, 0.9];
    const expected = ((us[2] - us[0]) * (us[3] - us[1])) / ((us[2] - us[1]) * (us[3] - us[0]));
    let worst = 0;
    for (const v of [0, 0.3, 0.75, 1]) {
      const pts = us.map(u => geom.applyHomography(h, u, v));
      worst = Math.max(worst, Math.abs(crossRatio(...pts) - expected));
    }
    return worst < 1e-9;
  })());

  const topMid = geom.applyHomography(h, 0.5, 0);
  const chordMid = { x: (keystone[0].x + keystone[1].x) / 2, y: (keystone[0].y + keystone[1].y) / 2 };
  check("the midpoint is not preserved under perspective",
    geom.dist(topMid, chordMid) > 0.5 && bend(keystone[0], keystone[1], topMid) < 1e-9,
    `${fmt(topMid)} vs chord ${fmt(chordMid)}`);
  check("but it is preserved for a parallelogram", (() => {
    const ph = geom.squareToQuad(parallelogram);
    const mid = geom.applyHomography(ph, 0.5, 0);
    return samePoint(mid, {
      x: (parallelogram[0].x + parallelogram[1].x) / 2,
      y: (parallelogram[0].y + parallelogram[1].y) / 2,
    }, 1e-9);
  })());

  check("the u vanishing point is where the top and bottom edges meet", (() => {
    const fromMatrix = { x: h[0] / h[6], y: h[3] / h[6] };
    const fromEdges = intersect(keystone[0], keystone[1], keystone[3], keystone[2]);
    return fromEdges && geom.dist(fromMatrix, fromEdges) < 1e-6;
  })(), `${fmt({ x: h[0] / h[6], y: h[3] / h[6] })} vs ${fmt(intersect(keystone[0], keystone[1], keystone[3], keystone[2]))}`);
  check("the v vanishing point is where the left and right edges meet", (() => {
    const fromMatrix = { x: h[1] / h[7], y: h[4] / h[7] };
    const fromEdges = intersect(keystone[0], keystone[3], keystone[1], keystone[2]);
    return fromEdges && geom.dist(fromMatrix, fromEdges) < 1e-6;
  })(), `${fmt({ x: h[1] / h[7], y: h[4] / h[7] })} vs ${fmt(intersect(keystone[0], keystone[3], keystone[1], keystone[2]))}`);
  check("extending far along the surface converges on that vanishing point", (() => {
    const vanishing = { x: h[0] / h[6], y: h[3] / h[6] };
    const near = geom.applyHomography(h, 1e4, 0.5);
    const far = geom.applyHomography(h, 1e7, 0.5);
    return geom.dist(far, vanishing) < geom.dist(near, vanishing) / 100;
  })());

  check("the centre lands where the diagonals cross", (() => {
    const centre = geom.applyHomography(h, 0.5, 0.5);
    const crossing = intersect(keystone[0], keystone[2], keystone[1], keystone[3]);
    return crossing && geom.dist(centre, crossing) < 1e-9;
  })(), `${fmt(geom.applyHomography(h, 0.5, 0.5))} vs ${fmt(intersect(keystone[0], keystone[2], keystone[1], keystone[3]))}`);

  // --- numerical behaviour away from the origin and at extreme aspect ratios ---
  check("a quad far from the origin still maps its corners", (() => {
    const far = q([[100040, 250020], [100190, 250050], [100160, 250095], [100070, 250080]]);
    const fh = geom.squareToQuad(far);
    return geom.UNIT_CORNERS.every((c, i) =>
      geom.dist(geom.applyHomography(fh, c.x, c.y), far[i]) < 1e-4);
  })());
  check("a very thin quad still maps its corners", (() => {
    const thin = q([[0, 0], [500, 0.4], [500, 1.6], [0, 1]]);
    const th = geom.squareToQuad(thin);
    return th && geom.UNIT_CORNERS.every((c, i) =>
      geom.dist(geom.applyHomography(th, c.x, c.y), thin[i]) < 1e-9);
  })());
  check("a mirrored quad is handled like any other", (() => {
    const mirrored = q([[190, 50], [40, 20], [70, 80], [160, 95]]);
    const mh = geom.squareToQuad(mirrored);
    return mh && geom.UNIT_CORNERS.every((c, i) =>
      geom.dist(geom.applyHomography(mh, c.x, c.y), mirrored[i]) < 1e-9);
  })());

  // --- inversion ---
  check("a matrix times its inverse is the identity", (() => {
    const inv = geom.invert3(h);
    let worst = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) sum += h[r * 3 + k] * inv[k * 3 + c];
        worst = Math.max(worst, Math.abs(sum - (r === c ? 1 : 0)));
      }
    }
    return worst < 1e-9;
  })());
  check("inverting twice returns the original map", (() => {
    const twice = geom.invert3(geom.invert3(h));
    const k = twice[8];
    return twice.every((v, i) => Math.abs(v / k - h[i]) < 1e-9);
  })());
  check("the quad's corners invert back to the unit square", (() => {
    const inv = geom.quadToSquare(keystone);
    return keystone.every((p, i) =>
      geom.dist(geom.applyHomography(inv, p.x, p.y), geom.UNIT_CORNERS[i]) < 1e-12);
  })());
  check("a singular matrix inverts to null",
    geom.invert3([1, 2, 3, 2, 4, 6, 3, 6, 9]) === null
    && geom.invert3([0, 0, 0, 0, 0, 0, 0, 0, 0]) === null);
  check("a non-finite matrix inverts to null",
    geom.invert3([NaN, 0, 0, 0, 1, 0, 0, 0, 1]) === null
    && geom.invert3([Infinity, 0, 0, 0, 1, 0, 0, 0, 1]) === null);
  check("quadToSquare refuses a degenerate quad",
    geom.quadToSquare(q([[0, 0], [1, 1], [2, 2], [3, 3]])) === null);

  // --- corner ordering ---
  for (const [label, quad] of [
    ["a keystone", keystone],
    ["a diamond", q([[100, 20], [180, 100], [100, 180], [20, 100]])],
    ["a rectangle", rect],
  ]) {
    const perms = permutations(quad);
    const reference = geom.orderQuad(perms[0]);
    const stable = perms.every(p => {
      const ordered = geom.orderQuad(p);
      return ordered.every((pt, i) => pt === reference[i]);
    });
    check(`all 24 orderings of ${label} agree`, stable && perms.length === 24,
      `${perms.length} permutations`);
  }
  check("ordering an already-ordered quad leaves it alone", (() => {
    const ordered = geom.orderQuad(keystone);
    return ordered.every((p, i) => p === keystone[i]);
  })());
  check("ordering starts at the top-left corner", (() => {
    const ordered = geom.orderQuad(rect);
    return ordered[0].x === 0 && ordered[0].y === 0
      && ordered[1].x === 200 && ordered[2].y === 100;
  })(), geom.orderQuad(rect).map(fmt).join(" "));
  check("a self-intersecting order is untangled into a simple ring", (() => {
    const bowtie = [rect[0], rect[2], rect[1], rect[3]];
    const ordered = geom.orderQuad(bowtie);
    return !intersect2(ordered[0], ordered[1], ordered[2], ordered[3])
      && !intersect2(ordered[1], ordered[2], ordered[3], ordered[0]);
  })());
  check("every ordering winds the same way", [keystone, rect, parallelogram]
    .every(quad => permutations(quad).every(p => shoelace(geom.orderQuad(p)) > 0)));
  check("ordering refuses anything that is not four points",
    geom.orderQuad([]) === null && geom.orderQuad(rect.slice(0, 3)) === null
    && geom.orderQuad([...rect, { x: 1, y: 1 }]) === null);

  // --- containment ---
  check("containment agrees with the local coordinates", (() => {
    const inv = geom.quadToSquare(keystone);
    let disagreements = 0;
    let tested = 0;
    for (let y = 0; y <= 120; y += 3) {
      for (let x = 0; x <= 200; x += 3) {
        const local = geom.applyHomography(inv, x, y);
        const margin = Math.min(local.x, local.y, 1 - local.x, 1 - local.y);
        if (Math.abs(margin) < 0.01) continue;
        tested++;
        const byLocal = local.x > 0 && local.x < 1 && local.y > 0 && local.y < 1;
        if (byLocal !== geom.pointInQuad({ x, y }, keystone)) disagreements++;
      }
    }
    return tested > 1000 && disagreements === 0;
  })());
  check("the centroid is inside and a distant point is not",
    geom.pointInQuad({ x: 115, y: 61 }, keystone)
    && !geom.pointInQuad({ x: -50, y: 61 }, keystone)
    && !geom.pointInQuad({ x: 1000, y: 1000 }, keystone));

  // --- output dimensions ---
  check("a rectangle measures its own size", (() => {
    const d = geom.quadDimensions(rect);
    return close(d.width, 200, 1e-9) && close(d.height, 100, 1e-9);
  })(), JSON.stringify(geom.quadDimensions(rect)));
  check("rotating a rectangle does not change its size", (() => {
    const a = Math.PI / 7;
    const spun = rect.map(p => ({
      x: p.x * Math.cos(a) - p.y * Math.sin(a),
      y: p.x * Math.sin(a) + p.y * Math.cos(a),
    }));
    const d = geom.quadDimensions(spun);
    return close(d.width, 200, 1e-9) && close(d.height, 100, 1e-9);
  })());
  check("a trapezoid averages its opposite sides", (() => {
    const d = geom.quadDimensions(q([[50, 0], [150, 0], [200, 50], [0, 50]]));
    return close(d.width, 150, 1e-9) && close(d.height, Math.hypot(50, 50), 1e-9);
  })(), JSON.stringify(geom.quadDimensions(q([[50, 0], [150, 0], [200, 50], [0, 50]]))));

  runCoonsChecks();
  runDomainChecks(keystone);
}

function intersect2(a, b, c, d) {
  const side = (p, q1, q2) => Math.sign((q2.x - q1.x) * (p.y - q1.y) - (q2.y - q1.y) * (p.x - q1.x));
  return side(a, c, d) * side(b, c, d) < 0 && side(c, a, b) * side(d, a, b) < 0;
}

function runCoonsChecks() {
  const geom = TX.geom;

  const bent = geom.flatCurve();
  bent[0] = { x: 0.05, y: -0.18 };
  bent[1] = { x: 0.12, y: 0.03 };
  bent[2] = { x: -0.04, y: 0.15 };
  bent[3] = { x: -0.09, y: -0.02 };

  check("an edge curve starts and ends on its corners", (() => {
    let worst = 0;
    for (let e = 0; e < 4; e++) {
      worst = Math.max(worst,
        geom.dist(geom.edgePoint(bent, e, 0), geom.UNIT_CORNERS[e]),
        geom.dist(geom.edgePoint(bent, e, 1), geom.UNIT_CORNERS[(e + 1) % 4]));
    }
    return worst < 1e-12;
  })());
  check("the deviation is reached exactly at the middle of each edge", (() => {
    let worst = 0;
    for (let e = 0; e < 4; e++) {
      const a = geom.UNIT_CORNERS[e];
      const b = geom.UNIT_CORNERS[(e + 1) % 4];
      const want = { x: (a.x + b.x) / 2 + bent[e].x, y: (a.y + b.y) / 2 + bent[e].y };
      worst = Math.max(worst, geom.dist(geom.edgePoint(bent, e, 0.5), want));
    }
    return worst < 1e-12;
  })());

  check("the patch interpolates all four boundary curves", (() => {
    let worst = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const s = Math.min(1, t);
      worst = Math.max(worst,
        geom.dist(geom.coonsPoint(bent, s, 0), geom.edgePoint(bent, 0, s)),
        geom.dist(geom.coonsPoint(bent, 1, s), geom.edgePoint(bent, 1, s)),
        geom.dist(geom.coonsPoint(bent, s, 1), geom.edgePoint(bent, 2, 1 - s)),
        geom.dist(geom.coonsPoint(bent, 0, s), geom.edgePoint(bent, 3, 1 - s)));
    }
    return worst < 1e-12;
  })());
  check("all four corners stay pinned with every edge bent", (() => {
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    return corners.every(([u, v], i) =>
      geom.dist(geom.coonsPoint(bent, u, v), geom.UNIT_CORNERS[i]) < 1e-12);
  })());

  // ---- the edges are cubics -------------------------------------------------

  check("a flat curve is the identity, not merely close to it", (() => {
    const flat = geom.flatCurve();
    let worst = 0;
    for (let u = 0; u <= 1.0001; u += 0.125) {
      for (let v = 0; v <= 1.0001; v += 0.125) {
        const p = geom.coonsPoint(flat, Math.min(1, u), Math.min(1, v));
        worst = Math.max(worst, geom.dist(p, { x: Math.min(1, u), y: Math.min(1, v) }));
      }
    }
    return worst < 1e-15;
  })());

  check("the old single-deviation shape converts exactly", (() => {
    const legacy = [{ x: 0.05, y: -0.18 }, { x: 0.12, y: 0.03 },
      { x: -0.04, y: 0.15 }, { x: -0.09, y: -0.02 }];
    const migrated = geom.curveOf(legacy);
    let worst = 0;
    for (let e = 0; e < 4; e++) {
      const a = geom.UNIT_CORNERS[e];
      const b = geom.UNIT_CORNERS[(e + 1) % 4];
      const c = { x: (a.x + b.x) / 2 + 2 * legacy[e].x, y: (a.y + b.y) / 2 + 2 * legacy[e].y };
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const s = 1 - Math.min(1, t);
        const u = Math.min(1, t);
        const want = {
          x: s * s * a.x + 2 * s * u * c.x + u * u * b.x,
          y: s * s * a.y + 2 * s * u * c.y + u * u * b.y,
        };
        worst = Math.max(worst, geom.dist(geom.edgePoint(migrated, e, u), want));
      }
    }
    return worst < 1e-15;
  })());

  check("a control offset round-trips through the position it puts the handle at", (() => {
    const curve = geom.flatCurve();
    curve[1] = { a: { x: 0.2, y: -0.1 }, b: { x: -0.05, y: 0.3 } };
    let worst = 0;
    for (let which = 0; which < 2; which++) {
      const at = geom.edgeControls(curve, 1)[which];
      const back = geom.controlOffset(1, which, at);
      const want = which ? curve[1].b : curve[1].a;
      worst = Math.max(worst, geom.dist(back, want));
    }
    return worst < 1e-15;
  })());

  check("opposite controls make an S whose middle is back on the chord", (() => {
    const curve = geom.flatCurve();
    curve[0] = { a: { x: 0, y: -0.2 }, b: { x: 0, y: 0.2 } };
    const quarter = geom.edgePoint(curve, 0, 0.25);
    const middle = geom.edgePoint(curve, 0, 0.5);
    const threeQuarter = geom.edgePoint(curve, 0, 0.75);
    return quarter.y < -0.02 && threeQuarter.y > 0.02 && Math.abs(middle.y) < 1e-15;
  })());

  check("one control does not move where the other one sits", (() => {
    const curve = geom.flatCurve();
    const before = geom.edgeControls(curve, 2)[1];
    curve[2] = { a: { x: 0.4, y: 0.25 }, b: { x: 0, y: 0 } };
    return geom.dist(geom.edgeControls(curve, 2)[1], before) < 1e-15;
  })());

  check("bending two edges is the sum of bending each", (() => {
    const a = geom.flatCurve();
    a[0] = { x: 0.05, y: -0.18 };
    const b = geom.flatCurve();
    b[2] = { x: -0.04, y: 0.15 };
    const both = geom.flatCurve();
    both[0] = a[0];
    both[2] = b[2];
    let worst = 0;
    for (let u = 0; u <= 1.0001; u += 0.2) {
      for (let v = 0; v <= 1.0001; v += 0.2) {
        const pa = geom.coonsPoint(a, u, v);
        const pb = geom.coonsPoint(b, u, v);
        const pboth = geom.coonsPoint(both, u, v);
        worst = Math.max(worst,
          Math.abs(pboth.x - (pa.x + pb.x - u)), Math.abs(pboth.y - (pa.y + pb.y - v)));
      }
    }
    return worst < 1e-12;
  })());
  check("doubling a deviation doubles the displacement", (() => {
    const one = geom.flatCurve();
    one[0] = { x: 0.03, y: -0.1 };
    const two = geom.flatCurve();
    two[0] = { x: 0.06, y: -0.2 };
    const p1 = geom.coonsPoint(one, 0.5, 0.25);
    const p2 = geom.coonsPoint(two, 0.5, 0.25);
    return Math.abs((p2.y - 0.25) - 2 * (p1.y - 0.25)) < 1e-12;
  })());
  check("bending fades out across the patch rather than jumping", (() => {
    const curve = geom.flatCurve();
    curve[0] = { x: 0, y: -0.2 };
    const offsets = [0, 0.25, 0.5, 0.75, 1].map(v => geom.coonsPoint(curve, 0.5, v).y - v);
    const monotone = offsets.every((o, i) => i === 0 || Math.abs(o) <= Math.abs(offsets[i - 1]) + 1e-12);
    return monotone && Math.abs(offsets[0] + 0.2) < 1e-12 && Math.abs(offsets[4]) < 1e-12;
  })());

  check("a curve with a missing entry is treated as unbent",
    geom.isFlatCurve(geom.curveOf([null, undefined, {}, { x: 0, y: 0 }])));
  check("a curve of the wrong length falls back to flat",
    geom.curveOf([{ x: 1, y: 1 }]).length === 4
    && geom.isFlatCurve(geom.curveOf([{ x: 1, y: 1 }])));
  check("edgePoint tolerates a curve entry that is missing",
    geom.dist(geom.edgePoint([], 0, 0.5), { x: 0.5, y: 0 }) < 1e-12);
}

function runDomainChecks(quad) {
  const geom = TX.geom;
  const h = geom.squareToQuad(quad);
  const flat = geom.flatCurve();

  check("a sub-rectangle's corners are exactly the mapped local corners", (() => {
    const d = { u0: 0.25, v0: 0.1, u1: 0.75, v1: 0.6 };
    const got = geom.effectiveQuad(quad, d, flat);
    const want = [[d.u0, d.v0], [d.u1, d.v0], [d.u1, d.v1], [d.u0, d.v1]]
      .map(([u, v]) => geom.applyHomography(h, u, v));
    return got.every((p, i) => geom.dist(p, want[i]) < 1e-9);
  })());
  check("an explicit full domain reproduces the quad", (() => {
    const got = geom.effectiveQuad(quad, { u0: 0, v0: 0, u1: 1, v1: 1 }, flat);
    return got.every((p, i) => geom.dist(p, quad[i]) < 1e-9);
  })());
  check("a reversed domain swaps the corners rather than failing", (() => {
    const got = geom.effectiveQuad(quad, { u0: 1, v0: 0, u1: 0, v1: 1 }, flat);
    return geom.dist(got[0], quad[1]) < 1e-9 && geom.dist(got[1], quad[0]) < 1e-9;
  })());
  check("nesting two domains is the same as one combined domain", (() => {
    const outer = geom.effectiveQuad(quad, { u0: 0.25, v0: 0, u1: 0.75, v1: 1 }, flat);
    const innerOfOuter = geom.effectiveQuad(outer, { u0: 0.25, v0: 0, u1: 0.75, v1: 1 }, flat);
    const direct = geom.effectiveQuad(quad, { u0: 0.375, v0: 0, u1: 0.625, v1: 1 }, flat);
    return innerOfOuter.every((p, i) => geom.dist(p, direct[i]) < 1e-6);
  })());
  check("an extension stays on the line the edge was heading along", (() => {
    const extended = geom.effectiveQuad(quad, { u0: 0, v0: 0, u1: 1.8, v1: 1 }, flat);
    const vanishing = { x: h[0] / h[6], y: h[3] / h[6] };
    return bend(quad[0], quad[1], extended[1]) < 1e-9
      && bend(quad[1], extended[1], vanishing) < 1e-9;
  })());
  check("extending never reaches past the vanishing point", (() => {
    const vanishing = { x: h[0] / h[6], y: h[3] / h[6] };
    const distances = [1, 2, 5, 20, 500].map(u =>
      geom.dist(geom.applyHomography(h, u, 0), vanishing));
    return distances.every((d, i) => i === 0 || d < distances[i - 1]);
  })());
  check("a domain and a curve compose in the documented order", (() => {
    const curve = geom.flatCurve();
    curve[0] = { x: 0, y: -0.12 };
    const d = { u0: 0.2, v0: 0, u1: 0.8, v1: 1 };
    const got = geom.effectiveQuad(quad, d, curve);
    const local = geom.coonsPoint(curve, d.u0, d.v0);
    const want = geom.applyHomography(h, local.x, local.y);
    return geom.dist(got[0], want) < 1e-9;
  })());

  check("a straight outline is exactly the effective corners", (() => {
    const d = { u0: 0.1, v0: 0.2, u1: 0.9, v1: 0.8 };
    const path = geom.outlinePath(quad, d, geom.flatCurve());
    const corners = geom.effectiveQuad(quad, d, geom.flatCurve());
    return path.length === 4 && path.every((p, i) => geom.dist(p, corners[i]) < 1e-12);
  })());
  check("a bent outline walks the boundary in order", (() => {
    const curve = geom.flatCurve();
    curve[1] = { x: 0.1, y: 0 };
    const steps = 8;
    const path = geom.outlinePath(quad, geom.unitDomain(), curve, steps);
    if (path.length !== steps * 4) return false;
    const corners = geom.effectiveQuad(quad, geom.unitDomain(), curve);
    return [0, 1, 2, 3].every(i => geom.dist(path[i * steps], corners[i]) < 1e-9);
  })());
  check("an outline of a degenerate quad falls back to the points given", (() => {
    const bad = q([[0, 0], [1, 1], [2, 2], [3, 3]]);
    const path = geom.outlinePath(bad, geom.unitDomain(), geom.flatCurve());
    return path.length === 4 && path !== bad
      && path.every((p, i) => p.x === bad[i].x && p.y === bad[i].y);
  })());
  check("an effective quad of a degenerate mark falls back too",
    geom.effectiveQuad(q([[0, 0], [1, 1], [2, 2], [3, 3]]), { u0: 0, v0: 0, u1: 2, v1: 1 },
      geom.flatCurve()).length === 4);

  check("a point on the horizon maps to infinity, not to a wrong answer", (() => {
    const horizon = -h[8] / h[6];
    const p = geom.applyHomography(h, horizon, 0);
    return !Number.isFinite(p.x) || Math.abs(p.x) > 1e12;
  })(), fmt(geom.applyHomography(h, -h[8] / h[6], 0)));
  check("a degenerate quad measures as having no size", (() => {
    const d = geom.quadDimensions(q([[5, 5], [5, 5], [5, 5], [5, 5]]));
    return d.width === 0 && d.height === 0;
  })());
  check("ordering three collinear clicks still yields four points that the warp refuses",
    geom.orderQuad(q([[0, 0], [10, 10], [20, 20], [0, 40]])).length === 4
    && geom.squareToQuad(geom.orderQuad(q([[0, 0], [10, 10], [20, 20], [0, 40]]))) === null);
}

// ---- the shader and the maths have to agree ------------------------------

const MAP_W = 256;
const MAP_H = 128;

function coordinateCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(MAP_W, MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = (y * MAP_W + x) * 4;
      image.data[i] = x;
      image.data[i + 1] = y;
      image.data[i + 2] = 128;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function runShaderAgreementChecks() {
  const geom = TX.geom;
  const source = TX.warp.createSource(coordinateCanvas());

  source.texture.magFilter = THREE.NearestFilter;
  source.texture.minFilter = THREE.NearestFilter;
  source.texture.generateMipmaps = false;
  source.texture.anisotropy = 1;
  source.texture.needsUpdate = true;

  function compare(label, quad, options, tolerance) {
    const opts = options || {};
    const out = TX.warp.warpQuad(source, quad, { ...opts, supersample: 1 });
    if (!out) {
      check(`${label}: the warp produced a canvas`, false, "null");
      return;
    }
    const lens = TX.lens.isIdentity(opts.lens)
      ? null : TX.lens.project(opts.lens, source.width, source.height);
    const h = geom.fitQuad(quad, lens);
    const domain = geom.domainOf(opts.domain);
    const curve = geom.curveOf(opts.curve);
    const pixels = out.getContext("2d").getImageData(0, 0, out.width, out.height).data;

    let tested = 0;
    let worst = 0;
    let worstAt = "";
    let alphaTested = 0;
    let alphaWrong = 0;

    for (let j = 0; j < out.height; j += 2) {
      for (let i = 0; i < out.width; i += 2) {
        const u = domain.u0 + (domain.u1 - domain.u0) * ((i + 0.5) / out.width);
        const v = domain.v0 + (domain.v1 - domain.v0) * ((j + 0.5) / out.height);
        const src = geom.localToImage(h, curve, u, v, lens);
        const at = (j * out.width + i) * 4;

        const inside = src.x > 1 && src.y > 1 && src.x < MAP_W - 1 && src.y < MAP_H - 1;
        const outside = src.x < -1 || src.y < -1 || src.x > MAP_W + 1 || src.y > MAP_H + 1;
        if (inside || outside) {
          alphaTested++;
          if ((pixels[at + 3] > 128) !== inside) alphaWrong++;
        }
        if (!inside) continue;

        tested++;
        const error = Math.hypot(pixels[at] + 0.5 - src.x, pixels[at + 1] + 0.5 - src.y);
        if (error > worst) {
          worst = error;
          worstAt = `${i},${j} wanted ${src.x.toFixed(1)},${src.y.toFixed(1)} `
            + `got ${pixels[at]},${pixels[at + 1]}`;
        }
      }
    }

    const limit = tolerance || 0.9;
    check(`${label}: the shader sampled where the maths says`,
      tested > 500 && worst <= limit,
      `${tested} points, worst ${worst.toFixed(2)}px${worst > limit ? ` at ${worstAt}` : ""}`);
    check(`${label}: transparency follows the same prediction`,
      alphaTested > 500 && alphaWrong === 0,
      `${alphaTested - alphaWrong}/${alphaTested} agree`);
  }

  compare("identity", q([[0, 0], [MAP_W, 0], [MAP_W, MAP_H], [0, MAP_H]]), {});
  compare("perspective", q([[14, 9], [238, 34], [214, 120], [36, 101]]), {});
  compare("rotated and offset", q([[120, 4], [250, 60], [130, 124], [8, 66]]), {});
  compare("a domain window", q([[10, 8], [240, 20], [236, 118], [16, 108]]),
    { domain: { u0: 0.15, v0: 0.2, u1: 0.7, v1: 0.85 } });
  compare("a domain extended past the mark", q([[20, 20], [150, 30], [146, 100], [24, 92]]),
    { domain: { u0: 0, v0: 0, u1: 1.6, v1: 1 } });
  compare("a bent edge", q([[12, 10], [240, 26], [232, 116], [20, 104]]), {
    curve: [{ x: 0, y: 0.06 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
  });
  compare("a domain and a bend together", q([[16, 12], [236, 30], [228, 112], [24, 100]]), {
    domain: { u0: 0.1, v0: 0.05, u1: 0.95, v1: 0.9 },
    curve: [{ x: 0.02, y: 0.05 }, { x: -0.03, y: 0 }, { x: 0, y: -0.04 }, { x: 0.02, y: 0 }],
  });
  compare("a barrel correction", q([[14, 9], [238, 34], [214, 120], [36, 101]]),
    { lens: { k1: -0.2 } });
  compare("a pincushion correction", q([[20, 14], [230, 28], [222, 112], [28, 98]]),
    { lens: { k1: 0.15, k2: -0.04 } });
  compare("a lens, a domain and a bend at once", q([[18, 12], [232, 30], [226, 110], [26, 98]]), {
    lens: { k1: -0.16, k2: 0.03 },
    domain: { u0: 0.05, v0: 0.1, u1: 1.1, v1: 0.9 },
    curve: [{ x: 0.02, y: 0.04 }, { x: 0, y: 0 }, { x: 0, y: -0.03 }, { x: 0, y: 0 }],
  });

  const quad = q([[0, 0], [MAP_W, 0], [MAP_W, MAP_H], [0, MAP_H]]);
  const dims = geom.quadDimensions(geom.effectiveQuad(
    quad, { u0: 0, v0: 0, u1: 1.5, v1: 0.5 }, geom.flatCurve()));
  const sized = TX.warp.warpQuad(source, quad, { domain: { u0: 0, v0: 0, u1: 1.5, v1: 0.5 } });
  check("the output size is measured from what is actually sampled",
    sized.width === Math.round(dims.width) && sized.height === Math.round(dims.height),
    `${sized.width}x${sized.height} vs ${dims.width.toFixed(1)}x${dims.height.toFixed(1)}`);
  check("extending the domain yields more pixels, not bigger ones",
    sized.width > TX.warp.warpQuad(source, quad, {}).width,
    `${sized.width} vs ${TX.warp.warpQuad(source, quad, {}).width}`);
}

const srgbToLinear = b => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const linearToSrgb = v => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

function makeLitCanvas(albedo, shading) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(96, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 96; x++) {
      const i = (y * 96 + x) * 4;
      const a = albedo(x, y);
      const s = shading(x, y);
      for (let c = 0; c < 3; c++) image.data[i + c] = linearToSrgb(srgbToLinear(a[c]) * s);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function runDelightChecks() {
  const delight = TX.delight;
  const flat = () => [180, 150, 120];
  const gradient = x => 0.25 + 0.75 * (1 - x / 95);

  const lit = makeLitCanvas(flat, x => gradient(x));
  const litStats = delight.analyze(lit);
  check("the test image really is unevenly lit", litStats.contrast > 20,
    `contrast=${litStats.contrast.toFixed(1)}`);

  const fixed = delight.apply(lit, { mode: "gradient", strength: 1 });
  const fixedStats = delight.analyze(fixed);
  check("flattening collapses the lighting gradient",
    fixedStats.contrast < litStats.contrast / 6,
    `${litStats.contrast.toFixed(1)} -> ${fixedStats.contrast.toFixed(1)}`);
  check("flattening keeps the overall brightness",
    Math.abs(fixedStats.mean.l - litStats.mean.l) < 12,
    `${litStats.mean.l.toFixed(1)} -> ${fixedStats.mean.l.toFixed(1)}`);

  const bright = pixelAt(fixed, 10, 32);
  const shaded = pixelAt(fixed, 85, 32);
  check("the lit and shaded sides end up the same",
    near(bright, shaded, 6), `${bright.join(",")} vs ${shaded.join(",")}`);
  check("flattening does not shift the colour",
    Math.abs(bright[0] / bright[1] - 180 / 150) < 0.06
    && Math.abs(bright[2] / bright[1] - 120 / 150) < 0.06,
    `${(bright[0] / bright[1]).toFixed(3)} / ${(bright[2] / bright[1]).toFixed(3)}`);

  const scatter = (x, y) => {
    const h = Math.sin(((x / 16) | 0) * 12.9898 + ((y / 16) | 0) * 78.233) * 43758.5453;
    return h - Math.floor(h) > 0.5;
  };
  const litChecks = makeLitCanvas(
    (x, y) => (scatter(x, y) ? [200, 200, 200] : [60, 60, 60]), x => gradient(x));
  const fixedChecks = delight.apply(litChecks, { mode: "gradient", strength: 1 });
  const sampleAt = wantLight => {
    const found = [];
    for (let x = 8; x < 96 && found.length < 2; x += 16) {
      if (scatter(x, 8) === wantLight) found.push(x);
    }
    for (let x = 88; x > 0 && found.length < 2; x -= 16) {
      if (scatter(x, 8) === wantLight && !found.includes(x)) found.push(x);
    }
    return found.map(x => pixelAt(fixedChecks, x, 8)[0]);
  };
  const lightSquares = sampleAt(true);
  const darkSquares = sampleAt(false);
  check("albedo detail survives flattening",
    Math.min(...lightSquares) - Math.max(...darkSquares) > 80,
    `light ${lightSquares.join("/")} dark ${darkSquares.join("/")}`);
  check("the same albedo reads the same on both sides now",
    Math.abs(lightSquares[0] - lightSquares[1]) < 20
    && Math.abs(darkSquares[0] - darkSquares[1]) < 20,
    `light ${lightSquares.join("/")} dark ${darkSquares.join("/")}`);

  const half = delight.analyze(delight.apply(lit, { mode: "gradient", strength: 0.5 }));
  check("strength scales the correction",
    half.contrast > fixedStats.contrast && half.contrast < litStats.contrast,
    `${litStats.contrast.toFixed(1)} / ${half.contrast.toFixed(1)} / ${fixedStats.contrast.toFixed(1)}`);

  const blob = (x, y) => {
    const d = Math.hypot(x - 30, y - 32) / 22;
    return d >= 1 ? 1 : 1 - 0.6 * (1 - d * d) ** 2;
  };
  const blobbed = makeLitCanvas(flat, blob);
  const blobStats = delight.analyze(blobbed);
  const byBlur = delight.analyze(delight.apply(blobbed, { mode: "local", radius: 0.05 }));
  const bySurface = delight.analyze(delight.apply(blobbed, { mode: "gradient" }));
  check("a coarser radius deliberately does less",
    delight.analyze(delight.apply(blobbed, { mode: "local", radius: 0.3 })).contrast
    > delight.analyze(delight.apply(blobbed, { mode: "local", radius: 0.05 })).contrast * 2);
  check("the local estimator lifts a shadow the surface fit cannot",
    byBlur.contrast < bySurface.contrast / 2 && byBlur.contrast < blobStats.contrast / 3,
    `lit ${blobStats.contrast.toFixed(1)} gradient ${bySurface.contrast.toFixed(1)} local ${byBlur.contrast.toFixed(1)}`);

  const tinted = makeLitCanvas(flat, () => 1);
  const tintCtx = tinted.getContext("2d");
  const tint = tintCtx.getImageData(0, 0, 96, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 96; x++) {
      const i = (y * 96 + x) * 4;
      const t = x / 95;
      tint.data[i] = Math.min(255, tint.data[i] * (1.3 - 0.6 * t));
      tint.data[i + 2] = Math.min(255, tint.data[i + 2] * (0.7 + 0.6 * t));
    }
  }
  tintCtx.putImageData(tint, 0, 0);
  const castOf = canvas => {
    const left = pixelAt(canvas, 8, 32);
    const right = pixelAt(canvas, 88, 32);
    return Math.abs(left[0] / left[2] - right[0] / right[2]);
  };
  check("the tinted image has a colour gradient", castOf(tinted) > 0.8,
    castOf(tinted).toFixed(3));
  check("a per-channel estimate removes the colour gradient",
    castOf(delight.apply(tinted, { mode: "gradient", perChannel: true })) < 0.08,
    castOf(delight.apply(tinted, { mode: "gradient", perChannel: true })).toFixed(3));
  check("a luminance-only estimate leaves the colour alone",
    castOf(delight.apply(tinted, { mode: "gradient", perChannel: false })) > 0.6,
    castOf(delight.apply(tinted, { mode: "gradient", perChannel: false })).toFixed(3));

  const warm = makeLitCanvas(() => [160, 160, 160], () => 1);
  const warmCtx = warm.getContext("2d");
  const warmImage = warmCtx.getImageData(0, 0, 96, 64);
  for (let i = 0; i < warmImage.data.length; i += 4) {
    warmImage.data[i] = Math.min(255, warmImage.data[i] * 1.35);
    warmImage.data[i + 2] = warmImage.data[i + 2] * 0.7;
  }
  warmCtx.putImageData(warmImage, 0, 0);
  const warmStats = delight.analyze(warm);
  check("the warm image has an even colour cast", warmStats.cast > 0.15,
    `cast=${warmStats.cast.toFixed(3)}`);
  const balanced = delight.analyze(delight.apply(warm, { mode: "gradient", balance: true }));
  check("grey-world balance neutralises it", balanced.cast < 0.04,
    `cast=${balanced.cast.toFixed(3)}`);
  const perChannelOnly = delight.analyze(delight.apply(warm, { mode: "gradient", perChannel: true }));
  check("a per-channel estimate alone does not, since the cast is not a gradient",
    Math.abs(perChannelOnly.cast - warmStats.cast) < 0.03,
    `${warmStats.cast.toFixed(3)} -> ${perChannelOnly.cast.toFixed(3)}`);

  const exposed = delight.analyze(delight.apply(lit, { mode: "gradient", exposure: 128 }));
  check("an exposure target is hit", Math.abs(exposed.mean.l - 128) < 12,
    `mean=${exposed.mean.l.toFixed(1)}`);

  check("mode 'none' returns the source untouched",
    delight.apply(lit, { mode: "none" }) === lit && delight.isIdentity({ mode: "none" }));
  check("a malformed setting falls back to something usable", (() => {
    const s = delight.settingsOf({ mode: "wat", strength: "loads", order: 9, exposure: -5 });
    return s.mode === "none" && s.strength === 1 && s.order === 2 && s.exposure === 0;
  })());

  const withHole = document.createElement("canvas");
  withHole.width = 96;
  withHole.height = 64;
  const holeCtx = withHole.getContext("2d");
  holeCtx.drawImage(lit, 0, 0);
  holeCtx.clearRect(0, 0, 24, 64);
  const holeStats = delight.analyze(withHole);
  check("transparent pixels are left out of the statistics",
    holeStats.count === 72 * 64, `${holeStats.count} vs ${72 * 64}`);
  const holeFixed = delight.apply(withHole, { mode: "gradient", strength: 1 });
  check("transparent pixels stay transparent", pixelAt(holeFixed, 5, 32)[3] === 0,
    `alpha=${pixelAt(holeFixed, 5, 32)[3]}`);
  check("the opaque part is still flattened",
    Math.abs(pixelAt(holeFixed, 30, 32)[0] - pixelAt(holeFixed, 90, 32)[0]) < 16,
    `${pixelAt(holeFixed, 30, 32)[0]} vs ${pixelAt(holeFixed, 90, 32)[0]}`);

  const map = delight.shadingMap(lit, { mode: "gradient" });
  check("the shading map is produced at the same size",
    !!map && map.width === 96 && map.height === 64);
  check("the shading map is brighter where the light was",
    pixelAt(map, 5, 32)[0] > pixelAt(map, 90, 32)[0] + 40,
    `${pixelAt(map, 5, 32)[0]} vs ${pixelAt(map, 90, 32)[0]}`);
  check("the shading map is greyscale",
    pixelAt(map, 48, 32)[0] === pixelAt(map, 48, 32)[2]);
  const evenMap = delight.shadingMap(makeLitCanvas(flat, () => 0.7), { mode: "gradient" });
  check("evenly lit reads as mid grey throughout",
    Math.abs(pixelAt(evenMap, 10, 10)[0] - 128) < 3
    && Math.abs(pixelAt(evenMap, 80, 50)[0] - 128) < 3,
    `${pixelAt(evenMap, 10, 10)[0]} / ${pixelAt(evenMap, 80, 50)[0]}`);

  const histTotal = litStats.hist.l.reduce((a, b) => a + b, 0);
  check("the histogram accounts for every measured pixel", histTotal === litStats.count,
    `${histTotal} vs ${litStats.count}`);
  check("an empty image analyses without dividing by zero", (() => {
    const blank = document.createElement("canvas");
    blank.width = 8;
    blank.height = 8;
    const stats = delight.analyze(blank);
    return stats.count === 0 && stats.contrast === 0;
  })());

  const big = document.createElement("canvas");
  big.width = 1024;
  big.height = 1024;
  const bigCtx = big.getContext("2d");
  bigCtx.drawImage(lit, 0, 0, 1024, 1024);
  const timed = (label, fn) => {
    const t0 = performance.now();
    fn();
    return { label, ms: performance.now() - t0 };
  };
  const costs = [
    timed("analyze", () => delight.analyze(big)),
    timed("gradient", () => delight.apply(big, { mode: "gradient" })),
    timed("perChannel", () => delight.apply(big, { mode: "gradient", perChannel: true })),
    timed("local", () => delight.apply(big, { mode: "local", radius: 0.06 })),
  ];
  check("a megapixel texture stays interactive", costs.every(c => c.ms < 450),
    costs.map(c => `${c.label} ${c.ms.toFixed(0)}ms`).join(" "));

  check("sampling the analysis does not move what it reports", (() => {
    const whole = delight.analyze(big);
    const sampled = delight.analyze(big, { maxSamples: 40000 });
    return sampled.count < whole.count / 10
      && Math.abs(sampled.mean.l - whole.mean.l) < 1
      && Math.abs(sampled.contrast - whole.contrast) < 1
      && Math.abs(sampled.median - whole.median) <= 2
      && Math.abs(sampled.cast - whole.cast) < 0.01;
  })());

  // ---- what the speed cost in accuracy ----------------------------------

  const wide = makeLitCanvas(flat, x => gradient(x));
  const exact = (canvas, settings) => {
    const image = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const field = delight.shadingField(canvas, settings);
    return { image, field };
  };
  const graded = delight.apply(wide, { mode: "gradient", strength: 1 });
  const perPixel = exact(wide, { mode: "gradient", strength: 1 });
  check("the correction leaves a flat surface flat across the whole width", (() => {
    let worst = 0;
    for (let x = 2; x < wide.width - 2; x += 3) {
      worst = Math.max(worst, Math.abs(pixelAt(graded, x, 32)[0] - pixelAt(graded, 48, 32)[0]));
    }
    return worst <= 3;
  })(), `field ${perPixel.field ? "estimated" : "missing"}`);

  check("the tabulated sRGB encode agrees with the exact one", (() => {
    let worst = 0;
    for (let i = 0; i <= 4000; i++) {
      const v = i / 4000;
      const a = delight.toSrgbByte(v);
      const b = delight.srgbByte(v);
      worst = Math.max(worst, Math.abs(a - b));
    }
    return worst <= 1;
  })());

  check("and at the ends it is exact",
    delight.srgbByte(0) === 0 && delight.srgbByte(1) === 255
    && delight.srgbByte(-1) === 0 && delight.srgbByte(4) === 255);

  check("the average brightness does not depend on the texture's size", (() => {
    const small = document.createElement("canvas");
    small.width = 96;
    small.height = 64;
    small.getContext("2d").drawImage(wide, 0, 0, 96, 64);
    const large = document.createElement("canvas");
    large.width = 768;
    large.height = 512;
    large.getContext("2d").drawImage(wide, 0, 0, 768, 512);
    const a = delight.analyze(delight.apply(small, { mode: "gradient" })).mean.l;
    const b = delight.analyze(delight.apply(large, { mode: "gradient" })).mean.l;
    return Math.abs(a - b) < 3;
  })());

  check("the cache key follows every setting", (() => {
    const a = delight.keyOf({ mode: "gradient", strength: 1 }, 1);
    return a !== delight.keyOf({ mode: "gradient", strength: 0.5 }, 1)
      && a !== delight.keyOf({ mode: "gradient", strength: 1 }, 2)
      && a !== delight.keyOf({ mode: "gradient", strength: 1, perChannel: true }, 1)
      && a !== delight.keyOf({ mode: "gradient", strength: 1, balance: true }, 1)
      && a === delight.keyOf({ mode: "gradient", strength: 1 }, 1);
  })());
}

function runLocalSpaceChecks(source) {
  const geom = TX.geom;
  const close = (got, want, tol) => Math.abs(got - want) <= tol;
  const full = q([[0, 0], [200, 0], [200, 100], [0, 100]]);
  const quad = q([[20, 10], [180, 30], [170, 90], [30, 80]]);
  const h = geom.squareToQuad(quad);

  const inverse = geom.quadToSquare(quad);
  const roundTrip = geom.applyHomography(inverse, 123.5, 47.25);
  const back = geom.applyHomography(h, roundTrip.x, roundTrip.y);
  check("the homography inverts",
    close(back.x, 123.5, 1e-6) && close(back.y, 47.25, 1e-6),
    `${back.x.toFixed(4)},${back.y.toFixed(4)}`);
  check("inverting a degenerate map fails rather than returning nonsense",
    geom.invert3([1, 2, 3, 2, 4, 6, 3, 6, 9]) === null);

  const flat = geom.flatCurve();
  let identical = true;
  for (let u = 0; u <= 1.0001; u += 0.25) {
    for (let v = 0; v <= 1.0001; v += 0.25) {
      const p = geom.coonsPoint(flat, u, v);
      if (!close(p.x, u, 1e-12) || !close(p.y, v, 1e-12)) identical = false;
    }
  }
  check("a flat curve is exactly the identity", identical);

  const bent = geom.flatCurve();
  bent[0] = { x: 0, y: -0.2 };
  const mid = geom.coonsPoint(bent, 0.5, 0);
  check("the handle sits on the curve it bends",
    close(mid.x, 0.5, 1e-9) && close(mid.y, -0.2, 1e-9), `${mid.x},${mid.y}`);
  const corner = geom.coonsPoint(bent, 0, 0);
  check("bending an edge leaves the corners pinned",
    close(corner.x, 0, 1e-12) && close(corner.y, 0, 1e-12), `${corner.x},${corner.y}`);
  const opposite = geom.coonsPoint(bent, 0.5, 1);
  check("bending one edge leaves the opposite edge alone",
    close(opposite.x, 0.5, 1e-12) && close(opposite.y, 1, 1e-12),
    `${opposite.x},${opposite.y}`);

  check("the default domain is a no-op",
    geom.effectiveQuad(quad, geom.unitDomain(), flat) === quad);

  const extended = geom.effectiveQuad(quad, { u0: 0, v0: 0, u1: 2, v1: 1 }, flat);
  const affine = { x: 2 * quad[1].x - quad[0].x, y: 2 * quad[1].y - quad[0].y };
  check("extending in local space follows the perspective",
    geom.dist(extended[1], affine) > 1,
    `projective ${extended[1].x.toFixed(1)},${extended[1].y.toFixed(1)} vs affine ${affine.x.toFixed(1)},${affine.y.toFixed(1)}`);
  check("an extended quad keeps the corners it did not touch",
    close(extended[0].x, quad[0].x, 1e-9) && close(extended[3].y, quad[3].y, 1e-9));
  const halved = geom.effectiveQuad(quad, { u0: 0, v0: 0, u1: 0.5, v1: 1 }, flat);
  const halfway = geom.localToImage(h, flat, 0.5, 0);
  check("halving the domain lands on the middle of the edge",
    close(halved[1].x, halfway.x, 1e-9) && close(halved[1].y, halfway.y, 1e-9));

  check("a straight outline is just the corners",
    geom.outlinePath(quad, geom.unitDomain(), flat).length === 4);
  check("a bent outline is sampled along the curve",
    geom.outlinePath(quad, geom.unitDomain(), bent, 12).length === 48);

  check("a malformed curve falls back to flat",
    geom.isFlatCurve(geom.curveOf([{ x: "x" }])) && geom.curveOf(null).length === 4);
  check("a malformed domain falls back to the unit square",
    geom.isUnitDomain(geom.domainOf({ u0: "nope", v1: NaN })));

  const plain = TX.warp.warpQuad(source, full, {});
  const halfDomain = TX.warp.warpQuad(source, full, { domain: { u0: 0, v0: 0, u1: 0.5, v1: 1 } });
  check("the shader honours the domain in its output size",
    halfDomain.width === 100 && halfDomain.height === 100,
    `${halfDomain.width}x${halfDomain.height}`);
  check("half the domain is the left half of the image",
    near(pixelAt(halfDomain, 5, 5), RED, 6) && near(pixelAt(halfDomain, 95, 5), RED, 6),
    `${pixelAt(halfDomain, 5, 5).join(",")} / ${pixelAt(halfDomain, 95, 5).join(",")}`);
  check("the other half of the domain is the right half of the image",
    near(pixelAt(TX.warp.warpQuad(source, full, { domain: { u0: 0.5, v0: 0, u1: 1, v1: 1 } }), 5, 5),
      GREEN, 6));

  const explicit = TX.warp.warpQuad(source, full, {
    domain: geom.unitDomain(), curve: geom.flatCurve(),
  });
  check("passing the default local space changes nothing",
    near(pixelAt(explicit, 150, 20), pixelAt(plain, 150, 20), 0)
    && near(pixelAt(explicit, 40, 80), pixelAt(plain, 40, 80), 0),
    `${pixelAt(explicit, 150, 20).join(",")} vs ${pixelAt(plain, 150, 20).join(",")}`);

  const curved = TX.warp.warpQuad(source, full, { curve: bent });
  check("bending an edge changes what is sampled under it",
    pixelAt(curved, 100, 2)[3] < 128, `alpha=${pixelAt(curved, 100, 2)[3]}`);
  check("bending the top edge leaves the far corners alone",
    near(pixelAt(curved, 4, 96), BLUE, 8) && near(pixelAt(curved, 196, 96), YELLOW, 8),
    `${pixelAt(curved, 4, 96).join(",")} / ${pixelAt(curved, 196, 96).join(",")}`);
}

function runDurableChecks() {
  const key = "texture-extract:selftest";
  TX.durable.remove(key);

  const schema = TX.schema;
  check("every stored format carries a version of its own",
    ["document", "view", "layout", "history"]
      .every(name => Number.isInteger(schema[name]) && schema[name] >= 1),
    JSON.stringify(schema));
  check("and none of them is the program's version",
    Object.values(schema).every(v => typeof v === "number") && typeof TX.version === "string",
    `${JSON.stringify(schema)} vs ${TX.version}`);

  check("a written record reads back", TX.durable.write(key, 3, { a: 1, b: [2, 3] })
    && TX.durable.read(key, 3).a === 1);
  check("nested values survive the round trip",
    TX.durable.read(key, 3).b.join(",") === "2,3");
  check("a record from another version is refused", TX.durable.read(key, 4) === null);

  localStorage.setItem(key, "{not json");
  check("unparseable storage is refused", TX.durable.read(key, 3) === null);
  localStorage.setItem(key, JSON.stringify({ v: 3 }));
  check("a record with no payload is refused", TX.durable.read(key, 3) === null);

  TX.durable.remove(key);
  check("a missing record reads as null", TX.durable.read(key, 3) === null);

  let writes = 0;
  const throttle = TX.durable.throttled(() => { writes++; }, 5000);
  throttle.poke();
  check("the first change is written straight away", writes === 1, `writes=${writes}`);
  throttle.poke();
  throttle.poke();
  check("changes during the window are coalesced", writes === 1, `writes=${writes}`);
  throttle.flush();
  check("flushing writes the coalesced change", writes === 2, `writes=${writes}`);
  throttle.flush();
  check("flushing again is a no-op", writes === 2, `writes=${writes}`);

  let flushed = 0;
  const stop = TX.durable.onFlush(() => { flushed++; });
  TX.durable.runFlushers();
  check("registered flushers run on unload", flushed === 1, `flushed=${flushed}`);
  stop();
  TX.durable.runFlushers();
  check("unregistering a flusher works", flushed === 1, `flushed=${flushed}`);
}

function makeGradientCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      image.data[i] = Math.round((x / (width - 1)) * 255);
      image.data[i + 1] = Math.round((y / (height - 1)) * 255);
      image.data[i + 2] = 40;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// ---- the measurements the Views panel reports -----------------------------

const areaOf = quad => Math.abs(shoelace(quad)) / 2;

const meanOf = field => field.data.reduce((sum, v) => sum + v, 0) / field.data.length;

function solidCanvas(width, height, style) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

function runViewChecks() {
  const views = TX.views;
  const rect = q([[0, 0], [200, 0], [200, 100], [0, 100]]);
  const density = (quad, width, height, extra) => views.densityField(
    { quad, width, height, ...(extra || {}) });

  // --- texel density ---

  const identity = density(rect, 200, 100);
  check("density: identity warp returns a field", !!identity);
  if (identity) {
    check("density: identity is 1 everywhere",
      close(identity.min, 1, 1e-6) && close(identity.max, 1, 1e-6),
      `${identity.min.toFixed(6)}..${identity.max.toFixed(6)}`);
    check("density: identity is perfectly even", close(identity.unevenness, 1, 1e-6),
      identity.unevenness.toFixed(6));
    check("density: nothing is interpolated at 1:1", identity.magnified === 0,
      String(identity.magnified));
  }

  const halved = density(rect, 100, 50);
  check("density: halving the output quadruples the count",
    halved && close(halved.median, 4, 1e-6), halved && halved.median.toFixed(6));

  const doubled = density(rect, 400, 200);
  check("density: doubling the output quarters the count",
    doubled && close(doubled.median, 0.25, 1e-6), doubled && doubled.median.toFixed(6));
  check("density: an upsampled extraction is entirely interpolated",
    doubled && doubled.magnified === 1, doubled && String(doubled.magnified));

  const grazed = density(rect, 211, 105);
  check("density: a fraction under 1:1 is not counted as interpolated",
    grazed && grazed.median > 0.85 && grazed.median < 1 && grazed.magnified === 0,
    grazed && `${grazed.median.toFixed(3)} -> ${grazed.magnified}`);
  const soft = density(rect, 240, 120);
  check("density: a real shortfall is counted",
    soft && soft.median < 0.75 && soft.magnified === 1,
    soft && `${soft.median.toFixed(3)} -> ${soft.magnified}`);

  const shrunk = density(rect, 200, 100, { scale: 0.5 });
  check("density: the upload scale counts twice over",
    shrunk && close(shrunk.median, 0.25, 1e-6), shrunk && shrunk.median.toFixed(6));

  const keystone = q([[40, 12], [170, 30], [188, 96], [16, 78]]);
  const dims = TX.geom.quadDimensions(keystone);
  const outW = Math.round(dims.width);
  const outH = Math.round(dims.height);
  const bent = density(keystone, outW, outH);
  if (bent) {
    const integral = meanOf(bent) * outW * outH;
    const area = areaOf(keystone);
    check("density: the field integrates to the area of the quad",
      Math.abs(integral - area) / area < 0.005,
      `${integral.toFixed(1)} vs ${area.toFixed(1)}`);
    check("density: a keystone samples its two ends differently", bent.unevenness > 1.05,
      bent.unevenness.toFixed(3));
  }

  const receding = q([[0, 0], [200, 0], [150, 100], [50, 100]]);
  const away = density(receding, 200, 100);
  if (away) {
    const rowAt = r => {
      let sum = 0;
      for (let c = 0; c < away.cols; c++) sum += away.data[r * away.cols + c];
      return sum / away.cols;
    };
    const nearEnd = rowAt(0);
    const farEnd = rowAt(away.rows - 1);
    check("density: the receding end is sampled less than the near end", farEnd < nearEnd * 0.9,
      `near=${nearEnd.toFixed(3)} far=${farEnd.toFixed(3)}`);
  }

  const extended = density(rect, 400, 100, { domain: { u0: 0, v0: 0, u1: 2, v1: 1 } });
  check("density: extending local space does not change the sampling rate",
    extended && close(extended.median, 1, 1e-6), extended && extended.median.toFixed(6));

  check("density: a degenerate quad has no field",
    density(q([[0, 0], [10, 10], [20, 20], [30, 30]]), 100, 100) === null);
  check("density: a zero-sized output has no field", density(rect, 0, 0) === null);

  // --- source to target colour difference ---

  const grey = solidCanvas(32, 32, "#808080");
  const same = views.colourDelta(grey, solidCanvas(32, 32, "#808080"));
  check("delta: an unchanged texture reports no difference",
    same && same.max === 0 && same.mean === 0, same && `${same.mean},${same.max}`);
  check("delta: an unchanged texture has nothing visibly changed",
    same && same.visible === 0, same && String(same.visible));

  const extremes = views.colourDelta(solidCanvas(16, 16, "#000000"), solidCanvas(16, 16, "#ffffff"));
  check("delta: black against white is 100", extremes && close(extremes.mean, 100, 0.01),
    extremes && extremes.mean.toFixed(4));

  const slight = views.colourDelta(grey, solidCanvas(32, 32, "#828282"));
  check("delta: a two-level shift registers but stays invisible",
    slight && slight.mean > 0.1 && slight.mean < 2 && slight.visible === 0,
    slight && `${slight.mean.toFixed(3)} visible=${slight.visible}`);

  const warmer = views.colourDelta(grey, solidCanvas(32, 32, "#8f8080"));
  check("delta: the channel shift says which way the texture moved",
    warmer && close(warmer.shift.r, 15, 0.5) && close(warmer.shift.g, 0, 0.5),
    warmer && `${warmer.shift.r.toFixed(1)},${warmer.shift.g.toFixed(1)},${warmer.shift.b.toFixed(1)}`);

  check("delta: mismatched sizes are refused rather than guessed at",
    views.colourDelta(grey, solidCanvas(64, 64, "#808080")) === null);

  // --- coverage ---

  const full = views.coverage(grey);
  check("coverage: a solid texture is fully opaque", full && full.opaque === 1 && full.empty === 0,
    full && `${full.opaque},${full.empty}`);

  const half = document.createElement("canvas");
  half.width = 40;
  half.height = 40;
  const halfCtx = half.getContext("2d");
  halfCtx.fillStyle = "#ffffff";
  halfCtx.fillRect(0, 0, 20, 40);
  const partial = views.coverage(half);
  check("coverage: a half-filled texture reads as half empty",
    partial && Math.abs(partial.opaque - 0.5) < 0.03 && Math.abs(partial.empty - 0.5) < 0.03,
    partial && `${partial.opaque.toFixed(3)} / ${partial.empty.toFixed(3)}`);

  // --- atlas occupancy ---

  const packed = views.atlasOccupancy([
    { id: "a", name: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", name: "b", x: 100, y: 0, width: 100, height: 100 },
  ]);
  check("atlas: two touching textures waste nothing",
    close(packed.efficiency, 1, 1e-9) && packed.width === 200 && packed.height === 100,
    `${packed.width}x${packed.height} @ ${packed.efficiency}`);
  check("atlas: nothing overlaps when nothing overlaps", packed.overlaps.length === 0);

  const gapped = views.atlasOccupancy([
    { id: "a", name: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", name: "b", x: 300, y: 0, width: 100, height: 100 },
  ]);
  check("atlas: a gap is charged for", close(gapped.efficiency, 0.5, 1e-9),
    gapped.efficiency.toFixed(4));

  const clashing = views.atlasOccupancy([
    { id: "a", name: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", name: "b", x: 50, y: 50, width: 100, height: 100 },
  ]);
  check("atlas: an overlap is found and measured",
    clashing.overlaps.length === 1 && close(clashing.overlaps[0].area, 2500, 1e-9),
    JSON.stringify(clashing.overlaps));

  const turned = views.atlasOccupancy([
    { id: "a", name: "a", x: 0, y: 0, width: 100, height: 100, rotation: Math.PI / 4 },
  ]);
  check("atlas: a rotated texture is charged at its bounding box",
    close(turned.width, Math.SQRT2 * 100, 1e-6) && turned.efficiency === 1,
    `${turned.width.toFixed(3)} @ ${turned.efficiency}`);

  const nothing = views.atlasOccupancy([]);
  check("atlas: an empty atlas reports zeros rather than NaN",
    nothing.width === 0 && nothing.efficiency === 0 && nothing.boxes.length === 0);

  // --- painting ---

  const painted = views.paintField(identity, "density");
  check("paint: the swatch matches the field's own resolution",
    painted && painted.width === identity.cols && painted.height === identity.rows,
    painted && `${painted.width}x${painted.height}`);
  check("paint: nothing to paint yields nothing", views.paintField(null, "density") === null);

  check("paint: a texture at 1:1 is still visibly measured", (() => {
    const { data } = painted.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, painted.width, painted.height);
    let least = 255;
    for (let i = 3; i < data.length; i += 4) least = Math.min(least, data[i]);
    return least > 60 && least < 160;
  })(), (() => {
    const { data } = painted.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, painted.width, painted.height);
    let least = 255;
    for (let i = 3; i < data.length; i += 4) least = Math.min(least, data[i]);
    return `faintest alpha ${least}`;
  })());

  check("paint: and a texture that is short of detail is stronger than one that is not", (() => {
    const starved = density(q([[0, 0], [50, 0], [50, 25], [0, 25]]), 200, 100);
    const bitmap = views.paintField(starved, "density");
    const alphaOf = canvas => {
      const { data } = canvas.getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      let n = 0;
      for (let i = 3; i < data.length; i += 4) { sum += data[i]; n++; }
      return n ? sum / n : 0;
    };
    return alphaOf(bitmap) > alphaOf(painted) * 1.5;
  })());

  // --- the bar is fitted to the spread the texture actually has ------------
  const fieldOfValues = values => {
    const data = Float32Array.from(values);
    return { kind: "density", data, cols: data.length, rows: 1, ...views.summarise(data) };
  };
  const alphaRange = field => {
    const bitmap = views.paintField(field, "density");
    const { data } = bitmap.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, bitmap.width, bitmap.height);
    let least = 255;
    let most = 0;
    for (let i = 3; i < data.length; i += 4) {
      least = Math.min(least, data[i]);
      most = Math.max(most, data[i]);
    }
    return { least, most };
  };

  const gentle = fieldOfValues([0.85, 0.92, 1, 1.08, 1.18]);
  const gentleStops = views.densityStops(gentle);
  check("density: a texture that is nearly right gets a bar it can fill",
    gentleStops > 0.2 && gentleStops < 0.3, gentleStops.toFixed(3));
  check("density: so its worst corner is painted as its worst corner",
    alphaRange(gentle).most > 200, String(alphaRange(gentle).most));
  check("density: while 1:1 in the middle of it stays the floor it always was",
    alphaRange(gentle).least < 110, String(alphaRange(gentle).least));

  check("density: a texture that really is even is left flat rather than stretched",
    views.densityStops(fieldOfValues([1, 1, 1.001, 0.999, 1]))
      === views.DENSITY_MIN_STOPS);
  check("density: and the bar never claims more than the measurement reaches",
    views.densityStops(fieldOfValues([0.01, 0.02, 1, 40, 90]))
      === views.DENSITY_MAX_STOPS);
  check("density: with no field at all it is the full scale",
    views.densityStops(null) === views.DENSITY_MAX_STOPS);

  // --- one colour per slice, which says what came from where ---------------

  check("pairing: a slice's colour depends only on its place in the set",
    views.itemColour(3) === views.itemColour(3) && views.itemColour(3) !== views.itemColour(4),
    `${views.itemColour(3)} vs ${views.itemColour(4)}`);

  check("pairing: an alpha rides along without changing the colour", (() => {
    const hueOf = colour => Number(colour.match(/hsla?\(([\d.]+)/)[1]);
    return hueOf(views.itemColour(6, 0.3)) === hueOf(views.itemColour(6))
      && /^hsla\(/.test(views.itemColour(6, 0.3))
      && /0\.3/.test(views.itemColour(6, 0.3));
  })(), views.itemColour(6, 0.3));

  const hueSpread = count => {
    const hueOf = index => Number(views.itemColour(index).match(/hsla?\(([\d.]+)/)[1]);
    const hues = [];
    for (let i = 0; i < count; i++) hues.push(hueOf(i));
    let worst = 360;
    let neighbour = 360;
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const d = Math.abs(hues[i] - hues[j]);
        const apart = Math.min(d, 360 - d);
        worst = Math.min(worst, apart);
        if (j === i + 1) neighbour = Math.min(neighbour, apart);
      }
    }
    return { worst, neighbour };
  };

  const twelve = hueSpread(12);
  check("pairing: a dozen slices are all well apart in hue", twelve.worst > 15,
    `closest pair ${twelve.worst.toFixed(1)}°`);
  const thirty = hueSpread(30);
  check("pairing: thirty are still separable", thirty.worst > 6,
    `closest pair ${thirty.worst.toFixed(1)}°`);
  check("pairing: and consecutive slices are never the close pair",
    thirty.neighbour > 90, `${thirty.neighbour.toFixed(1)}° apart`);

  check("pairing: a missing index is still a colour rather than a crash",
    /^hsl\(/.test(views.itemColour(-1)) && /^hsl\(/.test(views.itemColour(null)),
    `${views.itemColour(-1)} / ${views.itemColour(null)}`);
}

function runSelectionChecks() {
  const store = TX.store;
  const state = store.state;

  const before = { kind: state.selection.kind, ids: state.selection.ids.slice() };
  store.reset();

  const photo = store.addImage({ name: "p", width: 40, height: 30 });
  const other = store.addImage({ name: "q", width: 40, height: 30 });
  const mark = store.addMark(photo.id, [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ]);
  const slice = store.addTexture({ name: "t", width: 10, height: 10 });

  check("nothing is selected to begin with",
    store.selectedKind() === null && store.selectionCount() === 0);

  store.select("texture", slice.id);
  check("selecting a texture reports it under its own kind",
    store.selectedIds("texture").join() === slice.id && store.selectedKind() === "texture");
  check("and reports nothing under any other kind",
    store.selectedIds("image").length === 0 && store.selectedIds("mark").length === 0
    && store.selectionCount("image") === 0);
  check("the sole selection resolves to the item itself",
    store.soleSelected("texture").id === slice.id && store.soleSelected("image") === null);

  store.select("image", photo.id);
  check("selecting another kind replaces rather than accumulates",
    store.selectedKind() === "image" && store.selectedIds("texture").length === 0
    && store.selectedIds("image").join() === photo.id);

  store.toggleSelected("image", other.id);
  check("shift-clicking within a kind adds to it",
    store.selectionCount("image") === 2, String(store.selectionCount("image")));
  store.toggleSelected("image", other.id);
  check("shift-clicking it again removes it",
    store.selectedIds("image").join() === photo.id);
  check("two selected is not a sole selection", (() => {
    store.selectAllOf("image");
    return store.selectionCount("image") === 2 && store.soleSelected("image") === null;
  })());

  store.toggleSelected("mark", mark.id);
  check("toggling a different kind switches to it outright",
    store.selectedKind() === "mark" && store.selectionCount("mark") === 1);

  check("a mark resolves like anything else", store.soleSelected("mark").id === mark.id);

  check("selecting an id that does not exist selects nothing", (() => {
    store.select("texture", "no-such-id");
    return store.selectedKind() === null;
  })());
  check("a mixed list keeps only the ids of that kind", (() => {
    store.select("image", [photo.id, slice.id, other.id]);
    return store.selectionCount("image") === 2
      && !store.selectedIds("image").includes(slice.id);
  })());
  check("duplicates in the list are collapsed", (() => {
    store.select("image", [photo.id, photo.id]);
    return store.selectionCount("image") === 1;
  })());

  store.select("image", [photo.id, other.id]);
  store.removeImage(other.id);
  check("deleting a selected item prunes it from the selection",
    store.selectionCount("image") === 1 && store.selectedIds("image").join() === photo.id);
  store.removeImage(photo.id);
  check("deleting the last of them clears the kind too",
    store.selectedKind() === null && store.selectionCount() === 0);

  check("a saved selection is filtered against what still exists", (() => {
    const kept = store.addTexture({ name: "k", width: 4, height: 4 });
    store.select("texture", kept.id);
    const record = store.viewRecord();
    store.removeTexture(kept.id);
    store.applyViewRecord(record, 0);
    return store.selectedKind() === null;
  })());
  check("a malformed selection is refused", (() => {
    const cleaned = store.selectionOf({ kind: "nonsense", ids: ["a"] });
    return cleaned.kind === null && cleaned.ids.length === 0;
  })());

  store.reset();
  store.select(before.kind, before.ids);
}

function runSnapChecks() {
  const snap = TX.snap;
  const box = (x, y, w, h) => ({ minX: x, minY: y, maxX: x + w, maxY: y + h });
  const neighbour = box(0, 0, 103, 61);

  const flush = snap.solve({
    box: box(110, 0, 50, 50),
    others: [neighbour],
    step: 16,
    tolerance: 8,
  });
  check("snap: a slice near a neighbour's edge goes flush against it",
    Math.abs(110 + flush.dx - 103) < 1e-9, `${(110 + flush.dx).toFixed(2)} against 103`);
  check("snap: and says which line it caught on",
    flush.guides.some(g => g.axis === "x" && Math.abs(g.at - 103) < 1e-9),
    JSON.stringify(flush.guides.map(g => `${g.axis}@${g.at}`)));

  const gridded = snap.solve({
    box: box(140, 0, 50, 50),
    others: [neighbour],
    step: 16,
    tolerance: 8,
  });
  check("snap: out of reach of an edge, the grid takes over",
    Math.abs(140 + gridded.dx - 144) < 1e-9, `${(140 + gridded.dx).toFixed(2)} against 144`);
  check("snap: an axis the grid handled has no guide to draw",
    !gridded.guides.some(g => g.axis === "x"),
    gridded.guides.map(g => `${g.axis}@${g.at}`).join(","));

  check("snap: an edge in reach wins over the grid it would otherwise round to", (() => {
    const both = snap.solve({ box: box(100, 0, 50, 50), others: [neighbour], step: 16, tolerance: 8 });
    return Math.abs(100 + both.dx - 103) < 1e-9;
  })());

  check("snap: centres line up with centres, not only edges", (() => {
    const tall = box(0, 0, 61, 61);
    const found = snap.solve({
      box: box(7, 200, 50, 50), others: [tall], step: 0, tolerance: 6, origin: false,
    });
    return Math.abs(7 + found.dx + 25 - 30.5) < 1e-9;
  })(), "centre to centre");

  check("snap: the sheet's own corner is a target", (() => {
    const found = snap.solve({ box: box(3, 4, 50, 50), others: [], step: 0, tolerance: 8 });
    return Math.abs(3 + found.dx) < 1e-9 && Math.abs(4 + found.dy) < 1e-9;
  })());

  check("snap: the nearer of two neighbours wins", (() => {
    const left = box(0, 0, 40, 40);
    const right = box(100, 0, 40, 40);
    const found = snap.solve({ box: box(96, 0, 20, 20), others: [left, right], step: 0, tolerance: 8 });
    return Math.abs(96 + found.dx - 100) < 1e-9;
  })());

  check("snap: with both switched off, the position is left exactly as asked", (() => {
    const found = snap.solve({
      box: box(101.7, 3.2, 50, 50),
      others: [neighbour],
      step: 16,
      grid: false,
      edges: false,
      tolerance: 8,
    });
    return found.dx === 0 && found.dy === 0 && found.guides.length === 0;
  })());

  check("snap: edges off still leaves the grid", (() => {
    const found = snap.solve({
      box: box(101, 0, 50, 50), others: [neighbour], step: 16, edges: false, tolerance: 8,
    });
    return Math.abs(101 + found.dx - 96) < 1e-9 && found.guides.length === 0;
  })());

  check("snap: the settings read from the store's own flags", (() => {
    const on = snap.settingsOf({ snapToGrid: true, snapToEdges: false });
    const off = snap.settingsOf({ snapToGrid: false, snapToEdges: true });
    const missing = snap.settingsOf({});
    return on.grid && !on.edges && !off.grid && off.edges && missing.grid && missing.edges;
  })());
}

function runDisplayChecks() {
  const display = TX.display;

  const source = document.createElement("canvas");
  source.width = 3200;
  source.height = 2400;
  const ctx = source.getContext("2d");
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 3200, 2400);
  ctx.fillStyle = "#00ff00";
  ctx.fillRect(0, 0, 1600, 2400);

  check("display: shown at its own size, nothing is dropped",
    display.levelFor(source, 3200) === 0, String(display.levelFor(source, 3200)));
  check("display: shown small, it is halved until it barely covers the screen", (() => {
    const level = display.levelFor(source, 200);
    const size = display.sizeAt(source, level);
    return size.width >= 200 && size.width < 200 * 4;
  })(), `level ${display.levelFor(source, 200)} is `
    + `${display.sizeAt(source, display.levelFor(source, 200)).width} wide`);

  check("display: a thumbnail's worth is not halved into nothing",
    display.sizeAt(source, display.levelFor(source, 1)).width >= display.FLOOR / 2,
    `${display.sizeAt(source, display.levelFor(source, 1)).width} px at level `
    + `${display.levelFor(source, 1)}`);
  check("display: a small source is left alone", (() => {
    const small = document.createElement("canvas");
    small.width = 220;
    small.height = 160;
    return display.levelFor(small, 8) === 0;
  })());

  check("display: zooming in asks for a finer level than zooming out",
    display.levelFor(source, 100) > display.levelFor(source, 800)
    && display.levelFor(source, 800) > display.levelFor(source, 3000),
    [100, 800, 3000].map(w => display.levelFor(source, w)).join(" > "));

  const half = display.canvasAt(source, 1);
  check("display: a level is half the size of the one above it",
    half.width === 1600 && half.height === 1200, `${half.width}x${half.height}`);
  check("display: level zero is the source itself, not a copy of it",
    display.canvasAt(source, 0) === source);
  check("display: a level is built once and then reused",
    display.canvasAt(source, 1) === half && display.canvasAt(source, 2) === display.canvasAt(source, 2));

  check("display: the picture survives being halved", (() => {
    const quarter = display.canvasAt(source, 2);
    const px = (x, y) => Array.from(
      quarter.getContext("2d").getImageData(x, y, 1, 1).data);
    const left = px(Math.round(quarter.width * 0.25), Math.round(quarter.height / 2));
    const right = px(Math.round(quarter.width * 0.75), Math.round(quarter.height / 2));
    return near(left, [0, 255, 0], 8) && near(right, [255, 0, 0], 8);
  })());

  check("display: a finer level is always worth an upload", display.shouldReupload(3, 2) === true);
  check("display: a slightly coarser one is not",
    display.shouldReupload(2, 3) === false);
  check("display: a much coarser one is", display.shouldReupload(1, 3) === true);
  check("display: no change is no upload", display.shouldReupload(2, 2) === false);
}

function runProblemChecks() {
  const slice = (id, extra) => ({
    id, name: id, markId: null, x: 0, y: 0, width: 100, height: 50,
    rotation: 0, scaleX: 1, scaleY: 1, ...extra,
  });
  const doc = textures => ({ textures, marks: [] });

  check("a tidy atlas reports nothing", TX.problems.structural(doc([
    slice("a"), slice("b", { x: 120 }),
  ])).length === 0);

  const overlapping = TX.problems.structural(doc([
    slice("a"), slice("b", { x: 40, y: 10 }),
  ]));
  check("two slices on top of each other are an error",
    overlapping.length === 1 && overlapping[0].severity === "error",
    overlapping.map(p => `${p.severity}:${p.title}`).join(" / "));
  check("the overlap says which two, so they can be selected",
    overlapping[0].textureIds.slice().sort().join(",") === "a,b",
    overlapping[0].textureIds.join(","));

  check("slices that merely touch are not overlapping",
    TX.problems.structural(doc([slice("a"), slice("b", { x: 100 })])).length === 0);

  check("a mark waiting to be extracted is reported", (() => {
    const found = TX.problems.structural({
      textures: [slice("a")], marks: [{ id: "m", dirty: true }],
    });
    return found.length === 1 && found[0].severity === "warning"
      && /changed since/.test(found[0].title);
  })());

  check("two textures sharing a name are reported", (() => {
    const found = TX.problems.structural(doc([
      slice("a", { name: "wall" }), slice("b", { x: 120, name: "wall" }),
    ]));
    return found.length === 1 && found[0].textureIds.length === 2;
  })());

  check("a texture whose mark is gone is reported", (() => {
    const found = TX.problems.structural({
      textures: [slice("a", { markId: "missing" })], marks: [],
    });
    return found.length === 1 && /no longer/.test(found[0].title);
  })());

  check("a texture whose mark is still there is not", (() => {
    const found = TX.problems.structural({
      textures: [slice("a", { markId: "m" })], marks: [{ id: "m", dirty: false }],
    });
    return found.length === 0;
  })());

  check("errors sort above warnings", (() => {
    const found = TX.problems.inspect({
      textures: [slice("a", { markId: "gone" }), slice("b", { x: 40 })],
      marks: [],
      pixelEpoch: 0,
    });
    return found.length >= 2 && found[0].severity === "error";
  })());

  check("the counts split errors from warnings", (() => {
    const counted = TX.problems.countOf([
      { severity: "error" }, { severity: "warning" }, { severity: "warning" },
    ]);
    return counted.errors === 1 && counted.warnings === 2;
  })());
}

function runLensChecks() {
  const lens = TX.lens;

  const width = 800;
  const height = 600;
  const barrel = lens.project({ k1: -0.18, k2: 0.02 }, width, height);

  check("the centre of the frame is where the lens leaves it alone", (() => {
    const at = barrel.toActual({ x: width / 2, y: height / 2 });
    return Math.abs(at.x - width / 2) < 1e-9 && Math.abs(at.y - height / 2) < 1e-9;
  })());

  check("ideal and actual round-trip everywhere in the frame", (() => {
    let worst = 0;
    for (let y = 0; y <= height; y += 40) {
      for (let x = 0; x <= width; x += 40) {
        const there = barrel.toActual({ x, y });
        const back = barrel.toIdeal(there);
        worst = Math.max(worst, Math.hypot(back.x - x, back.y - y));
      }
    }
    return worst < 1e-6;
  })(), "round trip");

  check("and the other way round too", (() => {
    let worst = 0;
    for (let y = 0; y <= height; y += 40) {
      for (let x = 0; x <= width; x += 40) {
        const back = barrel.toIdeal({ x, y });
        const there = barrel.toActual(back);
        worst = Math.max(worst, Math.hypot(there.x - x, there.y - y));
      }
    }
    return worst < 1e-6;
  })());

  check("negative k1 is barrel — the lens pulls the corners inward", (() => {
    const corner = { x: width, y: height };
    const at = barrel.toActual(corner);
    const before = Math.hypot(corner.x - width / 2, corner.y - height / 2);
    const after = Math.hypot(at.x - width / 2, at.y - height / 2);
    return after < before;
  })());
  check("and positive k1 is pincushion, pushing them out", (() => {
    const pin = lens.project({ k1: 0.18 }, width, height);
    const corner = { x: width, y: height };
    const at = pin.toActual(corner);
    return Math.hypot(at.x - width / 2, at.y - height / 2)
      > Math.hypot(corner.x - width / 2, corner.y - height / 2);
  })());

  check("a coefficient means the same thing at any resolution", (() => {
    const small = lens.project({ k1: -0.18, k2: 0.02 }, width / 4, height / 4);
    const big = barrel.toActual({ x: width * 0.8, y: height * 0.7 });
    const little = small.toActual({ x: (width / 4) * 0.8, y: (height / 4) * 0.7 });
    return Math.abs((big.x / width) - (little.x / (width / 4))) < 1e-9
      && Math.abs((big.y / height) - (little.y / (height / 4))) < 1e-9;
  })());

  check("no coefficients is the identity, and cheap", (() => {
    const none = lens.project({ k1: 0, k2: 0 }, width, height);
    const p = { x: 123, y: 456 };
    return none.identity && none.toActual(p).x === 123 && none.toIdeal(p).y === 456;
  })());
  check("the coefficients clamp to a range the model stays invertible over",
    lens.settingsOf({ k1: 9 }).k1 === 0.5 && lens.settingsOf({ k2: -9 }).k2 === -0.25);

  // ---- straightness, and fitting ----

  const straightLine = [];
  for (let i = 0; i <= 16; i++) {
    straightLine.push({ x: 80 + (640 * i) / 16, y: 120 });
  }
  check("a straight run of points measures as straight",
    lens.straightness(straightLine) < 1e-9, lens.straightness(straightLine).toFixed(9));
  const bowed = straightLine.map(p => barrel.toActual(p));
  check("the same line seen through a lens does not",
    lens.straightness(bowed) > 0.002, lens.straightness(bowed).toFixed(5));
  check("and undistorting it makes it straight again",
    lens.straightness(bowed.map(p => barrel.toIdeal(p))) < 1e-6);

  check("the fit recovers a coefficient it was given", (() => {
    const truth = -0.16;
    const camera = lens.project({ k1: truth }, width, height);
    const marks = [0, 1].map(index => {
      const y0 = 120 + index * 260;
      const ideal = [
        { x: 90, y: y0 }, { x: 710, y: y0 },
        { x: 710, y: y0 + 140 }, { x: 90, y: y0 + 140 },
      ];
      const points = ideal.map(p => camera.toActual(p));
      const curve = TX.geom.flatCurve();
      const h = TX.geom.squareToQuad(points);
      const inverse = TX.geom.invert3(h);
      for (let edge = 0; edge < 4; edge++) {
        const a = TX.geom.UNIT_CORNERS[edge];
        const b = TX.geom.UNIT_CORNERS[(edge + 1) % 4];
        const midIdeal = {
          x: (ideal[edge].x + ideal[(edge + 1) % 4].x) / 2,
          y: (ideal[edge].y + ideal[(edge + 1) % 4].y) / 2,
        };
        const seen = TX.geom.applyHomography(
          inverse, camera.toActual(midIdeal).x, camera.toActual(midIdeal).y);
        const off = {
          x: (seen.x - (a.x + b.x) / 2) * (4 / 3),
          y: (seen.y - (a.y + b.y) / 2) * (4 / 3),
        };
        curve[edge] = { a: { ...off }, b: { ...off } };
      }
      return { id: `m${index}`, imageId: "i", points, domain: TX.geom.unitDomain(), curve };
    });

    const found = lens.fit(marks, width, height);
    return found && Math.abs(found.k1 - truth) < 0.03 && found.improvement > 0.5;
  })(), (() => {
    const truth = -0.16;
    const camera = lens.project({ k1: truth }, width, height);
    const ideal = [{ x: 90, y: 120 }, { x: 710, y: 120 },
      { x: 710, y: 260 }, { x: 90, y: 260 }];
    const points = ideal.map(p => camera.toActual(p));
    const curve = TX.geom.flatCurve();
    const inverse = TX.geom.invert3(TX.geom.squareToQuad(points));
    for (let edge = 0; edge < 4; edge++) {
      const a = TX.geom.UNIT_CORNERS[edge];
      const b = TX.geom.UNIT_CORNERS[(edge + 1) % 4];
      const midIdeal = {
        x: (ideal[edge].x + ideal[(edge + 1) % 4].x) / 2,
        y: (ideal[edge].y + ideal[(edge + 1) % 4].y) / 2,
      };
      const seen = TX.geom.applyHomography(
        inverse, camera.toActual(midIdeal).x, camera.toActual(midIdeal).y);
      const off = { x: (seen.x - (a.x + b.x) / 2) * (4 / 3),
        y: (seen.y - (a.y + b.y) / 2) * (4 / 3) };
      curve[edge] = { a: { ...off }, b: { ...off } };
    }
    const found = lens.fit([{ id: "m", imageId: "i", points,
      domain: TX.geom.unitDomain(), curve }], width, height);
    return found ? `one mark gives k1 ${found.k1.toFixed(4)} vs ${truth}` : "no fit";
  })());

  check("straight edges are no evidence and produce no fit", (() => {
    const flatMark = {
      id: "f",
      imageId: "i",
      points: q([[100, 100], [300, 100], [300, 200], [100, 200]]),
      domain: TX.geom.unitDomain(),
      curve: TX.geom.flatCurve(),
    };
    return lens.fit([flatMark], width, height) === null;
  })());

  check("a quad is fitted in ideal coordinates, not distorted ones", (() => {
    const ideal = q([[100, 100], [300, 110], [310, 260], [90, 240]]);
    const points = ideal.map(p => barrel.toActual(p));
    const fitted = TX.geom.fitQuad(points, barrel);
    const plain = TX.geom.squareToQuad(points);
    if (!fitted || !plain) return false;
    let worst = 0;
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
      const at = TX.geom.applyHomography(fitted, u, v);
      worst = Math.max(worst, Math.hypot(at.x - ideal[i].x, at.y - ideal[i].y));
    });
    return worst < 1e-6;
  })());
  check("and localToImage puts it back through the lens", (() => {
    const ideal = q([[100, 100], [300, 110], [310, 260], [90, 240]]);
    const points = ideal.map(p => barrel.toActual(p));
    const fitted = TX.geom.fitQuad(points, barrel);
    let worst = 0;
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
      const at = TX.geom.localToImage(fitted, TX.geom.flatCurve(), u, v, barrel);
      worst = Math.max(worst, Math.hypot(at.x - points[i].x, at.y - points[i].y));
    });
    return worst < 1e-6;
  })());

  // ---- and the thing it is all for ----
  const PHOTO_W = 240;
  const PHOTO_H = 180;
  const camera = lens.project({ k1: -0.22 }, PHOTO_W, PHOTO_H);

  const shot = (() => {
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_W;
    canvas.height = PHOTO_H;
    const ctx = canvas.getContext("2d");
    const out = ctx.createImageData(PHOTO_W, PHOTO_H);
    const sceneAt = (x, y) => (Math.abs((y % 30) - 0) < 1.5 ? 0 : 255);
    for (let y = 0; y < PHOTO_H; y++) {
      for (let x = 0; x < PHOTO_W; x++) {
        const ideal = camera.toIdeal({ x: x + 0.5, y: y + 0.5 });
        const value = sceneAt(ideal.x, ideal.y);
        const i = (y * PHOTO_W + x) * 4;
        out.data[i] = value;
        out.data[i + 1] = value;
        out.data[i + 2] = value;
        out.data[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  })();

  const ruleInPhoto = idealY => {
    const points = [];
    for (let i = 0; i <= 10; i++) {
      const idealX = 20 + (200 * i) / 10;
      points.push(camera.toActual({ x: idealX, y: idealY }));
    }
    return points;
  };
  check("the synthesised photograph really is distorted",
    lens.straightness(ruleInPhoto(60)) > 0.004,
    lens.straightness(ruleInPhoto(60)).toFixed(5));

  const source = TX.warp.createSource(shot);
  const region = q([[30, 30], [210, 30], [210, 150], [30, 150]]);
  const withLens = TX.warp.warpQuad(source, region, { lens: { k1: -0.22 }, supersample: 1 });
  const without = TX.warp.warpQuad(source, region, { supersample: 1 });

  const wander = canvas => {
    if (!canvas) return null;
    const { data } = canvas.getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height);
    const darkestIn = (x, from, to) => {
      let best = -1;
      let darkest = 170;
      for (let y = Math.max(1, from); y < Math.min(canvas.height - 1, to); y++) {
        const at = (y * canvas.width + x) * 4;
        if (data[at + 3] > 128 && data[at] < darkest) {
          darkest = data[at];
          best = y;
        }
      }
      return best;
    };

    const startX = 6;
    let row = darkestIn(startX, 2, Math.floor(canvas.height * 0.45));
    if (row < 0) return null;

    const rows = [row];
    for (let x = startX + 4; x < canvas.width - 6; x += 4) {
      const next = darkestIn(x, row - 6, row + 7);
      if (next < 0) continue;
      row = next;
      rows.push(row);
    }
    if (rows.length < 10) return null;
    return (Math.max(...rows) - Math.min(...rows)) / canvas.height;
  };

  const wandered = wander(without);
  const straightened = wander(withLens);
  check("a rule found in both extractions", wandered !== null && straightened !== null,
    `${wandered} uncorrected, ${straightened} corrected`);
  if (wandered !== null && straightened !== null) {
    check("uncorrected, the rule wanders across the texture", wandered > 0.03,
      `${(wandered * 100).toFixed(1)}% of the height`);
    check("corrected, it comes out straight", straightened < wandered / 3,
      `${(straightened * 100).toFixed(1)}% vs ${(wandered * 100).toFixed(1)}% uncorrected`);
  }
}

function runRectifyChecks() {
  const geom = TX.geom;

  const flat = q([[100, 100], [300, 100], [300, 200], [100, 200]]);
  const flatPlan = geom.rectifyPlan(flat, 400, 300);
  check("a fronto-parallel mark rectifies the whole frame",
    flatPlan && !flatPlan.clipped && flatPlan.coverage > 0.999,
    flatPlan ? `clipped=${flatPlan.clipped} coverage=${flatPlan.coverage.toFixed(3)}` : "null");
  check("and the frame's corners land where the mark's own scale puts them", (() => {
    const d = flatPlan.domain;
    return Math.abs(d.u0 + 0.5) < 1e-6 && Math.abs(d.u1 - 1.5) < 1e-6
      && Math.abs(d.v0 + 1) < 1e-6 && Math.abs(d.v1 - 2) < 1e-6;
  })(), JSON.stringify(flatPlan.domain));
  check("the output keeps the mark's own resolution", (() => {
    const s = flatPlan.size;
    return s.width === 400 && s.height === 300;
  })(), `${flatPlan.size.width}x${flatPlan.size.height}`);

  const keystone = q([[150, 100], [250, 100], [320, 220], [80, 220]]);
  const keyPlan = geom.rectifyPlan(keystone, 400, 300);
  check("a receding plane is cut short of its horizon", keyPlan && keyPlan.clipped,
    keyPlan ? `clipped=${keyPlan.clipped}` : "null");
  check("and what is left is a real part of the frame",
    keyPlan.coverage > 0.05 && keyPlan.coverage < 1,
    keyPlan.coverage.toFixed(3));
  check("the domain stays finite and bounded",
    [keyPlan.domain.u0, keyPlan.domain.v0, keyPlan.domain.u1, keyPlan.domain.v1]
      .every(v => Number.isFinite(v) && Math.abs(v) <= geom.MAX_UNITS + 1),
    JSON.stringify(keyPlan.domain));
  check("the mark's own square is always inside it",
    keyPlan.domain.u0 <= 0 && keyPlan.domain.v0 <= 0
    && keyPlan.domain.u1 >= 1 && keyPlan.domain.v1 >= 1,
    JSON.stringify(keyPlan.domain));

  check("every point the plan will sample is on the mark's side of the horizon", (() => {
    const h = geom.squareToQuad(keystone);
    const inverse = geom.quadToSquare(keystone);
    const depth = p => inverse[6] * p.x + inverse[7] * p.y + inverse[8];
    const centre = geom.applyHomography(h, 0.5, 0.5);
    const sign = depth(centre) < 0 ? -1 : 1;
    const d = keyPlan.domain;
    let worst = Infinity;
    for (let i = 0; i <= 12; i++) {
      for (let j = 0; j <= 12; j++) {
        const at = geom.applyHomography(h, d.u0 + (d.u1 - d.u0) * (i / 12),
          d.v0 + (d.v1 - d.v0) * (j / 12));
        if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return false;
        worst = Math.min(worst, sign * depth(at));
      }
    }
    return worst > 0;
  })());

  const near = geom.rectifyPlan(keystone, 400, 300, { margin: 0.02 });
  const wide = geom.rectifyPlan(keystone, 400, 300, { margin: 0.4 });
  check("a smaller margin reaches further toward the horizon",
    near.coverage > wide.coverage,
    `${near.coverage.toFixed(3)} at 0.02 vs ${wide.coverage.toFixed(3)} at 0.4`);
  check("and it therefore asks for a larger area",
    (near.domain.v1 - near.domain.v0) > (wide.domain.v1 - wide.domain.v0),
    `${(near.domain.v1 - near.domain.v0).toFixed(2)} vs `
    + `${(wide.domain.v1 - wide.domain.v0).toFixed(2)}`);

  const uncapped = geom.rectifyPlan(keystone, 400, 300, { margin: 0.01, maxSide: 1e6 });
  const capped = geom.rectifyPlan(keystone, 400, 300, { margin: 0.01, maxSide: 512 });
  check("the output is capped whatever the perspective wants",
    Math.max(capped.size.width, capped.size.height) <= 512,
    `${capped.size.width}x${capped.size.height}`);
  check("and capping scales rather than crops", capped.scale < 1
    && JSON.stringify(capped.domain) === JSON.stringify(uncapped.domain)
    && Math.abs(capped.size.width / capped.size.height
      - uncapped.size.width / uncapped.size.height) < 0.02,
    `${capped.size.width}x${capped.size.height} from `
    + `${uncapped.size.width}x${uncapped.size.height}`);

  check("a degenerate mark has no plane to rectify",
    geom.rectifyPlan(q([[0, 0], [10, 10], [20, 20], [0, 40]]), 400, 300) === null);
  check("and neither has a frame with no area",
    geom.rectifyPlan(flat, 0, 300) === null);

  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  check("clipping by a line that misses leaves the shape alone",
    geom.clipHalfPlane(square, () => 1).length === 4);
  check("clipping by a line that excludes everything leaves nothing",
    geom.clipHalfPlane(square, () => -1).length === 0);
  check("clipping a square in half gives four corners with the right area", (() => {
    const half = geom.clipHalfPlane(square, p => 5 - p.y);
    if (half.length !== 4) return false;
    return half.every(p => p.y <= 5 + 1e-9);
  })());
}

function runFlipChecks() {
  const source = makeGradientCanvas(64, 48);
  const corner = pixelAt(source, 0, 0);
  const opposite = pixelAt(source, 63, 0);

  const x = TX.flip.apply(source, { x: true, y: false });
  check("flipping X keeps the dimensions", x.width === 64 && x.height === 48,
    `${x.width}x${x.height}`);
  check("flipping X swaps left for right",
    near(pixelAt(x, 63, 0), corner, 1) && near(pixelAt(x, 0, 0), opposite, 1),
    `${pixelAt(x, 63, 0).join(",")} vs ${corner.join(",")}`);
  check("flipping X leaves the rows where they were",
    near(pixelAt(x, 63, 47), pixelAt(source, 0, 47), 1));

  const y = TX.flip.apply(source, { x: false, y: true });
  check("flipping Y swaps top for bottom",
    near(pixelAt(y, 0, 47), corner, 1) && near(pixelAt(y, 0, 0), pixelAt(source, 0, 47), 1));

  const both = TX.flip.apply(source, { x: true, y: true });
  check("flipping both puts a corner diagonally opposite",
    near(pixelAt(both, 63, 47), corner, 1));

  const back = TX.flip.apply(TX.flip.apply(source, { x: true }), { x: true });
  check("flipping twice restores the original exactly", (() => {
    for (const [px, py] of [[0, 0], [17, 5], [63, 47], [32, 24]]) {
      if (!near(pixelAt(back, px, py), pixelAt(source, px, py), 0)) return false;
    }
    return true;
  })());

  check("no flip returns the source untouched",
    TX.flip.resolve("t", source, { x: false, y: false }, 1) === source);
  check("the key distinguishes the four states", new Set([
    TX.flip.keyOf({ x: false, y: false }, 1),
    TX.flip.keyOf({ x: true, y: false }, 1),
    TX.flip.keyOf({ x: false, y: true }, 1),
    TX.flip.keyOf({ x: true, y: true }, 1),
  ]).size === 4);
  check("the key changes when the pixels underneath do",
    TX.flip.keyOf({ x: true }, 1) !== TX.flip.keyOf({ x: true }, 2));
}

function runTilingChecks() {
  const source = makeGradientCanvas(64, 48);

  const rawSeam = TX.tiling.seamError(source);
  check("gradient source starts with a large seam", rawSeam > 200, `seam=${rawSeam}`);

  const feathered = TX.tiling.featherEdges(source, 0.2);
  check("feather keeps the dimensions", feathered.width === 64 && feathered.height === 48,
    `${feathered.width}x${feathered.height}`);
  const featheredSeam = TX.tiling.seamError(feathered);
  check("feather makes opposite edges identical", featheredSeam === 0, `seam=${featheredSeam}`);

  const centreBefore = pixelAt(source, 32, 24);
  const centreAfter = pixelAt(feathered, 32, 24);
  check("feather leaves the interior untouched", near(centreAfter, centreBefore, 1),
    `${centreBefore.join(",")} -> ${centreAfter.join(",")}`);

  const narrow = TX.tiling.featherEdges(source, 0.02);
  check("a narrow band still closes the seam", TX.tiling.seamError(narrow) === 0,
    `seam=${TX.tiling.seamError(narrow)}`);

  const bothAxes = TX.tiling.seamErrors(source);
  check("the gradient source has a seam on each axis",
    bothAxes.x > 100 && bothAxes.y > 100, `x=${bothAxes.x} y=${bothAxes.y}`);

  const onX = TX.tiling.seamErrors(TX.tiling.featherEdges(source, 0.2, "x"));
  check("feathering X alone closes the left/right seam", onX.x === 0, `x=${onX.x}`);
  check("and leaves the top/bottom seam exactly as it was", onX.y === bothAxes.y,
    `${onX.y} vs ${bothAxes.y}`);

  const onY = TX.tiling.seamErrors(TX.tiling.featherEdges(source, 0.2, "y"));
  check("feathering Y alone closes the top/bottom seam", onY.y === 0, `y=${onY.y}`);
  check("and leaves the left/right seam alone", onY.x === bothAxes.x, `${onY.x} vs ${bothAxes.x}`);

  const onBoth = TX.tiling.seamErrors(TX.tiling.featherEdges(source, 0.2, "xy"));
  check("both closes both", onBoth.x === 0 && onBoth.y === 0, `${onBoth.x}/${onBoth.y}`);

  const edgeBefore = pixelAt(source, 32, 1);
  const edgeAfterX = pixelAt(TX.tiling.featherEdges(source, 0.2, "x"), 32, 1);
  check("feathering X does not touch a top-edge pixel", near(edgeAfterX, edgeBefore, 1),
    `${edgeBefore.join(",")} -> ${edgeAfterX.join(",")}`);

  check("an unknown axis falls back to both",
    TX.tiling.axisOf({ axis: "diagonal" }) === "xy" && TX.tiling.axisOf(null) === "xy");
  check("the default tiling welds both axes", TX.tiling.defaults().axis === "xy");
  check("apply passes the axis through",
    TX.tiling.seamErrors(TX.tiling.apply(source, { mode: "feather", band: 0.2, axis: "x" })).y
      === bothAxes.y);

  const mirrored = TX.tiling.mirrorTile(source);
  check("mirror doubles both dimensions", mirrored.width === 128 && mirrored.height === 96,
    `${mirrored.width}x${mirrored.height}`);
  check("mirror tiles seamlessly", TX.tiling.seamError(mirrored) === 0,
    `seam=${TX.tiling.seamError(mirrored)}`);
  const left = pixelAt(mirrored, 4, 24);
  const right = pixelAt(mirrored, 123, 24);
  check("mirror reflects rather than repeats", near(left, right, 2),
    `${left.join(",")} vs ${right.join(",")}`);

  check("tiling mode 'none' returns the source untouched",
    TX.tiling.apply(source, { mode: "none", band: 0.2 }) === source);

  const a = TX.tiling.resolve("t1", source, { mode: "feather", band: 0.2 }, 1);
  const again = TX.tiling.resolve("t1", source, { mode: "feather", band: 0.2 }, 1);
  const changed = TX.tiling.resolve("t1", source, { mode: "feather", band: 0.4 }, 1);
  const bumped = TX.tiling.resolve("t1", source, { mode: "feather", band: 0.4 }, 2);
  const axed = TX.tiling.resolve("t1", source, { mode: "feather", band: 0.4, axis: "x" }, 2);
  check("resolve caches an unchanged request", a === again);
  check("resolve rebuilds when the band changes", changed !== a);
  check("resolve rebuilds when the source version changes", bumped !== changed);
  check("resolve rebuilds when the axis changes", axed !== bumped);
  TX.tiling.invalidate();
}

function makeRampCanvas(width, height, along) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = along === "x" ? x / (width - 1) : y / (height - 1);
      const v = Math.round(t * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

function makeFlatCanvas(width, height, value) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${value},${value},${value})`;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

// ---- the maps inferred from the colour alone -----------------------------

function makeCheckerCanvas(size, mean, amplitude, cell) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  for (let y = 0, i = 0; y < size; y++) {
    for (let x = 0; x < size; x++, i += 4) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const value = mean + (on ? amplitude : -amplitude);
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function runPbrChecks() {
  const pbr = TX.pbr;
  const mean = canvas => {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) total += data[i];
    return total / (data.length / 4) / 255;
  };

  // --- luma ---
  const { luma } = pbr.lumaOf(makeFlatCanvas(8, 8, 255));
  check("white reads as full luma", Math.abs(luma[0] - 1) < 0.005, luma[0].toFixed(3));
  const green = document.createElement("canvas");
  green.width = 4;
  green.height = 4;
  green.getContext("2d").fillStyle = "#00ff00";
  green.getContext("2d").fillRect(0, 0, 4, 4);
  const blue = document.createElement("canvas");
  blue.width = 4;
  blue.height = 4;
  blue.getContext("2d").fillStyle = "#0000ff";
  blue.getContext("2d").fillRect(0, 0, 4, 4);
  check("luma is weighted perceptually, not as a flat average",
    pbr.lumaOf(green).luma[0] > 0.6 && pbr.lumaOf(blue).luma[0] < 0.15,
    `${pbr.lumaOf(green).luma[0].toFixed(2)} vs ${pbr.lumaOf(blue).luma[0].toFixed(2)}`);

  // --- blur ---
  const flatField = new Float32Array(64 * 64).fill(0.4);
  const blurredFlat = pbr.blur(flatField, 64, 64, 3);
  check("blurring a flat field leaves it flat",
    Math.abs(blurredFlat[0] - 0.4) < 1e-5 && Math.abs(blurredFlat[2000] - 0.4) < 1e-5,
    blurredFlat[2000].toFixed(6));

  const spike = new Float32Array(64 * 64);
  spike[32 * 64 + 32] = 1;
  const spread = pbr.blur(spike, 64, 64, 4);
  check("a blur spreads a spike into its neighbours",
    spread[32 * 64 + 32] < 0.02 && spread[32 * 64 + 34] > 0,
    `${spread[32 * 64 + 32].toFixed(4)} at the peak`);
  check("a blur does not consume what it spreads",
    Math.abs(spike.reduce((a, b) => a + b, 0) - spread.reduce((a, b) => a + b, 0)) < 0.05);
  check("a blur leaves its input alone", spike[32 * 64 + 32] === 1);

  // --- the decomposition ---
  const flatParts = pbr.decompose("pbr-flat", makeFlatCanvas(64, 64, 120), "a");
  check("a flat colour has no detail energy", flatParts.energy < 1e-6,
    flatParts.energy.toExponential(2));

  const rampParts = pbr.decompose("pbr-ramp", makeRampCanvas(64, 64, "x"), "a");
  const checkerParts = pbr.decompose("pbr-check", makeCheckerCanvas(64, 128, 40, 4), "a");
  check("a smooth ramp has far less detail energy than a checker",
    rampParts.energy < checkerParts.energy / 5,
    `${rampParts.energy.toFixed(4)} vs ${checkerParts.energy.toFixed(4)}`);

  // --- height ---
  const flatHeight = pbr.heightMap(flatParts, 1);
  check("a flat colour gives a flat height map",
    Math.abs(pixelAt(flatHeight, 32, 32)[0] - 128) <= 1,
    String(pixelAt(flatHeight, 32, 32)[0]));
  const rampHeight = pbr.heightMap(rampParts, 1);
  check("a ramp stays near flat in the height map, because it is not relief",
    Math.abs(mean(rampHeight) - 0.5) < 0.04 && Math.abs(pixelAt(rampHeight, 32, 32)[0] - 128) < 24,
    String(pixelAt(rampHeight, 32, 32)[0]));

  const checkerHeight = pbr.heightMap(checkerParts, 1);
  const light = pixelAt(checkerHeight, 2, 2)[0];
  const dark = pixelAt(checkerHeight, 6, 2)[0];
  check("a checker's light cells stand proud of its dark ones", light > dark + 30,
    `${light} vs ${dark}`);
  const gentleHeight = pbr.heightMap(checkerParts, 0.25);
  check("less relief means a shallower height map",
    Math.abs(pixelAt(gentleHeight, 2, 2)[0] - 128) < Math.abs(light - 128),
    `${pixelAt(gentleHeight, 2, 2)[0]} vs ${light}`);

  // --- roughness ---
  const rough = pbr.roughnessFrom(checkerParts, 0.6, 0.5);
  check("the roughness map is greyscale and opaque",
    (() => {
      const p = pixelAt(rough, 10, 10);
      return p[0] === p[1] && p[1] === p[2] && p[3] === 255;
    })(), pixelAt(rough, 10, 10).join(","));
  check("a roughness map sits around the base it was given",
    Math.abs(mean(rough) - 0.6) < 0.3, mean(rough).toFixed(3));
  check("a higher base gives a rougher map",
    mean(pbr.roughnessFrom(checkerParts, 0.9, 0.5)) > mean(rough) + 0.15,
    `${mean(rough).toFixed(3)} -> ${mean(pbr.roughnessFrom(checkerParts, 0.9, 0.5)).toFixed(3)}`);
  check("zero amount gives exactly the base, flat",
    Math.abs(mean(pbr.roughnessFrom(checkerParts, 0.6, 0)) - 0.6) < 0.01,
    mean(pbr.roughnessFrom(checkerParts, 0.6, 0)).toFixed(3));

  const blown = pbr.decompose("pbr-blown", makeCheckerCanvas(64, 250, 5, 4), "a");
  check("a blown-out surface reads smoother than a mid-grey one",
    mean(pbr.roughnessFrom(blown, 0.6, 1)) < mean(pbr.roughnessFrom(checkerParts, 0.6, 1)),
    `${mean(pbr.roughnessFrom(blown, 0.6, 1)).toFixed(3)} vs `
      + `${mean(pbr.roughnessFrom(checkerParts, 0.6, 1)).toFixed(3)}`);

  // --- cavity ---
  const flatCavity = pbr.cavityFrom(flatParts, 1);
  check("a flat colour has no cavities", pixelAt(flatCavity, 32, 32)[0] === 255,
    String(pixelAt(flatCavity, 32, 32)[0]));

  const blobbed = document.createElement("canvas");
  blobbed.width = 96;
  blobbed.height = 96;
  {
    const ctx = blobbed.getContext("2d");
    ctx.fillStyle = "rgb(180,180,180)";
    ctx.fillRect(0, 0, 96, 96);
    ctx.fillStyle = "rgb(40,40,40)";
    ctx.fillRect(44, 44, 8, 8);
  }
  const blobParts = pbr.decompose("pbr-blob", blobbed, "a");
  const cavity = pbr.cavityFrom(blobParts, 1);
  check("a dark patch reads as a recess", pixelAt(cavity, 48, 48)[0] < 160,
    String(pixelAt(cavity, 48, 48)[0]));
  check("cavity never brightens the surface around it",
    pixelAt(cavity, 4, 4)[0] === 255, String(pixelAt(cavity, 4, 4)[0]));

  const inverted = document.createElement("canvas");
  inverted.width = 96;
  inverted.height = 96;
  {
    const ctx = inverted.getContext("2d");
    ctx.fillStyle = "rgb(40,40,40)";
    ctx.fillRect(0, 0, 96, 96);
    ctx.fillStyle = "rgb(230,230,230)";
    ctx.fillRect(44, 44, 8, 8);
  }
  const bright = pbr.cavityFrom(pbr.decompose("pbr-bright", inverted, "a"), 1);
  check("a light patch is not a mound, so cavity leaves it alone",
    pixelAt(bright, 48, 48)[0] === 255, String(pixelAt(bright, 48, 48)[0]));

  const weakCavity = pbr.cavityFrom(blobParts, 0.25);
  check("the cavity strength scales back toward open",
    pixelAt(weakCavity, 48, 48)[0] > pixelAt(cavity, 48, 48)[0],
    `${pixelAt(cavity, 48, 48)[0]} -> ${pixelAt(weakCavity, 48, 48)[0]}`);

  // --- the suggestion ---
  const advice = pbr.suggest("pbr-check", makeCheckerCanvas(64, 128, 40, 4), 1);
  const s = advice.settings;
  check("the suggestion turns on every channel it offers",
    s.detailNormal > 0 && s.roughnessAmount > 0 && s.cavity > 0,
    `${s.detailNormal}/${s.roughnessAmount}/${s.cavity}`);
  check("the suggestion survives the settings clamp unchanged",
    (() => {
      const kept = TX.material.settingsOf(s);
      return kept.detailNormal === s.detailNormal && kept.roughnessAmount === s.roughnessAmount
        && kept.cavity === s.cavity && kept.roughness === s.roughness;
    })(), JSON.stringify(s));
  check("the suggestion never guesses a photographed surface is metal", s.metalness === 0);

  const calm = pbr.suggest("pbr-calm", makeCheckerCanvas(64, 128, 3, 4), 1);
  check("a busier surface is suggested more relief than a calm one",
    s.detailNormal > calm.settings.detailNormal,
    `${calm.settings.detailNormal} -> ${s.detailNormal}`);

  const glossy = pbr.suggest("pbr-glossy", makeCheckerCanvas(64, 246, 8, 4), 1);
  check("a surface full of highlights is suggested a lower base roughness",
    glossy.settings.roughness < s.roughness,
    `${s.roughness} -> ${glossy.settings.roughness}`);
  check("a texture with nothing in it gives no advice", pbr.suggest("x", null, 1) === null);
}

function runMaterialChecks() {
  const material = TX.material;

  // --- settings ---
  const clamped = material.settingsOf({
    shape: "dodecahedron", roughness: 5, metalness: -2, normal: 99, occlusion: "x",
  });
  check("material settings fall back to the default shape",
    clamped.shape === material.defaults().shape, clamped.shape);
  check("material settings clamp roughness and metalness",
    clamped.roughness === 1 && clamped.metalness === 0,
    `${clamped.roughness}/${clamped.metalness}`);
  check("material settings clamp relief and reject non-numbers",
    clamped.normal === 4 && clamped.occlusion === material.defaults().occlusion,
    `${clamped.normal}/${clamped.occlusion}`);
  for (const shape of material.SHAPES) {
    check(`material settings keep the ${shape} shape`,
      material.settingsOf({ shape }).shape === shape);
  }

  // --- the fitted extents ---
  const wide = material.extents(200, 100);
  const tall = material.extents(100, 200);
  check("a wide texture fits with its width at one unit",
    wide.x === 1 && Math.abs(wide.y - 0.5) < 1e-9, `${wide.x}x${wide.y}`);
  check("a tall texture fits with its height at one unit",
    tall.y === 1 && Math.abs(tall.x - 0.5) < 1e-9, `${tall.x}x${tall.y}`);
  check("a square texture fits a unit square",
    material.extents(64, 64).x === 1 && material.extents(64, 64).y === 1);
  check("degenerate sizes still produce a unit quad",
    material.extents(0, 0).x === 1 && material.extents(64, 0).y === 1);

  // --- normals ---
  const decode = (canvas, x, y) => {
    const [r, g, b] = pixelAt(canvas, x, y);
    return { x: r / 255 * 2 - 1, y: g / 255 * 2 - 1, z: b / 255 * 2 - 1 };
  };

  const flat = material.normalMap(makeFlatCanvas(32, 32, 128), 1);
  check("flat shading gives a flat normal map", near(pixelAt(flat, 16, 16), [128, 128, 255], 1),
    pixelAt(flat, 16, 16).join(","));

  const noRelief = material.normalMap(makeRampCanvas(32, 32, "x"), 0);
  check("zero relief gives a flat normal map even over a gradient",
    near(pixelAt(noRelief, 16, 16), [128, 128, 255], 1), pixelAt(noRelief, 16, 16).join(","));

  const acrossX = material.normalMap(makeRampCanvas(64, 64, "x"), 1);
  const nx = decode(acrossX, 32, 32);
  check("a brightening-rightward ramp tilts the normal left", nx.x < -0.1, nx.x.toFixed(3));
  check("an x ramp leaves the green channel neutral", Math.abs(nx.y) < 0.01, nx.y.toFixed(3));

  const acrossY = material.normalMap(makeRampCanvas(64, 64, "y"), 1);
  const ny = decode(acrossY, 32, 32);
  check("a brightening-downward ramp tilts the normal down", ny.y > 0.1, ny.y.toFixed(3));
  check("a y ramp leaves the red channel neutral", Math.abs(ny.x) < 0.01, ny.x.toFixed(3));

  check("encoded normals are unit length",
    Math.abs(Math.hypot(nx.x, nx.y, nx.z) - 1) < 0.01,
    Math.hypot(nx.x, nx.y, nx.z).toFixed(4));
  check("encoded normals always face out of the surface", nx.z > 0 && ny.z > 0);

  const gentle = decode(material.normalMap(makeRampCanvas(64, 64, "x"), 0.3), 32, 32);
  const steep = decode(material.normalMap(makeRampCanvas(64, 64, "x"), 3), 32, 32);
  check("more relief tilts the normal further", steep.x < gentle.x && gentle.x < 0,
    `${gentle.x.toFixed(3)} -> ${steep.x.toFixed(3)}`);

  check("the normal map keeps the shading's dimensions",
    acrossX.width === 64 && acrossX.height === 64, `${acrossX.width}x${acrossX.height}`);
  check("no shading means no normal map", material.normalMap(null, 1) === null);

  // --- occlusion ---
  const neutral = material.occlusionMap(makeFlatCanvas(16, 16, 128), 1);
  check("neutral shading is unoccluded", pixelAt(neutral, 8, 8)[0] === 255,
    String(pixelAt(neutral, 8, 8)[0]));

  const bright = material.occlusionMap(makeFlatCanvas(16, 16, 255), 1);
  check("shading brighter than neutral clamps to unoccluded, never above",
    pixelAt(bright, 8, 8)[0] === 255, String(pixelAt(bright, 8, 8)[0]));

  const dark = material.occlusionMap(makeFlatCanvas(16, 16, 0), 1);
  check("fully dark shading is fully occluded", pixelAt(dark, 8, 8)[0] === 0,
    String(pixelAt(dark, 8, 8)[0]));

  const half = material.occlusionMap(makeFlatCanvas(16, 16, 64), 1);
  check("half-lit shading is half occluded", Math.abs(pixelAt(half, 8, 8)[0] - 128) <= 2,
    String(pixelAt(half, 8, 8)[0]));

  const weak = material.occlusionMap(makeFlatCanvas(16, 16, 0), 0.25);
  check("the occlusion strength scales toward unoccluded",
    Math.abs(pixelAt(weak, 8, 8)[0] - 191) <= 2, String(pixelAt(weak, 8, 8)[0]));

  const grey = material.occlusionMap(makeRampCanvas(32, 32, "x"), 1);
  const sample = pixelAt(grey, 8, 16);
  check("occlusion is written greyscale so other tools can read it",
    sample[0] === sample[1] && sample[1] === sample[2] && sample[3] === 255,
    sample.join(","));
  check("no shading means no occlusion map", material.occlusionMap(null, 1) === null);

  // --- combining two derivations ---
  const flatN = material.normalMap(makeFlatCanvas(64, 64, 128), 1);
  const tilted = material.normalMap(makeRampCanvas(64, 64, "x"), 1);
  const withFlat = decode(material.combineNormals(tilted, flatN), 32, 32);
  const single = decode(tilted, 32, 32);
  check("combining with a flat normal map changes nothing",
    Math.abs(withFlat.x - single.x) < 0.01, `${single.x.toFixed(3)} -> ${withFlat.x.toFixed(3)}`);

  const doubled = decode(material.combineNormals(tilted, tilted), 32, 32);
  check("combining two identical tilts leans further, not the same",
    doubled.x < single.x - 0.05, `${single.x.toFixed(3)} -> ${doubled.x.toFixed(3)}`);
  check("a combined normal is still unit length",
    Math.abs(Math.hypot(doubled.x, doubled.y, doubled.z) - 1) < 0.01,
    Math.hypot(doubled.x, doubled.y, doubled.z).toFixed(4));
  check("a combined normal still faces out of the surface", doubled.z > 0);

  const acrossBoth = decode(material.combineNormals(tilted,
    material.normalMap(makeRampCanvas(64, 64, "y"), 1)), 32, 32);
  check("combining an x tilt with a y tilt keeps both",
    acrossBoth.x < -0.05 && acrossBoth.y > 0.05,
    `${acrossBoth.x.toFixed(3)}, ${acrossBoth.y.toFixed(3)}`);
  check("combining with nothing hands back what there was",
    material.combineNormals(null, tilted) === tilted
      && material.combineNormals(tilted, null) === tilted);

  const open = material.occlusionMap(makeFlatCanvas(16, 16, 128), 1);
  const shut = material.occlusionMap(makeFlatCanvas(16, 16, 0), 1);
  const halfShut = material.occlusionMap(makeFlatCanvas(16, 16, 64), 1);
  check("occlusion combined with an open channel is unchanged",
    pixelAt(material.combineOcclusion(halfShut, open), 8, 8)[0] === pixelAt(halfShut, 8, 8)[0]);
  check("two half-occluded channels are darker than either",
    pixelAt(material.combineOcclusion(halfShut, halfShut), 8, 8)[0]
      < pixelAt(halfShut, 8, 8)[0] - 20,
    String(pixelAt(material.combineOcclusion(halfShut, halfShut), 8, 8)[0]));
  check("a fully occluded channel wins",
    pixelAt(material.combineOcclusion(open, shut), 8, 8)[0] === 0);

  // --- the mesh ---
  const box3 = geometry => {
    geometry.computeBoundingBox();
    const b = geometry.boundingBox;
    return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
  };

  const plane = material.geometryFor("plane", 200, 100);
  const planeSize = box3(plane);
  check("the plane is the texture's aspect ratio exactly",
    Math.abs(planeSize.x - 1) < 1e-6 && Math.abs(planeSize.y - 0.5) < 1e-6,
    `${planeSize.x}x${planeSize.y}`);
  check("the plane is a single quad", plane.getAttribute("position").count === 4,
    String(plane.getAttribute("position").count));

  const cylinder = material.geometryFor("cylinder", 200, 100);
  const cylinderSize = box3(cylinder);
  const expectedHeight = Math.PI * (100 / 200);
  check("the cylinder wraps the texture undistorted",
    Math.abs(cylinderSize.y - expectedHeight) < 1e-6,
    `${cylinderSize.y.toFixed(4)} vs ${expectedHeight.toFixed(4)}`);
  check("the cylinder is a unit diameter",
    Math.abs(cylinderSize.x - 1) < 1e-6, cylinderSize.x.toFixed(4));

  const boxSize = box3(material.geometryFor("box", 200, 100));
  check("the box front face fits the texture and its depth is proportional",
    Math.abs(boxSize.x - 1) < 1e-6 && Math.abs(boxSize.y - 0.5) < 1e-6
      && Math.abs(boxSize.z - 0.5) < 1e-6,
    `${boxSize.x}x${boxSize.y}x${boxSize.z}`);

  const sphereSize = box3(material.geometryFor("sphere", 200, 100));
  check("the sphere is a unit diameter regardless of the texture",
    Math.abs(sphereSize.x - 1) < 1e-3 && Math.abs(sphereSize.y - 1) < 1e-3,
    `${sphereSize.x.toFixed(3)}x${sphereSize.y.toFixed(3)}`);

  check("an unknown shape falls back to the fitted plane",
    Math.abs(box3(material.geometryFor("torus", 200, 100)).y - 0.5) < 1e-6);

  for (const shape of material.SHAPES) {
    const withUvs = material.withAoUvs(material.geometryFor(shape, 128, 64));
    const uv = withUvs.getAttribute("uv");
    const uv1 = withUvs.getAttribute("uv1");
    check(`the ${shape} carries a second UV set for occlusion`,
      !!uv1 && uv1.count === uv.count, uv1 ? String(uv1.count) : "missing");
  }

  // --- relief from depth ---
  const depth = TX.depth;

  const makeDepth = (width, height, fn) => {
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) data[y * width + x] = fn(x, y);
    }
    return { data, width, height };
  };

  const photo = { width: 400, height: 300 };
  const straightQuad = q([[80, 60], [320, 60], [320, 240], [80, 240]]);
  const angledQuad = q([[60, 40], [340, 110], [340, 190], [60, 260]]);

  const affineDepth = makeDepth(400, 300, (x, y) => 4 + 0.01 * x + 0.004 * y);
  const fieldOf = (map, quad, extra) => depth.heightField({
    depth: map, photo, quad, cols: 33, rows: 33, ...extra,
  });

  const flatStraight = fieldOf(affineDepth, straightQuad);
  check("an affine depth map over a square-on quad is no relief at all",
    flatStraight && flatStraight.flatness < 1e-4, flatStraight
      ? flatStraight.flatness.toExponential(2) : "null");

  const flatAngled = fieldOf(affineDepth, angledQuad);
  check("and is still no relief when the quad is foreshortened",
    flatAngled && flatAngled.flatness < 1e-4, flatAngled
      ? flatAngled.flatness.toExponential(2) : "null");

  const bulgeDepth = makeDepth(400, 300, (x, y) => {
    const dx = (x - 200) / 120;
    const dy = (y - 150) / 90;
    return 4 + 0.01 * x + Math.max(0, 1 - dx * dx - dy * dy);
  });
  const bulge = fieldOf(bulgeDepth, straightQuad);
  const middleOf = f => depth.at(f, 0.5, 0.5);
  check("a bulge is measured as relief", bulge && bulge.flatness > 0.05,
    bulge ? bulge.flatness.toFixed(4) : "null");
  check("the middle of a bulge stands proud of the plane", middleOf(bulge) > 0.05,
    middleOf(bulge).toFixed(4));
  check("the corners of a bulge sit at or below the plane",
    depth.at(bulge, 0, 0) < middleOf(bulge) && depth.at(bulge, 1, 1) < middleOf(bulge),
    `${depth.at(bulge, 0, 0).toFixed(3)} / ${depth.at(bulge, 1, 1).toFixed(3)}`);

  const bentField = fieldOf(bulgeDepth, straightQuad, {
    curve: [{ x: 0, y: 0.25 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
  });
  check("a bent edge samples relief somewhere else",
    bentField && Math.abs(depth.at(bentField, 0.5, 0) - depth.at(bulge, 0.5, 0)) > 1e-3,
    `${depth.at(bentField, 0.5, 0).toFixed(4)} vs ${depth.at(bulge, 0.5, 0).toFixed(4)}`);

  const outside = fieldOf(bulgeDepth, straightQuad, { domain: { u0: -1.5, v0: 0, u1: 1, v1: 1 } });
  check("a mark reaching off the photograph reports partial coverage",
    outside && outside.coverage > 0.2 && outside.coverage < 0.9,
    outside ? outside.coverage.toFixed(3) : "null");
  check("and carries no relief where there was no photograph",
    outside && depth.at(outside, 0, 0.5) === 0, outside
      ? String(depth.at(outside, 0, 0.5)) : "null");

  check("a depth map of one flat value cannot say anything",
    fieldOf(makeDepth(400, 300, () => 3), straightQuad) === null);
  check("no depth map means no field", fieldOf(null, straightQuad) === null);
  check("a quad that is not a quad means no field",
    depth.heightField({ depth: affineDepth, photo, quad: straightQuad.slice(0, 3) }) === null);

  // --- the mesh that relief builds ---
  const reliefOf = (amount, segments) => ({ field: bulge, amount, segments: segments || 64 });

  check("zero relief is still the single quad the plane always was",
    material.geometryFor("plane", 200, 100, reliefOf(0)).getAttribute("position").count === 4);
  check("relief with no field is still a single quad",
    material.geometryFor("plane", 200, 100, { amount: 1 }).getAttribute("position").count === 4);

  const bowed = material.geometryFor("plane", 200, 100, reliefOf(1, 32));
  check("relief subdivides the plane", bowed.getAttribute("position").count === 33 * 33,
    String(bowed.getAttribute("position").count));

  const bowedSize = box3(bowed);
  check("a bowed plane keeps the texture's aspect ratio",
    Math.abs(bowedSize.x - 1) < 1e-6 && Math.abs(bowedSize.y - 0.5) < 1e-6,
    `${bowedSize.x}x${bowedSize.y}`);

  const displacement = geometry => {
    const position = geometry.getAttribute("position");
    const out = [];
    for (let i = 0; i < position.count; i++) out.push(Math.abs(position.getZ(i)));
    return TX.views.summarise(out).p95;
  };

  const bowedPeak = displacement(bowed);
  check("a full bow displaces the bulk of the surface by a quarter of a unit",
    Math.abs(bowedPeak - material.BOW_PEAK) < 0.05, bowedPeak.toFixed(3));

  const gentlePeak = displacement(material.geometryFor("plane", 200, 100, reliefOf(0.25, 32)));
  check("a quarter bow displaces a quarter as far",
    Math.abs(gentlePeak - bowedPeak * 0.25) < 0.01,
    `${gentlePeak.toFixed(3)} vs ${bowedPeak.toFixed(3)}`);

  const deepScene = makeDepth(400, 300, (x, y) => {
    const dx = (x - 200) / 120;
    const dy = (y - 150) / 90;
    return 40 + 0.1 * x + 10 * Math.max(0, 1 - dx * dx - dy * dy);
  });
  const deepPeak = displacement(material.geometryFor(
    "plane", 200, 100, { field: fieldOf(deepScene, straightQuad), amount: 1, segments: 32 }));
  check("a deeper scene does not bow the surface harder",
    Math.abs(deepPeak - bowedPeak) < 0.05, `${deepPeak.toFixed(3)} vs ${bowedPeak.toFixed(3)}`);

  const bowedNormals = bowed.getAttribute("normal");
  let bowedTilts = 0;
  for (let i = 0; i < bowedNormals.count; i++) {
    if (Math.abs(bowedNormals.getZ(i) - 1) > 1e-3) bowedTilts++;
  }
  check("a bowed plane carries real geometric normals", bowedTilts > bowedNormals.count * 0.5,
    `${bowedTilts}/${bowedNormals.count}`);

  for (const shape of ["box", "cylinder", "sphere"]) {
    const before = material.geometryFor(shape, 200, 100).getAttribute("position").count;
    const after = material.geometryFor(shape, 200, 100, reliefOf(1)).getAttribute("position").count;
    check(`relief leaves the ${shape} alone`, before === after, `${before} vs ${after}`);
  }

  // --- the turn the slice has been given on the sheet ---
  const spans = geometry => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    return { x: box.max.x - box.min.x, y: box.max.y - box.min.y };
  };
  const upright = spans(material.geometryFor("plane", 200, 100));
  check("an unturned plane is as wide as the texture is",
    Math.abs(upright.x - 1) < 1e-6 && Math.abs(upright.y - 0.5) < 1e-6,
    `${upright.x.toFixed(3)} x ${upright.y.toFixed(3)}`);

  const quarter = spans(material.geometryFor("plane", 200, 100, null, Math.PI / 2));
  check("a quarter turn swaps which way the plane is long",
    Math.abs(quarter.x - upright.y) < 1e-6 && Math.abs(quarter.y - upright.x) < 1e-6,
    `${quarter.x.toFixed(3)} x ${quarter.y.toFixed(3)}`);

  const corner = material.geometryFor("plane", 200, 100, null, Math.PI / 2)
    .getAttribute("position");
  check("and it turns the way the atlas turns it, not the other way",
    corner.getX(0) > 0.2 && corner.getY(0) > 0.4,
    `${corner.getX(0).toFixed(3)}, ${corner.getY(0).toFixed(3)}`);

  for (const shape of ["box", "cylinder", "sphere"]) {
    const before = spans(material.geometryFor(shape, 200, 100));
    const after = spans(material.geometryFor(shape, 200, 100, null, Math.PI / 2));
    check(`a turn leaves the ${shape} alone, having no way up to turn from`,
      Math.abs(before.x - after.x) < 1e-6 && Math.abs(before.y - after.y) < 1e-6,
      `${before.x.toFixed(3)} vs ${after.x.toFixed(3)}`);
  }

  check("the bow clamps to a believable amount",
    material.settingsOf({ bow: 9 }).bow === 1 && material.settingsOf({ bow: -1 }).bow === 0);

  check("depth is off until it is asked for, with the amounts already worth using",
    material.defaults().useDepth === false
      && material.defaults().bow > 0 && material.defaults().depthNormal > 0);
  check("and the switch is reported rather than folded into the amounts",
    material.settingsOf({ useDepth: false, bow: 0.8 }).bow === 0.8);

  // --- the same relief, as a height map instead of a mesh ---
  const bowHeight = material.depthHeightField(bulge, 64, 64, 1);
  check("relief becomes a height field at the size asked for",
    bowHeight && bowHeight.width === 64 && bowHeight.height === 64,
    bowHeight ? `${bowHeight.width}x${bowHeight.height}` : "null");
  const heightAt = (field, x, y) => field.data[y * field.width + x];
  check("the middle of a bulge is raised above the neutral",
    heightAt(bowHeight, 32, 32) > 0.55, heightAt(bowHeight, 32, 32).toFixed(4));
  check("and its corners sit below the middle",
    heightAt(bowHeight, 1, 1) < heightAt(bowHeight, 32, 32),
    `${heightAt(bowHeight, 1, 1).toFixed(4)} vs ${heightAt(bowHeight, 32, 32).toFixed(4)}`);
  check("it stays in full precision rather than being rounded to an image",
    bowHeight.data instanceof Float32Array
    && bowHeight.data.some(v => Math.abs(v * 255 - Math.round(v * 255)) > 1e-3));

  const gentleHeight = material.depthHeightField(bulge, 64, 64, 0.25);
  check("a weaker strength stays closer to flat",
    Math.abs(heightAt(gentleHeight, 32, 32) - 0.5)
      < Math.abs(heightAt(bowHeight, 32, 32) - 0.5),
    `${heightAt(gentleHeight, 32, 32).toFixed(4)} vs ${heightAt(bowHeight, 32, 32).toFixed(4)}`);

  check("no strength means no height field",
    material.depthHeightField(bulge, 64, 64, 0) === null);
  check("and no field means none either",
    material.depthHeightField(null, 64, 64, 1) === null);

  const depthNormal = material.normalMap(bowHeight, 1);
  const leftLean = decode(depthNormal, 12, 32);
  const rightLean = decode(depthNormal, 52, 32);
  check("a dome's normals lean outward, away from its peak",
    leftLean.x < -0.02 && rightLean.x > 0.02,
    `${leftLean.x.toFixed(3)} / ${rightLean.x.toFixed(3)}`);
  check("and stay unit length", Math.abs(Math.hypot(
    leftLean.x, leftLean.y, leftLean.z) - 1) < 0.01,
    Math.hypot(leftLean.x, leftLean.y, leftLean.z).toFixed(4));

  // ---- the banding this used to have ----------------------------------------
  const rampField = (() => {
    const width = 256;
    const rows = 8;
    const data = new Float32Array(width * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < width; x++) data[y * width + x] = 0.5 + (x / (width - 1)) / 60;
    }
    return { data, width, height: rows };
  })();

  const rampNormal = material.normalMap(rampField, 1);
  const rampLeans = [];
  for (let x = 4; x < 252; x++) rampLeans.push(decode(rampNormal, x, 4).x);
  const leanSpread = Math.max(...rampLeans) - Math.min(...rampLeans);
  check("a gentle slope leans consistently rather than in steps", leanSpread < 0.02,
    `spread ${leanSpread.toFixed(4)} across the ramp`);
  check("and it leans the way the slope actually rises",
    rampLeans.every(v => v < -0.001), rampLeans[100].toFixed(4));

  const quantised = TX.pbr.write(rampField.data, rampField.width, rampField.height);
  const quantisedNormal = material.normalMap(quantised, 1);
  const quantisedLeans = [];
  for (let x = 4; x < 252; x++) quantisedLeans.push(decode(quantisedNormal, x, 4).x);
  const quantisedSpread = Math.max(...quantisedLeans) - Math.min(...quantisedLeans);
  check("rounding the same slope to an image is what produced the banding",
    quantisedSpread > leanSpread * 4,
    `${quantisedSpread.toFixed(4)} quantised vs ${leanSpread.toFixed(4)} in floats`);

  // ---- previewing at a working resolution ------------------------------------
  {
    const big = document.createElement("canvas");
    big.width = 2400;
    big.height = 1600;
    const ctx = big.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 2400, 1600);
    grad.addColorStop(0, "#303030");
    grad.addColorStop(1, "#d0d0d0");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2400, 1600);

    const settings = material.settingsOf({ normal: 1, detailNormal: 0.8 });
    const preview = material.maps("size-check", big, big, { mode: "gradient" }, settings, 1);
    check("a preview derives its maps smaller than the texture",
      !!(preview && preview.normal) && Math.max(preview.normal.width, preview.normal.height) <= 1024,
      preview && preview.normal && `${preview.normal.width}x${preview.normal.height}`);
    check("but the colour it hands back is the full-size one",
      !!preview && preview.albedo === big);

    const full = material.maps("size-check", big, big, { mode: "gradient" }, settings, 1,
      { maxSide: 0 });
    check("an export derives them at full size",
      !!(full && full.normal) && full.normal.width === 2400 && full.normal.height === 1600,
      full && full.normal && `${full.normal.width}x${full.normal.height}`);
    check("the two do not share a cache entry",
      !!preview && !!full && preview.normal !== full.normal
      && preview.normal.width !== full.normal.width);

    const again = material.maps("size-check", big, big, { mode: "gradient" }, settings, 1);
    check("and asking twice for the same one is cached",
      !!again && again.normal === preview.normal);

    const small = document.createElement("canvas");
    small.width = 300;
    small.height = 200;
    small.getContext("2d").drawImage(big, 0, 0, 300, 200);
    const untouched = material.maps("small-check", small, small, { mode: "gradient" },
      settings, 1);
    check("a texture already below the working size is derived as it is",
      !!(untouched && untouched.normal)
      && untouched.normal.width === 300 && untouched.normal.height === 200,
      untouched && untouched.normal && `${untouched.normal.width}x${untouched.normal.height}`);
    material.invalidate();
  }

  // ---- grain, and the rainbow it used to come out as --------------------------
  {
    const printed = document.createElement("canvas");
    printed.width = 256;
    printed.height = 256;
    const ctx = printed.getContext("2d");
    ctx.fillStyle = "#efe6d0";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#1a1712";
    for (let y = 16; y < 240; y += 24) ctx.fillRect(24, y, 208, 9);

    TX.pbr.invalidate("grain-check");
    const parts = TX.pbr.decompose("grain-check", printed, "grain");
    const field = TX.pbr.heightField(parts, 1);

    const leans = canvas => {
      const { data } = canvas.getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      let saturated = 0;
      let facing = 0;
      const n = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        const nx = (data[i] / 255) * 2 - 1;
        const ny = (data[i + 1] / 255) * 2 - 1;
        const nz = (data[i + 2] / 255) * 2 - 1;
        const lean = Math.hypot(nx, ny);
        sum += lean;
        if (lean > 0.95) saturated++;
        if (nz > 0.5) facing++;
      }
      return { mean: sum / n, saturated: saturated / n, facing: facing / n };
    };

    const grain = leans(material.normalMap(field, 1, { grain: true }));
    check("grain: a printed surface does not come out as a rainbow",
      grain.saturated < 0.02 && grain.mean < 0.5,
      `mean lean ${grain.mean.toFixed(3)}, ${(grain.saturated * 100).toFixed(1)}% over`);
    check("grain: most of it still faces out of the surface", grain.facing > 0.9,
      `${(grain.facing * 100).toFixed(0)}% facing out`);
    check("grain: and the ink is still visible as relief rather than flattened away",
      grain.mean > 0.01, `mean lean ${grain.mean.toFixed(3)}`);

    const asSmooth = leans(material.normalMap(field, 1));
    check("grain: scaled as though it were a bow across the wall, it saturates",
      asSmooth.saturated > 0.2 && asSmooth.saturated > grain.saturated * 20,
      `${(asSmooth.saturated * 100).toFixed(0)}% over, against `
      + `${(grain.saturated * 100).toFixed(1)}%`);

    const half = leans(material.normalMap(TX.pbr.heightField(parts, 0.4), 1, { grain: true }));
    check("grain: less strength is less relief", half.mean < grain.mean * 0.75,
      `${half.mean.toFixed(3)} at 0.4 vs ${grain.mean.toFixed(3)} at 1`);
    TX.pbr.invalidate("grain-check");
  }

  check("the depth normal strength clamps",
    material.settingsOf({ depthNormal: 5 }).depthNormal === 1
      && material.settingsOf({ depthNormal: -1 }).depthNormal === 0);
  check("an unknown subdivision falls back to the default",
    material.settingsOf({ subdivision: 7 }).subdivision === material.defaults().subdivision,
    String(material.settingsOf({ subdivision: 7 }).subdivision));

  // --- the depth scene, unprojected ---
  const depthScene = TX.depthScene;

  const planarity = geometry => {
    const p = geometry.getAttribute("position");
    const { cols, rows } = geometry.userData;
    const at = i => new THREE.Vector3().fromBufferAttribute(p, i);
    const origin = at(0);
    const edgeU = new THREE.Vector3().subVectors(at(cols - 1), origin);
    const edgeV = new THREE.Vector3().subVectors(at((rows - 1) * cols), origin);
    const normal = new THREE.Vector3().crossVectors(edgeU, edgeV);
    if (normal.length() < 1e-12) return Infinity;
    normal.normalize();
    let worst = 0;
    for (let i = 0; i < p.count; i++) {
      const away = Math.abs(new THREE.Vector3().subVectors(at(i), origin).dot(normal));
      if (away > worst) worst = away;
    }
    return worst;
  };

  const affineMap = makeDepth(160, 120, (x, y) => 0.2 + 0.5 * (x / 159) + 0.3 * (y / 119));

  for (const shift of [0.05, 0.2, 1]) {
    for (const fov of [30, 60, 110]) {
      const built = depthScene.build(affineMap, { shift, fov, detail: 64 });
      check(`an affine depth map unprojects flat at shift ${shift}, ${fov}°`,
        built && planarity(built) < 1e-5, built ? planarity(built).toExponential(2) : "null");
    }
  }

  const domeMap = makeDepth(160, 120, (x, y) => {
    const dx = (x - 80) / 60;
    const dy = (y - 60) / 45;
    return 1 + Math.max(0, 1 - dx * dx - dy * dy);
  });
  const dome = depthScene.build(domeMap, { detail: 64 });
  check("a curved depth map does not", dome && planarity(dome) > 0.05,
    dome ? planarity(dome).toFixed(4) : "null");

  const wideRange = depthScene.build(affineMap, { shift: 0.02, detail: 64 });
  const narrowRange = depthScene.build(affineMap, { shift: 1, detail: 64 });
  const spreadOf = geometry => {
    const p = geometry.getAttribute("position");
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < p.count; i++) {
      cx += p.getX(i);
      cy += p.getY(i);
      cz += p.getZ(i);
    }
    cx /= p.count;
    cy /= p.count;
    cz /= p.count;
    let worst = 0;
    for (let i = 0; i < p.count; i++) {
      const away = Math.hypot(p.getX(i) - cx, p.getY(i) - cy, p.getZ(i) - cz);
      if (away > worst) worst = away;
    }
    return worst;
  };
  check("a scene is scaled to a unit spread about its centre whatever the shift",
    Math.abs(spreadOf(wideRange) - 1) < 1e-4 && Math.abs(spreadOf(narrowRange) - 1) < 1e-4,
    `${spreadOf(wideRange).toFixed(5)} / ${spreadOf(narrowRange).toFixed(5)}`);

  const stepMap = makeDepth(160, 120, x => (x < 80 ? 1 : 8));
  const stepped = depthScene.build(stepMap, { detail: 64 });
  const smooth = depthScene.build(affineMap, { detail: 64 });
  check("a depth cliff drops the triangles that would bridge it",
    stepped && smooth && stepped.userData.triangles < smooth.userData.triangles,
    `${stepped && stepped.userData.triangles} vs ${smooth && smooth.userData.triangles}`);
  check("but the surfaces either side of it survive",
    stepped && stepped.userData.triangles > smooth.userData.triangles * 0.8,
    stepped ? String(stepped.userData.triangles) : "null");

  check("the grid follows the photograph's aspect ratio",
    smooth.userData.cols === 64 && smooth.userData.rows === 48,
    `${smooth.userData.cols}x${smooth.userData.rows}`);
  check("UVs address the photograph with its first row at the top",
    Math.abs(smooth.getAttribute("uv").getY(0) - 1) < 1e-6,
    String(smooth.getAttribute("uv").getY(0)));

  // --- and where the photograph was taken from ---
  const taken = smooth.userData;
  check("the scene says where the camera that took it was",
    !!taken.viewpoint && !!taken.fov && taken.fov.horizontal === 60,
    JSON.stringify(taken.viewpoint));

  check("and from there the mesh reprojects to the photograph it came from", (() => {
    const position = smooth.getAttribute("position");
    const uv = smooth.getAttribute("uv");
    const eye = new THREE.Vector3(taken.viewpoint.x, taken.viewpoint.y, taken.viewpoint.z);
    const halfX = Math.tan((taken.fov.horizontal * Math.PI) / 360);
    const halfY = Math.tan((taken.fov.vertical * Math.PI) / 360);
    let worst = 0;
    for (let i = 0; i < position.count; i += 7) {
      const ray = new THREE.Vector3().fromBufferAttribute(position, i).sub(eye);
      if (!(-ray.z > 1e-9)) return false;
      const u = (ray.x / (-ray.z * halfX)) * 0.5 + 0.5;
      const v = 0.5 - (ray.y / (-ray.z * halfY)) * 0.5;
      worst = Math.max(worst, Math.abs(u - uv.getX(i)), Math.abs(v - (1 - uv.getY(i))));
    }
    return worst < 1e-5;
  })());

  check("a depth map with no range at all builds nothing",
    depthScene.build(makeDepth(64, 64, () => 2), {}) === null);
  check("and neither does no map", depthScene.build(null, {}) === null);

  const skyMap = makeDepth(160, 120, (x, y) => (y < 8 ? 0 : 8 + 0.01 * x + 0.004 * y));
  const untrimmed = depthScene.rangeOf(skyMap, 0);
  const trimmed = depthScene.rangeOf(skyMap, 0.1);
  check("trimming pulls the far end of the range in past the sky",
    trimmed.min > untrimmed.min + (untrimmed.max - untrimmed.min) * 0.5,
    `${untrimmed.min.toFixed(2)}..${untrimmed.max.toFixed(2)} -> `
      + `${trimmed.min.toFixed(2)}..${trimmed.max.toFixed(2)}`);
  check("and with no trim the full extent is kept",
    untrimmed.min === 0 && untrimmed.max > 10 && untrimmed.max < 10.2,
    `${untrimmed.min} / ${untrimmed.max.toFixed(2)}`);

  const noisy = makeDepth(160, 120, (x, y) =>
    4 + 0.01 * x + ((x * 7 + y * 13) % 5) * 0.08);
  const raw = depthScene.build(noisy, { detail: 64, smooth: 0 });
  const eased = depthScene.build(noisy, { detail: 64, smooth: 0.03 });
  check("smoothing flattens noise that would otherwise become surface",
    planarity(eased) < planarity(raw) * 0.5,
    `${planarity(raw).toFixed(4)} -> ${planarity(eased).toFixed(4)}`);

  const welded = depthScene.build(stepMap, { detail: 64, edge: 1 });
  check("a high edge cutoff welds across the cliff",
    welded.userData.triangles > stepped.userData.triangles,
    `${welded.userData.triangles} vs ${stepped.userData.triangles}`);
  const shredded = depthScene.build(affineMap, { detail: 64, edge: 0.005 });
  check("and a low one cuts even a gentle slope apart",
    shredded.userData.triangles < smooth.userData.triangles * 0.5,
    `${shredded.userData.triangles} vs ${smooth.userData.triangles}`);

  check("every display mode is offered and the photo is the default",
    depthScene.DISPLAYS.includes("photo") && depthScene.DISPLAYS.includes("normals")
      && depthScene.DISPLAYS.includes("wireframe")
      && depthScene.defaults().display === "photo",
    depthScene.DISPLAYS.join(","));
  check("an unknown display mode falls back rather than sticking",
    depthScene.settingsOf({ display: "hologram" }).display === "photo");
  check("the geometry key ignores the display mode",
    depthScene.keyOf({ display: "photo" }) === depthScene.keyOf({ display: "wireframe" }),
    depthScene.keyOf({ display: "wireframe" }));
  check("but it notices the trim, the smoothing and the edge cutoff",
    depthScene.keyOf({ trim: 0 }) !== depthScene.keyOf({ trim: 0.1 })
      && depthScene.keyOf({ smooth: 0 }) !== depthScene.keyOf({ smooth: 0.02 })
      && depthScene.keyOf({ edge: 0.06 }) !== depthScene.keyOf({ edge: 0.2 }));

  check("the scene settings clamp the field of view and the shift",
    depthScene.settingsOf({ fov: 500 }).fov === 120
      && depthScene.settingsOf({ shift: 0 }).shift === 0.02,
    `${depthScene.settingsOf({ fov: 500 }).fov}/${depthScene.settingsOf({ shift: 0 }).shift}`);
  check("depth is off until it is asked for", depthScene.defaults().enabled === false);

  // --- fitting a quad to a mask ---
  const quadFit = TX.quadFit;

  const makeMask = (width, height, fn) => {
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) data[y * width + x] = fn(x, y) ? 1 : 0;
    }
    return { data, width, height };
  };

  const inPoly = (ring, x, y) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a.y > y) !== (b.y > y)
        && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };

  const cornersNear = (got, want, tol) => got.every((p, i) =>
    Math.abs(p.x - want[i].x) <= tol && Math.abs(p.y - want[i].y) <= tol);

  const axisCorners = q([[40, 30], [200, 30], [200, 150], [40, 150]]);
  const axisFit = quadFit.quadFor(makeMask(256, 192, (x, y) => inPoly(axisCorners, x, y)));
  check("an axis-aligned rectangle comes back as its own corners",
    axisFit && cornersNear(axisFit.quad, axisCorners, 3),
    axisFit ? axisFit.quad.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ") : "null");
  check("and agrees with the mask it came from almost exactly",
    axisFit && axisFit.iou > 0.98, axisFit ? axisFit.iou.toFixed(3) : "null");

  const skewCorners = q([[30, 50], [210, 20], [225, 160], [45, 140]]);
  const skewFit = quadFit.quadFor(makeMask(256, 192, (x, y) => inPoly(skewCorners, x, y)));
  check("a foreshortened quad keeps its own corners rather than a bounding box",
    skewFit && cornersNear(skewFit.quad, skewCorners, 4),
    skewFit ? skewFit.quad.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ") : "null");
  check("and agrees with that mask too",
    skewFit && skewFit.iou > 0.98, skewFit ? skewFit.iou.toFixed(3) : "null");

  const disc = quadFit.quadFor(makeMask(256, 192, (x, y) =>
    Math.hypot(x - 128, y - 96) < 70));
  check("a disc agrees poorly, so a caller can decline",
    disc && disc.iou < quadFit.MIN_IOU, disc ? disc.iou.toFixed(3) : "null");
  check("a rectangle clears the same threshold comfortably",
    axisFit.iou > quadFit.MIN_IOU, axisFit.iou.toFixed(3));

  const bitten = quadFit.quadFor(makeMask(256, 192, (x, y) =>
    inPoly(axisCorners, x, y) && !(x > 150 && y > 110)));
  check("a bitten corner does not send the fit outside the photograph",
    bitten && bitten.quad.every(p => p.x >= -8 && p.x <= 264 && p.y >= -8 && p.y <= 200),
    bitten ? bitten.quad.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ") : "null");
  check("and it reports less agreement than the unoccluded wall did",
    bitten && bitten.iou < axisFit.iou,
    bitten ? `${bitten.iou.toFixed(3)} vs ${axisFit.iou.toFixed(3)}` : "null");

  const twoWalls = makeMask(256, 192, (x, y) =>
    (x > 20 && x < 90 && y > 40 && y < 150) || (x > 160 && x < 230 && y > 40 && y < 150));
  const leftWall = quadFit.quadFor(twoWalls, { x: 55, y: 95 });
  check("a seed picks the blob it landed in",
    leftWall && leftWall.quad.every(p => p.x < 120),
    leftWall ? leftWall.quad.map(p => Math.round(p.x)).join(",") : "null");
  const bothWalls = quadFit.quadFor(twoWalls, null);
  check("and with no seed the hull spans everything set",
    bothWalls && bothWalls.quad.some(p => p.x > 200),
    bothWalls ? bothWalls.quad.map(p => Math.round(p.x)).join(",") : "null");
  check("which is exactly what makes the seed worth passing",
    bothWalls.iou < leftWall.iou, `${bothWalls.iou.toFixed(3)} vs ${leftWall.iou.toFixed(3)}`);

  const bigCorners = q([[200, 150], [1400, 150], [1400, 900], [200, 900]]);
  const bigFit = quadFit.quadFor(makeMask(1600, 1200, (x, y) => inPoly(bigCorners, x, y)));
  check("a mask past the trace resolution still answers in photograph pixels",
    bigFit && cornersNear(bigFit.quad, bigCorners, 12),
    bigFit ? bigFit.quad.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ") : "null");

  check("an empty mask fits nothing",
    quadFit.quadFor(makeMask(64, 64, () => false)) === null);
  check("and neither does no mask at all", quadFit.quadFor(null) === null);

  const ring = quadFit.hullOf([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 },
  ]);
  check("the hull drops a point inside it", ring.length === 4, String(ring.length));
  check("reducing an already-square ring leaves it alone",
    quadFit.reduceToQuad(ring).length === 4);
  const octagon = [
    { x: 4, y: 0 }, { x: 8, y: 0 }, { x: 12, y: 4 }, { x: 12, y: 8 },
    { x: 8, y: 12 }, { x: 4, y: 12 }, { x: 0, y: 8 }, { x: 0, y: 4 },
  ];
  check("reducing an octagon gives four corners",
    quadFit.reduceToQuad(octagon).length === 4);
  const reducedOctagon = quadFit.reduceToQuad(octagon);
  check("refitting the sides recovers area the reduction gave away",
    quadFit.areaOf(quadFit.refine(reducedOctagon, octagon))
      > quadFit.areaOf(reducedOctagon),
    `${Math.round(quadFit.areaOf(quadFit.refine(reducedOctagon, octagon)))} vs `
      + `${Math.round(quadFit.areaOf(reducedOctagon))}`);
  check("a line fits through points that are all vertical",
    (() => {
      const line = quadFit.fitLine([{ x: 5, y: 0 }, { x: 5, y: 10 }, { x: 5, y: 20 }]);
      return line && Math.abs(Math.abs(line.a) - 1) < 1e-6 && Math.abs(line.b) < 1e-6;
    })());

  // --- the studio rig, shared between the preview and the exported file ---
  const rig = material.studioRig();
  check("the studio rig is three lights", rig.length === 3, String(rig.length));
  check("every light in the rig is named and positioned",
    rig.every(l => l.name && l.isDirectionalLight && l.position.length() > 0),
    rig.map(l => l.name).join(","));
  check("the rig has a bright key and a dimmer fill",
    rig[0].intensity > rig[1].intensity, `${rig[0].intensity} vs ${rig[1].intensity}`);
  check("two rigs are independent objects", material.studioRig()[0] !== rig[0]);

  // --- reading a container back ---
  const gltf = TX.gltf;
  check("a GLB reader rejects an empty buffer", gltf.readGlb(new ArrayBuffer(0)) === null);
  check("a GLB reader rejects a non-buffer", gltf.readGlb("glTF") === null);
  const bogus = new ArrayBuffer(64);
  new DataView(bogus).setUint32(0, 0x12345678, true);
  check("a GLB reader rejects a bad magic number", gltf.readGlb(bogus) === null);
}

function runDockChecks() {
  const dock = TX.dockTree;
  const sorted = root => dock.collectPanels(root).slice().sort().join(",");

  let root = dock.split("row", [
    dock.tabs(["mark"]),
    dock.split("col", [dock.tabs(["atlas"]), dock.tabs(["tiling"])]),
  ]);
  check("layout starts with three panels", sorted(root) === "atlas,mark,tiling", sorted(root));

  const markNode = dock.findPanel(root, "mark");
  const widened = dock.insertPanel(root, "props", markNode.id, "right");
  check("a matching-direction split is flattened",
    widened.type === "split" && widened.dir === "row" && widened.children.length === 3,
    `${widened.dir} children=${widened.children.length}`);
  check("sizes stay aligned with children after insert",
    widened.sizes.length === widened.children.length
    && Math.abs(widened.sizes.reduce((a, b) => a + b, 0) - 1) < 1e-9,
    widened.sizes.map(s => s.toFixed(3)).join("/"));

  const tabbed = dock.insertPanel(root, "props", markNode.id, "center");
  check("center drop makes a tab group",
    dock.findPanel(tabbed, "props").panels.join(",") === "mark,props",
    dock.findPanel(tabbed, "props").panels.join(","));
  check("center drop activates the dropped panel", dock.findPanel(tabbed, "props").active === "props");

  const pruned = dock.removePanel(root, "tiling");
  check("removal prunes the emptied group and collapses the split",
    pruned.type === "split" && pruned.dir === "row" && pruned.children.length === 2
    && pruned.children[1].type === "tabs",
    `${pruned.dir} children=${pruned.children.map(c => c.type).join("/")}`);
  check("removal keeps the other panels", sorted(pruned) === "atlas,mark", sorted(pruned));

  check("removing the last panel yields nothing",
    dock.removePanel(dock.tabs(["only"]), "only") === null);

  const moved = dock.movePanel(root, "mark", dock.findPanel(root, "atlas").id, "center");
  check("move does not duplicate the panel",
    dock.collectPanels(moved).filter(p => p === "mark").length === 1,
    dock.collectPanels(moved).join(","));
  check("move keeps every panel", sorted(moved) === "atlas,mark,tiling", sorted(moved));

  const edged = dock.insertAtRootEdge(root, "props", "bottom");
  check("root edge dock wraps the layout",
    edged.type === "split" && edged.dir === "col"
    && edged.children[edged.children.length - 1].panels.join(",") === "props",
    edged.dir);

  const reordered = dock.reorderTab(tabbed, "props", 0);
  check("tabs can be reordered",
    dock.findPanel(reordered, "props").panels.join(",") === "props,mark",
    dock.findPanel(reordered, "props").panels.join(","));

  const stale = {
    id: "n1",
    type: "split",
    dir: "row",
    sizes: [0.5, 0.5],
    children: [
      { id: "n2", type: "tabs", panels: ["mark"], active: "mark" },
      { id: "n3", type: "tabs", panels: ["atlas"], active: "atlas" },
    ],
  };
  const adopted = dock.reid(stale);
  const adoptedIds = [];
  dock.walk(adopted, node => adoptedIds.push(node.id));
  check("reid re-mints every id", new Set(adoptedIds).size === 3, adoptedIds.join(","));
  check("reid keeps the structure", sorted(adopted) === "atlas,mark", sorted(adopted));
  check("reid leaves the saved tree alone", stale.id === "n1");

  const grown = dock.insertPanel(adopted, "tiling", dock.findPanel(adopted, "atlas").id, "bottom");
  const grownIds = [];
  dock.walk(grown, node => grownIds.push(node.id));
  check("a re-minted layout takes new panels without id collisions",
    new Set(grownIds).size === grownIds.length, grownIds.join(","));

  const reconciled = dock.reconcile(root, ["mark", "atlas"]);
  check("reconcile drops unknown panels", sorted(reconciled) === "atlas,mark", sorted(reconciled));
  check("reconcile returns null when nothing is left",
    dock.reconcile(root, ["nope"]) === null);

  check("original tree was not mutated", sorted(root) === "atlas,mark,tiling", sorted(root));
  check("isValid rejects a malformed node", !dock.isValid({ type: "split", children: [] }));
  check("isValid accepts a real tree", dock.isValid(root));

  const rect = { left: 0, top: 0, width: 200, height: 100 };
  check("centre of a panel is a tab drop", dock.zoneAt(rect, { x: 100, y: 50 }).zone === "center");
  check("left margin docks left", dock.zoneAt(rect, { x: 6, y: 50 }).zone === "left");
  check("bottom margin docks bottom", dock.zoneAt(rect, { x: 100, y: 96 }).zone === "bottom");
  const half = dock.zoneAt(rect, { x: 194, y: 50 });
  check("an edge drop previews half the panel",
    half.zone === "right" && half.rect.left === 100 && half.rect.width === 100,
    `${half.zone} ${half.rect.left}+${half.rect.width}`);
}

try {
  run();
} catch (err) {
  failures++;
  lines.push(`FAIL  threw: ${err && err.message}`);
  lines.push(String(err && err.stack).split("\n").slice(0, 4).join("\n"));
}

lines.push("");
lines.push(failures ? `RESULT: ${failures} FAILURE(S)` : "RESULT: ALL PASSED");
document.getElementById("results").textContent = lines.join("\n");
