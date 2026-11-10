import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { makeStore, StoreError } from "../_mp/store.js";
import { ipPrefix, ORIGINS } from "../_mp/server.js";
import { onlyHex32, tidyEnv } from "../_mp/turn.js";
import { makeR2, R2Error } from "./r2.js";
import { readHead } from "./wgba-head.js";

export const ADMIN = Object.freeze({
  TRY_MAX: 5,
  TRY_TTL: 3700,
  FAIL_MAX: 30,
  FAIL_TTL: 90000,
  KEY_MS: 60000,
  KEY_MISS_MS: 15000,
  TOKEN_MS: 30 * 86400000,
  URL_TTL: 300,
  HEAD_BYTES: 131072,
  KEYS_MAX: 32,
  LIST_MAX: 200,
  BODY_MAX: 4096,
  KEY_FILE: "authentication.key",
  KEY_FILE_MAX: 4096,
  PREFIX: "wgba/",
  ZONE_MIN: 540,
  FUTURE_MS: 120000,
});

const PIN_RE = /^[0-9!#]{6}$/;
const TOKEN_RE = /^Bearer\s+a1\.([0-9a-z]{1,12})\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{32})$/;
const SEMVER_RE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,32}))?$/;
const KEY_RE = /^wgba\/[^\x00-\x1f\\]{1,900}\.wgba$/i;
const ENV = Object.freeze([
  ["account", "CF_ACCOUNT_ID", /^[A-Za-z0-9]{1,64}$/, true],
  ["bucket", "R2_PRIVATE_BUCKET", /^[a-z0-9][a-z0-9-]{1,62}$/, false],
  ["accessKey", "R2_PRIVATE_ACCESS_KEY_ID", /^[\x21-\x7e]{1,128}$/, false],
  ["secret", "R2_PRIVATE_SECRET_ACCESS_KEY", /^[\x21-\x7e]{1,256}$/, false],
]);

class HttpError extends Error {
  constructor(status, code, extra = null) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function adminConfig(env = process.env) {
  const config = {};
  const why = [];
  for (const [key, name, re, hex] of ENV) {
    let value = tidyEnv(env[name]);
    if (hex && value && !re.test(value)) value = onlyHex32(value) || value;
    if (!value) why.push(`${name}:missing`);
    else if (!re.test(value)) why.push(`${name}:format`);
    config[key] = value;
  }
  if (why.length) return { config: null, why };
  config.host = `${config.account}.r2.cloudflarestorage.com`;
  config.origin = `https://${config.host}`;
  return { config, why };
}

/** 키 파일 `updated` → ms. 시각대가 없으면 한국 시각. */
export function parseUpdated(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map((v) => Number(v ?? 0));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  let zone = ADMIN.ZONE_MIN;
  if (m[7] === "Z") zone = 0;
  else if (m[7]) {
    const z = m[7].replace(":", "");
    zone = (z[0] === "-" ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)));
  }
  return Date.UTC(y, mo - 1, d, h, mi, s) - zone * 60000;
}

export function parseKeyFile(text) {
  let value = null;
  try {
    value = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch {
    return null;
  }
  const sha = String(value?.sha256 ?? "").trim().toLowerCase();
  const updated = parseUpdated(value?.updated);
  if (!/^[0-9a-f]{64}$/.test(sha) || updated === null) return null;
  return { sha, updated, text: String(value.updated).trim() };
}

export function semverCompare(a, b) {
  const x = SEMVER_RE.exec(a);
  const y = SEMVER_RE.exec(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
  if (!x[4] !== !y[4]) return x[4] ? -1 : 1;
  return String(x[4] ?? "").localeCompare(String(y[4] ?? ""));
}

const WIN_BAD = /[\\/:*?"<>|\x00-\x1f]/g;
const WIN_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export function safeFileName(text, fallback = "game") {
  let name = String(text ?? "").replace(WIN_BAD, "_").replace(/\s+/g, " ").trim().replace(/^[. ]+|[. ]+$/g, "");
  name = [...name].slice(0, 80).join("").trim();
  if (!name) name = fallback;
  if (WIN_RESERVED.test(name)) name = `_${name}`;
  return `${name}.wgba`;
}

function nameOf(names) {
  if (typeof names === "string") return names;
  return names?.en ?? names?.ko ?? names?.ja ?? "";
}

export function createAdmin({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), store = null, endpoint = null } = {}) {
  const { config, why } = adminConfig(env);
  if (config && endpoint) {
    config.host = new URL(endpoint).host;
    config.origin = new URL(endpoint).origin;
  }
  const db = store ?? makeStore({ env, fetchImpl });
  const r2 = config ? makeR2(config, { fetchImpl, now }) : null;
  const tokenKey = config ? createHmac("sha256", config.secret).update("webgba-admin-token|1").digest() : null;
  const heads = new Map();
  let keyMemo = null;
  let keyJob = null;
  let told = false;

  const need = () => {
    if (config) return;
    if (!told) console.warn(`[admin] off: ${why.join(" ")}`);
    told = true;
    throw new HttpError(503, "off");
  };

  async function loadKey() {
    let got;
    try {
      got = await r2.get(ADMIN.KEY_FILE, { max: ADMIN.KEY_FILE_MAX });
    } catch (error) {
      if (error instanceof R2Error && error.code === "size") return { error: "key" };
      throw new HttpError(503, "r2");
    }
    if (!got) return { error: "nokey" };
    const key = parseKeyFile(new TextDecoder().decode(got.bytes));
    return key ? { key } : { error: "key" };
  }

  async function readKey() {
    const at = now();
    if (!keyMemo || keyMemo.until <= at) {
      keyJob ??= loadKey().finally(() => (keyJob = null));
      const got = await keyJob;
      keyMemo = { ...got, until: now() + (got.key ? ADMIN.KEY_MS : ADMIN.KEY_MISS_MS) };
    }
    if (keyMemo.error) throw new HttpError(503, keyMemo.error);
    return keyMemo.key;
  }

  const mac = (parts) => createHmac("sha256", tokenKey).update(parts.join("|")).digest().subarray(0, 24).toString("base64url");

  function issue(key) {
    const at = now();
    const iat = at.toString(36);
    const exp = (at + ADMIN.TOKEN_MS).toString(36);
    return { token: `a1.${iat}.${exp}.${mac(["t", iat, exp, key.sha])}`, at, until: at + ADMIN.TOKEN_MS, updated: key.text };
  }

  async function session(request) {
    need();
    const m = TOKEN_RE.exec(request.headers.get("authorization") ?? "");
    if (!m) throw new HttpError(401, "again");
    const key = await readKey();
    const want = Buffer.from(mac(["t", m[1], m[2], key.sha]));
    const got = Buffer.from(m[3]);
    if (want.length !== got.length || !timingSafeEqual(want, got)) throw new HttpError(401, "again");
    const iat = parseInt(m[1], 36);
    const exp = parseInt(m[2], 36);
    const at = now();
    if (exp <= at || iat > at + ADMIN.FUTURE_MS || key.updated > iat) throw new HttpError(401, "again");
    return key;
  }

  function groupOf(request) {
    const h = request.headers;
    const prefix = ipPrefix(h.get("x-vercel-forwarded-for") || h.get("x-forwarded-for") || h.get("x-real-ip")) || "?";
    return createHmac("sha256", tokenKey).update(`ip|${prefix}`).digest().subarray(0, 12).toString("base64url");
  }

  async function verify(request, body) {
    need();
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!PIN_RE.test(pin)) throw new HttpError(400, "bad");
    if (!db.ready) throw new StoreError("config");
    const tries = `adm:t:${groupOf(request)}:${Math.floor(now() / 3600000)}`;
    const fails = `adm:f:${Math.floor(now() / 86400000)}`;
    const [n, , failed] = await db.run([["INCR", tries], ["EXPIRE", tries, ADMIN.TRY_TTL], ["GET", fails]]);
    if (Number(n) > ADMIN.TRY_MAX) throw new HttpError(429, "limit");
    if (Number(failed) >= ADMIN.FAIL_MAX) throw new HttpError(429, "locked");
    const key = await readKey();
    if (key.updated > now() + ADMIN.FUTURE_MS) throw new HttpError(503, "key", { why: "future" });
    const want = Buffer.from(key.sha, "hex");
    const got = createHash("sha256").update(pin, "utf8").digest();
    if (!timingSafeEqual(want, got)) {
      await db.run([["INCR", fails], ["EXPIRE", fails, ADMIN.FAIL_TTL]]);
      throw new HttpError(401, "wrong", { left: Math.max(0, ADMIN.TRY_MAX - Number(n)) });
    }
    return issue(key);
  }

  async function headOf(key, info) {
    const memo = heads.get(key);
    if (memo && memo.etag === info.etag && memo.size === info.size) return memo.head;
    let head = null;
    try {
      const first = await r2.get(key, { range: `bytes=0-${ADMIN.HEAD_BYTES - 1}` });
      if (first) {
        head = readHead(first.bytes);
        if (head.need && head.need[1] <= info.size) {
          const more = await r2.get(key, { range: `bytes=${head.need[0]}-${head.need[1] - 1}` });
          head = more ? readHead(first.bytes, { start: head.need[0], bytes: more.bytes }) : { bad: true };
        }
      }
    } catch {
      return null;
    }
    if (!head || head.bad || head.need) head = { bad: true };
    heads.set(key, { etag: info.etag, size: info.size, head });
    if (heads.size > ADMIN.LIST_MAX * 2) heads.delete(heads.keys().next().value);
    return head;
  }

  async function list(request) {
    const key = await session(request);
    let objects;
    try {
      objects = await r2.list(ADMIN.PREFIX);
    } catch {
      throw new HttpError(503, "r2");
    }
    const latest = new Map();
    const loose = [];
    for (const [name, info] of objects) {
      if (!KEY_RE.test(name) || name.split("/").includes("..")) continue;
      const m = /^wgba\/([^/]+)\/([^/]+)\.wgba$/i.exec(name);
      if (m && SEMVER_RE.test(m[2])) {
        const was = latest.get(m[1]);
        if (!was || semverCompare(m[2], was.version) > 0) latest.set(m[1], { name, info, version: m[2], placed: true });
      } else loose.push({ name, info, version: "", placed: false });
    }
    const candidates = [...latest.values(), ...loose].slice(0, ADMIN.LIST_MAX);
    const read = new Array(candidates.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, candidates.length) }, async () => {
        while (next < candidates.length) {
          const i = next++;
          read[i] = await headOf(candidates[i].name, candidates[i].info);
        }
      }),
    );
    const byId = new Map();
    candidates.forEach((c, i) => {
      const head = read[i];
      if (!head || head.bad) return;
      const version = head.version || c.version;
      const item = {
        key: c.name,
        id: head.id,
        version,
        names: head.names,
        short: head.short,
        size: c.info.size,
        file: c.placed ? safeFileName(nameOf(head.names) || head.id.split(".").pop(), head.id) : safeFileName(c.name.slice(c.name.lastIndexOf("/") + 1).replace(/\.wgba$/i, "")),
        label: head.label,
      };
      const was = byId.get(item.id);
      if (!was || semverCompare(item.version, was.version) > 0) byId.set(item.id, item);
    });
    const items = [...byId.values()].sort((a, b) => nameOf(a.names).localeCompare(nameOf(b.names)) || a.id.localeCompare(b.id));
    return { items, updated: key.text };
  }

  async function urls(request, body) {
    await session(request);
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (!keys.length || keys.length > ADMIN.KEYS_MAX || keys.some((k) => typeof k !== "string" || !KEY_RE.test(k) || k.split("/").includes(".."))) throw new HttpError(400, "bad");
    return { urls: keys.map((k) => ({ key: k, url: r2.presign(k, ADMIN.URL_TTL) })), ttl: ADMIN.URL_TTL };
  }

  function reply(status, body, origin) {
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin" };
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
    if (status === 429) headers["Retry-After"] = "600";
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
  }

  async function readBody(request) {
    const text = await request.text();
    if (text.length > ADMIN.BODY_MAX) throw new HttpError(413, "size");
    try {
      const value = JSON.parse(text || "{}");
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {}
    throw new HttpError(400, "bad");
  }

  async function handle(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") ?? "";
    const op = url.pathname.replace(/\/+$/, "").split("/").pop();
    // 브라우저는 같은 출처 GET 에 Origin 을 붙이지 않는다 — Origin 없는 요청은 토큰이 필요한 목록·주소만(입력 확인은 출처 필수)
    if (origin ? !(ORIGINS.includes(origin) || origin === url.origin) : op === "verify") return reply(403, { error: "origin" }, "");
    if (request.method === "OPTIONS") {
      const res = reply(204, null, origin);
      res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.headers.set("Access-Control-Max-Age", "600");
      return res;
    }
    try {
      let out;
      if (request.method === "POST" && op === "verify") out = await verify(request, await readBody(request));
      else if (request.method === "GET" && op === "list") out = await list(request);
      else if (request.method === "POST" && op === "url") out = await urls(request, await readBody(request));
      else throw new HttpError(404, "op");
      return reply(200, out, origin);
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, { error: error.code, ...(error.extra ?? {}) }, origin);
      if (error instanceof StoreError) return reply(503, { error: "store" }, origin);
      return reply(500, { error: "server" }, origin);
    }
  }

  return { handle };
}

let shared = null;

export function handle(request) {
  shared ??= createAdmin();
  return shared.handle(request);
}
