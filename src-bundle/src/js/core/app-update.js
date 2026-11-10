import { inflate } from "../vendor/pako.js";
import { VERSION_RE } from "./wgba-format.js";
import { FEED_INDEX, FILE_MAX, fetchChecked, fetchFeed, fileRef, loadIndex, parseJson, sha256Hex, UpdateError, verifySigned } from "./wgba-update.js";

export const APP_ID = "com.flightrabbit.webgba";
export const APP_FORMAT = 1;
export const APP_PLATFORM = "windows-x64";
export const APP_EXE = "webgba.exe";
export const APP_FILES_MAX = 16;

const SHA256_RE = /^[0-9a-f]{64}$/;
const SEGMENT_RE = /^[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;
const utf8 = new TextEncoder();

export function appPathOk(path) {
  if (typeof path !== "string" || !path || path.length > 128 || /\.old$/i.test(path)) return false;
  const parts = path.split("/");
  if (/^(bin|\.webgba-update)$/i.test(parts[0])) return false;
  return parts.every((part) => SEGMENT_RE.test(part));
}

export function readApp(signed, base) {
  const bad = (why) => new UpdateError("appBad", { why });
  if (!signed || typeof signed !== "object" || Array.isArray(signed)) throw bad("object");
  if (signed.id !== APP_ID) throw bad("id");
  if (!VERSION_RE.test(signed.version ?? "")) throw bad("version");
  if (signed.platform !== APP_PLATFORM) throw bad("platform");
  const list = signed.files;
  if (!Array.isArray(list) || !list.length || list.length > APP_FILES_MAX) throw bad("files");
  const seen = new Set();
  const files = list.map((item) => {
    const get = fileRef(item?.get, base);
    const key = String(item?.path ?? "").toLowerCase();
    if (!appPathOk(item?.path) || seen.has(key) || !Number.isInteger(item.size) || item.size < 1 || item.size > FILE_MAX || !SHA256_RE.test(item.sha256 ?? "") || !get) throw bad("files");
    seen.add(key);
    return { path: item.path, size: item.size, sha256: item.sha256, get };
  });
  if (!seen.has(APP_EXE)) throw bad("exe");
  const notes = signed.notes && typeof signed.notes === "object" && !Array.isArray(signed.notes) ? signed.notes : null;
  return { id: signed.id, version: signed.version, time: typeof signed.time === "string" ? signed.time : "", platform: signed.platform, files, notes };
}

export async function verifyAppEnvelope(envelope, key, base) {
  if (!envelope || typeof envelope !== "object" || envelope.wgbaApp !== APP_FORMAT) throw new UpdateError("appFormat", { format: envelope?.wgbaApp });
  return readApp(await verifySigned(envelope, key, "appBad"), base);
}

export const verifyApp = (text, key, base) => verifyAppEnvelope(parseJson(text, "appBad"), key, base);

export async function indexedApp(list, source) {
  const has = (table) => Object.prototype.hasOwnProperty.call(table, APP_ID);
  if (!has(list.apps) || !has(list.appHashes)) return null;
  const envelope = list.apps[APP_ID];
  if (!SHA256_RE.test(list.appHashes[APP_ID] ?? "") || typeof envelope?.signed !== "string" || (await sha256Hex(utf8.encode(envelope.signed))) !== list.appHashes[APP_ID]) throw new UpdateError("indexBad", { why: "appHash" });
  return verifyAppEnvelope(envelope, source.key, source.feed);
}

export function appSource(overrides = null) {
  const index = overrides?.index ?? FEED_INDEX;
  return { index, key: index.key, feed: new URL(`${APP_ID}/latest.json`, index.url).href };
}

export function loadApp(source, { fetchImpl = globalThis.fetch, timeout = 10000, cache, memory }) {
  const id = `app\n${source.feed}\n${source.key}`;
  if (cache.has(id)) return cache.get(id);
  const single = async (error) => ({ app: await fetchFeed(source.feed, { fetchImpl, timeout, code: "appBad" }).then((text) => verifyApp(text, source.key, source.feed)), error });
  const work = loadIndex(source.index, { fetchImpl, timeout, cache, memory }).then(async ({ list, error }) => {
    if (!list) return single(error);
    try {
      return { app: await indexedApp(list, source), error: null };
    } catch (failure) {
      if (!(failure instanceof UpdateError)) throw failure;
      return single(failure);
    }
  });
  work.catch(() => {});
  cache.set(id, work);
  return work;
}

export function planApp(app, local) {
  const files = app.files.filter((file) => local[file.path] !== file.sha256);
  return { files, size: files.reduce((sum, file) => sum + file.get.size, 0) };
}

export async function fetchAppFile(file, options = {}) {
  const packed = await fetchChecked(file.get, options);
  let bytes;
  try {
    bytes = inflate(packed);
  } catch {
    throw new UpdateError("appFile", { why: "inflate" });
  }
  if (bytes.length !== file.size || (await sha256Hex(bytes)) !== file.sha256) throw new UpdateError("appFile", { why: "hash" });
  return bytes;
}
