
import { TX } from "../tx.js";

// Keys predate the Texture Harvester rename; changing them would drop saved sessions.
const DB_NAME = "texture-extract";
const STORE = "state";
const KEY = "session";
const LS_KEY = "texture-extract:session";

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const dataUrlToBlob = url => fetch(url).then(r => r.blob());

async function encode(value) {
  if (value instanceof Blob) {
    return { __blob: 1, type: value.type, dataUrl: await blobToDataUrl(value) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encode));
  if (value && typeof value === "object" && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await encode(v);
    return out;
  }
  return value;
}

async function decode(value) {
  if (value && typeof value === "object" && value.__blob === 1) {
    return dataUrlToBlob(value.dataUrl);
  }
  if (Array.isArray(value)) return Promise.all(value.map(decode));
  if (value && typeof value === "object" && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await decode(v);
    return out;
  }
  return value;
}

function openIndexedDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("no indexedDB"));
    let request;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch (err) {
      return reject(err);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("indexedDB open failed"));
    request.onblocked = () => reject(new Error("indexedDB blocked"));
    setTimeout(() => reject(new Error("indexedDB open timed out")), 3000);
  });
}

function indexedDbAdapter(db) {
  const run = (mode, fn) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
    if (request) request.onsuccess = () => resolve(request.result);
    else tx.oncomplete = () => resolve();
  });

  return {
    kind: "indexeddb",
    get: () => run("readonly", store => store.get(KEY)),
    set: value => run("readwrite", store => store.put(value, KEY)),
    clear: () => run("readwrite", store => store.delete(KEY)),
  };
}

function localStorageAdapter() {
  localStorage.setItem(`${LS_KEY}:probe`, "1");
  localStorage.removeItem(`${LS_KEY}:probe`);
  return {
    kind: "localstorage",
    async get() {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? decode(JSON.parse(raw)) : undefined;
    },
    async set(value) {
      localStorage.setItem(LS_KEY, JSON.stringify(await encode(value)));
    },
    async clear() {
      localStorage.removeItem(LS_KEY);
    },
  };
}

function memoryAdapter() {
  let held;
  return {
    kind: "memory",
    async get() { return held; },
    async set(value) { held = value; },
    async clear() { held = undefined; },
  };
}

let adapterPromise = null;

function adapter() {
  if (adapterPromise) return adapterPromise;
  adapterPromise = openIndexedDb()
    .then(indexedDbAdapter)
    .catch(() => {
      try {
        return localStorageAdapter();
      } catch (err) {
        return memoryAdapter();
      }
    });
  return adapterPromise;
}

let storesPromise = null;

function allStores() {
  if (storesPromise) return storesPromise;
  storesPromise = (async () => {
    const primary = await adapter();
    const stores = [primary];
    if (primary.kind !== "indexeddb") {
      try {
        stores.push(indexedDbAdapter(await openIndexedDb()));
      } catch (err) {
      }
    }
    if (primary.kind !== "localstorage") {
      try {
        stores.push(localStorageAdapter());
      } catch (err) {
      }
    }
    return stores;
  })();
  return storesPromise;
}

const kind = () => adapter().then(a => a.kind);
const save = state => adapter().then(a => a.set(state));

async function load() {
  const found = [];
  for (const store of await allStores()) {
    try {
      const value = await store.get();
      if (value) found.push(value);
    } catch (err) {
    }
  }
  found.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return found[0];
}

async function clear() {
  for (const store of await allStores()) {
    try {
      await store.clear();
    } catch (err) {
    }
  }
}

TX.persist = { kind, load, save, clear };

