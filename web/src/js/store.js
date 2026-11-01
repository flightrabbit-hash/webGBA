const DB_NAME = "webgba";
const DB_VERSION = 1;
const META = "meta";
const DATA = "data";

export const KIND_ROM = "rom";
export const KIND_SAVE = "save";
export const KIND_STATE = "state";
export const KIND_CART = "cart";

// rom:<보관 id> 는 게임 파일. save·state 는 "세이브 id" 로 묶는다 — 설명서가 있는 .wgba 는 게임 id(설명서 id, 버전이 바뀌어도 같음),
// 그 밖(.gba·.wasm·옛 .wgba)은 보관 id. cart:<보관 id>:<label|front|spine> 은 롬팩 그림(라이브러리가 씀).
export const romKey = (id) => `${KIND_ROM}:${id}`;
export const saveKey = (id) => `${KIND_SAVE}:${id}`;
export const stateKey = (id, slot) => `${KIND_STATE}:${id}:${slot}`;
export const cartKey = (id, part) => `${KIND_CART}:${id}:${part}`;
const stateRange = (id) => IDBKeyRange.bound(`${KIND_STATE}:${id}:`, `${KIND_STATE}:${id}:￿`);
const cartRange = (id) => IDBKeyRange.bound(`${KIND_CART}:${id}:`, `${KIND_CART}:${id}:￿`);

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

/**
 * 설명서가 있는 .wgba 를 보관(한 번의 트랜잭션): 게임 파일 + 롬팩 그림(옛 그림은 지움).
 * moveFrom 을 주면 그 옛 보관 id 의 세이브·퀵슬롯을 게임 id(info.gameId)로 옮기고 옛 키는 지운다 — 옛 .wgba(목차 없음)에서
 * 새 .wgba 로 처음 바꿀 때 한 번(사용자 2026-10-31 이번 한 번 예외). 어디서든 실패하면 트랜잭션째 되돌아가 옛 항목이 그대로 남는다.
 * 돌려주는 값: { record, moved: { save, states } }.
 */
export function putGame({ id, name, file, type, sha1 = "", added = 0, ...info }, data, { carts = [], moveFrom = "" } = {}) {
  const now = Date.now();
  const record = { ...info, key: romKey(id), kind: KIND_ROM, id, name, file, type, sha1, added: added || now, opened: now, size: data.length };
  const moved = { save: false, states: 0 };
  return run([META, DATA], "readwrite", (tx, done) => {
    const meta = tx.objectStore(META);
    const blobs = tx.objectStore(DATA);
    meta.put(record);
    blobs.put({ key: record.key, kind: KIND_ROM, data: bufferOf(data) });
    meta.delete(cartRange(id));
    blobs.delete(cartRange(id));
    for (const cart of carts) {
      const key = cartKey(id, cart.part);
      meta.put({ key, kind: KIND_CART, id, part: cart.part, format: cart.format, width: cart.width, height: cart.height, size: cart.bytes.length });
      blobs.put({ key, kind: KIND_CART, data: bufferOf(cart.bytes) });
    }
    if (moveFrom && info.gameId && moveFrom !== info.gameId) {
      const moveOne = (from, to, change) => {
        const head = meta.get(from);
        head.onsuccess = () => {
          if (!head.result) return;
          const body = blobs.get(from);
          body.onsuccess = () => {
            if (!body.result) return;
            meta.put({ ...head.result, ...change, key: to });
            blobs.put({ ...body.result, key: to });
            meta.delete(from);
            blobs.delete(from);
            if (head.result.kind === KIND_SAVE) moved.save = true;
            else moved.states += 1;
          };
        };
      };
      moveOne(saveKey(moveFrom), saveKey(info.gameId), { id: info.gameId });
      const slots = meta.getAll(stateRange(moveFrom));
      slots.onsuccess = () => {
        for (const slot of slots.result) moveOne(slot.key, stateKey(info.gameId, slot.slot), { id: info.gameId });
      };
    }
    done({ record, moved });
  });
}

export const cartBytes = (id, part) => bytes(cartKey(id, part));

export function removeCarts(id) {
  return run([META, DATA], "readwrite", (tx) => {
    tx.objectStore(META).delete(cartRange(id));
    tx.objectStore(DATA).delete(cartRange(id));
  });
}

export function putSave(id, data, game = "") {
  return put({ key: saveKey(id), kind: KIND_SAVE, id, game, saved: Date.now() }, data);
}

export const saveBytes = (id) => bytes(saveKey(id));

// 퀵슬롯(상태 저장): 게임 id 마다 칸 1~9. 목록 기록에 저장 순간 화면(PNG 바이트)을 함께 둔다.
export function putState(id, slot, data, { game = "", thumb = null, auto = false } = {}) {
  return put({ key: stateKey(id, slot), kind: KIND_STATE, id, slot, game, auto, thumb, saved: Date.now() }, data);
}

export const stateBytes = (id, slot) => bytes(stateKey(id, slot));

export function states(id) {
  return run([META], "readonly", (tx) => tx.objectStore(META).getAll(stateRange(id)));
}

export function removeStates(id) {
  return run([META, DATA], "readwrite", (tx) => {
    tx.objectStore(META).delete(stateRange(id));
    tx.objectStore(DATA).delete(stateRange(id));
  });
}

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
  vibrate: false,
  vibrateDir: false,
  muted: false,
  volume: 0.8,
  gameSpeed: 1,
  fastMute: false,
  dpadMode: "latest",
  pauseWhenHidden: true,
  wakeLock: true,
  autoSave: 5,
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
