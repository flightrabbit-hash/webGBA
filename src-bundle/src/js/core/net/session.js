import { CodeError, RTC_CONFIG, decodeCode, encodeCode, selectedPair, waitGathering } from "./lan.js";
import { ROW_BYTES } from "./board.js";

export const PROTOCOL = 1;
export const EV = Object.freeze({ OPEN: 1, JOIN: 2, LEAVE: 3, CLOSED: 4, STALL: 5, RESUME: 6 });
export const WHY = Object.freeze({ CANCEL: 1, TIMEOUT: 2, INCOMPATIBLE: 3, LOST: 4, FULL: 5, LEFT: 6, HOST_LEFT: 7, NO_NETWORK: 8 });
export const TO_ORDERED = 0xfe;
export const TO_ALL = 0xff;
export const MSG_MAX = 16384;
export const SLOTS = 8;
export const NICK_MAX = 16;

const K_HELLO = 1;
const K_WELCOME = 2;
const K_REJECT = 3;
const K_MEMBERS = 4;
const K_DATA = 0x10;
const K_PAUSE = 0x11;
const K_BYE = 0x12;
const K_PING = 0x13;
const K_PONG = 0x14;
const K_ROW = 0x15;

const HEARTBEAT_MS = 500;
const STALL_MS = 1500;
const LOST_MS = 15000;
const AWAY_MS = 15000;
const CONNECT_MS = 25000;
const MEMBERS_MS = 2000;
const RTT_STEP = 3;
const CTL_MAX = 8192;

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

const validTo = (to) => (Number.isInteger(to) && to >= 0 && to < SLOTS) || to === TO_ORDERED || to === TO_ALL;

export class NetSession {
  constructor({ role, nick, max = 2, compat = "", purpose = "", sink, log = () => {}, rtc = RTC_CONFIG, makePeer = null, now = () => performance.now() }) {
    this.role = role === "make" ? "make" : "join";
    this.nick = cleanNick(nick, "?");
    this.max = Math.max(2, Math.min(SLOTS, max | 0));
    this.compat = String(compat);
    this.purpose = String(purpose);
    this.sink = sink;
    this.log = log;
    this.rtc = rtc;
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
    this.stats = { sent: 0, recv: 0, relayed: 0, dropped: 0 };
    this.gone = new Map();
    this.rows = new Map();
    this.myRow = null;
    this.timer = setInterval(() => this.beat(), HEARTBEAT_MS);
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

  memberList() {
    return [...this.members.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([slot, m]) => ({ slot, nick: m.nick, me: slot === this.slot, host: slot === 0, stalled: Boolean(m.stalled), away: Boolean(m.away), rtt: Number.isFinite(m.rtt) ? m.rtt : null }));
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

  peer() {
    const pc = this.makePeer(this.rtc);
    return pc;
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
    const waiting = [...this.invites.values()].filter((l) => l.state !== "dead").length;
    if (this.count + waiting >= this.max) throw new SessionError("full", WHY.FULL);
    const pc = this.peer();
    const dc = pc.createDataChannel("webgba-net", { ordered: true });
    dc.binaryType = "arraybuffer";
    const link = { id: ++this.inviteSeq, pc, dc, slot: -1, ready: false, state: "invite", created: this.now(), lastSeen: this.now(), pair: null };
    this.invites.set(link.id, link);
    dc.onmessage = (event) => this.onHostMessage(link, new Uint8Array(event.data));
    dc.onopen = () => {
      link.lastSeen = this.now();
      link.pair = selectedPair(pc).catch(() => null);
    };
    dc.onclose = () => this.onHostClose(link);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.failInvite(link, "failed");
    };
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitGathering(pc);
      if (this.closed || link.state === "dead") throw new SessionError("closed");
      const code = encodeCode(pc.localDescription.sdp);
      if (!code.kept) throw new SessionError("noLan", WHY.NO_NETWORK);
      link.code = code.code;
      link.ufrag = code.ufrag;
      this.log("info", `초대 ${link.id}: 후보 ${code.kept}개(버림 ${code.dropped}) · 코드 ${code.code.length}자`);
      return { id: link.id, code: code.code };
    } catch (error) {
      this.killLink(link);
      this.invites.delete(link.id);
      throw error instanceof SessionError || error instanceof CodeError ? error : new SessionError("rtc", WHY.NO_NETWORK);
    }
  }

  async accept(id, text) {
    const link = this.invites.get(id);
    if (!link || link.state !== "invite") throw new SessionError("used");
    const desc = decodeCode(text, "answer");
    if (!desc.kept) throw new SessionError("noLan", WHY.NO_NETWORK);
    if (this.used.has(desc.ufrag)) throw new SessionError("used");
    if (desc.ref && desc.ref !== link.ufrag) throw new SessionError("mismatch");
    this.used.add(desc.ufrag);
    link.state = "connecting";
    const done = new Promise((resolve, reject) => {
      link.resolve = resolve;
      link.reject = reject;
      link.timer = setTimeout(() => this.failInvite(link, "timeout"), CONNECT_MS);
    });
    try {
      await link.pc.setRemoteDescription({ type: "answer", sdp: desc.sdp });
    } catch {
      this.failInvite(link, "bad");
    }
    return done;
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

  freeSlot() {
    for (let s = 1; s < this.max; s++) if (!this.members.has(s)) return s;
    return -1;
  }

  async onHostMessage(link, b) {
    if (this.closed || !b.length) return;
    link.lastSeen = this.now();
    const member = link.slot >= 0 ? this.members.get(link.slot) : null;
    if (member) member.lastSeen = link.lastSeen;
    const kind = b[0];
    if (kind === K_HELLO) {
      if (link.state !== "connecting") return;
      const hello = readCtl(b);
      const pair = await (link.pair ?? selectedPair(link.pc).catch(() => null));
      if (this.closed || link.state !== "connecting") return;
      if (pair && !pair.host) {
        this.log("warn", `초대 ${link.id}: 고른 후보 쌍이 host/host 가 아님(${pair.local}/${pair.remote}) — 끊음`);
        this.reject(link, WHY.NO_NETWORK, "notLan");
        return;
      }
      if (!hello || hello.p !== PROTOCOL || hello.compat !== this.compat || hello.purpose !== this.purpose) {
        this.reject(link, WHY.INCOMPATIBLE, "incompatible");
        return;
      }
      const slot = this.freeSlot();
      if (slot < 0) {
        this.reject(link, WHY.FULL, "full");
        return;
      }
      clearTimeout(link.timer);
      link.state = "joined";
      link.ready = true;
      link.slot = slot;
      this.invites.delete(link.id);
      this.links.set(slot, link);
      this.members.set(slot, { nick: cleanNick(hello.nick, `${slot + 1}P`), lastSeen: this.now(), rtt: pair?.rttMs ?? null });
      this.log("info", `자리 ${slot} 들어옴 · 후보 ${pair ? `${pair.local}/${pair.remote}` : "?"}`);
      this.gone.delete(slot);
      this.sendTo(link, ctl(K_WELCOME, { slot, max: this.max, members: this.wireMembers() }));
      for (const [from, row] of this.rows) this.sendTo(link, this.rowPacket(from, row));
      this.broadcastMembers(null, slot);
      this.emit(EV.JOIN, slot, this.count);
      link.resolve?.({ slot, nick: this.members.get(slot).nick });
      this.changed();
      return;
    }
    if (!link.ready) return;
    if (kind === K_DATA) {
      if (b.length < 8 || b.length - 8 > MSG_MAX) return;
      this.stats.recv++;
      this.route(link.slot, b[2], b.subarray(8));
      return;
    }
    if (kind === K_PONG && b.length >= 5 && member) {
      const sent = new DataView(b.buffer, b.byteOffset + 1, 4).getUint32(0, true);
      const rtt = Math.max(0, ((this.now() >>> 0) - sent) >>> 0);
      if (rtt < 60000) member.rtt = rtt;
      return;
    }
    if (kind === K_PAUSE && member) {
      this.setAwayOf(link.slot, b[1] === 1);
      return;
    }
    if (kind === K_ROW && member) {
      if (!this.takeRow(link.slot, b)) return;
      const packet = this.rowPacket(link.slot, b.length === 4 ? null : b.subarray(4));
      for (const l of this.links.values()) if (l.ready && l.slot !== link.slot) this.sendTo(l, packet);
      return;
    }
    if (kind === K_BYE) this.drop(link.slot, WHY.LEFT);
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

  onHostClose(link) {
    if (link.state === "joined") this.drop(link.slot, WHY.LOST);
    else this.failInvite(link, "failed");
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
    return [...this.members.entries()].sort((a, b) => a[0] - b[0]).map(([slot, m]) => ({ slot, nick: m.nick, rtt: Number.isFinite(m.rtt) ? Math.round(m.rtt) : null, st: m.stalled ? 1 : 0 }));
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

  deliver(from, payload) {
    try {
      this.sink.deliver(from, payload.slice());
    } catch (error) {
      this.log("warn", `받은 것 전달 실패: ${error?.message ?? error}`);
    }
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
    const desc = decodeCode(text, "offer");
    if (!desc.kept) throw new SessionError("noLan", WHY.NO_NETWORK);
    const pc = this.peer();
    const link = { pc, dc: null, slot: 0, ready: false, state: "connecting", lastSeen: this.now(), pair: null };
    this.link = link;
    pc.ondatachannel = (event) => {
      const dc = event.channel;
      link.dc = dc;
      dc.binaryType = "arraybuffer";
      const hello = () => {
        link.pair = selectedPair(pc).catch(() => null);
        this.sendTo(link, ctl(K_HELLO, { p: PROTOCOL, compat: this.compat, purpose: this.purpose, nick: this.nick }));
      };
      if (dc.readyState === "open") hello();
      else dc.onopen = hello;
      dc.onmessage = (ev) => this.onGuestMessage(link, new Uint8Array(ev.data));
      dc.onclose = () => this.close(WHY.LOST);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && !this.closed) {
        this.log("warn", "연결 실패(ICE·DTLS)");
        this.close(this.opened ? WHY.LOST : WHY.NO_NETWORK);
      }
    };
    try {
      await pc.setRemoteDescription({ type: "offer", sdp: desc.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitGathering(pc);
      if (this.closed) throw new SessionError("closed");
      const code = encodeCode(pc.localDescription.sdp, desc.ufrag);
      if (!code.kept) throw new SessionError("noLan", WHY.NO_NETWORK);
      this.log("info", `답 코드: 후보 ${code.kept}개(버림 ${code.dropped}) · ${code.code.length}자`);
      this.changed();
      return { code: code.code };
    } catch (error) {
      this.killLink(link);
      this.link = null;
      throw error instanceof SessionError || error instanceof CodeError ? error : new SessionError("rtc", WHY.NO_NETWORK);
    }
  }

  async onGuestMessage(link, b) {
    if (this.closed || !b.length) return;
    link.lastSeen = this.now();
    const hostMember = this.members.get(0);
    if (hostMember) hostMember.lastSeen = link.lastSeen;
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
      if (this.closed) return;
      if (pair && !pair.host) {
        this.log("warn", `고른 후보 쌍이 host/host 가 아님(${pair.local}/${pair.remote}) — 끊음`);
        return this.close(WHY.NO_NETWORK);
      }
      this.slot = w.slot;
      this.max = Math.max(2, Math.min(SLOTS, w.max | 0 || this.max));
      link.ready = true;
      link.state = "joined";
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
      const why = [WHY.INCOMPATIBLE, WHY.FULL, WHY.NO_NETWORK].includes(r?.why) ? r.why : WHY.INCOMPATIBLE;
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
        const stalled = item.st === 1;
        if (!first && old && Boolean(old.stalled) !== stalled) this.emit(stalled ? EV.STALL : EV.RESUME, slot, 0);
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
    return this.sendTo(this.link, dataPacket(this.slot, to, 0, bytes));
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
    const silent = now - (m.lastSeen ?? now) > STALL_MS;
    const stall = Boolean(m.away) || silent;
    if (stall !== Boolean(m.stalled)) {
      m.stalled = stall;
      this.emit(stall ? EV.STALL : EV.RESUME, slot, 0);
      if (this.host) this.broadcastMembers();
      this.changed();
    }
  }

  beat() {
    if (this.closed) return;
    const now = this.now();
    if (this.host) {
      const ping = new Uint8Array(5);
      ping[0] = K_PING;
      new DataView(ping.buffer).setUint32(1, now >>> 0, true);
      for (const [slot, link] of [...this.links]) {
        if (!link.ready) continue;
        this.sendTo(link, ping);
        const m = this.members.get(slot);
        if (!m) continue;
        if (now - m.lastSeen > LOST_MS || (m.away && now - m.awaySince > AWAY_MS)) {
          this.drop(slot, WHY.LOST);
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
    const m = this.members.get(0);
    const link = this.link;
    if (!m || !link?.ready) return;
    if (now - m.lastSeen > LOST_MS || (m.away && now - m.awaySince > AWAY_MS)) {
      this.close(WHY.LOST);
      return;
    }
    this.checkStall(0, m, now);
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
      if (l.ready) this.sendTo(l, bye);
      this.killLink(l, l.ready ? 150 : 0);
      if (l.state !== "joined") l.reject?.(new SessionError("closed", why));
    }
    this.invites.clear();
    this.emit(EV.CLOSED, why, 0);
    this.changed();
  }
}
