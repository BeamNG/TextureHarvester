import { build } from "vite";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const i18n = spawnSync(process.execPath, ["scripts/compile-i18n.mjs"], { stdio: "inherit" });
if (i18n.status) process.exit(i18n.status || 1);

const EXTRA = {
  test: ["test/selftest.html", "test/inttest.html", "test/uitest.html"],
};

const asked = process.argv.slice(2);
const pages = ["index.html"];
for (const [flag, extra] of Object.entries(EXTRA)) {
  if (asked.includes(`--with-${flag}s`) || asked.includes(`--with-${flag}`)) pages.push(...extra);
}

rmSync("dist", { recursive: true, force: true });

for (const page of pages) {
  process.env.TX_PAGE = page;
  process.env.TX_KEEP = "1";
  await build({ logLevel: "warn" });
  console.log(`dist/${page.split("/").pop()}`);
}
