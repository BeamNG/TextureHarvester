
import { TX } from "../tx.js";

function write(key, version, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ v: version, data }));
    return true;
  } catch (err) {
    return false;
  }
}

function read(key, version) {
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch (err) {
    return null;
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.v !== version) return null;
  return parsed.data == null ? null : parsed.data;
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
  }
}


const flushers = new Set();
let listening = false;

function runFlushers() {
  for (const fn of flushers) {
    try {
      fn();
    } catch (err) {
    }
  }
}

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") runFlushers();
  });
  window.addEventListener("pagehide", runFlushers);
  window.addEventListener("beforeunload", runFlushers);
}

function onFlush(fn) {
  listen();
  flushers.add(fn);
  return () => flushers.delete(fn);
}

function throttled(fn, interval) {
  let timer = null;
  let pending = false;

  const run = () => {
    pending = false;
    fn();
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) run();
  };

  const poke = () => {
    if (timer) {
      pending = true;
      return;
    }
    run();
    timer = setTimeout(() => {
      timer = null;
      if (pending) poke();
    }, interval);
  };

  onFlush(flush);
  return { poke, flush };
}

TX.durable = { read, write, remove, onFlush, throttled, runFlushers };

