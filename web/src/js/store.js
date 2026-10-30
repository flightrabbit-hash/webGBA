const DB_NAME = "webgba";
const DB_VERSION = 1;
const META = "meta";
const DATA = "data";

export const KIND_ROM = "rom";
export const KIND_SAVE = "save";

export const romKey = (id) => `${KIND_ROM}:${id}`;
export const saveKey = (id) => `${KIND_SAVE}:${id}`;

export function newId() {
  const random = new Uint8Array(4);
  crypto.getRandomValues(random);
  return `g${Date.now().toString(36)}${Array.from(random, (b) => b.toString(36).padStart(2, "0")).join("")}`;
}

export const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

export async function romByName(name) {
  return (await list(KIND_ROM)).find((item) => sameName(item.name, name)) ?? null;
}

let opening = null;

function openDb() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" }).createIndex("kind", "kind");
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA, { keyPath: "key" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

async function run(stores, mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    const out = work(tx, (value) => {
      result = value;
    });
    if (out && "onsuccess" in out) out.onsuccess = () => (result = out.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException("abort", "AbortError"));
  });
}

const bufferOf = (bytes) => (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer);

export function list(kind) {
  return run([META], "readonly", (tx) => tx.objectStore(META).index("kind").getAll(kind));
}

export function meta(key) {
  return run([META], "readonly", (tx) => tx.objectStore(META).get(key));
}

export async function bytes(key) {
  const record = await run([DATA], "readonly", (tx) => tx.objectStore(DATA).get(key));
  return record?.data ? new Uint8Array(record.data) : null;
}

export function put(info, data) {
  const record = { ...info, size: data.length };
  return run([META, DATA], "readwrite", (tx, done) => {
    tx.objectStore(META).put(record);
    tx.objectStore(DATA).put({ key: info.key, kind: info.kind, data: bufferOf(data) });
    done(record);
  });
}

export function patch(key, changes) {
  return run([META], "readwrite", (tx, done) => {
    const store = tx.objectStore(META);
    const request = store.get(key);
    request.onsuccess = () => {
      if (!request.result) return;
      const next = { ...request.result, ...changes };
      store.put(next);
      done(next);
    };
  });
}

export function remove(key) {
  return run([META, DATA], "readwrite", (tx) => {
    tx.objectStore(META).delete(key);
    tx.objectStore(DATA).delete(key);
  });
}

export function putRom({ id, name, file, type, sha1 = "", added = 0 }, data) {
  const now = Date.now();
  return put({ key: romKey(id), kind: KIND_ROM, id, name, file, type, sha1, added: added || now, opened: now }, data);
}

export function putSave(id, data, game = "") {
  return put({ key: saveKey(id), kind: KIND_SAVE, id, game, saved: Date.now() }, data);
}

export const saveBytes = (id) => bytes(saveKey(id));

export async function estimate() {
  try {
    return (await navigator.storage?.estimate?.()) ?? null;
  } catch {
    return null;
  }
}

export async function persist() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return Boolean(await navigator.storage?.persist?.());
  } catch {
    return false;
  }
}

const PREFS = "webgba.prefs";

export const DEFAULT_PREFS = {
  lang: "",
  theme: "dark",
  pad: "on",
  dirInput: "stick",
  vibrate: true,
  muted: false,
  volume: 0.8,
  gameSpeed: 1,
  fastMute: false,
  dpadMode: "latest",
  pauseWhenHidden: true,
  wakeLock: true,
  lastGame: "",
  webRoms: {},
};

export function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
