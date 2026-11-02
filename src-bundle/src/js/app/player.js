import { core } from "../bridge.js";
import { SCREEN_H, SCREEN_W } from "../core/web-host.js";
import { DPAD_MODES, resolveInput, ROLE_KEYS } from "../core/wgba-format.js";
import { NetHost } from "../core/net/net-host.js";
import { lang, locale, t } from "../shell/i18n.js";

export const FRAME_MS = (280896 / 16777216) * 1000;
const MAX_FRAMES_PER_TICK = 8;
const SAVE_DELAY_MS = 1000;
const POINTER_BUTTONS = 7;
const POINTER_WHEEL_STEP = 40;
const AUDIO_STALL_MS = 2000;
const CLOCK_WORKER = "let t=0;onmessage=(e)=>{clearInterval(t);t=e.data>0?setInterval(()=>postMessage(0),e.data):0};";

// iOS·Safari 의 Web Audio 는 기본이 ambient 라 무음 모드(벨소리 끔)에서 소리가 나지 않는다.
// Audio Session API(Safari 16.4+)가 있으면 소리를 낼 때 playback 으로 바꾼다. 없는 브라우저(Chrome·WebView2)는 그대로.
function setAudioSession(type) {
  const session = globalThis.navigator?.audioSession;
  if (!session || session.type === type) return;
  try {
    session.type = type;
  } catch {}
}

export function audioSessionType() {
  return globalThis.navigator?.audioSession?.type ?? "";
}

const baseOf = (path) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const BUTTONS = ["A", "B", "SELECT", "START", "RIGHT", "LEFT", "UP", "DOWN", "R", "L"];

export { DPAD_MODES };

export const DPAD_DEFAULT = "latest";

export function dpadFor(input, prefs) {
  if (!input?.dpad) return DPAD_MODES.includes(prefs?.dpadMode) ? prefs.dpadMode : DPAD_DEFAULT;
  const own = input.gameId ? prefs?.gameDpad?.[input.gameId] : undefined;
  return DPAD_MODES.includes(own) ? own : input.dpad;
}

export function gameDpadPatch(input, prefs, mode) {
  if (!input?.dpad || !input.gameId) return null;
  const gameDpad = { ...(prefs?.gameDpad ?? {}) };
  if (mode === input.dpad || !DPAD_MODES.includes(mode)) delete gameDpad[input.gameId];
  else gameDpad[input.gameId] = mode;
  return { gameDpad };
}

/** 설명서가 없는 게임(.gba·옛 .wgba·.wasm)과 preset gba 만 쓰는 게임의 버튼 목록 = GBA 10버튼(비트 = BUTTONS 순서). */
export const GBA_LAYOUT = Object.freeze(resolveInput(null));

/** GBA 버튼과 같은 role → 그 GBA 버튼 이름(사용자가 바꾼 GBA 키를 그 role 의 기본 키로). */
const ROLE_GBA = { a: "A", b: "B", select: "SELECT", start: "START", right: "RIGHT", left: "LEFT", up: "UP", down: "DOWN", r: "R", l: "L" };

const VK_CODES = { 8: "Backspace", 9: "Tab", 13: "Enter", 16: "ShiftLeft", 17: "ControlLeft", 18: "AltLeft", 27: "Escape", 32: "Space", 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown", 46: "Delete" };
const KEY_CODES = { ArrowLeft: "ArrowLeft", ArrowUp: "ArrowUp", ArrowRight: "ArrowRight", ArrowDown: "ArrowDown", Enter: "Enter", " ": "Space", Backspace: "Backspace", Tab: "Tab", Escape: "Escape" };

export function codeOf(event) {
  if (event.code && event.code !== "Unidentified") return event.code;
  const vk = event.keyCode;
  if (VK_CODES[vk]) return VK_CODES[vk];
  if (vk >= 65 && vk <= 90) return `Key${String.fromCharCode(vk)}`;
  if (vk >= 48 && vk <= 57) return `Digit${vk - 48}`;
  if (vk >= 96 && vk <= 105) return `Numpad${vk - 96}`;
  return KEY_CODES[event.key] ?? "";
}

export const DEFAULT_KEYS = {
  A: ["KeyZ", "KeyK"],
  B: ["KeyX", "KeyJ"],
  SELECT: ["Backspace", "ShiftRight"],
  START: ["Enter", "NumpadEnter"],
  RIGHT: ["ArrowRight"],
  LEFT: ["ArrowLeft"],
  UP: ["ArrowUp"],
  DOWN: ["ArrowDown"],
  R: ["KeyS"],
  L: ["KeyA"],
  FAST: ["Space"],
  // C·D 는 설명서가 C·D 를 정의한 게임만 화면 버튼이 되고, 그 게임은 ROLE_KEYS 기본 키(C·I / V·U)를 쓴다.
  // 여기(앱 전체 키)의 C·D 는 설명서가 C·D 를 정의하지 않은 게임·게임 없음에서 키 설정 칸을 보이려는 자리라 기본이 빈 상태다(결정 102, 사용자 2026-11-01).
  C: [],
  D: [],
};

/**
 * 버튼 목록(resolveInput) → 키 표 { 버튼 id: [code…], FAST: [code…] }.
 * gba 면 global(앱 전체 GBA 키 = 지금 그대로). 아니면 버튼마다 saved(이 게임의 사용자 배치) → 설명서 keys →
 * role 기본(GBA 와 같은 role 은 global 의 그 버튼 키, c·d·l2·r2 는 ROLE_KEYS). 한 키는 한 버튼에만(먼저 정한 쪽).
 */
export function layoutKeys(layout, global = DEFAULT_KEYS, saved = null) {
  const clone = (list) => (Array.isArray(list) ? list.filter((code) => typeof code === "string" && code) : []);
  if (layout.gba) {
    const out = {};
    for (const name of [...BUTTONS, "FAST"]) out[name] = clone(global[name] ?? DEFAULT_KEYS[name]);
    return out;
  }
  const out = { FAST: clone(global.FAST ?? DEFAULT_KEYS.FAST) };
  const taken = new Set(out.FAST);
  const take = (list) => list.filter((code) => !taken.has(code) && taken.add(code));
  for (const b of layout.buttons) {
    const own = Array.isArray(saved?.[b.id]) ? saved[b.id] : b.keys;
    if (own) out[b.id] = take(clone(own));
  }
  for (const b of layout.buttons) {
    if (out[b.id]) continue;
    const gba = ROLE_GBA[b.role];
    out[b.id] = take(clone(gba ? (global[gba] ?? DEFAULT_KEYS[gba]) : ROLE_KEYS[b.role]));
  }
  return out;
}

/** 키 설정·조작법에 보일 버튼 이름: 설명서 label(사용자 언어 → en → 첫 값) → GBA 버튼 이름 → id. */
export function buttonLabel(button, language = lang()) {
  const label = button.label;
  const text = typeof label === "string" ? label : label && typeof label === "object" ? (label[language] ?? label.en ?? Object.values(label).find((v) => typeof v === "string")) : "";
  if (text) return text;
  return BUTTONS.includes(button.id) ? t(`key.${button.id}`) : button.id;
}

const AXIS_RE = /^([+-]?)axis(\d)$/;

/** 버튼의 게임패드 배치 → 판정 함수 하나(표준 매핑 버튼 번호, 축은 ±0.5 넘으면). */
function padTest(list) {
  const tests = list.map((p) => {
    if (typeof p === "number") return (gp) => Boolean(gp.buttons[p]?.pressed);
    const m = AXIS_RE.exec(p);
    if (!m) return () => false;
    const axis = Number(m[2]);
    return m[1] === "-" ? (gp) => (gp.axes[axis] ?? 0) < -0.5 : (gp) => (gp.axes[axis] ?? 0) > 0.5;
  });
  return (gp) => tests.some((test) => test(gp));
}

const WORKLET = `
class WebGbaOut extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(sampleRate * 2);
    this.r = 0; this.w = 0; this.n = 0;
    this.low = Infinity; this.seen = 0;
    this.port.onmessage = (e) => {
      if (e.data === "clear") { this.r = 0; this.w = 0; this.n = 0; return; }
      if (e.data === "fill") { this.port.postMessage({ fill: this.n / 2 / sampleRate }); return; }
      if (typeof e.data?.trim === "number") { this.cut(Math.floor(sampleRate * e.data.trim) * 2); return; }
      const s = e.data; const cap = this.buf.length;
      for (let i = 0; i < s.length; i++) { this.buf[this.w] = s[i]; this.w = (this.w + 1) % cap; }
      this.n += s.length;
      this.cut(Math.floor(sampleRate * 0.25) * 2);
    };
  }
  cut(keep) {
    if (this.n <= keep) return;
    this.r = (this.r + this.n - keep) % this.buf.length;
    this.n = keep;
  }
  process(_, outputs) {
    const [l, r] = outputs[0]; const cap = this.buf.length;
    for (let i = 0; i < l.length; i++) {
      if (this.n >= 2) { l[i] = this.buf[this.r]; r[i] = this.buf[this.r + 1]; this.r = (this.r + 2) % cap; this.n -= 2; }
      else { l[i] = 0; r[i] = 0; }
    }
    if (this.n < this.low) this.low = this.n;
    this.seen += l.length;
    if (this.seen >= sampleRate) {
      const keep = Math.floor(sampleRate * 0.03) * 2;
      if (this.low > keep * 2) this.cut(this.n - (this.low - keep));
      this.low = Infinity; this.seen = 0;
    }
    return true;
  }
}
registerProcessor("webgba-out", WebGbaOut);`;


export class Player {
  constructor({ canvas, onStatus, onStats, onHalt, onChange, onNetWant, onNetChange, onNetNotice, onNetBoard, netNick, netEnabled, netWan, hiddenClock = false }) {
    this.canvas = canvas;
    this.hiddenClock = hiddenClock;
    this.clock = null;
    this.clockOn = false;
    this.net = new NetHost({
      log: (level, text) => core.log(level === "warn" ? "WARN" : "INFO", `[멀티플레이] ${text}`),
      onWant: (request) => onNetWant?.(request),
      onChange: (snapshot) => {
        this.syncClock();
        onNetChange?.(snapshot);
      },
      onNotice: (info) => onNetNotice?.(info),
      onBoard: () => onNetBoard?.(),
      nick: () => netNick?.() ?? "",
      enabled: () => netEnabled?.() ?? true,
      wan: () => netWan?.() ?? false,
    });
    globalThis.document?.addEventListener?.("visibilitychange", () => {
      this.syncClock();
      this.syncAway();
    });
    this.ctx = canvas.getContext("2d");
    this.image = this.ctx.createImageData(SCREEN_W, SCREEN_H);
    this.onStatus = onStatus ?? (() => {});
    this.onStats = onStats ?? (() => {});
    this.onHalt = onHalt ?? (() => {});
    // ② 자체 JS 게임의 상태가 바뀜(퀵슬롯을 쓸 수 있게 됨·멈춤 등) → 화면이 버튼을 다시 그린다
    this.onChange = onChange ?? (() => {});
    this.padNow = 0;
    this.host = null;
    this.saveId = "";
    this.game = "";
    this.saveBase = null;
    this.running = false;
    this.paused = false;
    this.fast = false;
    this.fastHeld = false;
    this.fastScale = 4;
    this.fastMute = false;
    this.dpadMode = DPAD_DEFAULT;
    this.held = 0;
    this.down = new Map();
    this.pressed = 0;
    this.dropped = 0;
    this.released = 0;
    this.sent = 0;
    this.padPrev = 0;
    this.stamp = 0;
    this.dirStamp = {};
    this.keymap = new Map();
    this.layout = GBA_LAYOUT;
    this.bitOf = new Map();
    this.padMap = [];
    this.dirs = { right: 0, left: 0, up: 0, down: 0 };
    this.dirMask = 0;
    this.dirBits = [];
    this.audio = null;
    this.squeeze = { at: 0, l: 0, r: 0, n: 0 };
    this.pace = { speed: 1, emu: 0, real: 0 };
    this.volume = 0.8;
    this.muted = false;
    this.saveTimer = 0;
    this.savePending = false;
    this.last = 0;
    this.acc = 0;
    this.frames = 0;
    this.statAt = 0;
    this.raf = 0;
    this.ptr = { x: -1, y: -1, buttons: 0, wheel: 0, block: false };
    this.tick = this.tick.bind(this);
    this.setLayout(GBA_LAYOUT, DEFAULT_KEYS);
    this.attachPointer();
  }

  get pointerOn() {
    return Boolean(this.host?.hasPointer) && this.running && !this.paused;
  }

  attachPointer() {
    const canvas = this.canvas;
    if (!canvas?.addEventListener) return;
    canvas.addEventListener("pointerdown", (event) => {
      if (!this.pointerOn) return;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {}
      this.pointerMove(event);
    });
    canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    canvas.addEventListener("pointerup", (event) => this.pointerMove(event));
    canvas.addEventListener("pointercancel", () => this.pointerRelease());
    canvas.addEventListener("pointerleave", (event) => {
      if (!event.buttons) this.pointerSend(-1, -1, 0, 0);
    });
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!this.pointerOn) return;
        event.preventDefault();
        const dy = event.deltaMode === 0 ? event.deltaY : event.deltaY * POINTER_WHEEL_STEP;
        let notch = 0;
        if (Math.abs(dy) >= POINTER_WHEEL_STEP) {
          this.ptr.wheel = 0;
          notch = Math.sign(dy);
        } else {
          this.ptr.wheel += dy;
          if (Math.abs(this.ptr.wheel) >= POINTER_WHEEL_STEP) {
            notch = Math.sign(this.ptr.wheel);
            this.ptr.wheel = 0;
          }
        }
        if (notch) this.pointerSend(this.ptr.x, this.ptr.y, this.ptr.buttons, notch);
      },
      { passive: false },
    );
    canvas.addEventListener("contextmenu", (event) => {
      if (this.host?.pointerWanted) event.preventDefault();
    });
  }

  gamePoint(event) {
    const box = this.canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return [-1, -1];
    const w = this.image.width;
    const h = this.image.height;
    const x = Math.floor(((event.clientX - box.left) * w) / box.width);
    const y = Math.floor(((event.clientY - box.top) * h) / box.height);
    return x < 0 || y < 0 || x >= w || y >= h ? [-1, -1] : [x, y];
  }

  /** ① 화면 크기(설명서 screen)에 캔버스·그림을 맞춘다. 240×160 이면 그대로. */
  fitScreen(width = SCREEN_W, height = SCREEN_H) {
    if (this.image.width === width && this.image.height === height && this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.image = this.ctx.createImageData(width, height);
  }

  pointerMove(event) {
    if (!this.pointerOn) return;
    if (!event.buttons) this.ptr.block = false;
    const [x, y] = this.gamePoint(event);
    this.pointerSend(x, y, this.ptr.block ? 0 : event.buttons & POINTER_BUTTONS, 0);
  }

  pointerSend(x, y, buttons, wheel) {
    if (!this.pointerOn) return;
    const p = this.ptr;
    if (p.x === x && p.y === y && p.buttons === buttons && !wheel) return;
    p.x = x;
    p.y = y;
    p.buttons = buttons;
    this.host.pointer(x, y, buttons, wheel);
  }

  pointerRelease() {
    const p = this.ptr;
    if (this.host?.hasPointer && (p.buttons || p.x >= 0)) this.host.pointer(-1, -1, 0, 0);
    p.block = p.block || p.buttons !== 0;
    p.x = -1;
    p.y = -1;
    p.buttons = 0;
    p.wheel = 0;
  }

  get active() {
    return Boolean(this.host);
  }

  /**
   * 게임의 버튼 목록(resolveInput 결과)으로 바꾼다: 버튼 id → 비트(① bit), role 로 방향 처리·게임패드 배치.
   * keys(layoutKeys 결과)를 주면 키 표도 같이. 설명서 없는 게임은 GBA_LAYOUT — 비트·게임패드가 예전과 같다.
   */
  setLayout(layout, keys = null) {
    this.layout = layout ?? GBA_LAYOUT;
    this.bitOf = new Map();
    this.padMap = [];
    const dirs = { right: 0, left: 0, up: 0, down: 0 };
    for (const [index, b] of this.layout.buttons.entries()) {
      // ② 자체 JS 버튼은 bit 가 없다 — 목록 순서를 비트로 쓴다(script-host.js setInput 이 같은 순서로 code 를 찾음, 24개까지)
      const bit = Number.isInteger(b.bit) ? b.bit : b.code ? index : null;
      if (bit === null) continue;
      const mask = 1 << bit;
      this.bitOf.set(b.id, mask);
      if (b.role in dirs && !dirs[b.role]) dirs[b.role] = mask;
      if (b.pad?.length) this.padMap.push([mask, padTest(b.pad)]);
    }
    this.dirs = dirs;
    this.dirMask = dirs.right | dirs.left | dirs.up | dirs.down;
    this.dirBits = [dirs.right, dirs.left, dirs.up, dirs.down].filter(Boolean);
    this.dirStamp = Object.fromEntries(this.dirBits.map((bit) => [bit, 0]));
    this.padPrev = 0;
    this.setKeys(keys ?? this.keys ?? {});
  }

  /** keys = { 버튼 id: [KeyboardEvent.code…], FAST: [...] } — 지금 버튼 목록에 있는 id 만 쓴다. */
  setKeys(keys) {
    this.keys = keys;
    this.keymap = new Map();
    for (const [id, mask] of this.bitOf) {
      for (const code of keys[id] ?? []) this.keymap.set(code, mask);
    }
    for (const code of keys.FAST ?? []) this.keymap.set(code, "FAST");
    this.releaseAll();
  }

  padBits() {
    let bits = 0;
    if (!this.padMap.length) return 0;
    for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
      if (!gp) continue;
      for (const [mask, test] of this.padMap) if (!(bits & mask) && test(gp)) bits |= mask;
    }
    return bits;
  }

  setDpadMode(mode) {
    this.dpadMode = DPAD_MODES.includes(mode) ? mode : DPAD_DEFAULT;
  }

  isDown(code) {
    return this.down.has(code);
  }

  heldBits() {
    let bits = 0;
    let fast = false;
    for (const hit of this.down.values()) {
      if (hit === "FAST") fast = true;
      else bits |= hit;
    }
    this.fastHeld = fast;
    return bits;
  }

  // ② keyboard "raw" 게임은 실제 키보드(event 가 있음)를 그대로 넘긴다 — 빨리 감기 키만 호스트 몫, 터치·게임패드는 버튼으로.
  rawKey(code, event, down) {
    if (!event || !this.host?.script || !this.host.raw || this.keymap.get(code) === "FAST") return false;
    if (this.running && !this.paused) this.host.rawKey(event, down);
    return true;
  }

  keyDown(code, event = null) {
    if (this.rawKey(code, event, true)) return true;
    const hit = this.keymap.get(code);
    if (hit === undefined) return false;
    if (this.down.has(code)) return true;
    this.down.set(code, hit);
    const before = this.held;
    this.held = this.heldBits();
    if (hit !== "FAST" && !(before & hit)) {
      if (this.released & this.sent & hit) this.dropped |= hit;
      this.pressed |= hit;
      if (hit & this.dirMask) this.dirStamp[hit] = ++this.stamp;
    }
    this.pushScript();
    return true;
  }

  keyUp(code, event = null) {
    if (this.rawKey(code, event, false)) return true;
    const hit = this.down.get(code);
    if (hit === undefined) return this.keymap.has(code);
    this.down.delete(code);
    this.held = this.heldBits();
    if (hit !== "FAST" && !(this.held & hit)) this.released |= hit;
    this.pushScript();
    return true;
  }

  releaseAll() {
    this.down.clear();
    this.held = 0;
    this.fastHeld = false;
    this.pressed = 0;
    this.dropped = 0;
    this.released = 0;
    this.pointerRelease();
    this.pushScript();
  }

  /** ② 자체 JS 게임: 지금 눌린 버튼(키·터치·게임패드, 방향 동시 누름 설정 적용)과 빨리 감기 배수를 틀에 바로 넘긴다. */
  pushScript() {
    const host = this.host;
    if (!host?.script || !this.running) return;
    host.setInput(this.paused ? 0 : this.resolveDpad(this.held | this.padNow));
    host.setSpeed(this.runSpeed);
  }

  get runSpeed() {
    return this.net.locked ? 1 : this.speed;
  }

  syncAway() {
    this.net.setAway(Boolean(this.host) && (this.paused || (globalThis.document?.visibilityState === "hidden" && !this.clockOn)));
  }

  syncClock() {
    const want = this.hiddenClock && this.running && this.net.active && globalThis.document?.visibilityState === "hidden";
    if (want === this.clockOn) return;
    this.clockOn = want;
    if (want) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (!this.clock) {
        const url = URL.createObjectURL(new Blob([CLOCK_WORKER], { type: "text/javascript" }));
        this.clock = new Worker(url);
        URL.revokeObjectURL(url);
        this.clock.onmessage = () => this.clockTick();
      }
      this.last = performance.now();
      this.clock.postMessage(Math.floor(FRAME_MS));
    } else {
      this.clock?.postMessage(0);
      if (this.running) {
        cancelAnimationFrame(this.raf);
        this.last = performance.now();
        this.raf = requestAnimationFrame(this.tick);
      }
    }
    this.syncAway();
  }

  clockTick() {
    if (!this.clockOn || !this.running) return;
    if (this.host?.script) this.host.post({ type: "tick" });
    this.tick(performance.now());
  }

  notePad(bits) {
    const fresh = bits & ~this.padPrev & ~this.held & this.dirMask;
    for (const bit of this.dirBits) if (fresh & bit) this.dirStamp[bit] = ++this.stamp;
    this.padPrev = bits;
  }

  // 방향 동시 누름 처리(사용자 설정)는 role up·down·left·right 버튼에 건다(규격 5.5).
  resolveDpad(keys) {
    const dirs = this.dirMask;
    if (this.dpadMode === "both" || !(keys & dirs)) return keys;
    if (this.dpadMode === "opposite") {
      let out = keys;
      for (const [a, b] of [
        [this.dirs.right, this.dirs.left],
        [this.dirs.up, this.dirs.down],
      ]) {
        if (a && b && keys & a && keys & b) out &= ~(this.dirStamp[a] >= this.dirStamp[b] ? b : a);
      }
      return out;
    }
    let best = 0;
    for (const bit of this.dirBits) if (keys & bit && (!best || this.dirStamp[bit] > this.dirStamp[best])) best = bit;
    return (keys & ~dirs) | best;
  }

  frameKeys(padBits, first) {
    let keys = this.held | padBits;
    if (first) keys = (keys | this.pressed) & ~(this.dropped & ~padBits);
    return this.resolveDpad(keys);
  }

  // 사용자 동작(터치·키) 안에서 부르면 iOS 잠금도 풀린다. 만들기·resume 은 첫 await 앞(동작 안)에서 한다.
  async ensureAudio() {
    if (this.audio && (this.audio.stuck || this.audio.ac.state === "closed")) this.dropAudio();
    if (this.audio) {
      if (this.audio.ac.state !== "running") await this.wakeAudio(true);
      return this.audio;
    }
    let ac = null;
    try {
      this.syncAudioSession();
      ac = new AudioContext({ latencyHint: "interactive" });
      const waking = ac.state === "running" ? null : ac.resume().catch(() => {});
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await ac.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ac, "webgba-out", { outputChannelCount: [2] });
      const gain = ac.createGain();
      node.connect(gain).connect(ac.destination);
      const audio = { ac, node, gain, time: ac.currentTime, moved: performance.now(), woke: false, stuck: false };
      this.audio = audio;
      ac.addEventListener("statechange", () => this.onAudioState(audio));
      this.applyVolume();
      // ② 자체 JS 게임은 틀이 스스로 소리를 낸다(표본률을 받지 않음)
      if (this.host && !this.host.script) {
        this.host.setAudioRate(ac.sampleRate);
        node.port.postMessage("clear");
      }
      await waking;
      if (ac.state !== "running" && ac.state !== "closed") await ac.resume().catch(() => {});
    } catch (error) {
      core.log("WARN", `소리를 켜지 못했습니다: ${error}`);
      if (ac && !this.audio) ac.close().catch(() => {});
    }
    return this.audio;
  }

  // gesture: 사용자 동작 안에서 부를 때. 1표본 무음을 한 번 틀어 iOS 오디오 세션을 깨운다.
  wakeAudio(gesture = false) {
    const audio = this.audio;
    if (!audio || audio.stuck) return Promise.resolve();
    const { ac } = audio;
    if (ac.state === "running" || ac.state === "closed") return Promise.resolve();
    if (gesture) {
      if (!audio.woke) audio.moved = performance.now();
      audio.woke = true;
      try {
        const blip = ac.createBufferSource();
        blip.buffer = ac.createBuffer(1, 1, ac.sampleRate);
        blip.connect(ac.destination);
        blip.start(0);
      } catch {}
    }
    return ac.resume().catch(() => {});
  }

  onAudioState(audio) {
    const state = audio.ac.state;
    core.log("INFO", `소리 상태: ${state}`);
    if (audio !== this.audio) return;
    if (state === "running") {
      audio.woke = false;
      audio.moved = performance.now();
    } else if (state !== "closed" && globalThis.document?.visibilityState !== "hidden") {
      // iOS: 전화·다른 앱 소리 뒤 "interrupted"·"suspended" 가 된다. 동작 없이도 켜질 때가 있어 한 번 시도하고, 안 되면 다음 터치에서.
      this.wakeAudio(false);
    }
  }

  // 화면이 다시 보일 때(visibilitychange·pageshow) 부른다.
  resumeAudio() {
    if (this.audio) this.audio.moved = performance.now();
    return this.wakeAudio(false);
  }

  // iOS: running 인데 시계가 멈춰 소리가 없거나, 동작 안에서 깨웠는데도 2초 넘게 안 켜지면 다음 터치에서 새로 만든다.
  watchAudio(now, gap) {
    const audio = this.audio;
    if (!audio || audio.stuck) return;
    const { ac } = audio;
    const time = ac.currentTime;
    if (gap > 500 || (ac.state !== "running" && !audio.woke) || time !== audio.time) {
      audio.time = time;
      audio.moved = now;
    } else if (now - audio.moved > AUDIO_STALL_MS) {
      audio.stuck = true;
      core.log("WARN", `소리가 멈춰 다음 터치에서 다시 켭니다 (${ac.state})`);
    }
  }

  dropAudio() {
    const audio = this.audio;
    this.audio = null;
    if (!audio) return;
    try {
      audio.node.disconnect();
    } catch {}
    audio.ac.close().catch(() => {});
  }

  syncAudioSession() {
    setAudioSession(this.muted || this.volume <= 0 ? "ambient" : "playback");
  }

  applyVolume() {
    if (this.host?.script) this.host.setVolume(this.muted ? 0 : this.volume);
    if (!this.audio) return;
    this.audio.gain.gain.value = this.muted ? 0 : this.volume;
    this.syncAudioSession();
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }

  setMuted(muted) {
    this.muted = muted;
    this.applyVolume();
  }

  async start({ host, saveId, game, net = null }) {
    await this.stop();
    this.host = host;
    this.net.attach(host, net ?? {});
    this.saveId = saveId;
    this.game = game;
    this.saveBase = host.saveData();
    host.takeSaveDirty();
    this.savePending = false;
    this.paused = false;
    this.ptr = { x: -1, y: -1, buttons: 0, wheel: 0, block: false };
    this.releaseAll();
    this.sent = 0;
    this.padPrev = 0;
    this.padNow = 0;
    this.pace = { speed: 1, emu: 0, real: 0 };
    if (host.script) {
      // ② 자체 JS: 게임이 틀 안에서 스스로 그리고 소리를 낸다. 여기서는 입력·세이브·일시정지·소리 크기만.
      host.onHalt = (why) => {
        this.running = false;
        this.onHalt(why);
      };
      host.onStats = ({ fps }) => this.onStats({ fps, speed: this.runSpeed });
      host.onChange = () => this.onChange();
      host.setVolume(this.muted ? 0 : this.volume);
    } else {
      this.fitScreen(host.width ?? SCREEN_W, host.height ?? SCREEN_H);
      const audio = await this.ensureAudio();
      if (audio) {
        host.setAudioRate(audio.ac.sampleRate);
        audio.node.port.postMessage("clear");
      }
    }
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.frames = 0;
    this.statAt = this.last;
    this.raf = requestAnimationFrame(this.tick);
    this.pushScript();
    this.syncAway();
  }

  async stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.running = false;
    this.net.detach();
    this.syncClock();
    if (this.host?.script) await this.host.flush();
    if (this.host) await this.flushSave({ final: true });
    this.host?.dispose?.();
    this.host = null;
    this.ptr = { x: -1, y: -1, buttons: 0, wheel: 0, block: false };
    this.saveId = "";
    this.game = "";
    this.saveBase = null;
    this.audio?.node.port.postMessage("clear");
  }

  setPaused(paused) {
    if (!this.host) return;
    this.paused = paused;
    this.pressed = 0;
    this.dropped = 0;
    this.released = 0;
    this.pointerRelease();
    if (paused) this.audio?.node.port.postMessage("clear");
    this.last = performance.now();
    this.acc = 0;
    this.syncAway();
    if (this.host.script) {
      // 틀은 requestAnimationFrame 을 붙잡고 소리를 멈춘다(게임이 pause 이벤트를 무시해도 화면·소리가 선다)
      if (paused) this.host.setInput(0);
      this.host.setPaused(paused);
      this.pushScript();
    }
    if (paused && this.savePending) this.flushSave();
  }

  setFast(fast) {
    this.fast = fast;
    this.pushScript();
  }

  get speed() {
    return this.fast || this.fastHeld ? this.fastScale : 1;
  }

  audioFactor(speed) {
    const pace = this.pace;
    if (pace.speed !== speed) {
      pace.speed = speed;
      pace.emu = speed * FRAME_MS * 8;
      pace.real = FRAME_MS * 8;
      this.squeeze = { at: 0, l: 0, r: 0, n: 0 };
      this.audio?.node.port.postMessage({ trim: 0.04 });
    }
    if (speed <= 1) return 1;
    const live = pace.emu / Math.max(pace.real, 1);
    return live >= speed * 0.94 ? speed : Math.max(1, Math.min(speed, live));
  }

  notePace(ran, dt) {
    const pace = this.pace;
    pace.emu = pace.emu * 0.92 + ran * FRAME_MS;
    pace.real = pace.real * 0.92 + dt;
  }

  playAudio(samples, factor) {
    const port = this.audio.node.port;
    if (factor <= 1) {
      port.postMessage(samples, [samples.buffer]);
      return;
    }
    if (this.fastMute) return;
    const s = this.squeeze;
    const out = new Float32Array(Math.ceil(samples.length / 2 / factor + 1) * 2);
    let o = 0;
    for (let i = 0; i < samples.length; i += 2) {
      s.l += samples[i];
      s.r += samples[i + 1];
      s.n++;
      s.at++;
      if (s.at >= factor) {
        out[o++] = s.l / s.n;
        out[o++] = s.r / s.n;
        s.at -= factor;
        s.l = 0;
        s.r = 0;
        s.n = 0;
      }
    }
    if (o) port.postMessage(out.subarray(0, o), [out.buffer]);
  }

  audioFill() {
    if (!this.audio) return Promise.resolve(null);
    const port = this.audio.node.port;
    return new Promise((resolve) => {
      let timer = 0;
      const on = (event) => {
        if (typeof event.data?.fill !== "number") return;
        done(event.data.fill);
      };
      const done = (value) => {
        port.removeEventListener("message", on);
        clearTimeout(timer);
        resolve(value);
      };
      timer = setTimeout(() => done(null), 500);
      port.addEventListener("message", on);
      port.start();
      port.postMessage("fill");
    });
  }

  tick(now) {
    if (!this.running) return;
    if (!this.clockOn) this.raf = requestAnimationFrame(this.tick);
    this.watchAudio(now, now - this.last);
    const dt = Math.min(now - this.last, 100);
    this.last = now;
    if (this.paused) return;
    if (this.host.script) {
      // ② 는 게임이 스스로 돈다 — 게임패드만 읽어 바뀐 버튼을 넘기고, 세이브가 오면 모아 쓴다(프레임 수는 틀이 셈)
      const padBits = this.padBits();
      this.notePad(padBits);
      this.padNow = padBits;
      this.pushScript();
      if (this.host.takeSaveDirty()) this.queueSave();
      return;
    }
    const speed = this.runSpeed;
    this.acc += dt * speed;
    const padBits = this.padBits();
    this.notePad(padBits);
    const squeeze = this.audioFactor(speed);
    let ran = 0;
    while (this.acc >= FRAME_MS && ran < MAX_FRAMES_PER_TICK) {
      this.acc -= FRAME_MS;
      const input = this.frameKeys(padBits, ran === 0);
      if (ran === 0) {
        this.pressed = 0;
        this.dropped = 0;
        this.released = 0;
      }
      this.sent = input;
      this.net.beforeFrame();
      if (!this.host.runFrame(input)) {
        this.running = false;
        this.net.leave();
        this.onHalt(this.host.halted);
        return;
      }
      this.net.afterFrame();
      ran++;
      const samples = this.host.audio();
      if (samples && this.audio) this.playAudio(samples, squeeze);
      if (this.host.takeSaveDirty()) this.queueSave();
    }
    this.notePace(ran, dt);
    if (this.acc > FRAME_MS * MAX_FRAMES_PER_TICK) this.acc = 0;
    if (ran) {
      this.image.data.set(this.host.framebuffer());
      this.ctx.putImageData(this.image, 0, 0);
      this.frames += ran;
    }
    if (now - this.statAt >= 1000) {
      this.onStats({ fps: (this.frames * 1000) / (now - this.statAt), speed });
      this.frames = 0;
      this.statAt = now;
    }
  }

  queueSave() {
    this.savePending = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DELAY_MS);
  }

  async flushSave({ final = false } = {}) {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (!this.host || !this.game || !(this.savePending || final)) return;
    const data = this.host.saveData();
    if (!data || !data.length || (!this.savePending && sameBytes(data, this.saveBase))) {
      this.savePending = false;
      return;
    }
    this.savePending = false;
    try {
      const done = await core.saveWrite(this.game, data);
      this.saveBase = data;
      if (done.action === "written") this.onStatus(t("status.saveWritten", { name: baseOf(done.path), time: new Date().toLocaleTimeString(locale(), { hour12: false }) }));
    } catch (error) {
      this.savePending = true;
      this.onStatus(t("status.saveWriteFailed", { reason: String(error?.message ?? error) }), "error");
    }
  }

  get canState() {
    return Boolean(this.host?.canState);
  }

  async saveState(slot) {
    if (!this.canState) return false;
    // ② 는 틀에 물어 받는다(비동기) — 그 순간 틀 화면 사진을 this.image 로(웹 퀵슬롯 칸 그림)
    const bytes = this.host.script ? await this.host.stateSave() : this.host.stateSave();
    if (!bytes) return false;
    if (this.host?.script && this.host.thumb) this.image = this.host.thumb;
    await core.storeWrite(this.saveId, slot, bytes);
    return true;
  }

  async loadState(slot) {
    if (!this.canState || this.net.locked) return false;
    const bytes = await core.storeRead(this.saveId, slot);
    if (!bytes.length) return null;
    if (this.host.script) return this.host.stateLoad(bytes);
    const ok = this.host.stateLoad(bytes);
    if (ok) {
      this.audio?.node.port.postMessage("clear");
      this.image.data.set(this.host.framebuffer());
      this.ctx.putImageData(this.image, 0, 0);
    }
    return ok;
  }

  async reset() {
    if (!this.host || this.net.locked) return false;
    if (this.host.script) await this.host.flush();
    await this.flushSave();
    const ok = await this.host.reset();
    this.net.resetGame();
    this.audio?.node.port.postMessage("clear");
    this.acc = 0;
    if (!ok) {
      this.running = false;
      this.onHalt(this.host.halted);
    }
    return ok;
  }
}
