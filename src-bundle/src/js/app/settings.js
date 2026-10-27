import { core } from "../bridge.js";
import * as theme from "../shell/theme.js";
import { CHANGED as LANG_CHANGED, LANGS, lang, t } from "../shell/i18n.js";
import { codeOf, DPAD_DEFAULT } from "./player.js";

const el = {};

const hooks = {
  snapshot: async () => ({}),
  apply: async () => {},
  setTheme: async () => {},
  setLang: async () => {},
  keyName: (code) => code,
  keyOrder: [],
  defaultKeys: {},
  onClose: () => {},
};

let draft = null;

let keys = null;

let waiting = null;

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
      { key: "slot", type: "number", min: 1, max: 9, default: 1 },
    ],
  },
  {
    group: "save",
    note: true,
    items: [
      { key: "exitSave", default: true },
      { key: "exitSaveDir", type: "folder", default: "", requires: "exitSave" },
      { key: "saveBackup", default: true },
    ],
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

const baseOf = (path) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

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
    modes: pick("settings-modes"),
    colors: pick("settings-colors"),
    langs: pick("settings-langs"),
    headTitle: pick("settings-head-title"),
    headNote: pick("settings-head-note"),
    keysReset: pick("settings-keys-reset"),
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
  keys = cloneKeys(draft.keys ?? hooks.defaultKeys);
  waiting = null;
  picked = { mode: draft.theme?.mode ?? "dark", colors: { ...(draft.theme?.colors ?? {}) } };
  redraw();
  showTab(TABS.includes(tab) ? tab : "general");
  el.modal.hidden = false;
  requestAnimationFrame(() => el.modal.classList.add("is-open"));
  el.tabs[shown]?.focus();
}

export function close() {
  if (!isOpen()) return;
  waiting = null;
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
    if (pressed !== "Escape" && pressed) {
      for (const name of hooks.keyOrder) keys[name] = keys[name].filter((code) => code !== pressed);
      const list = keys[waiting.name];
      list[waiting.index] = pressed;
      keys[waiting.name] = list.filter(Boolean);
    }
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

function redraw() {
  drawFields();
  drawKeys();
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
  const row = document.createElement(item.type === "radio" || item.type === "folder" || item.type === "clear" || item.type === "text" ? "div" : "label");
  row.className = "cfg__row";

  const text = document.createElement("span");
  text.className = "cfg__label";
  text.textContent = t(`cfg.${item.key}`);

  const hint = document.createElement("span");
  hint.className = "cfg__hint";
  hint.textContent = t(`cfg.${item.key}.note`);
  text.append(hint);

  row.append(text, control(item, hint));
  return row;
}

function control(item, hint) {
  if (draft[item.key] === undefined && item.default !== undefined) draft[item.key] = item.default;
  const value = draft[item.key];

  if (item.type === "folder") return folderControl(item);
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

function folderControl(item) {
  const box = document.createElement("span");
  box.className = "cfg__folder";
  if (item.requires) box.dataset.requires = item.key;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cfg__input";
  input.readOnly = true;
  input.placeholder = t(`cfg.${item.key}.default`);

  const paint = () => {
    const dir = draft[item.key] ?? "";
    input.value = dir ? baseOf(dir.replace(/[\\/]+$/, "")) || dir : "";
    input.title = dir || t(`cfg.${item.key}.default`);
  };
  paint();

  const choose = iconButton("folder-open", t(`cfg.${item.key}.pick`), async () => {
    let dir = "";
    try {
      dir = await core.pickFolder({ title: t(`cfg.${item.key}.pick`), start: draft[item.key] || null });
    } catch (error) {
      note(reason(error), true);
      return;
    }
    if (!dir) return;
    draft[item.key] = dir;
    paint();
    note(t("cfg.pendingSave"));
  });

  const reset = iconButton("arrow-back-up", t(`cfg.${item.key}.reset`), () => {
    draft[item.key] = "";
    paint();
    note(t("cfg.pendingSave"));
  });

  box.append(input, choose, reset);
  return box;
}

function textControl(item) {
  const box = document.createElement("span");
  box.className = "cfg__folder";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cfg__input cfg__input--text";
  input.spellcheck = false;
  input.placeholder = t(`cfg.${item.key}.default`);
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
    await hooks.apply({ ...draft, keys: cloneKeys(keys) });
    draft = await hooks.snapshot();
    drawFields();
    note(t("cfg.saved"));
  } catch (error) {
    note(reason(error), true);
  } finally {
    el.saveBtn.disabled = false;
  }
}

/* ── 키 ── */

function cloneKeys(source) {
  const out = {};
  for (const name of hooks.keyOrder) out[name] = Array.isArray(source?.[name]) ? source[name].slice(0, 2) : [...(hooks.defaultKeys[name] ?? [])];
  return out;
}

function resetKeys() {
  keys = cloneKeys(hooks.defaultKeys);
  waiting = null;
  drawKeys();
  note(t("cfg.pendingSave"));
}

function drawKeys() {
  el.keys.replaceChildren();
  for (const name of hooks.keyOrder) {
    const label = document.createElement("span");
    label.className = "keys__name";
    label.textContent = t(`key.${name}`);
    el.keys.append(label);
    for (const index of [0, 1]) {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "keys__slot";
      const isWaiting = waiting && waiting.name === name && waiting.index === index;
      slot.classList.toggle("is-waiting", Boolean(isWaiting));
      slot.textContent = isWaiting ? t("cfg.keys.press") : hooks.keyName(keys[name][index]);
      slot.title = t("cfg.keys.slotTitle");
      slot.addEventListener("click", () => {
        waiting = { name, index };
        drawKeys();
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
