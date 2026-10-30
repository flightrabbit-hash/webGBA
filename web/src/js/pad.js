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

export class VirtualPad {
  constructor({ root, onChange, onVisual, onStick, diagonal = () => false, vibrate = () => false }) {
    this.root = root;
    this.onChange = onChange;
    this.onVisual = onVisual ?? (() => {});
    this.onStick = onStick ?? (() => {});
    this.diagonal = diagonal;
    this.vibrate = vibrate;
    this.mode = "stick";
    this.pointers = new Map();
    this.down = new Set();
    this.rects = null;
    this.enabled = true;
    this.handle = this.handle.bind(this);
    root.addEventListener("pointerdown", (event) => this.start(event));
    window.addEventListener("pointermove", this.handle, { passive: false });
    window.addEventListener("pointerup", this.handle);
    window.addEventListener("pointercancel", this.handle);
    root.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
    root.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("blur", () => this.releaseAll());
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
    this.rects = rects;
    return rects;
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
    const exact = this.keyAt(x, y, true);
    if (exact.length) return exact;
    if (this.mode === "dpad" && this.inDir(x, y)) return this.dpadDirs(x, y);
    return this.keyAt(x, y);
  }

  start(event) {
    if (!this.enabled) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const stickBusy = [...this.pointers.values()].some((entry) => entry.owner === "stick");
    const onKey = this.keyAt(event.clientX, event.clientY, true).length > 0;
    const owner = this.mode === "stick" && !stickBusy && !onKey && this.inDir(event.clientX, event.clientY) ? "stick" : "keys";
    this.pointers.set(event.pointerId, { owner, keys: [] });
    this.track(event);
  }

  handle(event) {
    const entry = this.pointers.get(event.pointerId);
    if (!entry) return;
    if (event.type === "pointerup" || event.type === "pointercancel") {
      this.pointers.delete(event.pointerId);
      if (entry.owner === "stick") this.onStick(0, 0, false);
      this.commit([]);
      return;
    }
    if (event.cancelable) event.preventDefault();
    this.track(event);
  }

  track(event) {
    const entry = this.pointers.get(event.pointerId);
    const keys = this.hit(event.clientX, event.clientY, entry.owner);
    const before = entry.keys;
    entry.keys = keys;
    this.commit(keys.filter((name) => !before.includes(name)));
  }

  commit(fresh) {
    const next = new Set();
    for (const entry of this.pointers.values()) for (const name of entry.keys) next.add(name);
    for (const name of this.down) {
      if (!next.has(name)) {
        this.onChange(name, false);
        this.onVisual(name, false);
      }
    }
    for (const name of next) {
      if (!this.down.has(name)) {
        this.onChange(name, true);
        this.onVisual(name, true);
      }
    }
    this.down = next;
    if (fresh.length && this.vibrate()) {
      try {
        navigator.vibrate?.(12);
      } catch {}
    }
  }

  releaseAll() {
    const hadStick = [...this.pointers.values()].some((entry) => entry.owner === "stick");
    this.pointers.clear();
    if (hadStick) this.onStick(0, 0, false);
    this.commit([]);
  }
}
