import { STUN_DEFAULT } from "./lan.js";

export const ICE_URLS_MAX = 4;
export const ICE_TEXT_MAX = 512;
export const CRED_TIMEOUT_MS = 5000;
export const CRED_BYTES_MAX = 8192;
const CRED_KEEP_MS = 600000;
export const RELAY_LEAD_MS = 600000;
export const RELAY_RETRY_MS = 60000;
export const RELAY_OFF_MS = 300000;
const RELAY_TTL_MAX_S = 172800;

const URL_RE = /^(stun|turn|turns):(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d{1,5})?(\?transport=(udp|tcp))?$/i;

export function iceHost(url) {
  const m = URL_RE.exec(String(url ?? ""));
  return m ? m[2].replace(/^\[|\]$/g, "").toLowerCase() : "";
}

const text = (v) => typeof v === "string" && v.length > 0 && v.length <= ICE_TEXT_MAX;

export function readIceServers(list) {
  const errors = [];
  const warnings = [];
  const servers = [];
  if (list === undefined) return { given: false, servers, errors, warnings };
  if (!Array.isArray(list)) return { given: false, servers, errors: ["iceServers: 배열이어야 합니다"], warnings };
  let total = 0;
  list.forEach((item, i) => {
    const at = `iceServers[${i}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) return errors.push(`${at}: 객체여야 합니다`);
    const urls = typeof item.urls === "string" ? [item.urls] : Array.isArray(item.urls) ? item.urls : null;
    if (!urls || !urls.length) return errors.push(`${at}.urls: 문자열 또는 문자열 배열`);
    const bad = urls.filter((u) => typeof u !== "string" || u.length > 256 || !URL_RE.test(u));
    if (bad.length) return errors.push(`${at}.urls: stun:·turn:·turns: 주소만(${bad.map(String).join(", ").slice(0, 120)})`);
    total += urls.length;
    if (total > ICE_URLS_MAX) return errors.push(`${at}: 서버 주소는 모두 합쳐 ${ICE_URLS_MAX}개까지`);
    const relay = urls.some((u) => /^turns?:/i.test(u));
    const server = { urls: [...urls] };
    if (item.credentialUrl !== undefined) {
      let ok = false;
      try {
        const u = new URL(item.credentialUrl);
        ok = typeof item.credentialUrl === "string" && item.credentialUrl.length <= ICE_TEXT_MAX && u.protocol === "https:" && Boolean(u.hostname) && !u.username && !u.password;
      } catch {}
      if (!ok) return errors.push(`${at}.credentialUrl: https:// 주소(${ICE_TEXT_MAX}자까지)`);
      if (!relay) return errors.push(`${at}.credentialUrl: turn:·turns: 서버에만 씁니다`);
      server.credentialUrl = item.credentialUrl;
    } else if (relay) {
      if (!text(item.username) || !text(item.credential)) return errors.push(`${at}: turn:·turns: 는 username·credential 또는 credentialUrl 이 필요합니다`);
      server.username = item.username;
      server.credential = item.credential;
      warnings.push(`${at}: 고정 TURN 접속 정보는 파일에서 누구나 꺼내 쓸 수 있습니다. credentialUrl 로 짧은 수명 접속 정보를 발급하세요`);
    } else if (item.username !== undefined || item.credential !== undefined) warnings.push(`${at}: stun: 서버의 username·credential 은 쓰지 않습니다`);
    servers.push(server);
  });
  return { given: true, servers, errors, warnings };
}

export function iceHosts(servers) {
  return [...new Set(servers.flatMap((s) => s.urls.map(iceHost)).filter(Boolean))];
}

async function readLimited(response, max) {
  const size = Number(response.headers?.get?.("content-length") ?? 0);
  if (size > max) throw new Error("size");
  if (!response.body?.getReader) {
    const t = await response.text();
    if (t.length > max) throw new Error("size");
    return t;
  }
  const reader = response.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (got > max) {
      reader.cancel().catch(() => {});
      throw new Error("size");
    }
    parts.push(value);
  }
  const all = new Uint8Array(got);
  let at = 0;
  for (const v of parts) {
    all.set(v, at);
    at += v.length;
  }
  return new TextDecoder().decode(all);
}

export async function fetchCredential(server, { fetchImpl = globalThis.fetch, timeoutMs = CRED_TIMEOUT_MS, maxBytes = CRED_BYTES_MAX, now = () => Date.now() } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetchImpl(server.credentialUrl, { method: "GET", cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: ctrl.signal });
    if (!response.ok) throw new Error(`http ${response.status}`);
    const body = JSON.parse(await readLimited(response, maxBytes));
    if (!body || typeof body !== "object" || !text(body.username) || !text(body.credential)) throw new Error("shape");
    const ttl = Number.isFinite(body.ttl) && body.ttl > 0 ? body.ttl * 1000 : CRED_KEEP_MS;
    return { server: { urls: server.urls, username: body.username, credential: body.credential }, until: now() + Math.min(ttl * 0.8, CRED_KEEP_MS) };
  } finally {
    clearTimeout(timer);
  }
}

export function readRelay(body) {
  const urls = Array.isArray(body?.urls) ? body.urls.filter((u) => typeof u === "string" && u.length <= 256 && /^turns?:/i.test(u) && URL_RE.test(u)).slice(0, ICE_URLS_MAX) : [];
  if (!urls.length || !text(body.username) || !text(body.credential) || !Number.isFinite(body.ttl) || body.ttl <= 0) return null;
  const ttl = Math.min(body.ttl, RELAY_TTL_MAX_S) * 1000;
  const lead = Math.min(RELAY_LEAD_MS, ttl / 6);
  return { server: { urls, username: body.username, credential: body.credential }, ttl, lead, fresh: lead * 1.5 };
}

export class IcePlan {
  constructor({ manifestList, fetchImpl = globalThis.fetch, log = () => {}, now = () => Date.now() }) {
    const read = readIceServers(manifestList);
    this.custom = read.given;
    this.servers = read.servers;
    this.hosts = iceHosts(read.servers);
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.now = now;
    this.cache = new Map();
    this.source = null;
    this.relay = null;
    this.relayJob = null;
    this.relayWait = 0;
    this.relayCalls = 0;
    for (const e of read.errors) log("warn", `설명서 ${e} — 이 항목은 쓰지 않음`);
  }

  get turn() {
    return this.servers.some((s) => s.urls.some((u) => /^turns?:/i.test(u)));
  }

  setRelay(source) {
    this.source = source && typeof source.request === "function" && typeof source.proof === "function" ? source : null;
  }

  relayNote(relay) {
    return relay ? { left: relay.until - this.now(), lead: relay.lead, fresh: relay.fresh } : null;
  }

  async defaultRelay() {
    const source = this.source;
    const proof = source?.proof();
    if (!proof) return null;
    const hit = this.relay;
    if (hit && hit.until - this.now() >= hit.fresh) return hit;
    if (this.now() < this.relayWait) return hit && hit.until > this.now() ? hit : null;
    this.relayJob ??= this.fetchRelay(source, proof).finally(() => (this.relayJob = null));
    return this.relayJob;
  }

  async fetchRelay(source, proof) {
    this.relayCalls++;
    try {
      const got = readRelay(await source.request(proof));
      if (!got) throw new Error("shape");
      this.relay = { ...got, until: this.now() + got.ttl };
      this.relayWait = 0;
      this.log("info", `기본 중계 서버 접속 정보 받음(${iceHost(got.server.urls[0])} · ${Math.round(got.ttl / 60000)}분)`);
      return this.relay;
    } catch (error) {
      const code = error?.code ?? error?.message ?? String(error);
      this.relayWait = this.now() + (error?.status === 503 ? RELAY_OFF_MS : RELAY_RETRY_MS);
      this.log("warn", `기본 중계 서버 접속 정보를 받지 못함(${code}) — STUN 만 씀`);
      const hit = this.relay;
      return hit && hit.until > this.now() ? hit : null;
    }
  }

  async list(wan) {
    if (!wan) return { iceServers: [], failed: 0, relay: null };
    if (!this.custom) {
      const out = STUN_DEFAULT.map((s) => ({ ...s }));
      const relay = await this.defaultRelay();
      if (relay) out.push({ ...relay.server, urls: [...relay.server.urls] });
      return { iceServers: out, failed: 0, relay: this.relayNote(relay) };
    }
    const out = [];
    let failed = 0;
    for (const s of this.servers) {
      if (!s.credentialUrl) {
        out.push(s.username ? { urls: s.urls, username: s.username, credential: s.credential } : { urls: s.urls });
        continue;
      }
      const hit = this.cache.get(s.credentialUrl);
      if (hit && hit.until > this.now()) {
        out.push(hit.server);
        continue;
      }
      try {
        const got = await fetchCredential(s, { fetchImpl: this.fetchImpl, now: this.now });
        this.cache.set(s.credentialUrl, got);
        out.push(got.server);
      } catch (error) {
        failed++;
        this.log("warn", `연결 서버 접속 정보를 받지 못함(${iceHost(s.urls[0])}): ${error?.name === "AbortError" ? "시간 초과" : error?.message ?? error}`);
      }
    }
    return { iceServers: out, failed, relay: null };
  }
}
