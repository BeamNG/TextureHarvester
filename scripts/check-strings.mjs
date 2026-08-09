import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const skip = new Set(["selftest.js", "inttest.js", "uitest.js", "i18n-data.js"]);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".js") && !skip.has(name)) files.push(path);
  }
})(root);

const prose = /^(?=.*[a-z]{4})[A-Z0-9][A-Za-z0-9'’(),.:;!?%×°+\-/ ]{6,}$/;
const ignore = /^(?:[A-Z0-9_]+|https?:|image\/|application\/|text\/|[a-z-]+$)/;

let found = 0;
for (const path of files) {
  const src = readFileSync(path, "utf8");
  const hits = [];
  src.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const m of line.matchAll(/>([A-Z][^<>{}]{6,})</g)) {
      if (prose.test(m[1].trim())) hits.push([i + 1, m[1].trim()]);
    }
    for (const m of line.matchAll(/(?:title|label|placeholder|aria-label|text|message|name)\s*[:=]\s*["'`]([^"'`]{7,})["'`]/g)) {
      if (prose.test(m[1]) && !ignore.test(m[1])) hits.push([i + 1, m[1]]);
    }
  });
  if (hits.length) {
    console.log(`\n${relative(root, path).replace(/\\/g, "/")}`);
    for (const [line, text] of hits) console.log(`  ${line}: ${text}`);
    found += hits.length;
  }
}
console.log(found ? `\n${found} candidate string(s)` : "no user-facing English found in src/");
