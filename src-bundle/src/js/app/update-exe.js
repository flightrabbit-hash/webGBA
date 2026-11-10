import { buildGauge, checkGames, fetchChecked, GAUGE, planUpdate, prefetchFeeds, readOverrides, runSteps, UpdateError } from "../core/wgba-update.js";
import { applyInWorker, updateErrorText, updatePicker } from "./update-pick.js";
import { runPatchJob } from "./patch-loader.js";
import { readWgba, pickText } from "../core/wgba-read.js";
import { readTocFrom, unpackChunk } from "../core/wgba-format.js";
import { sha1Hex } from "../core/wgbp.js";

const INDEX_MAX = 64;

export function createExeUpdater(d) {
  const { t } = d;
  const items = new Map();
  const urls = [];
  const feeds = d.cache ?? new Map();
  let checked = false;
  let shown = null;
  const keyOf = (path) => path.replace(/\//g, "\\").toLowerCase();

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
    prefetchFeeds(games, { overrides: d.testMode() ? readOverrides() : null, cache: feeds });
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
      if (!/\.wgba$/i.test(path) || seen.has(keyOf(path))) continue;
      seen.add(keyOf(path));
      if (old[keyOf(path)]) cache[keyOf(path)] = old[keyOf(path)];
      const info = await describe(path, cache);
      if (info?.gameId && info.version) games.push({ key: keyOf(path), gameId: info.gameId, version: info.version, update: info.update, info });
      if (games.length >= INDEX_MAX) break;
    }
    d.savePrefs({ updateIndex: Object.fromEntries(Object.entries(cache).slice(-INDEX_MAX)) });
    const found = await checkGames(games, { overrides: d.testMode() ? readOverrides() : null, log: d.log, cache: feeds });
    for (const { game, feed } of found) {
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
        const wgba = await readWgba(bytes);
        if (wgba?.images.label) label = { url: URL.createObjectURL(new Blob([wgba.images.label.bytes], { type: `image/${wgba.images.label.format}` })), width: wgba.images.label.width, height: wgba.images.label.height };
      } catch {
        label = null;
      }
      if (label) urls.push(label.url);
      items.set(game.key, { key: game.key, path: game.info.path, gameId: game.gameId, names: game.info.name, feed, plan, label, name: "", from: game.version, to: feed.version, kind: plan.kind, size: plan.size, state: "ready", stage: "", fraction: 0, reason: "", running: false });
      d.log("INFO", `업데이트 있음 ${game.gameId} ${game.version} → ${feed.version} (${plan.kind}${plan.steps.length ? ` ${plan.steps.length}단계` : ""} ${plan.size}바이트) ${game.info.path}`);
    }
    if (!items.size) return 0;
    d.refresh();
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

  async function applyOne(item, progress) {
    const bytes = await d.core.fileReadBytes(item.path);
    const plan = planUpdate(item.feed, await sha1Hex(bytes));
    if (plan.kind !== "patch") throw new UpdateError("changed");
    const out = await runSteps(bytes, plan, item.feed, {
      onProgress: (fraction, stage) => progress({ stage: stage === "download" ? "download" : "apply", fraction }),
      apply: (source, delta, options) => applyInWorker(source, delta, options),
    });
    await writeVerified(item, out);
    progress({ stage: "apply", fraction: 1 });
    d.log("INFO", `업데이트 완료 ${item.gameId} ${plan.steps.length}단계 → ${item.to} ${item.path}`);
    return true;
  }

  async function installOne(item, progress) {
    const rom = await d.pickRom(item);
    if (!rom) return false;
    progress({ stage: "download", fraction: 0 });
    const patch = await fetchChecked(item.feed.full, { onProgress: (got, total) => progress({ stage: "download", fraction: (got / total) * GAUGE.download }) });
    progress({ stage: "rom", fraction: GAUGE.download });
    let made;
    try {
      made = await runPatchJob(patch, await d.readRom(rom), (stage, fraction) => progress({ stage: "rom", fraction: buildGauge(stage, fraction) }));
    } catch (error) {
      throw new Error(d.patchText(error, rom));
    }
    if (made.sha1 !== item.feed.wgba.sha1) throw new UpdateError("fullMismatch");
    await writeVerified(item, made.wgba);
    progress({ stage: "rom", fraction: 1 });
    d.log("INFO", `업데이트 전체 설치 ${item.gameId} → ${item.to} ${item.path} (${rom})`);
    return true;
  }

  const guard = (work) => async (item, progress) => {
    try {
      return await work(item, progress);
    } catch (error) {
      d.log("WARN", `업데이트 실패 ${item.gameId} ${item.from} → ${item.to} ${item.path}: ${error?.code ?? ""} ${error?.message ?? error}`);
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

  async function open(keys = null, { start = false } = {}) {
    const list = [...items.values()].filter((item) => (keys ? keys.includes(item.key) : item.state !== "done"));
    if (!list.length) return null;
    for (const item of list) {
      item.running = d.running(item.path);
      item.name = pickText(item.names, d.lang()) || d.baseOf(item.path);
    }
    let later = null;
    let go = null;
    const picker = updatePicker({
      items: list,
      art,
      button: (onClick) => {
        const node = document.createElement("button");
        node.type = "button";
        node.className = "btn";
        node.dataset.action = "update-row";
        node.append(Object.assign(document.createElement("span"), { className: "upick__label" }));
        node.addEventListener("click", onClick);
        return node;
      },
      kinds: { primary: "btn--go", warn: "btn--warn", plain: "" },
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

  return {
    prepare,
    check,
    open,
    pending,
    keyOf,
    get items() {
      return items;
    },
    get showing() {
      return Boolean(shown);
    },
  };
}
