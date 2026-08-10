import { TX } from "../tx.js";

const FILES = [
  "sign-coffee-shop.jpg",
  "sign-new-york-coffee.jpg",
  "sign-paris-cafe.jpg",
  "sign-queen-of-hearts.jpg",
];

const REMOTE = "https://raw.githubusercontent.com/BeamNG/TextureHarvester/main/examples/";

async function fetchOne(name) {
  const urls = [`examples/${name}`, `${REMOTE}${encodeURIComponent(name)}`];
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = new Error(`${url} → ${res.status}`);
        continue;
      }
      const blob = await res.blob();
      const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
      return new File([blob], name, { type });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(name);
}

async function loadFiles(report) {
  const files = [];
  for (let i = 0; i < FILES.length; i++) {
    const name = FILES[i];
    if (report) await report(i / FILES.length, name);
    files.push(await fetchOne(name));
  }
  if (report) await report(1, "");
  return files;
}

TX.examples = { FILES, loadFiles };
