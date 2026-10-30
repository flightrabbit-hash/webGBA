// pixel-ui.js — webGBA 픽셀아트 그림 부품 (의존 없음, ES 모듈)
//
// 모든 부품은 "아트 픽셀" 격자에 그린 뒤 정수 배율(scale)로 키운다(번짐 없음).
// 단위는 캔버스 픽셀. 웹에서는 CSS px × devicePixelRatio 값을 넘기면 선명하다.
// 같은 부품·상태·배율·팔레트는 오프스크린 canvas 캐시를 돌려준다(돌려받은 canvas에 직접 그리지 말 것).
//
// 그림 규칙: 부품 하나당 16색 이하(투명 포함), 1px 진한 외곽선, 빛은 왼쪽 위,
// 글자는 직접 만든 픽셀 글자이고 버튼 면 안에서 잉크 기준 가로·세로 가운데(남는 1줄은 늘 오른쪽·아래).

export const VERSION = '1.0.0';
const colorCache = new Map();

// ---------------------------------------------------------------------------
// 팔레트
// ---------------------------------------------------------------------------
// 테마 하나 = 기본 색 5개. 밝은 면·그림자·옆면·글자 색은 규칙으로 만든다(부품마다 16색 이하).
//   body    본체          button  방향 패드·스틱·L·R·START·SELECT
//   accent  A·B·켬·강조    ink     버튼 글자        outline 외곽선(가장 진한 색)
// 테마 id는 윈도우용 webGBA 테마와 같다(이름은 i18n 키 theme.mode.<id>로도 찾을 수 있음).
export const BASE_KEYS = ['body', 'button', 'accent', 'ink', 'outline'];

export const THEMES = [
  { id: 'midnight', name: '미드나잇', tone: 'dark', colors: { body: '#263052', button: '#48557e', accent: '#4da3ff', ink: '#e9efff', outline: '#02040a' } },
  { id: 'dark', name: '다크', tone: 'dark', colors: { body: '#4e62d2', button: '#c9cde8', accent: '#b8bef0', ink: '#1d2166', outline: '#0a0c2f' } },
  { id: 'nord', name: '노드', tone: 'dark', colors: { body: '#4c566a', button: '#d8dee9', accent: '#88c0d0', ink: '#2e3440', outline: '#1b1f27' } },
  { id: 'monokai', name: '모노카이', tone: 'dark', colors: { body: '#514e52', button: '#c1c0bf', accent: '#78dce8', ink: '#2d2a2e', outline: '#141214' } },
  { id: 'solardark', name: '솔라 다크', tone: 'dark', colors: { body: '#1d4a57', button: '#93a1a1', accent: '#2aa198', ink: '#002b36', outline: '#00141a' } },
  { id: 'dracula', name: '드라큘라', tone: 'dark', colors: { body: '#4b3d69', button: '#cbbff0', accent: '#ff79c6', ink: '#282a36', outline: '#120d1a' } },
  { id: 'forest', name: '포레스트', tone: 'dark', colors: { body: '#2e5a38', button: '#b4d4ba', accent: '#7ee787', ink: '#0f2416', outline: '#050f08' } },
  { id: 'light', name: '화이트', tone: 'light', colors: { body: '#e3e5ee', button: '#454a66', accent: '#2f5fd8', ink: '#eef0f8', outline: '#23263c' } },
  { id: 'sepia', name: '세피아', tone: 'light', colors: { body: '#e8d9bb', button: '#6e5638', accent: '#975913', ink: '#f7eedb', outline: '#2e2416' } },
  { id: 'ragdoll', name: '랙돌', tone: 'light', colors: { body: '#f4ecdf', button: '#cdbca6', accent: '#3270b3', ink: '#3b322a', outline: '#2a221b' } },
  { id: 'solarized', name: '솔라라이즈', tone: 'light', colors: { body: '#eee8d5', button: '#586e75', accent: '#268bd2', ink: '#fdf6e3', outline: '#073642' } },
  { id: 'contrast', name: '고대비 라이트', tone: 'light', colors: { body: '#ffffff', button: '#000000', accent: '#000000', ink: '#ffffff', outline: '#000000' } },
  { id: 'custom', name: '커스텀', tone: 'dark', colors: { body: '#4e62d2', button: '#c9cde8', accent: '#b8bef0', ink: '#1d2166', outline: '#0a0c2f' } },
];
export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_THEME_ID = 'dark';
const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));

/** 테마 id의 기본 색 객체(사본). 커스텀의 처음 값으로 쓰기 좋다. */
export function themeColors(id = DEFAULT_THEME_ID) {
  const t = THEME_BY_ID[id] || THEME_BY_ID[DEFAULT_THEME_ID];
  return { ...t.colors };
}

// --- 색 계산 ---
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
function rgbOf(c) { const v = parseColor(c); return [v[0], v[1], v[2]]; }
function mix(a, b, t) {
  const x = rgbOf(a), y = rgbOf(b);
  return '#' + [0, 1, 2].map((i) => hex2(x[i] + (y[i] - x[i]) * t)).join('');
}
function lum(c) {
  const v = rgbOf(c).map((n) => { const s = n / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function gray(c) { const [r, g, b] = rgbOf(c); const v = hex2(0.299 * r + 0.587 * g + 0.114 * b); return '#' + v + v + v; }
function inkFor(face, ink, outline) {
  if (contrast(face, ink) >= 3) return ink;
  const light = mix(face, '#ffffff', 0.9), dark = mix(face, outline, 0.85);
  return contrast(face, light) > contrast(face, dark) ? light : dark;
}

const ICON_COLORS = {
  icW: '#f5f6ff', icL: '#b9c0e8', icM: '#7880bd', icK: '#3a4080',
  icY: '#ffd04d', icO: '#e3901f', icR: '#ee5b53', icG: '#5fd46f', icB: '#4f8ef2', icBd: '#2f5bc0',
};

function buildPalette(b, id) {
  const W = '#ffffff', K = '#000000', o = b.outline;
  const fam = (face, ink) => ({
    f: face, hi: mix(face, W, 0.22 + 0.4 * lum(face)), lo: mix(face, o, 0.22), side: mix(face, o, 0.48), ink: inkFor(face, ink, o),
  });
  const put = (out, p, f) => { out[p] = f.f; out[p + 'Hi'] = f.hi; out[p + 'Lo'] = f.lo; out[p + 'Side'] = f.side; out[p + 'Ink'] = f.ink; };
  const pal = {
    id, base: { ...b },
    outline: o, shadow: mix(o, K, 0.3) + '73',
    body: b.body, bodyHi: mix(b.body, W, 0.22), bodyHi2: mix(b.body, W, 0.42), bodyLo: mix(b.body, o, 0.18), bodyLo2: mix(b.body, o, 0.36),
    bezel: mix(o, W, 0.13), bezelHi: mix(o, W, 0.22), bezelLo: mix(o, W, 0.05), glass: mix(o, K, 0.55),
    label: mix(o, W, 0.62), led: '#72e05c', speaker: mix(b.body, o, 0.62),
    iconOutline: o, ...ICON_COLORS,
  };
  const btn = fam(b.button, b.ink);
  put(pal, 'btn', btn); put(pal, 'sh', btn);
  put(pal, 'ab', fam(b.accent, b.ink));
  put(pal, 'pill', fam(mix(b.button, o, 0.2), b.ink));
  const offFace = gray(mix(b.button, b.body, 0.45));
  const off = fam(offFace, offFace); off.ink = mix(offFace, o, 0.38);
  put(pal, 'off', off);
  put(pal, 'fb', fam(mix(b.body, o, 0.28), b.ink));
  put(pal, 'fbOn', fam(b.accent, b.ink));
  const well = mix(b.body, o, 0.45);
  pal.well = well; pal.wellHi = mix(well, W, 0.16); pal.wellLo = mix(well, o, 0.4);
  pal.ring = b.accent; pal.ringHi = mix(b.accent, W, 0.55);
  pal.icOffHi = mix(offFace, W, 0.5); pal.icOffLo = mix(offFace, o, 0.3);
  return pal;
}

const derived = new Map();
/** 기본 색 객체(빠진 키는 기본 테마 값) → 부품이 쓰는 전체 팔레트. 같은 색이면 같은 객체(캐시 열쇠). */
export function derivePalette(colors = {}, id = 'custom') {
  const b = { ...THEME_BY_ID[DEFAULT_THEME_ID].colors };
  for (const k of BASE_KEYS) if (colors[k]) { parseColor(colors[k]); b[k] = colors[k].toLowerCase(); }
  const key = id + '|' + BASE_KEYS.map((k) => b[k]).join(',');
  let p = derived.get(key);
  if (!p) { p = buildPalette(b, id); derived.set(key, p); }
  return p;
}

let currentId = DEFAULT_THEME_ID;
let currentColors = themeColors(DEFAULT_THEME_ID);
let current = derivePalette(currentColors, currentId);
const listeners = new Set();

/**
 * 테마 바꾸기. id(THEME_IDS 중 하나) 또는 기본 색 객체({body,button,accent,ink,outline}, 일부만 줘도 됨 → 'custom').
 * 'custom' id만 주면 마지막 커스텀 색(없으면 기본 테마 색). 캐시를 비우고 onThemeChange 듣는 쪽을 부른다.
 * @returns {{id:string, colors:object}}
 */
let customColors = themeColors('custom');
export function setTheme(theme) {
  if (theme && typeof theme === 'object') {
    customColors = { ...customColors, ...theme };
    currentId = 'custom'; currentColors = { ...customColors };
  } else if (theme === 'custom') {
    currentId = 'custom'; currentColors = { ...customColors };
  } else {
    currentId = THEME_BY_ID[theme] ? theme : DEFAULT_THEME_ID;
    currentColors = themeColors(currentId);
  }
  current = derivePalette(currentColors, currentId);
  clearCache();
  const info = getTheme();
  for (const f of listeners) { try { f(info); } catch (e) { console.error(e); } }
  return info;
}
/** 지금 테마 { id, colors }. */
export function getTheme() { return { id: currentId, colors: { ...currentColors } }; }
/** 테마가 바뀌면 부를 함수 등록. 해제 함수를 돌려준다. */
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** 그림 캐시 비우기(setTheme가 부름). */
export function clearCache() { caches = new WeakMap(); derived.clear(); current = derivePalette(currentColors, currentId); }

/** palette 인자 → 전체 팔레트. 없음 = 지금 테마, 문자열 = 테마 id, 기본 색 객체 = 그 색으로 만든 팔레트. */
function resolvePalette(p) {
  if (p == null) return current;
  if (typeof p === 'string') return THEME_BY_ID[p] ? derivePalette(THEME_BY_ID[p].colors, p) : current;
  if (p.bodyHi) return p;
  return derivePalette(p, p.id || 'custom');
}
export { resolvePalette as paletteOf };


function parseColor(c) {
  let v = colorCache.get(c);
  if (v) return v;
  const m = /^#([0-9a-f]{3,8})$/i.exec(c || '');
  if (!m) throw new Error(`pixel-ui: 색 형식은 #rgb·#rrggbb·#rrggbbaa만 받음: ${c}`);
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join('');
  v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255];
  colorCache.set(c, v);
  return v;
}

// ---------------------------------------------------------------------------
// 아트 버퍼 · canvas
// ---------------------------------------------------------------------------
class Art {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.px = new Uint8Array(w * h); // 0 = 투명
    this.roles = [null];
    this.ri = new Map([[null, 0]]);
  }
  idx(role) {
    let i = this.ri.get(role);
    if (i === undefined) { i = this.roles.length; this.roles.push(role); this.ri.set(role, i); }
    return i;
  }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  set(x, y, role) { if (this.in(x, y)) this.px[y * this.w + x] = this.idx(role); }
  get(x, y) { return this.in(x, y) ? this.roles[this.px[y * this.w + x]] : null; }
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

function artToCanvas(art, pal, scale) {
  const base = makeCanvas(art.w, art.h);
  const bctx = base.getContext('2d');
  const img = bctx.createImageData(art.w, art.h);
  const lut = art.roles.map((r) => {
    if (r == null) return [0, 0, 0, 0];
    if (pal[r] == null) throw new Error(`pixel-ui: 팔레트에 색이 없음: ${r}`);
    return parseColor(pal[r]);
  });
  for (let i = 0; i < art.px.length; i++) img.data.set(lut[art.px[i]], i * 4);
  bctx.putImageData(img, 0, 0);
  if (scale === 1) return base;
  const out = makeCanvas(art.w * scale, art.h * scale);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, out.width, out.height);
  return out;
}

let caches = new WeakMap();
function cached(pal, key, make) {
  let m = caches.get(pal);
  if (!m) { m = new Map(); caches.set(pal, m); }
  let v = m.get(key);
  if (!v) { v = make(); m.set(key, v); }
  return v;
}

function intScale(s) {
  const v = Math.floor(Number(s) || 1);
  return v < 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// 픽셀 글자 (직접 만든 것)
// ---------------------------------------------------------------------------
const BIG = { // 5x7
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
};
const SMALL = { // 높이 5, 폭은 글자마다
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  E: ['###', '#..', '##.', '#..', '###'],
  L: ['#..', '#..', '#..', '#..', '###'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  w: ['.....', '#...#', '#...#', '#.#.#', '.#.#.'],
  e: ['...', '.##', '#.#', '##.', '.##'],
  b: ['#..', '##.', '#.#', '#.#', '##.'],
};

/** 글자열 → 비트맵 줄 배열('#' = 잉크). */
function textBitmap(text, font) {
  const glyphs = [...text].map((ch) => font[ch]);
  if (glyphs.some((g) => !g)) throw new Error(`pixel-ui: 글꼴에 없는 글자: ${text}`);
  const h = glyphs[0].length;
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(glyphs.map((g) => g[y]).join('.'));
  return rows;
}

function inkBox(rows) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c !== '.' && c !== ' ') { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }));
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 상자(box: x0,y0,x1,y1) 안에 잉크 기준 가운데로 찍는다. 남는 1줄은 오른쪽·아래로. */
function stampCentered(art, box, rows, role) {
  const ib = inkBox(rows);
  if (!ib) return null;
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const ox = box.x0 + Math.floor((bw - ib.w) / 2) - ib.x0;
  const oy = box.y0 + Math.floor((bh - ib.h) / 2) - ib.y0;
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') art.set(ox + x, oy + y, role); }));
  return { x0: ox + ib.x0, y0: oy + ib.y0, x1: ox + ib.x1, y1: oy + ib.y1 };
}

// ---------------------------------------------------------------------------
// 모양(마스크)
// ---------------------------------------------------------------------------
function roundRectInside(W, H, rTL, rTR, rBR, rBL) {
  return (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const px = x + 0.5, py = y + 0.5;
    const corner = (cx, cy, r) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
    if (rTL > 0 && px < rTL && py < rTL) return corner(rTL, rTL, rTL);
    if (rTR > 0 && px > W - rTR && py < rTR) return corner(W - rTR, rTR, rTR);
    if (rBR > 0 && px > W - rBR && py > H - rBR) return corner(W - rBR, H - rBR, rBR);
    if (rBL > 0 && px < rBL && py > H - rBL) return corner(rBL, H - rBL, rBL);
    return true;
  };
}

function circleInside(D) {
  const c = D / 2, r2 = (D / 2) ** 2 - 0.3;
  return (x, y) => x >= 0 && y >= 0 && x < D && y < D && (x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 <= r2;
}

// ---------------------------------------------------------------------------
// 튀어나온 버튼 그리기(윗면 + 옆면 + 그림자 + 외곽선 + 빛)
// ---------------------------------------------------------------------------
// offsetAt(x,y): 그 칸의 윗면이 내려앉은 정도(0 보통, 1 눌림). 바닥은 고정이라
// 눌리면 옆면이 1줄 줄고 그림자도 1줄 준다.
function extrude({ W, H, inside, depth, shadow, offsetAt = () => 0, roles, decor, pressedShade = false }) {
  const AW = W, AH = H + depth + shadow;
  const art = new Art(AW, AH);
  const N = AW * AH;
  const owner = new Int32Array(N).fill(-1);
  const side = new Uint8Array(N), shad = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    const o = offsetAt(x, y);
    for (let k = o + 1; k <= depth; k++) side[(y + k) * AW + x] = 1;
    for (let k = depth + 1; k <= depth + shadow - o; k++) if (y + k < AH) shad[(y + k) * AW + x] = 1;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    owner[(y + offsetAt(x, y)) * AW + x] = y * W + x;
  }
  const body = (x, y) => x >= 0 && y >= 0 && x < AW && y < AH && (owner[y * AW + x] >= 0 || side[y * AW + x] === 1);
  const outl = new Uint8Array(N);
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    const i = y * AW + x;
    if (body(x, y)) {
      if (!body(x - 1, y) || !body(x + 1, y) || !body(x, y - 1) || !body(x, y + 1)) outl[i] = 1;
    }
  }
  const face = (x, y) => x >= 0 && y >= 0 && x < AW && y < AH && owner[y * AW + x] >= 0 && !outl[y * AW + x];
  let fx0 = 1e9, fy0 = 1e9, fx1 = -1, fy1 = -1;
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    const i = y * AW + x;
    if (outl[i]) { art.px[i] = art.idx(roles.outline); continue; }
    if (owner[i] >= 0) {
      let r = roles.face;
      if (!face(x, y - 1) || !face(x - 1, y)) r = roles.hi;
      else if (!face(x, y + 1) || !face(x + 1, y)) r = roles.lo;
      const mx = owner[i] % W, my = Math.floor(owner[i] / W);
      if (decor) {
        const d = decor(mx, my);
        if (d) r = d;
      }
      if (pressedShade && offsetAt(mx, my) === 1) r = r === roles.face ? roles.lo : r === roles.hi ? roles.face : r === roles.lo ? roles.side : r;
      art.px[i] = art.idx(r);
      if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; if (y < fy0) fy0 = y; if (y > fy1) fy1 = y;
    } else if (side[i]) art.px[i] = art.idx(roles.side);
    else if (shad[i]) art.px[i] = art.idx(roles.shadow);
  }
  return { art, faceBox: { x0: fx0, y0: fy0, x1: fx1, y1: fy1 } };
}

function buttonRoles(prefix, state) {
  const p = state === 'disabled' ? 'off' : prefix;
  return { face: p, hi: p + 'Hi', lo: p + 'Lo', side: p + 'Side', ink: p + 'Ink', outline: 'outline', shadow: 'shadow' };
}

function finish(kind, art, scale, pal, extra) {
  const canvas = artToCanvas(art, pal, scale);
  return { kind, canvas, width: canvas.width, height: canvas.height, scale, art: { w: art.w, h: art.h }, _art: art, ...extra };
}

// ---------------------------------------------------------------------------
// 게임 버튼
// ---------------------------------------------------------------------------
export const SIZES = {
  dpad: { w: 33, h: 33 }, ab: { w: 23, h: 23 }, shoulder: { w: 37, h: 13 }, pill: { w: 31, h: 11 },
  iconButton: { w: 22, h: 22 }, icon: { w: 16, h: 16 }, stick: { w: 37, h: 37 }, knob: { w: 21, h: 21 },
};
const GAME_DEPTH = 2, GAME_SHADOW = 2, ICON_DEPTH = 2, ICON_SHADOW = 1;

/** 부품의 캔버스 크기(픽셀). 배치 계산용. */
export function partSize(kind, scale = 1) {
  const s = intScale(scale);
  const z = SIZES[kind === 'a' || kind === 'b' ? 'ab' : kind === 'l' || kind === 'r' ? 'shoulder' : kind === 'start' || kind === 'select' ? 'pill' : kind];
  if (!z) throw new Error(`pixel-ui: 모르는 부품: ${kind}`);
  if (kind === 'icon' || kind === 'stick') return { w: z.w * s, h: z.h * s };
  const extra = kind === 'iconButton' ? ICON_DEPTH + ICON_SHADOW : GAME_DEPTH + GAME_SHADOW;
  return { w: z.w * s, h: (z.h + extra) * s };
}

const DIRS = ['up', 'down', 'left', 'right'];
function normPressed(p) {
  if (!p || p === 'none') return [];
  if (p === 'center') return ['center'];
  const list = Array.isArray(p) ? p : String(p).split(/[-+,\s]+/);
  return list.filter((d) => DIRS.includes(d) || d === 'center');
}

function dpadRegion(x, y) {
  const a = 11, b = 21;
  if (x >= a && x <= b && y >= a && y <= b) return 'center';
  if (y < a) return 'up';
  if (y > b) return 'down';
  if (x < a) return 'left';
  return 'right';
}

const DPAD_MARKS = (() => {
  const m = new Map();
  const put = (x, y, role) => m.set(y * 33 + x, role);
  for (let k = 0; k < 3; k++) for (let d = -k; d <= k; d++) {
    put(16 + d, 3 + k, 'lo'); // 위
    put(16 + d, 29 - k, 'lo'); // 아래
    put(3 + k, 16 + d, 'lo'); // 왼쪽
    put(29 - k, 16 + d, 'lo'); // 오른쪽
  }
  // 가운데 오목한 홈(왼쪽 위는 그늘, 오른쪽 아래는 빛)
  for (let y = 14; y <= 18; y++) for (let x = 14; x <= 18; x++) {
    const dx = x - 16, dy = y - 16;
    if (dx * dx + dy * dy > 5) continue;
    put(x, y, dx + dy < 0 ? 'lo' : dx + dy > 0 ? 'hi' : 'face');
  }
  return m;
})();

/**
 * 방향 패드.
 * @param {object} o
 * @param {string|string[]} [o.pressed] 'none'|'center'|'up'|'down'|'left'|'right'|'up-left' 등(대각선은 두 방향)
 * @param {'normal'|'disabled'} [o.state]
 * @param {number} [o.scale]
 * @param {object} [o.palette]
 */
export function renderDpad({ pressed = 'none', state = 'normal', scale = 1, palette } = {}) {
  palette = resolvePalette(palette);
  const s = intScale(scale);
  const pr = state === 'disabled' ? [] : normPressed(pressed);
  const key = `dpad|${pr.join('+')}|${state}|${s}`;
  return cached(palette, key, () => {
    const W = 33, H = 33;
    const cross = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const inV = x >= 11 && x <= 21, inH = y >= 11 && y <= 21;
      if (!inV && !inH) return false;
      // 팔 끝 모서리 1칸 깎기
      if ((y === 0 || y === H - 1) && (x === 11 || x === 21)) return false;
      if ((x === 0 || x === W - 1) && (y === 11 || y === 21)) return false;
      return true;
    };
    const all = pr.includes('center');
    const roles = buttonRoles('btn', state);
    const { art, faceBox } = extrude({
      W, H, inside: cross, depth: GAME_DEPTH, shadow: GAME_SHADOW,
      offsetAt: (x, y) => (all || pr.includes(dpadRegion(x, y)) ? 1 : 0),
      roles, pressedShade: !all,
      decor: (x, y) => {
        const d = DPAD_MARKS.get(y * 33 + x);
        return d ? roles[d] : null;
      },
    });
    const r = (x, y, w, h) => ({ x: x * s, y: y * s, w: w * s, h: h * s });
    return finish('dpad', art, s, palette, {
      state, pressed: pr, faceBox,
      hit: r(0, 0, W, H + GAME_DEPTH),
      regions: { up: r(11, 0, 11, 11), down: r(11, 22, 11, 11), left: r(0, 11, 11, 11), right: r(22, 11, 11, 11), center: r(11, 11, 11, 11) },
      inside: cross, depth: GAME_DEPTH,
    });
  });
}

/** 둥근 A·B 버튼. */
export function renderRoundButton({ label = 'A', state = 'normal', scale = 1, palette } = {}) {
  palette = resolvePalette(palette);
  const s = intScale(scale);
  const st = state === 'pressed' || state === 'disabled' ? state : 'normal';
  return cached(palette, `round|${label}|${st}|${s}`, () => {
    const D = 23;
    const inside = circleInside(D);
    const roles = buttonRoles('ab', st);
    const gloss = new Set([5 * D + 6, 6 * D + 5, 6 * D + 6]);
    const { art, faceBox } = extrude({
      W: D, H: D, inside, depth: GAME_DEPTH, shadow: GAME_SHADOW,
      offsetAt: () => (st === 'pressed' ? 1 : 0), roles,
      decor: (x, y) => (st !== 'disabled' && gloss.has(y * D + x) ? roles.hi : null),
    });
    const ink = stampCentered(art, faceBox, BIG[label], roles.ink);
    return finish('round', art, s, palette, {
      label, state: st, faceBox, inkBox: ink,
      hit: { x: 0, y: 0, w: D * s, h: (D + GAME_DEPTH) * s },
      circle: { cx: (D / 2) * s, cy: (D / 2 + (st === 'pressed' ? 1 : 0)) * s, r: (D / 2) * s },
      inside, depth: GAME_DEPTH,
    });
  });
}

/** L·R 어깨 버튼. side: 'L'|'R'. */
export function renderShoulder({ side = 'L', state = 'normal', scale = 1, palette } = {}) {
  palette = resolvePalette(palette);
  const s = intScale(scale);
  const st = state === 'pressed' || state === 'disabled' ? state : 'normal';
  return cached(palette, `shoulder|${side}|${st}|${s}`, () => {
    const W = 37, H = 13;
    const inside = side === 'R' ? roundRectInside(W, H, 2.5, 7, 2.5, 2.5) : roundRectInside(W, H, 7, 2.5, 2.5, 2.5);
    const roles = buttonRoles('sh', st);
    const { art, faceBox } = extrude({
      W, H, inside, depth: GAME_DEPTH, shadow: GAME_SHADOW, offsetAt: () => (st === 'pressed' ? 1 : 0), roles,
    });
    const ink = stampCentered(art, faceBox, BIG[side], roles.ink);
    return finish('shoulder', art, s, palette, {
      label: side, state: st, faceBox, inkBox: ink,
      hit: { x: 0, y: 0, w: W * s, h: (H + GAME_DEPTH) * s }, inside, depth: GAME_DEPTH,
    });
  });
}

/** START·SELECT 알약 버튼. */
export function renderPill({ label = 'START', state = 'normal', scale = 1, palette } = {}) {
  palette = resolvePalette(palette);
  const s = intScale(scale);
  const st = state === 'pressed' || state === 'disabled' ? state : 'normal';
  return cached(palette, `pill|${label}|${st}|${s}`, () => {
    const W = 31, H = 11;
    const inside = roundRectInside(W, H, 5.5, 5.5, 5.5, 5.5);
    const roles = buttonRoles('pill', st);
    const { art, faceBox } = extrude({
      W, H, inside, depth: GAME_DEPTH, shadow: GAME_SHADOW, offsetAt: () => (st === 'pressed' ? 1 : 0), roles,
    });
    const ink = stampCentered(art, faceBox, textBitmap(label, SMALL), roles.ink);
    return finish('pill', art, s, palette, {
      label, state: st, faceBox, inkBox: ink,
      hit: { x: 0, y: 0, w: W * s, h: (H + GAME_DEPTH) * s }, inside, depth: GAME_DEPTH,
    });
  });
}

/**
 * 게임 버튼 하나를 이름으로.
 * name: 'dpad'|'a'|'b'|'l'|'r'|'start'|'select'
 */
export function renderGameButton(name, opts = {}) {
  switch (name) {
    case 'dpad': return renderDpad(opts);
    case 'a': case 'b': return renderRoundButton({ ...opts, label: name.toUpperCase() });
    case 'l': case 'r': return renderShoulder({ ...opts, side: name.toUpperCase() });
    case 'start': case 'select': return renderPill({ ...opts, label: name.toUpperCase() });
    case 'stick': return renderStickBase(opts);
    case 'knob': return renderStickKnob(opts);
    default: throw new Error(`pixel-ui: 모르는 버튼: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// 가상 스틱(받침 + 손잡이)
// ---------------------------------------------------------------------------
export const STICK_DIRECTIONS = ['right', 'up-right', 'up', 'up-left', 'left', 'down-left', 'down', 'down-right'];
const STICK_D = 37, KNOB_D = 21, STICK_TRAVEL = 7, STICK_RANGE = 14; // 아트 픽셀(손잡이 이동 한도, 입력 세기 1이 되는 거리)

/**
 * 스틱 받침(움푹한 원). state 'normal'|'pressed'(누르는 중이면 테두리가 강조색으로)|'disabled'.
 * direction: STICK_DIRECTIONS 중 하나면 그 방향 테두리를 살짝 밝힌다(없으면 null).
 */
export function renderStickBase({ state = 'normal', direction = null, scale = 1, palette } = {}) {
  palette = resolvePalette(palette);
  const s = intScale(scale);
  const st = state === 'pressed' || state === 'disabled' ? state : 'normal';
  const dir = STICK_DIRECTIONS.includes(direction) && st !== 'disabled' ? direction : null;
  return cached(palette, `stick|${st}|${dir}|${s}`, () => {
    const D = STICK_D, c = D / 2;
    const inside = circleInside(D);
    const d = distField(D, D, inside);
    const art = new Art(D, D);
    const ang = dir ? (STICK_DIRECTIONS.indexOf(dir) * 45) : null;
    const off = st === 'disabled';
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const v = d(x, y);
      if (!v) continue;
      const g = d(x + 1, y) - d(x - 1, y) + d(x, y + 1) - d(x, y - 1);
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const a = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
      const inSector = ang != null && Math.abs(((a - ang + 540) % 360) - 180) <= 22.5;
      let role;
      if (v === 1) role = 'outline';
      else if (v === 2) role = inSector ? 'ring' : off ? 'offLo' : g > 0 ? 'bodyHi' : g < 0 ? 'bodyLo2' : 'body';
      else if (v === 3) role = inSector ? 'ringHi' : off ? 'off' : st === 'pressed' ? 'ring' : 'body';
      else if (v === 4) role = 'outline';
      else if (v === 5) role = off ? 'offSide' : g > 0 ? 'wellLo' : g < 0 ? 'wellHi' : 'well';
      else role = off ? 'offSide' : 'well';
      art.set(x, y, role);
    }
    // 8방향 길잡이 점
    for (let k = 0; k < 8; k++) {
      const t = (k * Math.PI) / 4;
      const x = Math.floor(c + Math.cos(t) * 11), y = Math.floor(c - Math.sin(t) * 11);
      if (art.get(x, y) === 'well') art.set(x, y, 'wellLo');
    }
    return finish('stick', art, s, palette, {
      state: st, direction: dir,
      hit: { x: 0, y: 0, w: D * s, h: D * s },
      center: { x: c * s, y: c * s }, radius: c * s, maxTravel: STICK_TRAVEL * s, range: STICK_RANGE * s,
      inside, depth: 0,
    });
  });
}

/** 스틱 손잡이(둥근 엄지 받침, 위에서 본 모양). state 'normal'|'pressed'|'disabled'. */
export function renderStickKnob({ state = 'normal', scale = 1, palette } = {}) {
  palette = resolvePalette(palette);
  const s = intScale(scale);
  const st = state === 'pressed' || state === 'disabled' ? state : 'normal';
  return cached(palette, `knob|${st}|${s}`, () => {
    const D = KNOB_D, c = D / 2;
    const inside = circleInside(D);
    const roles = buttonRoles('btn', st);
    const { art, faceBox } = extrude({
      W: D, H: D, inside, depth: GAME_DEPTH, shadow: GAME_SHADOW,
      offsetAt: () => (st === 'pressed' ? 1 : 0), roles,
      decor: (x, y) => {
        const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy);
        if (r >= 5 && r < 6.2) return dx + dy < 0 ? roles.lo : roles.hi; // 오목한 엄지 홈 테
        if (st !== 'disabled' && ((x === 5 && y === 4) || (x === 4 && y === 5) || (x === 5 && y === 5))) return roles.hi;
        return null;
      },
    });
    return finish('knob', art, s, palette, {
      state: st, faceBox,
      hit: { x: 0, y: 0, w: D * s, h: (D + GAME_DEPTH) * s },
      center: { x: c * s, y: (c + (st === 'pressed' ? 1 : 0)) * s },
      inside, depth: GAME_DEPTH,
    });
  });
}

/**
 * 받침을 (x,y)에 그리고, 손잡이를 받침 가운데 + (dx,dy)에 그린다.
 * dx·dy는 캔버스 픽셀. clamp면 maxTravel 안으로, snap이면 배율 칸에 맞춤(선명).
 * @returns {{base:object, knob:object, center:{x,y}, maxTravel:number, dx:number, dy:number}}
 */
export function drawStick(ctx, { x = 0, y = 0, dx = 0, dy = 0, state = 'normal', direction = null, scale = 1, palette, clamp = true, snap = true } = {}) {
  const s = intScale(scale);
  const base = renderStickBase({ state, direction, scale: s, palette });
  const knob = renderStickKnob({ state, scale: s, palette });
  let ox = dx, oy = dy;
  const max = base.maxTravel;
  if (clamp) { const r = Math.hypot(ox, oy); if (r > max) { ox = (ox / r) * max; oy = (oy / r) * max; } }
  if (snap) { ox = Math.round(ox / s) * s; oy = Math.round(oy / s) * s; }
  const bx = Math.round(x), by = Math.round(y);
  const cx = bx + base.center.x, cy = by + base.center.y;
  const kx = Math.round(cx + ox - (KNOB_D / 2) * s), ky = Math.round(cy + oy - (KNOB_D / 2) * s);
  ctx.drawImage(base.canvas, bx, by);
  ctx.drawImage(knob.canvas, kx, ky);
  return {
    base: { x: bx, y: by, w: base.width, h: base.height },
    knob: { x: kx, y: ky, w: knob.width, h: knob.height },
    center: { x: cx, y: cy }, maxTravel: max, dx: ox, dy: oy,
  };
}

/**
 * 받침 캔버스 좌표(px,py) → 스틱 값. 받침 밖으로 끌어도 방향은 유지(세기는 1로 자름).
 * @returns {{x:number, y:number, dx:number, dy:number, direction:string|null, dirs:string[]}}
 *   x·y: -1..1(오른쪽·아래 +, range px에서 1), dx·dy: 손잡이 오프셋(px, maxTravel 안), direction: 8방향 이름(데드존이면 null),
 *   dirs: 게임 입력 방향 배열(예 ['up','right'])
 */
export function stickVector(baseRender, px, py, { deadZone = 0.25, range } = {}) {
  const c = baseRender.center, max = baseRender.maxTravel, rg = range || baseRender.range;
  let vx = (px - c.x) / rg, vy = (py - c.y) / rg;
  const r = Math.hypot(vx, vy);
  if (r > 1) { vx /= r; vy /= r; }
  let direction = null;
  if (r >= deadZone) {
    const a = ((Math.atan2(-vy, vx) * 180) / Math.PI + 360) % 360;
    direction = STICK_DIRECTIONS[Math.round(a / 45) % 8];
  }
  const dirs = direction ? direction.split('-') : [];
  return { x: vx, y: vy, dx: vx * max, dy: vy * max, direction, dirs };
}

// ---------------------------------------------------------------------------
// 누르는 곳
// ---------------------------------------------------------------------------
/** render 결과의 캔버스 좌표(x,y)가 버튼 모양 안인지(윗면 + 옆면). */
export function hitTest(render, x, y) {
  const s = render.scale, ax = Math.floor(x / s), ay = Math.floor(y / s);
  for (let k = 0; k <= (render.depth || 0); k++) if (render.inside && render.inside(ax, ay - k)) return true;
  return false;
}

/**
 * 방향 패드 위 점 → 눌린 방향 배열(예: ['up'], ['up','left']). 가운데 죽은 영역이면 [].
 * 패드 밖으로 미끄러져도 각도로 방향을 정한다(손가락이 벗어나도 유지되게). 너무 멀면(maxRadius 배) [].
 * @param {object} render renderDpad 결과
 * @param {number} x 캔버스 좌표
 * @param {number} y
 * @param {{deadZone?:number, diagonal?:boolean, diagonalWidth?:number, maxRadius?:number}} [o]
 */
export function dpadDirections(render, x, y, { deadZone = 0.2, diagonal = true, diagonalWidth = 40, maxRadius = 1.6 } = {}) {
  const s = render.scale, half = (33 / 2) * s;
  const dx = (x - half) / half, dy = (y - half) / half;
  const r = Math.hypot(dx, dy);
  if (r < deadZone || r > maxRadius) return [];
  const deg = (Math.atan2(-dy, dx) * 180) / Math.PI; // 0 = 오른쪽, 90 = 위
  const a = (deg + 360) % 360;
  const near = (c) => Math.abs(((a - c + 540) % 360) - 180);
  if (diagonal) {
    const hw = diagonalWidth / 2;
    if (near(45) <= hw) return ['up', 'right'];
    if (near(135) <= hw) return ['up', 'left'];
    if (near(225) <= hw) return ['down', 'left'];
    if (near(315) <= hw) return ['down', 'right'];
  }
  if (near(90) <= 45) return ['up'];
  if (near(270) <= 45) return ['down'];
  if (near(180) <= 45) return ['left'];
  return ['right'];
}

// ---------------------------------------------------------------------------
// 기능 아이콘 16x16
// ---------------------------------------------------------------------------
// 글자 → 역할. 각 층은 자동 외곽선(4방향)을 두르고 순서대로 겹친다.
const ICON_CHARS = {
  o: 'iconOutline', w: 'icW', l: 'icL', m: 'icM', k: 'icK', y: 'icY', Y: 'icO', r: 'icR', g: 'icG', b: 'icB', B: 'icBd',
};

function gearLayer() {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let s = '';
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8;
      const r = Math.hypot(dx, dy);
      const t = (((Math.atan2(dy, dx) / (Math.PI * 2)) * 8) + 8.5) % 1;
      const tooth = Math.abs(t - 0.5) < 0.2;
      let f = r <= 4.9 || (tooth && r <= 6.95);
      if (r < 2.2) f = false;
      s += f ? 'l' : '.';
    }
    rows.push(s);
  }
  return shadeRows(rows, 'l', 'w', 'm');
}

/** 채운 칸 중 위·왼쪽이 비면 hi, 아래·오른쪽이 비면 lo. */
function shadeRows(rows, base, hi, lo) {
  const at = (x, y) => (rows[y] && rows[y][x] && rows[y][x] !== '.') || false;
  return rows.map((r, y) => [...r].map((c, x) => {
    if (c !== base) return c;
    if (!at(x, y - 1) || !at(x - 1, y)) return hi;
    if (!at(x, y + 1) || !at(x + 1, y)) return lo;
    return c;
  }).join(''));
}

function floppyLayer(ox, oy, body, shadeBody) {
  // 11x11 디스켓(오른쪽 위 모서리 깎음)
  const f = [
    'bbbbbbbbbb.',
    'bbwlllllbbb',
    'bbllkllbbbb',
    'bbllkllbbbb',
    'bbllllmbbbb',
    'bbbbbbbbbbb',
    'bwwwwwwwwwb',
    'bwmmmmmmmwb',
    'bwwwwwwwwwb',
    'bwmmmmmwwwb',
    'Bwwwwwwwwwb',
  ];
  const rows = Array.from({ length: 16 }, () => '.'.repeat(16).split(''));
  f.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === '.') return;
    let ch = c;
    if (c === 'b') ch = body;
    if (c === 'B') ch = shadeBody;
    rows[oy + y][ox + x] = ch;
  }));
  // 아래·오른쪽 가장자리 그늘
  for (let y = 0; y < 11; y++) if (rows[oy + y][ox + 10] === body) rows[oy + y][ox + 10] = shadeBody;
  for (let x = 0; x < 11; x++) if (rows[oy + 10][ox + x] === body) rows[oy + 10][ox + x] = shadeBody;
  return rows.map((r) => r.join(''));
}

const L = (s) => s.replace(/\s+/g, '').match(/.{16}/g);

const ICONS = {
  open: [
    // 뒤판 + 탭
    L(`................
       ................
       ................
       .YYYY...........
       .YYYYYYYYYYYY...
       .YYYYYYYYYYYY...
       .YYYYYYYYYYYY...
       .YYYYYYYYYYYY...
       .YYYYYYYYYYYY...
       .YYYYYYYYYYYY...
       .YYYYYYYYYYYY...
       .YYYYYYYYYYYY...
       .YYYYYYYYYYYY...
       .YYYYYYYYYYYY...
       ................
       ................`),
    // 종이
    L(`................
       ................
       ................
       ................
       ................
       ...wwwwwwww.....
       ...wllllllw.....
       ...wwwwwwww.....
       ................
       ................
       ................
       ................
       ................
       ................
       ................
       ................`),
    // 앞판(열려 앞으로 기운 모양)
    L(`................
       ................
       ................
       ................
       ................
       ................
       ................
       ................
       .....yyyyyyyyyy.
       ....yyyyyyyyyyy.
       ....yyyyyyyyyy..
       ...yyyyyyyyyyy..
       ...yyyyyyyyyy...
       ..YYYYYYYYYYY...
       ................
       ................`),
  ],
  games: [
    L(`................
       ................
       ..wwwwwwwww.....
       ..wllllllllm....
       ..wlrrrrrrrlm...
       ..wlrwwwrrrllm..
       ..wlrrrrrrrllm..
       ..wlryyyyyrllm..
       ..wlrrrrrrrllm..
       ..wllllllllllm..
       ..wlkkkkkkkklm..
       ..wllllllllllm..
       ..mmmmmmmmmmmm..
       ................
       ................
       ................`),
  ],
  saves: [
    floppyLayer(4, 1, 'B', 'B'),
    floppyLayer(1, 4, 'b', 'B'),
  ],
  saveExport: [
    floppyLayer(1, 1, 'b', 'B'),
    L(`................
       ................
       ................
       ................
       ................
       ................
       ................
       ................
       ...........g....
       ...........gg...
       ......ggggggGg..
       ......gggggggGg.
       ......ggggggGg..
       ...........gg...
       ...........g....
       ................`.replace(/G/g, 'Y')).map((r) => r.replace(/Y/g, 'g')),
  ],
  saveImport: [
    floppyLayer(1, 1, 'b', 'B'),
    L(`................
       ................
       ................
       ................
       ................
       ................
       ................
       ................
       ........g.......
       .......gg.......
       ......gggggggg..
       .....ggggggggg..
       ......gggggggg..
       .......gg.......
       ........g.......
       ................`),
  ],
  fastForwardOn: [
    L(`................
       ................
       .yy.............
       .yyy............
       .yyyy...........
       .yyyyy..........
       .yyyyyy.........
       .yyyyyyy........
       .yyyyyyy........
       .yyyyyy.........
       .yyyyY..........
       .yyyY...........
       .yyY............
       .YY.............
       ................
       ................`),
    L(`................
       ................
       .......yy.......
       .......yyy......
       .......yyyy.....
       .......yyyyy....
       .......yyyyyy...
       .......yyyyyyy..
       .......yyyyyyy..
       .......yyyyyy...
       .......yyyyY....
       .......yyyY.....
       .......yyY......
       .......YY.......
       ................
       ................`),
  ],
  fastForwardOff: [
    L(`................
       ................
       .ll.............
       .lll............
       .llll...........
       .lllll..........
       .llllll.........
       .lllllll........
       .lllllll........
       .llllll.........
       .llllm..........
       .lllm...........
       .llm............
       .mm.............
       ................
       ................`),
    L(`................
       ................
       .......ll.......
       .......lll......
       .......llll.....
       .......lllll....
       .......llllll...
       .......lllllll..
       .......lllllll..
       .......llllll...
       .......llllm....
       .......lllm.....
       .......llm......
       .......mm.......
       ................
       ................`),
  ],
  settings: [gearLayer()],
  fullscreenEnter: [
    L(`................
       .wwwww....wwwww.
       .wwwww....wwwww.
       .ww..........ww.
       .ww..........ww.
       .ww..........ww.
       ................
       ................
       ................
       ................
       .ww..........ww.
       .ww..........ww.
       .ww..........ww.
       .wwwww....wwwww.
       .wwwww....wwwww.
       ................`),
  ],
  fullscreenExit: [
    L(`................
       ....ww....ww....
       ....ww....ww....
       ....ww....ww....
       .wwwww....wwwww.
       .wwwww....wwwww.
       ................
       ................
       ................
       ................
       .wwwww....wwwww.
       .wwwww....wwwww.
       ....ww....ww....
       ....ww....ww....
       ....ww....ww....
       ................`),
  ],
  soundOn: [
    L(`................
       ................
       ......l.........
       .....ll.........
       ....lll.........
       .wwllll.........
       .wllllm.........
       .wllllm.........
       .wllllm.........
       .wllllm.........
       .mmmmlm.........
       ....mmm.........
       .....mm.........
       ......m.........
       ................
       ................`),
    L(`................
       ................
       ................
       ................
       .........w......
       ..........w.....
       ..........w.....
       ..........w.....
       ..........w.....
       ..........w.....
       .........w......
       ................
       ................
       ................
       ................
       ................`),
    L(`................
       ................
       ..........w.....
       ...........w....
       ............w...
       ............w...
       ............w...
       ............w...
       ............w...
       ............w...
       ............w...
       ............w...
       ...........w....
       ..........w.....
       ................
       ................`),
  ],
  soundOff: [
    L(`................
       ................
       ......l.........
       .....ll.........
       ....lll.........
       .wwllll.........
       .wllllm.........
       .wllllm.........
       .wllllm.........
       .wllllm.........
       .mmmmlm.........
       ....mmm.........
       .....mm.........
       ......m.........
       ................
       ................`),
    L(`................
       ................
       ................
       ................
       ................
       .........r...r..
       ..........r.r...
       ...........r....
       ..........r.r...
       .........r...r..
       ................
       ................
       ................
       ................
       ................
       ................`),
  ],
  close: [
    L(`................
       ................
       ..ww.......ww...
       ..www.....www...
       ...www...www....
       ....www.www.....
       .....wwwww......
       ......www.......
       .....wwwww......
       ....www.www.....
       ...www...www....
       ..www.....www...
       ..ww.......ww...
       ................
       ................
       ................`),
  ],
};

export const ICON_NAMES = Object.keys(ICONS);

function buildIconArt(name) {
  const layers = ICONS[name];
  if (!layers) throw new Error(`pixel-ui: 모르는 아이콘: ${name}`);
  const grid = Array.from({ length: 16 }, () => new Array(16).fill(null));
  for (const rows of layers) {
    const fill = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && rows[y][x] !== '.';
    // 외곽선 먼저
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (fill(x, y)) continue;
      if (fill(x - 1, y) || fill(x + 1, y) || fill(x, y - 1) || fill(x, y + 1)) grid[y][x] = 'iconOutline';
    }
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const c = rows[y][x];
      if (c === '.') continue;
      const role = ICON_CHARS[c];
      if (!role) throw new Error(`pixel-ui: 아이콘 ${name} 모르는 글자 ${c}`);
      grid[y][x] = role;
    }
  }
  // 잉크 기준 가운데로 옮기기(남는 1줄은 오른쪽·아래)
  let x0 = 16, y0 = 16, x1 = -1, y1 = -1;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (grid[y][x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const dx = Math.floor((16 - (x1 - x0 + 1)) / 2) - x0, dy = Math.floor((16 - (y1 - y0 + 1)) / 2) - y0;
  const art = new Art(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (grid[y][x]) art.set(x + dx, y + dy, grid[y][x]);
  return art;
}

const iconArtCache = new Map();
function iconArt(name) {
  let a = iconArtCache.get(name);
  if (!a) { a = buildIconArt(name); iconArtCache.set(name, a); }
  return a;
}

const DISABLED_ICON = { icW: 'icOffHi', icL: 'icOffHi', icY: 'icOffHi', icG: 'icOffHi', icB: 'icOffHi', icM: 'icOffLo', icK: 'icOffLo', icO: 'icOffLo', icR: 'icOffLo', icBd: 'icOffLo', iconOutline: 'iconOutline' };

/** 기능 아이콘 16x16. state 'disabled'면 회색. */
export function renderIcon({ name, state = 'normal', scale = 1, palette } = {}) {
  palette = resolvePalette(palette);
  const s = intScale(scale);
  const st = state === 'disabled' ? 'disabled' : 'normal';
  return cached(palette, `icon|${name}|${st}|${s}`, () => {
    const src = iconArt(name);
    const art = new Art(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = src.get(x, y);
      if (r) art.set(x, y, st === 'disabled' ? DISABLED_ICON[r] : r);
    }
    return finish('icon', art, s, palette, { name, state: st, hit: { x: 0, y: 0, w: 16 * s, h: 16 * s } });
  });
}

/**
 * 기능 버튼(바탕 + 아이콘). state: 'normal'|'pressed'|'on'|'disabled'.
 * 'on'은 켜진 토글(빨리 감기 켬 등), 'pressed'는 누르는 동안.
 */
export function renderIconButton({ name, state = 'normal', scale = 1, palette } = {}) {
  palette = resolvePalette(palette);
  const s = intScale(scale);
  const st = ['pressed', 'on', 'disabled', 'onPressed'].includes(state) ? state : 'normal';
  return cached(palette, `iconButton|${name}|${st}|${s}`, () => {
    const W = 22, H = 22;
    const inside = roundRectInside(W, H, 3, 3, 3, 3);
    const pfx = st === 'disabled' ? 'off' : st === 'on' || st === 'onPressed' ? 'fbOn' : 'fb';
    const roles = { face: pfx, hi: pfx + 'Hi', lo: pfx + 'Lo', side: pfx + 'Side', outline: 'outline', shadow: 'shadow' };
    const { art, faceBox } = extrude({
      W, H, inside, depth: ICON_DEPTH, shadow: ICON_SHADOW,
      offsetAt: () => (st === 'pressed' || st === 'onPressed' ? 1 : 0), roles,
    });
    const src = iconArt(name);
    // 아이콘 잉크 상자를 면 안 가운데로
    let x0 = 16, y0 = 16, x1 = -1, y1 = -1;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (src.get(x, y)) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const iw = x1 - x0 + 1, ih = y1 - y0 + 1;
    const bw = faceBox.x1 - faceBox.x0 + 1, bh = faceBox.y1 - faceBox.y0 + 1;
    const ox = faceBox.x0 + Math.floor((bw - iw) / 2) - x0, oy = faceBox.y0 + Math.floor((bh - ih) / 2) - y0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = src.get(x, y);
      if (r) art.set(x + ox, y + oy, st === 'disabled' ? DISABLED_ICON[r] : r);
    }
    return finish('iconButton', art, s, palette, {
      name, state: st, faceBox, inkBox: { x0: x0 + ox, y0: y0 + oy, x1: x1 + ox, y1: y1 + oy },
      hit: { x: 0, y: 0, w: W * s, h: (H + ICON_DEPTH) * s }, inside, depth: ICON_DEPTH,
    });
  });
}

// ---------------------------------------------------------------------------
// 본체
// ---------------------------------------------------------------------------
function distField(W, H, inside) {
  const d = new Int16Array(W * H);
  const q = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) { d[y * W + x] = 1; q.push(y * W + x); }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % W, y = (i - x) / W, v = d[i];
    // 깊이 제한 없음(안쪽 칸도 모두 채움)
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (d[j] === 0 && inside(nx, ny)) { d[j] = v + 1; q.push(j); }
    }
  }
  return (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[y * W + x]);
}

/** 모양을 판(art)에 칠한다: 외곽선 + 빛 2줄(왼쪽 위 밝게, 오른쪽 아래 어둡게). */
function paintShape(art, x0, y0, W, H, inside, R) {
  const d = distField(W, H, inside);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = d(x, y);
    if (!v) continue;
    let role = R.face;
    if (v === 1) role = R.outline;
    else if (v <= 1 + R.rings.length) {
      const g = d(x + 1, y) - d(x - 1, y) + d(x, y + 1) - d(x, y - 1);
      const ring = R.rings[v - 2];
      role = g > 0 ? ring[0] : g < 0 ? ring[1] : R.face;
    }
    art.set(x0 + x, y0 + y, role);
  }
}

const BODY_R = { outline: 'outline', face: 'body', rings: [['bodyHi2', 'bodyLo2'], ['bodyHi', 'bodyLo']] };
const BEZEL_R = { outline: 'outline', face: 'bezel', rings: [['bezelHi', 'bezelLo']] };
const LOGO = textBitmap('webGBA', SMALL);

function stampRows(art, x, y, rows, role) {
  rows.forEach((r, j) => [...r].forEach((c, i) => { if (c === '#') art.set(x + i, y + j, role); }));
}

/** 빈 자리(px 사각형들) 중 처음 들어가는 곳 가운데에 스피커 구멍. */
function placeSpeaker(art, regions, s, ox, oy) {
  for (const r of regions) {
    if (!r || r.h < 10 * s || r.w < 14 * s) continue;
    const ax = Math.round((r.x + r.w / 2 - ox) / s), ay = Math.round((r.y + r.h / 2 - oy) / s);
    speakerDots(art, ax, ay);
    return rect(ox + (ax - 6) * s, oy + (ay - 4) * s, 13 * s, 9 * s);
  }
  return null;
}

function speakerDots(art, cx, cy) {
  // 엇갈린 구멍 4줄 × 3개(구멍 + 오른쪽 아래 밝은 테)
  const out = [];
  for (let row = 0; row < 4; row++) for (let i = 0; i < 3; i++) {
    const x = cx - 5 + i * 4 + (row % 2 ? 2 : 0), y = cy - 3 + row * 2;
    out.push([x, y]);
  }
  for (const [x, y] of out) {
    if (art.get(x, y) !== 'body') continue;
    art.set(x, y, 'speaker');
    if (art.get(x + 1, y + 1) === 'body') art.set(x + 1, y + 1, 'bodyHi');
  }
}

/** 화면(LCD) 크기 정하기: 정수배가 들어가면 정수배, 아니면 3:2를 지키며 꽉. */
function fitLcd(maxW, maxH, integer) {
  const k = Math.floor(Math.min(maxW / 240, maxH / 160));
  if (integer && k >= 1) return { w: 240 * k, h: 160 * k, k };
  const f = Math.min(maxW / 240, maxH / 160);
  const u = Math.max(1, Math.floor(80 * f));
  return { w: 3 * u, h: 2 * u, k: (3 * u) / 240 };
}

const rect = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });

/** 방향 입력 자리: 패드 캔버스와 스틱 받침을 (cx,cy) 가운데에 맞춤(둘 다 37칸 높이). DIR = 둘을 합친 상자. */
function dirSlots(cx, cy, bs) {
  const dp = partSize('dpad', bs), st = partSize('stick', bs);
  const DPAD = rect(cx - dp.w / 2, cy - dp.h / 2, dp.w, dp.h);
  const STICK = rect(cx - st.w / 2, cy - st.h / 2, st.w, st.h);
  const x0 = Math.min(DPAD.x, STICK.x), y0 = Math.min(DPAD.y, STICK.y);
  const x1 = Math.max(DPAD.x + DPAD.w, STICK.x + STICK.w), y1 = Math.max(DPAD.y + DPAD.h, STICK.y + STICK.h);
  return { DPAD, STICK, DIR: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/** A·B 자리: B 왼쪽 아래, A 오른쪽 위. availW(0 = 가장 좁게, 없음 = 기본)에 맞춰 가로를 벌리고 세로로 겹침을 피함. */
function abCluster(bs, availW) {
  const d = partSize('a', bs), D = d.w;
  let dx = availW === undefined ? 0.42 * D : Math.max(0.3 * D, Math.min(0.5 * D, (availW - D) / 2));
  dx = Math.floor(dx / bs) * bs;
  let dy = Math.sqrt(Math.max(0, (1.06 * D) ** 2 - (2 * dx) ** 2)) / 2;
  dy = Math.ceil(Math.max(dy, 0.14 * D) / bs) * bs;
  return { w: D + 2 * dx, h: d.h + 2 * dy, dx, dy, d };
}

/**
 * 본체를 그린다(캐시된 canvas). 주어진 너비·높이에 맞춰 규칙으로 그린다.
 * @param {object} o
 * @param {'landscape'|'portrait'} o.orientation 가로(GBA풍 가로 본체) | 세로
 * @param {number} o.width 캔버스 픽셀
 * @param {number} o.height
 * @param {number} [o.scale] 본체 아트 픽셀 크기(기본 4)
 * @param {number} [o.buttonScale] 게임 버튼 배율(기본 = 들어가는 가장 큰 값, scale 이하)
 * @param {number} [o.iconScale] 기능 버튼 배율(기본 max(1, scale/2))
 * @param {'framed'|'full'} [o.screen] 화면 테두리 있음 | 가로 꽉(세로 기본 full, 가로 기본 framed)
 * @param {boolean} [o.integerScreen] 정수배 화면 우선(기본 true, full에서는 무시)
 * @param {boolean} [o.label] 'webGBA' 글자(기본 true, 자리 없으면 생략)
 * @returns {{canvas, width, height, layout}}
 */
export function renderBody(o = {}) {
  const pal = resolvePalette(o.palette);
  const orientation = o.orientation === 'portrait' ? 'portrait' : 'landscape';
  const width = Math.max(1, Math.round(o.width || 844)), height = Math.max(1, Math.round(o.height || 390));
  const s = intScale(o.scale || 4);
  const screen = o.screen || (orientation === 'portrait' ? 'full' : 'framed');
  const integerScreen = o.integerScreen !== false;
  const directional = o.directional === 'dpad' ? 'dpad' : 'stick';
  const label = o.label !== false;
  const iconScale = intScale(o.iconScale || Math.max(1, Math.floor(s / 2)));
  const key = `body|${orientation}|${width}x${height}|${s}|${o.buttonScale || 'auto'}|${iconScale}|${screen}|${integerScreen}|${label}|${directional}`;
  return cached(pal, key, () => {
    // 버튼 배율 후보마다 배치해 보고: 들어감 > 화면 큼 > 버튼 큼 순으로 고름
    let res = null, best = -1;
    const maxBs = intScale(o.buttonScale || s);
    for (let bs = maxBs; bs >= (o.buttonScale ? maxBs : 1); bs--) {
      const r = (orientation === 'portrait' ? bodyPortrait : bodyLandscape)({ width, height, s, bs, iconScale, screen, integerScreen, label, directional });
      const score = (r.fits ? 1e9 : 0) + r.layout.screen.w * 100 + bs;
      if (score > best) { best = score; res = r; }
    }
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const sc = artToCanvas(res.art, pal, s);
    ctx.drawImage(sc, res.ox, res.oy);
    if (res.bleed) { // 가로 꽉 화면 띠를 캔버스 양끝까지 늘림
      const { y, h } = res.bleed;
      if (res.ox > 0) {
        ctx.drawImage(sc, 0, y - res.oy, 1, h, 0, y, res.ox, h);
        ctx.drawImage(sc, sc.width - 1, y - res.oy, 1, h, res.ox + sc.width, y, width - res.ox - sc.width, h);
      }
    }
    return { canvas, width, height, layout: res.layout, _art: res.art, _ox: res.ox, _oy: res.oy, _screen: screen };
  });
}

/** 본체를 ctx의 (x,y)에 그리고 배치(layout, x·y만큼 옮긴 값)를 돌려준다. */
export function drawBody(ctx, o = {}) {
  const r = renderBody(o);
  const x = Math.round(o.x || 0), y = Math.round(o.y || 0);
  ctx.drawImage(r.canvas, x, y);
  return shiftLayout(r.layout, x, y);
}

function shiftLayout(l, dx, dy) {
  const mv = (v) => {
    if (Array.isArray(v)) return v.map(mv);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) {
        if ((k === 'x' || k === 'cx') && typeof v[k] === 'number') o[k] = v[k] + dx;
        else if ((k === 'y' || k === 'cy') && typeof v[k] === 'number') o[k] = v[k] + dy;
        else if (k === 'art' || k === 'scale' || k === 'buttonScale' || k === 'iconScale' || k === 'fits' || k === 'orientation' || k === 'directional') o[k] = v[k];
        else o[k] = mv(v[k]);
      }
      return o;
    }
    return v;
  };
  return mv(l);
}

function bodyLandscape({ width, height, s, bs, iconScale, integerScreen, label, directional }) {
  const W = Math.floor(width / s), H = Math.floor(height / s);
  const ox = Math.floor((width - W * s) / 2), oy = Math.floor((height - H * s) / 2);
  const art = new Art(W, H);
  const EDGE = 3, BT = 3, BS = 3, GM = 1;
  const rt = Math.max(3, Math.min(Math.round(H * 0.3), Math.floor(W / 5))), rb = Math.max(4, Math.min(Math.round(H * 0.45), Math.floor(W / 4)));
  paintShape(art, 0, 0, W, H, roundRectInside(W, H, rt, rt, rb, rb), BODY_R);

  // 화면 먼저(높이 기준, 정수배 우선). 날개에는 버튼이 들어갈 최소 폭을 남긴다.
  const pad = bs;
  const sh = partSize('l', bs), pl = partSize('start', bs);
  const stk = partSize('stick', bs), dp = partSize('dpad', bs), dd = { w: Math.max(dp.w, stk.w), h: Math.max(dp.h, stk.h) };
  const abMin = abCluster(bs, 0);
  const wingMin = Math.max(dd.w, sh.w, pl.w, abMin.w) + 2 * pad;
  const lcdFor = (bb) => fitLcd(Math.max(60, width - 2 * (wingMin + (BS + GM) * s)), Math.max(40, (H - 2 * EDGE - BT - bb - 2 * GM) * s), integerScreen);
  let BB = label ? 9 : 4;
  let lcd = lcdFor(BB);
  if (label) { const alt = lcdFor(4); if (alt.w > lcd.w) { BB = 4; lcd = alt; } } // 글자 띠가 화면을 깎으면 글자 생략
  const gW = Math.ceil(lcd.w / s) + 2 * GM, gH = Math.ceil(lcd.h / s) + 2 * GM;
  const bW = gW + 2 * BS, bH = gH + BT + BB;
  const bx = Math.floor((W - bW) / 2);
  const by = EDGE + Math.max(0, Math.floor((H - 2 * EDGE - bH) / 2));
  const gx = bx + BS, gy = by + BT;
  paintShape(art, bx, by, bW, bH, roundRectInside(bW, bH, 4, 4, 4, 4), BEZEL_R);
  const glassIn = roundRectInside(gW, gH, 2, 2, 2, 2);
  for (let y = 0; y < gH; y++) for (let x = 0; x < gW; x++) if (glassIn(x, y)) art.set(gx + x, gy + y, 'glass');
  // 아래 테 글자·램프
  const bandY0 = gy + gH, bandY1 = by + bH - 3;
  let labelBox = null;
  if (BB >= 9 && bandY1 - bandY0 + 1 >= LOGO.length + 2) {
    labelBox = stampCentered(art, { x0: gx, y0: bandY0, x1: gx + gW - 1, y1: bandY1 }, LOGO, 'label');
    const ly = bandY0 + Math.floor((bandY1 - bandY0 + 1 - 2) / 2);
    if (labelBox && labelBox.x0 - (gx + 3) >= 4) { art.set(gx + 2, ly, 'led'); art.set(gx + 3, ly, 'led'); art.set(gx + 2, ly + 1, 'led'); art.set(gx + 3, ly + 1, 'led'); }
  }
  const P = (a) => a * s;
  const glassPx = rect(ox + P(gx), oy + P(gy), P(gW), P(gH));
  const lcdRect = rect(glassPx.x + Math.floor((glassPx.w - lcd.w) / 2), glassPx.y + Math.floor((glassPx.h - lcd.h) / 2), lcd.w, lcd.h);

  // 날개 안 버튼 자리
  const lx0 = ox + P(EDGE), lx1 = ox + P(bx) - pad, rx0 = ox + P(bx + bW) + pad, rx1 = ox + P(W - EDGE);
  const lw = lx1 - lx0, rw = rx1 - rx0;
  const top = oy + P(EDGE), bottom = oy + P(H - EDGE);
  const L = rect(lx0 + (lw - sh.w) / 2, top + pad, sh.w, sh.h);
  const R = rect(rx0 + (rw - sh.w) / 2, top + pad, sh.w, sh.h);
  const gap = 2 * bs;
  // START·SELECT: 왼쪽 날개에 위아래로 들어가면 GBA처럼 왼쪽, 아니면 SELECT 왼쪽·START 오른쪽
  const leftNeedStacked = sh.h + dd.h + 2 * pl.h + gap + 4 * pad;
  const stacked = bottom - top >= leftNeedStacked;
  const SELECT = rect(lx0 + (lw - pl.w) / 2, bottom - pad - pl.h, pl.w, pl.h);
  const START = stacked ? rect(SELECT.x, SELECT.y - gap - pl.h, pl.w, pl.h) : rect(rx0 + (rw - pl.w) / 2, bottom - pad - pl.h, pl.w, pl.h);
  const leftBottomTop = stacked ? START.y : SELECT.y;
  const cy = Math.round((L.y + L.h + leftBottomTop) / 2);
  const { DPAD, STICK, DIR } = dirSlots(lx0 + lw / 2, cy, bs);
  const ab = abCluster(bs, rw - 2 * pad);
  const acx = rx0 + rw / 2;
  const rightBottomTop = stacked ? bottom : START.y;
  const half = ab.dy + ab.d.h / 2;
  const cyR = Math.round(Math.min(Math.max(cy, R.y + R.h + pad + half), rightBottomTop - pad - half));
  const A = rect(acx + ab.dx - ab.d.w / 2, cyR - ab.dy - ab.d.h / 2, ab.d.w, ab.d.h);
  const B = rect(acx - ab.dx - ab.d.w / 2, cyR + ab.dy - ab.d.h / 2, ab.d.w, ab.d.h);
  const abTop = Math.min(A.y, B.y), abBot = Math.max(A.y + A.h, B.y + B.h);
  // 빈 자리: 기능 버튼(가장 높은 곳) → 스피커(남은 곳, 없으면 기능 버튼 자리 아래를 나눔)
  const ib = partSize('iconButton', iconScale);
  const free = [
    rect(rx0, abBot + pad, rw, rightBottomTop - pad - (abBot + pad)),
    rect(rx0, R.y + R.h + pad, rw, abTop - pad - (R.y + R.h + pad)),
    rect(lx0, DIR.y + DIR.h + pad, lw, leftBottomTop - pad - (DIR.y + DIR.h + pad)),
    rect(lx0, L.y + L.h + pad, lw, DIR.y - pad - (L.y + L.h + pad)),
  ].filter((r) => r.h > 0 && r.w > 0);
  let menu = null;
  for (const r of free) if (r.h >= ib.h && r.w >= ib.w && (!menu || r.h > menu.h)) menu = r;
  let rest = free.filter((r) => r !== menu);
  if (menu && menu.h >= ib.h + pad + 10 * s && !rest.some((r) => r.h >= 10 * s && r.w >= 14 * s)) {
    const sp = rect(menu.x, menu.y + menu.h - 10 * s, menu.w, 10 * s);
    menu = rect(menu.x, menu.y, menu.w, menu.h - 10 * s - pad);
    rest = [sp];
  }
  const speaker = placeSpeaker(art, rest, s, ox, oy);
  const fits = DIR.y >= L.y + L.h && DIR.y + DIR.h <= leftBottomTop && abTop >= R.y + R.h && abBot <= rightBottomTop
    && lw >= Math.max(dd.w, sh.w, pl.w) && rw >= Math.max(ab.w, sh.w, pl.w);
  return {
    art, ox, oy, lcd,
    layout: {
      orientation: 'landscape', fits, scale: s, buttonScale: bs, iconScale,
      art: { w: W, h: H },
      screen: lcdRect, glass: glassPx, bezel: rect(ox + P(bx), oy + P(by), P(bW), P(bH)),
      directional, slots: { l: L, r: R, dir: directional === 'dpad' ? DPAD : STICK, dpad: DPAD, stick: STICK, a: A, b: B, start: START, select: SELECT, menu },
      speaker, label: labelBox ? rect(ox + P(labelBox.x0), oy + P(labelBox.y0), P(labelBox.x1 - labelBox.x0 + 1), P(labelBox.y1 - labelBox.y0 + 1)) : null,
    },
    fits,
  };
}

function bodyPortrait({ width, height, s, bs, iconScale, screen, integerScreen, label, directional }) {
  const W = Math.floor(width / s), H = Math.floor(height / s);
  const ox = Math.floor((width - W * s) / 2), oy = Math.floor((height - H * s) / 2);
  const art = new Art(W, H);
  const EDGE = 3, GM = 1;
  const full = screen === 'full';
  const BS = full ? 0 : 3, BT = full ? 2 : 3, BB = label ? 9 : (full ? 2 : 4);
  const rt = Math.max(3, Math.round(W * 0.05)), rb = Math.max(5, Math.round(W * 0.14));
  paintShape(art, 0, 0, W, H, roundRectInside(W, H, rt, rt, rb, rb), BODY_R);

  // 맨 위 기능 버튼 줄
  const ib = partSize('iconButton', iconScale);
  const barPad = Math.max(2 * iconScale, s);
  const barH = Math.ceil((ib.h + 2 * barPad) / s);
  const topBar = rect(ox + EDGE * s, oy + EDGE * s, (W - 2 * EDGE) * s, barH * s - EDGE * s + barPad);
  const bandTop = barH + 1;

  let lcd, gx, gW, gH, bx, bW;
  if (full) {
    lcd = { w: width, h: Math.round((width * 2) / 3) };
    gW = W; gH = Math.ceil(lcd.h / s) + 2 * GM; bx = 0; bW = W; gx = 0;
  } else {
    const maxW = (W - 2 * (EDGE + 1 + BS + GM)) * s;
    lcd = fitLcd(maxW, height * 0.45, integerScreen);
    gW = Math.ceil(lcd.w / s) + 2 * GM; gH = Math.ceil(lcd.h / s) + 2 * GM;
    bW = gW + 2 * BS; bx = Math.floor((W - bW) / 2); gx = bx + BS;
  }
  const bH = gH + BT + BB, by = bandTop, gy = by + BT;
  if (full) {
    // 가로 꽉 띠: 위·아래만 외곽선, 양끝은 캔버스 끝까지
    const bandIn = (x, y) => x >= 0 && y >= 0 && x < bW && y < bH;
    for (let y = 0; y < bH; y++) for (let x = 0; x < bW; x++) {
      let role = 'bezel';
      if (y === 0 || y === bH - 1) role = 'outline';
      else if (y === 1) role = 'bezelHi';
      else if (y === bH - 2) role = 'bezelLo';
      art.set(x, by + y, role);
    }
    void bandIn;
  } else {
    paintShape(art, bx, by, bW, bH, roundRectInside(bW, bH, 4, 4, 4, 4), BEZEL_R);
  }
  const glassIn = full ? (x, y) => x >= 0 && y >= 0 && x < gW && y < gH : roundRectInside(gW, gH, 2, 2, 2, 2);
  for (let y = 0; y < gH; y++) for (let x = 0; x < gW; x++) if (glassIn(x, y)) art.set(gx + x, gy + y, 'glass');
  const bandY0 = gy + gH, bandY1 = by + bH - 3;
  let labelBox = null;
  if (label && bandY1 - bandY0 + 1 >= LOGO.length + 2) {
    const cx0 = full ? EDGE : gx, cx1 = full ? W - 1 - EDGE : gx + gW - 1;
    labelBox = stampCentered(art, { x0: cx0, y0: bandY0, x1: cx1, y1: bandY1 }, LOGO, 'label');
    const ly = bandY0 + Math.floor((bandY1 - bandY0 + 1 - 2) / 2);
    const lx = cx0 + (full ? 3 : 2);
    if (labelBox && labelBox.x0 - (lx + 1) >= 4) { art.set(lx, ly, 'led'); art.set(lx + 1, ly, 'led'); art.set(lx, ly + 1, 'led'); art.set(lx + 1, ly + 1, 'led'); }
  }
  const P = (a) => a * s;
  const glassPx = full ? rect(0, oy + P(gy), width, P(gH)) : rect(ox + P(gx), oy + P(gy), P(gW), P(gH));
  const lcdRect = full
    ? rect(0, glassPx.y + Math.floor((glassPx.h - lcd.h) / 2), lcd.w, lcd.h)
    : rect(glassPx.x + Math.floor((glassPx.w - lcd.w) / 2), glassPx.y + Math.floor((glassPx.h - lcd.h) / 2), lcd.w, lcd.h);

  // 아래 버튼 자리
  const pad = 3 * bs;
  const dp = partSize('dpad', bs), sh = partSize('l', bs), pl = partSize('start', bs), ab = abCluster(bs);
  const stk = partSize('stick', bs), dd = { w: Math.max(dp.w, stk.w), h: Math.max(dp.h, stk.h) };
  const cTop = oy + P(by + bH) + pad, cBot = oy + P(H - EDGE) - pad;
  const cL = ox + P(EDGE) + pad, cR = ox + P(W - EDGE) - pad;
  const L = rect(cL, cTop, sh.w, sh.h);
  const R = rect(cR - sh.w, cTop, sh.w, sh.h);
  const gapP = Math.round(6 * bs);
  const pillsW = 2 * pl.w + gapP;
  const SELECT = rect((cL + cR) / 2 - pillsW / 2, cBot - pl.h, pl.w, pl.h);
  const START = rect(SELECT.x + pl.w + gapP, SELECT.y, pl.w, pl.h);
  const cy = Math.round((L.y + L.h + SELECT.y) / 2);
  const { DPAD, STICK, DIR } = dirSlots(cL + Math.max(dd.w / 2, (cR - cL) / 4), cy, bs);
  const acx = cR - Math.max(ab.w / 2, ((cR - cL) / 2) / 2);
  const A = rect(acx + ab.dx - ab.d.w / 2, cy - ab.dy - ab.d.h / 2, ab.d.w, ab.d.h);
  const B = rect(acx - ab.dx - ab.d.w / 2, cy + ab.dy - ab.d.h / 2, ab.d.w, ab.d.h);
  // 스피커: 오른쪽 A·B 아래 → 왼쪽 방향 입력 아래
  const mid = (cL + cR) / 2, abBot = Math.max(A.y + A.h, B.y + B.h);
  const speaker = placeSpeaker(art, [
    rect(mid, abBot + pad, cR - mid, START.y - pad - (abBot + pad)),
    rect(cL, DIR.y + DIR.h + pad, mid - cL, SELECT.y - pad - (DIR.y + DIR.h + pad)),
  ], s, ox, oy);
  const fits = DIR.y >= L.y + L.h && DIR.y + DIR.h <= SELECT.y && A.y >= R.y + R.h && B.y + B.h <= SELECT.y + pl.h
    && DIR.x + DIR.w <= B.x && cTop < cBot;
  return {
    art, ox, oy,
    bleed: full ? { y: oy + P(by), h: P(bH) } : null,
    layout: {
      orientation: 'portrait', fits, scale: s, buttonScale: bs, iconScale,
      art: { w: W, h: H },
      screen: lcdRect, glass: glassPx, bezel: full ? rect(0, oy + P(by), width, P(bH)) : rect(ox + P(bx), oy + P(by), P(bW), P(bH)),
      directional, slots: { topBar, l: L, r: R, dir: directional === 'dpad' ? DPAD : STICK, dpad: DPAD, stick: STICK, a: A, b: B, start: START, select: SELECT },
      speaker, label: labelBox ? rect(ox + P(labelBox.x0), oy + P(labelBox.y0), P(labelBox.x1 - labelBox.x0 + 1), P(labelBox.y1 - labelBox.y0 + 1)) : null,
    },
    fits,
  };
}

// ---------------------------------------------------------------------------
// 시험용: 아트 버퍼 꺼내기(색 수·외곽선·가운데 측정)
// ---------------------------------------------------------------------------
/** render 결과의 아트 버퍼({w,h,px,roles}). 시험·검사용. */
export function debugArt(render) {
  const a = render._art;
  return { w: a.w, h: a.h, px: a.px, roles: a.roles.slice() };
}
