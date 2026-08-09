import { reactive } from "vue";
import { TX } from "../tx.js";
import data from "./i18n-data.js";

const RTL = new Set(["ar"]);

const catalogs = data && typeof data === "object" ? data : { en: {} };
const codes = Object.keys(catalogs);

const status = reactive({ locale: "en" });

function catalogOf(code) {
  return code && catalogs[code] || null;
}

function findCode(tag) {
  const want = String(tag || "").replace(/_/g, "-").toLowerCase();
  if (!want) return null;
  return codes.find(code => code.toLowerCase() === want) || null;
}

function fromBrowser(preferred) {
  const list = preferred
    || (typeof navigator !== "undefined"
      && (navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language]))
    || [];
  for (const raw of list) {
    const tag = String(raw || "").replace(/_/g, "-");
    if (!tag) continue;
    const lower = tag.toLowerCase();

    const exact = findCode(tag);
    if (exact) return exact;

    if (lower.startsWith("zh-hans") || lower === "zh-cn") return findCode("zh-CN") || "en";
    if (lower.startsWith("zh-hant") || lower === "zh-tw" || lower === "zh-hk" || lower === "zh-mo") {
      return findCode("zh-TW") || "en";
    }
    if (lower === "es-419"
      || /^es-(mx|ar|co|cl|pe|ve|ec|gt|cu|bo|do|hn|py|sv|ni|cr|pa|uy|pr)$/.test(lower)) {
      return findCode("es-419") || findCode("es") || "en";
    }
    if (lower.startsWith("pt")) return findCode("pt-BR") || "en";

    const lang = lower.split("-")[0];
    const byLang = findCode(lang);
    if (byLang) return byLang;
  }
  return "en";
}

function resolve(code) {
  if (!code || code === "auto") return fromBrowser();
  return catalogOf(code) ? code : fromBrowser();
}

function interpolate(text, vars) {
  if (!vars) return text;
  return String(text).replace(/\{(\w+)\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`);
}

function t(id, vars) {
  if (id == null || id === "") return "";
  if (typeof id === "object" && id.id) return t(id.id, id.vars || vars);
  const primary = catalogOf(status.locale);
  const fallback = catalogOf("en");
  const raw = (primary && primary[id]) || (fallback && fallback[id]) || id;
  return interpolate(raw, vars);
}

function applyDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = status.locale;
  document.documentElement.dir = RTL.has(status.locale) ? "rtl" : "ltr";
}

function setLocale(code) {
  status.locale = resolve(code);
  applyDocument();
  if (TX.history && TX.history.relabel) TX.history.relabel();
  return status.locale;
}

function locales() {
  return codes.slice().sort((a, b) => {
    if (a === "en") return -1;
    if (b === "en") return 1;
    const an = (catalogOf(a) && catalogOf(a)["meta.language_name"]) || a;
    const bn = (catalogOf(b) && catalogOf(b)["meta.language_name"]) || b;
    return an.localeCompare(bn);
  }).map(code => ({
    code,
    name: (catalogOf(code) && catalogOf(code)["meta.language_name"]) || code,
  }));
}

TX.i18n = {
  t,
  setLocale,
  resolve,
  fromBrowser,
  getLocale: () => status.locale,
  status,
  locales,
  catalogs: () => catalogs,
  isRtl: () => RTL.has(status.locale),
};

TX.t = t;

setLocale("auto");

