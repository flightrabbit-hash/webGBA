import { EV, MSG_MAX, NetSession, PROTOCOL, SLOTS, STATE_MAX, TO_ALL, TO_ORDERED, WHY } from "./session.js";
import { BOARD_MIN_MS, BOARD_POLL_FRAMES, boardConfig, boardSerial, decodeRow, encodeRow, readBoard, sameBoard, scriptBoard } from "./board.js";
import { IcePlan } from "./ice.js";

export { EV, WHY, TO_ALL, TO_ORDERED, PROTOCOL, MSG_MAX, STATE_MAX };

export const FROM_STATE = 0x100;

export const WEBAPI_NET = Object.freeze(["Web_NetWanted", "Web_NetEvent", "Web_NetOut", "Web_NetOutLen", "Web_NetOutClear", "Web_NetInBuffer", "Web_NetIn"]);
export const HOST_FLAGS = 1;
export const HOST_REJOIN = 4;
export const WINDOW_MS = 180000;
export const CONNECTED_CLOSE_MS = 1000;

const INBOX_MAX = 4096;
const INBOX_BYTES = 8 * 1024 * 1024;
const OUT_MAX = 1 << 20;
const COMPAT_MAX = 64;

export function unpackWanted(value) {
  const v = value >>> 0;
  if (!v) return null;
  const min = (v >>> 8) & 15;
  const max = (v >>> 12) & 15;
  return { purpose: v & 0xff, min: min || 2, max: max || min || 2, role: (v >>> 16) & 3, serial: (v >>> 24) & 0xff };
}

export function packWanted({ purpose = 0, min = 2, max = 0, role = 0, serial = 1 }) {
  return ((purpose & 0xff) | ((min & 15) << 8) | ((max & 15) << 12) | ((role & 3) << 16) | ((serial & 0xff) << 24)) >>> 0;
}

export function netConfig(manifest) {
  const mp = manifest?.multiplayer;
  if (mp && typeof mp === "object" && Number.isInteger(mp.protocol) && mp.protocol > PROTOCOL) return { off: "protocol" };
  const clampN = (n, low, high, fallback) => (Number.isInteger(n) ? Math.max(low, Math.min(high, n)) : fallback);
  const pmin = clampN(mp?.players?.min, 2, SLOTS, 2);
  const pmax = Math.max(pmin, clampN(mp?.players?.max, 2, SLOTS, pmin));
  const list = Array.isArray(mp?.purposes) && mp.purposes.length ? mp.purposes : [{ id: "net", name: null }];
  const purposes = list.map((p, index) => {
    const range = Array.isArray(p?.players) && p.players.length === 2 ? p.players : null;
    const min = clampN(range?.[0], 2, SLOTS, pmin);
    const max = Math.max(min, clampN(range?.[1], 2, SLOTS, pmax));
    return { index: index + 1, id: typeof p?.id === "string" && p.id ? p.id : `p${index + 1}`, name: p?.name ?? null, min, max };
  });
  const compat = typeof mp?.compat === "string" && mp.compat ? mp.compat : "exact";
  return { off: "", purposes, compat, min: pmin, max: pmax, sync: mp?.sync === "inputs" ? "inputs" : "messages", rejoin: mp?.rejoin === true, anytime: mp?.join === "anytime", iceServers: mp?.iceServers };
}

export async function compatKey({ id = "", compat = "exact", build = "", game = "" }) {
  const base = `${id || "wasm"}|${compat === "exact" ? `b:${build}` : `c:${compat}`}|${game}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class WebApiNetGame {
  constructor(host, log) {
    this.host = host;
    this.log = log;
    this.inbox = [];
    this.inboxBytes = 0;
    this.script = false;
  }

  static supports(host) {
    return Boolean(host?.ex) && WEBAPI_NET.every((name) => typeof host.ex[name] === "function");
  }

  get ex() {
    return this.host.ex;
  }

  get alive() {
    return Boolean(this.host?.ex) && !this.host.halted;
  }

  hello(rejoin = false) {
    if (this.ex.Web_NetHost) this.call(() => this.ex.Web_NetHost(PROTOCOL, HOST_FLAGS | (rejoin ? HOST_REJOIN : 0)));
  }

  gameCompat() {
    if (!this.ex.Web_NetCompat) return "";
    const at = this.call(() => this.ex.Web_NetCompat() >>> 0) ?? 0;
    return at ? this.host.text(at).replace(/[^\x20-\x7e]/g, "").slice(0, COMPAT_MAX) : "";
  }

  call(fn) {
    if (!this.alive) return undefined;
    try {
      return fn();
    } catch (error) {
      this.log("warn", `게임 통신 함수 오류: ${error?.message ?? error}`);
      return undefined;
    }
  }

  wanted() {
    return this.call(() => this.ex.Web_NetWanted() >>> 0) ?? 0;
  }

  boardAt() {
    if (typeof this.ex.Web_NetBoard !== "function") return 0;
    return this.call(() => this.ex.Web_NetBoard() >>> 0) ?? 0;
  }

  event(kind, a, b) {
    this.call(() => this.ex.Web_NetEvent(kind, a >>> 0, b >>> 0));
  }

  drain() {
    const len = this.call(() => this.ex.Web_NetOutLen() >>> 0) ?? 0;
    if (!len) return [];
    const out = [];
    const at = this.call(() => this.ex.Web_NetOut() >>> 0) ?? 0;
    const m = this.host.u8;
    if (at && len <= OUT_MAX && at + len <= m.length) {
      for (let p = at, end = at + len; p + 4 <= end; ) {
        const n = m[p] | (m[p + 1] << 8);
        if (!n || n > MSG_MAX || p + 4 + n > end) break;
        out.push({ to: m[p + 2], part: m[p + 3], bytes: m.slice(p + 4, p + 4 + n) });
        p += 4 + ((n + 3) & ~3);
      }
    }
    this.call(() => this.ex.Web_NetOutClear());
    return out;
  }

  deliver(from, bytes, state = false) {
    if (this.inbox.length >= INBOX_MAX || this.inboxBytes + bytes.length > INBOX_BYTES) return false;
    this.inbox.push([state ? from | FROM_STATE : from, bytes]);
    this.inboxBytes += bytes.length;
    return true;
  }

  feed() {
    while (this.inbox.length && this.alive) {
      const [from, bytes] = this.inbox[0];
      const at = this.call(() => this.ex.Web_NetInBuffer(bytes.length) >>> 0) ?? 0;
      if (!at) return;
      const m = this.host.u8;
      if (at + bytes.length > m.length) return;
      m.set(bytes, at);
      this.call(() => this.ex.Web_NetIn(from, bytes.length));
      this.inbox.shift();
      this.inboxBytes -= bytes.length;
    }
  }

  clear() {
    this.inbox = [];
    this.inboxBytes = 0;
  }
}

export class ScriptNetGame {
  constructor(host) {
    this.host = host;
    this.script = true;
  }

  get alive() {
    return Boolean(this.host?.port) && !this.host.halted;
  }

  hello(rejoin = false) {
    this.host.netPost({ op: "hello", protocol: PROTOCOL, ordered: true, inputs: false, rejoin });
  }

  gameCompat() {
    return "";
  }

  event(kind, a, b) {
    this.host.netPost({ op: "event", kind, a: a >>> 0, b: b >>> 0 });
  }

  deliver(from, bytes, state = false) {
    const data = bytes.buffer.byteLength === bytes.length && bytes.byteOffset === 0 ? bytes.buffer : bytes.slice().buffer;
    this.host.netPost({ op: state ? "state" : "recv", from, data }, [data]);
    return true;
  }

  clear() {}
}

export class NetHost {
  constructor({ log = () => {}, onWant = () => {}, onChange = () => {}, onNotice = () => {}, onBoard = () => {}, makePeer = null, nick = () => "", enabled = () => true, fetchImpl = null } = {}) {
    this.log = log;
    this.onWant = onWant;
    this.onChange = onChange;
    this.onNotice = onNotice;
    this.onBoard = onBoard;
    this.makePeer = makePeer;
    this.nick = nick;
    this.enabled = enabled;
    this.fetchImpl = fetchImpl;
    this.icePlan = null;
    this.iceFailed = 0;
    this.stateOut = new Map();
    this.boardCfg = null;
    this.watching = false;
    this.resetBoard();
    this.game = null;
    this.config = null;
    this.compat = null;
    this.request = null;
    this.session = null;
    this.dismissed = -1;
    this.lastWanted = 0;
    this.scriptSerial = 0;
    this.windowTimer = 0;
    this.away = false;
    this.ended = null;
    this.failed = null;
  }

  get supported() {
    return Boolean(this.game) && !this.config?.off;
  }

  get active() {
    return Boolean(this.session && !this.session.closed);
  }

  get locked() {
    return this.active;
  }

  get connected() {
    return Boolean(this.session?.open);
  }

  get reached() {
    return Boolean(this.request && this.session?.open && this.session.count >= this.request.min);
  }

  get anytime() {
    return Boolean(this.config?.anytime);
  }

  get waiting() {
    return Boolean(this.session?.open && this.session.role === "make" && !this.reached);
  }

  get holding() {
    const s = this.session;
    return Boolean(s && !s.closed && s.rejoining && s.hostAway);
  }

  attach(host, { manifest = null, build = "" } = {}) {
    this.detach();
    if (!this.enabled()) {
      this.pending = { host, opts: { manifest, build } };
      return false;
    }
    let game = null;
    if (host?.script) {
      if (manifest?.multiplayer && typeof host.netPost === "function") game = new ScriptNetGame(host);
    } else if (WebApiNetGame.supports(host)) game = new WebApiNetGame(host, this.log);
    if (!game) return false;
    const config = netConfig(manifest);
    this.config = config;
    if (config.off) {
      this.log("warn", `멀티플레이 규약 ${manifest?.multiplayer?.protocol} 은 이 webGBA 가 모름 — 통신 없이 실행`);
      return false;
    }
    this.game = game;
    this.manifest = manifest;
    this.build = build;
    this.boardCfg = boardConfig(manifest);
    this.icePlan = new IcePlan({ manifestList: config.iceServers, fetchImpl: this.fetchImpl ?? ((...a) => globalThis.fetch(...a)), log: this.log });
    if (game.script) host.onNet = (message) => this.fromScript(message);
    game.hello(config.rejoin);
    this.compat = compatKey({ id: manifest?.id ?? "", compat: config.compat, build, game: game.gameCompat() });
    this.changed();
    return true;
  }

  detach() {
    this.pending = null;
    clearTimeout(this.windowTimer);
    this.windowTimer = 0;
    if (this.session && !this.session.closed) {
      const session = this.session;
      session.sink = { event() {}, deliver() {}, change() {} };
      session.close(WHY.LEFT);
    }
    if (this.game?.script && this.game.host) this.game.host.onNet = null;
    this.session = null;
    this.request = null;
    this.game = null;
    this.config = null;
    this.compat = null;
    this.dismissed = -1;
    this.lastWanted = 0;
    this.scriptSerial = 0;
    this.away = false;
    this.ended = null;
    this.failed = null;
    this.boardCfg = null;
    this.icePlan = null;
    this.iceFailed = 0;
    this.stateOut.clear();
    this.resetBoard();
    if (this.requestOpen) {
      this.requestOpen = false;
      this.onWant(null);
    }
    this.changed();
  }

  resetBoard() {
    clearTimeout(this.boardTimer);
    this.boardTimer = 0;
    this.board = null;
    this.boardPtr = -1;
    this.boardSeen = -1;
    this.boardFrames = 0;
    this.boardAt = 0;
    this.boardNext = undefined;
  }

  get boardOn() {
    return Boolean(this.boardCfg) && this.connected;
  }

  watchBoard(on) {
    this.watching = Boolean(on);
    if (this.watching) this.pollBoard();
  }

  openBoard() {
    if (!this.boardCfg || !this.game || this.game.script || this.boardPtr >= 0) return;
    this.boardPtr = this.game.boardAt();
    if (this.boardPtr && this.boardPtr + 400 > this.game.host.u8.length) {
      this.log("warn", `Web_NetBoard 위치가 wasm 메모리 밖(${this.boardPtr}) — 표를 쓰지 않음`);
      this.boardPtr = 0;
    }
  }

  pollBoard() {
    if (!this.boardOn || !this.game || this.game.script) return;
    this.openBoard();
    if (this.boardPtr <= 0) return;
    const u8 = this.game.host.u8;
    const serial = boardSerial(u8, this.boardPtr);
    if (serial < 0) {
      this.boardPtr = 0;
      return;
    }
    if (serial === this.boardSeen) return;
    this.boardSeen = serial;
    this.takeBoard(readBoard(u8, this.boardPtr).board ?? null);
  }

  takeBoard(board) {
    const wait = this.boardAt + BOARD_MIN_MS - Date.now();
    if (wait > 0) {
      this.boardNext = board;
      if (!this.boardTimer) this.boardTimer = setTimeout(() => {
        this.boardTimer = 0;
        const next = this.boardNext;
        this.boardNext = undefined;
        if (next !== undefined) this.takeBoard(next);
      }, wait);
      return;
    }
    this.boardAt = Date.now();
    if (sameBoard(this.board, board)) return;
    this.board = board;
    if (this.boardCfg?.scope === "self") this.pushRow();
    this.boardChanged();
  }

  pushRow() {
    const s = this.session;
    if (!s || s.closed) return;
    const row = this.board?.rows?.[0];
    s.setRow(row ? encodeRow({ ...row, slot: Math.max(0, s.slot) }) : null);
  }

  boardChanged() {
    try {
      this.onBoard();
    } catch (error) {
      this.log("warn", `상태 표 갱신 오류: ${error?.message ?? error}`);
    }
  }

  boardData() {
    const s = this.session;
    const selfRows = new Map();
    if (s && this.boardCfg?.scope === "self") for (const [slot, bytes] of s.rows) {
      const row = decodeRow(bytes, slot);
      if (row) selfRows.set(slot, row);
    }
    return { config: this.boardOn ? this.boardCfg : null, board: this.board, selfRows, gone: s?.gone ?? new Map() };
  }

  changed() {
    try {
      this.onChange(this.snapshot());
    } catch (error) {
      this.log("warn", `멀티플레이 화면 갱신 오류: ${error?.message ?? error}`);
    }
  }

  snapshot() {
    const s = this.session;
    return {
      supported: this.supported,
      request: this.request,
      active: this.active,
      connected: this.connected,
      reached: this.reached,
      anytime: this.anytime,
      waiting: this.waiting,
      role: s ? s.role : "",
      slot: s ? s.slot : -1,
      count: s ? s.count : 0,
      max: s ? s.max : this.request?.max ?? 0,
      members: s ? s.memberList() : [],
      ended: this.ended,
      failed: this.failed,
      rejoinable: Boolean(s?.rejoinable),
      rejoining: Boolean(s && !s.closed && s.rejoining),
      rejoinState: s && !s.closed && s.rejoining ? s.helper?.state ?? "" : "",
      hostWait: this.holding,
      hostLeft: this.holding ? s.hostLeft : 0,
      restored: Boolean(s?.restored && !s.closed),
      iceHosts: this.icePlan?.custom ? this.icePlan.hosts : [],
      iceFailed: this.iceFailed,
    };
  }

  useRelay(signal, proof) {
    this.icePlan?.setRelay(signal && proof ? { request: (body) => signal.turn(body), proof } : null);
  }

  async iceList() {
    const got = await this.icePlan.list(true);
    if (got.failed !== this.iceFailed) {
      this.iceFailed = got.failed;
      this.changed();
    }
    return got;
  }

  solo() {
    const s = this.session;
    if (!s || s.closed || !s.rejoining) return false;
    s.close(WHY.SOLO);
    return true;
  }

  rejoinNow() {
    const s = this.session;
    if (!s || s.closed || !s.rejoining) return false;
    s.helperCall("now");
    return true;
  }

  statePart(m) {
    if (!this.config?.rejoin || m.to >= SLOTS || (m.part !== 1 && m.part !== 2)) return;
    const list = this.stateOut.get(m.to) ?? [];
    list.push(m.bytes);
    const size = list.reduce((n, b) => n + b.length, 0);
    if (size > STATE_MAX) {
      this.stateOut.delete(m.to);
      this.log("warn", `상태 묶음이 ${STATE_MAX}바이트를 넘어 버림(자리 ${m.to})`);
      return;
    }
    if (m.part === 1) {
      this.stateOut.set(m.to, list);
      return;
    }
    this.stateOut.delete(m.to);
    const all = new Uint8Array(size);
    let at = 0;
    for (const b of list) {
      all.set(b, at);
      at += b.length;
    }
    if (!this.session?.sendState(m.to, all)) this.log("warn", `상태 묶음 보내기 실패(자리 ${m.to})`);
  }

  discard() {
    const s = this.session;
    if (!s || s.opened) return;
    s.sink = { event() {}, deliver() {}, change() {} };
    s.close(WHY.CANCEL);
    this.session = null;
    this.changed();
  }

  // 앱 종료(방장, 다시 들어오기 게임): 게임에 알리지 않고 세션을 접는다 — 유저는 방장을 기다린다
  park() {
    const s = this.session;
    if (!s || s.closed || s.role !== "make" || !s.park()) return false;
    s.sink = { event() {}, deliver() {}, change() {} };
    return true;
  }

  backRequest(back) {
    const purposes = this.config?.purposes ?? [];
    const purpose = purposes.find((p) => p.id === back.purpose);
    if (!purpose) return null;
    const max = Math.max(2, Math.min(purpose.max, back.max | 0));
    return { serial: -1, purpose, min: Math.min(max, Math.max(purpose.min, back.min | 0)), max, role: "any", restored: true };
  }

  offerBack(back) {
    if (this.active || !this.game || !this.config?.rejoin) return false;
    if (this.request && !this.request.restored) return true;
    const request = this.backRequest(back);
    if (!request) return false;
    this.request = request;
    this.changed();
    return true;
  }

  dropBack() {
    if (!this.request?.restored || this.active) return;
    this.request = null;
    this.changed();
  }

  async restore(back) {
    if (!this.game || !this.config?.rejoin) throw new Error("no game");
    const request = this.backRequest(back);
    if (!request) throw new Error("purpose");
    if (this.active) throw new Error("busy");
    if (!this.request || this.request.purpose.id !== request.purpose.id) this.request = request;
    else this.request = { ...this.request, max: request.max, restored: true };
    clearTimeout(this.windowTimer);
    this.windowTimer = 0;
    return this.open("make", { restore: back.slots });
  }

  drop() {
    const s = this.session;
    if (!s) return;
    s.sink = { event() {}, deliver() {}, change() {} };
    if (!s.closed) s.close(WHY.LEFT);
    this.session = null;
    this.changed();
  }

  beforeFrame() {
    if (!this.game || this.game.script) return;
    this.game.feed();
    const s = this.session;
    if (s?.backReady && s.backQueue.length && !this.game.inbox.length) s.flushBack();
  }

  afterFrame() {
    const game = this.game;
    if (!game || game.script) return;
    const out = game.drain();
    if (out.length && this.active) for (const m of out) m.part ? this.statePart(m) : this.session.send(m.to, m.bytes);
    const wanted = game.wanted();
    if (wanted !== this.lastWanted) {
      this.lastWanted = wanted;
      this.setRequest(this.requestOf(unpackWanted(wanted)));
    }
    if (this.boardCfg && (this.watching || this.boardCfg.scope === "self") && ++this.boardFrames >= BOARD_POLL_FRAMES) {
      this.boardFrames = 0;
      this.pollBoard();
    }
  }

  requestOf(w) {
    if (!w || !this.config || this.config.off) return null;
    const purposes = this.config.purposes;
    const purpose = (w.purpose ? purposes[w.purpose - 1] : purposes[0]) ?? purposes[0];
    const min = Math.max(purpose.min, Math.min(purpose.max, w.min));
    const max = Math.max(min, Math.min(purpose.max, w.max < w.min ? min : w.max));
    return { serial: w.serial, purpose, min, max, role: ["any", "make", "join"][w.role] ?? "any" };
  }

  fromScript(message) {
    if (!message || typeof message !== "object" || !this.game?.script) return;
    if (message.op === "want") {
      const purposes = this.config.purposes;
      const found = purposes.find((p) => p.id === message.purpose) ?? purposes[0];
      const serial = Number.isInteger(message.serial) ? message.serial & 0xff : ++this.scriptSerial & 0xff;
      const role = { make: 1, join: 2 }[message.role] ?? 0;
      this.setRequest(this.requestOf({ purpose: found.index, min: Number.isInteger(message.min) ? message.min : found.min, max: Number.isInteger(message.max) ? message.max : found.max, role, serial }));
    } else if (message.op === "unwant") {
      this.setRequest(null);
    } else if (message.op === "board") {
      if (!this.boardCfg) return;
      const board = scriptBoard(message.board);
      if (board !== undefined) this.takeBoard(board);
    } else if (message.op === "send") {
      if (!this.active) return;
      const to = message.to === "ordered" ? TO_ORDERED : message.to === "all" ? TO_ALL : message.to;
      if (!(message.data instanceof ArrayBuffer)) return;
      this.session.send(to, new Uint8Array(message.data));
    } else if (message.op === "state") {
      if (!this.active || !this.config?.rejoin || !(message.data instanceof ArrayBuffer)) return;
      if (!this.session.sendState(message.to, new Uint8Array(message.data))) this.log("warn", `상태 묶음 보내기 실패(자리 ${message.to})`);
    }
  }

  syncEnabled() {
    if (this.enabled()) {
      const wait = this.pending;
      if (!this.game && wait?.host && !wait.host.halted) this.attach(wait.host, wait.opts);
      return;
    }
    if (!this.request && !this.active) return;
    this.finish(WHY.CANCEL);
    this.setRequest(null);
  }

  setRequest(next) {
    if (next && !this.enabled()) next = null;
    const prev = this.request;
    if (prev && next && prev.serial === next.serial && prev.purpose.index === next.purpose.index) return;
    if (prev?.restored && next && this.active && prev.purpose.index === next.purpose.index) {
      this.request = next;
      this.changed();
      return;
    }
    if (this.session && !this.session.closed) this.session.close(WHY.LEFT);
    clearTimeout(this.windowTimer);
    this.windowTimer = 0;
    this.request = next;
    this.session = null;
    this.ended = null;
    this.failed = null;
    if (!next) {
      if (this.requestOpen) {
        this.requestOpen = false;
        this.onWant(null);
      }
      this.changed();
      return;
    }
    this.log("info", `멀티플레이 요청 ${next.serial}: ${next.purpose.id} ${next.min}~${next.max}명 · ${next.role}${this.anytime ? " · 중간 참가" : ""}`);
    if (this.anytime) {
      this.changed();
      return;
    }
    this.windowTimer = setTimeout(() => this.timeout(), WINDOW_MS);
    if (this.dismissed !== next.serial) {
      this.requestOpen = true;
      this.onWant(next);
    }
    this.changed();
  }

  timeout() {
    this.windowTimer = 0;
    if (!this.request || this.reached) return;
    this.finish(WHY.TIMEOUT);
  }

  finish(why) {
    if (this.session && !this.session.closed) this.session.close(why);
    else if (this.game) this.game.event(EV.CLOSED, why, 0);
    if (this.request) this.dismissed = this.request.serial;
    if (!this.session) {
      this.ended = { why };
      this.notice({ kind: "closed", why });
    }
    this.changed();
  }

  cancel() {
    this.finish(WHY.CANCEL);
  }

  sink(session) {
    return {
      event: (kind, a, b) => {
        if (this.session !== session) return;
        if (kind === EV.CLOSED && session.role === "join" && !session.opened && [WHY.NO_NETWORK, WHY.LOST, WHY.TIMEOUT].includes(a)) {
          this.session = null;
          this.failed = { why: a, at: Date.now(), hint: session.failHint ?? "" };
          this.log("warn", `참가 연결 실패(이유 ${a}) — 창에서 다시 시도`);
          this.changed();
          return;
        }
        if (kind === EV.CLOSED) {
          this.ended = { why: a };
          clearTimeout(this.windowTimer);
          this.windowTimer = 0;
          if (this.request) this.dismissed = this.request.serial;
          this.game?.clear();
        }
        this.game?.event(kind, a, b);
        if (kind === EV.JOIN || kind === EV.OPEN) {
          if (this.reached) {
            clearTimeout(this.windowTimer);
            this.windowTimer = 0;
          }
        }
        const nickOf = (slot) => session.members.get(slot)?.nick ?? `${slot + 1}P`;
        if (kind === EV.JOIN) this.notice({ kind: "join", slot: a, nick: nickOf(a), count: b });
        else if (kind === EV.LEAVE) this.notice({ kind: "leave", slot: a, nick: session.lastNick?.get(a) ?? `${a + 1}P`, why: b });
        else if (kind === EV.CLOSED) this.notice({ kind: "closed", why: a });
        else if (kind === EV.OPEN && session.role === "join") this.notice({ kind: "open", slot: a, count: b });
        else if (kind === EV.HOLD) this.notice(a === session.slot ? { kind: "rejoining" } : a === 0 && !session.host ? { kind: "hostWait" } : { kind: "hold", slot: a, nick: nickOf(a) });
        else if (kind === EV.BACK) this.notice(a === 0 ? { kind: "hostBack" } : { kind: "back", slot: a, nick: nickOf(a) });
        else if (kind === EV.REJOINED) this.notice(a === 0 ? { kind: "returned" } : session.awayBack ? { kind: "hostBack" } : { kind: "rejoined", slot: a });
        this.changed();
      },
      deliver: (from, bytes, state = false) => {
        if (this.session !== session || !this.game) return;
        if (!this.game.deliver(from, bytes, state)) {
          this.log("warn", "받은 메시지가 너무 많이 쌓여 연결을 끊음");
          session.close(WHY.LOST);
        }
      },
      backReady: () => {
        if (this.session === session && this.game?.script) session.flushBack();
      },
      change: () => {
        if (this.session !== session) return;
        session.lastNick ??= new Map();
        for (const [slot, m] of session.members) session.lastNick.set(slot, m.nick);
        this.changed();
      },
    };
  }

  notice(info) {
    try {
      this.onNotice(info);
    } catch {}
  }

  async open(role, { restore = null } = {}) {
    if (!this.request || !this.game) throw new Error("no request");
    if (this.session && !this.session.closed) return this.session;
    const compat = await this.compat;
    this.icePlan?.setRelay(null);
    const plan = this.icePlan;
    const session = new NetSession({
      role,
      nick: this.nick(),
      max: this.request.max,
      compat,
      purpose: this.request.purpose.id,
      log: this.log,
      makePeer: this.makePeer,
      wan: true,
      turn: Boolean(plan?.turn),
      ice: plan ? () => this.iceList() : null,
      warm: plan && !plan.custom ? () => plan.defaultRelay() : null,
      rejoinGame: Boolean(this.config?.rejoin),
    });
    this.session = session;
    this.stateOut.clear();
    this.ended = null;
    this.failed = null;
    if (!this.game.script) this.resetBoard();
    session.sink = this.sink(session);
    session.setAway(this.away);
    if (this.boardCfg?.scope === "self" && this.board) this.pushRow();
    if (restore) {
      if (!session.restore(restore)) {
        this.drop();
        throw new Error("restore");
      }
    } else if (role === "make") session.start();
    this.changed();
    return session;
  }

  leave() {
    if (this.session && !this.session.closed) this.session.close(WHY.LEFT);
  }

  resetGame() {
    if (!this.game) return;
    this.setRequest(null);
    this.lastWanted = 0;
    this.dismissed = -1;
    this.game.clear();
    if (!this.game.script) this.game.hello(Boolean(this.config?.rejoin));
  }

  setAway(on) {
    this.away = Boolean(on);
    this.session?.setAway(this.away);
  }

  windowClosed() {
    this.requestOpen = false;
  }

  reopen() {
    if (!this.request) return false;
    this.requestOpen = true;
    this.onWant(this.request);
    return true;
  }
}
