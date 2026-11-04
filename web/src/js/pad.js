export const PAD_KEYS = ["A", "B", "L", "R", "START", "SELECT"];
export const DIRS = ["UP", "DOWN", "LEFT", "RIGHT"];
export const DIR_MODES = ["stick", "dpad"];

export const STICK_DEAD = 0.25;
export const STICK_DIAGONAL_DEG = 30;
const DPAD_DEAD = 0.2;
const DPAD_REACH = 1.4;
const STICK_REACH = 1.55;
const KEY_MARGIN = 0.4;
const KEY_MARGIN_MAX = 40;
export const COMBO_KEYS = ["A", "B"];
export const COMBO_INTO = 0.25;

export const BUZZ_MS = 12;
export const DIR_HOLD_MS = 40;
export const DIR_GAP_MS = 100;
const SWITCH_HAPTIC_FROM = [18, 0];
const SWITCH_HAPTIC_UNTIL = [26, 4];

const newer = (a, b) => a[0] - b[0] || a[1] - b[1];

function iosVersion(ua) {
  const safari = /Version\/(\d+)(?:\.(\d+))?/.exec(ua);
  const os = /OS (\d+)_(\d+)/.exec(ua);
  const read = (m) => [Number(m[1]), Number(m[2] ?? 0)];
  if (safari && Number(safari[1]) >= 18) return read(safari);
  if (os && !(Number(os[1]) === 18 && Number(os[2]) === 6)) return read(os);
  return null;
}

export function hapticKind(nav = navigator, win = window) {
  const coarse = win.matchMedia?.("(pointer: coarse)").matches;
  if (!coarse) return "";
  if (typeof nav.vibrate === "function") return "vibrate";
  const ua = nav.userAgent ?? "";
  if (!/iPhone/.test(ua) || !("switch" in win.HTMLInputElement.prototype)) return "";
  const version = iosVersion(ua);
  return version && newer(version, SWITCH_HAPTIC_FROM) >= 0 && newer(version, SWITCH_HAPTIC_UNTIL) <= 0 ? "switch" : "";
}

export function buzz(kind) {
  try {
    if (kind === "vibrate") navigator.vibrate(BUZZ_MS);
    if (kind !== "switch") return;
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.append(input);
    document.head.append(label);
    label.click();
    label.remove();
  } catch {}
}

const SECTORS_8 = [["RIGHT"], ["RIGHT", "DOWN"], ["DOWN"], ["DOWN", "LEFT"], ["LEFT"], ["LEFT", "UP"], ["UP"], ["UP", "RIGHT"]];
const SECTORS_4 = [["RIGHT"], ["DOWN"], ["LEFT"], ["UP"]];

export function stickDirs(dx, dy, radius) {
  const dist = Math.hypot(dx, dy);
  if (dist < radius * STICK_DEAD) return [];
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const half = STICK_DIAGONAL_DEG / 2;
  const nearest = Math.round(deg / 45) % 8;
  const off = Math.abs(((deg - nearest * 45 + 540) % 360) - 180);
  if (nearest % 2 === 1 && off <= half) return SECTORS_8[nearest];
  const cardinal = Math.round(deg / 90) % 4;
  return SECTORS_4[cardinal];
}

export function comboZone(pair) {
  if (pair.length !== 2 || !pair.every(Boolean)) return null;
  const [a, b] = pair.map(({ box }) => ({ x: box.left + box.width / 2, y: box.top + box.width / 2, r: box.width / 2 }));
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist < 1) return null;
  const small = Math.min(a.r, b.r);
  return { a, b, ux: (b.x - a.x) / dist, uy: (b.y - a.y) / dist, reach: Math.max(0, dist - a.r - b.r) + small * COMBO_INTO, side: small };
}

export function comboHit(zone, x, y) {
  const { a, b } = zone;
  if (Math.hypot(x - a.x, y - a.y) - a.r > zone.reach || Math.hypot(x - b.x, y - b.y) - b.r > zone.reach) return false;
  return Math.abs((y - a.y) * zone.ux - (x - a.x) * zone.uy) <= zone.side;
}

export class VirtualPad {
  constructor({ root, onChange, onVisual, onStick, diagonal = () => false, combo = () => false, vibrate = () => "", vibrateDir = () => "" }) {
    this.root = root;
    this.onChange = onChange;
    this.onVisual = onVisual ?? (() => {});
    this.onStick = onStick ?? (() => {});
    this.diagonal = diagonal;
    this.combo = combo;
    this.vibrate = vibrate;
    this.vibrateDir = vibrateDir;
    this.mode = "stick";
    this.pointers = new Map();
    this.touches = new Map();
    this.touchSeen = false;
    this.touchCount = 0;
    this.down = new Set();
    this.dirMask = 0;
    this.dirSince = -Infinity;
    this.dirBuzzAt = -Infinity;
    this.rects = null;
    this.enabled = true;
    this.handle = this.handle.bind(this);
    this.onTouch = this.onTouch.bind(this);
    root.addEventListener("pointerdown", (event) => this.start(event));
    window.addEventListener("pointermove", this.handle, { passive: false });
    window.addEventListener("pointerup", this.handle);
    window.addEventListener("pointercancel", this.handle);
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) root.addEventListener(type, this.onTouch, { passive: false });
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) root.addEventListener(type, (event) => event.preventDefault(), { passive: false });
    root.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("blur", () => this.releaseAll());
  }

  fingers() {
    const out = [];
    for (const [id, entry] of this.touches) out.push({ src: "touch", id, ...entry });
    for (const [id, entry] of this.pointers) out.push({ src: "pointer", id, ...entry });
    return out;
  }

  ownerAt(x, y) {
    const stickBusy = [...this.pointers.values(), ...this.touches.values()].some((entry) => entry.owner === "stick");
    const onKey = this.keyAt(x, y, true).length > 0 || this.inCombo(x, y);
    return this.mode === "stick" && !stickBusy && !onKey && this.inDir(x, y) ? "stick" : "keys";
  }

  onTouch(event) {
    if (!this.touchSeen) for (const [id, entry] of this.pointers) if (entry.touch) this.pointers.delete(id);
    this.touchSeen = true;
    if (event.cancelable) event.preventDefault();
    const live = new Map();
    for (const touch of event.touches) live.set(touch.identifier, touch);
    this.touchCount = live.size;
    if (event.type === "touchstart" && this.enabled) {
      for (const touch of event.changedTouches) {
        if (this.touches.has(touch.identifier) || !live.has(touch.identifier) || !this.root.contains(touch.target)) continue;
        this.touches.set(touch.identifier, { owner: this.ownerAt(touch.clientX, touch.clientY), keys: [], x: NaN, y: NaN });
      }
    }
    let stickLeft = false;
    for (const [id, entry] of this.touches) {
      const touch = live.get(id);
      if (!touch) {
        this.touches.delete(id);
        if (entry.owner === "stick") stickLeft = true;
        continue;
      }
      if (touch.clientX === entry.x && touch.clientY === entry.y) continue;
      entry.x = touch.clientX;
      entry.y = touch.clientY;
      entry.keys = this.hit(entry.x, entry.y, entry.owner);
    }
    if (stickLeft) this.onStick(0, 0, false);
    this.commit();
  }

  setMode(mode) {
    const next = DIR_MODES.includes(mode) ? mode : "stick";
    if (next === this.mode) return;
    this.releaseAll();
    this.mode = next;
    this.invalidate();
  }

  measure() {
    const rects = { keys: [], dir: null };
    for (const node of this.root.querySelectorAll("[data-key]")) {
      const box = node.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      const margin = Math.min(KEY_MARGIN_MAX, Math.min(box.width, box.height) * KEY_MARGIN);
      rects.keys.push({ name: node.dataset.key, box, margin, cx: box.left + box.width / 2, cy: box.top + box.height / 2 });
    }
    const dir = this.root.querySelector("[data-dpad]");
    if (dir) {
      const box = dir.getBoundingClientRect();
      if (box.width >= 1) rects.dir = { cx: box.left + box.width / 2, cy: box.top + box.height / 2, r: Math.min(box.width, box.height) / 2 };
    }
    rects.combo = comboZone(COMBO_KEYS.map((name) => rects.keys.find((key) => key.name === name)));
    this.rects = rects;
    return rects;
  }

  inCombo(x, y) {
    const zone = (this.rects ?? this.measure()).combo;
    return Boolean(zone) && this.combo() && comboHit(zone, x, y);
  }

  invalidate() {
    this.rects = null;
  }

  inDir(x, y) {
    const d = (this.rects ?? this.measure()).dir;
    if (!d) return false;
    return Math.hypot(x - d.cx, y - d.cy) <= d.r * (this.mode === "stick" ? STICK_REACH : DPAD_REACH);
  }

  dpadDirs(x, y) {
    const d = (this.rects ?? this.measure()).dir;
    const dx = x - d.cx;
    const dy = y - d.cy;
    if (Math.hypot(dx, dy) < d.r * DPAD_DEAD) return [];
    const sectors = this.diagonal() ? SECTORS_8 : SECTORS_4;
    const step = (Math.PI * 2) / sectors.length;
    const index = Math.round(Math.atan2(dy, dx) / step);
    return sectors[((index % sectors.length) + sectors.length) % sectors.length];
  }

  stick(x, y) {
    const d = (this.rects ?? this.measure()).dir;
    const dx = x - d.cx;
    const dy = y - d.cy;
    const dist = Math.hypot(dx, dy);
    const scale = dist > d.r ? d.r / dist : 1;
    this.onStick((dx * scale) / d.r, (dy * scale) / d.r, true);
    return stickDirs(dx, dy, d.r);
  }

  keyAt(x, y, exact = false) {
    const rects = this.rects ?? this.measure();
    let best = null;
    let bestDist = Infinity;
    for (const key of rects.keys) {
      const b = key.box;
      const m = exact ? 0 : key.margin;
      if (x < b.left - m || x > b.right + m || y < b.top - m || y > b.bottom + m) continue;
      const dist = Math.hypot(x - key.cx, y - key.cy);
      if (dist < bestDist) {
        best = key.name;
        bestDist = dist;
      }
    }
    return best ? [best] : [];
  }

  hit(x, y, owner) {
    if (owner === "stick") return this.stick(x, y);
    if (this.inCombo(x, y)) return COMBO_KEYS;
    const exact = this.keyAt(x, y, true);
    if (exact.length) return exact;
    if (this.mode === "dpad" && this.inDir(x, y)) return this.dpadDirs(x, y);
    return this.keyAt(x, y);
  }

  start(event) {
    if (!this.enabled) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    if (event.pointerType === "touch" && this.touchSeen) return;
    this.pointers.set(event.pointerId, { owner: this.ownerAt(event.clientX, event.clientY), keys: [], x: event.clientX, y: event.clientY, touch: event.pointerType === "touch" });
    this.track(event);
  }

  handle(event) {
    const entry = this.pointers.get(event.pointerId);
    if (!entry) return;
    if (event.type === "pointerup" || event.type === "pointercancel") {
      this.pointers.delete(event.pointerId);
      if (entry.owner === "stick") this.onStick(0, 0, false);
      this.commit();
      return;
    }
    if (event.cancelable) event.preventDefault();
    this.track(event);
  }

  track(event) {
    const entry = this.pointers.get(event.pointerId);
    entry.x = event.clientX;
    entry.y = event.clientY;
    entry.keys = this.hit(entry.x, entry.y, entry.owner);
    this.commit();
  }

  commit() {
    const next = new Set();
    for (const entry of this.pointers.values()) for (const name of entry.keys) next.add(name);
    for (const entry of this.touches.values()) for (const name of entry.keys) next.add(name);
    for (const name of this.down) {
      if (!next.has(name)) {
        this.onChange(name, false);
        this.onVisual(name, false);
      }
    }
    let pressed = false;
    for (const name of next) {
      if (!this.down.has(name)) {
        this.onChange(name, true);
        this.onVisual(name, true);
        if (!DIRS.includes(name)) pressed = true;
      }
    }
    this.down = next;
    let mask = 0;
    for (let i = 0; i < DIRS.length; i++) if (next.has(DIRS[i])) mask |= 1 << i;
    let dirKind = "";
    if (mask !== this.dirMask) {
      const now = performance.now();
      if (mask && now - this.dirSince >= DIR_HOLD_MS && now - this.dirBuzzAt >= DIR_GAP_MS) dirKind = this.vibrateDir();
      if (dirKind) this.dirBuzzAt = now;
      this.dirMask = mask;
      this.dirSince = now;
    }
    const kind = (pressed && this.vibrate()) || dirKind;
    if (kind) buzz(kind);
  }

  releaseAll() {
    const hadStick = [...this.pointers.values(), ...this.touches.values()].some((entry) => entry.owner === "stick");
    this.pointers.clear();
    this.touches.clear();
    if (hadStick) this.onStick(0, 0, false);
    this.commit();
  }
}
