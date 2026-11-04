import { CodeError, cleanCode } from "../core/net/lan.js";
import { SessionError } from "../core/net/session.js";
import { CONNECTED_CLOSE_MS, WHY } from "../core/net/net-host.js";
import { drawQr } from "../core/net/qr.js";
import { ACCEPT_MS, JOIN_WAIT_MS, NEAR_MS, NEAR_RETRY_MS, POLL_MS, RoomGuest, RoomHost, SignalError, signalCompat, signalPurpose } from "../core/net/signal.js";
import { pickText } from "../core/wgba-read.js";
import { lang, t } from "../shell/i18n.js";
import { seatRows } from "./board-panel.js";

let textKey = (key) => key;
const tb = (key, vars) => t(textKey(key), vars);

const SCAN_MS = 200;
const PASTE_WAIT_MS = 1500;
const NICK_MAX = 12;
const CODE_LEN = 6;
const PIPS_MAX = 8;

const SCAN_EDGE = 640;

export const canScan = (touch = false) => Boolean(globalThis.navigator?.mediaDevices?.getUserMedia) && (typeof globalThis.BarcodeDetector === "function" || touch);

export async function frameReader() {
  if (typeof globalThis.BarcodeDetector === "function") {
    const detector = new globalThis.BarcodeDetector({ formats: ["qr_code"] });
    return async (video) => (await detector.detect(video)).map((f) => f.rawValue);
  }
  if (typeof globalThis.jsQR !== "function") await import("../vendor/jsqr.js");
  const decode = globalThis.jsQR;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h || typeof decode !== "function") return [];
    const scale = Math.min(1, SCAN_EDGE / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const found = decode(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
    return found ? [found.data] : [];
  };
}

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
    case WHY.SOLO:
      return t("net.why.solo");
    default:
      return t("net.why.unknown");
  }
}

export function noticeText(info) {
  if (info.kind === "join") return t("net.notice.join", { nick: info.nick, n: info.count });
  if (info.kind === "leave") return t("net.notice.leave", { nick: info.nick, why: whyText(info.why) });
  if (info.kind === "open") return t("net.notice.open", { slot: info.slot + 1 });
  if (info.kind === "closed") return info.why === WHY.LEFT ? t("net.notice.ended") : t("net.notice.closed", { why: whyText(info.why) });
  if (info.kind === "hold") return t("net.notice.hold", { nick: info.nick });
  if (info.kind === "back") return t("net.notice.back", { nick: info.nick });
  if (info.kind === "rejoining") return t("net.notice.rejoining");
  if (info.kind === "rejoined") return t("net.notice.rejoined", { slot: info.slot + 1 });
  return "";
}

export const noticeLevel = (info) => (info.kind === "closed" && ![WHY.LEFT, WHY.SOLO].includes(info.why)) || (info.kind === "leave" && info.why !== WHY.LEFT) || info.kind === "hold" || info.kind === "rejoining" ? "warn" : "info";

const HINTS = { linkFailed: "net.err.linkFailed", wanSym: "net.err.wanSym", peerSym: "net.err.peerSym" };
const HELP_HINTS = ["linkFailed"];
const HELP_CODES = ["timeout", "failed", "noLan", "rtc", ...HELP_HINTS];

export function hintText(code) {
  return HINTS[code] ? t(HINTS[code]) : "";
}

const helpFor = (hint) => !HINTS[hint] || HELP_HINTS.includes(hint);

export function hintOf(sym = false, peerSym = false) {
  if (sym) return "wanSym";
  if (peerSym) return "peerSym";
  return "linkFailed";
}

export function errorText(error, field) {
  if (error instanceof CodeError) {
    if (error.code === "empty") return t("net.err.empty");
    if (error.code === "kind") return field === "answer" ? t("net.err.notAnswer") : t("net.err.notOffer");
    if (error.code === "version") return t("net.err.version");
    return t("net.err.bad");
  }
  if (error instanceof SessionError) {
    if (HINTS[error.code]) return hintText(error.code);
    if (error.code === "used") return t("net.err.used");
    if (error.code === "mismatch") return t("net.err.mismatch");
    if (error.code === "noLan" || error.code === "rtc") return t("net.err.noLan");
    if (error.code === "incompatible") return t("net.why.incompatible");
    if (error.code === "full") return t("net.why.full");
    if (error.code === "timeout" || error.code === "failed") return t("net.err.failed");
    if (error.code === "closed") return t("net.err.closed");
  }
  if (error instanceof SignalError) {
    if (error.code === "none") return t("net.err.noRoom");
    if (error.code === "paused") return tb("net.err.paused");
    if (error.code === "full") return t("net.why.full");
    if (error.code === "version" || error.code === "purpose") return t("net.why.incompatible");
    if (error.code === "limit") return tb("net.err.limit");
    return tb("net.err.server");
  }
  return t("net.err.failed");
}

const HELP_KEYS = ["net.help.wifi", "net.help.guest", "net.help.vpn", "net.help.mesh", "net.help.firewall"];

export function defaultNick(no) {
  return t("net.nickDefault", { n: String(no).padStart(4, "0") });
}

export class NetWindow {
  constructor({ net, kit, onClosed = () => {}, onState = () => {} }) {
    this.net = net;
    this.kit = kit;
    if (kit.textKey) textKey = kit.textKey;
    this.signal = kit.signal ?? null;
    this.onClosed = onClosed;
    this.onState = onState;
    this.clock = 0;
    this.open = false;
    this.screen = "";
    this.tab = "join";
    this.request = null;
    this.refs = {};
    this.invite = null;
    this.answerText = "";
    this.offerText = "";
    this.guestCode = "";
    this.roomText = "";
    this.lastRoom = "";
    this.error = "";
    this.errorTitle = "";
    this.errorHelp = false;
    this.codeBad = false;
    this.progress = "";
    this.nickEdit = false;
    this.busy = false;
    this.qrOn = false;
    this.scanner = null;
    this.closeTimer = 0;
    this.endedWhy = 0;
    this.roomHost = null;
    this.fallback = false;
    this.near = { state: "idle", rooms: [] };
    this.nearTimer = 0;
    this.nearSeq = 0;
    this.joinInfo = null;
    this.joinTimer = 0;
    this.joinSeq = 0;
    this.joinedRoom = "";
    this.roomGuest = null;
    this.joinHint = "";
  }

  show(request) {
    this.request = request ?? this.net.request;
    if (!this.request) return;
    const snap = this.net.snapshot();
    this.open = true;
    this.stay = Boolean(snap.active && snap.reached);
    this.clearError();
    this.nickEdit = false;
    this.tab = this.canMake() && this.kit.tab?.() === "make" ? "make" : "join";
    if (snap.active) {
      if (snap.rejoining) this.go("rejoin");
      else if (snap.role === "make") {
        this.roomHost?.setActive(true);
        this.go(this.roomHost ? "room" : "host");
      } else this.go(snap.connected ? "joined" : this.joinInfo ? "wait" : "join2");
    } else if (this.request.role === "make") this.startRoom();
    else this.go("choose");
  }

  canMake() {
    return this.request?.role !== "join";
  }

  chipText() {
    const r = this.request;
    if (!r) return "";
    const range = r.min === r.max ? t("net.players", { n: r.max }) : t("net.playersRange", { min: r.min, max: r.max });
    return t("net.chip", { purpose: purposeName(r.purpose), players: range });
  }

  paintTitle(snap = this.net.snapshot()) {
    if (this.screen === "room" || this.screen === "host") this.kit.title(t("net.myRoom"), t("net.countChip", { n: snap.count, max: snap.max }), "ok");
    else this.kit.title(t("net.titlePlain"), this.chipText(), "");
  }

  go(screen) {
    this.stopScan();
    this.stopClock();
    clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    this.stopNear();
    this.screen = screen;
    this.qrOn = screen === "join2" && this.kit.touch;
    this.render();
    if (this.nearWanted()) this.startNear();
  }

  nearWanted() {
    return this.open && this.screen === "choose" && this.tab === "join";
  }

  pickTab(tab) {
    if (this.tab === tab || this.busy) return;
    this.tab = tab;
    this.kit.setTab?.(tab);
    this.clearError();
    this.nickEdit = false;
    this.go("choose");
  }

  close({ cancel = false } = {}) {
    if (!this.open) return;
    this.stopScan();
    this.stopNear();
    this.stopClock();
    clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    this.open = false;
    this.screen = "";
    this.refs = {};
    const snap = this.net.snapshot();
    if (cancel && snap.anytime) {
      if (!(snap.active && snap.role === "make")) {
        this.joinSeq++;
        this.net.discard();
      }
    } else if (cancel) {
      if (!snap.reached || snap.role !== "make") {
        this.dropRoom();
        this.joinSeq++;
        this.net.cancel();
      }
    } else if (this.roomHost && snap.reached && snap.count >= snap.max) this.roomHost.setActive(false);
    if (this.invite && !this.net.active) this.invite = null;
    this.net.windowClosed();
    this.kit.done();
    this.onClosed();
  }

  requestClose() {
    const snap = this.net.snapshot();
    const keep = snap.active && (snap.reached || snap.role === "join" || snap.anytime);
    if (this.screen === "ended" || keep) this.close();
    else this.close({ cancel: true });
  }

  dropRoom() {
    if (!this.roomHost) return;
    this.roomHost.close();
    this.roomHost = null;
  }

  get roomCode() {
    return this.roomHost?.room || (this.net.active ? this.joinedRoom : "");
  }

  canInvite(snap = this.net.snapshot()) {
    return snap.active && snap.role === "make" && snap.count < snap.max;
  }

  pageHide() {
    this.roomHost?.beacon();
  }

  update(snap = this.net.snapshot()) {
    try {
      this.apply(snap);
    } finally {
      this.onState();
    }
  }

  apply(snap) {
    if (this.roomHost && (!snap.active || snap.role !== "make")) {
      this.roomHost.close();
      this.roomHost = null;
    } else if (this.roomHost && snap.count < snap.max) this.roomHost.resume();
    if (!snap.active && this.joinInfo && !this.busy) this.clearJoin();
    if (!snap.active) {
      this.joinedRoom = "";
      this.roomGuest = null;
    }
    if (!this.open) return;
    if (!snap.request && !snap.active) {
      this.close();
      return;
    }
    if (snap.ended && !["ended", "choose", "lan", "fail"].includes(this.screen)) {
      this.endedWhy = snap.ended.why;
      this.go("ended");
      return;
    }
    if (snap.active && snap.rejoining && this.screen !== "rejoin") {
      this.go("rejoin");
      return;
    }
    if (this.screen === "rejoin" && snap.connected && !snap.rejoining) {
      this.go("back");
      return;
    }
    if ((this.screen === "join2" || this.screen === "wait") && snap.connected) {
      this.clearJoin();
      this.go("joined");
      return;
    }
    if ((this.screen === "join2" || this.screen === "wait") && !snap.active && snap.failed) {
      const text = hintText(snap.failed.hint) || whyText(snap.failed.why);
      const help = helpFor(snap.failed.hint);
      const wait = this.screen === "wait";
      this.offerText = "";
      this.clearJoin();
      if (wait) return this.fail(text, help);
      this.clearError();
      this.error = text;
      this.errorHelp = help;
      this.go("join1");
      return;
    }
    if (this.screen === "joined" && snap.connected && !this.closeTimer) this.closeTimer = setTimeout(() => this.close(), CONNECTED_CLOSE_MS);
    if ((this.screen === "host" || this.screen === "room") && snap.reached && !this.stay && !this.closeTimer) this.closeTimer = setTimeout(() => this.close(), CONNECTED_CLOSE_MS);
    if ((this.screen === "host" || this.screen === "room") && snap.active) {
      const canInvite = snap.count < snap.max;
      const shownInvite = this.screen === "host" ? Boolean(this.refs.inviteBox) : Boolean(this.refs.roomBox);
      if (snap.reached !== Boolean(this.reachedShown) || canInvite !== shownInvite || Boolean(snap.anytime) !== Boolean(this.anytimeShown)) {
        this.render();
        return;
      }
    }
    this.refreshDynamic(snap);
  }

  refreshDynamic(snap = this.net.snapshot()) {
    const r = this.refs;
    if (r.members) r.members.replaceChildren(...this.seatNodes(snap));
    if (r.count) r.count.textContent = t("net.count", { n: snap.count, max: snap.max, min: this.request?.min ?? 2 });
    if (this.screen === "room" || this.screen === "host") this.paintTitle(snap);
    if (r.banner) {
      r.bannerTitle.textContent = this.errorTitle;
      r.bannerTitle.hidden = !this.errorTitle;
      r.bannerText.textContent = this.error;
      r.bannerText.hidden = !this.error;
      r.banner.hidden = !this.error && !this.errorTitle;
    }
    if (r.help) r.help.hidden = !this.errorHelp;
    if (r.progress) {
      r.progress.textContent = this.progress;
      r.progress.hidden = !this.progress;
    }
    if (r.cells) r.cells.classList.toggle("is-bad", this.codeBad);
    if (r.codeGo) r.codeGo.disabled = this.busy;
    if (r.makeGo) r.makeGo.disabled = this.busy;
    if (r.rejoinState) r.rejoinState.textContent = this.rejoinText(snap);
    if (r.accept) r.accept.textContent = this.acceptText();
    if (r.renew) r.renew.disabled = Boolean(this.roomHost?.renewing);
  }

  acceptState() {
    const h = this.roomHost;
    if (!h?.limit || !h.running) return null;
    return { on: h.inviting, left: h.acceptLeft, room: h.room };
  }

  acceptText() {
    const state = this.acceptState();
    if (!state) return "";
    if (!state.on) return tb("net.accept.off");
    const s = Math.ceil(state.left / 1000);
    return t("net.accept.on", { time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` });
  }

  startClock() {
    this.stopClock();
    this.clock = setInterval(() => {
      if (!this.open || !this.refs.accept) return this.stopClock();
      this.refreshDynamic();
    }, 1000);
  }

  stopClock() {
    clearInterval(this.clock);
    this.clock = 0;
  }

  paused() {
    this.kit.notice(tb("net.notice.paused"), "info");
    if (this.open && this.screen === "room") this.render();
  }

  async renewRoom() {
    const host = this.roomHost;
    if (!host || host.renewing) return;
    this.clearError();
    this.refreshDynamic();
    try {
      await host.renew();
    } catch (error) {
      this.setError(errorText(error));
      return;
    }
    if (this.open && this.screen === "room") this.render();
  }

  rejoinText(snap) {
    return t({ offline: "net.rejoin.offline", wait: "net.rejoin.wait", server: "net.rejoin.server" }[snap.rejoinState] ?? "net.rejoin.trying");
  }

  iceNodes(snap) {
    const out = [];
    if (snap.iceHosts?.length) out.push(this.kit.note(t("net.iceHosts", { hosts: snap.iceHosts.join(", ") })));
    if (snap.iceFailed) out.push(this.kit.note(t("net.iceFailed")));
    return out;
  }

  goSolo() {
    this.net.solo();
    this.close();
  }

  seatNodes(snap) {
    return seatRows({ members: snap.members, slot: snap.slot, max: snap.max });
  }

  seatSection(snap, { count = true } = {}) {
    const k = this.kit;
    const list = k.make("ol", "mpb__rows net-seats");
    list.dataset.plain = "";
    list.append(...this.seatNodes(snap));
    this.refs.members = list;
    let sub = null;
    if (count) {
      sub = t("net.count", { n: snap.count, max: snap.max, min: this.request?.min ?? 2 });
    }
    const sec = this.section(t("net.users"), { sub, children: [list] });
    if (count) this.refs.count = sec.querySelector(".net-sech__sub");
    return sec;
  }

  section(title, { sub = null, tool = null, children = [], kind = "" } = {}) {
    const k = this.kit;
    const sec = k.make("section", `net-sec${kind ? ` net-sec--${kind}` : ""}`);
    if (title) {
      const head = k.make("div", "net-sech");
      const name = k.make("h3", "net-sech__title");
      name.append(k.make("span", "net-sech__name", title));
      if (sub !== null) name.append(k.make("span", "net-sech__sub", sub));
      head.append(name);
      if (tool) head.append(tool);
      sec.append(head);
    }
    sec.append(...children.filter(Boolean));
    return sec;
  }

  cols(a, b) {
    const k = this.kit;
    const box = k.make("div", "net-cols");
    const left = k.make("div", "net-col net-col--a");
    const right = k.make("div", "net-col net-col--b");
    left.append(...a.filter(Boolean));
    right.append(...b.filter(Boolean));
    box.append(left, right);
    return box;
  }

  clearError() {
    this.error = "";
    this.errorTitle = "";
    this.errorHelp = false;
    this.codeBad = false;
    this.progress = "";
  }

  setError(text, help = false, { title = "", code = false } = {}) {
    this.error = text;
    this.errorTitle = title;
    this.errorHelp = help;
    this.codeBad = code;
    this.progress = "";
    this.refreshDynamic();
  }

  setProgress(text) {
    this.error = "";
    this.errorTitle = "";
    this.errorHelp = false;
    this.codeBad = false;
    this.progress = text;
    this.refreshDynamic();
  }

  fail(text, help) {
    const title = t("net.err.failed");
    this.error = text === title ? "" : text;
    this.errorTitle = title;
    this.errorHelp = help;
    this.codeBad = false;
    this.progress = "";
    this.go("fail");
  }

  bannerNode() {
    const k = this.kit;
    const banner = k.make("div", "net-banner net-banner--err");
    banner.setAttribute("role", "alert");
    const text = k.make("div", "net-banner__text");
    const title = k.make("p", "net-banner__title", this.errorTitle);
    const detail = k.make("p", "net-banner__detail", this.error);
    title.hidden = !this.errorTitle;
    detail.hidden = !this.error;
    text.append(title, detail);
    banner.append(k.icon("warn"), text);
    banner.hidden = !this.error && !this.errorTitle;
    Object.assign(this.refs, { banner, bannerTitle: title, bannerText: detail });
    return banner;
  }

  helpNode() {
    const k = this.kit;
    const sec = this.section(t("net.helpTitle"), { children: [k.list(HELP_KEYS.map((key) => t(key)), "net-help")] });
    sec.hidden = !this.errorHelp;
    this.refs.help = sec;
    return sec;
  }

  progressNode() {
    const node = this.kit.note(this.progress);
    node.classList.add("net-progress");
    node.hidden = !this.progress;
    this.refs.progress = node;
    return node;
  }

  errorNodes() {
    return [this.progressNode(), this.bannerNode(), this.helpNode()];
  }

  nickFoot() {
    const k = this.kit;
    const box = k.make("div", "net-nickline");
    if (this.nickEdit) {
      const done = () => {
        this.nickEdit = false;
        this.render();
      };
      const input = k.textInput({ value: [...k.nick()].slice(0, NICK_MAX).join(""), maxLength: NICK_MAX, label: t("net.nick"), action: "net-nick", onInput: (value) => k.setNick(value), onEnter: done });
      box.append(input, k.button({ label: k.label("nickDone"), small: true, action: "net-nick-done", onClick: done }));
      this.refs.nickInput = input;
    } else {
      const label = k.make("span", "net-nickline__label", t("net.nickMine"));
      const name = k.make("span", "net-nickline__name", k.nick());
      box.append(
        label,
        name,
        k.button({
          label: k.label("nickEdit"),
          small: true,
          action: "net-nick-edit",
          onClick: () => {
            this.nickEdit = true;
            this.render();
            this.refs.nickInput?.focus();
            if (!k.touch) this.refs.nickInput?.select();
          },
        }),
      );
    }
    return box;
  }

  spacer() {
    return this.kit.make("span", "net-spacer");
  }

  offlineButton({ small = true, block = false } = {}) {
    const k = this.kit;
    return k.button({ label: small ? k.label("offline") : k.label("offlineLong"), icon: small ? "chevron" : "", small, block, action: "net-offline", onClick: () => this.toLan() });
  }

  codeBox(code, { action }) {
    const k = this.kit;
    const area = k.textArea({ value: code, readOnly: true, rows: 4, label: t("net.codeLabel"), action });
    const copy = k.button({ label: k.label("copy"), action: `${action}-copy`, onClick: () => this.copy(code) });
    const qrBtn = k.button({ label: k.label("qr"), action: `${action}-qr`, onClick: () => this.toggleQr() });
    return [area, k.line(copy, qrBtn), this.qrBox(code)];
  }

  qrBox(code) {
    const qr = this.kit.make("div", "net-qr");
    qr.hidden = !this.qrOn;
    if (this.qrOn && code) qr.append(this.qrCanvas(code));
    this.refs.qr = qr;
    this.refs.qrCode = code;
    return qr;
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

  async copy(code, what = "code") {
    let ok = false;
    try {
      await navigator.clipboard.writeText(code);
      ok = true;
    } catch {}
    this.kit.notice(t(ok ? (what === "room" ? "net.copiedRoom" : "net.copied") : "net.copyFailed"), ok ? "info" : "warn");
  }

  pasteField({ field, action, value, onInput, onGo }) {
    const k = this.kit;
    const area = k.textArea({ value, rows: 4, label: field === "answer" ? t("net.answerLabel") : t("net.offerLabel"), placeholder: t("net.pastePlaceholder"), action, onInput });
    const hint = k.note("");
    hint.classList.add("net-paste-hint");
    hint.hidden = true;
    const buttons = [];
    if (canScan(k.touch)) buttons.push(k.button({ label: k.label("scan"), action: `${action}-scan`, onClick: () => this.scan(area, onInput) }));
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
    let read = null;
    try {
      read = await frameReader();
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
    const scanner = { stream, timer: 0 };
    this.scanner = scanner;
    await video.play().catch(() => {});
    const tick = async () => {
      if (this.scanner !== scanner) return;
      try {
        const found = await read(video);
        const text = found.map((value) => cleanCode(value)).find(Boolean);
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

  codeCells() {
    const k = this.kit;
    const box = k.make("div", "net-cells");
    const cells = [];
    for (let i = 0; i < CODE_LEN; i++) {
      const cell = k.make("span", "net-cell");
      cell.append(k.make("span", "net-cell__digit", ""));
      cells.push(cell);
      box.append(cell);
    }
    const paint = () => {
      const digits = this.roomText;
      const at = Math.min(digits.length, CODE_LEN - 1);
      cells.forEach((cell, i) => {
        const glyph = cell.firstChild;
        if (glyph.textContent !== (digits[i] ?? "")) glyph.textContent = digits[i] ?? "";
        cell.classList.toggle("is-cur", i === at);
      });
    };
    const input = k.textInput({
      value: this.roomText,
      maxLength: 64,
      numeric: true,
      label: t("net.roomCode"),
      action: "net-code-in",
      onInput: (value) => {
        const digits = String(value).replace(/\D/g, "").slice(0, CODE_LEN);
        if (input.value !== digits) input.value = digits;
        this.roomText = digits;
        if (this.codeBad || this.error) {
          this.clearError();
          this.refreshDynamic();
        }
        paint();
      },
      onEnter: () => this.joinRoom(this.roomText),
    });
    input.classList.add("net-cells__in");
    input.setAttribute("autocomplete", "one-time-code");
    const end = () => input.setSelectionRange?.(input.value.length, input.value.length);
    input.addEventListener("focus", () => box.classList.add("is-focus"));
    input.addEventListener("blur", () => box.classList.remove("is-focus"));
    input.addEventListener("click", end);
    input.addEventListener("keyup", end);
    box.append(input);
    box.classList.toggle("is-bad", this.codeBad);
    this.refs.cells = box;
    this.refs.codeInput = input;
    paint();
    return box;
  }

  pips(n, max) {
    const k = this.kit;
    if (!(max > 0) || max > PIPS_MAX) return null;
    const box = k.make("span", "net-pips");
    for (let i = 0; i < max; i++) box.append(k.make("i", i < n ? "is-on" : ""));
    return box;
  }

  choices(items) {
    const k = this.kit;
    if (typeof k.entry === "function") return items.map(({ text, button }) => k.entry(text, button));
    return [k.line(...items.map(({ button }) => button))];
  }

  toLan() {
    this.joinSeq++;
    this.busy = false;
    this.clearError();
    this.nickEdit = false;
    this.go("lan");
  }

  home() {
    this.clearError();
    this.go("choose");
  }

  retry() {
    if (!this.lastRoom) return this.home();
    this.tab = "join";
    this.clearError();
    this.go("choose");
    this.joinRoom(this.lastRoom);
  }

  nearNodes() {
    const k = this.kit;
    const n = this.near;
    if (n.state === "loading" || n.state === "idle") return [k.note(t("net.nearLoading"))];
    if (n.state === "offline") return [k.note(tb("net.nearOffline"))];
    if (n.state === "fail") return [k.note(tb("net.nearFail"))];
    const purpose = signalPurpose(this.request?.purpose?.id);
    const rows = [];
    for (const room of n.rooms) {
      const same = room.c === n.compat;
      if (same && room.p !== purpose) continue;
      if (!same) {
        const cant = k.make("span", "net-cant");
        cant.append(k.make("span", "net-cant__text", t("net.nearCant")));
        rows.push(k.nearRow({ name: room.nick, meta: t("net.nearMetaOther", { n: room.k, max: room.m }), pips: this.pips(room.k, room.m), dim: true, side: cant }));
        continue;
      }
      const button = k.button({ label: k.label("enter"), action: "net-near-join", onClick: () => this.joinRoom(room.room) });
      button.dataset.room = room.room;
      button.disabled = this.busy;
      rows.push(k.nearRow({ name: room.nick, meta: t("net.nearMeta", { n: room.k, max: room.m }), pips: this.pips(room.k, room.m), side: button }));
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
      if (seq !== this.nearSeq || !this.nearWanted()) return;
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

  joinTab(snap) {
    const k = this.kit;
    const near = k.make("div", "net-near-box");
    this.refs.near = near;
    near.append(...this.nearNodes());
    const refresh = k.iconButton({ icon: "refresh", title: t("net.nearRefresh"), action: "net-near-refresh", onClick: () => this.startNear() });
    const nearSec = this.section(t("net.near"), { sub: t("net.nearAuto"), tool: refresh, children: [near], kind: "near" });
    const go = k.button({ label: k.label("enterCode"), icon: "chevron", kind: "primary", action: "net-code-go", onClick: () => this.joinRoom(this.roomText), disabled: this.busy });
    this.refs.codeGo = go;
    const row = k.make("div", "net-coderow");
    row.append(this.codeCells(), go);
    const codeSec = this.section(t("net.codeJoin"), { children: [row, ...this.errorNodes()], kind: "code" });
    return { a: [...this.iceNodes(snap), codeSec], b: [nearSec] };
  }

  makeTab(snap) {
    const k = this.kit;
    const info = k.make("ul", "net-info");
    for (const [icon, text] of [["people", this.chipText()]]) {
      const li = k.make("li", "net-info__row");
      const mark = k.make("span", "net-info__icon");
      mark.append(k.icon(icon));
      li.append(mark, k.make("span", "net-info__text", text));
      info.append(li);
    }
    const go = k.button({ label: k.label("create"), icon: "plus", kind: "primary", big: true, block: true, action: "net-room-make", onClick: () => this.startRoom(), disabled: this.busy });
    this.refs.makeGo = go;
    return { a: [k.note(t("net.makeLead")), ...this.iceNodes(snap)], b: [info, go, ...this.errorNodes()] };
  }

  render() {
    const k = this.kit;
    this.refs = {};
    const snap = this.net.snapshot();
    this.paintTitle(snap);
    let body = [];
    let foot = [];
    const cancel = k.action({ id: "cancel", onClick: () => this.close({ cancel: true }) });
    if (this.screen === "choose") {
      const make = this.canMake();
      const tab = make ? this.tab : "join";
      const tabs = make
        ? k.tabs(
            [
              { id: "join", label: t("net.join"), action: "net-room-join" },
              { id: "make", label: t("net.make"), action: "net-tab-make" },
            ],
            tab,
            (id) => this.pickTab(id),
          )
        : null;
      if (tabs) tabs.classList.add("net-tabs");
      const part = tab === "make" ? this.makeTab(snap) : this.joinTab(snap);
      body = [this.cols([tabs, ...part.a], part.b)];
      foot = [this.nickFoot(), this.spacer(), this.offlineButton()];
    } else if (this.screen === "lan") {
      body = [];
      if (this.fallback) body.push(k.note(t("net.fallback")));
      body.push(
        k.note(t("net.lead")),
        ...this.choices([
          { text: t("net.make"), button: k.button({ label: k.label("makeCode"), kind: "primary", action: "net-make", onClick: () => this.startHost() }) },
          { text: t("net.join"), button: k.button({ label: k.label("join"), action: "net-join", onClick: () => this.go("join1") }) },
        ]),
        k.note(t("net.codeNote")),
        ...this.errorNodes(),
      );
      foot = [this.nickFoot(), this.spacer(), k.action({ id: "back", onClick: () => this.home() })];
    } else if (this.screen === "room") {
      this.reachedShown = snap.reached;
      this.anytimeShown = snap.anytime;
      const a = [];
      if (snap.reached && !this.stay) a.push(k.note(t("net.reachedNote", { n: snap.count, max: snap.max })));
      const timed = Boolean(this.roomHost?.limit && this.roomHost.running);
      if (snap.count < snap.max) {
        const code = this.roomHost?.room ?? "";
        const box = k.make("div", "net-room");
        this.refs.roomBox = box;
        box.append(this.roomCodeNode(code));
        const copy = k.button({ label: k.label("copyCode"), icon: "copy", grow: true, action: "net-room-copy", onClick: () => this.copy(code, "room"), disabled: !code });
        const qrBtn = k.button({ label: k.label("qr"), grow: true, action: "net-room-qr", onClick: () => this.toggleQr(), disabled: !code });
        const buttons = k.line(copy, qrBtn);
        buttons.classList.add("net-btnrow");
        const hint = k.note(code ? t("net.roomHint") : t("net.roomMaking"));
        if (timed) {
          const accept = k.make("span", "net-accept", this.acceptText());
          this.refs.accept = accept;
          hint.append(" ", accept);
        }
        const parts = [box, buttons, this.qrBox(code), hint];
        if (snap.anytime) parts.push(k.note(tb("net.anytimeNote")));
        a.push(this.section(t("net.roomCode"), { children: parts }));
      }
      a.push(...this.iceNodes(snap));
      body = [this.cols(a, [this.seatSection(snap)]), ...this.errorNodes()];
      foot = this.hostFoot(snap, timed);
      if (this.refs.accept && this.roomHost?.inviting) this.startClock();
    } else if (this.screen === "wait") {
      body = [k.note(t("net.joinWait", { nick: this.joinInfo?.hn ?? "" })), ...this.errorNodes()];
      foot = [this.spacer(), cancel];
    } else if (this.screen === "host") {
      this.reachedShown = snap.reached;
      this.anytimeShown = snap.anytime;
      body = this.fallback ? [k.note(t("net.fallback"))] : [];
      if (snap.reached && !this.stay) body.push(k.note(t("net.reachedNote", { n: snap.count, max: snap.max })));
      if (snap.anytime && !snap.reached) body.push(k.note(tb("net.anytimeNote")));
      body.push(this.seatSection(snap));
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
        body.push(this.section(t(snap.count > 1 ? "net.inviteMore" : "net.invite"), { children: [box] }));
      }
      body.push(...this.errorNodes());
      foot = this.hostFoot(snap, false);
      if (!this.invite && snap.count < snap.max) this.makeInvite();
    } else if (this.screen === "join1") {
      body = [k.step(tb("net.join.step1")), ...this.pasteField({ field: "offer", action: "net-offer-in", value: this.offerText, onInput: (v) => (this.offerText = v), onGo: () => this.joinWithOffer() }), ...this.errorNodes()];
      foot = [this.spacer(), k.action({ id: "back", onClick: () => this.go("lan") })];
    } else if (this.screen === "join2") {
      const wait = k.note(t("net.join.waiting"));
      body = [k.step(t("net.join.step2")), ...this.codeBox(this.guestCode, { action: "net-answer-out" }), wait, ...this.errorNodes()];
      foot = [this.spacer(), cancel];
    } else if (this.screen === "joined" || this.screen === "back") {
      body = [k.note(t(this.screen === "back" ? "net.rejoined" : "net.joined", { slot: snap.slot + 1 })), this.seatSection(snap, { count: false })];
      foot = [this.spacer(), k.action({ id: "done", primary: true, onClick: () => this.close() })];
      this.closeTimer = setTimeout(() => this.close(), CONNECTED_CLOSE_MS);
    } else if (this.screen === "rejoin") {
      const state = k.note(this.rejoinText(snap));
      state.classList.add("net-rejoin-state");
      this.refs.rejoinState = state;
      body = [
        k.note(t("net.rejoin.lead")),
        state,
        ...this.choices([
          { text: t("net.rejoinNow"), button: k.button({ label: k.label("rejoin"), kind: "primary", action: "net-rejoin-now", onClick: () => this.net.rejoinNow() }) },
          { text: t("net.solo"), button: k.button({ label: k.label("solo"), kind: "danger", action: "net-solo", onClick: () => this.goSolo() }) },
        ]),
        k.note(t("net.rejoin.note")),
        this.seatSection(snap, { count: false }),
      ];
      foot = [this.spacer(), k.action({ id: "close", onClick: () => this.close() })];
    } else if (this.screen === "ended") {
      const why = this.endedWhy;
      this.errorTitle = t("net.err.closed");
      this.error = whyText(why);
      this.errorHelp = [WHY.NO_NETWORK, WHY.TIMEOUT, WHY.LOST].includes(why);
      body = [this.bannerNode(), this.helpNode()];
      foot = [this.spacer(), k.action({ id: "close", primary: true, onClick: () => this.close() })];
    } else if (this.screen === "fail") {
      const stack = (...nodes) => {
        const box = k.make("div", "net-stack");
        box.append(...nodes);
        return box;
      };
      const retry = k.button({ label: k.label("retry"), kind: "primary", block: true, action: "net-retry", onClick: () => this.retry() });
      const home = k.button({ label: k.label("home"), block: true, action: "net-home", onClick: () => this.home() });
      body = [this.cols([this.bannerNode(), stack(retry)], [stack(this.offlineButton({ small: false, block: true }), home), this.helpNode()])];
      foot = [];
    }
    k.mount(body, foot);
  }

  hostFoot(snap, timed) {
    const k = this.kit;
    const keep = snap.reached || snap.anytime;
    const out = [keep ? k.action({ id: "leave", label: "closeRoom", danger: true, onClick: () => (this.net.leave(), this.close()) }) : k.action({ id: "cancel", label: "closeRoom", danger: true, onClick: () => this.close({ cancel: true }) })];
    if (timed) {
      const renew = k.button({ label: k.label("renew"), icon: "refresh", action: "net-renew", onClick: () => this.renewRoom(), disabled: Boolean(this.roomHost?.renewing) });
      this.refs.renew = renew;
      out.push(renew);
    }
    out.push(this.spacer());
    if (keep) out.push(k.action({ id: snap.reached ? "done" : "close", label: "toGame", primary: true, onClick: () => this.close() }));
    return out;
  }

  async startRoom() {
    if (this.busy) return;
    this.dropRoom();
    this.invite = null;
    this.answerText = "";
    this.reachedShown = false;
    this.clearError();
    this.fallback = false;
    let session;
    try {
      session = await this.freshSession("make");
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
      limit: this.net.anytime ? ACCEPT_MS : 0,
      onPause: () => this.paused(),
    });
    this.roomHost = host;
    this.net.useRelay(this.signal, () => host.auth);
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

  async freshSession(role) {
    const s = this.net.session;
    if (s && !s.closed && !s.opened && s.role === "join") {
      this.clearJoin();
      this.net.discard();
    }
    return this.net.open(role);
  }


  async joinRoom(text) {
    if (this.busy) return;
    const room = String(text ?? "").replace(/\D/g, "");
    if (this.screen !== "choose" || this.tab !== "join") {
      this.tab = "join";
      this.go("choose");
    }
    if (room.length !== CODE_LEN) {
      this.setError(t("net.err.roomCode"), false, { code: true });
      return;
    }
    if (!this.signal) return this.setError(errorText(new SignalError("offline")));
    const seq = ++this.joinSeq;
    this.lastRoom = room;
    this.busy = true;
    this.setProgress(t("net.joiningRoom"));
    this.paintNear();
    let session = null;
    try {
      const info = { room, c: await signalCompat(this.net.compat), p: signalPurpose(this.request?.purpose?.id), n: [...this.kit.nick()].slice(0, NICK_MAX).join("") };
      let got = await this.signal.join(info);
      const until = Date.now() + JOIN_WAIT_MS;
      while (got.wait) {
        if (seq !== this.joinSeq) return;
        this.setProgress(t("net.roomBusy"));
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (seq !== this.joinSeq) return;
        if (Date.now() > until) throw new SessionError("timeout");
        const st = await this.signal.status(room);
        if (st.q > got.q) got = await this.signal.join(info);
      }
      if (seq !== this.joinSeq) return;
      session = await this.freshSession("join");
      const proof = got.rt ? { room, x: got.x, rt: got.rt } : null;
      this.net.useRelay(this.signal, () => proof);
      const made = await session.answer(got.o);
      if (seq !== this.joinSeq) throw new SessionError("closed");
      await this.signal.answer({ x: got.x, q: got.q, t: got.t, d: made.code });
      this.joinHint = hintOf(made.sym, made.peerSym);
      if (got.rt && session.rejoinGame) this.roomGuest = new RoomGuest({ signal: this.signal, session, room, x: got.x, rt: got.rt, log: this.net.log ?? (() => {}) });
      this.joinInfo = got;
      this.joinedRoom = room;
      this.busy = false;
      this.clearError();
      this.joinTimer = setTimeout(() => {
        if (this.joinInfo !== got || this.net.connected) return;
        this.clearJoin();
        this.net.discard();
        if (this.open && this.screen === "wait") this.fail(hintText(this.joinHint) || t("net.err.failed"), helpFor(this.joinHint));
      }, JOIN_WAIT_MS);
      if (this.open) this.go("wait");
    } catch (error) {
      this.busy = false;
      if (session) this.net.discard();
      if (seq !== this.joinSeq) return;
      if (error instanceof SessionError) {
        if (this.open) this.fail(errorText(error), HELP_CODES.includes(error.code));
        return;
      }
      if (error instanceof SignalError && ["none", "full", "version", "purpose", "paused"].includes(error.code)) this.startNear();
      const missing = error instanceof SignalError && error.code === "none";
      this.setError(missing ? t("net.err.noRoomHint") : errorText(error), false, { title: missing ? t("net.err.noRoom") : "", code: missing });
      this.paintNear();
    }
  }

  async startHost() {
    this.invite = null;
    this.answerText = "";
    this.reachedShown = false;
    this.clearError();
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
    this.setProgress(t("net.connecting"));
    try {
      await session.accept(invite.id, this.answerText);
      this.busy = false;
      this.clearError();
      this.invite = null;
      this.answerText = "";
      if (this.screen === "host") this.render();
    } catch (error) {
      this.busy = false;
      const field = error instanceof CodeError || (error instanceof SessionError && ["used", "mismatch", "noLan"].includes(error.code));
      if (!field && this.invite === invite) this.invite = null;
      this.clearError();
      this.error = errorText(error, "answer");
      this.errorHelp = error instanceof SessionError && HELP_CODES.includes(error.code);
      if (this.screen === "host") {
        if (field) this.refreshDynamic();
        else this.render();
      }
    }
  }

  async joinWithOffer() {
    if (this.busy) return;
    this.busy = true;
    this.setProgress(t("net.makingAnswer"));
    try {
      const session = await this.freshSession("join");
      const { code } = await session.answer(this.offerText);
      this.guestCode = code;
      this.busy = false;
      this.clearError();
      this.go("join2");
    } catch (error) {
      this.busy = false;
      this.net.discard();
      this.setError(errorText(error, "offer"), error instanceof SessionError);
    }
  }
}
