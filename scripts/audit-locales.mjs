import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../locales/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = name => JSON.parse(readFileSync(join(dir, name), "utf8"));
const en = read("en.json");

const scripts = {
  cyrillic: /[\u0400-\u04FF]/,
  greek: /[\u0370-\u03FF]/,
  arabic: /[\u0600-\u06FF]/,
  thai: /[\u0E00-\u0E7F]/,
  hangul: /[\uAC00-\uD7AF\u1100-\u11FF]/,
  kana: /[\u3040-\u30FF]/,
  han: /[\u4E00-\u9FFF]/,
};
const allowed = {
  ar: ["arabic"], cs: [], de: [], en: [], es: [], "es-419": [], fr: [], id: [], it: [],
  ja: ["kana", "han"], ko: ["hangul", "han"], pl: [], "pt-BR": [], ru: ["cyrillic"],
  th: ["thai"], tr: [], uk: ["cyrillic"], vi: [], "zh-CN": ["han"], "zh-TW": ["han"],
};

const universal = new Set(["greek"]);

const verbatim = key => /\.keys$|hint\.keys\.|context\.hint\.|shortcut\.|\.badge\.k1$|legend\.pm_|ramp\.|points_frac|usage\.(mb|kb|zero_mb)|summary\.size|help\.product|delta\.short|atlas\.title$|export\.atlas$/.test(key)
  || /overlay\.(normal|roughness|occlusion|height|shading)\.(title|short)|overlay\.source\.|props\.material\.(badge|roughness|metalness|occlusion|cavity|generate_pbr|roughness_map|channel)|props\.depth\.badge\.normal|scene_mesh\.display\.(normals|wireframe)|props\.scene_mesh\.title/.test(key);

const onlyPlaceholders = text => !/[a-z]/i.test(text.replace(/\{[a-z_0-9]+\}/gi, ""));

const expectedEmpty = new Set(["props.lens.hint_plural_one", "props.lens.hint_plural_other"]);

const notes = [];
for (const file of readdirSync(dir).filter(f => f.endsWith(".json"))) {
  const code = file.slice(0, -5);
  const t = read(file);
  const problems = [];

  const ok = new Set([...(allowed[code] || []), ...universal]);
  for (const [name, re] of Object.entries(scripts)) {
    if (ok.has(name)) continue;
    const hits = Object.keys(t).filter(k => re.test(t[k]));
    if (hits.length) problems.push(`${name} characters in ${hits.length}: ${hits.slice(0, 5).join(", ")}`);
  }

  const empty = Object.keys(en).filter(k =>
    k in t && t[k] === "" && en[k] !== "" && !expectedEmpty.has(k));
  if (empty.length) problems.push(`empty (${empty.length}): ${empty.slice(0, 5).join(", ")}`);

  if (code !== "en") {
    const same = Object.keys(en).filter(k =>
      t[k] === en[k] && !verbatim(k) && en[k].length > 3 && !onlyPlaceholders(en[k]));
    if (same.length) problems.push(`still English (${same.length}): ${same.slice(0, 8).join(", ")}`);
  }

  if (code === "th") {
    // คะ is a common syllable — only flag it as a sentence-final particle.
    const polite = Object.keys(t).filter(k => /ครับ|ค่ะ|คะ\s*$/.test(t[k]));
    if (polite.length) problems.push(`spoken politeness particles: ${polite.join(", ")}`);
  }

  if (code === "tr") {
    const plural = Object.keys(t).filter(k => /\{count\}\s+\S*lar\b|\{count\}\s+\S*ler\b/.test(t[k]));
    if (plural.length) problems.push(`plural after numeral: ${plural.join(", ")}`);
  }

  notes.push([code, problems]);
}

let clean = true;
for (const [code, problems] of notes) {
  if (!problems.length) continue;
  clean = false;
  console.log(`\n${code}`);
  for (const p of problems) console.log(`  ${p}`);
}
console.log(clean ? "all locales clean" : "\nreview the notes above — some entries are legitimate");
