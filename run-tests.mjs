import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const browser = CANDIDATES.find(p => existsSync(p));
if (!browser) {
  console.error("No Chrome or Edge found. Set CHROME=<path to browser>.");
  process.exit(2);
}

function runPage(name) {
  const profile = mkdtempSync(join(tmpdir(), `tx-test-${name}-`));
  try {
    const url = `file:///${join(root, "dist", "test", `${name}.html`).replace(/\\/g, "/")}`;
    const dom = execFileSync(browser, [
      "--headless=new",
      "--disable-gpu",
      "--enable-unsafe-swiftshader",
      "--allow-file-access-from-files",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // Image encoding and storage probes consume virtual time, not wall clock.
      "--virtual-time-budget=12000000",
      `--user-data-dir=${profile}`,
      "--dump-dom",
      url,
    ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

    const open = dom.indexOf('<pre id="results">');
    const close = dom.indexOf("</pre>", open);
    if (open === -1 || close === -1) return { name, ok: false, output: "no results element in the page" };

    const output = dom.slice(open + '<pre id="results">'.length, close)
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    return { name, ok: output.includes("RESULT: ALL PASSED"), output };
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

let failed = 0;
for (const name of ["selftest", "inttest", "uitest"]) {
  console.log(`\n===== ${name} =====`);
  const result = runPage(name);
  console.log(result.output.trim());
  if (!result.ok) failed++;
}

console.log(failed ? `\n${failed} page(s) failed` : "\nall pages passed");
process.exit(failed ? 1 : 0);
