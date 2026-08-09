
import { TX } from "../tx.js";

const COVERAGE_FLOOR = 0.995;
const WASTE_CEILING = 0.45;

const problem = (severity, key, title, detail, extra) =>
  ({ severity, key, title, detail, textureIds: [], ...extra });

function structural(state) {
  const found = [];
  const textures = state.textures;
  const t = TX.t;

  const occupancy = TX.views.atlasOccupancy(textures);
  for (const overlap of occupancy.overlaps) {
    found.push(problem("error", `overlap:${overlap.ids.join(":")}`,
      t("problems.overlap.title", { a: overlap.a, b: overlap.b }),
      t("problems.overlap.detail"),
      { textureIds: overlap.ids }));
  }

  if (textures.length > 1 && occupancy.efficiency < 1 - WASTE_CEILING) {
    found.push(problem("warning", "waste",
      t("problems.waste.title", {
        percent: Math.round((1 - occupancy.efficiency) * 100),
      }),
      t("problems.waste.detail", {
        width: Math.round(occupancy.width),
        height: Math.round(occupancy.height),
      })));
  }

  const dirty = state.marks.filter(m => m.dirty);
  if (dirty.length) {
    found.push(problem("warning", "dirty",
      t(dirty.length === 1 ? "problems.dirty.title_one" : "problems.dirty.title_other",
        { count: dirty.length }),
      t("problems.dirty.detail"),
      { markIds: dirty.map(m => m.id) }));
  }

  const byName = new Map();
  for (const texture of textures) {
    const name = TX.io.safeFilename(texture.name, "texture");
    byName.set(name, (byName.get(name) || []).concat(texture.id));
  }
  for (const [name, ids] of byName) {
    if (ids.length < 2) continue;
    found.push(problem("warning", `name:${name}`,
      t("problems.names.title", { count: ids.length, name }),
      t("problems.names.detail"),
      { textureIds: ids }));
  }

  const orphans = textures.filter(tex =>
    tex.markId && !state.marks.some(m => m.id === tex.markId));
  if (orphans.length) {
    found.push(problem("warning", "orphan",
      t(orphans.length === 1 ? "problems.orphan.title_one" : "problems.orphan.title_other",
        { count: orphans.length }),
      t("problems.orphan.detail"),
      { textureIds: orphans.map(o => o.id) }));
  }

  return found;
}

const coverageCache = new Map(); // textureId -> { key, empty }

function transparency(state) {
  const leaky = [];
  for (const texture of state.textures) {
    const key = TX.store.textureKey(texture.id);
    if (!key) continue;
    let hit = coverageCache.get(texture.id);
    if (!hit || hit.key !== key) {
      const measured = TX.views.coverage(TX.store.textureCanvas(texture.id));
      hit = { key, empty: measured ? measured.empty + measured.partial : 0 };
      coverageCache.set(texture.id, hit);
    }
    if (1 - hit.empty < COVERAGE_FLOOR) leaky.push({ texture, empty: hit.empty });
  }

  if (!leaky.length) return [];

  const worst = leaky.reduce((a, b) => (b.empty > a.empty ? b : a));
  return [problem("warning", "coverage",
    TX.t(leaky.length === 1 ? "problems.coverage.title_one" : "problems.coverage.title_other",
      { count: leaky.length }),
    TX.t("problems.coverage.detail", {
      name: worst.texture.name,
      percent: Math.round(worst.empty * 100),
    }),
    { textureIds: leaky.map(l => l.texture.id) })];
}

const RANK = { error: 0, warning: 1 };

function inspect(state) {
  const found = structural(state).concat(transparency(state));
  return found.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

const countOf = list => ({
  errors: list.filter(p => p.severity === "error").length,
  warnings: list.filter(p => p.severity === "warning").length,
});

TX.problems = {
  COVERAGE_FLOOR,
  WASTE_CEILING,
  structural,
  transparency,
  inspect,
  countOf,
};

