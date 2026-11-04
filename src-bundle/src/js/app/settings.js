import * as theme from "../shell/theme.js";
import { CHANGED as LANG_CHANGED, LANGS, lang, t } from "../shell/i18n.js";
import { AUTO_FIRE_LEVEL, AUTO_FIRE_RATES, codeOf, DPAD_DEFAULT, FRAME_MS, MACRO_FRAMES_MAX, MACRO_GAP, MACRO_HOLD, MACRO_KEYS, MACRO_NAME_MAX, MACRO_STEPS_MAX, macroFrameCount } from "./player.js";

const el = {};

const hooks = {
  snapshot: async () => ({}),
  apply: async () => {},
  setTheme: async () => {},
  setLang: async () => {},
  confirm: async () => false,
  keyName: (code) => code,
  keyOrder: [],
  defaultKeys: {},
  onClose: () => {},
};

let draft = null;

let keys = null;

let waiting = null;

let padWait = 0;

let rs = null;

const RS_ORDER = ["UP", "DOWN", "LEFT", "RIGHT", "A", "B", "C", "D", "L", "R", "SELECT", "START"];
const RS_ARROWS = { UP: "↑", DOWN: "↓", LEFT: "←", RIGHT: "→" };
const RS_GROUP = { A: "ab", B: "ab", C: "cd", D: "cd", L: "ss", R: "ss", SELECT: "ss", START: "ss", UP: "dir", DOWN: "dir", LEFT: "dir", RIGHT: "dir" };

let shown = "general";

let picked = { mode: "dark", colors: {} };

let recipe = { tone: "any", cast: "any" };

const fieldInputs = new Map();

const TABS = ["general", "keys", "theme", "language"];

const TAB_NOTE = {
  general: "cfg.headNote.save",
  keys: "cfg.headNote.save",
  theme: "cfg.headNote.live",
  language: "cfg.headNote.live",
};

const FIELDS = [
  {
    group: "screen",
    items: [
      { key: "scaleMode", type: "radio", default: "fit", options: ["fit", "integer"] },
      { key: "railCollapsed", default: false },
      { key: "pauseWhenHidden", default: false },
    ],
  },
  {
    group: "sound",
    items: [
      { key: "muted", default: false },
      { key: "volume", type: "number", min: 0, max: 100, default: 80 },
      { key: "fastMute", default: false },
    ],
  },
  {
    group: "game",
    items: [
      { key: "fastScale", type: "radio", default: 4, options: [2, 3, 4, 8] },
      { key: "dpadMode", type: "radio", default: DPAD_DEFAULT, options: ["both", "opposite", "latest"] },
      { key: "autoFire", default: false },
      { key: "autoFireLevel", type: "level", min: 1, max: AUTO_FIRE_RATES.length, default: AUTO_FIRE_LEVEL, requires: "autoFire" },
      { key: "slot", type: "number", min: 1, max: 9, default: 1 },
    ],
  },
  {
    group: "net",
    items: [
      { key: "netOn", default: true },
      { key: "netWan", default: false },
      { key: "netNick", type: "text", maxLength: 12, default: "" },
    ],
  },
  {
    group: "save",
    note: true,
    items: [],
  },
  {
    group: "files",
    items: [
      { key: "wgbaLink", default: true },
      { key: "webRom", type: "text", default: "" },
      { key: "favorites", type: "clear" },
      { key: "recent", type: "clear" },
    ],
  },
  {
    group: "develop",
    items: [{ key: "useDevelopKit", default: false }],
  },
];

const TOKEN_GROUPS = [
  { id: "surface", keys: ["--bg-sunken", "--bg", "--bg-tint", "--bg-raised", "--bg-hover", "--bg-active"] },
  { id: "lines", keys: ["--line", "--line-strong", "--line-soft", "--line-faint"] },
  { id: "text", keys: ["--text", "--text-dim", "--text-faint"] },
  { id: "meaning", keys: ["--accent", "--on", "--run", "--global", "--danger"] },
];

const reason = (error) => String(error?.message ?? error);


export function setup(options = {}) {
  Object.assign(hooks, options);
  const pick = (id) => document.getElementById(id);

  Object.assign(el, {
    modal: pick("settings-modal"),
    panel: pick("settings-panel"),
    tabs: Object.fromEntries(TABS.map((name) => [name, pick(`settings-tab-${name}`)])),
    pages: Object.fromEntries(TABS.map((name) => [name, pick(`settings-page-${name}`)])),
    body: pick("settings-body"),
    keys: pick("settings-keys"),
    keysGame: pick("settings-keys-game"),
    modes: pick("settings-modes"),
    colors: pick("settings-colors"),
    langs: pick("settings-langs"),
    headTitle: pick("settings-head-title"),
    headNote: pick("settings-head-note"),
    keysReset: pick("settings-keys-reset"),
    rs: pick("settings-rs"),
    note: pick("settings-note"),
    saveBtn: pick("settings-save"),
    closeBtn: pick("settings-close"),
  });

  for (const [name, button] of Object.entries(el.tabs)) button?.addEventListener("click", () => showTab(name));
  el.saveBtn.addEventListener("click", save);
  el.closeBtn.addEventListener("click", close);
  el.keysReset.addEventListener("click", resetKeys);
  window.addEventListener("keydown", onKey, true);
  document.addEventListener(LANG_CHANGED, () => {
    if (isOpen()) redraw();
  });
}

export const isOpen = () => Boolean(el.modal) && !el.modal.hidden;

export async function open(tab = "general") {
  note("");
  try {
    draft = await hooks.snapshot();
  } catch (error) {
    hooks.onError?.(reason(error));
    return;
  }
  keys = cloneKeys(draft.keys ?? defaultKeys());
  waiting = null;
  rs = cloneRs(draft.rs);
  picked ={ mode: draft.theme?.mode ?? "dark", colors: { ...(draft.theme?.colors ?? {}) } };
  redraw();
  showTab(TABS.includes(tab) ? tab : "general");
  el.modal.hidden = false;
  requestAnimationFrame(() => el.modal.classList.add("is-open"));
  el.tabs[shown]?.focus();
}

export function close() {
  if (!isOpen()) return;
  waiting = null;
  stopPadWait();
  el.modal.classList.remove("is-open");
  el.modal.hidden = true;
  hooks.onClose();
}

export function toggle(tab) {
  if (isOpen()) close();
  else open(tab);
}

function onKey(event) {
  if (!isOpen()) return;
  if (waiting) {
    event.preventDefault();
    event.stopPropagation();
    const pressed = codeOf(event);
    if (pressed !== "Escape" && pressed) assignKey(pressed);
    waiting = null;
    drawKeys();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
  }
}

function assignKey(code) {
  for (const name of keyOrder()) keys[name] = keys[name].filter((item) => item !== code);
  const list = keys[waiting.name];
  list[waiting.index] = code;
  keys[waiting.name] = list.filter(Boolean);
}

function stopPadWait() {
  cancelAnimationFrame(padWait);
  padWait = 0;
}

function waitPad() {
  stopPadWait();
  const pressedNow = () => {
    const out = new Set();
    for (const gp of navigator.getGamepads?.() ?? []) if (gp) gp.buttons.forEach((b, i) => b.pressed && out.add(i));
    return out;
  };
  const before = pressedNow();
  const tick = () => {
    if (!waiting || waiting.name !== "RS") return stopPadWait();
    const now = pressedNow();
    const fresh = [...now].find((i) => !before.has(i));
    for (const i of [...before]) if (!now.has(i)) before.delete(i);
    if (fresh !== undefined) {
      assignKey(`Gamepad:${fresh}`);
      waiting = null;
      padWait = 0;
      drawKeys();
      note(t("cfg.pendingSave"));
      return undefined;
    }
    padWait = requestAnimationFrame(tick);
    return undefined;
  };
  padWait = requestAnimationFrame(tick);
}

function redraw() {
  drawFields();
  drawKeys();
  drawRs();
  drawTheme();
  drawLangs();
  paintHead();
}

function showTab(which) {
  note("");
  shown = which;
  for (const [name, button] of Object.entries(el.tabs)) {
    const on = name === which;
    button.setAttribute("aria-selected", String(on));
    el.pages[name].hidden = !on;
  }
  paintHead();
}

function paintHead() {
  el.headTitle.textContent = t(`cfg.tab.${shown}`);
  el.headNote.textContent = t(TAB_NOTE[shown]);
  el.keysReset.hidden = shown !== "keys";
  el.keysReset.title = t("cfg.keys.resetTitle");
  el.saveBtn.title = t("cfg.saveTitle");
}

function note(message, bad = false) {
  el.note.textContent = message;
  el.note.classList.toggle("is-error", bad);
}

/* ── 일반 ── */

function drawFields() {
  el.body.replaceChildren();
  fieldInputs.clear();

  for (const group of FIELDS) {
    const box = document.createElement("section");
    box.className = "cfg__group";

    const title = document.createElement("h3");
    title.className = "cfg__title";
    title.textContent = t(`cfg.group.${group.group}`);
    box.append(title);

    if (group.note) {
      const text = document.createElement("p");
      text.className = "cfg__note";
      text.textContent = t(`cfg.group.${group.group}.note`);
      box.append(text);
    }

    for (const item of group.items) box.append(fieldRow(item));
    el.body.append(box);
  }
  paintRequires();
}

function fieldRow(item) {
  const row = document.createElement(item.type === "radio" || item.type === "clear" || item.type === "text" || item.type === "level" ? "div" : "label");
  row.className = "cfg__row";

  const text = document.createElement("span");
  text.className = "cfg__label";
  text.textContent = t(`cfg.${item.key}`);

  const hint = document.createElement("span");
  hint.className = "cfg__hint";
  hint.textContent = hooks.hint?.(item.key) ?? t(`cfg.${item.key}.note`, hooks.vars?.(item.key) ?? {});
  text.append(hint);

  row.append(text, control(item, hint));
  return row;
}

function control(item, hint) {
  if (draft[item.key] === undefined && item.default !== undefined) draft[item.key] = item.default;
  const value = draft[item.key];

  if (item.type === "clear") return clearControl(item, hint);
  if (item.type === "text") return textControl(item);

  if (item.type === "radio") {
    const group = document.createElement("span");
    group.className = "cfg__radios";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", t(`cfg.${item.key}`));
    for (const option of item.options) {
      const choice = document.createElement("label");
      choice.className = "cfg__radio";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `cfg-${item.key}`;
      input.checked = value === option;
      input.addEventListener("change", () => {
        if (input.checked) draft[item.key] = option;
      });
      choice.append(input, document.createTextNode(t(`cfg.${item.key}.${option}`)));
      group.append(choice);
    }
    return group;
  }

  if (item.type === undefined) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cfg__check";
    box.checked = value !== false;
    box.addEventListener("change", () => {
      draft[item.key] = box.checked;
      paintRequires();
    });
    return box;
  }

  if (item.type === "level") {
    const wrap = document.createElement("span");
    wrap.className = "cfg__level";
    if (item.requires) wrap.dataset.requires = item.key;
    const range = document.createElement("input");
    range.type = "range";
    range.className = "cfg__range";
    range.min = String(item.min);
    range.max = String(item.max);
    range.step = "1";
    range.value = String(value);
    range.dataset.key = item.key;
    range.setAttribute("aria-label", t(`cfg.${item.key}`));
    const caption = document.createElement("span");
    caption.className = "cfg__level-value";
    const paint = () => {
      caption.textContent = t(`cfg.${item.key}.value`, { n: range.value, rate: AUTO_FIRE_RATES[Number(range.value) - 1] });
    };
    range.addEventListener("input", () => {
      draft[item.key] = Number(range.value);
      paint();
    });
    paint();
    wrap.append(caption, range);
    return wrap;
  }

  const input = document.createElement("input");
  input.type = "number";
  input.className = "cfg__input cfg__input--num";
  input.value = value ?? "";
  input.min = String(item.min);
  input.max = String(item.max);
  input.addEventListener("input", () => {
    draft[item.key] = whole(input.value);
  });
  fieldInputs.set(item.key, input);
  return input;
}

const fieldOf = (key) => FIELDS.flatMap((group) => group.items).find((item) => item.key === key);

function blocked(item) {
  if (!item?.requires) return false;
  const parent = fieldOf(item.requires);
  const on = draft[item.requires] ?? parent?.default;
  return on === false || blocked(parent);
}

function paintRequires() {
  for (const row of el.body.querySelectorAll("[data-requires]")) {
    const off = blocked(fieldOf(row.dataset.requires));
    row.closest(".cfg__row")?.classList.toggle("is-disabled", off);
    for (const control of row.querySelectorAll("button, input")) control.disabled = off;
  }
}

function iconButton(icon, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "iconbtn";
  button.title = title;
  const glyph = document.createElement("span");
  glyph.className = "icon";
  glyph.style.setProperty("--icon", `url("/icons/${icon}.svg")`);
  button.append(glyph);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick(event);
  });
  return button;
}

function textControl(item) {
  const box = document.createElement("span");
  box.className = "cfg__folder";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cfg__input cfg__input--text";
  input.spellcheck = false;
  input.placeholder = hooks.placeholder?.(item.key) ?? t(`cfg.${item.key}.default`);
  if (item.maxLength) input.maxLength = item.maxLength;
  input.dataset.key = item.key;
  input.setAttribute("aria-label", t(`cfg.${item.key}`));
  input.value = draft[item.key] ?? "";
  input.addEventListener("input", () => {
    draft[item.key] = input.value.trim();
  });
  fieldInputs.set(item.key, input);

  const reset = iconButton("arrow-back-up", t(`cfg.${item.key}.reset`), () => {
    draft[item.key] = "";
    input.value = "";
    note(t("cfg.pendingSave"));
  });

  box.append(input, reset);
  return box;
}

function clearControl(item, hint) {
  const box = document.createElement("span");
  box.className = "cfg__folder";
  const count = () => (Array.isArray(draft[item.key]) ? draft[item.key].length : 0);
  const paint = () => {
    hint.textContent = t(`cfg.${item.key}.note`, { count: count() });
    clear.disabled = count() === 0;
  };
  const clear = iconButton("trash", t(`cfg.${item.key}.clear`), () => {
    draft[item.key] = [];
    paint();
    hint.textContent = t("cfg.clearPending");
    note(t("cfg.pendingSave"));
  });
  box.append(clear);
  paint();
  return box;
}

function whole(text) {
  const trimmed = String(text).trim();
  if (trimmed === "") return Number.NaN;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : Number.NaN;
}

function outOfRange() {
  for (const group of FIELDS) {
    for (const item of group.items) {
      if (item.type !== "number" || blocked(item)) continue;
      const value = draft[item.key];
      if (Number.isInteger(value) && value >= item.min && value <= item.max) continue;
      return { key: item.key, message: t("cfg.range", { group: t(`cfg.group.${group.group}`), label: t(`cfg.${item.key}`), min: item.min, max: item.max }) };
    }
  }
  return null;
}

async function save() {
  const bad = outOfRange();
  if (bad) {
    if (shown !== "general") showTab("general");
    const input = fieldInputs.get(bad.key);
    input?.focus();
    input?.select();
    note(bad.message, true);
    return;
  }
  el.saveBtn.disabled = true;
  try {
    await hooks.apply({ ...draft, keys: cloneKeys(keys), rs });
    draft = await hooks.snapshot();
    rs = cloneRs(draft.rs);
    drawFields();
    drawRs();
    note(t("cfg.saved"));
  } catch (error) {
    note(reason(error), true);
  } finally {
    el.saveBtn.disabled = false;
  }
}

/* ── 키 ── */

// 열린 게임이 설명서로 버튼을 정했으면 draft.keyLayout = { order, labels, defaults, note } — 그 게임의 버튼만 보이고 바꾼다.
// 없으면(게임 없음·GBA 10버튼 게임) 앱 전체 GBA 키(hooks.keyOrder·defaultKeys).
const keyOrder = () => draft?.keyLayout?.order ?? hooks.keyOrder;
const defaultKeys = () => draft?.keyLayout?.defaults ?? hooks.defaultKeys;
const keyLabel = (name) => draft?.keyLayout?.labels?.[name] ?? t(`key.${name}`);

function cloneKeys(source) {
  const out = {};
  const fallback = defaultKeys();
  for (const name of keyOrder()) out[name] = Array.isArray(source?.[name]) ? source[name].slice(0, 2) : [...(fallback[name] ?? [])].slice(0, 2);
  return out;
}

function resetKeys() {
  keys = cloneKeys(defaultKeys());
  waiting = null;
  drawKeys();
  note(t("cfg.pendingSave"));
}

function drawKeys() {
  el.keys.replaceChildren();
  if (el.keysGame) {
    const text = draft?.keyLayout?.note ?? "";
    el.keysGame.textContent = text;
    el.keysGame.hidden = !text;
  }
  for (const name of keyOrder()) {
    const label = document.createElement("span");
    label.className = "keys__name";
    label.textContent = keyLabel(name);
    el.keys.append(label);
    for (const index of [0, 1]) {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "keys__slot";
      const isWaiting = waiting && waiting.name === name && waiting.index === index;
      slot.classList.toggle("is-waiting", Boolean(isWaiting));
      slot.textContent = isWaiting ? t(name === "RS" ? "cfg.keys.pressPad" : "cfg.keys.press") : hooks.keyName(keys[name][index]);
      slot.title = t("cfg.keys.slotTitle");
      slot.dataset.key = name;
      slot.addEventListener("click", () => {
        waiting = { name, index };
        drawKeys();
        if (name === "RS") waitPad();
      });
      slot.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        keys[name][index] = "";
        keys[name] = keys[name].filter(Boolean);
        waiting = null;
        drawKeys();
      });
      el.keys.append(slot);
    }
  }
}

/* ── RS 버튼 ── */

function cloneRs(source) {
  if (!source) return null;
  const copy = (list) => (list ?? []).map((step) => ({ ...step, keys: [...step.keys] }));
  return {
    book: { active: source.book.active, slots: source.book.slots.map((slot) => slot && { name: slot.name, steps: copy(slot.steps) }) },
    fallback: source.fallback ? copy(source.fallback) : null,
    slots: source.slots,
    changed: false,
    opened: new Set(),
  };
}

const msOf = (frames) => Math.round(frames * FRAME_MS);
const presetName = (slot) => rs.book.slots[slot]?.name || t("macro.presetName", { n: slot + 1 });
const activeSteps = () => (rs.book.active >= 0 ? rs.book.slots[rs.book.active].steps : null);

function rsNote(text, className = "cfg__note") {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

function rsNumber(label, value, min, onChange) {
  const row = document.createElement("label");
  row.className = "cfg__row rsx__row";
  const text = document.createElement("span");
  text.className = "cfg__label";
  const name = document.createElement("span");
  name.textContent = label;
  const hint = document.createElement("span");
  hint.className = "cfg__hint";
  hint.textContent = t("macro.frames", { n: value, ms: msOf(value) });
  text.append(name, hint);
  const input = document.createElement("input");
  input.className = "cfg__input rsx__num";
  input.type = "number";
  input.min = String(min);
  input.max = String(MACRO_FRAMES_MAX);
  input.step = "1";
  input.value = String(value);
  input.addEventListener("change", () => {
    const n = Math.min(MACRO_FRAMES_MAX, Math.max(min, Math.round(Number(input.value) || 0)));
    input.value = String(n);
    hint.textContent = t("macro.frames", { n, ms: msOf(n) });
    onChange(n);
  });
  row.append(text, input);
  return row;
}

function rsChanged() {
  rs.changed = true;
  note(t("cfg.pendingSave"));
  paintRsTotal();
  rs.paintReset?.();
}

function paintRsTotal() {
  const total = el.rs?.querySelector(".rsx__total");
  const steps = rs && activeSteps();
  if (!total || !steps) return;
  const frames = macroFrameCount(steps);
  total.textContent = steps.length ? t("macro.total", { n: frames, ms: msOf(frames) }) : t("macro.empty");
}

function presetBar() {
  const book = rs.book;
  const bar = document.createElement("div");
  bar.className = "rsx__bar";
  bar.setAttribute("role", "radiogroup");
  bar.setAttribute("aria-label", t("macro.presets"));
  for (const slot of [-1, ...book.slots.keys()]) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "keys__slot rsx__slotbtn";
    node.setAttribute("role", "radio");
    node.setAttribute("aria-checked", String(book.active === slot));
    node.dataset.slot = String(slot);
    const empty = slot >= 0 && !book.slots[slot];
    if (empty) node.dataset.empty = "";
    node.title = slot < 0 ? t("macro.off") : empty ? t("macro.newPreset") : presetName(slot);
    if (slot < 0) {
      const glyph = document.createElement("span");
      glyph.className = "icon";
      glyph.style.setProperty("--icon", 'url("/icons/x.svg")');
      node.append(glyph);
    } else node.textContent = String(slot + 1);
    node.addEventListener("click", () => {
      if (book.active === slot) return;
      if (empty) book.slots[slot] = { name: "", steps: [] };
      book.active = slot;
      rs.opened.clear();
      rsChanged();
      drawRs();
    });
    bar.append(node);
  }
  return bar;
}

function presetNameRow() {
  const book = rs.book;
  const slot = book.active;
  const row = document.createElement("div");
  row.className = "rsx__namebar";
  const input = document.createElement("input");
  input.className = "cfg__input rsx__rename";
  input.type = "text";
  input.maxLength = MACRO_NAME_MAX;
  input.value = presetName(slot);
  input.title = t("macro.rename");
  input.setAttribute("aria-label", t("macro.rename"));
  input.addEventListener("change", () => {
    const value = [...input.value.trim()].slice(0, MACRO_NAME_MAX).join("");
    book.slots[slot].name = value === t("macro.presetName", { n: slot + 1 }) ? "" : value;
    input.value = presetName(slot);
    rsChanged();
  });
  const remove = iconButton("trash", t("macro.removePreset"), async () => {
    if (!(await hooks.confirm(t("macro.removeTitle", { name: presetName(slot) }), t("macro.removeText"), "DELETE"))) return;
    book.slots[slot] = null;
    if (book.active === slot) book.active = book.slots.findIndex(Boolean);
    rsChanged();
    drawRs();
  });
  remove.classList.add("iconbtn--danger");
  row.append(input, remove);
  return row;
}

function drawRs() {
  const box = el.rs;
  if (!box) return;
  const title = document.createElement("h3");
  title.className = "cfg__title";
  title.textContent = t("macro.title");
  if (!rs) {
    box.replaceChildren(title, rsNote(t("macro.noGame")));
    return;
  }
  const parts = [title, rsNote(t("macro.lead")), rsNote(t("macro.presets"), "cfg__sub"), presetBar()];
  const steps = activeSteps();
  if (!steps) {
    box.replaceChildren(...parts, rsNote(t("macro.offNote")));
    return;
  }
  parts.push(presetNameRow());
  const slots = RS_ORDER.filter((key) => rs.slots.includes(key));
  const opened = rs.opened;
  const list = document.createElement("ol");
  list.className = "rsx";
  steps.forEach((step, index) => {
    const item = document.createElement("li");
    item.className = "rsx__step";
    const head = document.createElement("div");
    head.className = "rsx__head";
    const last = index === steps.length - 1;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "rsx__toggle";
    const glyph = document.createElement("span");
    glyph.className = "icon";
    glyph.style.setProperty("--icon", 'url("/icons/chevron-down.svg")');
    const text = document.createElement("span");
    text.className = "rsx__text";
    const name = document.createElement("span");
    name.className = "rsx__name";
    const time = document.createElement("span");
    time.className = "cfg__hint";
    text.append(name, time);
    toggle.append(glyph, text);
    name.textContent = t("macro.step", { n: index + 1 });
    const paintHead = () => {
      time.textContent = last ? t("macro.timeSumLast", { hold: step.hold }) : t("macro.timeSum", { hold: step.hold, gap: step.gap });
    };
    paintHead();
    const body = document.createElement("div");
    body.className = "rsx__body";
    const setOpen = (on) => {
      if (on) opened.add(step);
      else opened.delete(step);
      body.hidden = !on;
      toggle.setAttribute("aria-expanded", String(on));
      toggle.title = t(on ? "macro.close" : "macro.open");
    };
    toggle.addEventListener("click", () => setOpen(body.hidden));
    const move = (to) => {
      const [moved] = steps.splice(index, 1);
      steps.splice(to, 0, moved);
      rsChanged();
      drawRs();
    };
    const up = iconButton("arrow-up", t("macro.up"), () => move(index - 1));
    up.disabled = index === 0;
    const down = iconButton("arrow-down", t("macro.down"), () => move(index + 1));
    down.disabled = last;
    const remove = iconButton("trash", t("macro.remove"), () => {
      steps.splice(index, 1);
      rsChanged();
      drawRs();
    });
    remove.classList.add("iconbtn--danger");
    head.append(toggle, up, down, remove);
    const keysRow = document.createElement("div");
    keysRow.className = "rsx__keys";
    keysRow.setAttribute("role", "group");
    keysRow.setAttribute("aria-label", t("macro.keys"));
    for (const key of slots) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `keys__slot rsx__key${key.length > 1 && !RS_ARROWS[key] ? " rsx__key--word" : ""}`;
      chip.dataset.key = key;
      chip.dataset.group = RS_GROUP[key];
      chip.textContent = RS_ARROWS[key] ?? key;
      chip.title = RS_ARROWS[key] ? t(`key.${key}`) : key;
      chip.setAttribute("aria-pressed", String(step.keys.includes(key)));
      chip.addEventListener("click", () => {
        const on = !step.keys.includes(key);
        step.keys = MACRO_KEYS.filter((k) => (k === key ? on : step.keys.includes(k)));
        chip.setAttribute("aria-pressed", String(on));
        paintHead();
        rsChanged();
      });
      keysRow.append(chip);
    }
    body.append(keysRow, rsNumber(t("macro.hold"), step.hold, 1, (n) => {
      step.hold = n;
      paintHead();
      rsChanged();
    }));
    if (!last)
      body.append(rsNumber(t("macro.gap"), step.gap, 0, (n) => {
        step.gap = n;
        paintHead();
        rsChanged();
      }));
    setOpen(opened.has(step));
    item.append(head, body);
    list.append(item);
  });
  const acts = document.createElement("div");
  acts.className = "rsx__acts";
  const add = iconButton("plus", t("macro.add"), () => {
    const fresh = { keys: [], hold: MACRO_HOLD, gap: MACRO_GAP };
    steps.push(fresh);
    opened.add(fresh);
    rsChanged();
    drawRs();
  });
  add.disabled = steps.length >= MACRO_STEPS_MAX;
  const initial = rs.book.active === 0 && rs.fallback ? rs.fallback : [];
  const plain = (list) => JSON.stringify(list.map(({ keys, hold, gap }) => ({ keys, hold, gap })));
  const reset = iconButton("refresh", t("macro.reset"), async () => {
    if (!(await hooks.confirm(t("macro.resetTitle", { name: presetName(rs.book.active) }), t(initial.length ? "macro.resetTextDefault" : "macro.resetText"), "RESET"))) return;
    steps.splice(0, steps.length, ...initial.map((step) => ({ ...step, keys: [...step.keys] })));
    opened.clear();
    rsChanged();
    drawRs();
  });
  reset.classList.add("iconbtn--danger");
  rs.paintReset = () => {
    reset.disabled = plain(initial) === plain(steps);
  };
  rs.paintReset();
  acts.append(add, reset);
  const total = rsNote("", "cfg__note rsx__total");
  parts.push(rsNote(t("macro.steps"), "cfg__sub"), list, total, acts);
  if (steps.length >= MACRO_STEPS_MAX) parts.push(rsNote(t("macro.max", { n: MACRO_STEPS_MAX })));
  box.replaceChildren(...parts);
  paintRsTotal();
}

/* ── 테마 ── */

function presetPreview(colors) {
  const box = document.createElement("span");
  box.className = "cfg__preview";

  const part = (cls, color) => {
    const piece = document.createElement("i");
    piece.className = cls;
    piece.style.background = color;
    return piece;
  };

  const col = document.createElement("span");
  col.className = "cfg__preview-col";
  col.append(part("cfg__preview-body", colors["--bg-sunken"]), part("cfg__preview-dock", colors["--accent"]));

  box.append(part("cfg__preview-rail", colors["--bg-raised"]), col, part("cfg__preview-side", colors["--bg-hover"]));
  return box;
}

function modeIcon(name) {
  const icon = document.createElement("span");
  icon.className = "icon cfg__mode-icon";
  icon.style.setProperty("--icon", `url("/icons/${name}.svg")`);
  return icon;
}

function drawTheme() {
  el.modes.replaceChildren();

  const presets = theme.MODES.filter((m) => m.id !== "custom");

  const head = document.createElement("div");
  head.className = "cfg__modes-head";
  const count = document.createElement("span");
  count.className = "cfg__modes-count";
  count.textContent = t("theme.presets", { count: presets.length });
  const dice = document.createElement("button");
  dice.type = "button";
  dice.className = "btn cfg__dice";
  dice.title = t("theme.randomTitle");
  dice.append(modeIcon("dice"), document.createTextNode("RANDOM"));
  dice.addEventListener("click", () => {
    const pool = presets.filter((m) => m.id !== picked.mode);
    chooseMode(pool[Math.floor(Math.random() * pool.length)].id);
  });
  head.append(count, dice);
  el.modes.append(head);

  for (const mode of theme.MODES) {
    const custom = mode.id === "custom";
    const on = mode.id === picked.mode;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cfg__mode";
    button.dataset.mode = mode.id;
    button.classList.toggle("is-on", on);
    button.classList.toggle("cfg__mode--new", custom && !on);
    button.setAttribute("aria-pressed", String(on));
    button.title = t(`theme.note.${mode.id}`);

    if (custom && !on) {
      const plus = document.createElement("span");
      plus.className = "cfg__preview cfg__preview--new";
      plus.append(modeIcon("plus"));
      button.append(plus);
    } else {
      const colors = custom ? { ...theme.presetOf("dark"), ...picked.colors } : theme.presetOf(mode.id);
      button.append(presetPreview(colors));
    }

    const name = document.createElement("span");
    name.className = "cfg__mode-name";
    if (on) name.append(modeIcon("circle-dot"));
    name.append(document.createTextNode(t(`theme.mode.${mode.id}`)));

    button.append(name);
    button.addEventListener("click", () => chooseMode(mode.id));
    el.modes.append(button);
  }

  drawColors();
}

function chooseMode(mode) {
  const kept = mode === "custom" ? (picked.colors ?? {}) : {};
  const fresh = mode === "custom" && Object.keys(kept).length === 0;
  picked = { mode, colors: fresh ? theme.randomColors(Math.random, recipe) : kept };

  const now = document.activeElement;
  const held = el.modes.contains(now) ? (now.closest(".cfg__dice") ? ".cfg__dice" : ".cfg__mode.is-on") : null;

  theme.apply(picked);
  drawTheme();
  if (held) el.modes.querySelector(held)?.focus();
  remember();
}

function colorActions() {
  const row = document.createElement("div");
  row.className = "cfg__acts";

  const make = (label, title, colors) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", () => {
      picked.colors = colors();
      theme.apply(picked);
      drawTheme();
      remember();
    });
    return button;
  };

  row.append(
    make("SHUFFLE", t("theme.shuffleTitle"), () => theme.randomColors(Math.random, recipe)),
    make("RESET", t("theme.resetTitle"), () => ({ ...theme.presetOf("dark") })),
  );
  return row;
}

function recipePicks(axis, items) {
  const row = document.createElement("div");
  row.className = "cfg__picks";

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cfg__pick";
    button.setAttribute("aria-pressed", String(recipe[axis] === item.id));
    button.title = t(`theme.${axis}.${item.id}.note`);

    if (item.dot) {
      const dot = document.createElement("i");
      dot.style.background = item.dot;
      button.append(dot);
    }
    button.append(document.createTextNode(t(`theme.${axis}.${item.id}`)));

    button.addEventListener("click", () => {
      recipe = { ...recipe, [axis]: item.id };
      drawColors();
    });
    row.append(button);
  }
  return row;
}

function subTitle(text) {
  const node = document.createElement("h4");
  node.className = "cfg__sub";
  node.textContent = text;
  return node;
}

function ratioText(value) {
  return t("theme.ratio", { value: value.toFixed(1) });
}

function tokenCard(group, colors, editable) {
  const card = document.createElement("section");
  card.className = "cfg__card";

  const head = document.createElement("header");
  head.className = "cfg__card-head";

  const title = document.createElement("span");
  title.className = "cfg__card-title";
  title.textContent = t(`theme.group.${group.id}`);
  head.append(title);

  if (group.keys.includes("--text")) {
    const ratio = document.createElement("span");
    ratio.className = "cfg__ratio";
    const value = theme.contrast(hex(colors["--text"] ?? ""), hex(colors["--bg"] ?? ""));
    ratio.textContent = ratioText(value);
    ratio.classList.toggle("is-low", value < 4.5);
    ratio.title = t(value < 4.5 ? "theme.ratioLow" : "theme.ratioOk");
    head.append(ratio);
  } else {
    const text = document.createElement("span");
    text.className = "cfg__card-note";
    text.textContent = t(`theme.group.${group.id}.note`);
    text.title = text.textContent;
    head.append(text);
  }

  card.append(head);

  const list = document.createElement("div");
  list.className = "cfg__swatches";

  for (const key of group.keys) {
    const value = hex(colors[key] ?? "");

    const row = document.createElement(editable ? "label" : "div");
    row.className = "cfg__swatch-row";
    row.title = key;

    const chip = document.createElement("span");
    chip.className = "cfg__chip";
    chip.style.background = colors[key] ?? "transparent";

    const name = document.createElement("span");
    name.className = "cfg__swatch-name";
    name.textContent = t(`theme.token.${key.slice(2)}`);

    const code = document.createElement("span");
    code.className = "cfg__swatch-hex";
    code.textContent = value;

    row.append(chip, name, code);

    if (editable) {
      const input = document.createElement("input");
      input.type = "color";
      input.className = "cfg__color";
      input.value = value;
      input.addEventListener("input", () => {
        picked.colors[key] = input.value;
        chip.style.background = input.value;
        code.textContent = input.value;
        theme.applyLive(picked);
        paintRatios();
        rememberSoon();
      });
      input.addEventListener("change", remember);
      row.append(input);
    }

    list.append(row);
  }

  card.append(list);
  return card;
}

function paintRatios() {
  const colors = { ...theme.presetOf("dark"), ...picked.colors };
  for (const ratio of el.colors.querySelectorAll(".cfg__ratio")) {
    const value = theme.contrast(hex(colors["--text"] ?? ""), hex(colors["--bg"] ?? ""));
    ratio.textContent = ratioText(value);
    ratio.classList.toggle("is-low", value < 4.5);
  }
}

function drawColors() {
  el.colors.replaceChildren();

  const custom = picked.mode === "custom";
  const colors = custom ? { ...theme.presetOf("dark"), ...picked.colors } : theme.presetOf(picked.mode);

  const head = document.createElement("div");
  head.className = "cfg__tokens-head";

  const title = document.createElement("h3");
  title.className = "cfg__title";
  title.textContent = custom ? t("theme.customColors") : t("theme.presetColors", { name: t(`theme.mode.${picked.mode}`) });
  head.append(title);

  if (!custom) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn cfg__head-btn";
    copy.textContent = "COPY";
    copy.title = t("theme.copyTitle");
    copy.addEventListener("click", () => {
      picked = { mode: "custom", colors: { ...theme.presetOf(picked.mode) } };
      theme.apply(picked);
      drawTheme();
      remember();
    });
    head.append(copy);
  }

  el.colors.append(head);

  const text = document.createElement("p");
  text.className = "cfg__note";
  text.textContent = t(custom ? "theme.customNote" : "theme.presetNote");
  el.colors.append(text);

  for (const group of TOKEN_GROUPS) el.colors.append(tokenCard(group, colors, custom));

  if (!custom) return;

  el.colors.append(subTitle(t("theme.toneTitle")), recipePicks("tone", theme.TONES));
  el.colors.append(subTitle(t("theme.castTitle")), recipePicks("cast", theme.CASTS));
  el.colors.append(colorActions());
}

function hex(value) {
  const found = /#([0-9a-f]{6})\b/i.exec(value.trim());
  if (found) return `#${found[1]}`;

  const rgb = /rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/.exec(value);
  if (rgb) {
    const to = (n) => Number(n).toString(16).padStart(2, "0");
    return `#${to(rgb[1])}${to(rgb[2])}${to(rgb[3])}`;
  }

  return "#000000";
}

let rememberTimer = 0;

function rememberSoon() {
  if (!rememberTimer) rememberTimer = setTimeout(remember, 120);
}

function remember() {
  clearTimeout(rememberTimer);
  rememberTimer = 0;
  Promise.resolve(hooks.setTheme({ mode: picked.mode, colors: { ...picked.colors } })).catch((error) => note(reason(error), true));
}

/* ── 언어 ── */

function drawLangs() {
  el.langs.replaceChildren();
  for (const item of LANGS) {
    const on = item.id === lang();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cfg__lang";
    button.dataset.lang = item.id;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));

    const name = document.createElement("span");
    name.className = "cfg__lang-name";
    if (on) name.append(modeIcon("circle-dot"));
    name.append(document.createTextNode(item.label));

    const sub = document.createElement("span");
    sub.className = "cfg__lang-sub";
    sub.textContent = t(`lang.${item.id}`);

    button.append(name, sub);
    button.addEventListener("click", async () => {
      if (item.id === lang()) return;
      try {
        await hooks.setLang(item.id);
        el.langs.querySelector(`[data-lang="${item.id}"]`)?.focus();
        note(t("cfg.langChanged"));
      } catch (error) {
        note(reason(error), true);
      }
    });
    el.langs.append(button);
  }
}
