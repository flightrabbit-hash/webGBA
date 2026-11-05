import { centerBoardNodes, measureInk } from "./board-panel.js";
import { t } from "../shell/i18n.js";

export const PICK_TEXTS = ".zpick__name, .zpick__meta, .zpick__allLabel, .zpick__count";
const LOADER_TEXTS = ".loader__file, .loader__count, .loader__ratio";

function shownText(node) {
  const text = node.textContent.trim();
  if (node.scrollWidth <= node.clientWidth + 1) return text;
  const textNode = node.firstChild;
  if (textNode?.nodeType !== Node.TEXT_NODE) return text;
  const right = node.getBoundingClientRect().right - parseFloat(getComputedStyle(node).fontSize);
  const range = document.createRange();
  let shown = "";
  for (let i = 0; i < textNode.data.length; i++) {
    range.setStart(textNode, i);
    range.setEnd(textNode, i + 1);
    if (range.getBoundingClientRect().right > right) break;
    shown += textNode.data[i];
  }
  return `${shown.trim()}…`;
}

export const centerTexts = (nodes) => centerBoardNodes(nodes, (node) => measureInk(node, shownText(node)));

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

export function sizeText(bytes) {
  if (!Number.isFinite(bytes)) return "?";
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}MB`;
  return `${(bytes / 1073741824).toFixed(1)}GB`;
}

const KIND = { wgba: "WGBA", wasm: "WASM", gba: "GBA", agb: "GBA", bin: "GBA", gb: "GB", gbc: "GBC" };

export function whyText(problem) {
  if (!problem) return "";
  if (problem.code === "zipEncrypted") return t("zip.why.encrypted");
  if (problem.code === "zipMethod") return t("zip.why.method", { method: problem.params.method ?? "?" });
  if (problem.code === "romTooBig") return t("zip.why.tooBig", { max: sizeText(problem.params.max) });
  return "";
}

const folderOf = (path) => {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
};

export function shownNames(games) {
  const count = new Map();
  for (const game of games) count.set(game.name.toLowerCase(), (count.get(game.name.toLowerCase()) ?? 0) + 1);
  return games.map((game) => (count.get(game.name.toLowerCase()) > 1 ? folderOf(game.path) : ""));
}

export function zipPicker({ games, onChange = () => {} }) {
  const on = games.map((game) => !game.problem);
  const usable = on.filter(Boolean).length;
  const root = make("div", "zpick");
  const box = () => {
    const node = make("span", "cbox");
    node.setAttribute("aria-hidden", "true");
    node.append(make("span", "cbox__mark"), make("span", "cbox__dash"));
    return node;
  };
  const all = make("div", "zpick__all");
  all.setAttribute("role", "checkbox");
  all.tabIndex = usable ? 0 : -1;
  const allLabel = make("span", "zpick__allLabel", t("zip.pick.all"));
  allLabel.id = `zpick-all-${Math.random().toString(36).slice(2, 8)}`;
  all.setAttribute("aria-labelledby", allLabel.id);
  const count = make("span", "zpick__count");
  all.append(box(), allLabel, count);
  if (!usable) all.setAttribute("aria-disabled", "true");
  const list = make("ul", "zpick__list");
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", t("zip.pick.all"));
  const where = shownNames(games);
  const rows = games.map((game, index) => {
    const row = make("li", "zpick__row");
    row.setAttribute("role", "checkbox");
    row.dataset.index = String(index);
    const name = make("span", "zpick__name", game.name);
    name.id = `${allLabel.id}-${index}`;
    row.setAttribute("aria-labelledby", name.id);
    const why = whyText(game.problem);
    const meta = make("span", `zpick__meta${why ? " zpick__meta--why" : ""}`, why || [where[index], KIND[game.ext] ?? game.ext.toUpperCase(), sizeText(game.size)].filter(Boolean).join(" · "));
    if (why) {
      row.setAttribute("aria-disabled", "true");
      row.title = why;
      row.tabIndex = -1;
    } else row.tabIndex = 0;
    row.append(box(), name, meta);
    list.append(row);
    return row;
  });
  root.append(all, list);

  const chosen = () => on.reduce((sum, value) => sum + (value ? 1 : 0), 0);
  const sync = () => {
    rows.forEach((row, i) => row.setAttribute("aria-checked", String(on[i])));
    const n = chosen();
    all.setAttribute("aria-checked", n === 0 ? "false" : n === usable ? "true" : "mixed");
    count.textContent = t("zip.pick.count", { n, total: usable });
    onChange(n);
  };
  const toggle = (index) => {
    if (games[index].problem) return;
    on[index] = !on[index];
    sync();
    centerTexts([count]);
  };
  const toggleAll = () => {
    if (!usable) return;
    const next = chosen() !== usable;
    games.forEach((game, i) => (on[i] = !game.problem && next));
    sync();
    centerTexts([count]);
  };
  const focusable = () => [all, ...rows].filter((node) => node.tabIndex === 0);
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
        const items = focusable();
        const at = items.indexOf(node);
        items[Math.max(0, Math.min(items.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
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
  rows.forEach((row, index) => wire(row, () => toggle(index)));
  sync();

  return {
    node: root,
    chosen: () => games.filter((_, i) => on[i]),
    center: () => centerTexts(root.querySelectorAll(PICK_TEXTS)),
  };
}

export function openCountLoader({ title, cancel = "", buttonClass = "btn", delay = 150, onShow = () => {} }) {
  const root = make("div", "loader loader--count");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.hidden = true;
  const card = make("div", "loader__card");
  const head = make("h3", "loader__title", title);
  const file = make("p", "loader__file");
  const bar = make("div", "loader__bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const fill = make("span", "loader__fill");
  bar.append(fill);
  const meta = make("div", "loader__meta");
  const dots = make("span", "loader__dots");
  dots.setAttribute("aria-hidden", "true");
  dots.append(make("i"), make("i"), make("i"));
  const counter = make("span", "loader__count");
  const ratio = make("span", "loader__ratio", "0%");
  meta.append(dots, counter, ratio);
  card.append(head, file, bar, meta);
  let stopped = false;
  let button = null;
  if (cancel) {
    const actions = make("div", "loader__actions");
    button = make("button", buttonClass, cancel);
    button.type = "button";
    button.addEventListener("click", () => {
      stopped = true;
      button.disabled = true;
    });
    actions.append(button);
    card.append(actions);
  }
  root.append(card);
  document.body.append(root);
  const center = () => {
    if (!root.hidden) centerTexts(card.querySelectorAll(LOADER_TEXTS));
  };
  const show = () => {
    clearTimeout(timer);
    if (!root.hidden || !root.isConnected) return;
    root.hidden = false;
    onShow();
    center();
  };
  const timer = setTimeout(show, delay);
  return {
    element: root,
    get aborted() {
      return stopped;
    },
    show,
    set({ fraction = 0, count = "", name = "" } = {}) {
      const value = Math.max(0, Math.min(100, fraction * 100));
      fill.style.setProperty("--progress", (value / 100).toFixed(4));
      bar.setAttribute("aria-valuenow", String(Math.floor(value)));
      root.dataset.percent = value.toFixed(1);
      const texts = [
        [ratio, `${Math.floor(value)}%`],
        [counter, count],
        [file, name],
      ].filter(([node, text]) => node.textContent !== text);
      for (const [node, text] of texts) node.textContent = text;
      if (texts.length) center();
    },
    close() {
      clearTimeout(timer);
      root.remove();
    },
  };
}
