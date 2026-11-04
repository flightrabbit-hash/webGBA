import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { makeStore, StoreError } from "./store.js";
import { makeRelay, RelayError, TURN } from "./turn.js";

export const LIMITS = Object.freeze({
  ROOM_TTL: 150,
  HOLD_TTL: 120,
  ANSWER_TTL: 120,
  CLOSE_TTL: 2,
  SECRET_TTL: 172800,
  RATE_TTL: 70,
  RATE_MAX: 60,
  NEAR_SLOTS: 10,
  NICK_MAX: 12,
  MSG_MAX: 1024,
  BODY_MAX: 4096,
  PLAYERS_MAX: 8,
});

export const ORIGINS = Object.freeze(["https://webgba.vercel.app", "http://ui.localhost", "ui://localhost"]);

class HttpError extends Error {
  constructor(status, code, why) {
    super(code);
    this.status = status;
    this.code = code;
    if (why) this.why = why;
  }
}

const NICK_BAD = new RegExp(`[${[[0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069]].map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join("")}]`, "g");

export function cleanNick(text) {
  const value = String(text ?? "").replace(NICK_BAD, "").replace(/\s+/g, " ").trim();
  return [...value].slice(0, LIMITS.NICK_MAX).join("") || "?";
}

export function ipPrefix(raw) {
  let ip = String(raw ?? "").split(",")[0].trim().replace(/^\[|\](:\d+)?$/g, "");
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) ip = mapped[1];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split(".").every((p) => Number(p) <= 255) ? `4:${ip}` : "";
  if (!ip.includes(":") || !/^[0-9a-f:]+$/i.test(ip)) return "";
  const [head, tail] = ip.split("::");
  const hs = head ? head.split(":") : [];
  const ts = tail !== undefined && tail ? tail.split(":") : [];
  const words = tail !== undefined ? [...hs, ...Array(Math.max(0, 8 - hs.length - ts.length)).fill("0"), ...ts] : hs;
  if (words.length !== 8 || words.some((w) => w.length > 4)) return "";
  return `6:${words.slice(0, 4).map((w) => parseInt(w || "0", 16).toString(16)).join(":")}`;
}

const RE = {
  room: /^\d{6}$/,
  compat: /^[0-9a-f]{16}$/,
  purpose: /^[A-Za-z0-9_.-]{1,32}$/,
  code: /^[A-Za-z0-9_-]+$/,
  nonce: /^[A-Za-z0-9_-]{11}$/,
  group: /^[A-Za-z0-9_-]{16}$/,
  token: /^(\d{8})\.([A-Za-z0-9_-]{22})$/,
  rejoinKey: /^[A-Za-z0-9_-]{16,32}$/,
};

const int = (v, low, high) => {
  const n = typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n >= low && n <= high ? n : null;
};

function need(ok, code = "bad") {
  if (!ok) throw new HttpError(400, code);
}

function code(v) {
  const s = String(v ?? "");
  if (s.length > LIMITS.MSG_MAX) throw new HttpError(413, "size");
  need(s.length >= 16 && RE.code.test(s));
  return s;
}

export function createServer({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), store = null, turnTtl = TURN.TTL } = {}) {
  const db = store ?? makeStore({ env, fetchImpl });
  const relay = makeRelay({ env, fetchImpl, now, db, ttl: turnTtl });
  const secrets = new Map();
  const reads = new Map();

  const today = () => new Date(now()).toISOString().slice(0, 10).replace(/-/g, "");

  async function secretFor(day, create) {
    if (secrets.has(day)) return secrets.get(day);
    const key = `s:${day}`;
    const value = create ? (await db.run([["SET", key, randomBytes(32).toString("hex"), "NX", "EX", LIMITS.SECRET_TTL], ["GET", key]]))[1] : (await db.run([["GET", key]]))[0];
    if (!value || !/^[0-9a-f]{64}$/.test(value)) return null;
    const secret = Buffer.from(value, "hex");
    secrets.set(day, secret);
    if (secrets.size > 3) secrets.delete(secrets.keys().next().value);
    return secret;
  }

  const mac = (secret, parts, bytes = 16) => createHmac("sha256", secret).update(parts.join("|")).digest().subarray(0, bytes).toString("base64url");

  async function token(...parts) {
    const day = today();
    return `${day}.${mac(await secretFor(day, true), parts)}`;
  }

  async function verify(value, ...parts) {
    const m = RE.token.exec(String(value ?? ""));
    if (!m) return false;
    const secret = await secretFor(m[1], m[1] === today());
    if (!secret) return false;
    const want = Buffer.from(mac(secret, parts));
    const got = Buffer.from(m[2]);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  async function groupOf(request) {
    const h = request.headers;
    const prefix = ipPrefix(h.get("x-vercel-forwarded-for") || h.get("x-forwarded-for") || h.get("x-real-ip")) || "?";
    return mac(await secretFor(today(), true), ["g", prefix], 12);
  }

  async function limitWrite(group) {
    const key = `l:${group}:${Math.floor(now() / 60000)}`;
    const [n] = await db.run([["INCR", key]]);
    if (Number(n) > LIMITS.RATE_MAX) throw new HttpError(429, "limit");
    return Number(n) === 1 ? [["EXPIRE", key, LIMITS.RATE_TTL]] : [];
  }

  function limitRead(group) {
    const minute = Math.floor(now() / 60000);
    const key = `${group}|${minute}`;
    const n = (reads.get(key) ?? 0) + 1;
    reads.set(key, n);
    if (reads.size > 2000) for (const k of reads.keys()) if (!k.endsWith(`|${minute}`)) reads.delete(k);
    if (n > LIMITS.RATE_MAX) throw new HttpError(429, "limit");
  }

  const nearKey = (group, slot) => `n:${group}:${slot}`;
  const nearValue = (room, rec) => JSON.stringify({ r: room, n: rec.n, c: rec.c, p: rec.p, k: rec.k, m: rec.m });

  function roomFields(body) {
    const c = String(body.c ?? "");
    const p = String(body.p ?? "");
    const m = int(body.m, 2, LIMITS.PLAYERS_MAX);
    need(RE.compat.test(c) && RE.purpose.test(p) && m !== null);
    return { c, p, m, n: cleanNick(body.n) };
  }

  async function createRoom(request, body) {
    const fields = roomFields(body);
    const o = code(body.o);
    const g = await groupOf(request);
    let pre = await limitWrite(g);
    const x = randomBytes(8).toString("base64url");
    for (let attempt = 0; attempt < 4; attempt++) {
      const room = String(randomInt(100000, 1000000));
      const first = Number(room) % LIMITS.NEAR_SLOTS;
      const rec = { x, ...fields, k: 1, q: 1, o, g, i: first };
      const got = await db.run([...pre, ["SET", `r:${room}`, JSON.stringify(rec), "NX", "EX", LIMITS.ROOM_TTL], ["SET", nearKey(g, first), nearValue(room, rec), "NX", "EX", LIMITS.ROOM_TTL]]);
      pre = [];
      const [madeRoom, madeNear] = got.slice(-2);
      if (madeRoom !== "OK") {
        if (madeNear === "OK") await db.run([["SET", nearKey(g, first), "", "XX", "EX", 1]]);
        continue;
      }
      if (madeNear !== "OK") {
        const [values] = await db.run([["MGET", ...Array.from({ length: LIMITS.NEAR_SLOTS }, (_, j) => nearKey(g, j))]]);
        const free = (values ?? []).findIndex((v) => !v);
        rec.i = -1;
        if (free >= 0) {
          rec.i = free;
          const [placed] = await db.run([["SET", nearKey(g, free), nearValue(room, rec), "NX", "EX", LIMITS.ROOM_TTL]]);
          if (placed !== "OK") rec.i = -1;
        }
        await db.run([["SET", `r:${room}`, JSON.stringify(rec), "XX", "EX", LIMITS.ROOM_TTL]]);
      }
      return { room, x, g, i: rec.i, q: 1, t: await token("h", room, x, g, rec.i), rj: 1 };
    }
    throw new HttpError(503, "busy");
  }

  async function hostBody(body) {
    const room = String(body.room ?? "");
    const x = String(body.x ?? "");
    const g = String(body.g ?? "");
    const i = int(body.i, -1, LIMITS.NEAR_SLOTS - 1);
    need(RE.room.test(room) && RE.nonce.test(x) && RE.group.test(g) && i !== null);
    if (!(await verify(body.t, "h", room, x, g, i))) throw new HttpError(403, "token");
    return { room, x, g, i };
  }

  async function updateRoom(request, body) {
    const { room, x, g, i } = await hostBody(body);
    const fields = roomFields(body);
    const o = code(body.o);
    const q = int(body.q, 1, 1e6);
    const k = int(body.k, 1, fields.m);
    need(q !== null && k !== null);
    const w = body.w === 0 || body.w === "0" ? 0 : 1;
    const pre = await limitWrite(await groupOf(request));
    const rec = { x, ...fields, k, q, o, g, i, w };
    const cmds = [["SET", `r:${room}`, JSON.stringify(rec), "EX", LIMITS.ROOM_TTL]];
    if (i >= 0) cmds.push(k >= fields.m || !w ? ["SET", nearKey(g, i), "", "XX", "EX", 1] : ["SET", nearKey(g, i), nearValue(room, rec), "EX", LIMITS.ROOM_TTL]);
    await db.run([...pre, ...cmds]);
    return { ok: true };
  }

  async function renewRoom(request, body) {
    const { room, x, g, i } = await hostBody(body);
    const fields = roomFields(body);
    const o = code(body.o);
    const q = int(body.q, 1, 1e6);
    const k = int(body.k, 1, fields.m);
    need(q !== null && k !== null);
    const pre = await limitWrite(await groupOf(request));
    const rec = { x, ...fields, k, q, o, g, i, w: 1 };
    const key = `r:${room}`;
    const got = await db.run([...pre, ["SET", key, JSON.stringify(rec), "NX", "EX", LIMITS.ROOM_TTL], ["GET", key]]);
    const [made, now] = got.slice(-2);
    if (made !== "OK" && readRoom(now)?.x !== x) throw new HttpError(409, "taken");
    let slot = i;
    if (i >= 0) {
      const [held] = await db.run([["GET", nearKey(g, i)]]);
      let mine = false;
      try {
        mine = Boolean(held) && JSON.parse(held).r === room;
      } catch {}
      const cmd = k >= fields.m ? null : ["SET", nearKey(g, i), nearValue(room, rec), mine || held === "" ? "XX" : "NX", "EX", LIMITS.ROOM_TTL];
      const [placed] = cmd ? await db.run([cmd]) : ["OK"];
      if (placed !== "OK") slot = -1;
    }
    rec.i = slot;
    if (made !== "OK" || slot !== i) await db.run([["SET", key, JSON.stringify(rec), "XX", "EX", LIMITS.ROOM_TTL]]);
    return { room, i: slot, t: slot === i ? String(body.t) : await token("h", room, x, g, slot), same: made !== "OK" };
  }

  async function closeRoom(request, body) {
    const { room, g, i } = await hostBody(body);
    const pre = await limitWrite(await groupOf(request));
    const cmds = [["SET", `r:${room}`, "{}", "XX", "EX", LIMITS.CLOSE_TTL]];
    if (i >= 0) cmds.push(["SET", nearKey(g, i), "", "XX", "EX", 1]);
    await db.run([...pre, ...cmds]);
    return { ok: true };
  }

  async function near(request) {
    const g = await groupOf(request);
    limitRead(g);
    const [values] = await db.run([["MGET", ...Array.from({ length: LIMITS.NEAR_SLOTS }, (_, j) => nearKey(g, j))]]);
    const rooms = [];
    for (const v of values ?? []) {
      if (!v) continue;
      try {
        const e = JSON.parse(v);
        if (RE.room.test(e.r) && Number.isInteger(e.k) && Number.isInteger(e.m) && e.k < e.m) rooms.push({ room: e.r, nick: String(e.n), c: String(e.c), p: String(e.p), k: e.k, m: e.m });
      } catch {}
    }
    return { rooms };
  }

  function readRoom(v) {
    if (!v) return null;
    try {
      const rec = JSON.parse(v);
      return rec && RE.nonce.test(rec.x ?? "") && rec.o ? rec : null;
    } catch {
      return null;
    }
  }

  async function join(request, body) {
    const room = String(body.room ?? "");
    const c = String(body.c ?? "");
    const p = String(body.p ?? "");
    need(RE.room.test(room) && RE.compat.test(c) && RE.purpose.test(p));
    const pre = await limitWrite(await groupOf(request));
    const got = await db.run([...pre, ["GET", `r:${room}`]]);
    const rec = readRoom(got[got.length - 1]);
    if (!rec) throw new HttpError(404, "none");
    if (rec.c !== c) throw new HttpError(409, "version");
    if (rec.p !== p) throw new HttpError(409, "purpose");
    if (rec.w === 0) throw new HttpError(409, "paused");
    if (rec.k >= rec.m) throw new HttpError(409, "full");
    const last = rec.k + 1 >= rec.m;
    const cmds = [["SET", `c:${rec.x}:${rec.q}`, String(now()), "NX", "EX", LIMITS.ROOM_TTL]];
    if (last && rec.i >= 0) cmds.push(["SET", nearKey(rec.g, rec.i), "", "XX", "EX", 1]);
    const [claimed] = await db.run(cmds);
    if (claimed !== "OK") {
      if (last) throw new HttpError(409, "full");
      return { wait: true, q: rec.q };
    }
    return { o: rec.o, q: rec.q, x: rec.x, t: await token("g", rec.x, rec.q), rt: await token("j", rec.x), hn: rec.n, k: rec.k, m: rec.m };
  }

  const slotOf = (v) => int(v, 1, LIMITS.PLAYERS_MAX - 1);
  const mailKey = (x, s) => `j:${x}:${s}`;
  const replyKey = (x, s) => `k:${x}:${s}`;

  async function guestBody(body) {
    const x = String(body.x ?? "");
    const s = slotOf(body.s);
    const u = String(body.u ?? "");
    need(RE.nonce.test(x) && s !== null && RE.nonce.test(u));
    if (!(await verify(body.rt, "j", x))) throw new HttpError(403, "token");
    return { x, s, u };
  }

  async function rejoinPost(request, body) {
    if (body.t !== undefined) {
      const { x } = await hostBody(body);
      const s = slotOf(body.s);
      const u = String(body.u ?? "");
      need(s !== null && RE.nonce.test(u));
      const reply = { u };
      if (body.a !== undefined) reply.a = code(body.a);
      else if (body.n) reply.n = 1;
      else reply.no = 1;
      const pre = await limitWrite(await groupOf(request));
      await db.run([...pre, ["SET", replyKey(x, s), JSON.stringify(reply), "EX", LIMITS.ANSWER_TTL]]);
      return { ok: true };
    }
    const { x, s, u } = await guestBody(body);
    const k = String(body.k ?? "");
    const key = String(body.key ?? "");
    need(["r", "n", "b"].includes(k) && RE.rejoinKey.test(key));
    const mail = { u, k, key };
    if (k !== "b") mail.o = code(body.o);
    const pre = await limitWrite(await groupOf(request));
    await db.run([...pre, ["SET", mailKey(x, s), JSON.stringify(mail), "EX", LIMITS.ANSWER_TTL]]);
    return { ok: true };
  }

  async function rejoinPoll(request, query) {
    if (query.t !== undefined) {
      const { x } = await hostBody(query);
      const slots = [...new Set(String(query.s ?? "").split(",").map(slotOf))];
      need(slots.length >= 1 && slots.length <= LIMITS.PLAYERS_MAX - 1 && slots.every((s) => s !== null));
      limitRead(await groupOf(request));
      const [values] = await db.run([["MGET", ...slots.map((s) => mailKey(x, s))]]);
      const offers = [];
      (values ?? []).forEach((v, i) => {
        if (!v) return;
        try {
          const m = JSON.parse(v);
          if (m && RE.nonce.test(m.u ?? "")) offers.push({ s: slots[i], u: m.u, k: m.k, key: m.key, o: m.o });
        } catch {}
      });
      return { offers };
    }
    const { x, s, u } = await guestBody(query);
    const room = String(query.room ?? "");
    need(RE.room.test(room));
    limitRead(await groupOf(request));
    const [[v, r]] = await db.run([["MGET", replyKey(x, s), `r:${room}`]]);
    const rec = readRoom(r);
    let reply = null;
    try {
      reply = v ? JSON.parse(v) : null;
    } catch {}
    const mine = reply && reply.u === u;
    const live = Boolean(rec && rec.x === x);
    return { live, a: mine && reply.a ? reply.a : null, n: mine && reply.n ? 1 : 0, no: mine && reply.no ? 1 : 0, away: live ? awayLeft(rec) : 0 };
  }

  const awayLeft = (rec) => (rec?.h ? Math.max(0, rec.h + LIMITS.HOLD_TTL * 1000 - now()) : 0);

  async function markAway(request, room, x) {
    const key = `r:${room}`;
    const got = await db.run([...(await limitWrite(await groupOf(request))), ["GET", key]]);
    const rec = readRoom(got[got.length - 1]);
    if (!rec || rec.x !== x) throw new HttpError(404, "none");
    if (!rec.h) {
      Object.assign(rec, { h: now(), w: 0 });
      const cmds = [["SET", key, JSON.stringify(rec), "XX", "EX", LIMITS.HOLD_TTL]];
      if (rec.i >= 0) cmds.push(["SET", nearKey(rec.g, rec.i), "", "XX", "EX", 1]);
      const [set] = await db.run(cmds);
      if (set !== "OK") throw new HttpError(404, "none");
    }
    return { away: awayLeft(rec) };
  }

  async function hostAway(request, body) {
    const { room, x } = await hostBody(body);
    return markAway(request, room, x);
  }

  async function guestHold(request, body) {
    const room = String(body.room ?? "");
    const x = String(body.x ?? "");
    need(RE.room.test(room) && RE.nonce.test(x));
    if (!(await verify(body.rt, "j", x))) throw new HttpError(403, "token");
    return markAway(request, room, x);
  }

  async function hostBack(request, body) {
    const { room, x, g, i } = await hostBody(body);
    const fields = roomFields(body);
    const o = code(body.o);
    const q = int(body.q, 1, 1e6);
    const k = int(body.k, 1, fields.m);
    need(q !== null && k !== null);
    const key = `r:${room}`;
    const got = await db.run([...(await limitWrite(await groupOf(request))), ["GET", key]]);
    const rec = readRoom(got[got.length - 1]);
    if (!rec || rec.x !== x) throw new HttpError(404, "none");
    const next = { x, ...fields, k, q: Math.max(q, rec.q), o, g, i, w: 0 };
    const [set] = await db.run([["SET", key, JSON.stringify(next), "XX", "EX", LIMITS.ROOM_TTL]]);
    if (set !== "OK") throw new HttpError(404, "none");
    return { ok: true, q: next.q, left: awayLeft(rec) };
  }

  async function answer(request, body) {
    const x = String(body.x ?? "");
    const q = int(body.q, 1, 1e6);
    need(RE.nonce.test(x) && q !== null);
    const d = code(body.d);
    if (!(await verify(body.t, "g", x, q))) throw new HttpError(403, "token");
    const pre = await limitWrite(await groupOf(request));
    await db.run([...pre, ["SET", `a:${x}:${q}`, d, "NX", "EX", LIMITS.ANSWER_TTL]]);
    return { ok: true };
  }

  async function poll(request, query) {
    const { x } = await hostBody(query);
    const q = int(query.q, 1, 1e6);
    need(q !== null);
    limitRead(await groupOf(request));
    const [[a, c]] = await db.run([["MGET", `a:${x}:${q}`, `c:${x}:${q}`]]);
    return { a: a || null, c: Number(c) || 0 };
  }

  async function status(request, query) {
    const room = String(query.room ?? "");
    need(RE.room.test(room));
    limitRead(await groupOf(request));
    const [v] = await db.run([["GET", `r:${room}`]]);
    const rec = readRoom(v);
    if (!rec) throw new HttpError(404, "none");
    return { q: rec.q, k: rec.k, m: rec.m };
  }

  async function relayProof(body) {
    if (body.t !== undefined) {
      const { room, x } = await hostBody(body);
      return { room, x };
    }
    const room = String(body.room ?? "");
    const x = String(body.x ?? "");
    need(RE.room.test(room) && RE.nonce.test(x));
    if (!(await verify(body.rt, "j", x))) throw new HttpError(403, "token");
    return { room, x };
  }

  async function turn(request, body) {
    const { room, x } = await relayProof(body);
    const g = await groupOf(request);
    const pre = await limitWrite(g);
    const rate = `tl:${g}:${Math.floor(now() / 3600000)}`;
    const mark = `u:${x}`;
    const got = await db.run([...pre, ["INCR", rate], ["EXPIRE", rate, TURN.RATE_TTL], ["MGET", `r:${room}`, mark]]);
    const [n, , [roomValue, marked]] = got.slice(-3);
    if (Number(n) > TURN.RATE_MAX) throw new HttpError(429, "limit");
    if (readRoom(roomValue)?.x !== x && !marked) throw new HttpError(404, "none");
    let out;
    try {
      out = await relay.issue();
    } catch (error) {
      if (error instanceof RelayError) throw new HttpError(503, error.code, error.why);
      throw error;
    }
    await db.run([["SET", mark, "1", "EX", TURN.MARK_TTL]]);
    return out;
  }

  function allowed(request, url) {
    const origin = request.headers.get("origin");
    if (!origin) return { ok: true, origin: "" };
    return { ok: ORIGINS.includes(origin) || origin === url.origin, origin };
  }

  function reply(status, body, origin) {
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin" };
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
    if (status === 429) headers["Retry-After"] = "30";
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
  }

  async function readBody(request) {
    const text = await request.text();
    if (text.length > LIMITS.BODY_MAX) throw new HttpError(413, "size");
    try {
      const value = JSON.parse(text || "{}");
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {}
    throw new HttpError(400, "bad");
  }

  async function handle(request) {
    const url = new URL(request.url);
    const { ok, origin } = allowed(request, url);
    if (!ok) return reply(403, { error: "origin" }, "");
    const op = url.pathname.replace(/\/+$/, "").split("/").pop();
    if (op === "turn" && !origin) return reply(403, { error: "origin" }, "");
    if (request.method === "OPTIONS") {
      const res = reply(204, null, origin);
      res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.headers.set("Access-Control-Allow-Headers", "Content-Type");
      res.headers.set("Access-Control-Max-Age", "600");
      return res;
    }
    try {
      if (!db.ready) throw new StoreError("config");
      const query = Object.fromEntries(url.searchParams);
      let out;
      if (request.method === "POST" && op === "room") {
        const body = await readBody(request);
        out = body.close ? await closeRoom(request, body) : body.room ? await updateRoom(request, body) : await createRoom(request, body);
      } else if (request.method === "POST" && op === "renew") out = await renewRoom(request, await readBody(request));
      else if (request.method === "GET" && op === "near") out = await near(request);
      else if (request.method === "POST" && op === "join") out = await join(request, await readBody(request));
      else if (request.method === "POST" && op === "msg") out = await answer(request, await readBody(request));
      else if (request.method === "GET" && op === "msg") out = await poll(request, query);
      else if (request.method === "GET" && op === "room") out = await status(request, query);
      else if (request.method === "POST" && op === "rj") out = await rejoinPost(request, await readBody(request));
      else if (request.method === "GET" && op === "rj") out = await rejoinPoll(request, query);
      else if (request.method === "POST" && op === "turn") out = await turn(request, await readBody(request));
      else if (request.method === "POST" && op === "away") out = await hostAway(request, await readBody(request));
      else if (request.method === "POST" && op === "hold") out = await guestHold(request, await readBody(request));
      else if (request.method === "POST" && op === "back") out = await hostBack(request, await readBody(request));
      else throw new HttpError(404, "op");
      return reply(200, out, origin);
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, error.why ? { error: error.code, why: error.why } : { error: error.code }, origin);
      if (error instanceof StoreError) return reply(503, { error: "store" }, origin);
      return reply(500, { error: "server" }, origin);
    }
  }

  return { handle };
}

let shared = null;

export function handle(request) {
  shared ??= createServer();
  return shared.handle(request);
}
