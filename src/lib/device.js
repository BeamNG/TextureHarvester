import { reactive } from "vue";
import { TX } from "../tx.js";

// Backing-store density: follow the screen, but avoid absurd GPU sizes on rare 4× displays.
const MAX_PIXEL_RATIO = 3;

const status = reactive({
  touch: false,
  narrow: false,
  compact: false,
  pixelRatio: 1,
});

function media(query) {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  try {
    return window.matchMedia(query);
  } catch (err) {
    return null;
  }
}

function matches(query) {
  const mql = media(query);
  return !!(mql && mql.matches);
}

function readPixelRatio() {
  if (typeof window === "undefined") return 1;
  const raw = Number(window.devicePixelRatio) || 1;
  return Math.min(MAX_PIXEL_RATIO, Math.max(1, raw));
}

function refresh() {
  const coarse = matches("(pointer: coarse)");
  const points = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
  status.touch = coarse || !!points;
  status.narrow = matches("(max-width: 720px)");
  status.compact = status.narrow || (status.touch && matches("(max-width: 900px)"));
  status.pixelRatio = readPixelRatio();
}

const watched = [];
const displayListeners = new Set();
let displayBound = false;
let resolutionMql = null;

function notifyDisplay() {
  refresh();
  for (const fn of displayListeners) {
    try { fn(); } catch (err) { /* keep others running */ }
  }
}

function bindResolutionWatch() {
  if (typeof window === "undefined" || !window.matchMedia) return;
  if (resolutionMql) {
    if (resolutionMql.removeEventListener) resolutionMql.removeEventListener("change", onResolution);
    else if (resolutionMql.removeListener) resolutionMql.removeListener(onResolution);
  }
  // Browser page-zoom changes devicePixelRatio without always resizing layout boxes.
  resolutionMql = media(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  if (!resolutionMql) return;
  if (resolutionMql.addEventListener) resolutionMql.addEventListener("change", onResolution);
  else if (resolutionMql.addListener) resolutionMql.addListener(onResolution);
}

function onResolution() {
  bindResolutionWatch();
  notifyDisplay();
}

function bindDisplay() {
  if (displayBound || typeof window === "undefined") return;
  displayBound = true;
  window.addEventListener("resize", notifyDisplay);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", notifyDisplay);
  }
  bindResolutionWatch();
}

function onDisplayChange(fn) {
  if (typeof fn !== "function") return () => {};
  bindDisplay();
  displayListeners.add(fn);
  return () => displayListeners.delete(fn);
}

function start() {
  refresh();
  bindDisplay();
  if (watched.length) return;
  for (const query of ["(pointer: coarse)", "(max-width: 720px)", "(max-width: 900px)"]) {
    const mql = media(query);
    if (!mql) continue;
    const onChange = () => refresh();
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else if (mql.addListener) mql.addListener(onChange);
    watched.push(mql);
  }
}

TX.device = {
  status,
  refresh,
  start,
  pixelRatio: readPixelRatio,
  onDisplayChange,
  get touch() { return status.touch; },
  get narrow() { return status.narrow; },
  get compact() { return status.compact; },
};
