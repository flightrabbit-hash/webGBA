import { deflate, inflate } from "../vendor/pako.js";
import { bpsApply, concat, romPayloadFrom, sha1Bytes, sha1Hex } from "./wgbp.js";
import { compareVersions, FEED_LOOPBACK_RE, feedUrlOk, ID_RE, keyOk, KIND, readTocFrom, unpackRom, VERSION_RE } from "./wgba-format.js";

export { feedUrlOk, keyOk };

export const FEED_FORMAT = 1;
export const DELTA_MAGIC = "WGBD";
export const DELTA_VERSION = 1;
export const DELTA_HEAD = 72;
export const DELTA_EXPANDED = 1;
export const DELTA_REBUILT = 2;
export const FEED_MAX = 256 * 1024;
export const FILE_MAX = 512 * 1024 * 1024;
export const STEPS_MAX = 64;
export const TEST_KEY = "webgba.updateTest";

const FEED_HOST = "https://pub-da193dc1ff6540a4a6654def95a1a92f.r2.dev";
const FEED_KEY = "BFhhvxjl7AcTB5l5YA648fDFzdgTvC2Il3FO+yu4KPfaH2iYD85g6vUOsQ7JHBOpg+6nBN1LpO5WbPfbm0MJ/cY=";
const KNOWN_IDS = [
  "com.flightrabbit.rapid",
  "local.atetris",
  "local.bldyror2",
  "local.bublbob2",
  "local.bublbobl",
  "local.dmnfrnt",
  "local.kof98",
  "local.kov115",
  "local.mslug",
  "local.mslug2",
  "local.mslug3",
  "local.mslug4",
  "local.mslug5",
  "local.mslugx",
  "local.neobombe",
  "local.tengai",
];

export const KNOWN_FEEDS = Object.freeze(Object.fromEntries(KNOWN_IDS.map((id) => [id, Object.freeze({ feed: `${FEED_HOST}/${id}/latest.json`, key: FEED_KEY })])));

export class UpdateError extends Error {
  constructor(code, params = {}) {
    super(`${code}${Object.keys(params).length ? ` ${JSON.stringify(params)}` : ""}`);
    this.name = "UpdateError";
    this.code = code;
    this.params = params;
  }
}

const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder("utf-8", { fatal: true });
const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const u16 = (b, at) => b[at] | (b[at + 1] << 8);
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

function putU16(b, at, v) {
  b[at] = v & 0xff;
  b[at + 1] = (v >>> 8) & 0xff;
}

function putU32(b, at, v) {
  for (let i = 0; i < 4; i++) b[at + i] = (v >>> (8 * i)) & 0xff;
}

export function toBase64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function fromBase64(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new UpdateError("base64");
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function sha256Hex(bytes) {
  return hexOf(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));
}

export function readOverrides(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(TEST_KEY);
    if (!raw) return null;
    const feeds = JSON.parse(raw)?.feeds;
    if (!feeds || typeof feeds !== "object") return null;
    const out = {};
    for (const [id, item] of Object.entries(feeds)) if (ID_RE.test(id) && feedUrlOk(item?.feed, { loopback: true }) && keyOk(item?.key)) out[id] = { feed: item.feed, key: item.key };
    return out;
  } catch {
    return null;
  }
}

export function updateSource({ gameId, update }, overrides = null) {
  if (overrides?.[gameId]) return { ...overrides[gameId], from: "test" };
  const known = KNOWN_FEEDS[gameId];
  if (known && feedUrlOk(known.feed) && keyOk(known.key)) return { feed: known.feed, key: known.key, from: "known" };
  if (update && feedUrlOk(update.feed) && keyOk(update.key)) return { feed: update.feed, key: update.key, from: "manifest" };
  return null;
}

const keyCache = new Map();

function verifyKey(key) {
  if (!keyCache.has(key)) keyCache.set(key, globalThis.crypto.subtle.importKey("raw", fromBase64(key), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
  return keyCache.get(key);
}

function fileRef(ref, base) {
  if (!ref || typeof ref !== "object") return null;
  if (typeof ref.url !== "string" || !Number.isInteger(ref.size) || ref.size < 1 || ref.size > FILE_MAX || !SHA256_RE.test(ref.sha256 ?? "")) return null;
  let url;
  try {
    url = new URL(ref.url, base).href;
  } catch {
    return null;
  }
  if (!/^https:\/\//.test(url) && !FEED_LOOPBACK_RE.test(url)) return null;
  return { url, size: ref.size, sha256: ref.sha256 };
}

export function readFeed(signed, base) {
  const bad = (why) => new UpdateError("feedBad", { why });
  if (!signed || typeof signed !== "object" || Array.isArray(signed)) throw bad("object");
  if (!ID_RE.test(signed.id ?? "")) throw bad("id");
  if (!VERSION_RE.test(signed.version ?? "")) throw bad("version");
  const wgba = signed.wgba;
  if (!wgba || !SHA1_RE.test(wgba.sha1 ?? "") || !Number.isInteger(wgba.size) || wgba.size < 1 || wgba.size > FILE_MAX) throw bad("wgba");
  const list = signed.from ?? [];
  if (!Array.isArray(list) || list.length > 256) throw bad("from");
  const from = [];
  for (const item of list) {
    const patch = fileRef(item?.patch, base);
    if (!SHA1_RE.test(item?.sha1 ?? "") || !SHA1_RE.test(item?.to ?? "") || !patch) throw bad("from");
    from.push({ sha1: item.sha1, to: item.to, version: typeof item.version === "string" ? item.version : "", patch });
  }
  const full = signed.full === undefined ? null : fileRef(signed.full, base);
  if (signed.full !== undefined && !full) throw bad("full");
  const notes = signed.notes && typeof signed.notes === "object" && !Array.isArray(signed.notes) ? signed.notes : null;
  return { id: signed.id, version: signed.version, time: typeof signed.time === "string" ? signed.time : "", wgba: { sha1: wgba.sha1, size: wgba.size }, from, full, notes };
}

export async function verifyFeed(text, key, base) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new UpdateError("feedBad", { why: "json" });
  }
  if (envelope?.wgbaFeed !== FEED_FORMAT) throw new UpdateError("feedFormat", { format: envelope?.wgbaFeed });
  if (typeof envelope.signed !== "string" || typeof envelope.signature !== "string") throw new UpdateError("feedBad", { why: "envelope" });
  let signature;
  try {
    signature = fromBase64(envelope.signature);
  } catch {
    throw new UpdateError("feedSignature");
  }
  const ok = signature.length === 64 && (await globalThis.crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await verifyKey(key), signature, utf8.encode(envelope.signed)));
  if (!ok) throw new UpdateError("feedSignature");
  let signed;
  try {
    signed = JSON.parse(envelope.signed);
  } catch {
    throw new UpdateError("feedBad", { why: "json" });
  }
  return readFeed(signed, base);
}

export function planUpdate(feed, sha1) {
  if (sha1 === feed.wgba.sha1) return { kind: "latest", steps: [], size: 0 };
  const steps = [];
  const seen = new Set();
  let at = sha1;
  while (at !== feed.wgba.sha1) {
    const choices = feed.from.filter((item) => item.sha1 === at);
    const step = choices.find((item) => item.to === feed.wgba.sha1) ?? choices[0];
    if (!step || seen.has(at) || steps.length >= STEPS_MAX) return feed.full ? { kind: "full", steps: [], size: feed.full.size } : { kind: "none", steps: [], size: 0 };
    seen.add(at);
    steps.push(step);
    at = step.to;
  }
  return { kind: "patch", steps, size: steps.reduce((sum, step) => sum + step.patch.size, 0) };
}

async function withTimeout(ms, signal, work) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  const stop = () => abort.abort();
  signal?.addEventListener?.("abort", stop);
  try {
    return await work(abort.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", stop);
  }
}

export function fetchFeed(url, { fetchImpl = globalThis.fetch, timeout = 10000 } = {}) {
  return withTimeout(timeout, null, async (signal) => {
    const response = await fetchImpl(url, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer", signal });
    if (!response.ok) throw new UpdateError("feedHttp", { status: response.status });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > FEED_MAX) throw new UpdateError("feedBad", { why: "size" });
    return fromUtf8.decode(bytes);
  });
}

function groupSources(games, overrides) {
  const wanted = new Map();
  for (const game of games) {
    if (!game.gameId || !game.version) continue;
    const source = updateSource(game, overrides);
    if (!source) continue;
    const id = `${source.feed}\n${source.key}`;
    if (!wanted.has(id)) wanted.set(id, { id, source, games: [] });
    wanted.get(id).games.push(game);
  }
  return wanted;
}

function loadFeed({ id, source }, { fetchImpl, timeout, cache }) {
  const hit = cache?.get(id);
  if (hit) return hit;
  const work = fetchFeed(source.feed, { fetchImpl, timeout }).then((text) => verifyFeed(text, source.key, source.feed));
  if (cache) {
    cache.set(id, work);
    work.catch(() => {});
  }
  return work;
}

export function prefetchFeeds(games, { overrides = null, fetchImpl = globalThis.fetch, timeout = 10000, cache } = {}) {
  for (const group of groupSources(games, overrides).values()) loadFeed(group, { fetchImpl, timeout, cache });
}

export async function checkGames(games, { overrides = null, fetchImpl = globalThis.fetch, timeout = 10000, log = () => {}, cache = null } = {}) {
  const wanted = groupSources(games, overrides);
  const found = [];
  await Promise.all(
    [...wanted.values()].map(async (group) => {
      const { source, games: list } = group;
      let feed;
      try {
        feed = await loadFeed(group, { fetchImpl, timeout, cache });
      } catch (error) {
        log("WARN", `업데이트 확인 실패 ${source.feed}: ${error?.code ?? error?.name ?? ""} ${error?.message ?? error}`);
        return;
      }
      for (const game of list) {
        if (feed.id !== game.gameId) {
          log("WARN", `업데이트 버전 파일의 id 가 다릅니다 ${feed.id} ≠ ${game.gameId} (${source.feed})`);
          continue;
        }
        let newer = false;
        try {
          newer = compareVersions(feed.version, game.version) > 0;
        } catch {
          newer = false;
        }
        if (newer) found.push({ game, feed, source });
      }
    }),
  );
  return found;
}

export function fetchChecked(ref, { fetchImpl = globalThis.fetch, onProgress = () => {}, signal = null, timeout = 300000 } = {}) {
  return withTimeout(timeout, signal, async (abort) => {
    let response;
    try {
      response = await fetchImpl(ref.url, { credentials: "omit", referrerPolicy: "no-referrer", signal: abort });
    } catch (error) {
      throw new UpdateError(signal?.aborted ? "cancelled" : "download", { why: error?.name ?? "" });
    }
    if (!response.ok) throw new UpdateError("downloadHttp", { status: response.status });
    const out = new Uint8Array(ref.size);
    let filled = 0;
    const take = (value) => {
      if (filled + value.length > out.length) throw new UpdateError("downloadSize");
      out.set(value, filled);
      filled += value.length;
      onProgress(filled, out.length);
    };
    try {
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          try {
            take(value);
          } catch (error) {
            reader.cancel().catch(() => {});
            throw error;
          }
        }
      } else take(new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      throw new UpdateError(signal?.aborted ? "cancelled" : "download", { why: error?.name ?? "" });
    }
    if (filled !== out.length) throw new UpdateError("downloadSize");
    if ((await sha256Hex(out)) !== ref.sha256) throw new UpdateError("downloadHash");
    return out;
  });
}

export async function romPlace(bytes) {
  const toc = await readTocFrom(bytes);
  if (!toc) return null;
  const entry = toc.entries.find((e) => e.kind === KIND.rom);
  if (!entry) return null;
  return { start: entry.start, end: entry.end, payload: bytes.subarray(entry.start, entry.end) };
}

export async function expandedSource(source) {
  const place = await romPlace(source);
  if (!place || place.payload[7] !== 1) return { bytes: source, expanded: false };
  const { rom } = await unpackRom(place.payload);
  return { bytes: concat([source, rom]), expanded: true };
}

export function readDeltaHead(delta) {
  const bad = (why) => new UpdateError("deltaBad", { why });
  if (delta.length < DELTA_HEAD || String.fromCharCode(...delta.subarray(0, 4)) !== DELTA_MAGIC) throw bad("magic");
  if (delta[6] !== DELTA_VERSION) throw new UpdateError("deltaVersion", { version: delta[6] });
  const headLen = u16(delta, 4);
  const metaLen = u16(delta, 70);
  if (headLen !== DELTA_HEAD + metaLen || headLen > delta.length) throw bad("head");
  const head = {
    headLen,
    flags: delta[7],
    sourceSize: u32(delta, 8),
    targetSize: u32(delta, 12),
    sourceSha1: hexOf(delta.subarray(16, 36)),
    targetSha1: hexOf(delta.subarray(36, 56)),
    bodyLen: u32(delta, 56),
    bodyRaw: u32(delta, 60),
    prefixLen: u32(delta, 64),
    romLevel: delta[68],
    romMethod: delta[69],
    meta: {},
  };
  if (headLen + head.bodyLen !== delta.length) throw bad("size");
  if (head.flags & ~(DELTA_EXPANDED | DELTA_REBUILT)) throw new UpdateError("deltaVersion", { flags: head.flags });
  try {
    head.meta = metaLen ? JSON.parse(fromUtf8.decode(delta.subarray(DELTA_HEAD, headLen))) : {};
  } catch {
    throw bad("meta");
  }
  return head;
}

export function writeDelta({ flags, source, target, sourceSha1, targetSha1, bps, prefixLen = 0, romLevel = 0, romMethod = 0, meta = {}, level = 9 }) {
  const metaBytes = utf8.encode(JSON.stringify(meta));
  const body = deflate(bps, { level });
  const head = new Uint8Array(DELTA_HEAD + metaBytes.length);
  for (let i = 0; i < 4; i++) head[i] = DELTA_MAGIC.charCodeAt(i);
  putU16(head, 4, head.length);
  head[6] = DELTA_VERSION;
  head[7] = flags;
  putU32(head, 8, source);
  putU32(head, 12, target);
  head.set(sourceSha1, 16);
  head.set(targetSha1, 36);
  putU32(head, 56, body.length);
  putU32(head, 60, bps.length);
  putU32(head, 64, prefixLen);
  head[68] = romLevel;
  head[69] = romMethod;
  putU16(head, 70, metaBytes.length);
  head.set(metaBytes, DELTA_HEAD);
  return concat([head, body]);
}

export async function applyDelta(source, delta, { onProgress = () => {} } = {}) {
  const head = readDeltaHead(delta);
  onProgress("check", 0);
  if (source.length !== head.sourceSize || (await sha1Hex(source)) !== head.sourceSha1) throw new UpdateError("deltaSource");
  const base = head.flags & DELTA_EXPANDED ? await expandedSource(source) : { bytes: source, expanded: false };
  if (Boolean(head.flags & DELTA_EXPANDED) !== base.expanded) throw new UpdateError("deltaSource");
  onProgress("check", 1);
  let bps;
  try {
    bps = inflate(delta.subarray(head.headLen));
  } catch {
    throw new UpdateError("deltaBad", { why: "inflate" });
  }
  if (!bps || bps.length !== head.bodyRaw) throw new UpdateError("deltaBad", { why: "inflate" });
  let out;
  try {
    out = bpsApply(base.bytes, bps, (fraction) => onProgress("patch", fraction));
  } catch {
    throw new UpdateError("deltaBad", { why: "bps" });
  }
  onProgress("patch", 1);
  if (head.flags & DELTA_REBUILT) {
    if (head.prefixLen > out.length) throw new UpdateError("deltaBad", { why: "prefix" });
    const rom = out.subarray(head.prefixLen);
    const payload = romPayloadFrom(rom, await sha1Bytes(rom), { store: head.romMethod === 0, level: head.romLevel || 9 });
    out = concat([out.subarray(0, head.prefixLen), payload]);
  }
  onProgress("verify", 0.5);
  if (out.length !== head.targetSize || (await sha1Hex(out)) !== head.targetSha1) throw new UpdateError("deltaResult");
  onProgress("verify", 1);
  return out;
}

export const GAUGE = Object.freeze({ download: 0.8, built: 0.99 });
export const DELTA_SPANS = Object.freeze({ check: [0, 0.25], patch: [0.25, 0.6], verify: [0.6, 0.85] });
export const BUILD_SPANS = Object.freeze({ check: [0, 0.1], patch: [0.1, 0.4], verify: [0.4, 0.55], pack: [0.55, 1] });

export function spanOf(spans, stage, fraction) {
  const span = spans[stage];
  if (!span) return 0;
  const value = Math.min(1, Math.max(0, Number(fraction) || 0));
  return span[0] + (span[1] - span[0]) * value;
}

export function buildGauge(stage, fraction) {
  return GAUGE.download + (GAUGE.built - GAUGE.download) * spanOf(BUILD_SPANS, stage, fraction);
}

export async function runSteps(source, plan, feed, { fetchImpl = globalThis.fetch, onProgress = () => {}, signal = null, apply = applyDelta } = {}) {
  const steps = plan.steps;
  const total = Math.max(1, steps.reduce((sum, step) => sum + step.patch.size, 0));
  const patches = [];
  let got = 0;
  for (const step of steps) {
    patches.push(await fetchChecked(step.patch, { fetchImpl, signal, onProgress: (filled) => onProgress((GAUGE.download * (got + filled)) / total, "download") }));
    got += step.patch.size;
    if (signal?.aborted) throw new UpdateError("cancelled");
  }
  const share = (GAUGE.built - GAUGE.download) / Math.max(1, steps.length);
  let bytes = source;
  let sha1 = steps.length ? "" : await sha1Hex(bytes);
  for (const [index, step] of steps.entries()) {
    const at = GAUGE.download + share * index;
    bytes = await apply(bytes, patches[index], { onProgress: (stage, fraction) => onProgress(at + share * spanOf(DELTA_SPANS, stage, fraction), "apply") });
    patches[index] = null;
    sha1 = await sha1Hex(bytes);
    if (sha1 !== step.to) throw new UpdateError("deltaResult");
    onProgress(at + share, "apply");
  }
  if (bytes.length !== feed.wgba.size || sha1 !== feed.wgba.sha1) throw new UpdateError("deltaResult");
  return bytes;
}
