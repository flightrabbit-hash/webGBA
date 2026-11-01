export const API_PATH = "/api/v1/mp/";
export const APP_API = "https://webgba.vercel.app/api/v1/mp/";
export const POLL_MS = 3000;
export const SLOW_POLL_MS = 5000;
export const SLOW_AFTER_MS = 60000;
export const NEAR_MS = 5000;
export const NEAR_RETRY_MS = 10000;
export const KEEP_MS = 100000;
export const CLAIM_MS = 20000;
export const JOIN_WAIT_MS = 30000;

const FAIL_LIMIT = 3;

export class SignalError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export const serverDown = (error) => error instanceof SignalError && ["offline", "store", "limit", "server", "bad"].includes(error.code);

export const signalPurpose = (id) => String(id ?? "").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 32) || "net";

export async function signalCompat(compat) {
  return String((await compat) ?? "").slice(0, 16).padEnd(16, "0");
}

export class Signal {
  constructor({ base, fetchImpl = null, timeoutMs = 8000 } = {}) {
    this.base = base;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
  }

  async request(method, op, data = {}) {
    if (globalThis.navigator?.onLine === false) throw new SignalError("offline");
    const url = new URL(op, this.base);
    const init = { method, cache: "no-store", credentials: "omit" };
    if (method === "GET") for (const [k, v] of Object.entries(data)) url.searchParams.set(k, String(v));
    else init.body = JSON.stringify(data);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    init.signal = ctrl.signal;
    this.calls++;
    let response;
    try {
      response = await (this.fetchImpl ?? globalThis.fetch)(url, init);
    } catch {
      throw new SignalError("offline");
    } finally {
      clearTimeout(timer);
    }
    let body = null;
    try {
      body = await response.json();
    } catch {}
    if (response.ok && body && typeof body === "object") return body;
    const code = typeof body?.error === "string" ? body.error : response.status === 429 ? "limit" : response.status >= 500 ? "server" : "bad";
    throw new SignalError(code, response.status);
  }

  create(info) {
    return this.request("POST", "room", info);
  }

  update(info) {
    return this.request("POST", "room", info);
  }

  close(auth) {
    return this.request("POST", "room", { ...auth, close: 1 });
  }

  near() {
    return this.request("GET", "near");
  }

  join(info) {
    return this.request("POST", "join", info);
  }

  answer(info) {
    return this.request("POST", "msg", info);
  }

  poll(auth, q) {
    return this.request("GET", "msg", { ...auth, q });
  }

  status(room) {
    return this.request("GET", "room", { room });
  }
}

export class RoomHost {
  constructor({ signal, session, info, log = () => {}, onChange = () => {}, onError = () => {}, now = () => Date.now() }) {
    this.signal = signal;
    this.session = session;
    this.info = info;
    this.log = log;
    this.onChange = onChange;
    this.onError = onError;
    this.now = now;
    this.room = "";
    this.auth = null;
    this.q = 0;
    this.invite = null;
    this.running = false;
    this.parked = false;
    this.active = true;
    this.timer = 0;
    this.failures = 0;
    this.claimSeen = 0;
    this.keepAt = 0;
    this.eventAt = 0;
  }

  get full() {
    return this.session.count >= this.info.m;
  }

  async open() {
    this.invite = await this.session.invite();
    const made = await this.signal.create({ ...this.info, o: this.invite.code });
    this.room = made.room;
    this.auth = { room: made.room, x: made.x, g: made.g, i: made.i, t: made.t };
    this.q = made.q;
    this.keepAt = this.now() + KEEP_MS;
    this.eventAt = this.now();
    this.running = true;
    this.log("info", `방 ${made.room} 만듦(근처 칸 ${made.i})`);
    this.schedule();
    return made.room;
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = 0;
    if (!this.running || this.parked || !this.active) return;
    const wait = this.now() - this.eventAt > SLOW_AFTER_MS ? SLOW_POLL_MS : POLL_MS;
    this.timer = setTimeout(() => this.tick(), wait);
  }

  async tick() {
    this.timer = 0;
    if (!this.running) return;
    if (this.session.closed) return this.stop();
    try {
      if (!this.invite) {
        if (this.full) this.parked = true;
        else await this.reoffer();
      } else {
        const got = await this.signal.poll(this.auth, this.q);
        this.failures = 0;
        if (got.a) await this.take(got.a);
        else if (got.c) {
          this.claimSeen ||= this.now();
          if (this.now() - this.claimSeen > CLAIM_MS) {
            this.log("warn", `방 ${this.room}: 자리를 잡은 사람이 답을 보내지 않아 새 연결 코드로 바꿈`);
            await this.reoffer();
          }
        } else if (this.now() >= this.keepAt) await this.push();
      }
    } catch (error) {
      this.failures++;
      this.log("warn", `방 ${this.room}: 서버 요청 실패(${error?.code ?? error?.message ?? error})`);
      if (this.failures === FAIL_LIMIT) this.onError(error);
    }
    this.schedule();
  }

  async take(answer) {
    const invite = this.invite;
    this.invite = null;
    this.claimSeen = 0;
    this.eventAt = this.now();
    try {
      await this.session.accept(invite.id, answer);
    } catch (error) {
      this.log("warn", `방 ${this.room}: 연결 실패(${error?.code ?? error?.message ?? error})`);
    }
    this.onChange();
    if (!this.running || this.session.closed) return this.stop();
    if (this.full) this.parked = true;
    else await this.reoffer();
  }

  async reoffer() {
    if (this.invite) this.session.cancelInvite(this.invite.id);
    this.invite = null;
    this.claimSeen = 0;
    this.invite = await this.session.invite();
    this.q += 1;
    await this.push();
  }

  async push() {
    await this.signal.update({ ...this.auth, ...this.info, o: this.invite.code, q: this.q, k: this.session.count });
    this.keepAt = this.now() + KEEP_MS;
  }

  setActive(on) {
    this.active = Boolean(on);
    if (this.active && this.running && !this.timer) {
      if (this.parked && !this.full) {
        this.parked = false;
        this.eventAt = this.now();
      }
      this.schedule();
    } else if (!this.active) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
  }

  resume() {
    if (this.running && this.parked && !this.full && !this.session.closed) {
      this.parked = false;
      this.eventAt = this.now();
      this.schedule();
    }
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = 0;
  }

  close() {
    const open = this.running && this.auth && !this.full;
    this.stop();
    if (this.invite && !this.session.closed) this.session.cancelInvite(this.invite.id);
    this.invite = null;
    if (open) this.signal.close(this.auth).catch(() => {});
  }
}
