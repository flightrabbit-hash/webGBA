import { CodeError, RTC_CONFIG, decodeCode, encodeCode, rtcConfig, selectedPair, waitGathering } from "./lan.js";
import { ROW_BYTES } from "./board.js";

export const PROTOCOL = 1;
export const EV = Object.freeze({ OPEN: 1, JOIN: 2, LEAVE: 3, CLOSED: 4, STALL: 5, RESUME: 6, HOLD: 7, BACK: 8, REJOINED: 9 });
export const WHY = Object.freeze({ CANCEL: 1, TIMEOUT: 2, INCOMPATIBLE: 3, LOST: 4, FULL: 5, LEFT: 6, HOST_LEFT: 7, NO_NETWORK: 8, SOLO: 9 });
export const TO_ORDERED = 0xfe;
export const TO_ALL = 0xff;
export const MSG_MAX = 16384;
export const STATE_MAX = 262144;
export const SLOTS = 8;
export const NICK_MAX = 16;
export const LOST_MS = 15000;

const K_HELLO = 1;
const K_WELCOME = 2;
const K_REJECT = 3;
const K_MEMBERS = 4;
const K_READY = 5;
const K_DATA = 0x10;
const K_PAUSE = 0x11;
const K_BYE = 0x12;
const K_PING = 0x13;
const K_PONG = 0x14;
const K_ROW = 0x15;
const K_STATE = 0x16;

const HEARTBEAT_MS = 500;
const STALL_MS = 1500;
const AWAY_MS = 15000;
const CONNECT_MS = 25000;
const READY_MS = 10000;
const MEMBERS_MS = 2000;
const RESTART_MS = 3000;
const RTT_STEP = 3;
const CTL_MAX = 8192;
const SYM_NOTE = " · 공인 주소가 STUN 서버마다 다름(대칭 NAT로 보임)";
const STATE_CHUNK = MSG_MAX;

export class SessionError extends Error {
  constructor(code, why = 0) {
    super(code);
    this.code = code;
    this.why = why;
  }
}

const utf8 = new TextEncoder();
const utf8Read = new TextDecoder();

const NICK_BAD = new RegExp(`[${[[0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069]].map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join("")}]`, "g");
export function cleanNick(text, fallback = "") {
  const value = String(text ?? "")
    .replace(NICK_BAD, "")
    .replace(/\s+/g, " ")
    .trim();
  return [...value].slice(0, NICK_MAX).join("") || fallback;
}

function ctl(kind, obj) {
  const body = utf8.encode(JSON.stringify(obj));
  const out = new Uint8Array(1 + body.length);
  out[0] = kind;
  out.set(body, 1);
  return out;
}

function readCtl(bytes) {
  if (bytes.length > CTL_MAX) return null;
  try {
    const value = JSON.parse(utf8Read.decode(bytes.subarray(1)));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function dataPacket(from, to, seq, payload) {
  const p = new Uint8Array(8 + payload.length);
  p[0] = K_DATA;
  p[1] = from;
  p[2] = to;
  new DataView(p.buffer).setUint32(4, seq >>> 0, true);
  p.set(payload, 8);
  return p;
}

export function statePackets(from, to, bytes) {
  const out = [];
  for (let at = 0; at < bytes.length; at += STATE_CHUNK) {
    const part = bytes.subarray(at, at + STATE_CHUNK);
    const p = new Uint8Array(8 + part.length);
    p[0] = K_STATE;
    p[1] = from;
    p[2] = to;
    p[3] = (at === 0 ? 1 : 0) | (at + STATE_CHUNK >= bytes.length ? 2 : 0);
    new DataView(p.buffer).setUint32(4, bytes.length, true);
    p.set(part, 8);
    out.push(p);
  }
  return out;
}

function rejoinKey() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const validTo = (to) => (Number.isInteger(to) && to >= 0 && to < SLOTS) || to === TO_ORDERED || to === TO_ALL;

export class NetSession {
  constructor({ role, nick, max = 2, compat = "", purpose = "", sink, log = () => {}, rtc = RTC_CONFIG, ice = null, wan = false, turn = false, rejoinGame = false, makePeer = null, now = () => performance.now() }) {
    this.role = role === "make" ? "make" : "join";
    this.nick = cleanNick(nick, "?");
    this.max = Math.max(2, Math.min(SLOTS, max | 0));
    this.compat = String(compat);
    this.purpose = String(purpose);
    this.sink = sink;
    this.log = log;
    this.rtc = rtc;
    this.ice = ice;
    this.wan = Boolean(wan);
    this.turn = Boolean(turn);
    this.cfg = 0;
    this.symSelf = false;
    this.peerWan = false;
    this.rejoinGame = Boolean(rejoinGame);
    this.helper = null;
    this.rejoinKey = "";
    this.rejoining = false;
    this.rejoinSince = 0;
    this.makePeer = makePeer ?? ((config) => new RTCPeerConnection(config));
    this.now = now;
    this.slot = this.role === "make" ? 0 : -1;
    this.members = new Map();
    this.links = new Map();
    this.invites = new Map();
    this.used = new Set();
    this.inviteSeq = 0;
    this.seq = 0;
    this.closed = false;
    this.why = 0;
    this.opened = false;
    this.away = false;
    this.link = null;
    this.lastMembers = "";
    this.membersAt = 0;
    this.lastBeat = 0;
    this.stats = { sent: 0, recv: 0, relayed: 0, dropped: 0, restarts: 0, rejoins: 0 };
    this.gone = new Map();
    this.rows = new Map();
    this.stateIn = new Map();
    this.myRow = null;
    this.timer = setInterval(() => this.beat(), HEARTBEAT_MS);
  }

  get rejoinable() {
    return this.rejoinGame && Boolean(this.helper?.rejoin) && (this.host || Boolean(this.rejoinKey));
  }

  helperCall(kind) {
    try {
      this.helper?.trouble?.(kind);
    } catch (error) {
      this.log("warn", `다시 연결 도우미 오류(${kind}): ${error?.message ?? error}`);
    }
  }

  rowPacket(from, bytes) {
    const out = new Uint8Array(4 + (bytes ? ROW_BYTES : 0));
    out[0] = K_ROW;
    out[1] = from;
    if (bytes) out.set(bytes, 4);
    return out;
  }

  storeRow(slot, bytes) {
    if (bytes) this.rows.set(slot, bytes.slice());
    else this.rows.delete(slot);
  }

  setRow(bytes) {
    if (bytes && (!(bytes instanceof Uint8Array) || bytes.length !== ROW_BYTES)) return false;
    this.myRow = bytes ? bytes.slice() : null;
    if (!this.open) return false;
    this.storeRow(this.slot, this.myRow);
    const packet = this.rowPacket(this.slot, this.myRow);
    if (this.host) for (const l of this.links.values()) l.ready && this.sendTo(l, packet);
    else this.sendTo(this.link, packet);
    this.changed();
    return true;
  }

  takeRow(from, b) {
    if (from < 0 || from >= SLOTS || (b.length !== 4 && b.length !== 4 + ROW_BYTES)) return false;
    this.storeRow(from, b.length === 4 ? null : b.subarray(4));
    this.changed();
    return true;
  }

  get host() {
    return this.role === "make";
  }

  get count() {
    return this.members.size;
  }

  get open() {
    return this.opened && !this.closed;
  }

  get idle() {
    if (this.closed) return false;
    if (!this.host) return !this.opened && !this.link;
    return this.count <= 1 && ![...this.invites.values()].some((l) => l.state === "connecting" || l.state === "welcomed");
  }

  setWan({ wan, turn = false, ice = null }) {
    if (!this.idle) return false;
    this.wan = Boolean(wan);
    this.turn = Boolean(turn);
    this.ice = ice;
    this.cfg++;
    this.changed();
    return true;
  }

  memberList() {
    return [...this.members.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([slot, m]) => ({ slot, nick: m.nick, me: slot === this.slot, host: slot === 0, stalled: Boolean(m.stalled), away: Boolean(m.away), held: Boolean(m.held), rejoining: slot === this.slot && this.rejoining, rtt: Number.isFinite(m.rtt) ? m.rtt : null }));
  }

  attention() {
    if (!this.host) return [];
    const out = [];
    for (const [slot, m] of this.members) {
      if (slot === 0) continue;
      const pc = this.links.get(slot)?.pc;
      if (m.held || m.stalled || ["disconnected", "failed"].includes(pc?.connectionState)) out.push(slot);
    }
    return out;
  }

  emit(kind, a = 0, b = 0) {
    try {
      this.sink.event(kind, a, b);
    } catch (error) {
      this.log("warn", `사건 전달 실패 ${kind}: ${error?.message ?? error}`);
    }
  }

  changed() {
    try {
      this.sink.change?.();
    } catch {}
  }

  async rtcNow() {
    if (!this.ice) return this.rtc;
    const got = await this.ice();
    return rtcConfig(got?.iceServers ?? []);
  }

  async peer() {
    return this.makePeer(await this.rtcNow());
  }

  async refreshIce(pc) {
    if (!this.ice || typeof pc.setConfiguration !== "function") return;
    try {
      const next = await this.rtcNow();
      pc.setConfiguration({ ...pc.getConfiguration(), iceServers: next.iceServers });
    } catch {}
  }

  gathering(pc, fresh = false) {
    return waitGathering(pc, { wan: this.wan, turn: this.turn, fresh });
  }

  start() {
    if (!this.host) return;
    this.members.set(0, { nick: this.nick, lastSeen: this.now(), rtt: null });
    this.opened = true;
    if (this.myRow) this.storeRow(0, this.myRow);
    this.emit(EV.OPEN, 0, 1);
    this.changed();
  }

  async invite() {
    if (!this.host || this.closed) throw new SessionError("closed");
    const waiting = [...this.invites.values()].filter((l) => l.state !== "dead" && !l.rejoin).length;
    if (this.count + waiting >= this.max) throw new SessionError("full", WHY.FULL);
    const link = { id: ++this.inviteSeq, pc: null, dc: null, slot: -1, ready: false, state: "invite", created: this.now(), lastSeen: this.now(), pair: null, cfg: this.cfg };
    this.invites.set(link.id, link);
    try {
      const pc = await this.peer();
      link.pc = pc;
      if (this.closed || link.state === "dead") throw new SessionError("closed");
      const dc = pc.createDataChannel("webgba-net", { ordered: true });
      link.dc = dc;
      dc.binaryType = "arraybuffer";
      dc.onmessage = (event) => this.onHostMessage(link, new Uint8Array(event.data));
      dc.onopen = () => {
        link.lastSeen = this.now();
        link.pair = selectedPair(pc).catch(() => null);
      };
      dc.onclose = () => this.onHostClose(link);
      pc.onconnectionstatechange = () => this.onHostState(link);
      await pc.setLocalDescription(await pc.createOffer());
      await this.gathering(pc);
      if (this.closed || link.state === "dead") throw new SessionError("closed");
      const code = encodeCode(pc.localDescription.sdp, "", { wan: this.wan });
      if (!code.kept) throw new SessionError("noLan", WHY.NO_NETWORK);
      link.code = code.code;
      link.ufrag = code.ufrag;
      link.sym = code.sym;
      this.log("info", `초대 ${link.id}: 후보 ${code.kept}개(공인 ${code.public}, 버림 ${code.dropped}) · 코드 ${code.code.length}자${code.sym ? SYM_NOTE : ""}`);
      return { id: link.id, code: code.code, public: code.public, cfg: link.cfg };
    } catch (error) {
      this.killLink(link);
      link.state = "dead";
      this.invites.delete(link.id);
      throw error instanceof SessionError || error instanceof CodeError ? error : new SessionError("rtc", WHY.NO_NETWORK);
    }
  }

  async accept(id, text) {
    const link = this.invites.get(id);
    if (!link || link.state !== "invite") throw new SessionError("used");
    const desc = decodeCode(text, "answer", { wan: this.wan });
    if (!desc.kept) throw new SessionError(desc.skipped ? "wanOff" : "noLan", WHY.NO_NETWORK);
    if (this.used.has(desc.ufrag)) throw new SessionError("used");
    if (desc.ref && desc.ref !== link.ufrag) throw new SessionError("mismatch");
    this.used.add(desc.ufrag);
    link.state = "connecting";
    link.peerWan = desc.wan;
    link.peerSym = desc.sym;
    if (desc.sym) this.log("info", `초대 ${link.id}: 유저 답 코드${SYM_NOTE}`);
    const done = new Promise((resolve, reject) => {
      link.resolve = resolve;
      link.reject = reject;
      link.timer = setTimeout(() => this.failInvite(link, this.failCode(desc, link.sym), WHY.NO_NETWORK), CONNECT_MS);
    });
    try {
      await link.pc.setRemoteDescription({ type: "answer", sdp: desc.sdp });
    } catch {
      this.failInvite(link, "bad");
    }
    return done;
  }

  failCode(desc, self = false) {
    if (!this.wan && (desc.wan || desc.skipped)) return "wanOff";
    if (this.wan && !desc.wan) return "peerLan";
    if (this.wan && self) return "wanSym";
    if (this.wan && desc.sym) return "peerSym";
    return this.wan ? "wanFailed" : "lanFailed";
  }

  cancelInvite(id) {
    const link = this.invites.get(id);
    if (!link || link.state === "joined") return;
    this.failInvite(link, "cancel");
  }

  failInvite(link, code, why = 0) {
    if (link.state === "dead" || link.state === "joined") return;
    link.state = "dead";
    clearTimeout(link.timer);
    this.invites.delete(link.id);
    this.killLink(link);
    link.reject?.(new SessionError(code, why));
    this.changed();
  }

  killLink(link, delay = 0) {
    const shut = () => {
      try {
        link.dc?.close();
      } catch {}
      try {
        link.pc?.close();
      } catch {}
    };
    if (delay) setTimeout(shut, delay);
    else shut();
  }

  retire(link) {
    if (!link) return;
    link.state = "dead";
    link.ready = false;
    clearTimeout(link.timer);
    if (link.dc) link.dc.onclose = link.dc.onmessage = link.dc.onopen = null;
    if (link.pc) link.pc.onconnectionstatechange = link.pc.ondatachannel = null;
    this.killLink(link);
  }

  freeSlot() {
    const welcomed = new Set([...this.invites.values()].filter((l) => l.state === "welcomed").map((l) => l.slot));
    for (let s = 1; s < this.max; s++) if (!this.members.has(s) && !welcomed.has(s)) return s;
    return -1;
  }

  pairOk(pair) {
    return !pair || pair.lan || this.wan;
  }

  async onHostMessage(link, b) {
    if (this.closed || !b.length) return;
    link.lastSeen = this.now();
    const member = link.slot >= 0 && this.links.get(link.slot) === link ? this.members.get(link.slot) : null;
    if (member) member.lastSeen = link.lastSeen;
    const kind = b[0];
    if (kind === K_HELLO) {
      if (link.state !== "connecting") return;
      const hello = readCtl(b);
      const pair = await (link.pair ?? selectedPair(link.pc).catch(() => null));
      if (this.closed || link.state !== "connecting") return;
      if (!this.pairOk(pair)) {
        this.log("warn", `초대 ${link.id}: 고른 후보 쌍이 같은 와이파이 밖 경로(${pair.local}/${pair.remote}) — 끊음`);
        this.reject(link, WHY.NO_NETWORK, "notLan");
        return;
      }
      if (!hello || hello.p !== PROTOCOL || hello.compat !== this.compat || hello.purpose !== this.purpose) {
        this.reject(link, WHY.INCOMPATIBLE, "incompatible");
        return;
      }
      if (hello.rj) return this.reattach(link, hello, pair);
      if (link.rejoin) {
        this.reject(link, WHY.LOST, "rejoin");
        return;
      }
      const slot = this.freeSlot();
      if (slot < 0) {
        this.reject(link, WHY.FULL, "full");
        return;
      }
      clearTimeout(link.timer);
      link.slot = slot;
      link.nick = cleanNick(hello.nick, `${slot + 1}P`);
      link.rtt = pair?.rttMs ?? null;
      link.pairText = pair ? `${pair.local}/${pair.remote}` : "?";
      link.key = this.rejoinGame && this.helper?.rejoin ? rejoinKey() : "";
      if (hello.rd !== 1) return this.admit(link, true);
      link.state = "welcomed";
      link.timer = setTimeout(() => {
        if (link.state !== "welcomed") return;
        this.log("warn", `초대 ${link.id}: 자리 ${slot} 안내 뒤 유저 확인이 오지 않음`);
        this.reject(link, WHY.LOST, "timeout");
      }, READY_MS);
      this.sendTo(link, this.welcomePacket(link, [...this.wireMembers(), { slot, nick: link.nick, rtt: null, st: 0 }].sort((a, b) => a.slot - b.slot)));
      return;
    }
    if (kind === K_READY) {
      if (link.state === "welcomed") this.admit(link, false);
      return;
    }
    if (!link.ready || !member) return;
    if (kind === K_DATA) {
      if (b.length < 8 || b.length - 8 > MSG_MAX) return;
      this.stats.recv++;
      this.route(link.slot, b[2], b.subarray(8));
      return;
    }
    if (kind === K_STATE) {
      if (b.length < 9 || b.length - 8 > STATE_CHUNK) return;
      const to = b[2];
      if (to === 0) this.takeState(link.slot, b);
      else if (to < SLOTS && to !== link.slot) {
        const l = this.links.get(to);
        if (l?.ready) {
          const p = b.slice();
          p[1] = link.slot;
          if (this.sendTo(l, p)) this.stats.relayed++;
        }
      }
      return;
    }
    if (kind === K_PONG && b.length >= 5) {
      const sent = new DataView(b.buffer, b.byteOffset + 1, 4).getUint32(0, true);
      const rtt = Math.max(0, ((this.now() >>> 0) - sent) >>> 0);
      if (rtt < 60000) member.rtt = rtt;
      return;
    }
    if (kind === K_PAUSE) {
      this.setAwayOf(link.slot, b[1] === 1);
      return;
    }
    if (kind === K_ROW) {
      if (!this.takeRow(link.slot, b)) return;
      const packet = this.rowPacket(link.slot, b.length === 4 ? null : b.subarray(4));
      for (const l of this.links.values()) if (l.ready && l.slot !== link.slot) this.sendTo(l, packet);
      return;
    }
    if (kind === K_BYE) this.drop(link.slot, WHY.LEFT);
  }

  welcomePacket(link, members) {
    const body = { slot: link.slot, max: this.max, members };
    if (link.key) body.rk = link.key;
    return ctl(K_WELCOME, body);
  }

  admit(link, welcome) {
    const slot = link.slot;
    clearTimeout(link.timer);
    link.state = "joined";
    link.ready = true;
    this.invites.delete(link.id);
    this.links.set(slot, link);
    this.members.set(slot, { nick: link.nick, lastSeen: this.now(), rtt: link.rtt, key: link.key });
    this.log("info", `자리 ${slot} 들어옴 · 후보 ${link.pairText}`);
    this.gone.delete(slot);
    if (welcome) this.sendTo(link, this.welcomePacket(link, this.wireMembers()));
    for (const [from, row] of this.rows) this.sendTo(link, this.rowPacket(from, row));
    this.broadcastMembers(null, welcome ? slot : -1);
    this.emit(EV.JOIN, slot, this.count);
    link.resolve?.({ slot, nick: link.nick });
    this.changed();
  }

  reattach(link, hello, pair) {
    const slot = hello.rj?.s;
    const m = Number.isInteger(slot) ? this.members.get(slot) : null;
    if (!this.rejoinable || slot < 1 || slot >= SLOTS || !m?.key || hello.rj.k !== m.key) {
      this.log("warn", `다시 들어오기 거부(자리 ${slot})`);
      this.reject(link, WHY.LOST, "rejoin");
      return;
    }
    if (!m.held) this.hold(slot);
    clearTimeout(link.timer);
    link.state = "joined";
    link.ready = true;
    link.slot = slot;
    this.invites.delete(link.id);
    this.links.set(slot, link);
    Object.assign(m, { held: false, stalled: false, away: false, awaySince: 0, lastSeen: this.now(), rtt: pair?.rttMs ?? null, nick: cleanNick(hello.nick, m.nick) });
    this.stats.rejoins++;
    this.log("info", `자리 ${slot} 다시 들어옴 · 후보 ${pair ? `${pair.local}/${pair.remote}` : "?"}`);
    this.sendTo(link, ctl(K_WELCOME, { slot, max: this.max, members: this.wireMembers(), rk: m.key, back: 1 }));
    for (const [from, row] of this.rows) this.sendTo(link, this.rowPacket(from, row));
    this.broadcastMembers(null, slot);
    this.emit(EV.BACK, slot, this.count);
    this.changed();
  }

  reject(link, why, code) {
    this.sendTo(link, ctl(K_REJECT, { why }));
    clearTimeout(link.timer);
    link.state = "dead";
    this.invites.delete(link.id);
    link.reject?.(new SessionError(code, why));
    this.killLink(link, 300);
    this.changed();
  }

  onHostState(link) {
    const st = link.pc?.connectionState;
    if (link.state !== "joined") {
      if (st === "failed") this.failInvite(link, link.peerWan !== undefined ? this.failCode({ wan: link.peerWan, skipped: 0, sym: link.peerSym }, link.sym) : "failed", WHY.NO_NETWORK);
      return;
    }
    if (this.links.get(link.slot) === link && this.rejoinable && (st === "disconnected" || st === "failed")) this.helperCall("watch");
  }

  onHostClose(link) {
    if (link.state === "joined") {
      if (this.links.get(link.slot) === link) this.lose(link.slot);
      return;
    }
    if (link.state === "welcomed") this.log("warn", `초대 ${link.id}: 자리 ${link.slot} 안내 뒤 유저가 확인 없이 끊음 — 자리를 남기지 않음`);
    this.failInvite(link, "failed");
  }

  hostOffline() {
    if (globalThis.navigator?.onLine === false) return true;
    const live = [...this.links.values()].some((l) => l.ready && this.now() - (this.members.get(l.slot)?.lastSeen ?? 0) < STALL_MS);
    return !live && Boolean(this.helper?.offline?.());
  }

  lose(slot) {
    if (!this.rejoinable) return this.drop(slot, WHY.LOST);
    if (this.hostOffline()) {
      this.log("warn", "방장 기기의 네트워크가 끊겨 세션을 끝냄");
      return this.close(WHY.LOST);
    }
    this.hold(slot);
  }

  hold(slot) {
    const m = this.members.get(slot);
    if (!this.host || !m || m.held || slot === 0) return;
    const link = this.links.get(slot);
    if (link) {
      this.links.delete(slot);
      this.retire(link);
    }
    this.stateIn.delete(slot);
    Object.assign(m, { held: true, stalled: false, away: false, heldAt: this.now(), rtt: null });
    this.log("info", `자리 ${slot} 끊김 — 돌아올 때까지 보관`);
    this.emit(EV.HOLD, slot, this.count);
    this.broadcastMembers();
    this.helperCall("watch");
    this.changed();
  }

  release(slot) {
    const m = this.members.get(slot);
    if (!this.host || !m?.held) return;
    this.members.delete(slot);
    this.gone.set(slot, { nick: m.nick, left: true });
    if (this.rows.delete(slot)) for (const l of this.links.values()) l.ready && this.sendTo(l, this.rowPacket(slot, null));
    this.log("info", `자리 ${slot} 혼자 이어 하기로 나감`);
    this.emit(EV.LEAVE, slot, WHY.LEFT);
    this.broadcastMembers({ slot, why: WHY.LEFT });
    this.changed();
  }

  async answerRestart(slot, text) {
    const link = this.links.get(slot);
    const pc = link?.pc;
    if (!this.host || this.closed || !link?.ready || !pc || pc.connectionState === "closed") throw new SessionError("gone");
    const desc = decodeCode(text, "offer", { wan: this.wan });
    if (!desc.kept) throw new SessionError("noLan", WHY.NO_NETWORK);
    if (pc.signalingState !== "stable") await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
    await this.refreshIce(pc);
    await pc.setRemoteDescription({ type: "offer", sdp: desc.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await this.gathering(pc, true);
    if (this.links.get(slot) !== link) throw new SessionError("gone");
    const code = encodeCode(pc.localDescription.sdp, desc.ufrag, { wan: this.wan && desc.wan });
    this.stats.restarts++;
    this.log("info", `자리 ${slot} ICE 재시작 답 · 후보 ${code.kept}개`);
    return code.code;
  }

  async acceptRejoin(text) {
    if (!this.host || this.closed || !this.rejoinable) throw new SessionError("closed");
    const desc = decodeCode(text, "offer", { wan: this.wan });
    if (!desc.kept) throw new SessionError("noLan", WHY.NO_NETWORK);
    const link = { id: ++this.inviteSeq, pc: null, dc: null, slot: -1, ready: false, state: "connecting", created: this.now(), lastSeen: this.now(), pair: null, rejoin: true };
    this.invites.set(link.id, link);
    link.timer = setTimeout(() => this.failInvite(link, "timeout"), CONNECT_MS);
    try {
      const pc = await this.peer();
      link.pc = pc;
      if (this.closed || link.state === "dead") throw new SessionError("closed");
      pc.ondatachannel = (event) => {
        const dc = event.channel;
        link.dc = dc;
        dc.binaryType = "arraybuffer";
        dc.onmessage = (ev) => this.onHostMessage(link, new Uint8Array(ev.data));
        dc.onclose = () => this.onHostClose(link);
        const opened = () => {
          link.lastSeen = this.now();
          link.pair = selectedPair(pc).catch(() => null);
        };
        if (dc.readyState === "open") opened();
        else dc.onopen = opened;
      };
      pc.onconnectionstatechange = () => this.onHostState(link);
      await pc.setRemoteDescription({ type: "offer", sdp: desc.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await this.gathering(pc);
      if (this.closed || link.state === "dead") throw new SessionError("closed");
      const code = encodeCode(pc.localDescription.sdp, desc.ufrag, { wan: this.wan && desc.wan });
      if (!code.kept) throw new SessionError("noLan", WHY.NO_NETWORK);
      return code.code;
    } catch (error) {
      this.failInvite(link, "failed");
      throw error instanceof SessionError || error instanceof CodeError ? error : new SessionError("rtc", WHY.NO_NETWORK);
    }
  }

  sendTo(link, bytes) {
    if (!link?.dc || link.dc.readyState !== "open") return false;
    try {
      link.dc.send(bytes);
      return true;
    } catch (error) {
      this.log("warn", `보내기 실패 자리 ${link.slot}: ${error?.message ?? error}`);
      return false;
    }
  }

  wireMembers() {
    return [...this.members.entries()].sort((a, b) => a[0] - b[0]).map(([slot, m]) => ({ slot, nick: m.nick, rtt: Number.isFinite(m.rtt) ? Math.round(m.rtt) : null, st: m.held ? 2 : m.stalled ? 1 : 0 }));
  }

  broadcastMembers(left = null, except = -1) {
    const list = this.wireMembers();
    const packet = ctl(K_MEMBERS, left ? { members: list, left } : { members: list });
    this.lastMembers = JSON.stringify(list);
    this.membersAt = this.now();
    for (const l of this.links.values()) if (l.ready && l.slot !== except) this.sendTo(l, packet);
  }

  route(from, to, payload) {
    if (!validTo(to)) return;
    if (to === TO_ORDERED) {
      const seq = this.seq++;
      const packet = dataPacket(from, to, seq, payload);
      for (const l of this.links.values()) if (l.ready && this.sendTo(l, packet)) this.stats.relayed++;
      this.deliver(from, payload);
    } else if (to === TO_ALL) {
      const packet = dataPacket(from, to, 0, payload);
      for (const l of this.links.values()) if (l.ready && l.slot !== from && this.sendTo(l, packet)) this.stats.relayed++;
      if (from !== 0) this.deliver(from, payload);
    } else if (to === 0) {
      if (from !== 0) this.deliver(from, payload);
    } else if (to !== from) {
      const l = this.links.get(to);
      if (l?.ready && this.sendTo(l, dataPacket(from, to, 0, payload))) this.stats.relayed++;
    }
  }

  deliver(from, payload, state = false) {
    try {
      this.sink.deliver(from, state ? payload : payload.slice(), state);
    } catch (error) {
      this.log("warn", `받은 것 전달 실패: ${error?.message ?? error}`);
    }
  }

  takeState(from, b) {
    const flags = b[3];
    const total = new DataView(b.buffer, b.byteOffset + 4, 4).getUint32(0, true);
    const chunk = b.subarray(8);
    let cur = this.stateIn.get(from);
    if (flags & 1) {
      if (!total || total > STATE_MAX) {
        this.stateIn.delete(from);
        return;
      }
      cur = { buf: new Uint8Array(total), at: 0 };
      this.stateIn.set(from, cur);
    }
    if (!cur || cur.at + chunk.length > cur.buf.length || cur.buf.length !== total) {
      this.stateIn.delete(from);
      return;
    }
    cur.buf.set(chunk, cur.at);
    cur.at += chunk.length;
    if (!(flags & 2)) return;
    this.stateIn.delete(from);
    if (cur.at === cur.buf.length) {
      this.stats.recv++;
      this.deliver(from, cur.buf, true);
    }
  }

  sendState(to, bytes) {
    if (!this.open || (!this.host && (this.rejoining || !this.link?.ready))) return false;
    if (!Number.isInteger(to) || to < 0 || to >= SLOTS || to === this.slot) return false;
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > STATE_MAX) {
      this.stats.dropped++;
      return false;
    }
    const packets = statePackets(this.slot, to, bytes);
    const link = this.host ? this.links.get(to) : this.link;
    if (!link?.ready) return false;
    this.stats.sent++;
    for (const p of packets) if (!this.sendTo(link, p)) return false;
    return true;
  }

  drop(slot, why) {
    const link = this.links.get(slot);
    if (!link) return;
    this.links.delete(slot);
    link.state = "dead";
    link.ready = false;
    const nick = this.members.get(slot)?.nick;
    if (nick) this.gone.set(slot, { nick, left: why === WHY.LEFT });
    this.members.delete(slot);
    this.stateIn.delete(slot);
    if (this.rows.delete(slot)) for (const l of this.links.values()) l.ready && this.sendTo(l, this.rowPacket(slot, null));
    if (why !== WHY.LEFT) this.killLink(link);
    else this.killLink(link, 100);
    if (this.closed) return;
    this.log("info", `자리 ${slot} 나감(이유 ${why})`);
    this.emit(EV.LEAVE, slot, why);
    this.broadcastMembers({ slot, why });
    this.changed();
  }

  async answer(text) {
    if (this.host || this.closed) throw new SessionError("closed");
    if (this.link) throw new SessionError("busy");
    const desc = decodeCode(text, "offer", { wan: this.wan });
    if (!desc.kept) throw new SessionError(desc.skipped ? "wanOff" : "noLan", WHY.NO_NETWORK);
    this.peerWan = desc.wan;
    const link = { pc: null, dc: null, slot: 0, ready: false, state: "connecting", lastSeen: this.now(), pair: null };
    this.link = link;
    try {
      const pc = await this.peer();
      link.pc = pc;
      if (this.closed || this.link !== link) throw new SessionError("closed");
      pc.ondatachannel = (event) => {
        const dc = event.channel;
        link.dc = dc;
        dc.binaryType = "arraybuffer";
        const hello = () => {
          link.pair = selectedPair(pc).catch(() => null);
          this.sendTo(link, ctl(K_HELLO, { p: PROTOCOL, compat: this.compat, purpose: this.purpose, nick: this.nick, rd: 1 }));
        };
        if (dc.readyState === "open") hello();
        else dc.onopen = hello;
        dc.onmessage = (ev) => this.onGuestMessage(link, new Uint8Array(ev.data));
        dc.onclose = () => this.linkDown(link, WHY.LOST);
      };
      pc.onconnectionstatechange = () => this.onGuestState(link, desc);
      await pc.setRemoteDescription({ type: "offer", sdp: desc.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await this.gathering(pc);
      if (this.closed) throw new SessionError("closed");
      const code = encodeCode(pc.localDescription.sdp, desc.ufrag, { wan: this.wan && desc.wan });
      if (!code.kept) throw new SessionError("noLan", WHY.NO_NETWORK);
      this.symSelf = code.sym;
      this.log("info", `답 코드: 후보 ${code.kept}개(공인 ${code.public}, 버림 ${code.dropped}) · ${code.code.length}자${code.sym ? SYM_NOTE : ""} · 방장 코드 후보 ${desc.total}개(공인 ${desc.public}${desc.wan ? "" : ", 인터넷 연결 끔"})${desc.sym ? SYM_NOTE : ""}`);
      this.changed();
      return { code: code.code, peerWan: desc.wan, skipped: desc.skipped, sym: code.sym, peerSym: desc.sym };
    } catch (error) {
      this.killLink(link);
      this.link = null;
      throw error instanceof SessionError || error instanceof CodeError ? error : new SessionError("rtc", WHY.NO_NETWORK);
    }
  }

  onGuestState(link, desc = null) {
    if (this.link !== link || this.closed) return;
    const st = link.pc.connectionState;
    if (!link.ready) {
      if (st !== "failed") return;
      if (link.rejoin) return this.linkDown(link, WHY.LOST);
      this.log("warn", "연결 실패(ICE·DTLS)");
      this.failHint = desc ? this.failCode(desc, this.symSelf) : "";
      this.close(this.opened ? WHY.LOST : WHY.NO_NETWORK);
      return;
    }
    if (st !== "failed" && st !== "disconnected") return;
    if (this.rejoinable) this.helperCall("restart");
    else if (st === "failed") {
      this.log("warn", "연결 실패(ICE·DTLS)");
      this.close(WHY.LOST);
    }
  }

  linkDown(link, why) {
    if (this.closed || this.link !== link) return;
    if (link.rejoin && !link.ready) {
      this.link = null;
      this.retire(link);
      this.changed();
      return;
    }
    if (!this.opened || !this.rejoinable) return this.close(why);
    this.enterRejoin(link);
  }

  enterRejoin(link) {
    if (this.rejoining || this.closed) return;
    this.rejoining = true;
    this.rejoinSince = this.now();
    this.retire(link);
    this.link = null;
    this.stateIn.clear();
    const h = this.members.get(0);
    if (h) h.stalled = true;
    this.log("info", "연결이 끊김 — 같은 자리로 다시 들어가기를 시도");
    this.emit(EV.HOLD, this.slot, this.count);
    this.helperCall("lost");
    this.changed();
  }

  async restartOffer() {
    const link = this.link;
    const pc = link?.pc;
    if (this.host || this.closed || this.rejoining || !link?.ready || !pc) throw new SessionError("closed");
    if (pc.signalingState !== "stable") await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
    await this.refreshIce(pc);
    await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
    await this.gathering(pc, true);
    if (this.link !== link) throw new SessionError("closed");
    const code = encodeCode(pc.localDescription.sdp, "", { wan: this.wan && this.peerWan });
    if (!code.kept) throw new SessionError("noLan", WHY.NO_NETWORK);
    this.stats.restarts++;
    return code.code;
  }

  async restartAnswer(text) {
    const pc = this.link?.pc;
    if (!pc || pc.signalingState !== "have-local-offer") throw new SessionError("closed");
    const desc = decodeCode(text, "answer", { wan: this.wan });
    await pc.setRemoteDescription({ type: "answer", sdp: desc.sdp });
  }

  async restartAbort() {
    const pc = this.link?.pc;
    if (pc && pc.signalingState === "have-local-offer") await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
  }

  async rejoinOffer() {
    if (this.host || this.closed || !this.rejoining) throw new SessionError("closed");
    if (this.link) {
      this.retire(this.link);
      this.link = null;
    }
    const link = { pc: null, dc: null, slot: 0, ready: false, state: "connecting", lastSeen: this.now(), pair: null, rejoin: true };
    this.link = link;
    try {
      const pc = await this.peer();
      link.pc = pc;
      if (this.closed || this.link !== link) throw new SessionError("closed");
      const dc = pc.createDataChannel("webgba-net", { ordered: true });
      link.dc = dc;
      dc.binaryType = "arraybuffer";
      dc.onopen = () => {
        link.pair = selectedPair(pc).catch(() => null);
        this.sendTo(link, ctl(K_HELLO, { p: PROTOCOL, compat: this.compat, purpose: this.purpose, nick: this.nick, rj: { s: this.slot, k: this.rejoinKey } }));
      };
      dc.onmessage = (ev) => this.onGuestMessage(link, new Uint8Array(ev.data));
      dc.onclose = () => this.linkDown(link, WHY.LOST);
      pc.onconnectionstatechange = () => this.onGuestState(link);
      await pc.setLocalDescription(await pc.createOffer());
      await this.gathering(pc);
      if (this.link !== link) throw new SessionError("closed");
      const code = encodeCode(pc.localDescription.sdp, "", { wan: this.wan && this.peerWan });
      if (!code.kept) throw new SessionError("noLan", WHY.NO_NETWORK);
      return code.code;
    } catch (error) {
      if (this.link === link) {
        this.retire(link);
        this.link = null;
      }
      throw error instanceof SessionError || error instanceof CodeError ? error : new SessionError("rtc", WHY.NO_NETWORK);
    }
  }

  async rejoinAnswer(text) {
    const link = this.link;
    if (!link?.rejoin || link.ready || !link.pc) throw new SessionError("closed");
    const desc = decodeCode(text, "answer", { wan: this.wan });
    if (!desc.kept) throw new SessionError("noLan", WHY.NO_NETWORK);
    await link.pc.setRemoteDescription({ type: "answer", sdp: desc.sdp });
  }

  async onGuestMessage(link, b) {
    if (this.closed || !b.length || this.link !== link) return;
    link.lastSeen = this.now();
    const hostMember = this.members.get(0);
    if (hostMember && link.ready) hostMember.lastSeen = link.lastSeen;
    const kind = b[0];
    if (kind === K_PING) {
      if (b.length >= 5) this.sendTo(link, Uint8Array.of(K_PONG, b[1], b[2], b[3], b[4]));
      return;
    }
    if (kind === K_WELCOME) {
      if (link.ready) return;
      const w = readCtl(b);
      if (!w || !Number.isInteger(w.slot) || w.slot < 1 || w.slot >= SLOTS || !Array.isArray(w.members)) return this.close(WHY.LOST);
      const pair = await (link.pair ?? selectedPair(link.pc).catch(() => null));
      if (this.closed || this.link !== link) return;
      if (!this.pairOk(pair)) {
        this.log("warn", `고른 후보 쌍이 같은 와이파이 밖 경로(${pair.local}/${pair.remote}) — 끊음`);
        this.failHint = "notLan";
        return this.close(WHY.NO_NETWORK);
      }
      if (link.rejoin) return this.rejoined(link, w, pair);
      this.slot = w.slot;
      this.max = Math.max(2, Math.min(SLOTS, w.max | 0 || this.max));
      this.rejoinKey = typeof w.rk === "string" && /^[A-Za-z0-9_-]{16,32}$/.test(w.rk) ? w.rk : "";
      link.ready = true;
      link.state = "joined";
      this.sendTo(link, Uint8Array.of(K_READY));
      this.applyMembers(w.members, null, true);
      this.opened = true;
      if (this.myRow) this.setRow(this.myRow);
      this.log("info", `자리 ${this.slot} 로 들어감 · 후보 ${pair ? `${pair.local}/${pair.remote}` : "?"}`);
      this.emit(EV.OPEN, this.slot, this.count);
      this.changed();
      return;
    }
    if (kind === K_REJECT) {
      const r = readCtl(b);
      const why = [WHY.INCOMPATIBLE, WHY.FULL, WHY.NO_NETWORK, WHY.LOST].includes(r?.why) ? r.why : WHY.INCOMPATIBLE;
      if (why === WHY.NO_NETWORK) this.failHint = "notLan";
      return this.close(why);
    }
    if (!link.ready) return;
    if (kind === K_MEMBERS) {
      const m = readCtl(b);
      if (m && Array.isArray(m.members)) this.applyMembers(m.members, m.left ?? null, false);
      return;
    }
    if (kind === K_DATA) {
      if (b.length < 8 || b.length - 8 > MSG_MAX) return;
      const from = b[1];
      if (from >= SLOTS) return;
      this.stats.recv++;
      this.deliver(from, b.subarray(8));
      return;
    }
    if (kind === K_STATE) {
      if (b.length < 9 || b.length - 8 > STATE_CHUNK || b[1] >= SLOTS || b[2] !== this.slot) return;
      this.takeState(b[1], b);
      return;
    }
    if (kind === K_PAUSE) {
      this.setAwayOf(0, b[1] === 1);
      return;
    }
    if (kind === K_ROW) {
      if (b.length >= 2 && b[1] !== this.slot) this.takeRow(b[1], b);
      return;
    }
    if (kind === K_BYE) this.close(WHY.HOST_LEFT);
  }

  rejoined(link, w, pair) {
    if (w.slot !== this.slot || w.back !== 1) {
      this.log("warn", `다시 들어오기 응답이 맞지 않음(자리 ${w.slot})`);
      return this.close(WHY.LOST);
    }
    link.ready = true;
    link.state = "joined";
    this.rejoining = false;
    this.stats.rejoins++;
    const h = this.members.get(0);
    const hostStalled = Boolean(h?.stalled);
    if (h) {
      h.lastSeen = this.now();
      h.stalled = false;
      h.away = false;
    }
    this.log("info", `자리 ${this.slot} 로 다시 들어감 · 후보 ${pair ? `${pair.local}/${pair.remote}` : "?"}`);
    this.emit(EV.REJOINED, this.slot, w.members.length);
    if (hostStalled) this.emit(EV.RESUME, 0, 0);
    this.applyMembers(w.members, null, false);
    if (this.myRow) this.setRow(this.myRow);
    this.helperCall("back");
    this.changed();
  }

  applyMembers(list, left, first) {
    const now = new Map();
    for (const item of list) {
      if (!item || !Number.isInteger(item.slot) || item.slot < 0 || item.slot >= SLOTS) continue;
      now.set(item.slot, item);
    }
    if (!now.has(this.slot) || !now.has(0)) return;
    if (!first) {
      for (const slot of [...this.members.keys()]) {
        if (now.has(slot)) continue;
        const why = left && left.slot === slot && Number.isInteger(left.why) ? left.why : WHY.LEFT;
        this.gone.set(slot, { nick: this.members.get(slot).nick, left: why === WHY.LEFT });
        this.members.delete(slot);
        this.rows.delete(slot);
        this.emit(EV.LEAVE, slot, why);
      }
    }
    let count = this.members.size;
    for (const [slot, item] of now) {
      const old = this.members.get(slot);
      if (!old) this.gone.delete(slot);
      const entry = old ?? { lastSeen: this.now() };
      entry.nick = cleanNick(item.nick, `${slot + 1}P`);
      entry.rtt = Number.isFinite(item.rtt) ? item.rtt : null;
      if (slot !== 0 && slot !== this.slot) {
        const held = item.st === 2;
        const stalled = item.st === 1;
        if (!first && old) {
          if (!old.held && held) this.emit(EV.HOLD, slot, now.size);
          else if (old.held && !held) this.emit(EV.BACK, slot, now.size);
          else if (!held && Boolean(old.stalled) !== stalled) this.emit(stalled ? EV.STALL : EV.RESUME, slot, 0);
        }
        entry.held = held;
        entry.stalled = stalled;
      }
      if (!old) {
        this.members.set(slot, entry);
        count++;
        if (!first) this.emit(EV.JOIN, slot, count);
      }
    }
    this.changed();
  }

  send(to, bytes) {
    if (!this.open || !validTo(to)) return false;
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MSG_MAX) {
      this.stats.dropped++;
      return false;
    }
    this.stats.sent++;
    if (this.host) {
      this.route(0, to, bytes);
      return true;
    }
    if (to === this.slot) return false;
    return this.sendTo(this.link?.ready ? this.link : null, dataPacket(this.slot, to, 0, bytes));
  }

  setAway(on) {
    on = Boolean(on);
    if (this.away === on) return;
    this.away = on;
    if (this.closed) return;
    const packet = Uint8Array.of(K_PAUSE, on ? 1 : 0);
    if (this.host) for (const l of this.links.values()) l.ready && this.sendTo(l, packet);
    else if (this.link?.ready) this.sendTo(this.link, packet);
  }

  setAwayOf(slot, on) {
    const m = this.members.get(slot);
    if (!m || Boolean(m.away) === on) return;
    m.away = on;
    m.awaySince = on ? this.now() : 0;
    this.checkStall(slot, m, this.now());
  }

  checkStall(slot, m, now) {
    if (m.held) return;
    const silent = now - (m.lastSeen ?? now) > STALL_MS;
    const stall = Boolean(m.away) || silent;
    if (stall !== Boolean(m.stalled)) {
      m.stalled = stall;
      this.emit(stall ? EV.STALL : EV.RESUME, slot, 0);
      if (this.host) this.broadcastMembers();
      if (stall && this.host && this.rejoinable) this.helperCall("watch");
      this.changed();
    }
  }

  beat() {
    if (this.closed) return;
    const now = this.now();
    const gap = this.lastBeat ? now - this.lastBeat : 0;
    this.lastBeat = now;
    if (this.host) {
      if (this.rejoinable && gap > LOST_MS && this.links.size) {
        this.log("warn", `방장 기기가 ${Math.round(gap / 1000)}초 멈춰 있었음 — 세션을 끝냄`);
        this.close(WHY.LOST);
        return;
      }
      const ping = new Uint8Array(5);
      ping[0] = K_PING;
      new DataView(ping.buffer).setUint32(1, now >>> 0, true);
      for (const [slot, link] of [...this.links]) {
        if (!link.ready) continue;
        this.sendTo(link, ping);
        const m = this.members.get(slot);
        if (!m) continue;
        if (now - m.lastSeen > LOST_MS || (m.away && now - m.awaySince > AWAY_MS)) {
          this.lose(slot);
          if (this.closed) return;
          continue;
        }
        this.checkStall(slot, m, now);
      }
      if (now - this.membersAt >= MEMBERS_MS && this.links.size) {
        const list = this.wireMembers();
        const before = this.lastMembers ? JSON.parse(this.lastMembers) : [];
        const moved = list.length !== before.length || list.some((m, i) => m.slot !== before[i]?.slot || m.st !== before[i]?.st || m.nick !== before[i]?.nick || Math.abs((m.rtt ?? -99) - (before[i]?.rtt ?? -99)) >= RTT_STEP);
        if (moved) {
          this.broadcastMembers();
          this.changed();
        } else this.membersAt = now;
      }
      return;
    }
    if (this.rejoining) return;
    const m = this.members.get(0);
    const link = this.link;
    if (!m || !link?.ready) return;
    if (now - m.lastSeen > LOST_MS || (m.away && now - m.awaySince > AWAY_MS)) {
      if (m.away || !this.rejoinable) this.close(WHY.LOST);
      else this.enterRejoin(link);
      return;
    }
    this.checkStall(0, m, now);
    if (this.rejoinable && now - m.lastSeen > RESTART_MS && !m.away) this.helperCall("restart");
  }

  close(why = WHY.LEFT) {
    if (this.closed) return;
    this.closed = true;
    this.why = why;
    clearInterval(this.timer);
    const bye = Uint8Array.of(K_BYE);
    const all = this.host ? [...this.links.values(), ...this.invites.values()] : this.link ? [this.link] : [];
    for (const l of all) {
      clearTimeout(l.timer);
      const told = l.ready || l.state === "welcomed";
      if (told) this.sendTo(l, bye);
      this.killLink(l, told ? 150 : 0);
      if (l.state !== "joined") l.reject?.(new SessionError("closed", why));
    }
    this.invites.clear();
    this.rejoining = false;
    this.emit(EV.CLOSED, why, 0);
    this.helperCall("closed");
    this.changed();
  }
}
