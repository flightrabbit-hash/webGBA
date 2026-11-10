import { centerTexts, sizeText } from "./zip-pick.js";
import { applyDelta, UpdateError } from "../core/wgba-update.js";
import { t } from "../shell/i18n.js";

const ERROR_CODES = new Set(["feedSignature", "feedBad", "feedHttp", "feedFormat", "download", "downloadHttp", "downloadSize", "downloadHash", "deltaBad", "deltaVersion", "deltaSource", "deltaResult", "cancelled", "changed", "fullMismatch", "appFile"]);

export function updateErrorText(error) {
  if (error instanceof UpdateError && ERROR_CODES.has(error.code)) return t(`update.err.${error.code}`, { status: error.params?.status ?? "" });
  return String(error?.message ?? error);
}

export function applyInWorker(source, delta, { onProgress = () => {} } = {}) {
  let worker = null;
  try {
    worker = new Worker(new URL("../core/update-worker.js", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  if (!worker) return applyDelta(source, delta, { onProgress });
  return new Promise((resolve, reject) => {
    let heard = false;
    worker.onmessage = (event) => {
      heard = true;
      const message = event.data;
      if (message.type === "progress") onProgress(message.stage, message.fraction);
      else if (message.type === "done") {
        worker.terminate();
        resolve(new Uint8Array(message.bytes));
      } else if (message.type === "error") {
        worker.terminate();
        reject(message.update ? new UpdateError(message.code, message.params) : new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      worker.terminate();
      if (!heard) applyDelta(source, delta, { onProgress }).then(resolve, reject);
      else reject(new Error(event.message || "worker"));
    };
    const s = source.slice();
    const d = delta.slice();
    worker.postMessage({ source: s.buffer, delta: d.buffer }, [s.buffer, d.buffer]);
  });
}

export const UPDATE_TEXTS = ".upick__name, .upick__meta, .zpick__allLabel, .zpick__count, .upick__label";

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

const percent = (fraction) => Math.max(0, Math.min(100, Math.floor((fraction ?? 0) * 100)));

export function rowMeta(item) {
  if (item.state === "busy") return t(item.stage === "download" ? "update.row.download" : item.stage === "rom" ? "update.row.rom" : "update.row.apply", { percent: percent(item.fraction) });
  if (item.state === "done") return t("update.row.done", { version: item.to });
  if (item.state === "failed") return t("update.row.failed", { reason: item.reason || "?" });
  const versions = t("update.row.versions", { from: item.from, to: item.to });
  if (item.running) return t("update.row.running", { versions });
  if (item.kind === "full") return t("update.row.full", { versions, size: sizeText(item.size) });
  if (item.kind === "none") return t("update.row.none", { versions });
  return t("update.row.patch", { versions, size: sizeText(item.size) });
}

const usable = (item) => item.kind === "patch" && !item.running && (item.state === "ready" || item.state === "failed");

export function updatePicker({ items, art = () => null, button, kinds = {}, apply, install, stop, onChange = () => {}, metaOf = rowMeta, labelOf = null, listLabel = "", startOn = true }) {
  const root = make("div", button ? "zpick upick" : "zpick upick upick--bare");
  const box = () => {
    const node = make("span", "cbox");
    node.setAttribute("aria-hidden", "true");
    node.append(make("span", "cbox__mark"), make("span", "cbox__dash"));
    return node;
  };
  const tag = Math.random().toString(36).slice(2, 8);
  const all = make("div", "zpick__all");
  all.setAttribute("role", "checkbox");
  const allLabel = make("span", "zpick__allLabel", t("zip.pick.all"));
  allLabel.id = `upick-all-${tag}`;
  all.setAttribute("aria-labelledby", allLabel.id);
  const count = make("span", "zpick__count");
  all.append(box(), allLabel, count);
  const list = make("ul", "zpick__list upick__list");
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", listLabel || t("update.listLabel"));
  let busy = false;
  for (const item of items) item.on = startOn && usable(item);
  const rows = items.map((item, index) => {
    const li = make("li", "zpick__row upick__item");
    li.dataset.key = item.key;
    const row = make("span", "upick__check");
    row.setAttribute("role", "checkbox");
    row.append(box());
    const texts = make("span", "upick__text");
    const name = make("span", "zpick__name upick__name", item.name);
    name.id = `upick-${tag}-${index}`;
    row.setAttribute("aria-labelledby", name.id);
    const meta = make("span", "zpick__meta upick__meta");
    const foot = make("span", "upick__foot");
    const bar = make("span", "upick__bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    const fill = make("span", "upick__fill");
    bar.append(fill);
    const act = button ? button(() => onRow(item)) : null;
    if (act) {
      act.classList.add("upick__btn");
      foot.append(act);
    }
    foot.append(bar);
    texts.append(name, meta, foot);
    const picture = make("span", "upick__art");
    const drawn = art(item);
    if (drawn) picture.append(drawn);
    else picture.hidden = true;
    li.append(row, picture, texts);
    li.addEventListener("click", (event) => {
      if (event.target.closest(".upick__btn") || event.target.closest(".upick__check")) return;
      toggle(item);
    });
    list.append(li);
    return { li, row, meta, act, bar, fill, item };
  });
  root.append(all, list);

  const defaultLabel = (item) => {
    if (item.state === "busy" || item.state === "done" || item.kind === "none") return "";
    if (item.running) return t("update.btn.stop");
    if (item.kind === "full") return t("update.btn.full");
    if (item.state === "failed") return t("update.btn.retry");
    return t("update.btn.one");
  };
  const paint = () => {
    const choices = items.filter(usable);
    for (const { li, row, meta, act, bar, fill, item } of rows) {
      const can = usable(item);
      if (!can) item.on = false;
      row.setAttribute("aria-checked", String(Boolean(item.on)));
      row.setAttribute("aria-disabled", String(!can || busy));
      row.tabIndex = can && !busy ? 0 : -1;
      li.classList.toggle("is-off", !can || busy);
      li.dataset.state = item.state;
      meta.classList.toggle("zpick__meta--why", item.state === "failed");
      const text = metaOf(item);
      if (meta.textContent !== text) meta.textContent = text;
      if (act) {
        const label = (labelOf ?? defaultLabel)(item);
        act.hidden = !label;
        const labelNode = act.querySelector(".btn__label, .upick__label") ?? act;
        if (label && labelNode.textContent !== label) labelNode.textContent = label;
        act.disabled = busy;
        const kind = item.running ? "warn" : item.kind === "full" ? "plain" : "primary";
        for (const [name, cls] of Object.entries(kinds)) if (cls) act.classList.toggle(cls, name === kind);
      }
      bar.hidden = item.state !== "busy";
      fill.style.setProperty("--progress", (percent(item.fraction) / 100).toFixed(4));
      bar.setAttribute("aria-valuenow", String(percent(item.fraction)));
    }
    const chosen = items.filter((item) => item.on).length;
    all.setAttribute("aria-checked", chosen === 0 ? "false" : chosen === choices.length ? "true" : "mixed");
    all.setAttribute("aria-disabled", String(!choices.length || busy));
    all.tabIndex = choices.length && !busy ? 0 : -1;
    count.textContent = t("zip.pick.count", { n: chosen, total: choices.length });
    onChange({ chosen, total: choices.length, busy, left: items.filter((item) => item.state !== "done" && item.kind !== "none").length });
    centerTexts(root.querySelectorAll(UPDATE_TEXTS));
  };

  const progress = (item) => ({ stage, fraction }) => {
    item.stage = stage;
    item.fraction = Math.max(item.fraction ?? 0, Math.min(1, Number(fraction) || 0));
    const entry = rows.find((r) => r.item === item);
    const text = metaOf(item);
    if (entry.meta.textContent !== text) {
      entry.meta.textContent = text;
      centerTexts([entry.meta]);
    }
    entry.fill.style.setProperty("--progress", (percent(item.fraction) / 100).toFixed(4));
    entry.bar.setAttribute("aria-valuenow", String(percent(item.fraction)));
  };

  const runOne = async (item, work) => {
    item.state = "busy";
    item.stage = "download";
    item.fraction = 0;
    item.reason = "";
    paint();
    try {
      const result = await work(item, progress(item));
      item.state = result === false ? "ready" : "done";
      item.on = false;
    } catch (error) {
      item.state = "failed";
      item.reason = String(error?.message ?? error);
    }
  };

  const run = async (list) => {
    if (busy || !list.length) return;
    busy = true;
    try {
      for (const item of list) {
        busy = true;
        await runOne(item, item.kind === "full" ? install : apply);
      }
    } finally {
      busy = false;
      paint();
    }
  };

  const onRow = async (item) => {
    if (busy) return;
    if (item.running) {
      busy = true;
      paint();
      try {
        if (await stop(item)) item.running = false;
      } finally {
        busy = false;
        if (!item.running) item.on = usable(item);
        paint();
      }
      return;
    }
    if (item.state === "busy" || item.state === "done" || item.kind === "none") return;
    await run([item]);
  };

  const toggle = (item) => {
    if (busy || !usable(item)) return;
    item.on = !item.on;
    paint();
  };
  const toggleAll = () => {
    const choices = items.filter(usable);
    if (busy || !choices.length) return;
    const next = choices.some((item) => !item.on);
    for (const item of choices) item.on = next;
    paint();
  };
  const wire = (node, act) => {
    node.addEventListener("click", act);
    node.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) node.classList.add("is-down");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) act();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const order = [all, ...rows.flatMap((r) => [r.row, r.act])].filter((n) => n && n.tabIndex !== -1 && !n.hidden && !n.disabled);
        const at = order.indexOf(node);
        order[Math.max(0, Math.min(order.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
      }
    });
    node.addEventListener("keyup", (event) => {
      if (event.key !== " " && event.key !== "Spacebar") return;
      event.preventDefault();
      if (!node.classList.contains("is-down")) return;
      node.classList.remove("is-down");
      act();
    });
    node.addEventListener("blur", () => node.classList.remove("is-down"));
  };
  wire(all, toggleAll);
  for (const { row, item } of rows) wire(row, () => toggle(item));
  paint();

  return {
    node: root,
    items,
    get busy() {
      return busy;
    },
    chosen: () => items.filter((item) => item.on),
    runChosen: () => run(items.filter((item) => item.on)),
    run,
    refresh: paint,
    center: () => centerTexts(root.querySelectorAll(UPDATE_TEXTS)),
  };
}
