import { TX } from "../tx.js";

const DELAY = 400;
const GRACE = 400;
const GAP = 8;

let element = null;
let current = null;
let timer = 0;
let lastHidden = 0;

function ensure() {
  if (element) return element;
  element = document.createElement("div");
  element.className = "tx-tip";
  element.setAttribute("role", "tooltip");
  element.setAttribute("aria-hidden", "true");
  document.body.appendChild(element);
  return element;
}

function place(target) {
  const tip = ensure();
  const anchor = target.getBoundingClientRect();
  const box = tip.getBoundingClientRect();

  let top = anchor.top - box.height - GAP;
  if (top < GAP) top = anchor.bottom + GAP;

  let left = anchor.left + anchor.width / 2 - box.width / 2;
  left = Math.max(GAP, Math.min(left, window.innerWidth - box.width - GAP));

  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function show(target, text) {
  const tip = ensure();
  current = target;
  tip.textContent = text;
  tip.classList.add("tx-tip--measuring");
  tip.classList.add("tx-tip--on");
  place(target);
  tip.classList.remove("tx-tip--measuring");
  tip.setAttribute("aria-hidden", "false");
}

function hide() {
  clearTimeout(timer);
  timer = 0;
  if (!current) return;
  current = null;
  lastHidden = Date.now();
  if (!element) return;
  element.classList.remove("tx-tip--on");
  element.setAttribute("aria-hidden", "true");
}

function tipFor(node) {
  const host = node && node.closest ? node.closest("[data-tip]") : null;
  const text = host && host.getAttribute("data-tip");
  return text ? { host, text } : null;
}

function onPointer(event) {
  // Disabled controls retarget pointer events to their parent.
  const at = document.elementFromPoint(event.clientX, event.clientY);
  const found = tipFor(at) || tipFor(event.target);

  if (!found) {
    hide();
    return;
  }
  if (found.host === current) return;

  clearTimeout(timer);
  const immediate = current !== null || Date.now() - lastHidden < GRACE;
  if (immediate) {
    show(found.host, found.text);
    return;
  }
  timer = setTimeout(() => show(found.host, found.text), DELAY);
}

let bound = false;
function bind() {
  if (bound) return;
  bound = true;
  document.addEventListener("pointerover", onPointer, true);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("wheel", hide, { capture: true, passive: true });
  window.addEventListener("blur", hide);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") hide();
  }, true);
}

const tip = {
  mounted(el, binding) {
    bind();
    apply(el, binding.value);
  },
  updated(el, binding) {
    if (binding.value === binding.oldValue) return;
    apply(el, binding.value);
    if (current === el && binding.value) show(el, String(binding.value));
    else if (current === el) hide();
  },
  unmounted(el) {
    if (current === el) hide();
  },
};

function apply(el, value) {
  const text = value == null || value === false ? "" : String(value);
  if (!text) {
    el.removeAttribute("data-tip");
    return;
  }
  el.setAttribute("data-tip", text);
  if (!el.getAttribute("aria-label") && !(el.textContent || "").trim()) {
    el.setAttribute("aria-label", text);
  }
}

TX.tooltip = {
  directive: tip,
  hide,
  visible: () => (current && element && element.classList.contains("tx-tip--on")
    ? element.textContent : ""),
  textOf: el => (el && el.getAttribute ? el.getAttribute("data-tip") || "" : ""),
  showNow(el) {
    const found = tipFor(el);
    if (found) show(found.host, found.text);
  },
};
