export const API_PATH = "/api/v1/mp/";
export const APP_API = "https://webgba.vercel.app/api/v1/mp/";
export const POLL_MS = 3000;
export const SLOW_POLL_MS = 5000;
export const SLOW_AFTER_MS = 60000;
export const ACCEPT_MS = 150000;
export const ROOM_TTL_MS = 150000;
export const NEAR_MS = 5000;
export const NEAR_RETRY_MS = 10000;
export const KEEP_MS = 100000;
export const CLAIM_MS = 20000;
export const JOIN_WAIT_MS = 30000;
export const REJOIN_KEEP_MS = 120000;
export const REJOIN_POLL_MS = 2000;
export const REJOIN_SLOW_MS = 10000;
export const REJOIN_FAST_FOR_MS = 60000;
export const GUEST_POLL_MS = 1500;
export const ANSWER_WAIT_MS = 30000;
export const WELCOME_WAIT_MS = 15000;
export const RESTART_WAIT_MS = 12000;
export const OFFLINE_FOR_MS = 10000;
export const TURN_WAIT_MS = 6000;

const FAIL_LIMIT = 3;
const HOST_LEFT = 7;
const SOLO = 9;

export function nonce() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

  async request(method, op, data = {}, timeoutMs = this.timeoutMs) {
    if (globalThis.navigator?.onLine === false) throw new SignalError("offline");
    const url = new URL(op, this.base);
    const init = { method, cache: "no-store", credentials: "omit" };
    if (method === "GET") for (const [k, v] of Object.entries(data)) url.searchParams.set(k, String(v));
    else init.body = JSON.stringify(data);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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

  renew(info) {
    return this.request("POST", "renew", info);
  }

  close(auth) {
    return this.request("POST", "room", { ...auth, close: 1 });
  }

  closeBeacon(auth) {
    try {
      const send = globalThis.navigator?.sendBeacon;
      if (typeof send !== "function") return false;
      this.calls++;
      return Boolean(send.call(globalThis.navigator, new URL("room", this.base).href, JSON.stringify({ ...auth, close: 1 })));
    } catch {
      return false;
    }
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

  rejoinPost(info) {
    return this.request("POST", "rj", info);
  }

  rejoinPoll(query) {
    return this.request("GET", "rj", query);
  }

  turn(proof) {
    return this.request("POST", "turn", proof, TURN_WAIT_MS);
  }
}

export class RoomHost {
  constructor({ signal, session, info, log = () => {}, onChange = () => {}, onError = () => {}, onPause = () => {}, now = () => Date.now(), limit = 0 }) {
    this.signal = signal;
    this.session = session;
    this.info = info;
    this.log = log;
    this.onChange = onChange;
    this.onError = onError;
    this.onPause = onPause;
    this.now = now;
    this.limit = limit > 0 ? limit : 0;
    this.acceptUntil = 0;
    this.pausedAt = 0;
    this.pushedAt = 0;
    this.renewing = false;
    this.room = "";
    this.auth = null;
    this.q = 0;
    this.invite = null;
    this.lastCode = "";
    this.running = false;
    this.parked = false;
    this.active = true;
    this.timer = 0;
    this.failures = 0;
    this.failSince = 0;
    this.claimSeen = 0;
    this.keepAt = 0;
    this.eventAt = 0;
    this.rejoin = false;
    this.upgrade = false;
    this.watchSince = 0;
    this.handled = new Map();
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
    this.lastCode = this.invite.code;
    this.pushedAt = this.now();
    this.acceptUntil = this.pushedAt + this.limit;
    this.keepAt = this.limit ? this.acceptUntil + 1 : this.now() + KEEP_MS;
    this.eventAt = this.now();
    this.running = true;
    this.rejoin = made.rj === 1 && this.session.rejoinGame;
    if (this.rejoin) this.session.helper = this;
    this.log("info", `방 ${made.room} 만듦(근처 칸 ${made.i}${this.rejoin ? " · 다시 들어오기" : ""})`);
    this.schedule();
    this.relayLater();
    return made.room;
  }

  relayLater() {
    const invite = this.invite;
    if (!invite || invite.relay || typeof this.session.warmRelay !== "function") return;
    this.session.warmRelay().then((ok) => {
      if (!ok || !this.running || this.invite !== invite) return;
      this.upgrade = true;
      this.schedule(200);
    });
  }

  trouble(kind) {
    if (kind !== "watch" || !this.running) return;
    if (!this.watchSince) this.watchSince = this.now();
    if (!this.ticking && (!this.timer || this.waitLeft > REJOIN_POLL_MS)) this.schedule(REJOIN_POLL_MS);
  }

  offline() {
    return Boolean(this.failSince) && this.now() - this.failSince >= OFFLINE_FOR_MS;
  }

  rejoinWait() {
    if (this.session.attention().length) {
      if (!this.watchSince) this.watchSince = this.now();
      return this.now() - this.watchSince < REJOIN_FAST_FOR_MS ? REJOIN_POLL_MS : REJOIN_SLOW_MS;
    }
    this.watchSince = 0;
    return Number.isFinite(this.keepAt) ? Math.max(1000, this.keepAt - this.now()) : 0;
  }

  get expired() {
    if (!this.limit || this.now() < this.acceptUntil) return false;
    return !(this.claimSeen && this.now() - this.claimSeen <= CLAIM_MS);
  }

  get inviting() {
    return !this.parked && this.active && !this.expired;
  }

  get acceptLeft() {
    return this.limit && this.running ? Math.max(0, this.acceptUntil - this.now()) : 0;
  }

  nextKeep(now) {
    if (this.inviting) return this.limit ? this.acceptUntil + 1 : now + KEEP_MS;
    if (this.limit && !(this.rejoin && this.session.count > 1)) return Infinity;
    return now + REJOIN_KEEP_MS;
  }

  schedule(force = 0) {
    if (this.ticking) return;
    clearTimeout(this.timer);
    this.timer = 0;
    if (!this.running) return;
    const waits = [];
    if (force) waits.push(force);
    if (this.inviting) waits.push(this.now() - this.eventAt > SLOW_AFTER_MS ? SLOW_POLL_MS : POLL_MS);
    if (this.limit && !this.pausedAt) waits.push(Math.max(200, this.acceptUntil - this.now()));
    if (this.rejoin) {
      const wait = this.rejoinWait();
      if (wait) waits.push(wait);
    }
    if (!waits.length) return;
    const wait = Math.max(200, Math.min(...waits));
    this.waitLeft = wait;
    this.timer = setTimeout(() => this.tick(), wait);
  }

  async tick() {
    this.timer = 0;
    if (!this.running) return;
    if (this.session.closed) return this.stop();
    this.ticking = true;
    try {
      if (this.limit && !this.pausedAt && this.expired) await this.pause();
      if (this.rejoin) await this.rejoinTick();
      if (this.inviting) {
        if (!this.invite) {
          if (this.full) this.parked = true;
          else await this.reoffer();
        } else {
          const got = await this.signal.poll(this.auth, this.q);
          if (got.a) await this.take(got.a);
          else if (got.c) {
            this.claimSeen ||= this.now();
            if (this.now() - this.claimSeen > CLAIM_MS) {
              this.log("warn", `방 ${this.room}: 자리를 잡은 사람이 답을 보내지 않아 새 연결 코드로 바꿈`);
              await this.reoffer();
            }
          } else if (this.upgrade && !this.invite.relay) {
            this.log("info", `방 ${this.room}: 중계 서버 접속 정보를 받아 새 연결 코드로 바꿈(방 코드 그대로)`);
            await this.reoffer();
          } else if (this.now() >= this.keepAt) await this.push();
        }
      }
      this.failures = 0;
      this.failSince = 0;
    } catch (error) {
      this.failures++;
      this.failSince ||= this.now();
      this.log("warn", `방 ${this.room}: 서버 요청 실패(${error?.code ?? error?.message ?? error})`);
      if (this.failures === FAIL_LIMIT) this.onError(error);
    }
    this.ticking = false;
    this.schedule();
  }

  async rejoinTick() {
    const slots = this.session.attention();
    if (slots.length) {
      const got = await this.signal.rejoinPoll({ ...this.auth, s: slots.join(",") });
      for (const item of Array.isArray(got.offers) ? got.offers : []) await this.takeRejoin(item);
    }
    if (!this.inviting && this.now() >= this.keepAt && !this.session.closed) await this.push();
  }

  async takeRejoin(item) {
    const s = Number(item?.s);
    if (!Number.isInteger(s) || s < 1 || typeof item.u !== "string" || this.handled.get(s) === item.u) return;
    this.handled.set(s, item.u);
    const member = this.session.members.get(s);
    if (!member?.key || item.key !== member.key) {
      this.log("warn", `방 ${this.room}: 자리 ${s} 다시 들어오기 요청의 열쇠가 맞지 않음`);
      if (item.k !== "b") await this.signal.rejoinPost({ ...this.auth, s, u: item.u, no: 1 });
      return;
    }
    if (item.k === "b") return this.session.release(s);
    const reply = { ...this.auth, s, u: item.u };
    try {
      if (item.k === "r") reply.a = await this.session.answerRestart(s, item.o);
      else reply.a = await this.session.acceptRejoin(item.o);
    } catch (error) {
      this.log("warn", `방 ${this.room}: 자리 ${s} ${item.k === "r" ? "ICE 재시작" : "다시 들어오기"} 실패(${error?.code ?? error?.message ?? error})`);
      if (item.k === "r") reply.n = 1;
      else reply.no = 1;
    }
    if (this.session.closed) return;
    await this.signal.rejoinPost(reply);
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
    this.upgrade = false;
    this.invite = await this.session.invite();
    this.lastCode = this.invite.code;
    this.q += 1;
    await this.push();
  }

  get count() {
    return Math.min(this.info.m, Math.max(1, this.session.count));
  }

  async push() {
    const open = this.inviting;
    await this.signal.update({ ...this.auth, ...this.info, o: this.invite?.code ?? this.lastCode, q: this.q, k: this.count, ...(this.limit && !open ? { w: 0 } : {}) });
    this.pushedAt = this.now();
    this.keepAt = this.nextKeep(this.pushedAt);
  }

  async pause() {
    this.pausedAt = this.now();
    if (this.invite) this.session.cancelInvite(this.invite.id);
    this.invite = null;
    this.claimSeen = 0;
    this.log("info", `방 ${this.room}: 참가 받기 멈춤(2분 30초 지남)`);
    try {
      await this.push();
    } finally {
      this.onPause();
      this.onChange();
    }
  }

  async renew() {
    if (!this.limit || !this.running || this.session.closed || this.renewing) return false;
    this.renewing = true;
    clearTimeout(this.timer);
    this.timer = 0;
    try {
      const now = this.now();
      if (this.invite) this.session.cancelInvite(this.invite.id);
      this.invite = null;
      this.claimSeen = 0;
      this.parked = this.full;
      if (!this.parked) {
        this.invite = await this.session.invite();
        this.lastCode = this.invite.code;
      }
      this.q += 1;
      this.acceptUntil = now + this.limit;
      this.pausedAt = 0;
      this.eventAt = now;
      await this.reclaim();
      this.log("info", `방 ${this.room}: 참가 다시 받기(2분 30초)`);
      return true;
    } finally {
      this.renewing = false;
      this.onChange();
      this.schedule();
    }
  }

  async reclaim() {
    const body = { ...this.auth, ...this.info, o: this.lastCode, q: this.q, k: this.count };
    try {
      const got = await this.signal.renew(body);
      this.auth = { ...this.auth, i: got.i, t: got.t };
    } catch (error) {
      if (!(error instanceof SignalError) || !["taken", "op", "token", "none"].includes(error.code)) throw error;
      const old = this.room;
      const made = await this.signal.create({ ...this.info, o: this.lastCode });
      this.room = made.room;
      this.auth = { room: made.room, x: made.x, g: made.g, i: made.i, t: made.t };
      this.q = made.q;
      this.log("warn", `방 ${old}: 같은 방 코드를 다시 쓰지 못해 새 방 ${made.room}`);
      if (this.session.count > 1) await this.signal.update({ ...this.auth, ...this.info, o: this.lastCode, q: this.q, k: this.count });
    }
    this.pushedAt = this.now();
    this.keepAt = this.nextKeep(this.pushedAt);
  }

  setActive(on) {
    this.active = Boolean(on);
    if (this.active && this.running && !this.timer) {
      if (this.parked && !this.full) {
        this.parked = false;
        this.eventAt = this.now();
      }
      this.schedule();
    } else if (!this.active && !this.rejoin) {
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
    const open = Boolean(this.auth) && !this.shut;
    this.shut = true;
    this.stop();
    if (this.session.helper === this) this.session.helper = null;
    if (this.invite && !this.session.closed) this.session.cancelInvite(this.invite.id);
    this.invite = null;
    if (!open) return;
    const auth = this.auth;
    this.signal.close(auth).catch(() => {
      if (!this.rejoin || typeof globalThis.addEventListener !== "function") return;
      globalThis.addEventListener("online", () => this.signal.close(auth).catch(() => {}), { once: true });
    });
  }

  beacon() {
    if (!this.auth || this.shut) return false;
    this.shut = true;
    this.stop();
    return this.signal.closeBeacon(this.auth);
  }
}

export class RoomGuest {
  constructor({ signal, session, room, x, rt, log = () => {}, now = () => Date.now() }) {
    this.signal = signal;
    this.session = session;
    this.room = room;
    this.x = x;
    this.rt = rt;
    this.log = log;
    this.now = now;
    this.rejoin = Boolean(rt) && session.rejoinGame;
    this.state = "";
    this.busy = false;
    this.wakeFn = null;
    this.restartAt = 0;
    this.stopped = false;
    this.onOnline = () => this.trouble("now");
    if (this.rejoin) {
      session.helper = this;
      globalThis.addEventListener?.("online", this.onOnline);
    }
  }

  get auth() {
    return { room: this.room, x: this.x, rt: this.rt, s: this.session.slot };
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.session.changed();
  }

  nap(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wakeFn = done;
    });
  }

  wake() {
    const fn = this.wakeFn;
    this.wakeFn = null;
    fn?.();
  }

  trouble(kind) {
    if (this.stopped) return;
    if (kind === "closed") return this.stop();
    if (kind === "back") return this.setState("");
    if (kind === "restart") {
      if (!this.busy && !this.session.rejoining && this.now() - this.restartAt > RESTART_WAIT_MS) this.run(() => this.restart());
      return;
    }
    if (kind === "lost" || kind === "now") {
      if (!this.session.rejoining) return;
      if (this.busy) return this.wake();
      this.run(() => this.loop());
    }
  }

  async run(job) {
    this.busy = true;
    try {
      await job();
    } catch (error) {
      this.log("warn", `다시 연결 실패: ${error?.code ?? error?.message ?? error}`);
    } finally {
      this.busy = false;
      this.wakeFn = null;
    }
    if (!this.stopped && this.session.rejoining && !this.session.closed) this.run(() => this.loop());
  }

  async restart() {
    const s = this.session;
    this.restartAt = this.now();
    const u = nonce();
    const code = await s.restartOffer();
    try {
      await this.signal.rejoinPost({ ...this.auth, u, k: "r", o: code, key: s.rejoinKey });
    } catch (error) {
      await s.restartAbort();
      throw error;
    }
    this.log("info", "ICE 재시작 요청");
    const until = this.now() + RESTART_WAIT_MS;
    while (!s.closed && !s.rejoining && this.now() < until) {
      await this.nap(GUEST_POLL_MS);
      let got;
      try {
        got = await this.signal.rejoinPoll({ ...this.auth, u });
      } catch {
        continue;
      }
      if (got.live === false) return s.close(HOST_LEFT);
      if (got.n) {
        await s.restartAbort();
        return s.linkDown(s.link, 4);
      }
      if (got.a) {
        try {
          await s.restartAnswer(got.a);
        } catch {
          await s.restartAbort();
        }
        return;
      }
      if (got.no) break;
    }
    await s.restartAbort();
  }

  async loop() {
    const s = this.session;
    let tries = 0;
    while (!s.closed && s.rejoining && !this.stopped) {
      if (globalThis.navigator?.onLine === false) {
        this.setState("offline");
        await this.nap(5000);
        continue;
      }
      this.setState("offer");
      const u = nonce();
      let code;
      try {
        code = await s.rejoinOffer();
      } catch {
        tries++;
        await this.nap(Math.min(10000, 1000 * tries));
        continue;
      }
      if (!s.rejoining) return;
      try {
        await this.signal.rejoinPost({ ...this.auth, u, k: "n", o: code, key: s.rejoinKey });
      } catch (error) {
        this.setState(error?.code === "offline" ? "offline" : "server");
        await this.nap(error?.code === "offline" ? 3000 : 5000);
        continue;
      }
      this.setState("wait");
      const until = this.now() + ANSWER_WAIT_MS;
      let answered = false;
      let refused = false;
      let lostServer = false;
      while (!s.closed && s.rejoining && this.now() < until) {
        await this.nap(GUEST_POLL_MS);
        let got;
        try {
          got = await this.signal.rejoinPoll({ ...this.auth, u });
        } catch (error) {
          if (error?.code === "offline") {
            lostServer = true;
            break;
          }
          continue;
        }
        if (got.live === false) {
          this.log("warn", "방이 없어짐 — 방장이 게임을 끝냄");
          return s.close(HOST_LEFT);
        }
        if (got.no) {
          refused = true;
          break;
        }
        if (got.a) {
          try {
            await s.rejoinAnswer(got.a);
            answered = true;
          } catch {}
          break;
        }
      }
      if (s.closed || !s.rejoining) return;
      if (answered) {
        const end = this.now() + WELCOME_WAIT_MS;
        while (!s.closed && s.rejoining && this.now() < end) await this.nap(300);
        if (!s.rejoining) return;
        tries++;
        continue;
      }
      if (lostServer) continue;
      if (refused) {
        tries++;
        await this.nap(Math.min(10000, 1000 * tries));
        continue;
      }
      this.log("warn", `방장이 ${ANSWER_WAIT_MS / 1000}초 동안 답하지 않음 — 방장이 나간 것으로 처리`);
      return s.close(HOST_LEFT);
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    globalThis.removeEventListener?.("online", this.onOnline);
    this.wake();
    if (this.session.helper === this) this.session.helper = null;
    if (this.rejoin && this.session.why === SOLO) this.signal.rejoinPost({ ...this.auth, u: nonce(), k: "b", key: this.session.rejoinKey }).catch(() => {});
  }
}
