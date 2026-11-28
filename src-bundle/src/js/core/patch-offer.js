import { fetchChecked, fileRef, indexedFeed, loadIndex, planUpdate, runSteps, spanOf, BUILD_SPANS, UpdateError } from "./wgba-update.js";
import { GBA_ROM_SIZE, sha1Hex } from "./wgbp.js";
import { ID_RE, VERSION_RE } from "./wgba-format.js";

export const PATCHES_FORMAT = 1;
export const PATCH_ITEMS_MAX = 64;
export const PATCH_SKIP_MAX = 64;
export const PATCH_SKIP_KEY = "webgba.patchSkip";
export const PATCH_OPEN_TIMEOUT = 5000;
export const PATCH_GAUGE = Object.freeze({ download: 0.55, built: 0.99, chained: 0.88 });

const SHA1_RE = /^[0-9a-f]{40}$/;
const FILE_RE = /^[^\\/:*?"<>|\x00-\x1f]{1,120}\.(wgba|wmba|wapk)$/i;
const NAME_LANGS = ["ko", "en", "ja"];

function readNames(value) {
  if (typeof value === "string") return value.trim() ? { en: value.trim().slice(0, 80) } : {};
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const lang of NAME_LANGS) if (typeof value[lang] === "string" && value[lang].trim()) out[lang] = value[lang].trim().slice(0, 80);
  return out;
}

function readItem(raw, base) {
  if (!raw || typeof raw !== "object" || !ID_RE.test(raw.id ?? "")) return null;
  const parents = (Array.isArray(raw.parents) ? raw.parents : [])
    .filter((parent) => SHA1_RE.test(parent?.sha1 ?? ""))
    .slice(0, 16)
    .map((parent) => ({ sha1: parent.sha1, name: typeof parent.name === "string" ? parent.name.slice(0, 120) : "" }));
  if (!parents.length) return null;
  let install = null;
  if (raw.install === "full") install = "full";
  else {
    const value = raw.install;
    const wgbp = value && typeof value === "object" ? fileRef(value.wgbp, base) : null;
    if (!wgbp || !VERSION_RE.test(value.version ?? "") || !SHA1_RE.test(value.wgba?.sha1 ?? "") || !Number.isInteger(value.wgba?.size) || value.wgba.size < 1) return null;
    install = { version: value.version, wgbp, wgba: { sha1: value.wgba.sha1, size: value.wgba.size } };
  }
  const file = typeof raw.file === "string" && FILE_RE.test(raw.file) && !/^[. ]|[. ]$/.test(raw.file.replace(/\.(wgba|wmba|wapk)$/i, "")) ? raw.file : "";
  return { id: raw.id, name: readNames(raw.name), parents, install, file };
}

export function readPatches(value, base) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.format !== PATCHES_FORMAT || !Array.isArray(value.items)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value.items.slice(0, PATCH_ITEMS_MAX)) {
    const item = readItem(raw, base);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export async function romSha1s(rom) {
  const out = [await sha1Hex(rom)];
  if (rom.length < GBA_ROM_SIZE && rom.length >= 0x100000) {
    const padded = new Uint8Array(GBA_ROM_SIZE).fill(0xff);
    padded.set(rom);
    out.push(await sha1Hex(padded));
  } else if (rom.length > GBA_ROM_SIZE && rom.subarray(GBA_ROM_SIZE).every((b) => b === 0xff)) {
    out.push(await sha1Hex(rom.subarray(0, GBA_ROM_SIZE)));
  }
  return out;
}

export function matchPatches(items, sha1s) {
  const out = [];
  for (const item of items) {
    const parent = item.parents.find((p) => sha1s.includes(p.sha1));
    if (parent) out.push({ item, parent });
  }
  return out;
}

export const feedOfIndex = (index, id) => new URL(`${id}/latest.json`, index.url).href;

export async function offersFor(list, index, matches) {
  const offers = [];
  for (const { item, parent } of matches) {
    let feed;
    try {
      feed = await indexedFeed(list, item.id, { key: index.key, feed: feedOfIndex(index, item.id) });
    } catch {
      continue;
    }
    const target = item.install === "full" ? (feed.full ? { version: feed.version, wgbp: feed.full, wgba: feed.wgba } : null) : item.install;
    if (!target) continue;
    const plan = planUpdate(feed, target.wgba.sha1);
    const steps = plan.kind === "patch" ? plan : null;
    offers.push({ id: item.id, name: item.name, file: item.file, parent, feed, target, steps, version: steps || plan.kind === "latest" ? feed.version : target.version, size: target.wgbp.size + (steps ? steps.size : 0) });
  }
  return offers;
}

export async function patchList(index, { cache, memory = null, fetchImpl = globalThis.fetch, timeout = PATCH_OPEN_TIMEOUT } = {}) {
  let timer = null;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ list: null, error: new UpdateError("indexBad", { why: "timeout" }) }), timeout);
  });
  try {
    const got = await Promise.race([loadIndex(index, { fetchImpl, timeout, cache, memory }), late]);
    if (!got?.list) return { list: null, items: [], error: got?.error ?? null };
    return { list: got.list, items: readPatches(got.list.patches, index.url), error: null };
  } catch (error) {
    return { list: null, items: [], error };
  } finally {
    clearTimeout(timer);
  }
}

export async function installOffer(offer, rom, { build, apply, fetchImpl = globalThis.fetch, signal = null, onProgress = () => {} } = {}) {
  const { target, feed, steps } = offer;
  const end = steps ? PATCH_GAUGE.chained : PATCH_GAUGE.built;
  onProgress({ stage: "download", fraction: 0 });
  const patch = await fetchChecked(target.wgbp, { fetchImpl, signal, onProgress: (got, total) => onProgress({ stage: "download", fraction: (got / total) * PATCH_GAUGE.download }) });
  if (signal?.aborted) throw new UpdateError("cancelled");
  onProgress({ stage: "rom", fraction: PATCH_GAUGE.download });
  const made = await build(patch, rom, (stage, fraction) => onProgress({ stage: "rom", fraction: PATCH_GAUGE.download + (end - PATCH_GAUGE.download) * spanOf(BUILD_SPANS, stage, fraction) }));
  if (made.sha1 !== target.wgba.sha1) throw new UpdateError("fullMismatch");
  if (signal?.aborted) throw new UpdateError("cancelled");
  if (!steps) return { bytes: made.wgba, version: target.version, sha1: made.sha1, base: made.base, updateError: null };
  try {
    onProgress({ stage: "update", fraction: end });
    const bytes = await runSteps(made.wgba, steps, feed, { fetchImpl, signal, apply, onProgress: (fraction) => onProgress({ stage: "update", fraction: end + (PATCH_GAUGE.built - end) * Math.min(1, fraction / 0.99) }) });
    return { bytes, version: feed.version, sha1: feed.wgba.sha1, base: made.base, updateError: null };
  } catch (error) {
    if (signal?.aborted || error?.code === "cancelled") throw new UpdateError("cancelled");
    return { bytes: made.wgba, version: target.version, sha1: made.sha1, base: made.base, updateError: error };
  }
}

export function readSkip(value) {
  return Array.isArray(value) ? value.filter((sha1) => SHA1_RE.test(sha1)).slice(-PATCH_SKIP_MAX) : [];
}

export function addSkip(value, sha1) {
  const list = readSkip(value).filter((item) => item !== sha1);
  if (SHA1_RE.test(sha1)) list.push(sha1);
  return list.slice(-PATCH_SKIP_MAX);
}
