import { boardView } from "../core/net/board.js";
import { lang, t } from "../shell/i18n.js";

export const BOARD_TEXTS = ".mpb__text, .mpb__tagtext, .mpb__title";

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

const chip = (tone, text, extra = "") => {
  const node = make("span", `mpb__tag${tone ? ` mpb__tag--${tone}` : ""}${extra}`);
  node.append(make("span", "mpb__tagtext", text));
  return node;
};

export function seatRows({ members = [], slot = -1, max = 0, showMs = true }) {
  const view = boardView({ members, slot, lang: lang() });
  return withEmpty(view.rows.map((row) => seatRow(row, view, "", showMs)), view, max);
}

function emptySeat(slot) {
  const li = make("li", "mpb__row is-empty");
  li.dataset.key = `e${slot}`;
  const seat = make("div", "mpb__seat");
  seat.append(chip("", `${slot + 1}P`, " mpb__tag--seat"));
  const l1 = make("div", "mpb__l1");
  l1.append(make("span", "mpb__text mpb__name", t("board.empty")));
  li.append(seat, l1);
  return li;
}

function withEmpty(nodes, view, max) {
  if (view.ai || !max) return nodes;
  const taken = new Set(view.rows.map((r) => r.slot));
  const bySlot = view.rows.every((r, i, all) => i === 0 || all[i - 1].slot < r.slot);
  const out = [...nodes];
  for (let s = 0; s < max; s++) {
    if (taken.has(s)) continue;
    const at = bySlot ? view.rows.findIndex((r) => r.slot > s) : -1;
    out.splice(at < 0 ? out.length : at + out.length - nodes.length, 0, emptySeat(s));
  }
  return out;
}

function seatRow(row, view, template, showMs) {
  const li = make("li", "mpb__row");
  li.dataset.key = row.key;
  if (row.me) li.classList.add("is-me");
  if (row.dim) li.classList.add("is-out");
  const warn = ["hold", "rejoin", "stall"].includes(row.conn?.kind);
  if (warn) li.classList.add("is-warn");
  const seat = make("div", "mpb__seat");
  seat.append(chip(row.human ? (row.me ? "me" : warn ? "warn" : "") : "ai", row.human ? row.seat : t("board.aiTag"), " mpb__tag--seat"));
  const l1 = make("div", "mpb__l1");
  if (row.mark) l1.append(make("span", "mpb__mark"));
  l1.append(make("span", "mpb__text mpb__name", row.name));
  if (row.host) l1.append(chip("host", t("board.host")));
  if (row.me) l1.append(chip("me", t("board.me")));
  const tail = connNodes(row.conn, showMs);
  if (tail.length) tail[0].classList.add("mpb__push");
  l1.append(...tail);
  li.append(seat, l1);
  if (!view.plain) {
    const l2 = make("div", "mpb__l2");
    l2.style.gridTemplateColumns = template;
    view.columns.forEach((col, c) => {
      if (!col.shown) return;
      const cell = row.cells[c];
      if (!cell || cell.type === "empty") {
        if (col.type === "bar") l2.append(make("span", "mpb__slot"), make("span", "mpb__slot"));
        else l2.append(make("span", "mpb__slot"));
        return;
      }
      if (cell.type === "bar") {
        const meter = make("span", "mpb__meter");
        meter.dataset.tone = cell.tone;
        meter.dataset.ratio = String(cell.ratio);
        meter.append(make("i"));
        l2.append(meter, make("span", "mpb__text mpb__small mpb__num", String(cell.value)));
      } else if (cell.type === "number") {
        l2.append(make("span", "mpb__text mpb__small mpb__dim", cell.label ? `${cell.label} ${cell.text}` : cell.text));
      } else if (cell.type === "rank") {
        l2.append(cell.text ? make("span", "mpb__text mpb__small", cell.text) : make("span", "mpb__slot"));
      } else if (cell.type === "status") {
        l2.append(cell.text ? chip(cell.tone, cell.text, " mpb__state") : make("span", "mpb__slot"));
      }
    });
    li.append(l2);
  }
  return li;
}

function connNodes(conn, showMs) {
  if (!conn) return [];
  if (conn.kind === "stall") return [chip("warn", t("board.stall"))];
  if (conn.kind === "hold") return [chip("warn", t("board.hold"))];
  if (conn.kind === "rejoin") return [chip("warn", t("board.rejoining"))];
  if (conn.kind === "joining") return [chip("dim", t("board.joining"))];
  if (conn.kind === "lost") return [chip("bad", t("board.lost"))];
  if (conn.kind === "left") return [chip("dim", t("board.left"))];
  if (!conn.q) return [];
  const sig = make("span", "mpb__sig");
  sig.dataset.q = conn.q;
  sig.append(make("i"), make("i"), make("i"));
  const note = showMs ? t(conn.turn ? "board.turnMs" : "board.ms", { ms: conn.ms }) : conn.turn ? t("board.turn") : "";
  return note ? [sig, make("span", "mpb__text mpb__small mpb__dim mpb__ms", note)] : [sig];
}

export class BoardPanel {
  constructor({ root, head = [], actions = [], invite = null, bar = (meter, ratio) => (meter.firstChild.style.width = `${(ratio * 100).toFixed(2)}%`), widths = { bar: 22, number: 30, rank: 26, status: 12 }, textWidth = () => 40, showMs = () => true, footHint = null, rejoinButtons = null }) {
    this.root = root;
    this.bar = bar;
    this.widths = widths;
    this.textWidth = textWidth;
    this.showMs = showMs;
    this.invite = invite;
    this.sig = "";
    this.panel = make("div", "mpb__panel");
    this.panel.setAttribute("role", "dialog");
    this.headNode = make("header", "mpb__head");
    this.title = make("h2", "mpb__title");
    this.people = chip("good", "", " mpb__people");
    this.headNode.append(this.title, this.people, ...head);
    this.list = make("ol", "mpb__rows");
    this.legend = make("div", "mpb__legendLine");
    this.caption = make("span", "mpb__text mpb__caption");
    this.legendMark = make("span", "mpb__mark");
    this.legendText = make("span", "mpb__text mpb__legend");
    this.legend.append(this.caption, this.legendMark, this.legendText);
    this.fixedLegend = Boolean(footHint);
    if (footHint) this.legend.append(...footHint);
    else this.legend.hidden = true;
    this.footNode = make("footer", "mpb__foot");
    this.footNode.append(...actions);
    this.footNode.hidden = !actions.length;
    if (rejoinButtons) {
      this.rejoinNow = rejoinButtons[0] ?? null;
      this.rejoinNode = make("div", "mpb__rejoin");
      this.rejoinText = make("span", "mpb__text mpb__rejoinText");
      const box = make("div", "mpb__rejoinActions");
      box.append(...rejoinButtons);
      this.rejoinNode.append(this.rejoinText, box);
      this.rejoinNode.hidden = true;
    }
    this.panel.append(...[this.headNode, this.rejoinNode, this.list, this.legend, this.footNode].filter(Boolean));
    root.replaceChildren(this.panel);
  }

  reset() {
    this.sig = "";
    this.shape = "";
  }

  render({ snap, data, room = "", title = "", invite = false }) {
    const view = boardView({ config: data.config, board: data.board, selfRows: data.selfRows, members: snap.members, gone: data.gone, slot: snap.slot, lang: lang() });
    const parts = [t("board.people", { n: snap.max > 1 && !view.ai ? `${view.people}/${snap.max}` : String(view.people) })];
    if (view.ai) parts.push(t("board.ai", { n: view.ai }));
    const people = parts.join(" · ");
    const head = room ? t("board.room", { code: room }) : title;
    const showMs = this.showMs();
    const left = Math.ceil((snap.hostLeft ?? 0) / 1000);
    const rejoin = !this.rejoinNode || !snap.rejoining ? "" : snap.hostWait ? t("net.hostWait.state", { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` }) : t({ offline: "net.rejoin.offline", wait: "net.rejoin.wait", server: "net.rejoin.server" }[snap.rejoinState] ?? "net.rejoin.trying");
    const sig = JSON.stringify([lang(), head, view, people, showMs, rejoin, invite, snap.max, Boolean(snap.hostWait)]);
    if (sig === this.sig) return null;
    this.sig = sig;
    const changed = [];
    const put = (node, text) => {
      if (node.textContent === text) return;
      node.textContent = text;
      changed.push(node);
    };
    if (this.rejoinNode) {
      this.rejoinNode.hidden = !rejoin;
      if (rejoin) put(this.rejoinText, rejoin);
      if (this.rejoinNow) this.rejoinNow.hidden = Boolean(snap.hostWait);
    }
    if (this.invite) this.invite.hidden = !invite;
    put(this.title, head);
    put(this.caption, view.caption);
    this.caption.hidden = !view.caption;
    put(this.people.firstChild, people);
    if (view.plain) this.list.dataset.plain = "";
    else delete this.list.dataset.plain;
    this.legendMark.hidden = !view.mark;
    put(this.legendText, view.mark);
    this.legendText.hidden = !view.mark;
    if (!this.fixedLegend) this.legend.hidden = !view.mark && !view.caption;
    const template = this.template(view);
    const shape = JSON.stringify([lang(), view.plain, template, showMs, view.rows.map((r) => r.key), snap.max]);
    const fresh = withEmpty(view.rows.map((row) => seatRow(row, view, template, showMs)), view, snap.max);
    const meters = [];
    if (shape !== this.shape) {
      this.shape = shape;
      this.list.replaceChildren(...fresh);
      for (const li of fresh) changed.push(...li.querySelectorAll(BOARD_TEXTS)), meters.push(...li.querySelectorAll(".mpb__meter"));
    } else {
      fresh.forEach((li, i) => {
        const old = this.list.children[i];
        if (rowShape(old) !== rowShape(li)) {
          old.replaceWith(li);
          changed.push(...li.querySelectorAll(BOARD_TEXTS));
          meters.push(...li.querySelectorAll(".mpb__meter"));
          return;
        }
        old.classList.toggle("is-out", li.classList.contains("is-out"));
        const before = old.querySelectorAll(BOARD_TEXTS);
        li.querySelectorAll(BOARD_TEXTS).forEach((node, j) => put(before[j], node.textContent));
        const oldMeters = old.querySelectorAll(".mpb__meter");
        li.querySelectorAll(".mpb__meter").forEach((meter, j) => {
          const target = oldMeters[j];
          if (target.dataset.ratio === meter.dataset.ratio && target.dataset.tone === meter.dataset.tone) return;
          target.dataset.ratio = meter.dataset.ratio;
          target.dataset.tone = meter.dataset.tone;
          meters.push(target);
        });
      });
    }
    const sizes = meters.map((meter) => (meter.boardWidth ??= meter.clientWidth));
    meters.forEach((meter, i) => this.bar(meter, Number(meter.dataset.ratio), sizes[i]));
    return { nodes: changed };
  }

  template(view) {
    const w = this.widths;
    const widest = (c, label = false) => Math.ceil(Math.max(0, ...view.rows.map((r) => r.cells[c]).filter((cell) => cell?.text).map((cell) => this.textWidth(label && cell.label ? `${cell.label} ${cell.text}` : cell.text))));
    return view.columns
      .map((col, c) => {
        if (!col.shown) return "";
        if (col.type === "bar") return `minmax(48px, 1fr) ${Math.max(w.bar, Math.ceil(Math.max(0, ...view.rows.map((r) => (r.cells[c]?.type === "bar" ? this.textWidth(String(r.cells[c].value)) : 0)))) + 2)}px`;
        if (col.type === "number") return `${Math.max(w.number, widest(c, true) + 2)}px`;
        if (col.type === "rank") return `${Math.max(w.rank, widest(c) + 2)}px`;
        if (col.type === "status") return `${widest(c) + w.status}px`;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
}

function rowShape(li) {
  return [li.className.replace(" is-out", ""), ...[...li.querySelectorAll("*")].map((node) => `${node.className}|${node.dataset.q ?? ""}`)].join(",");
}

export function inkShift(top, bottom, ink, dpr = globalThis.devicePixelRatio || 1) {
  const boxTop = Math.round(top * dpr);
  const inkTop = Math.round(ink.top * dpr);
  const free = Math.round(bottom * dpr) - boxTop - (Math.round(ink.bottom * dpr) - inkTop);
  return (boxTop + Math.floor(free / 2) - inkTop) / dpr;
}

const baseCache = new Map();
let inkCtx = null;

function baseline(style, lineHeight, text) {
  const sample = /[^\u0000-ɏ]/.test(text) ? "가A" : "A";
  const key = `${style.fontWeight}|${style.fontSize}|${style.fontFamily}|${lineHeight}|${sample}`;
  if (baseCache.has(key)) return baseCache.get(key);
  const probe = make("div");
  probe.style.cssText = `position:fixed;left:-9999px;top:0;visibility:hidden;white-space:nowrap;margin:0;padding:0;border:0;font-weight:${style.fontWeight};font-size:${style.fontSize};font-family:${style.fontFamily};line-height:${lineHeight}px`;
  const marker = make("span");
  marker.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  probe.append(sample, marker);
  document.body.append(probe);
  const offset = marker.getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();
  baseCache.set(key, offset);
  return offset;
}

const glyphCache = new Map();
let glyphCanvas = null;

function glyphInk(font, text) {
  const scale = Math.max(1, globalThis.devicePixelRatio || 1);
  const key = `${font}|${scale}|${text}`;
  if (glyphCache.has(key)) return glyphCache.get(key);
  inkCtx ??= document.createElement("canvas").getContext("2d");
  inkCtx.font = font;
  const m = inkCtx.measureText(text);
  const baseDp = Math.ceil((Math.ceil(m.fontBoundingBoxAscent) + 4) * scale);
  const width = Math.min(4096, Math.ceil((m.width + 8) * scale));
  const height = baseDp + Math.ceil((Math.ceil(m.fontBoundingBoxDescent) + 4) * scale);
  glyphCanvas ??= document.createElement("canvas");
  glyphCanvas.width = width;
  glyphCanvas.height = height;
  const ctx = glyphCanvas.getContext("2d", { willReadFrequently: true });
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#000";
  const base = baseDp / scale;
  ctx.fillText(text, 4, base);
  const data = ctx.getImageData(0, 0, width, height).data;
  let first = -1;
  let last = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 3; x < width * 4; x += 4) {
      if (data[y * width * 4 + x] > 48) {
        if (first < 0) first = y;
        last = y;
        break;
      }
    }
  }
  const result = first < 0 ? { top: -m.actualBoundingBoxAscent, bottom: m.actualBoundingBoxDescent } : { top: first / scale - base, bottom: (last + 1) / scale - base };
  glyphCache.set(key, result);
  return result;
}

export function measureInk(node, text = node.textContent.trim()) {
  if (!text) return null;
  const style = getComputedStyle(node);
  const box = node.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
  const base = Math.round((box.top + baseline(style, lineHeight, text)) * dpr) / dpr;
  const ink = glyphInk(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, text);
  return { top: base + ink.top, bottom: base + ink.bottom, contentTop: box.top, contentBottom: box.bottom };
}

export function centerBoardInk(root, ink = measureInk) {
  centerBoardNodes(root.querySelectorAll(BOARD_TEXTS), ink);
}

export function centerBoardNodes(nodes, ink = measureInk) {
  const list = [...nodes];
  for (const node of list) if (node.style.translate) node.style.translate = "";
  const moves = list.map((node) => {
    const box = ink(node);
    if (!box) return "";
    const shift = inkShift(box.contentTop, box.contentBottom, box);
    return shift && Math.abs(shift) < (box.contentBottom - box.contentTop) / 2 ? `0 ${shift}px` : "";
  });
  list.forEach((node, i) => {
    if (moves[i]) node.style.translate = moves[i];
  });
}
