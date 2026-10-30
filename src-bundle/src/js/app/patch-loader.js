import { buildGame, readPatch, WgbpError } from "../core/wgbp.js";
import { t } from "../shell/i18n.js";

const WEIGHTS = { check: 8, patch: 40, verify: 12, pack: 30, write: 6, store: 6, open: 4 };

const clock = (ms) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function openLoader({ title, stages, buttonClass = "btn btn--primary" }) {
  const started = performance.now();
  const total = stages.reduce((sum, stage) => sum + (WEIGHTS[stage] ?? 1), 0);
  const root = el("div", "loader");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  const card = el("div", "loader__card");
  const head = el("h3", "loader__title", title);
  const list = el("ol", "loader__steps");
  const rows = new Map();
  for (const stage of stages) {
    const row = el("li", "loader__step");
    row.dataset.stage = stage;
    row.dataset.state = "wait";
    row.append(el("span", "loader__mark"), el("span", "loader__label", t(`loader.step.${stage}`)));
    rows.set(stage, row);
    list.append(row);
  }
  const bar = el("div", "loader__bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const fill = el("span", "loader__fill");
  bar.append(fill);
  const meta = el("div", "loader__meta");
  const percent = el("span", "loader__percent", "0%");
  const time = el("span", "loader__time", t("loader.elapsed", { time: clock(0) }));
  meta.append(percent, time);
  const error = el("p", "loader__error");
  error.hidden = true;
  const actions = el("div", "loader__actions");
  actions.hidden = true;
  const close = el("button", buttonClass, "CLOSE");
  close.type = "button";
  actions.append(close);
  card.append(head, list, bar, meta, error, actions);
  root.append(card);
  document.body.append(root);

  let current = "";
  let shown = 0;
  let finished = false;
  const timer = setInterval(() => {
    time.textContent = t("loader.elapsed", { time: clock(performance.now() - started) });
  }, 250);

  const set = (stage, fraction = 0) => {
    if (finished || !rows.has(stage)) return;
    const index = stages.indexOf(stage);
    stages.forEach((name, i) => {
      rows.get(name).dataset.state = i < index ? "done" : i === index ? "run" : "wait";
    });
    current = stage;
    const before = stages.slice(0, index).reduce((sum, name) => sum + (WEIGHTS[name] ?? 1), 0);
    const value = Math.max(shown, Math.min(100, ((before + (WEIGHTS[stage] ?? 1) * Math.max(0, Math.min(1, fraction))) / total) * 100));
    shown = value;
    fill.style.setProperty("--progress", (value / 100).toFixed(4));
    percent.textContent = `${Math.floor(value)}%`;
    bar.setAttribute("aria-valuenow", String(Math.floor(value)));
    root.dataset.stage = stage;
    root.dataset.percent = value.toFixed(1);
  };

  const stop = () => {
    finished = true;
    clearInterval(timer);
    time.textContent = t("loader.elapsed", { time: clock(performance.now() - started) });
  };

  const remove = () => {
    stop();
    root.remove();
  };

  return {
    element: root,
    set,
    get stage() {
      return current;
    },
    finish() {
      if (finished) return;
      for (const row of rows.values()) row.dataset.state = "done";
      fill.style.setProperty("--progress", "1");
      percent.textContent = "100%";
      root.dataset.percent = "100";
      root.dataset.state = "done";
      stop();
      setTimeout(remove, 350);
    },
    fail(text, stage = current) {
      const row = rows.get(stage);
      if (row) row.dataset.state = "fail";
      stop();
      root.dataset.state = "fail";
      error.textContent = t("loader.failed", { step: t(`loader.step.${stage || stages[0]}`), reason: text });
      error.hidden = false;
      actions.hidden = false;
      close.focus({ preventScroll: true });
      return new Promise((resolve) => {
        close.addEventListener(
          "click",
          () => {
            remove();
            resolve();
          },
          { once: true },
        );
      });
    },
    close: remove,
  };
}

async function runInline(patchBytes, romBytes, onProgress) {
  const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 0));
  let last = 0;
  return buildGame(readPatch(patchBytes), romBytes, {
    onStep: yieldFrame,
    onProgress: (stage, fraction) => {
      const now = performance.now();
      if (fraction > 0 && fraction < 1 && now - last < 40) return;
      last = now;
      onProgress(stage, fraction);
    },
  });
}

export function runPatchJob(patchBytes, romBytes, onProgress = () => {}) {
  let worker = null;
  try {
    worker = new Worker(new URL("../core/patch-worker.js", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  if (!worker) return runInline(patchBytes, romBytes, onProgress);
  return new Promise((resolve, reject) => {
    let heard = false;
    worker.onmessage = (event) => {
      heard = true;
      const message = event.data;
      if (message.type === "progress") onProgress(message.stage, message.fraction);
      else if (message.type === "done") {
        worker.terminate();
        resolve({ wgba: message.wgba, sha1: message.sha1, base: message.base, same: message.same });
      } else if (message.type === "error") {
        worker.terminate();
        reject(message.wgbp ? new WgbpError(message.code, message.params) : new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      worker.terminate();
      if (!heard) runInline(patchBytes, romBytes, onProgress).then(resolve, reject);
      else reject(new Error(event.message || "worker"));
    };
    const patch = patchBytes.slice();
    const rom = romBytes.slice();
    worker.postMessage({ patch: patch.buffer, rom: rom.buffer }, [patch.buffer, rom.buffer]);
  });
}
