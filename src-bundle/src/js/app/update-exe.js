import { buildGauge, checkGames, createVersionCache, FEED_INDEX, fetchChecked, GAUGE, newerVersion, planUpdate, prefetchFeeds, readOverrides, runSteps, UpdateError } from "../core/wgba-update.js";
import { applyInWorker, updateErrorText, updatePicker } from "./update-pick.js";
import { runPatchJob } from "./patch-loader.js";
import { readWgba, pickText } from "../core/wgba-read.js";
import { readTocFrom, unpackChunk } from "../core/wgba-format.js";
import { sha1Hex } from "../core/wgbp.js";

const INDEX_MAX = 64;
const DONE_MS = 600;
// 업데이트 확인·롬 가져오기 등록 확인 대상 = 같은 Pack 형식의 게임 파일(.wgba · .wmba 모바일 · .wapk Android)
const PACK_FILE_RE = /\.(wgba|wmba|wapk)$/i;

export function createExeUpdater(d) {
  const { t } = d;
  const items = new Map();
  const urls = [];
  const feeds = d.cache ?? new Map();
  const versions = d.versions ?? createVersionCache();
  const notified = new Map();
  let checked = false;
  let shown = null;
  let flow = null;
  const keyOf = (path) => path.replace(/\//g, "\\").toLowerCase();
  const overrides = () => (d.testMode() ? readOverrides() : null);

  const pending = (path) => {
    const item = path ? items.get(keyOf(path)) : null;
    return item && (item.state === "ready" || item.state === "failed") && item.kind !== "none" ? item : null;
  };

  async function manifestOf(bytes) {
    const toc = await readTocFrom(bytes);
    const entry = toc?.entries.find((e) => e.name === "manifest");
    if (!entry) return null;
    try {
      return JSON.parse(new TextDecoder().decode(unpackChunk(bytes.subarray(entry.start, entry.end), entry)));
    } catch {
      return null;
    }
  }

  async function describe(path, cache) {
    let stat;
    try {
      stat = await d.core.fileStat(path);
    } catch {
      return null;
    }
    const hit = cache[keyOf(path)];
    if (hit && hit.size === stat.size && hit.modified === stat.modified) return { ...hit, path };
    let bytes;
    try {
      bytes = await d.core.fileReadBytes(path);
    } catch {
      return null;
    }
    const m = await manifestOf(bytes).catch(() => null);
    const entry = { size: stat.size, modified: stat.modified, gameId: m?.id ?? "", version: m?.version ?? "", update: m?.update ?? null, name: m?.name ?? "" };
    cache[keyOf(path)] = entry;
    return { ...entry, path };
  }

  function prepare() {
    if (checked || navigator.onLine === false) return;
    const games = Object.values(d.prefs().updateIndex ?? {}).map((entry) => ({ gameId: entry.gameId, version: entry.version, update: entry.update }));
    prefetchFeeds(games, { overrides: overrides(), cache: feeds });
  }

  const remember = () => versions.rememberIndex({ index: overrides()?.index ?? FEED_INDEX, cache: feeds, log: d.log });

  function rememberList(list) {
    const count = versions.rememberList(list);
    d.log("INFO", `업데이트 버전 캐시 갱신 · 롬 가져오기 목록 게임 ${count}개`);
    return count;
  }

  function labelOf(wgba) {
    const image = wgba?.images?.label;
    if (!image) return null;
    const label = { url: URL.createObjectURL(new Blob([image.bytes], { type: `image/${image.format}` })), width: image.width, height: image.height };
    urls.push(label.url);
    return label;
  }

  async function check(paths) {
    if (checked) return 0;
    checked = true;
    if (navigator.onLine === false) return 0;
    const old = d.prefs().updateIndex ?? {};
    const cache = {};
    const seen = new Set();
    const games = [];
    for (const path of paths) {
      if (!PACK_FILE_RE.test(path) || seen.has(keyOf(path))) continue;
      seen.add(keyOf(path));
      if (old[keyOf(path)]) cache[keyOf(path)] = old[keyOf(path)];
      const info = await describe(path, cache);
      if (info?.gameId && info.version) games.push({ key: keyOf(path), gameId: info.gameId, version: info.version, update: info.update, info });
      if (games.length >= INDEX_MAX) break;
    }
    d.savePrefs({ updateIndex: Object.fromEntries(Object.entries(cache).slice(-INDEX_MAX)) });
    const found = await checkGames(games, { overrides: overrides(), log: d.log, cache: feeds, onFeed: versions.keepFeed });
    for (const { game, feed } of found) {
      if (items.has(game.key)) continue;
      let bytes;
      try {
        bytes = await d.core.fileReadBytes(game.info.path);
      } catch {
        continue;
      }
      const sha1 = await sha1Hex(bytes);
      const plan = planUpdate(feed, sha1);
      if (plan.kind === "latest") continue;
      if (plan.kind === "none") {
        d.log("INFO", `업데이트 경로 없음(표시 안 함) ${game.gameId} ${game.version} → ${feed.version} SHA-1 ${sha1.slice(0, 8)} ${game.info.path}`);
        continue;
      }
      let label = null;
      try {
        label = labelOf(await readWgba(bytes));
      } catch {
        label = null;
      }
      items.set(game.key, { key: game.key, path: game.info.path, gameId: game.gameId, names: game.info.name, feed, plan, label, name: "", from: game.version, to: feed.version, kind: plan.kind, size: plan.size, state: "ready", stage: "", fraction: 0, reason: "", running: false });
      d.log("INFO", `업데이트 있음 ${game.gameId} ${game.version} → ${feed.version} (${plan.kind}${plan.steps.length ? ` ${plan.steps.length}단계` : ""} ${plan.size}바이트) ${game.info.path}`);
    }
    if (!items.size) return 0;
    d.refresh();
    if (flow) await flow;
    await open();
    return items.size;
  }

  async function writeVerified(item, out) {
    await d.core.fileWriteBytes(item.path, out);
    const back = await d.core.fileReadBytes(item.path);
    if ((await sha1Hex(back)) !== item.feed.wgba.sha1) throw new UpdateError("deltaResult");
    item.from = item.to;
    d.status(t("update.status.done", { name: item.name, version: item.to }));
    d.refresh();
  }

  async function applyOne(item, progress, signal = null) {
    const bytes = await d.core.fileReadBytes(item.path);
    const plan = planUpdate(item.feed, await sha1Hex(bytes));
    if (plan.kind !== "patch") throw new UpdateError("changed");
    const out = await runSteps(bytes, plan, item.feed, {
      signal,
      onProgress: (fraction, stage) => progress({ stage: stage === "download" ? "download" : "apply", fraction }),
      apply: (source, delta, options) => applyInWorker(source, delta, options),
    });
    if (signal?.aborted) throw new UpdateError("cancelled");
    await writeVerified(item, out);
    progress({ stage: "apply", fraction: 1 });
    d.log("INFO", `업데이트 완료 ${item.gameId} ${plan.steps.length}단계 → ${item.to} ${item.path}`);
    return true;
  }

  async function installOne(item, progress, signal = null) {
    const rom = await d.pickRom(item);
    if (!rom) return false;
    progress({ stage: "download", fraction: 0 });
    const patch = await fetchChecked(item.feed.full, { signal, onProgress: (got, total) => progress({ stage: "download", fraction: (got / total) * GAUGE.download }) });
    progress({ stage: "rom", fraction: GAUGE.download });
    let made;
    try {
      made = await runPatchJob(patch, await d.readRom(rom), (stage, fraction) => progress({ stage: "rom", fraction: buildGauge(stage, fraction) }));
    } catch (error) {
      throw new Error(d.patchText(error, rom));
    }
    if (made.sha1 !== item.feed.wgba.sha1) throw new UpdateError("fullMismatch");
    if (signal?.aborted) throw new UpdateError("cancelled");
    await writeVerified(item, made.wgba);
    progress({ stage: "rom", fraction: 1 });
    d.log("INFO", `업데이트 전체 설치 ${item.gameId} → ${item.to} ${item.path} (${rom})`);
    return true;
  }

  const guard = (work) => async (item, progress, signal) => {
    try {
      return await work(item, progress, signal);
    } catch (error) {
      if (error?.code === "cancelled") d.log("INFO", `업데이트 취소 ${item.gameId} ${item.from} → ${item.to} ${item.path}`);
      else d.log("WARN", `업데이트 실패 ${item.gameId} ${item.from} → ${item.to} ${item.path}: ${error?.code ?? ""} ${error?.message ?? error}`);
      throw new Error(updateErrorText(error));
    }
  };

  function art(item) {
    if (!item.label) return null;
    const img = document.createElement("img");
    img.className = "upick__img";
    img.alt = "";
    img.draggable = false;
    img.width = item.label.width;
    img.height = item.label.height;
    img.src = item.label.url;
    return img;
  }

  const rowButton = (onClick) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "btn";
    node.dataset.action = "update-row";
    node.append(Object.assign(document.createElement("span"), { className: "upick__label" }));
    node.addEventListener("click", onClick);
    return node;
  };
  const ROW_KINDS = { primary: "btn--go", warn: "btn--warn", plain: "" };

  async function open(keys = null, { start = false } = {}) {
    const list = [...items.values()].filter((item) => (keys ? keys.includes(item.key) : item.state !== "done" && notified.get(item.key) !== item.to));
    if (!list.length) return null;
    for (const item of list) {
      item.running = d.running(item.path);
      item.name = pickText(item.names, d.lang()) || d.baseOf(item.path);
      notified.set(item.key, item.to);
    }
    let later = null;
    let go = null;
    const picker = updatePicker({
      items: list,
      art,
      button: rowButton,
      kinds: ROW_KINDS,
      apply: guard(applyOne),
      install: guard(installOne),
      stop: async (item) => {
        await d.closeGame();
        return !d.running(item.path);
      },
      onChange: ({ chosen, busy, left, total }) => {
        if (!go) return;
        go.disabled = busy || chosen === 0;
        later.disabled = busy;
        const done = left === 0 || (!busy && total === 0 && list.every((item) => item.state !== "ready"));
        later.textContent = done ? "CLOSE" : "LATER";
      },
    });
    const asked = d.openDialog({
      title: t("update.title", { count: list.length }),
      body: [t("update.text"), picker.node],
      kind: "pick",
      actions: [
        { label: "LATER", value: false },
        { label: "UPDATE", go: true, run: () => picker.runChosen() },
      ],
    });
    [later, go] = d.el.dialogActions.children;
    picker.refresh();
    window.addEventListener("resize", picker.center);
    shown = picker;
    asked.then(() => {
      window.removeEventListener("resize", picker.center);
      if (shown === picker) shown = null;
      d.refresh();
    });
    if (start) picker.run(list.filter((item) => item.kind === "patch" && !item.running && item.state !== "done"));
    return picker;
  }

  function ask(item) {
    item.running = false;
    item.name = pickText(item.names, d.lang()) || d.baseOf(item.path);
    let left = null;
    let go = null;
    let abort = null;
    let pending = null;
    let stopping = false;
    let closing = false;
    const close = (value) => {
      if (closing) return;
      closing = true;
      d.closeDialog(value);
    };
    const track = (work) => (target, progress) => {
      const controller = new AbortController();
      abort = controller;
      pending = work(target, progress, controller.signal).finally(() => {
        if (abort === controller) abort = null;
      });
      return pending;
    };
    const picker = updatePicker({
      items: [item],
      art,
      button: rowButton,
      kinds: ROW_KINDS,
      apply: track(guard(applyOne)),
      install: track(guard(installOne)),
      stop: async () => true,
      onChange: ({ busy }) => {
        if (!go) return;
        const done = !busy && item.state === "done";
        if (!busy && (stopping || done)) {
          left.disabled = true;
          go.disabled = true;
          if (stopping) close(done);
          else setTimeout(() => close(true), DONE_MS);
          return;
        }
        go.disabled = busy;
        left.disabled = stopping;
        left.textContent = busy ? "CANCEL" : "LATER";
      },
    });
    picker.node.classList.add("upick--single");
    const cancel = () => {
      if (!picker.busy) return close(false);
      stopping = true;
      left.disabled = true;
      abort?.abort();
    };
    const answer = d.openDialog({
      title: t("update.open.title"),
      body: [t(item.kind === "full" ? "update.open.full" : "update.open.text"), picker.node],
      kind: "pick",
      actions: [
        { label: "LATER", run: cancel },
        { label: "UPDATE", go: true, run: () => picker.run([item]) },
      ],
    });
    [left, go] = d.el.dialogActions.children;
    picker.refresh();
    window.addEventListener("resize", picker.center);
    shown = picker;
    const result = answer.then(async (value) => {
      window.removeEventListener("resize", picker.center);
      if (shown === picker) shown = null;
      if (picker.busy) {
        stopping = true;
        abort?.abort();
        await pending?.catch(() => {});
        await null;
      }
      d.refresh();
      const updated = value === true || item.state === "done";
      d.log("INFO", updated ? `파일 열기 전 업데이트 완료 → 새 파일로 실행 ${item.gameId} ${item.to} ${item.path}` : `파일 열기 전 업데이트 안 함 → 현재 버전으로 실행 ${item.gameId} ${item.from} ${item.path}`);
      return updated;
    });
    if (item.kind === "patch") picker.run([item]);
    return result;
  }

  async function beforeOpen(path, wgba, bytes) {
    const m = wgba?.manifest;
    if (!m?.id || !m.version) return false;
    if (shown || d.dialogOpen() || navigator.onLine === false) {
      d.log("INFO", `파일 열기 전 업데이트 확인 건너뜀(${navigator.onLine === false ? "오프라인" : "다른 창 표시 중"}) ${m.id} ${m.version} ${path}`);
      return false;
    }
    const game = { gameId: m.id, version: m.version, update: m.update && typeof m.update === "object" ? { feed: String(m.update.feed ?? ""), key: String(m.update.key ?? "") } : null };
    const work = (async () => {
      const got = await versions.newerFor(game, { overrides: overrides(), cache: feeds, log: d.log });
      if (!got.feed) {
        if (got.why !== "source" && got.why !== "cache" && got.why !== "memory") d.log("INFO", `파일 열기 전 업데이트 확인 · 새 버전 정보 없음(${got.why}) ${m.id} ${m.version} ${path}`);
        return false;
      }
      const key = keyOf(path);
      if (notified.get(key) === got.feed.version) {
        d.log("INFO", `파일 열기 전 업데이트 · 이번 실행에서 이미 안내함 ${m.id} ${m.version} → ${got.feed.version} ${path}`);
        return false;
      }
      const sha1 = await sha1Hex(bytes);
      const plan = planUpdate(got.feed, sha1);
      if (plan.kind === "latest") return false;
      if (plan.kind === "none") {
        d.log("INFO", `업데이트 경로 없음(표시 안 함) ${m.id} ${m.version} → ${got.feed.version} SHA-1 ${sha1.slice(0, 8)} ${path}`);
        return false;
      }
      const item = { key, path, gameId: m.id, names: m.name, feed: got.feed, plan, label: items.get(key)?.label ?? labelOf(wgba), name: "", from: m.version, to: got.feed.version, kind: plan.kind, size: plan.size, state: "ready", stage: "", fraction: 0, reason: "", running: false };
      items.set(key, item);
      notified.set(key, item.to);
      d.log("INFO", `파일 열기 전 업데이트 있음 ${m.id} ${m.version} → ${got.feed.version} (${plan.kind}${plan.steps.length ? ` ${plan.steps.length}단계` : ""} ${plan.size}바이트 · 버전 정보 ${got.why}) ${path}`);
      d.refresh();
      return ask(item);
    })();
    const mine = work.catch(() => false);
    flow = mine;
    try {
      return await work;
    } catch (error) {
      d.log("WARN", `파일 열기 전 업데이트 확인 실패 ${m.id} ${m.version} ${path}: ${error?.code ?? ""} ${error?.message ?? error}`);
      return false;
    } finally {
      if (flow === mine) flow = null;
    }
  }

  /** 경로들의 게임 파일(.wgba · .wmba · .wapk) 게임 id(설명서 조회 캐시 updateIndex 재사용 — 바뀐 파일만 읽음). */
  async function games(paths) {
    const cache = { ...(d.prefs().updateIndex ?? {}) };
    const before = JSON.stringify(cache);
    const found = new Map();
    const seen = new Set();
    for (const path of paths) {
      if (!PACK_FILE_RE.test(path) || seen.has(keyOf(path))) continue;
      seen.add(keyOf(path));
      const info = await describe(path, cache);
      if (!info?.gameId) continue;
      const had = found.get(info.gameId);
      if (!had || newerVersion(info.version, had.version)) found.set(info.gameId, { path: info.path, version: info.version });
    }
    if (JSON.stringify(cache) !== before) d.savePrefs({ updateIndex: Object.fromEntries(Object.entries(cache).slice(-INDEX_MAX)) });
    return found;
  }

  const ids = async (paths) => new Set((await games(paths)).keys());

  const patchIndex = () => (navigator.onLine === false ? null : (overrides()?.index ?? FEED_INDEX));

  return {
    prepare,
    remember,
    rememberList,
    check,
    open,
    beforeOpen,
    idle: () => flow ?? Promise.resolve(false),
    pending,
    keyOf,
    ids,
    games,
    patchIndex,
    feeds,
    versions,
    get items() {
      return items;
    },
    get showing() {
      return Boolean(shown);
    },
  };
}
