
import { TX } from "../tx.js";

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
// Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const canvasToBlob = canvas =>
  new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("canvas encoding failed"))), "image/png"));

const canvasToBytes = canvas =>
  canvasToBlob(canvas).then(b => b.arrayBuffer()).then(buf => new Uint8Array(buf));

const decodeBlob = blob => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error("could not decode image"));
  };
  image.src = url;
});

function safeFilename(name, fallback) {
  const cleaned = String(name || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/\.+$/, "").trim();
  return cleaned || fallback;
}

TX.io = { saveBlob, canvasToBlob, canvasToBytes, decodeBlob, safeFilename };

