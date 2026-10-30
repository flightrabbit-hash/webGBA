import * as PX from "./pixel-ui.js";

const TOOL_ICONS = {
  btnOpen: () => "open",
  btnLibrary: () => "games",
  btnSaves: () => "saves",
  btnFast: (s) => (s.fast ? "fastForwardOn" : "fastForwardOff"),
  btnSound: (s) => (s.muted ? "soundOff" : "soundOn"),
  btnSettings: () => "settings",
  btnFull: (s) => (s.full ? "fullscreenExit" : "fullscreenEnter"),
};

const KEY_PARTS = { A: "a", B: "b", L: "l", R: "r", START: "start", SELECT: "select" };
const STICK_NAMES = { RIGHT: "right", LEFT: "left", UP: "up", DOWN: "down" };

const MENU_ART = [
  "..............",
  ".############.",
  ".#WWWWWWWWWW#.",
  ".#LLLLLLLLLL#.",
  ".############.",
  "..............",
  ".############.",
  ".#WWWWWWWWWW#.",
  ".#LLLLLLLLLL#.",
  ".############.",
  "..............",
  ".############.",
  ".#WWWWWWWWWW#.",
  ".#LLLLLLLLLL#.",
  ".############.",
];
const MENU_ROLES = { "#": "iconOutline", W: "icW", L: "icL" };

function hexOf(value) {
  const text = String(value).trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) return `#${[...text.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(text);
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("")}`;
  return "";
}

function mix(a, b, t) {
  const x = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const y = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

export function baseColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => hexOf(style.getPropertyValue(name)) || fallback;
  const bg = read("--bg-sunken", "#070a14");
  const raised = read("--bg-raised", "#151d33");
  const text = read("--text", "#eef1f8");
  const accent = read("--accent", "#6c93ff");
  const line = read("--line-strong", "#3a4670");
  const light = document.documentElement.dataset.tone === "light";
  return light
    ? { body: mix(bg, "#000000", 0.08), button: mix(raised, "#000000", 0.1), accent, ink: text, outline: mix(text, line, 0.35) }
    : { body: mix(bg, "#ffffff", 0.24), button: mix(raised, "#ffffff", 0.12), accent, ink: text, outline: mix(bg, "#000000", 0.6) };
}

export class Skin {
  constructor({ pad, dpad }) {
    this.pad = pad;
    this.dpad = dpad;
    this.palette = PX.paletteOf(baseColors());
    this.dpr = 1;
    this.art = 4;
    this.icon = 2;
    this.mode = "stick";
    this.down = new Set();
    this.stickState = { x: 0, y: 0, active: false, dirs: [] };
    this.tools = new Map();
    this.canvases = new Map();
  }

  refreshColors() {
    this.palette = PX.paletteOf(baseColors());
    this.redraw();
  }

  px(css) {
    return Math.max(1, Math.round(css * this.dpr));
  }

  canvasFor(host) {
    let canvas = this.canvases.get(host);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "px";
      host.replaceChildren(canvas);
      this.canvases.set(host, canvas);
    }
    return canvas;
  }

  paint(host, render, { minW = 0, minH = 0, inkOn = "", inkFrom = null } = {}) {
    const canvas = this.canvasFor(host);
    const w = Math.max(render.width, minW);
    const h = Math.max(render.height, minH);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(render.canvas, Math.floor((w - render.width) / 2), Math.floor((h - render.height) / 2));
    const cssW = `${w / this.dpr}px`;
    const cssH = `${h / this.dpr}px`;
    canvas.style.width = cssW;
    canvas.style.height = cssH;
    host.style.width = cssW;
    host.style.height = cssH;
    canvas.style.translate = "";
    if (inkOn) {
      const shift = this.inkOffset(inkFrom ?? render, inkOn);
      if (shift) canvas.style.translate = `0 ${shift / this.dpr}px`;
    }
    return canvas;
  }

  inkOffset(render, background) {
    this.inkCache ??= new WeakMap();
    const cached = this.inkCache.get(render.canvas);
    if (cached && cached.bg === background) return cached.shift;
    const { width, height } = render.canvas;
    const data = render.canvas.getContext("2d").getImageData(0, 0, width, height).data;
    const bg = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16));
    let first = -1;
    let last = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const a = data[o + 3] / 255;
        if (!a) continue;
        const diff = Math.max(...[0, 1, 2].map((c) => Math.abs(data[o + c] * a + bg[c] * (1 - a) - bg[c])));
        if (diff > 48) {
          if (first < 0) first = y;
          last = y;
          break;
        }
      }
    }
    const shift = first < 0 ? 0 : Math.floor((height - 1 - last - first) / 2);
    this.inkCache.set(render.canvas, { bg: background, shift });
    return shift;
  }

  resize({ art, icon, dpr }) {
    this.art = art;
    this.icon = icon;
    this.dpr = dpr;
    this.redraw();
  }

  setMode(mode) {
    this.mode = mode;
    this.drawDir();
  }

  redraw() {
    for (const name of Object.keys(KEY_PARTS)) this.drawKey(name);
    this.drawDir();
    for (const [node, info] of this.tools) this.drawTool(node, info);
  }

  scaleOf(css) {
    return this.px(css);
  }

  drawKey(name) {
    const host = this.pad.querySelector(`[data-key="${name}"]`);
    if (!host) return;
    const state = this.down.has(name) ? "pressed" : "normal";
    const part = KEY_PARTS[name];
    this.paint(host, PX.renderGameButton(part, { label: name, side: name, state, scale: this.scaleOf(this.art), palette: this.palette }));
  }

  drawDir() {
    const scale = this.scaleOf(this.art);
    if (this.mode === "dpad") {
      const pressed = [...this.down].filter((name) => STICK_NAMES[name]).map((name) => STICK_NAMES[name]);
      this.paint(this.dpad, PX.renderDpad({ pressed: pressed.length ? pressed : "none", scale, palette: this.palette }));
      return;
    }
    const base = PX.renderStickBase({ scale, palette: this.palette });
    const knob = PX.renderStickKnob({ scale, palette: this.palette });
    const size = Math.max(base.width, knob.height);
    const canvas = this.paint(this.dpad, base, { minW: size, minH: size });
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = this.stickState;
    const direction = s.active && s.dirs.length ? this.direction(s.dirs) : null;
    const state = s.active ? "pressed" : "normal";
    const ring = PX.renderStickBase({ state, direction, scale, palette: this.palette });
    const top = PX.renderStickKnob({ state, scale, palette: this.palette });
    const bx = Math.floor((canvas.width - ring.width) / 2);
    const by = Math.floor((canvas.height - ring.height) / 2);
    let ox = s.x * ring.maxTravel;
    let oy = s.y * ring.maxTravel;
    const r = Math.hypot(ox, oy);
    if (r > ring.maxTravel) {
      ox = (ox / r) * ring.maxTravel;
      oy = (oy / r) * ring.maxTravel;
    }
    ox = Math.round(ox / scale) * scale;
    oy = Math.round(oy / scale) * scale;
    const baseInk = { x: bx + ring.width / 2, y: by + ring.height / 2 };
    const kx = Math.round(baseInk.x + ox - top.width / 2);
    const ky = Math.round(baseInk.y + oy - top.height / 2);
    ctx.drawImage(ring.canvas, bx, by);
    ctx.drawImage(top.canvas, Math.floor(kx / scale) * scale, Math.floor(ky / scale) * scale);
  }

  direction(dirs) {
    const v = dirs.includes("UP") ? "up" : dirs.includes("DOWN") ? "down" : "";
    const h = dirs.includes("RIGHT") ? "right" : dirs.includes("LEFT") ? "left" : "";
    return v && h ? `${v}-${h}` : v || h;
  }

  key(name, down) {
    if (down) this.down.add(name);
    else this.down.delete(name);
    if (KEY_PARTS[name]) this.drawKey(name);
    else if (this.mode === "dpad") this.drawDir();
    else if (this.stickState.active) {
      this.stickState.dirs = [...this.down].filter((n) => STICK_NAMES[n]);
      this.drawDir();
    }
  }

  stick(x, y, active) {
    this.stickState = { x, y, active, dirs: [...this.down].filter((n) => STICK_NAMES[n]) };
    if (this.mode === "stick") this.drawDir();
  }

  tool(node, info) {
    this.tools.set(node, { ...(this.tools.get(node) ?? {}), ...info });
    this.drawTool(node, this.tools.get(node));
  }

  drawTool(node, info) {
    if (!info) return;
    const scale = this.scaleOf(info.size ?? this.icon);
    const state = info.disabled ? "disabled" : info.on ? (info.pressed ? "onPressed" : "on") : info.pressed ? "pressed" : "normal";
    const make = (st) => (info.menu ? this.menuButton(st, scale) : PX.renderIconButton({ name: TOOL_ICONS[node.id]?.(info) ?? "close", state: st, scale, palette: this.palette }));
    const normal = make("normal");
    const canvas = this.paint(node, make(state));
    const face = normal.faceBox;
    const rows = normal.height / scale;
    const shift = face ? Math.round(((rows - 1 - face.y1 - face.y0) / 2) * scale) : 0;
    canvas.style.translate = shift ? `0 ${shift / this.dpr}px` : "";
  }

  background() {
    return hexOf(getComputedStyle(document.documentElement).getPropertyValue("--bg-sunken")) || "#070a14";
  }

  menuButton(state, scale) {
    const key = `${state}|${scale}`;
    this.menuCache ??= new Map();
    if (this.menuCache.get("palette") !== this.palette) {
      this.menuCache = new Map([["palette", this.palette]]);
    }
    if (this.menuCache.has(key)) return this.menuCache.get(key);
    const base = PX.renderIconButton({ name: "settings", state, scale: 1, palette: this.palette });
    const art = PX.debugArt(base);
    const face = state === "disabled" ? "off" : state === "on" || state === "onPressed" ? "fbOn" : "fb";
    const roles = art.roles.slice();
    const px = Uint8Array.from(art.px);
    const indexOf = (role) => {
      let i = roles.indexOf(role);
      if (i < 0) {
        roles.push(role);
        i = roles.length - 1;
      }
      return i;
    };
    const ink = base.inkBox;
    const faceIndex = indexOf(face);
    for (let y = ink.y0; y <= ink.y1; y++) for (let x = ink.x0; x <= ink.x1; x++) px[y * art.w + x] = faceIndex;
    const box = base.faceBox;
    const bw = box.x1 - box.x0 + 1;
    const bh = box.y1 - box.y0 + 1;
    const ox = box.x0 + Math.floor((bw - MENU_ART[0].length) / 2);
    const oy = box.y0 + Math.floor((bh - MENU_ART.length) / 2);
    MENU_ART.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (MENU_ROLES[ch]) px[(y + oy) * art.w + (x + ox)] = indexOf(state === "disabled" && ch !== "#" ? "icOffHi" : MENU_ROLES[ch]);
      });
    });
    const small = document.createElement("canvas");
    small.width = art.w;
    small.height = art.h;
    const sctx = small.getContext("2d");
    const image = sctx.createImageData(art.w, art.h);
    const lut = roles.map((role) => (role == null ? [0, 0, 0, 0] : rgba(this.palette[role])));
    for (let i = 0; i < px.length; i++) image.data.set(lut[px[i]], i * 4);
    sctx.putImageData(image, 0, 0);
    const canvas = document.createElement("canvas");
    canvas.width = art.w * scale;
    canvas.height = art.h * scale;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    const render = { canvas, width: canvas.width, height: canvas.height, faceBox: base.faceBox };
    this.menuCache.set(key, render);
    return render;
  }

  frame(canvas, { width, height, ring, full }) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    const p = this.palette;
    const band = (color, x, y, w, h) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    };
    const rows = [
      [p.outline, p.outline],
      [p.bodyHi, p.bodyLo],
      [p.body, p.body],
    ];
    if (!full) {
      rows.forEach(([top, bottom], k) => {
        band(top, 0, k * ring, width, ring);
        band(bottom, 0, height - (k + 1) * ring, width, ring);
      });
      return;
    }
    rows.forEach(([lead, tail], k) => {
      const o = k * ring;
      band(lead, o, o, width - o * 2, ring);
      band(lead, o, o, ring, height - o * 2);
      band(tail, o, height - o - ring, width - o * 2, ring);
      band(tail, width - o - ring, o, ring, height - o * 2);
    });
    for (const [x, y] of [
      [0, 0],
      [width - ring, 0],
      [0, height - ring],
      [width - ring, height - ring],
    ])
      ctx.clearRect(x, y, ring, ring);
    for (const [x, y, color] of [
      [ring, ring, p.outline],
      [width - ring * 2, ring, p.outline],
      [ring, height - ring * 2, p.outline],
      [width - ring * 2, height - ring * 2, p.outline],
    ])
      band(color, x, y, ring, ring);
  }

  partSize(kind) {
    const s = PX.partSize(kind, 1);
    return { w: s.w * this.art, h: s.h * this.art };
  }
}

function rgba(color) {
  const text = String(color);
  const n = (i) => parseInt(text.slice(i, i + 2), 16);
  return [n(1), n(3), n(5), text.length >= 9 ? n(7) : 255];
}
