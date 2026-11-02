
export const CODE_VERSION = 1;
export const RTC_CONFIG = Object.freeze({ iceServers: [], bundlePolicy: "max-bundle" });
export const STUN_DEFAULT = Object.freeze([Object.freeze({ urls: "stun:stun.l.google.com:19302" }), Object.freeze({ urls: "stun:stun.cloudflare.com:3478" })]);
export const rtcConfig = (iceServers = []) => (iceServers.length ? { iceServers, bundlePolicy: "max-bundle" } : RTC_CONFIG);

const SETUPS = ["actpass", "active", "passive"];
const CODE_MAX = 400;
const WAN_FLAG = 0x40;
const KIND_SRFLX = 0x10;
const KIND_RELAY = 0x20;
const PUBLIC_MAX = 4;
const CANDS_MAX = 8;

export class CodeError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}
export function isLanAddress(addr) {
  if (!addr || typeof addr !== "string") return false;
  if (/^[0-9a-f-]{36}\.local$/i.test(addr)) return "mdns";
  const v4 = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([v4[1], v4[2], v4[3], v4[4]].some((p) => Number(p) > 255)) return false;
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return "v4-private";
    return false;
  }
  if (addr.includes(":")) {
    if (!/^[0-9a-f:]+$/i.test(addr)) return false;
    const head = parseInt(addr.split(":")[0] || "0", 16);
    if ((head & 0xfe00) === 0xfc00) return "v6-ula";
    if ((head & 0xffc0) === 0xfe80) return "v6-link";
    return false;
  }
  return false;
}
export function parseCandidate(line) {
  const s = String(line).replace(/^a=/, "").replace(/^candidate:/, "").trim().split(/\s+/);
  if (s.length < 8) return null;
  return { protocol: s[2].toLowerCase(), address: s[4], port: Number(s[5]), type: s[7] };
}

export function lanCandidateOk(c) {
  return Boolean(c && c.protocol === "udp" && c.type === "host" && isLanAddress(c.address) && Number.isInteger(c.port) && c.port > 0 && c.port < 65536);
}

export function ipKind(addr) {
  if (!addr || typeof addr !== "string") return "";
  const v4 = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const p = v4.slice(1).map(Number);
    if (p.some((n) => n > 255) || p[0] === 0 || p[0] === 127 || p[0] >= 224) return "";
    return "v4";
  }
  if (addr.includes(":") && /^[0-9a-f:]+$/i.test(addr) && addr !== "::1" && addr !== "::") return "v6";
  return "";
}

export function wanCandidateOk(c) {
  if (!c || c.protocol !== "udp" || !ipKind(c.address) || !Number.isInteger(c.port) || c.port <= 0 || c.port >= 65536) return false;
  if (c.type === "relay") return isLanAddress(c.address) !== "mdns";
  return ["host", "srflx", "prflx"].includes(c.type) && !isLanAddress(c.address);
}

export const candidateOk = (c, wan = false) => lanCandidateOk(c) || (wan && wanCandidateOk(c));

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text) {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const uuidBytes = (name) => Uint8Array.from(name.replace(/\.local$/i, "").replace(/-/g, "").match(/../g), (h) => parseInt(h, 16));

function uuidOf(bytes) {
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
}

function v6Bytes(addr) {
  const [head, tail] = addr.split("::");
  const hs = head ? head.split(":") : [];
  const ts = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const words = tail !== undefined ? [...hs, ...Array(Math.max(0, 8 - hs.length - ts.length)).fill("0"), ...ts] : hs;
  const out = new Uint8Array(16);
  words.slice(0, 8).forEach((w, i) => {
    const v = parseInt(w || "0", 16);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 0xff;
  });
  return out;
}

function v6Of(bytes) {
  const w = [];
  for (let i = 0; i < 16; i += 2) w.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  return w.join(":");
}
export const cleanCode = (text) => String(text ?? "").replace(/[^A-Za-z0-9_-]/g, "");
export function encodeCode(sdp, ref = "", { wan = false } = {}) {
  const get = (re) => (sdp.match(re) || [])[1];
  const ufrag = get(/^a=ice-ufrag:(.+)$/m)?.trim();
  const pwd = get(/^a=ice-pwd:(.+)$/m)?.trim();
  const fp = get(/^a=fingerprint:sha-256 (.+)$/im)?.trim();
  const setup = SETUPS.indexOf(get(/^a=setup:(\w+)$/m));
  if (!ufrag || !pwd || !fp || ufrag.length > 64 || pwd.length > 64) throw new CodeError("sdp");
  const lan = [];
  const pub = [];
  const seen = new Set();
  let dropped = 0;
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith("a=candidate:")) continue;
    const c = parseCandidate(line);
    const key = c ? `${c.type}|${c.address}|${c.port}` : "";
    if (c && seen.has(key)) continue;
    seen.add(key);
    if (lanCandidateOk(c) && lan.length < CANDS_MAX) lan.push(c);
    else if (wan && wanCandidateOk(c) && c.type !== "prflx" && pub.length < PUBLIC_MAX) pub.push(c);
    else dropped++;
  }
  const lanKeep = Math.min(lan.length, CANDS_MAX - pub.length);
  dropped += lan.length - lanKeep;
  const cands = [...lan.slice(0, lanKeep), ...pub];
  const bytes = [(CODE_VERSION & 15) | (Math.max(0, setup) << 4) | (wan ? WAN_FLAG : 0)];
  const ascii = (s) => {
    bytes.push(s.length);
    for (const ch of s) bytes.push(ch.charCodeAt(0) & 0x7f);
  };
  ascii(ufrag);
  ascii(pwd);
  for (const h of fp.split(":")) bytes.push(parseInt(h, 16));
  bytes.push(cands.length);
  for (const c of cands) {
    const mark = c.type === "relay" ? KIND_RELAY : c.type === "srflx" ? KIND_SRFLX : 0;
    if (isLanAddress(c.address) === "mdns") bytes.push(1, ...uuidBytes(c.address));
    else if (ipKind(c.address) === "v4") bytes.push(4 | mark, ...c.address.split(".").map(Number));
    else bytes.push(6 | mark, ...v6Bytes(c.address));
    bytes.push(c.port >> 8, c.port & 0xff);
  }
  if (ref) ascii(String(ref).slice(0, 64));
  return { code: b64url(Uint8Array.from(bytes)), bytes: bytes.length, kept: cands.length, lan: lanKeep, public: pub.length, dropped, ufrag };
}

const PRIORITY = { host: 2122260223, srflx: 1686052607, relay: 41885439 };

function candidateLine(i, type, addr, port) {
  const tail = type === "host" ? "" : " raddr 0.0.0.0 rport 0";
  return `a=candidate:${i + 1} 1 udp ${PRIORITY[type] - i} ${addr} ${port} typ ${type}${tail} generation 0`;
}

export function decodeCode(text, expect, { wan = false } = {}) {
  const code = cleanCode(text);
  if (!code) throw new CodeError("empty");
  if (code.length > CODE_MAX) throw new CodeError("bad");
  let b;
  try {
    b = unb64url(code);
  } catch {
    throw new CodeError("bad");
  }
  let p = 0;
  const need = (n) => {
    if (p + n > b.length) throw new CodeError("bad");
  };
  need(1);
  const version = b[p] & 15;
  const peerWan = Boolean(b[p] & WAN_FLAG);
  if (b[p] & 0x80) throw new CodeError("version");
  const setupIndex = (b[p++] >> 4) & 3;
  if (version !== CODE_VERSION) throw new CodeError("version");
  const setup = SETUPS[setupIndex];
  if (!setup) throw new CodeError("bad");
  const type = setup === "actpass" ? "offer" : "answer";
  if (expect && type !== expect) throw new CodeError("kind");
  const ascii = () => {
    need(1);
    const n = b[p++];
    need(n);
    const s = String.fromCharCode(...b.subarray(p, p + n));
    p += n;
    if (!/^[\x21-\x7e]+$/.test(s)) throw new CodeError("bad");
    return s;
  };
  const ufrag = ascii();
  const pwd = ascii();
  need(33);
  const fp = Array.from(b.subarray(p, p + 32), (x) => x.toString(16).toUpperCase().padStart(2, "0")).join(":");
  p += 32;
  const n = b[p++];
  const lines = [];
  let skipped = 0;
  for (let i = 0; i < n; i++) {
    need(1);
    const kind = b[p++];
    const type = kind & KIND_RELAY ? "relay" : kind & KIND_SRFLX ? "srflx" : "host";
    const base = kind & 0x0f;
    let addr;
    if (base === 1 && type === "host" && kind === 1) {
      need(16);
      addr = uuidOf(b.subarray(p, p + 16));
      p += 16;
    } else if (base === 4 && !(kind & 0xc0)) {
      need(4);
      addr = Array.from(b.subarray(p, p + 4)).join(".");
      p += 4;
    } else if (base === 6 && !(kind & 0xc0)) {
      need(16);
      addr = v6Of(b.subarray(p, p + 16));
      p += 16;
    } else throw new CodeError("bad");
    need(2);
    const port = (b[p] << 8) | b[p + 1];
    p += 2;
    const cand = { protocol: "udp", type, address: addr, port };
    if (!candidateOk(cand, wan)) {
      if (wanCandidateOk(cand)) skipped++;
      continue;
    }
    lines.push(candidateLine(i, type, addr, port));
  }
  const ref = p < b.length ? ascii() : "";
  if (p !== b.length) throw new CodeError("bad");
  const sdp = [
    "v=0",
    `o=- ${Date.now()} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...lines,
    "a=end-of-candidates",
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${setup}`,
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    "",
  ].join("\r\n");
  return { type, sdp, ufrag, ref, kept: lines.length, wan: peerWan, skipped };
}
export function waitGathering(pc, { wan = false, turn = false, fresh = false, ms = turn ? 6000 : wan ? 4000 : 3000 } = {}) {
  if (pc.iceGatheringState === "complete" && !fresh) return Promise.resolve(true);
  return new Promise((resolve) => {
    let early = 0;
    let earlyAt = Infinity;
    const soon = (wait) => {
      const at = performance.now() + wait;
      if (at >= earlyAt) return;
      clearTimeout(early);
      earlyAt = at;
      early = setTimeout(() => done(true), wait);
    };
    const done = (value) => {
      clearTimeout(timer);
      clearTimeout(early);
      pc.removeEventListener("icegatheringstatechange", onState);
      pc.removeEventListener("icecandidate", onCandidate);
      resolve(value);
    };
    const timer = setTimeout(() => done(false), ms);
    const onState = () => pc.iceGatheringState === "complete" && done(true);
    const onCandidate = (event) => {
      if (!event.candidate) return done(true);
      const c = parseCandidate(event.candidate.candidate);
      if (!wan) {
        if (lanCandidateOk(c)) soon(1200);
      } else if (c?.type === "relay" && wanCandidateOk(c)) soon(300);
      else if (c?.type === "srflx" && wanCandidateOk(c)) soon(turn ? 2500 : 400);
      else if (lanCandidateOk(c)) soon(turn ? 4000 : 2500);
    };
    pc.addEventListener("icegatheringstatechange", onState);
    pc.addEventListener("icecandidate", onCandidate);
  });
}
export async function selectedPair(pc) {
  const stats = await pc.getStats();
  let pair = null;
  stats.forEach((s) => {
    if (s.type === "transport" && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
  });
  if (!pair)
    stats.forEach((s) => {
      if (s.type === "candidate-pair" && (s.selected || s.nominated) && s.state === "succeeded") pair = pair || s;
    });
  if (!pair) return null;
  const local = stats.get(pair.localCandidateId);
  const remote = stats.get(pair.remoteCandidateId);
  const addr = (c) => c?.address || c?.ip || "";
  const lanOf = (c) => (addr(c) ? Boolean(isLanAddress(addr(c))) || /^(127\.|::1$)/.test(addr(c)) : true);
  const host = local?.candidateType === "host" && remote?.candidateType === "host";
  return {
    local: local?.candidateType ?? "none",
    remote: remote?.candidateType ?? "none",
    host,
    lan: host && lanOf(local) && lanOf(remote),
    rttMs: pair.currentRoundTripTime != null ? pair.currentRoundTripTime * 1000 : null,
  };
}
