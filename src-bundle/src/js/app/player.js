import { core } from "../bridge.js";
import { SCREEN_H, SCREEN_W } from "../core/web-host.js";
import { locale, t } from "../shell/i18n.js";

export const FRAME_MS = (280896 / 16777216) * 1000;
const MAX_FRAMES_PER_TICK = 8;
const SAVE_DELAY_MS = 1000;

const baseOf = (path) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const BUTTONS = ["A", "B", "SELECT", "START", "RIGHT", "LEFT", "UP", "DOWN", "R", "L"];

export const DPAD_MODES = ["both", "opposite", "latest"];

export const DPAD_DEFAULT = "latest";

const RIGHT = 16;
const LEFT = 32;
const UP = 64;
const DOWN = 128;
const DIRS = RIGHT | LEFT | UP | DOWN;
const DIR_BITS = [RIGHT, LEFT, UP, DOWN];

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
  A: ["KeyX", "KeyK"],
  B: ["KeyZ", "KeyJ"],
  SELECT: ["Backspace", "ShiftRight"],
  START: ["Enter", "NumpadEnter"],
  RIGHT: ["ArrowRight"],
  LEFT: ["ArrowLeft"],
  UP: ["ArrowUp"],
  DOWN: ["ArrowDown"],
  R: ["KeyS"],
  L: ["KeyA"],
  FAST: ["Space"],
};

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

function pad() {
  let bits = 0;
  for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (!gp) continue;
    const b = (i) => gp.buttons[i]?.pressed;
    if (b(0)) bits |= 1;
    if (b(1)) bits |= 2;
    if (b(8)) bits |= 4;
    if (b(9)) bits |= 8;
    if (b(15) || gp.axes[0] > 0.5) bits |= 16;
    if (b(14) || gp.axes[0] < -0.5) bits |= 32;
    if (b(12) || gp.axes[1] < -0.5) bits |= 64;
    if (b(13) || gp.axes[1] > 0.5) bits |= 128;
    if (b(5) || b(7)) bits |= 256;
    if (b(4) || b(6)) bits |= 512;
  }
  return bits;
}

export class Player {
  constructor({ canvas, onStatus, onStats, onHalt }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.image = this.ctx.createImageData(SCREEN_W, SCREEN_H);
    this.onStatus = onStatus ?? (() => {});
    this.onStats = onStats ?? (() => {});
    this.onHalt = onHalt ?? (() => {});
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
    this.dirStamp = { [RIGHT]: 0, [LEFT]: 0, [UP]: 0, [DOWN]: 0 };
    this.keymap = new Map();
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
    this.tick = this.tick.bind(this);
    this.setKeys(DEFAULT_KEYS);
  }

  get active() {
    return Boolean(this.host);
  }

  setKeys(keys) {
    this.keys = keys;
    this.keymap = new Map();
    BUTTONS.forEach((name, bit) => {
      for (const code of keys[name] ?? []) this.keymap.set(code, 1 << bit);
    });
    for (const code of keys.FAST ?? []) this.keymap.set(code, "FAST");
    this.releaseAll();
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

  keyDown(code) {
    const hit = this.keymap.get(code);
    if (hit === undefined) return false;
    if (this.down.has(code)) return true;
    this.down.set(code, hit);
    const before = this.held;
    this.held = this.heldBits();
    if (hit !== "FAST" && !(before & hit)) {
      if (this.released & this.sent & hit) this.dropped |= hit;
      this.pressed |= hit;
      if (hit & DIRS) this.dirStamp[hit] = ++this.stamp;
    }
    return true;
  }

  keyUp(code) {
    const hit = this.down.get(code);
    if (hit === undefined) return this.keymap.has(code);
    this.down.delete(code);
    this.held = this.heldBits();
    if (hit !== "FAST" && !(this.held & hit)) this.released |= hit;
    return true;
  }

  releaseAll() {
    this.down.clear();
    this.held = 0;
    this.fastHeld = false;
    this.pressed = 0;
    this.dropped = 0;
    this.released = 0;
  }

  notePad(bits) {
    const fresh = bits & ~this.padPrev & ~this.held & DIRS;
    for (const bit of DIR_BITS) if (fresh & bit) this.dirStamp[bit] = ++this.stamp;
    this.padPrev = bits;
  }

  resolveDpad(keys) {
    if (this.dpadMode === "both" || !(keys & DIRS)) return keys;
    if (this.dpadMode === "opposite") {
      let out = keys;
      for (const [a, b] of [
        [RIGHT, LEFT],
        [UP, DOWN],
      ]) {
        if (keys & a && keys & b) out &= ~(this.dirStamp[a] >= this.dirStamp[b] ? b : a);
      }
      return out;
    }
    let best = 0;
    for (const bit of DIR_BITS) if (keys & bit && (!best || this.dirStamp[bit] > this.dirStamp[best])) best = bit;
    return (keys & ~DIRS) | best;
  }

  frameKeys(padBits, first) {
    let keys = this.held | padBits;
    if (first) keys = (keys | this.pressed) & ~(this.dropped & ~padBits);
    return this.resolveDpad(keys);
  }

  async ensureAudio() {
    if (this.audio) {
      if (this.audio.ac.state === "suspended") await this.audio.ac.resume().catch(() => {});
      return this.audio;
    }
    try {
      const ac = new AudioContext({ latencyHint: "interactive" });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await ac.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ac, "webgba-out", { outputChannelCount: [2] });
      const gain = ac.createGain();
      node.connect(gain).connect(ac.destination);
      this.audio = { ac, node, gain };
      this.applyVolume();
      if (ac.state === "suspended") await ac.resume().catch(() => {});
    } catch (error) {
      core.log("WARN", `소리를 켜지 못했습니다: ${error}`);
      this.audio = null;
    }
    return this.audio;
  }

  applyVolume() {
    if (this.audio) this.audio.gain.gain.value = this.muted ? 0 : this.volume;
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }

  setMuted(muted) {
    this.muted = muted;
    this.applyVolume();
  }

  async start({ host, saveId, game }) {
    await this.stop();
    this.host = host;
    this.saveId = saveId;
    this.game = game;
    this.saveBase = host.saveData();
    host.takeSaveDirty();
    this.savePending = false;
    this.paused = false;
    this.releaseAll();
    this.sent = 0;
    this.padPrev = 0;
    this.pace = { speed: 1, emu: 0, real: 0 };
    const audio = await this.ensureAudio();
    if (audio) {
      host.setAudioRate(audio.ac.sampleRate);
      audio.node.port.postMessage("clear");
    }
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.frames = 0;
    this.statAt = this.last;
    this.raf = requestAnimationFrame(this.tick);
  }

  async stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.running = false;
    if (this.host) await this.flushSave({ final: true });
    this.host = null;
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
    if (paused) this.audio?.node.port.postMessage("clear");
    this.last = performance.now();
    this.acc = 0;
    if (paused && this.savePending) this.flushSave();
  }

  setFast(fast) {
    this.fast = fast;
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
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(now - this.last, 100);
    this.last = now;
    if (this.paused) return;
    const speed = this.speed;
    this.acc += dt * speed;
    const padBits = pad();
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
      if (!this.host.runFrame(input)) {
        this.running = false;
        this.onHalt(this.host.halted);
        return;
      }
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
    const bytes = this.host.stateSave();
    if (!bytes) return false;
    await core.storeWrite(this.saveId, slot, bytes);
    return true;
  }

  async loadState(slot) {
    if (!this.canState) return false;
    const bytes = await core.storeRead(this.saveId, slot);
    if (!bytes.length) return null;
    const ok = this.host.stateLoad(bytes);
    if (ok) {
      this.audio?.node.port.postMessage("clear");
      this.image.data.set(this.host.framebuffer());
      this.ctx.putImageData(this.image, 0, 0);
    }
    return ok;
  }

  async reset() {
    if (!this.host) return false;
    await this.flushSave();
    const ok = await this.host.reset();
    this.audio?.node.port.postMessage("clear");
    this.acc = 0;
    if (!ok) {
      this.running = false;
      this.onHalt(this.host.halted);
    }
    return ok;
  }
}
