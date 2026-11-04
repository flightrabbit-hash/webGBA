import { pickText } from "../lang-text.js";

export const BOARD_BYTES = 400;
export const BOARD_HEAD = 16;
export const ROW_BYTES = 48;
export const ROWS_MAX = 8;
export const COLS_MAX = 6;
export const NAME_BYTES = 20;
export const NOT_HUMAN = 0xff;
export const BOARD_MIN_MS = 250;
export const BOARD_POLL_FRAMES = 15;
export const NICK_SHOW = 12;
export const NAME_SHOW = 16;

const SLOTS = 8;
const TYPES = ["bar", "number", "rank", "status"];
const TONES = ["normal", "good", "warn", "bad", "dim"];
const ID_RE = /^[a-z0-9-]{1,16}$/;
const STRIP = /[\p{Cc}​-‏‪-‮⁠-⁯﻿]/gu;
const utf8 = new TextDecoder("utf-8", { fatal: false });
const utf8Out = new TextEncoder();

export function cleanText(text, max) {
  const value = String(text ?? "")
    .replace(STRIP, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : value;
}

const isText = (value) => typeof value === "string" || (value && typeof value === "object" && !Array.isArray(value) && Object.values(value).some((v) => typeof v === "string"));
const int = (value, low, high, fallback) => (Number.isInteger(value) && value >= low && value <= high ? value : fallback);

export function boardConfig(manifest) {
  const b = manifest?.multiplayer?.board;
  if (!b || typeof b !== "object" || Array.isArray(b) || !Array.isArray(b.columns) || !b.columns.length) return null;
  const columns = b.columns.slice(0, COLS_MAX).map((c) => {
    if (!c || typeof c !== "object" || !TYPES.includes(c.type) || !isText(c.name)) return { type: "none" };
    const col = { id: typeof c.id === "string" && ID_RE.test(c.id) ? c.id : "", type: c.type, name: c.name };
    if (c.type === "bar") {
      col.max = int(c.max, 1, 65535, 0);
      col.tone = c.tone === "hp" ? "hp" : "accent";
    } else if (c.type === "number") {
      col.prefix = isText(c.prefix) ? c.prefix : "";
      col.suffix = isText(c.suffix) ? c.suffix : "";
    } else if (c.type === "status") {
      col.labels = (Array.isArray(c.labels) ? c.labels.slice(0, 15) : []).map((l) => ({ name: l && isText(l.name) ? l.name : "", tone: TONES.includes(l?.tone) ? l.tone : "normal", dimRow: l?.dimRow === true }));
    }
    return col;
  });
  if (!columns.some((c) => c.type !== "none")) return null;
  const texts = (list, n) => (Array.isArray(list) ? list.slice(0, n).map((v) => (isText(v) ? v : "")) : []);
  const sortAt = b.sort && typeof b.sort === "object" ? columns.findIndex((c) => c.id && c.id === b.sort.column) : -1;
  return {
    columns,
    names: texts(b.names, 32),
    captions: texts(b.captions, 16),
    mark: isText(b.mark) ? b.mark : "",
    scope: b.scope === "self" ? "self" : "all",
    sort: sortAt >= 0 ? { index: sortAt, desc: b.sort.order !== "asc" } : null,
  };
}

export function checkBoard(board, errors, warnings) {
  if (!board || typeof board !== "object" || Array.isArray(board)) return errors.push("multiplayer.board 가 객체가 아닙니다");
  const textOk = (value, max) => (typeof value === "string" ? value.length >= 1 && [...value].length <= max : value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0 && Object.values(value).every((v) => typeof v === "string" && v.length >= 1 && [...v].length <= max));
  if (!Array.isArray(board.columns) || board.columns.length < 1 || board.columns.length > COLS_MAX) errors.push(`multiplayer.board.columns 는 1~${COLS_MAX}개`);
  const ids = new Set();
  for (const [i, c] of (Array.isArray(board.columns) ? board.columns : []).entries()) {
    const at = `multiplayer.board.columns[${i}]`;
    if (!c || typeof c !== "object") {
      errors.push(`${at} 가 객체가 아닙니다`);
      continue;
    }
    if (typeof c.id !== "string" || !ID_RE.test(c.id) || ids.has(c.id)) errors.push(`${at}.id 가 규칙 밖이거나 겹칩니다: ${c.id}`);
    ids.add(c.id);
    if (!TYPES.includes(c.type)) errors.push(`${at}.type 이 bar·number·rank·status 가 아닙니다: ${c.type}`);
    if (!textOk(c.name, 12)) errors.push(`${at}.name 이 없거나 12자를 넘습니다`);
    if (c.type === "bar" && !(Number.isInteger(c.max) && c.max >= 1 && c.max <= 65535)) errors.push(`${at}.max 는 1~65535 정수(bar)`);
    if (c.tone !== undefined && !["hp", "accent"].includes(c.tone)) errors.push(`${at}.tone 이 hp·accent 가 아닙니다: ${c.tone}`);
    for (const key of ["prefix", "suffix"]) if (c[key] !== undefined && !textOk(c[key], 4)) errors.push(`${at}.${key} 는 4자 이하`);
    if (c.type === "status") {
      if (!Array.isArray(c.labels) || c.labels.length < 1 || c.labels.length > 15) errors.push(`${at}.labels 는 1~15개(status)`);
      for (const [j, l] of (Array.isArray(c.labels) ? c.labels : []).entries()) {
        if (!l || !textOk(l.name, 8)) errors.push(`${at}.labels[${j}].name 이 없거나 8자를 넘습니다`);
        if (l?.tone !== undefined && !TONES.includes(l.tone)) errors.push(`${at}.labels[${j}].tone 이 규칙 밖입니다: ${l.tone}`);
      }
    }
  }
  if (board.names !== undefined && (!Array.isArray(board.names) || board.names.length < 1 || board.names.length > 32 || !board.names.every((n) => textOk(n, 16)))) errors.push("multiplayer.board.names 는 1~32개, 각 16자 이하");
  if (board.captions !== undefined && (!Array.isArray(board.captions) || board.captions.length < 1 || board.captions.length > 16 || !board.captions.every((n) => textOk(n, 24)))) errors.push("multiplayer.board.captions 는 1~16개, 각 24자 이하");
  if (board.mark !== undefined && !textOk(board.mark, 8)) errors.push("multiplayer.board.mark 는 8자 이하");
  if (board.scope !== undefined && !["all", "self"].includes(board.scope)) errors.push(`multiplayer.board.scope 가 all·self 가 아닙니다: ${board.scope}`);
  if (board.sort !== undefined && (!board.sort || !ids.has(board.sort.column) || (board.sort.order !== undefined && !["asc", "desc"].includes(board.sort.order)))) errors.push("multiplayer.board.sort.column 이 열 id 가 아니거나 order 가 asc·desc 가 아닙니다");
  for (const key of Object.keys(board)) if (!["columns", "names", "captions", "mark", "scope", "sort"].includes(key)) warnings.push(`multiplayer.board 의 모르는 키(무시): ${key}`);
  return undefined;
}

export function boardSerial(u8, ptr) {
  if (!ptr || ptr + BOARD_BYTES > u8.length) return -1;
  return (u8[ptr] | (u8[ptr + 1] << 8) | (u8[ptr + 2] << 16) | (u8[ptr + 3] << 24)) >>> 0;
}

function readRow(u8, at) {
  const slot = u8[at];
  if (slot >= SLOTS && slot !== NOT_HUMAN) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset + at, ROW_BYTES);
  const flags = u8[at + 1];
  const nameLen = u8[at + 3];
  const values = [];
  for (let i = 0; i < COLS_MAX; i++) values.push(dv.getInt32(4 + i * 4, true));
  const name = nameLen > 0 && nameLen <= NAME_BYTES ? cleanText(utf8.decode(u8.subarray(at + 28, at + 28 + nameLen)), NAME_SHOW) : "";
  return { slot: slot === NOT_HUMAN ? null : slot, dim: Boolean(flags & 1), mark: Boolean(flags & 2), nameLabel: u8[at + 2], name, values };
}

export function readBoard(u8, ptr) {
  const serial = boardSerial(u8, ptr);
  if (serial < 0) return { off: true };
  if (!serial) return { serial: 0, board: null };
  const copy = u8.slice(ptr, ptr + BOARD_BYTES);
  if (copy[4] !== 1 || copy[5] > ROWS_MAX) return { serial, board: null, bad: true };
  const dv = new DataView(copy.buffer);
  const rows = [];
  for (let i = 0; i < copy[5]; i++) {
    const row = readRow(copy, BOARD_HEAD + i * ROW_BYTES);
    if (row) rows.push(row);
  }
  return { serial, board: { final: Boolean(copy[6] & 1), caption: copy[7], args: [dv.getInt32(8, true), dv.getInt32(12, true)], rows } };
}

const s32 = (value) => (Number.isInteger(value) && value >= -0x80000000 && value <= 0xffffffff ? value | 0 : 0);

function scriptValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const now = int(value.value, 0, 65535, 0);
    const max = int(value.max, 0, 65535, 0);
    return (now | (max << 16)) | 0;
  }
  return s32(value);
}

export function scriptBoard(input) {
  if (input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input) || !Array.isArray(input.rows)) return undefined;
  const rows = input.rows.slice(0, ROWS_MAX).map((r) => {
    if (!r || typeof r !== "object") return null;
    const human = Number.isInteger(r.slot) && r.slot >= 0 && r.slot < SLOTS;
    return {
      slot: human ? r.slot : null,
      dim: r.dim === true,
      mark: r.mark === true,
      nameLabel: int(r.nameLabel, 0, 255, 0),
      name: typeof r.name === "string" ? cleanText(r.name, NAME_SHOW) : "",
      values: (Array.isArray(r.values) ? r.values.slice(0, COLS_MAX) : []).map(scriptValue).concat(new Array(COLS_MAX).fill(0)).slice(0, COLS_MAX),
    };
  });
  const args = Array.isArray(input.args) ? input.args : [];
  return { final: input.final === true, caption: int(input.caption, 0, 255, 0), args: [s32(args[0]), s32(args[1])], rows: rows.filter(Boolean) };
}

export const sameBoard = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function encodeRow(row) {
  const out = new Uint8Array(ROW_BYTES);
  if (!row) return out;
  const dv = new DataView(out.buffer);
  out[0] = row.slot ?? NOT_HUMAN;
  out[1] = (row.dim ? 1 : 0) | (row.mark ? 2 : 0);
  out[2] = row.nameLabel & 0xff;
  const name = utf8Out.encode(row.name ?? "").subarray(0, NAME_BYTES);
  out[3] = name.length;
  for (let i = 0; i < COLS_MAX; i++) dv.setInt32(4 + i * 4, row.values?.[i] | 0, true);
  out.set(name, 28);
  return out;
}

export function decodeRow(bytes, slot) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== ROW_BYTES) return null;
  const row = readRow(bytes, 0);
  if (!row) return null;
  return { ...row, slot, name: "" };
}

function barParts(raw, col) {
  const now = raw & 0xffff;
  const max = (raw >>> 16) & 0xffff || col.max || 0;
  const value = max ? Math.min(now, max) : now;
  return { value, max, ratio: max ? value / max : 0 };
}

export function rankText(n, lang) {
  if (lang === "en") {
    const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
    return `${n}${s}`;
  }
  return lang === "ja" ? `${n}位` : `${n}위`;
}

export function fillCaption(text, args) {
  return text.replace(/\{([01])\}/g, (_, i) => String(args?.[Number(i)] ?? ""));
}

function cellOf(col, raw, lang) {
  if (col.type === "bar") {
    const p = barParts(raw, col);
    const tone = col.tone === "hp" ? (p.ratio > 0.5 ? "" : p.ratio > 0.25 ? "mid" : "low") : "accent";
    return { type: "bar", value: p.value, max: p.max, ratio: p.ratio, tone };
  }
  if (col.type === "number") {
    const prefix = cleanText(pickText(col.prefix, lang), 4);
    const suffix = cleanText(pickText(col.suffix, lang), 4);
    return { type: "number", text: `${prefix}${raw}${suffix}`, label: prefix || suffix ? "" : cleanText(pickText(col.name, lang), 12) };
  }
  if (col.type === "rank") return { type: "rank", text: raw >= 1 && raw <= 99 ? rankText(raw, lang) : "" };
  if (col.type === "status") {
    const label = raw >= 1 ? col.labels?.[raw - 1] : null;
    return { type: "status", text: label ? cleanText(pickText(label.name, lang), 8) : "", tone: label?.tone ?? "", dimRow: Boolean(label?.dimRow) };
  }
  return { type: "none" };
}

function sortValue(raw, col) {
  return col.type === "bar" ? raw & 0xffff : raw;
}

export function connOf(member, { me, hostRow }) {
  if (!member) return { kind: "lost" };
  if (member.held) return { kind: "hold" };
  if (member.rejoining) return { kind: "rejoin" };
  if (member.stalled) return { kind: "stall" };
  if (hostRow) return { kind: "ok" };
  if (!Number.isFinite(member.rtt)) return { kind: me ? "ok" : "joining" };
  const ms = Math.round(member.rtt);
  return { kind: "ok", ms, q: ms <= 50 ? "good" : ms <= 150 ? "fair" : "poor", ...(member.turn ? { turn: true } : {}) };
}

export function boardView({ config = null, board = null, selfRows = null, members = [], gone = new Map(), slot = -1, lang = "ko" }) {
  const bySlot = new Map(members.map((m) => [m.slot, m]));
  const human = (s) => {
    const m = bySlot.get(s);
    const left = gone.get(s);
    const name = m ? cleanText(m.nick, NICK_SHOW) : left ? cleanText(left.nick, NICK_SHOW) : `${s + 1}P`;
    const conn = m ? connOf(m, { me: s === slot, hostRow: s === 0 }) : { kind: left?.left ? "left" : "lost" };
    return { human: true, slot: s, seat: `${s + 1}P`, name, me: s === slot, host: s === 0, conn };
  };
  let source = null;
  if (config && config.scope === "self" && selfRows) source = members.map((m) => selfRows.get(m.slot) ?? { slot: m.slot, values: null, dim: false, mark: false });
  else if (config && board?.rows?.length) source = board.rows;
  const columns = config && source ? config.columns : [];
  let rows;
  if (source) {
    rows = source.map((r, i) => {
      const base = r.slot !== null && r.slot !== undefined ? human(r.slot) : { human: false, slot: null, seat: "AI", name: cleanText(r.nameLabel ? pickText(config.names[r.nameLabel - 1], lang) : r.name, NAME_SHOW) || "AI", me: false, host: false, conn: null };
      const cells = r.values ? columns.map((col, c) => cellOf(col, r.values[c] | 0, lang)) : columns.map(() => ({ type: "empty" }));
      const dim = Boolean(r.dim) || cells.some((c) => c.dimRow && c.text);
      return { ...base, key: base.human ? `p${base.slot}` : `a${i}`, dim, mark: Boolean(r.mark), cells, raw: r.values };
    });
    if (config.sort) {
      const col = columns[config.sort.index];
      const dir = config.sort.desc ? -1 : 1;
      rows = rows.map((r, i) => [r, i]).sort((a, b) => (a[0].raw && b[0].raw ? (sortValue(a[0].raw[config.sort.index] | 0, col) - sortValue(b[0].raw[config.sort.index] | 0, col)) * dir : a[0].raw ? -1 : b[0].raw ? 1 : 0) || a[1] - b[1]).map((x) => x[0]);
    }
  } else rows = members.map((m) => ({ ...human(m.slot), key: `p${m.slot}`, dim: false, mark: false, cells: [] }));
  const shown = columns.map((col, c) => col.type !== "none" && (col.type !== "status" || rows.some((r) => r.cells[c]?.text)));
  const caption = config && board?.caption && source ? cleanText(fillCaption(pickText(config.captions[board.caption - 1], lang), board.args), 24) : "";
  return {
    plain: !source,
    columns: columns.map((col, c) => ({ type: col.type, shown: shown[c], name: cleanText(pickText(col.name, lang), 12) })),
    rows,
    caption,
    final: Boolean(board?.final),
    mark: config && source && rows.some((r) => r.mark) ? cleanText(pickText(config.mark, lang), 8) : "",
    people: members.length,
    ai: rows.filter((r) => !r.human).length,
  };
}
