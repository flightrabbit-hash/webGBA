import { CodeError, cleanCode } from "../core/net/lan.js";
import { SessionError } from "../core/net/session.js";
import { CONNECTED_CLOSE_MS, WHY } from "../core/net/net-host.js";
import { drawQr } from "../core/net/qr.js";
import { JOIN_WAIT_MS, NEAR_MS, NEAR_RETRY_MS, POLL_MS, RoomHost, SignalError, serverDown, signalCompat, signalPurpose } from "../core/net/signal.js";
import { pickText } from "../core/wgba-read.js";
import { lang, t } from "../shell/i18n.js";

const SCAN_MS = 200;
const PASTE_WAIT_MS = 1500;
const NICK_MAX = 12;

export const canScan = () => typeof globalThis.BarcodeDetector === "function" && Boolean(globalThis.navigator?.mediaDevices?.getUserMedia);

export function purposeName(purpose) {
  return (purpose?.name && pickText(purpose.name, lang())) || t("net.purposeDefault");
}

export function whyText(why) {
  switch (why) {
    case WHY.CANCEL:
      return t("net.why.cancel");
    case WHY.TIMEOUT:
      return t("net.why.timeout");
    case WHY.INCOMPATIBLE:
      return t("net.why.incompatible");
    case WHY.LOST:
      return t("net.why.lost");
    case WHY.FULL:
      return t("net.why.full");
    case WHY.LEFT:
      return t("net.why.left");
    case WHY.HOST_LEFT:
      return t("net.why.hostLeft");
    case WHY.NO_NETWORK:
      return t("net.why.noNetwork");
    default:
      return t("net.why.unknown");
  }
}

export function noticeText(info) {
  if (info.kind === "join") return t("net.notice.join", { nick: info.nick, n: info.count });
  if (info.kind === "leave") return t("net.notice.leave", { nick: info.nick, why: whyText(info.why) });
  if (info.kind === "open") return t("net.notice.open", { slot: info.slot + 1 });
  if (info.kind === "closed") return info.why === WHY.LEFT ? t("net.notice.ended") : t("net.notice.closed", { why: whyText(info.why) });
  return "";
}

export const noticeLevel = (info) => (info.kind === "closed" && info.why !== WHY.LEFT) || (info.kind === "leave" && info.why !== WHY.LEFT) ? "warn" : "info";

export function errorText(error, field) {
  if (error instanceof CodeError) {
    if (error.code === "empty") return t("net.err.empty");
    if (error.code === "kind") return field === "answer" ? t("net.err.notAnswer") : t("net.err.notOffer");
    if (error.code === "version") return t("net.err.version");
    return t("net.err.bad");
  }
  if (error instanceof SessionError) {
    if (error.code === "used") return t("net.err.used");
    if (error.code === "mismatch") return t("net.err.mismatch");
    if (error.code === "noLan" || error.code === "rtc" || error.code === "notLan") return t("net.err.noLan");
    if (error.code === "incompatible") return t("net.why.incompatible");
    if (error.code === "full") return t("net.why.full");
    if (error.code === "timeout" || error.code === "failed") return t("net.err.failed");
    if (error.code === "closed") return t("net.err.closed");
  }
  if (error instanceof SignalError) {
    if (error.code === "none") return t("net.err.noRoom");
    if (error.code === "full") return t("net.why.full");
    if (error.code === "version" || error.code === "purpose") return t("net.why.incompatible");
    if (error.code === "limit") return t("net.err.limit");
    return t("net.err.server");
  }
  return t("net.err.failed");
}

const HELP_KEYS = ["net.help.wifi", "net.help.guest", "net.help.vpn", "net.help.mesh", "net.help.firewall"];

export function defaultNick(no) {
  return t("net.nickDefault", { n: String(no).padStart(4, "0") });
}

export class NetWindow {
  constructor({ net, kit, onClosed = () => {} }) {
    this.net = net;
    this.kit = kit;
    this.signal = kit.signal ?? null;
    this.onClosed = onClosed;
    this.open = false;
    this.screen = "";
    this.request = null;
    this.refs = {};
    this.invite = null;
    this.answerText = "";
    this.offerText = "";
    this.guestCode = "";
    this.roomText = "";
    this.error = "";
    this.errorHelp = false;
    this.busy = false;
    this.qrOn = false;
    this.scanner = null;
    this.closeTimer = 0;
    this.endedWhy = 0;
    this.roomHost = null;
    this.fallback = false;
    this.offerLan = false;
    this.near = { state: "idle", rooms: [] };
    this.nearTimer = 0;
    this.nearSeq = 0;
    this.joinInfo = null;
    this.joinTimer = 0;
    this.joinSeq = 0;
  }

  show(request) {
    this.request = request ?? this.net.request;
    if (!this.request) return;
    const snap = this.net.snapshot();
    this.open = true;
    this.error = "";
    this.errorHelp = false;
    this.offerLan = false;
    if (snap.active) {
      if (snap.role === "make") {
        this.roomHost?.setActive(true);
        this.go(this.roomHost ? "room" : "host");
      } else this.go(snap.connected ? "joined" : this.joinInfo ? "wait" : "join2");
    } else if (this.request.role === "make") this.startRoom();
    else this.go("choose");
  }

  title() {
    const r = this.request;
    if (!r) return t("net.titlePlain");
    const range = r.min === r.max ? t("net.players", { n: r.max }) : t("net.playersRange", { min: r.min, max: r.max });
    return t("net.title", { purpose: purposeName(r.purpose), players: range });
  }

  go(screen) {
    this.stopScan();
    clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    if (screen !== "choose") this.stopNear();
    this.screen = screen;
    this.qrOn = screen === "join2" && this.kit.touch;
    this.render();
    if (screen === "choose") this.startNear();
  }

  close({ cancel = false } = {}) {
    if (!this.open) return;
    this.stopScan();
    this.stopNear();
    clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    this.open = false;
    this.screen = "";
    this.refs = {};
    const snap = this.net.snapshot();
    if (cancel) {
      if (!snap.reached || snap.role !== "make") {
        this.dropRoom();
        this.joinSeq++;
        this.net.cancel();
      }
    } else if (this.roomHost && snap.reached) this.roomHost.setActive(false);
    if (this.invite && !this.net.active) this.invite = null;
    this.net.windowClosed();
    this.kit.done();
    this.onClosed();
  }

  requestClose() {
    const snap = this.net.snapshot();
    const keep = snap.active && (snap.reached || snap.role === "join");
    if (this.screen === "ended" || keep) this.close();
    else this.close({ cancel: true });
  }

  dropRoom() {
    if (!this.roomHost) return;
    this.roomHost.close();
    this.roomHost = null;
  }

  update(snap = this.net.snapshot()) {
    if (this.roomHost && (!snap.active || snap.role !== "make")) {
      this.roomHost.stop();
      this.roomHost = null;
    } else if (this.roomHost && snap.count < snap.max) this.roomHost.resume();
    if (!snap.active && this.joinInfo && !this.busy) this.clearJoin();
    if (!this.open) return;
    if (!snap.request && !snap.active) {
      this.close();
      return;
    }
    if (snap.ended && !["ended", "choose", "lan", "code"].includes(this.screen)) {
      this.endedWhy = snap.ended.why;
      this.go("ended");
      return;
    }
    if ((this.screen === "join2" || this.screen === "wait") && snap.connected) {
      this.clearJoin();
      this.go("joined");
      return;
    }
    if ((this.screen === "join2" || this.screen === "wait") && !snap.active && snap.failed) {
      this.error = whyText(snap.failed.why);
      this.errorHelp = true;
      this.offerText = "";
      const back = this.screen === "wait" ? "choose" : "join1";
      this.clearJoin();
      this.go(back);
      return;
    }
    if (this.screen === "joined" && snap.connected && !this.closeTimer) this.closeTimer = setTimeout(() => this.close(), CONNECTED_CLOSE_MS);
    if ((this.screen === "host" || this.screen === "room") && snap.active) {
      const canInvite = snap.count < snap.max;
      const shownInvite = this.screen === "host" ? Boolean(this.refs.inviteBox) : Boolean(this.refs.roomBox);
      if (snap.reached !== Boolean(this.reachedShown) || canInvite !== shownInvite) {
        this.reachedShown = snap.reached;
        this.render();
        return;
      }
    }
    this.refreshDynamic(snap);
  }

  refreshDynamic(snap = this.net.snapshot()) {
    const r = this.refs;
    if (r.members) r.members.replaceChildren(...this.memberRows(snap));
    if (r.count) r.count.textContent = t("net.count", { n: snap.count, max: snap.max, min: this.request?.min ?? 2 });
    if (r.error) {
      r.error.textContent = this.error;
      r.error.hidden = !this.error;
    }
    if (r.help) r.help.hidden = !this.errorHelp;
    if (r.offline) r.offline.hidden = !this.offerLan;
  }

  memberRows(snap) {
    return snap.members.map((m) => {
      const tags = [];
      if (m.me) tags.push(t("net.me"));
      if (m.host) tags.push(t("net.hostTag"));
      tags.push(m.stalled ? t("net.state.stall") : t("net.state.ok"));
      if (!m.host && Number.isFinite(m.rtt)) tags.push(t("net.rtt", { ms: Math.round(m.rtt) }));
      return this.kit.row({ tag: `${m.slot + 1}P`, name: m.nick, meta: tags.join(" · "), current: m.me });
    });
  }

  setError(text, help = false) {
    this.error = text;
    this.errorHelp = help;
    this.refreshDynamic();
  }

  nickField() {
    const k = this.kit;
    return k.field({
      label: t("net.nick"),
      control: k.textInput({ value: [...k.nick()].slice(0, NICK_MAX).join(""), maxLength: NICK_MAX, label: t("net.nick"), action: "net-nick", onInput: (value) => k.setNick(value) }),
    });
  }

  codeBox(code, { action }) {
    const k = this.kit;
    const area = k.textArea({ value: code, readOnly: true, rows: 4, label: t("net.codeLabel"), action });
    const copy = k.button({ label: k.label("copy"), action: `${action}-copy`, onClick: () => this.copy(code) });
    const qrBtn = k.button({ label: k.label("qr"), action: `${action}-qr`, onClick: () => this.toggleQr() });
    const qr = k.make("div", "net-qr");
    qr.hidden = !this.qrOn;
    if (this.qrOn) qr.append(this.qrCanvas(code));
    this.refs.qr = qr;
    this.refs.qrCode = code;
    return [area, k.line(copy, qrBtn), qr];
  }

  qrCanvas(code) {
    const canvas = document.createElement("canvas");
    canvas.className = "net-qr__img";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", t("net.qrAlt"));
    const m = drawQr(canvas, code, { module: 1, quiet: 4 });
    const px = Math.max(3, Math.floor((this.kit.qrSize ?? 220) / (m.size + 8)));
    canvas.style.width = `${(m.size + 8) * px}px`;
    canvas.style.height = `${(m.size + 8) * px}px`;
    return canvas;
  }

  toggleQr() {
    this.qrOn = !this.qrOn;
    const qr = this.refs.qr;
    if (!qr) return;
    qr.hidden = !this.qrOn;
    if (this.qrOn && !qr.firstChild && this.refs.qrCode) qr.append(this.qrCanvas(this.refs.qrCode));
  }

  async copy(code) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(code);
      ok = true;
    } catch {}
    this.kit.notice(t(ok ? "net.copied" : "net.copyFailed"), ok ? "info" : "warn");
  }

  pasteField({ field, action, value, onInput, onGo }) {
    const k = this.kit;
    const area = k.textArea({ value, rows: 4, label: field === "answer" ? t("net.answerLabel") : t("net.offerLabel"), placeholder: t("net.pastePlaceholder"), action, onInput });
    const hint = k.note("");
    hint.classList.add("net-paste-hint");
    hint.hidden = true;
    const buttons = [];
    if (canScan()) buttons.push(k.button({ label: k.label("scan"), action: `${action}-scan`, onClick: () => this.scan(area, onInput) }));
    buttons.push(k.button({ label: k.label("paste"), action: `${action}-paste`, onClick: () => this.paste(area, hint, onInput) }));
    buttons.push(k.button({ label: k.label(field === "answer" ? "connect" : "next"), kind: "primary", action: `${action}-go`, onClick: onGo, disabled: this.busy }));
    const scanBox = k.make("div", "net-scan");
    scanBox.hidden = true;
    this.refs.scanBox = scanBox;
    return [area, scanBox, k.line(...buttons), hint];
  }

  paste(area, hint, onInput) {
    hint.hidden = true;
    const tell = (key) => {
      hint.textContent = t(key);
      hint.hidden = false;
      area.focus({ preventScroll: true });
    };
    const fallback = () => tell(this.kit.touch ? "net.pasteHintTouch" : "net.pasteHintKey");
    const clip = globalThis.navigator?.clipboard;
    if (typeof clip?.readText !== "function") return fallback();
    let reading;
    try {
      reading = clip.readText();
    } catch {
      return fallback();
    }
    const slow = setTimeout(fallback, PASTE_WAIT_MS);
    Promise.resolve(reading).then(
      (text) => {
        clearTimeout(slow);
        hint.hidden = true;
        const code = cleanCode(text);
        if (!code) return tell("net.pasteEmpty");
        area.value = code;
        onInput(code);
      },
      () => {
        clearTimeout(slow);
        fallback();
      },
    );
  }

  async scan(area, onInput) {
    if (this.scanner) return this.stopScan();
    const box = this.refs.scanBox;
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch {
      this.setError(t("net.scanFailed"));
      return;
    }
    const video = document.createElement("video");
    video.className = "net-scan__video";
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    box.replaceChildren(video);
    box.hidden = false;
    const detector = new globalThis.BarcodeDetector({ formats: ["qr_code"] });
    const scanner = { stream, timer: 0 };
    this.scanner = scanner;
    await video.play().catch(() => {});
    const tick = async () => {
      if (this.scanner !== scanner) return;
      try {
        const found = await detector.detect(video);
        const text = found.map((f) => cleanCode(f.rawValue)).find(Boolean);
        if (text) {
          area.value = text;
          onInput(text);
          this.stopScan();
          return;
        }
      } catch {}
      scanner.timer = setTimeout(tick, SCAN_MS);
    };
    tick();
  }

  stopScan() {
    const s = this.scanner;
    this.scanner = null;
    if (!s) return;
    clearTimeout(s.timer);
    for (const track of s.stream.getTracks()) track.stop();
    if (this.refs.scanBox) {
      this.refs.scanBox.replaceChildren();
      this.refs.scanBox.hidden = true;
    }
  }

  errorNodes() {
    const k = this.kit;
    const error = k.make("p", "net-error", this.error);
    error.hidden = !this.error;
    error.setAttribute("role", "alert");
    this.refs.error = error;
    const help = k.list(HELP_KEYS.map((key) => t(key)), "net-help");
    help.hidden = !this.errorHelp;
    this.refs.help = help;
    return [error, help];
  }

  offlineLine() {
    const k = this.kit;
    const label = k.make("span", "net-offline__label", t("net.offline"));
    const line = k.line(label, k.button({ label: k.label("offline"), action: "net-offline", onClick: () => this.toLan() }));
    line.classList.add("net-offline");
    return line;
  }

  toLan() {
    this.joinSeq++;
    this.error = "";
    this.errorHelp = false;
    this.go("lan");
  }

  nearNodes() {
    const k = this.kit;
    const n = this.near;
    if (n.state === "loading" || n.state === "idle") return [k.note(t("net.nearLoading"))];
    if (n.state === "offline") return [k.note(t("net.nearOffline"))];
    if (n.state === "fail") return [k.note(t("net.nearFail"))];
    const purpose = signalPurpose(this.request?.purpose?.id);
    const rows = [];
    for (const room of n.rooms) {
      const same = room.c === n.compat;
      if (same && room.p !== purpose) continue;
      if (!same) {
        rows.push(k.nearRow({ name: room.nick, meta: t("net.nearOther"), dim: true }));
        continue;
      }
      const button = k.button({ label: k.label("enter"), action: "net-near-join", onClick: () => this.joinRoom(room.room) });
      button.dataset.room = room.room;
      button.disabled = this.busy;
      rows.push(k.nearRow({ name: room.nick, meta: t("net.nearMeta", { purpose: purposeName(this.request?.purpose), n: room.k, max: room.m }), button }));
    }
    if (!rows.length) return [k.note(t("net.nearEmpty"))];
    const list = k.make("ul", "net-near");
    list.append(...rows);
    return [list];
  }

  paintNear() {
    if (this.refs.near) this.refs.near.replaceChildren(...this.nearNodes());
  }

  startNear() {
    this.stopNear();
    if (!this.signal) {
      this.near = { state: "fail", rooms: [] };
      this.paintNear();
      return;
    }
    const seq = ++this.nearSeq;
    const run = async () => {
      if (seq !== this.nearSeq || !this.open || this.screen !== "choose") return;
      let wait = NEAR_MS;
      try {
        const compat = await signalCompat(this.net.compat);
        const got = await this.signal.near();
        if (seq !== this.nearSeq) return;
        this.near = { state: "ok", rooms: Array.isArray(got.rooms) ? got.rooms : [], compat };
      } catch (error) {
        if (seq !== this.nearSeq) return;
        this.near = { state: error instanceof SignalError && error.code === "offline" ? "offline" : "fail", rooms: [] };
        wait = NEAR_RETRY_MS;
      }
      this.paintNear();
      this.nearTimer = setTimeout(run, wait);
    };
    if (this.near.state !== "ok") this.near = { state: globalThis.navigator?.onLine === false ? "offline" : "loading", rooms: [] };
    run();
  }

  stopNear() {
    this.nearSeq++;
    clearTimeout(this.nearTimer);
    this.nearTimer = 0;
  }

  roomCodeNode(code) {
    const k = this.kit;
    const node = k.make("p", "net-room-code", code || "------");
    node.dataset.action = "net-room-code";
    node.setAttribute("aria-label", code ? t("net.roomCodeAria", { code: code.split("").join(" ") }) : t("net.roomMaking"));
    return node;
  }

  render() {
    const k = this.kit;
    this.refs = {};
    const snap = this.net.snapshot();
    k.title(this.title());
    let body = [];
    let actions = [];
    const cancel = k.action({ id: "cancel", onClick: () => this.close({ cancel: true }) });
    if (this.screen === "choose") {
      const near = k.make("div", "net-near-box");
      this.refs.near = near;
      near.append(...this.nearNodes());
      const buttons = [];
      if (this.request?.role !== "join") buttons.push(k.button({ label: k.label("make"), kind: "primary", action: "net-room-make", onClick: () => this.startRoom(), disabled: this.busy }));
      buttons.push(k.button({ label: k.label("codeJoin"), action: "net-room-join", onClick: () => this.toCode(), disabled: this.busy }));
      body = [k.note(t("net.lead")), this.nickField(), k.line(...buttons), k.group(t("net.near"), near), this.offlineLine(), ...this.errorNodes()];
      actions = [cancel];
    } else if (this.screen === "lan") {
      body = [];
      if (this.fallback) body.push(k.note(t("net.fallback")));
      body.push(
        k.note(t("net.lead")),
        this.nickField(),
        k.line(k.button({ label: k.label("makeCode"), kind: "primary", action: "net-make", onClick: () => this.startHost() }), k.button({ label: k.label("join"), action: "net-join", onClick: () => this.go("join1") })),
        k.note(t("net.codeNote")),
      );
      actions = [k.action({ id: "back", onClick: () => this.go("choose") }), cancel];
    } else if (this.screen === "code") {
      const input = k.textInput({ value: this.roomText, maxLength: 6, numeric: true, label: t("net.roomCode"), action: "net-code-in", onInput: (v) => (this.roomText = v), onEnter: () => this.joinRoom(this.roomText) });
      const go = k.button({ label: k.label("enter"), kind: "primary", action: "net-code-go", onClick: () => this.joinRoom(this.roomText), disabled: this.busy });
      const off = this.offlineLine();
      off.hidden = !this.offerLan;
      this.refs.offline = off;
      body = [this.nickField(), k.step(t("net.code.step")), k.line(input, go), ...this.errorNodes(), off];
      actions = [k.action({ id: "back", onClick: () => this.go("choose") }), cancel];
    } else if (this.screen === "room") {
      this.reachedShown = snap.reached;
      const count = k.make("p", "net-count", t("net.count", { n: snap.count, max: snap.max, min: this.request?.min ?? 2 }));
      this.refs.count = count;
      const members = k.make("ul", "net-members");
      members.append(...this.memberRows(snap));
      this.refs.members = members;
      body = [];
      if (snap.count < snap.max) {
        const box = k.make("div", "net-room");
        this.refs.roomBox = box;
        box.append(this.roomCodeNode(this.roomHost?.room ?? ""), k.note(this.roomHost?.room ? t("net.roomHint") : t("net.roomMaking")));
        body.push(k.group(t("net.roomCode"), box));
      }
      body.push(k.group(t("net.room"), count, members), ...this.errorNodes());
      if (snap.reached) actions = [k.action({ id: "leave", onClick: () => (this.net.leave(), this.close()) }), k.action({ id: "done", primary: true, onClick: () => this.close() })];
      else actions = [cancel];
    } else if (this.screen === "wait") {
      body = [k.note(t("net.joinWait", { nick: this.joinInfo?.hn ?? "" })), ...this.errorNodes()];
      actions = [cancel];
    } else if (this.screen === "host") {
      this.reachedShown = snap.reached;
      const count = k.make("p", "net-count", t("net.count", { n: snap.count, max: snap.max, min: this.request?.min ?? 2 }));
      this.refs.count = count;
      const members = k.make("ul", "net-members");
      members.append(...this.memberRows(snap));
      this.refs.members = members;
      body = this.fallback ? [k.note(t("net.fallback"))] : [];
      body.push(k.group(t("net.room"), count, members));
      if (snap.count < snap.max) {
        const box = k.make("div", "net-invite");
        this.refs.inviteBox = box;
        if (this.invite?.code) {
          box.append(
            k.step(t("net.host.step1")),
            ...this.codeBox(this.invite.code, { action: "net-offer" }),
            k.step(t("net.host.step2")),
            ...this.pasteField({ field: "answer", action: "net-answer", value: this.answerText, onInput: (v) => (this.answerText = v), onGo: () => this.acceptAnswer() }),
          );
        } else box.append(k.note(t("net.making")));
        body.push(k.group(t(snap.count > 1 ? "net.inviteMore" : "net.invite"), box));
      }
      body.push(...this.errorNodes());
      if (snap.reached) {
        actions = [k.action({ id: "leave", onClick: () => (this.net.leave(), this.close()) }), k.action({ id: "done", primary: true, onClick: () => this.close() })];
      } else actions = [cancel];
      if (!this.invite && snap.count < snap.max) this.makeInvite();
    } else if (this.screen === "join1") {
      body = [this.nickField(), k.step(t("net.join.step1")), ...this.pasteField({ field: "offer", action: "net-offer-in", value: this.offerText, onInput: (v) => (this.offerText = v), onGo: () => this.joinWithOffer() }), ...this.errorNodes()];
      actions = [k.action({ id: "back", onClick: () => this.go("lan") }), cancel];
    } else if (this.screen === "join2") {
      const wait = k.note(t("net.join.waiting"));
      body = [k.step(t("net.join.step2")), ...this.codeBox(this.guestCode, { action: "net-answer-out" }), wait, ...this.errorNodes()];
      actions = [cancel];
    } else if (this.screen === "joined") {
      const members = k.make("ul", "net-members");
      members.append(...this.memberRows(snap));
      this.refs.members = members;
      body = [k.note(t("net.joined", { slot: snap.slot + 1 })), members];
      actions = [k.action({ id: "done", primary: true, onClick: () => this.close() })];
      this.closeTimer = setTimeout(() => this.close(), CONNECTED_CLOSE_MS);
    } else if (this.screen === "ended") {
      const why = this.endedWhy;
      this.error = whyText(why);
      this.errorHelp = [WHY.NO_NETWORK, WHY.TIMEOUT, WHY.LOST].includes(why);
      body = [...this.errorNodes()];
      actions = [k.action({ id: "close", primary: true, onClick: () => this.close() })];
    }
    k.mount(body, actions);
  }

  toCode() {
    this.error = "";
    this.errorHelp = false;
    this.offerLan = false;
    this.go("code");
  }

  serverFailed(error) {
    this.offerLan = serverDown(error);
    this.setError(errorText(error), false);
  }

  async startRoom() {
    if (this.busy) return;
    this.dropRoom();
    this.invite = null;
    this.answerText = "";
    this.reachedShown = false;
    this.error = "";
    this.errorHelp = false;
    this.fallback = false;
    let session;
    try {
      session = await this.net.open("make");
    } catch {
      this.setError(t("net.err.failed"));
      return;
    }
    if (!this.signal) return this.fallToCodes(null);
    const r = this.request;
    const info = { c: await signalCompat(this.net.compat), p: signalPurpose(r?.purpose?.id), m: session.max, n: [...this.kit.nick()].slice(0, NICK_MAX).join("") };
    const host = new RoomHost({
      signal: this.signal,
      session,
      info,
      log: this.net.log ?? (() => {}),
      onChange: () => this.update(),
      onError: () => this.open && this.screen === "room" && this.setError(t("net.err.serverLost")),
    });
    this.roomHost = host;
    this.go("room");
    try {
      await host.open();
      if (this.roomHost !== host) return host.close();
      if (this.open && this.screen === "room") this.render();
    } catch (error) {
      if (this.roomHost !== host) return;
      this.roomHost = null;
      host.stop();
      if (error instanceof SignalError) return this.fallToCodes(host.invite);
      if (host.invite) session.cancelInvite(host.invite.id);
      if (this.open && this.screen === "room") this.setError(errorText(error), true);
    }
  }

  fallToCodes(invite) {
    this.fallback = true;
    this.invite = invite ? { ...invite, busy: false } : null;
    this.answerText = "";
    if (this.open) this.go("host");
  }

  clearJoin() {
    clearTimeout(this.joinTimer);
    this.joinTimer = 0;
    this.joinInfo = null;
  }

  async joinRoom(text) {
    if (this.busy) return;
    const room = String(text ?? "").replace(/\D/g, "");
    if (room.length !== 6) {
      if (this.screen !== "code") this.go("code");
      this.setError(t("net.err.roomCode"));
      return;
    }
    if (!this.signal) return this.serverFailed(new SignalError("offline"));
    const seq = ++this.joinSeq;
    this.busy = true;
    this.offerLan = false;
    this.setError(t("net.joiningRoom"));
    this.paintNear();
    let session = null;
    try {
      const info = { room, c: await signalCompat(this.net.compat), p: signalPurpose(this.request?.purpose?.id), n: [...this.kit.nick()].slice(0, NICK_MAX).join("") };
      let got = await this.signal.join(info);
      const until = Date.now() + JOIN_WAIT_MS;
      while (got.wait) {
        if (seq !== this.joinSeq) return;
        this.setError(t("net.roomBusy"));
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (seq !== this.joinSeq) return;
        if (Date.now() > until) throw new SessionError("timeout");
        const st = await this.signal.status(room);
        if (st.q > got.q) got = await this.signal.join(info);
      }
      if (seq !== this.joinSeq) return;
      session = await this.net.open("join");
      const { code } = await session.answer(got.o);
      if (seq !== this.joinSeq) throw new SessionError("closed");
      await this.signal.answer({ x: got.x, q: got.q, t: got.t, d: code });
      this.joinInfo = got;
      this.busy = false;
      this.error = "";
      this.errorHelp = false;
      this.joinTimer = setTimeout(() => {
        if (this.joinInfo !== got || this.net.connected) return;
        this.clearJoin();
        this.net.discard();
        if (this.open && this.screen === "wait") {
          this.error = t("net.err.failed");
          this.errorHelp = true;
          this.go("choose");
        }
      }, JOIN_WAIT_MS);
      if (this.open) this.go("wait");
    } catch (error) {
      this.busy = false;
      if (session) this.net.discard();
      if (seq !== this.joinSeq) return;
      if (this.screen === "choose" && error instanceof SignalError && ["none", "full", "version", "purpose"].includes(error.code)) this.startNear();
      if (this.open && this.screen !== "choose" && this.screen !== "code") this.go("code");
      this.offerLan = serverDown(error);
      this.setError(errorText(error), error instanceof SessionError && ["noLan", "rtc", "timeout", "failed"].includes(error.code));
      this.paintNear();
    }
  }

  async startHost() {
    this.invite = null;
    this.answerText = "";
    this.reachedShown = false;
    this.error = "";
    this.errorHelp = false;
    try {
      await this.net.open("make");
    } catch {
      this.setError(t("net.err.failed"));
      return;
    }
    this.go("host");
  }

  async makeInvite() {
    const session = this.net.session;
    if (!session || session.closed || this.invite) return;
    const invite = { busy: true, code: "", id: 0 };
    this.invite = invite;
    try {
      const made = await session.invite();
      if (this.invite !== invite) return session.cancelInvite(made.id);
      Object.assign(invite, made, { busy: false });
      this.answerText = "";
      if (this.screen === "host") this.render();
    } catch (error) {
      if (this.invite === invite) this.invite = null;
      if (error instanceof SessionError && error.code === "full") return;
      this.setError(errorText(error), true);
    }
  }

  async acceptAnswer() {
    const session = this.net.session;
    const invite = this.invite;
    if (!session || !invite?.id || this.busy) return;
    this.busy = true;
    this.setError(t("net.connecting"));
    try {
      await session.accept(invite.id, this.answerText);
      this.busy = false;
      this.error = "";
      this.invite = null;
      this.answerText = "";
      if (this.screen === "host") this.render();
    } catch (error) {
      this.busy = false;
      const field = error instanceof CodeError || (error instanceof SessionError && ["used", "mismatch", "noLan"].includes(error.code));
      if (!field && this.invite === invite) this.invite = null;
      this.error = errorText(error, "answer");
      this.errorHelp = error instanceof SessionError && ["timeout", "failed", "noLan", "notLan"].includes(error.code);
      if (this.screen === "host") {
        if (field) this.refreshDynamic();
        else this.render();
      }
    }
  }

  async joinWithOffer() {
    if (this.busy) return;
    this.busy = true;
    this.setError(t("net.makingAnswer"));
    try {
      const session = await this.net.open("join");
      const { code } = await session.answer(this.offerText);
      this.guestCode = code;
      this.busy = false;
      this.error = "";
      this.go("join2");
    } catch (error) {
      this.busy = false;
      this.net.discard();
      this.setError(errorText(error, "offer"), error instanceof SessionError);
    }
  }
}
