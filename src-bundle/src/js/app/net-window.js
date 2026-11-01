import { CodeError, cleanCode } from "../core/net/lan.js";
import { SessionError } from "../core/net/session.js";
import { CONNECTED_CLOSE_MS, WHY } from "../core/net/net-host.js";
import { drawQr } from "../core/net/qr.js";
import { pickText } from "../core/wgba-read.js";
import { lang, t } from "../shell/i18n.js";

const SCAN_MS = 200;
const PASTE_WAIT_MS = 1500;

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
    this.onClosed = onClosed;
    this.open = false;
    this.screen = "";
    this.request = null;
    this.refs = {};
    this.invite = null;
    this.answerText = "";
    this.offerText = "";
    this.guestCode = "";
    this.error = "";
    this.errorHelp = false;
    this.busy = false;
    this.qrOn = false;
    this.scanner = null;
    this.closeTimer = 0;
    this.endedWhy = 0;
  }

  show(request) {
    this.request = request ?? this.net.request;
    if (!this.request) return;
    const snap = this.net.snapshot();
    this.open = true;
    this.error = "";
    this.errorHelp = false;
    if (snap.active) this.go(snap.role === "make" ? "host" : snap.connected ? "joined" : "join2");
    else if (this.request.role === "make") this.startHost();
    else if (this.request.role === "join") this.go("join1");
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
    this.screen = screen;
    this.qrOn = screen === "join2" && this.kit.touch;
    this.render();
  }

  close({ cancel = false } = {}) {
    if (!this.open) return;
    this.stopScan();
    clearTimeout(this.closeTimer);
    this.open = false;
    this.screen = "";
    this.refs = {};
    if (cancel) {
      const snap = this.net.snapshot();
      if (!snap.reached || snap.role !== "make") this.net.cancel();
    }
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

  update(snap = this.net.snapshot()) {
    if (!this.open) return;
    if (!snap.request && !snap.active) {
      this.close();
      return;
    }
    if (snap.ended && this.screen !== "ended" && this.screen !== "choose") {
      this.endedWhy = snap.ended.why;
      this.go("ended");
      return;
    }
    if (this.screen === "join2" && snap.connected) {
      this.go("joined");
      return;
    }
    if (this.screen === "join2" && !snap.active && snap.failed) {
      this.error = whyText(snap.failed.why);
      this.errorHelp = true;
      this.offerText = "";
      this.screen = "join1";
      this.render();
      return;
    }
    if (this.screen === "joined" && snap.connected && !this.closeTimer) this.closeTimer = setTimeout(() => this.close(), CONNECTED_CLOSE_MS);
    if (this.screen === "host" && snap.active) {
      const canInvite = snap.count < snap.max;
      if (snap.reached !== Boolean(this.reachedShown) || canInvite !== Boolean(this.refs.inviteBox)) {
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
      control: k.textInput({ value: k.nick(), maxLength: 16, label: t("net.nick"), action: "net-nick", onInput: (value) => k.setNick(value) }),
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

  render() {
    const k = this.kit;
    this.refs = {};
    const snap = this.net.snapshot();
    k.title(this.title());
    let body = [];
    let actions = [];
    const cancel = k.action({ id: "cancel", onClick: () => this.close({ cancel: true }) });
    if (this.screen === "choose") {
      body = [
        k.note(t("net.lead")),
        this.nickField(),
        k.line(k.button({ label: k.label("make"), kind: "primary", action: "net-make", onClick: () => this.startHost() }), k.button({ label: k.label("join"), action: "net-join", onClick: () => this.go("join1") })),
        k.note(t("net.codeNote")),
      ];
      actions = [cancel];
    } else if (this.screen === "host") {
      this.reachedShown = snap.reached;
      const count = k.make("p", "net-count", t("net.count", { n: snap.count, max: snap.max, min: this.request?.min ?? 2 }));
      this.refs.count = count;
      const members = k.make("ul", "net-members");
      members.append(...this.memberRows(snap));
      this.refs.members = members;
      body = [k.group(t("net.room"), count, members)];
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
      actions = [cancel];
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
