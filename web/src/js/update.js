import { buildGauge, checkGames, fetchChecked, GAUGE, indexGroups, planUpdate, readOverrides, runSteps, UpdateError } from "./core/wgba-update.js";
import { applyInWorker, updateErrorText, updatePicker } from "./app/update-pick.js";
import { runPatchJob } from "./app/patch-loader.js";
import { sha1Hex } from "./core/wgbp.js";

export function createUpdater(d) {
  const { t } = d;
  const items = new Map();
  let checked = false;
  let gathered = null;
  let shown = null;
  const cache = new Map();

  const pending = (key) => {
    const item = items.get(key);
    return item && (item.state === "ready" || item.state === "failed") && item.kind !== "none" ? item : null;
  };

  async function sha1Of(rom) {
    if (rom.sha1) return rom.sha1;
    const bytes = await d.store.bytes(rom.key);
    if (!bytes) return "";
    const sha1 = await sha1Hex(bytes);
    d.store.patch(rom.key, { sha1 }).catch(() => {});
    return sha1;
  }

  async function gather(ready) {
    if (navigator.onLine === false) return [];
    let roms = [];
    try {
      roms = await d.store.list(d.store.KIND_ROM);
    } catch {
      return [];
    }
    const games = roms.filter((rom) => rom.gameId && rom.version).map((rom) => ({ key: rom.key, gameId: rom.gameId, version: rom.version, update: rom.update, rom }));
    const found = await checkGames(games, { overrides: readOverrides(), log: d.log, cache });
    if (roms.some((rom) => rom.gameId)) groups().then((table) => table && d.groups?.(table));
    if (found.some(({ game }) => !game.rom.sha1)) await ready;
    const out = [];
    for (const { game, feed } of found) {
      let sha1 = "";
      try {
        sha1 = await sha1Of(game.rom);
      } catch {
        sha1 = "";
      }
      out.push({ game, feed, sha1 });
    }
    return out;
  }

  function groups() {
    if (navigator.onLine === false) return Promise.resolve(null);
    return indexGroups({ overrides: readOverrides(), cache });
  }

  function prepare({ ready = Promise.resolve() } = {}) {
    if (!gathered) gathered = gather(ready).catch((error) => {
      d.log("WARN", `업데이트 확인 실패: ${error?.message ?? error}`);
      return [];
    });
    return gathered;
  }

  async function check() {
    if (checked) return 0;
    checked = true;
    for (const { game, feed, sha1 } of await prepare()) {
      const plan = planUpdate(feed, sha1);
      if (plan.kind === "latest") continue;
      if (plan.kind === "none") {
        d.log("INFO", `업데이트 경로 없음(표시 안 함) ${game.gameId} ${game.rom.version} → ${feed.version} SHA-1 ${sha1.slice(0, 8)}`);
        continue;
      }
      items.set(game.key, { key: game.key, rom: game.rom, feed, plan, name: d.displayName(game.rom), from: game.rom.version, to: feed.version, kind: plan.kind, size: plan.size, state: "ready", stage: "", fraction: 0, reason: "", running: false });
      d.log("INFO", `업데이트 있음 ${game.gameId} ${game.rom.version} → ${feed.version} (${plan.kind}${plan.steps.length ? ` ${plan.steps.length}단계` : ""} ${plan.size}바이트)`);
    }
    if (!items.size) return 0;
    d.refresh();
    await open();
    return items.size;
  }

  async function applyOne(item, progress) {
    const bytes = await d.store.bytes(item.key);
    if (!bytes) throw new Error(t("web.lib.missing"));
    const plan = planUpdate(item.feed, await sha1Hex(bytes));
    if (plan.kind !== "patch") throw new UpdateError("changed");
    const out = await runSteps(bytes, plan, item.feed, {
      onProgress: (fraction, stage) => progress({ stage: stage === "download" ? "download" : "apply", fraction }),
      apply: (source, delta, options) => applyInWorker(source, delta, options),
    });
    await d.importGame(item.rom.name, out, { sha1: item.feed.wgba.sha1, file: item.rom.file });
    progress({ stage: "apply", fraction: 1 });
    d.log("INFO", `업데이트 완료 ${item.rom.gameId} ${item.from} → ${item.to} (${plan.steps.length}단계)`);
    d.refresh();
    return true;
  }

  async function installOne(item, progress) {
    const files = await d.pickFile();
    const file = files?.[0];
    if (!file) return false;
    progress({ stage: "download", fraction: 0 });
    const patch = await fetchChecked(item.feed.full, { onProgress: (got, total) => progress({ stage: "download", fraction: (got / total) * GAUGE.download }) });
    progress({ stage: "rom", fraction: GAUGE.download });
    let made;
    try {
      made = await runPatchJob(patch, await d.readPatchRom(file), (stage, fraction) => progress({ stage: "rom", fraction: buildGauge(stage, fraction) }));
    } catch (error) {
      throw new Error(d.patchText(error, file.name));
    }
    if (made.sha1 !== item.feed.wgba.sha1) throw new UpdateError("fullMismatch");
    await d.importGame(item.rom.name, made.wgba, { sha1: made.sha1, file: item.rom.file });
    progress({ stage: "rom", fraction: 1 });
    d.log("INFO", `업데이트 전체 설치 ${item.rom.gameId} ${item.from} → ${item.to} (${file.name})`);
    d.refresh();
    return true;
  }

  const guard = (work) => async (item, progress) => {
    try {
      return await work(item, progress);
    } catch (error) {
      d.log("WARN", `업데이트 실패 ${item.rom.gameId} ${item.from} → ${item.to}: ${error?.code ?? ""} ${error?.message ?? error}`);
      throw new Error(updateErrorText(error));
    }
  };

  async function open(keys = null, { start = false } = {}) {
    const list = [...items.values()].filter((item) => (keys ? keys.includes(item.key) : item.state !== "done"));
    if (!list.length) return null;
    await d.prepareArt(list.map((item) => item.rom));
    for (const item of list) {
      item.running = d.runningKey() === item.key;
      if (item.state === "done") continue;
      item.name = d.displayName(item.rom);
    }
    let later = null;
    let go = null;
    const picker = updatePicker({
      items: list,
      art: (item) => d.packArt(item.rom),
      button: (onClick) => d.button({ label: " ", kind: "small", action: "update-row", onClick }),
      kinds: { primary: "btn--primary", warn: "btn--warn", plain: "" },
      apply: guard(applyOne),
      install: guard(installOne),
      stop: async () => {
        await d.closeGame();
        return !d.runningKey();
      },
      onChange: ({ chosen, total, busy, left }) => {
        if (!go) return;
        go.disabled = busy || chosen === 0;
        const label = chosen && chosen === total ? t("web.update.all") : t("web.update.chosen", { n: chosen });
        const node = go.querySelector(".btn__label") ?? go;
        if (node.textContent !== label) node.textContent = label;
        later.disabled = busy;
        const done = left === 0 || (!busy && total === 0 && list.every((item) => item.state !== "ready"));
        const text = done ? t("web.update.close") : t("web.update.later");
        const laterNode = later.querySelector(".btn__label") ?? later;
        if (laterNode.textContent !== text) laterNode.textContent = text;
        d.centerInk(d.el.dialog);
      },
    });
    const asked = d.openDialog({
      title: t("update.title", { count: list.length }),
      body: [t("update.text"), picker.node],
      kind: "pick",
      actions: [
        { label: t("web.update.later"), value: false, id: "update-later" },
        { label: t("web.update.all"), primary: true, id: "update-all", run: () => picker.runChosen() },
      ],
    });
    later = d.el.dialogActions.querySelector('[data-action="update-later"]');
    go = d.el.dialogActions.querySelector('[data-action="update-all"]');
    picker.refresh();
    picker.center();
    d.el.dialog.querySelector(".dialog__card")?.addEventListener("animationend", () => picker.center(), { once: true });
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
    groups,
    check,
    open,
    pending,
    get items() {
      return items;
    },
    get showing() {
      return Boolean(shown);
    },
  };
}
