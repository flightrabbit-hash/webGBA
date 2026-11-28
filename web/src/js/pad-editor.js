// 모바일 패드 자율배치 에디터: "직접 배치"(custom) 배치에서 조작부를 화면 위에서 끌어 옮기고(자유 위치),
// 모서리로 크기(같은 비율)·변으로 가로만·세로만 바꾸고, 테마 색 안에서 색을 고른다. 가로·세로 배치를 따로 저장한다.
// 순수 함수(데이터 모델·좌표·색 계산)는 node 로 바로 시험한다 — 아래 export. 편집 UI(PadEditor)는 브라우저에서만 생성.
import { SIZES, KEYPAD_GAP, partSize } from "./pixel-ui.js";
import { keyMargin, dirReach } from "./pad.js";

export const PAD_PLACEMENTS = ["default", "big", "custom"];
export const SCALE_MIN = 0.75;
export const SCALE_MAX = 2;
export const SNAP_GRID = 8;
export const SNAP_TOL = 6;

// 편집 단위(조작부). 버튼은 각각 독립(A·B·C·D·RS 따로). keys = skin 배율을 거는 part 이름,
// colorKeys = 색을 거는 part(없으면 keys), colorDefault = 자동 색의 색 고르기 id. screen 은 게임 화면(색 없음).
// sig: false = 레이아웃 키(signature)에 넣지 않는 조작부 — 소프트 키("-" 알약, .wmba 의 soft1·soft2 = 휴대폰 왼쪽·오른쪽
// 소프트 키)는 숫자 키패드에 딸린 키라 키패드 집합 키("dir,keypad")를 그대로 두고 따로 옮기기·크기·색만 한다.
export const CONTROLS = [
  { id: "dir", sel: "[data-dpad]", keys: ["dir"], colorDefault: "button" },
  { id: "a", sel: ".key--a", keys: ["A"], colorDefault: "accent" },
  { id: "b", sel: ".key--b", keys: ["B"], colorDefault: "accent" },
  { id: "c", sel: ".key--c", keys: ["C"], colorDefault: "cd" },
  { id: "d", sel: ".key--d", keys: ["D"], colorDefault: "cd" },
  { id: "rs", sel: ".key--rs", keys: ["RS"], colorDefault: "rs" },
  { id: "L", sel: ".key--l", keys: ["L"], colorDefault: "button" },
  { id: "R", sel: ".key--r", keys: ["R"], colorDefault: "button" },
  { id: "L3", sel: ".key--l3", keys: ["L3"], colorDefault: "button" },
  { id: "START", sel: ".key--start", keys: ["START"], colorDefault: "pill" },
  { id: "SELECT", sel: ".key--select", keys: ["SELECT"], colorDefault: "pill" },
  { id: "keypad", sel: ".keypad", keys: ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "STAR", "N0", "HASH", "CLEAR", "OK"], colorDefault: "button" },
  { id: "soft1", sel: ".key--soft1", keys: ["SOFT1"], colorDefault: "pill", sig: false },
  { id: "soft2", sel: ".key--soft2", keys: ["SOFT2"], colorDefault: "pill", sig: false },
  { id: "screen", sel: ".stage", keys: [], color: false },
];
export const CONTROL_BY_ID = Object.fromEntries(CONTROLS.map((c) => [c.id, c]));
const SOFT_IDS = ["soft1", "soft2"];
const KEYPAD_INLINE = ["--keypad-gap", "column-gap", "grid-template-columns"]; // 키패드 자유 비율 간격(keypadGap)

export const orientationKey = (landscape) => (landscape ? "landscape" : "portrait");

// 레이아웃 키 = 그 게임이 쓰는 조작부 집합(signature). 같은 집합이면 공유, 다르면 별도(화면 제외, 정렬 — 결정적).
export function layoutSignature(ids) {
  const seen = new Set(ids.filter((id) => id && id !== "screen"));
  return [...seen].sort().join(",") || "default";
}

// 한 방향 레코드 정리: { controls: { id:{x,y,scale,color} } }. 모르는 값은 버린다.
function normalizeSide(raw) {
  const out = {};
  for (const orient of ["landscape", "portrait"]) {
    const side = raw?.[orient];
    if (!side || typeof side !== "object") continue;
    const controls = {};
    for (const c of CONTROLS) {
      const rec = side.controls?.[c.id];
      if (!rec || typeof rec !== "object") continue;
      const clean = {};
      if (Number.isFinite(rec.x)) clean.x = Math.min(1, Math.max(0, rec.x));
      if (Number.isFinite(rec.y)) clean.y = Math.min(1, Math.max(0, rec.y));
      if (Number.isFinite(rec.scale)) clean.scale = clampScale(rec.scale);
      if (c.id !== "screen" && Number.isFinite(rec.sx) && Number.isFinite(rec.sy)) setBox(clean, rec.sx, rec.sy);
      if (c.color !== false && typeof rec.color === "string") clean.color = rec.color;
      if (Object.keys(clean).length) controls[c.id] = clean;
    }
    // 예전 저장(소프트 키가 키패드에 묶여 키패드 크기·색을 함께 받던 때): 소프트 키 값이 없으면 키패드 크기·색을 물려받는다.
    // 자리는 비워 두어 기본 자리(키패드 위 양옆)에 놓인다 — 저장 당시 보이던 모습 그대로.
    const pad = controls.keypad;
    if (pad && (pad.scale || pad.color)) {
      for (const id of SOFT_IDS) {
        if (controls[id]) continue;
        controls[id] = {};
        if (pad.scale) controls[id].scale = pad.scale;
        if (pad.color) controls[id].color = pad.color;
      }
    }
    if (Object.keys(controls).length) out[orient] = { controls };
  }
  return out;
}

// 저장 레이아웃 정리: { [signature]: { landscape:{controls}, portrait:{controls} } }. 빈 것은 버린다.
export function normalizeLayout(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [sig, side] of Object.entries(raw)) {
    if (!sig || typeof side !== "object") continue;
    const norm = normalizeSide(side);
    if (Object.keys(norm).length) out[sig] = norm;
  }
  return out;
}

export const hasLayout = (layout, landscape, sig) => {
  const side = layout?.[sig]?.[orientationKey(landscape)];
  return Boolean(side && Object.keys(side.controls ?? {}).length);
};

export const clampScale = (mul) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Number(mul) || 1));
export const scalePercent = (mul) => Math.round((Number(mul) || 1) * 100);

// 자유 비율(가로·세로 따로). 레코드 = { scale, sx?, sy? } — scale = 그림 배율(같은 비율, 0.75~2, 예전 형식 그대로),
// sx·sy = 상자 가로·세로 배율(기본 크기 기준, 0.75~4). sx·sy 가 없으면 상자 = scale(같은 비율 — 예전 저장 배치).
// 그림 배율은 늘 둘 중 작은 값이라 픽셀이 뭉개지지 않고, 남는 쪽은 skin 이 칸 수(둥근 사각형)·상자(둥근 버튼·방향)로 늘린다.
// 화면(게임 그림)은 비율을 지킨다 — sx·sy 없음.
export const STRETCH_MAX = 4;
const SAME_RATIO = 0.005;
export const clampBox = (mul) => Math.min(STRETCH_MAX, Math.max(SCALE_MIN, Number(mul) || 1));

export function boxScale(rec) {
  const s = Number.isFinite(rec?.scale) ? rec.scale : 1;
  return { x: Number.isFinite(rec?.sx) ? rec.sx : s, y: Number.isFinite(rec?.sy) ? rec.sy : s };
}

// 그림 배율 위에 더 늘리는 가로·세로 배(1 이상).
export function stretchOf(rec) {
  const box = boxScale(rec);
  const art = Number.isFinite(rec?.scale) ? rec.scale : Math.min(box.x, box.y);
  return { x: Math.max(1, box.x / art), y: Math.max(1, box.y / art) };
}

export const isStretched = (rec) => {
  const st = stretchOf(rec);
  return st.x > 1 + SAME_RATIO || st.y > 1 + SAME_RATIO;
};

// 상자 배율을 정한다. 같은 비율(그리고 2 이하)이면 sx·sy 를 지워 예전 형식({scale})으로 남긴다.
export function setBox(rec, x, y) {
  const bx = clampBox(x);
  const by = clampBox(y);
  if (Math.abs(bx - by) <= SAME_RATIO && bx <= SCALE_MAX) {
    rec.scale = clampScale(bx);
    delete rec.sx;
    delete rec.sy;
  } else {
    rec.scale = clampScale(Math.min(bx, by));
    rec.sx = bx;
    rec.sy = by;
  }
  return rec;
}

// 키패드를 가로·세로 따로 늘였을 때 칸 간격(css px). 키는 칸 수로 늘리고(pixel-ui stretchLen 과 같은 반올림), 남는 길이는
// 간격이 채워 키패드 상자 = 기본 크기(배율 1) × sx·sy 가 정확히 맞는다 — 가로 100% 로 맞춘 뒤 세로를 바꿔도 가로가 그대로.
// 키패드 모양(web.css .keypad): 3칸 × (숫자 4줄 + CLR·OK 1줄), 줄 사이와 CLR·OK 줄 위 여백이 같은 간격.
// unit = 배율 1 의 아트 1칸(css px), keyUnit = 지금 그림 배율의 아트 1칸(css px).
export function keypadGaps({ unit, keyUnit, box, stretch }) {
  const len = (base, mul) => Math.max(base, Math.round(base * mul));
  const extra = partSize("num", 1).h - SIZES.num.h; // 키 아래 옆면·그림자 칸
  const lastBase = Math.max(SIZES.clearKey.h, SIZES.action.h);
  const keyW = len(SIZES.num.w, stretch.x) * keyUnit;
  const numH = (len(SIZES.num.h, stretch.y) + extra) * keyUnit;
  const lastH = (Math.max(len(SIZES.clearKey.h, stretch.y), len(SIZES.action.h, stretch.y)) + extra) * keyUnit;
  const baseW = (3 * SIZES.num.w + 2 * KEYPAD_GAP) * unit;
  const baseH = (4 * (SIZES.num.h + extra) + lastBase + extra + 5 * KEYPAD_GAP) * unit;
  // key = 칸 폭 — 칸을 이 폭으로 고정해 두 칸에 걸친 OK 가 반올림으로 1px 넓어도 칸이 벌어지지 않게(간격 쪽으로 넘침).
  return { key: keyW, col: Math.max(0, (baseW * box.x - 3 * keyW) / 2), row: Math.max(0, (baseH * box.y - 4 * numH - lastH) / 5) };
}

// 겹친 조작부 떼어 놓기("크게" 배치). items = [{ x, y, w, h, shape }] 가운데·크기(px, 움직임), fixed = 움직이지 않는 것(게임 화면).
// 모양: round = 상자 위쪽에 붙은 원(지름 = 폭, 아래는 옆면·그림자 — A·B·C·D), disc = 상자 가운데 원(방향), box = 상자.
// 겹친 짝마다 겹친 만큼 서로 반씩(장애물이면 혼자 다) 밀고 화면 안에 둔다 — 겹침이 없어지거나 정한 횟수까지 되풀이.
const ROUND_IDS = new Set(["a", "b", "c", "d"]);
// 반환 = 끝내 겹친 채 남은 짝의 id 목록([[id, id], …]) — 자리가 모자라면 부른 쪽이 크기를 줄여 다시 한다.
export function separate(items, fixed, W, H, { rounds = 120, edge = 4, gap = 2 } = {}) {
  // 간격 gap 만큼 모양을 반씩 부풀려 잰다(맞닿은 둘 사이 gap px).
  const g = gap / 2;
  const shapeOf = (it) => {
    if (it.shape === "round") return { circle: true, cx: it.x, cy: it.y - it.h / 2 + it.w / 2, r: it.w / 2 + g };
    if (it.shape === "disc") return { circle: true, cx: it.x, cy: it.y, r: Math.min(it.w, it.h) / 2 + g };
    return { circle: false, cx: it.x, cy: it.y, hw: it.w / 2 + g, hh: it.h / 2 + g };
  };
  const sign = (v) => (v < 0 ? -1 : 1);
  // p 를 밀 방향(단위)·거리. 안 겹치면 null.
  const overlap = (p, q) => {
    if (p.circle && q.circle) {
      const dx = p.cx - q.cx;
      const dy = p.cy - q.cy;
      const dist = Math.hypot(dx, dy);
      const need = p.r + q.r - dist;
      if (need <= 0.5) return null;
      return dist < 1e-6 ? { ux: 1, uy: 0, d: need } : { ux: dx / dist, uy: dy / dist, d: need };
    }
    if (!p.circle && !q.circle) {
      const dx = p.cx - q.cx;
      const dy = p.cy - q.cy;
      const ox = p.hw + q.hw - Math.abs(dx);
      const oy = p.hh + q.hh - Math.abs(dy);
      if (ox <= 0.5 || oy <= 0.5) return null;
      return ox < oy ? { ux: sign(dx), uy: 0, d: ox } : { ux: 0, uy: sign(dy), d: oy };
    }
    const flip = !p.circle;
    const c = flip ? q : p;
    const b = flip ? p : q;
    const nx = Math.max(b.cx - b.hw, Math.min(c.cx, b.cx + b.hw));
    const ny = Math.max(b.cy - b.hh, Math.min(c.cy, b.cy + b.hh));
    const vx = c.cx - nx;
    const vy = c.cy - ny;
    const dist = Math.hypot(vx, vy);
    let hit = null;
    if (dist > 1e-6) {
      const need = c.r - dist;
      if (need > 0.5) hit = { ux: vx / dist, uy: vy / dist, d: need };
    } else {
      const dx = c.cx - b.cx;
      const dy = c.cy - b.cy;
      const ox = b.hw + c.r - Math.abs(dx);
      const oy = b.hh + c.r - Math.abs(dy);
      hit = ox < oy ? { ux: sign(dx), uy: 0, d: ox } : { ux: 0, uy: sign(dy), d: oy };
    }
    if (!hit) return null;
    return flip ? { ux: -hit.ux, uy: -hit.uy, d: hit.d } : hit;
  };
  // 같은 group 은 한 덩어리로 움직인다(A·B·C·D·RS 의 서로 자리, START·SELECT 줄 등 모양이 흐트러지지 않게) — 덩어리 안 짝은 재지 않음.
  const bodyOf = (it) => items.filter((o) => (it.group !== undefined ? o.group === it.group : o === it));
  const move = (body, dx, dy) => {
    for (const o of body) {
      o.x += dx;
      o.y += dy;
    }
  };
  // 화면 안(가장자리 edge px 여유, 들어가지 않으면 가운데) — 덩어리 둘레 상자 기준.
  const keepIn = (body) => {
    const fit = (lo, hi, max) => (hi - lo + edge * 2 >= max ? max / 2 - (lo + hi) / 2 : lo < edge ? edge - lo : hi > max - edge ? max - edge - hi : 0);
    const l = Math.min(...body.map((o) => o.x - o.w / 2));
    const r = Math.max(...body.map((o) => o.x + o.w / 2));
    const t = Math.min(...body.map((o) => o.y - o.h / 2));
    const b = Math.max(...body.map((o) => o.y + o.h / 2));
    move(body, fit(l, r, W), fit(t, b, H));
  };
  const apart = (p, q) => p.group === undefined || p.group !== q.group;
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (!apart(items[i], items[j])) continue;
        const hit = overlap(shapeOf(items[i]), shapeOf(items[j]));
        if (!hit) continue;
        const a = bodyOf(items[i]);
        const b = bodyOf(items[j]);
        move(a, (hit.ux * hit.d) / 2, (hit.uy * hit.d) / 2);
        move(b, (-hit.ux * hit.d) / 2, (-hit.uy * hit.d) / 2);
        keepIn(a);
        keepIn(b);
        moved = true;
      }
      for (const wall of fixed) {
        const hit = overlap(shapeOf(items[i]), shapeOf(wall));
        if (!hit) continue;
        const a = bodyOf(items[i]);
        move(a, hit.ux * hit.d, hit.uy * hit.d);
        keepIn(a);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const left = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) if (apart(items[i], items[j]) && overlap(shapeOf(items[i]), shapeOf(items[j]))?.d > gap + 1) left.push([items[i].id, items[j].id]);
    for (const wall of fixed) if (overlap(shapeOf(items[i]), shapeOf(wall))?.d > gap + 1) left.push([items[i].id, wall.id]);
  }
  return left;
}

// 크기 표시: 같은 비율 "120%", 따로면 "가로×세로%"(예: "240×100%").
export function sizeText(rec) {
  const box = boxScale(rec);
  const x = scalePercent(box.x);
  const y = scalePercent(box.y);
  return x === y ? `${x}%` : `${x}×${y}%`;
}

// 배율은 기기 픽셀 정수 단위로 커진다 — 지금 배율의 기기 픽셀 수(basePx×mul)를 1칸씩 바꾼 뒤 다시 곱으로.
export function scaleStep(mul, dir, basePx) {
  const px = Math.max(1, Math.round((basePx || 1) * (Number(mul) || 1)));
  const next = Math.max(1, px + (dir > 0 ? 1 : -1));
  return clampScale(next / (basePx || 1));
}

// 상자(w×h)의 가운데를 테두리(W×H) 안에 둔다. 상자가 더 크면 가운데로.
export function clampCenter(cx, cy, w, h, W, H) {
  const fix = (v, size, max) => {
    const half = size / 2;
    if (size >= max) return max / 2;
    return Math.min(max - half, Math.max(half, v));
  };
  return { cx: fix(cx, w, W), cy: fix(cy, h, H) };
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 스냅: 8px 격자 + 다른 조작부/테두리의 가운데·가장자리 정렬선. others = [{cx,cy,left,right,top,bottom}], box = 지금 끄는 상자.
// 반환 = 맞춘 가운데 + 그려 줄 정렬선(viewport 기준 x/y). snapOn=false 면 격자·정렬 없이 그대로.
export function snapCenter(cx, cy, w, h, container, others, { grid = SNAP_GRID, tol = SNAP_TOL, snapOn = true } = {}) {
  const guides = [];
  if (!snapOn) return { cx, cy, guides };
  const edges = (c, size) => [c - size / 2, c, c + size / 2];
  const axis = (center, size, lines, lo, hi) => {
    const mine = edges(center, size);
    let bestShift = null;
    let bestLine = null;
    for (const [i, m] of mine.entries()) {
      for (const g of lines) {
        if (near(m, g, tol)) {
          const shift = g - m;
          if (bestShift === null || Math.abs(shift) < Math.abs(bestShift)) {
            bestShift = shift;
            bestLine = g;
          }
        }
      }
      void i;
    }
    if (bestShift !== null) return { center: center + bestShift, line: bestLine };
    const snapped = Math.round(center / grid) * grid;
    return { center: snapped, line: null };
  };
  const xLines = [container.left + container.w / 2];
  const yLines = [container.top + container.h / 2];
  for (const o of others) {
    xLines.push(o.cx, o.left, o.right);
    yLines.push(o.cy, o.top, o.bottom);
  }
  const rx = axis(cx, w, xLines);
  const ry = axis(cy, h, yLines);
  if (rx.line !== null) guides.push({ x: rx.line });
  if (ry.line !== null) guides.push({ y: ry.line });
  return { cx: rx.center, cy: ry.center, guides };
}

// 테마 팔레트에서 뽑은 색 집합(동적 팔레트 면 색) — 색 고르기에서 이 안에서만 선택. 같은 색은 한 번만.
export function colorChoices(palette) {
  const raw = [
    ["accent", palette.ab],
    ["cd", palette.cd],
    ["rs", palette.rs],
    ["button", palette.btn],
    ["pill", palette.pill],
    ["tintHi", palette.bodyHi2],
    ["well", palette.well],
  ];
  const out = [];
  const seen = new Set();
  for (const [id, hex] of raw) {
    if (!hex) continue;
    const key = String(hex).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, hex: key });
  }
  return out;
}

export const colorHexOf = (palette, id) => colorChoices(palette).find((c) => c.id === id)?.hex ?? "";

// 조작부에 지금 적용 중인 색 id(지정 없으면 기본 색). 색 고르기에서 체크 표시할 값.
export const activeColorId = (control, rec) => rec?.color ?? control.colorDefault ?? null;

// --------------------------------------------------------------------------
// 편집 UI (브라우저 전용). deps 로 main 의 함수·상태를 받는다(순환 import 방지).
// --------------------------------------------------------------------------
export class PadEditor {
  constructor() {
    this.deps = null;
    this.editing = false;
    this.orient = "landscape";
    this.work = null; // 편집 중 작업 사본
    this.before = null; // 취소 복원용
    this.selected = null; // 선택한 control id
    this.snapOn = true;
    this.overlay = null;
    this.frames = new Map(); // control id → 점선 테두리/손잡이 node
    this.drag = null;
    this.raf = 0;
    this.pending = null;
    this.setKind = "game"; // 편집 중인 조작부 집합(game·cd·rs·cdrs·keypad)
    this.workBySig = {}; // 세션 동안 signature 별 작업본(집합 전환해도 배치 유지)
    this.defaultsBySig = {}; // signature 별 기본 배치(기본 배치로 되돌리기용)
  }

  // 편집에서 고를 수 있는 조작부 집합(강제 표시). 현재 게임 + 추가 버튼.
  static SETS = ["game", "cd", "rs", "cdrs", "keypad"];

  init(deps) {
    this.deps = deps;
  }

  ctlName(id) {
    return this.deps.ctlName?.(id) ?? this.deps.t(`web.pad.ctl.${id}`);
  }

  placement() {
    const p = this.deps.prefs().padPlacement;
    return PAD_PLACEMENTS.includes(p) ? p : "default";
  }

  layout() {
    return normalizeLayout(this.deps.prefs().padLayout);
  }

  // 지금 방향에 자유 배치를 적용할지. custom = 이 게임 집합의 저장된 방향만, big = 항상(프리셋).
  freeActive(landscape) {
    const place = this.placement();
    if (place === "big") return true;
    if (place === "custom") return this.editing || hasLayout(this.layout(), landscape, this.currentSig());
    return false;
  }

  // layout() 끝에서 호출. 자유 배치가 아니면 skin override 를 비우고 자유 CSS 를 끄고 끝낸다.
  apply() {
    const { body } = this.deps;
    const landscape = this.deps.landscape();
    this.orient = orientationKey(landscape);
    const free = this.deps.padOn() && this.freeActive(landscape);
    if (!free) {
      // 기본·크게 아님: 자유 배치 흔적이 있을 때만 되돌린다(기본 사용자는 매 layout 마다 비용 0).
      if (body.hasAttribute("data-pad-free")) {
        body.removeAttribute("data-pad-free");
        this.clearInline();
        this.deps.skin().setOverrides({});
      }
      if (this.editing) this.exit(false);
      return;
    }
    this.defaultsCache = null;
    const model = this.editing ? this.work : this.placement() === "big" ? this.bigLayout(landscape) : this.sideFor(this.currentSig(), landscape);
    this.model = model ?? { controls: {} };
    body.setAttribute("data-pad-free", "");
    this.applyModel(this.model);
    if (this.editing) this.syncFrames();
  }

  // 모델 → skin 배율·색·늘림 override 묶음. 색 id → 지금 테마 hex.
  overridesFromWork(model) {
    const palette = this.deps.skin().palette;
    const scaleMul = {};
    const colorHex = {};
    const stretch = {};
    for (const c of CONTROLS) {
      if (c.id === "screen") continue;
      const rec = model.controls?.[c.id];
      if (!rec) continue;
      if (rec.scale && rec.scale !== 1) for (const k of c.keys) scaleMul[k] = rec.scale;
      if (isStretched(rec)) {
        const st = stretchOf(rec);
        for (const k of c.keys) stretch[k] = st;
      }
      if (c.color !== false && rec.color) {
        const hex = colorHexOf(palette, rec.color);
        if (hex) for (const k of c.colorKeys ?? c.keys) colorHex[k] = hex;
      }
    }
    return { scaleMul, colorHex, stretch };
  }

  // skin 에 배율·색·늘림을 넘기고 키패드 칸 간격을 맞춘다(자리는 건드리지 않음).
  refreshLook(model) {
    this.deps.skin().setOverrides(this.overridesFromWork(model));
    this.keypadGap(model);
  }

  // 키패드를 가로·세로 따로 늘이면 키(칸 수로 늘림) 사이 간격으로 상자 크기를 정확히 맞춘다(keypadGaps).
  // 간격은 기기 픽셀 정수로 내림(키 그림이 반 픽셀에 놓여 흐려지지 않고, 상자가 목표보다 커지지 않게).
  // 세로 간격은 CLR·OK 줄 위 여백(--keypad-gap)도 함께.
  keypadGap(model) {
    const node = this.node(CONTROL_BY_ID.keypad);
    if (!node) return;
    const rec = model.controls?.keypad;
    if (!isStretched(rec)) {
      for (const v of KEYPAD_INLINE) node.style.removeProperty(v);
      return;
    }
    const skin = this.deps.skin();
    const dpr = skin.dpr || 1;
    const gaps = keypadGaps({ unit: skin.px(skin.art) / dpr, keyUnit: skin.effScale("N1", skin.art) / dpr, box: boxScale(rec), stretch: stretchOf(rec) });
    const px = (v) => `${Math.floor(v * dpr + 0.001) / dpr}px`;
    node.style.setProperty("--keypad-gap", px(gaps.row));
    node.style.columnGap = px(gaps.col);
    node.style.gridTemplateColumns = `repeat(3, ${px(gaps.key)})`;
  }

  applyModel(model) {
    this.refreshLook(model);
    this.positionAll(model);
  }

  // 각 조작부 node 를 모델 좌표(방향별 비율)로 절대 배치. 저장 값이 없는 것만 기본(격자) 가운데를 포착해 채운다.
  positionAll(model) {
    const rect = this.deps.appRect();
    // 저장 값에 x·y 가 다 있으면 captureDefaults(격자 reflow)를 건너뛴다 — 저장된 배치의 평상시 비용을 낮춘다.
    const defaults = () => (this.defaultsCache ??= this.captureDefaults());
    for (const c of CONTROLS) {
      const node = this.node(c);
      if (!node || node.hidden || node.hasAttribute("data-off")) continue;
      const rec = model.controls?.[c.id];
      const whole = Number.isFinite(rec?.x) && Number.isFinite(rec?.y);
      if (c.id === "screen") {
        this.positionScreen(rec, whole ? null : defaults().screen, rect);
        continue;
      }
      node.style.position = "absolute";
      const size = this.sizeOf(node);
      if (size.w < 1 || size.h < 1) continue;
      const def = whole ? rec : defaults().controls[c.id] ?? { x: 0.5, y: 0.5 };
      let cx = (Number.isFinite(def.x) ? def.x : 0.5) * rect.w;
      let cy = (Number.isFinite(def.y) ? def.y : 0.5) * rect.h;
      ({ cx, cy } = clampCenter(cx, cy, size.w, size.h, rect.w, rect.h));
      this.placeNode(node, cx, cy, size.w, size.h, rect);
      this.setHit(node, c.id, size);
    }
  }

  // 자유 배치의 .pad 는 화면 전체를 덮어 pointer-events:none 이라, 버튼 상자 밖 여백을 눌러도 pad 가 손가락을 받지 못했다.
  // 기본 배치와 같은 여백(pad.js keyMargin — 짧은 변 × 0.4, 40px 까지)·방향 손 닿는 범위(dirReach)만큼 누르는 자리를
  // 넓힌다(--hit, CSS ::after). 어느 버튼인지는 그대로 pad.js 가 좌표로 고른다.
  setHit(node, id, size) {
    if (id === "dir") {
      const r = Math.min(size.w, size.h) / 2;
      node.style.setProperty("--hit", `${Math.round(r * (dirReach(this.deps.skin().mode) - 1))}px`);
      return;
    }
    const keys = id === "keypad" ? node.querySelectorAll("[data-key]") : [node];
    for (const key of keys) {
      const r = key === node ? size : key.getBoundingClientRect();
      const w = r.w ?? r.width;
      const h = r.h ?? r.height;
      if (w >= 1) key.style.setProperty("--hit", `${Math.round(keyMargin(w, h))}px`);
    }
  }

  // 화면(.stage) 은 크기만 deps 로 바꾸고 위치는 다른 조작부와 같은 placeNode(현재 rect·offsetParent 원점 기준)로 —
  // 진입 직후·끌기 시작·저장/복원이 모두 같은 기준이라 어긋나거나 점프하지 않는다.
  positionScreen(rec, def, rect) {
    const node = this.node(CONTROL_BY_ID.screen);
    const base = this.deps.screenBase();
    const scale = clampScale(rec?.scale ?? 1);
    const sw = Math.max(80, Math.round(base.w * scale));
    const sh = Math.max(53, Math.round(base.h * scale));
    this.deps.setScreenSize(sw, sh);
    const size = this.sizeOf(node); // 테두리 포함 실제 stage 상자 크기
    const cx = (Number.isFinite(rec?.x) ? rec.x : (def?.x ?? 0.5)) * rect.w;
    const cy = (Number.isFinite(rec?.y) ? rec.y : (def?.y ?? 0.5)) * rect.h;
    const c = clampCenter(cx, cy, size.w, size.h, rect.w, rect.h);
    this.placeNode(node, c.cx, c.cy, size.w, size.h, rect);
  }

  node(control) {
    const el = this.deps.el();
    if (control.id === "screen") return el.stage;
    if (control.id === "dir") return el.dpad;
    return this.deps.pad().querySelector(control.sel);
  }

  // 그 게임이 보여 주는 편집 대상(화면 제외)으로 레이아웃 signature. display:none(미정의 C·D·RS) 은 제외.
  currentSig() {
    const ids = [];
    for (const c of CONTROLS) {
      if (c.id === "screen" || c.sig === false) continue;
      const node = this.node(c);
      if (node && !node.hidden && !node.hasAttribute("data-off") && node.offsetParent !== null) ids.push(c.id);
    }
    return layoutSignature(ids);
  }

  sideFor(sig, landscape) {
    return this.layout()[sig]?.[orientationKey(landscape)];
  }

  // 조작부 node 를 (cx,cy) 가운데(appRect 기준)에 배치. 절대 배치의 기준은 offsetParent 의 padding box 라
  // 테두리만 빼고 패딩은 빼지 않는다 — 패딩까지 빼면 safe-area(.app)·.pad 패딩만큼 기본 자리에서 밀려 서로 겹친다.
  placeNode(node, cx, cy, w, h, rect) {
    const op = node.offsetParent;
    let ox = rect.left, oy = rect.top;
    if (op) {
      const o = op.getBoundingClientRect();
      ox = o.left + (op.clientLeft || 0);
      oy = o.top + (op.clientTop || 0);
    }
    node.style.left = `${Math.round(cx - w / 2 - (ox - rect.left))}px`;
    node.style.top = `${Math.round(cy - h / 2 - (oy - rect.top))}px`;
  }

  sizeOf(node) {
    const r = node.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  // 자유 배치용 인라인 좌표를 모두 지운다(기본·크게 해제 시).
  clearInline() {
    const el = this.deps.el();
    for (const c of CONTROLS) {
      const node = c.id === "screen" ? el.stage : this.node(c);
      if (!node) continue;
      for (const v of ["position", "left", "top", "translate", "--hit"]) node.style.removeProperty(v);
      if (c.id === "keypad") {
        for (const v of KEYPAD_INLINE) node.style.removeProperty(v);
        for (const key of node.querySelectorAll("[data-key]")) key.style.removeProperty("--hit");
      }
    }
    if (el.face) for (const v of ["--face-w", "--face-h", "--face-up", "--rs-band"]) el.face.style.removeProperty(v);
    this.deps.clearScreenInline?.();
  }

  // 기본(격자) 배치에서의 조작부 가운데(비율)·크기(px)·화면 크기. 자유 CSS·배율·늘림을 잠깐 끄고 rect 를 읽는다 —
  // 배율이 걸린 채 재면 격자 칸 끝에 붙은 버튼(A·B·소프트 키 등)의 가운데가 커진 만큼 안쪽으로 밀려 기본 자리가 틀어진다.
  captureDefaults() {
    const { body } = this.deps;
    const skin = this.deps.skin();
    const rect = this.deps.appRect();
    const had = body.hasAttribute("data-pad-free");
    if (had) body.removeAttribute("data-pad-free");
    const looks = { scaleMul: skin.scaleMul, colorHex: skin.colorHex, stretch: skin.stretch };
    const scaled = Object.keys(looks.scaleMul ?? {}).length || Object.keys(looks.stretch ?? {}).length;
    if (scaled) skin.setOverrides({ colorHex: looks.colorHex });
    const saved = [];
    for (const c of CONTROLS) {
      const node = this.node(c);
      if (!node) continue;
      // 화면은 자유 배치에서 폭·높이도 인라인이라 함께 비워야 격자 기준 rect 가 읽힌다. 키패드 자유 비율 간격도 잠깐 뺀다.
      const isScreen = c.id === "screen";
      const props = ["position", "left", "top", "translate", ...(isScreen ? ["width", "height"] : []), ...(c.id === "keypad" ? KEYPAD_INLINE : [])];
      saved.push([node, props.map((p) => [p, node.style.getPropertyValue(p)])]);
      for (const p of props) node.style.removeProperty(p);
    }
    const controls = {};
    const sizes = {};
    let screen = { x: 0.5, y: 0.5 };
    for (const c of CONTROLS) {
      // 화면 기본 가운데는 실제 게임 화면(.screen) 기준 — 넓은 stage 영역이 아닌 화면이 있는 자리.
      const node = c.id === "screen" ? (this.deps.el().screen ?? this.node(c)) : this.node(c);
      if (!node || node.hidden || node.hasAttribute("data-off")) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cx = (r.left + r.width / 2 - rect.left) / rect.w;
      const cy = (r.top + r.height / 2 - rect.top) / rect.h;
      if (c.id === "screen") screen = { x: cx, y: cy };
      else controls[c.id] = { x: cx, y: cy };
      sizes[c.id] = { w: r.width, h: r.height };
    }
    for (const [node, props] of saved) for (const [p, v] of props) if (v) node.style.setProperty(p, v);
    if (scaled) skin.setOverrides(looks);
    if (had) body.setAttribute("data-pad-free", "");
    return { controls, screen, sizes };
  }

  // "크게"(방향 1 안 A) 프리셋: 버튼을 키우고, 기본 가운데에서 커져 서로 겹치는 조작부를 떼어 놓는다(저장하지 않고 그때그때).
  // 예전에는 기본 가운데 그대로 키워 세로 화면에서 A 가 B 를 거의 덮었다(B 가운데를 눌러도 A+B).
  // 자리가 모자라면(세로 화면의 C·D·RS 게임, 모바일 키패드 등) 겹친 채 남은 묶음의 배율을 0.05 씩 줄여 다시 — 겹치지 않는 가장 큰 크기.
  // 묶음(같은 배율): A·B·C·D·RS / START·SELECT / L·R / 키패드·소프트 키.
  bigLayout(landscape) {
    void landscape;
    // [id 들, 배율, 한 덩어리(서로 자리 그대로 함께 움직임)] — 키패드·소프트 키는 배율만 같고 따로 움직인다.
    const groups = [[["a", "b", "c", "d", "rs"], 1.5, true], [["START", "SELECT"], 1.4, true], [["L", "R", "L3"], 1.17, true], [["keypad", "soft1", "soft2"], 1.25, false]];
    const groupOf = Object.fromEntries(groups.flatMap(([ids], gi) => ids.map((id) => [id, gi])));
    const factor = groups.map(([, k]) => k);
    const def = (this.defaultsCache = this.captureDefaults()); // 화면 기본 자리도 이 값으로(positionAll)
    const rect = this.deps.appRect();
    // 실제로 그려질 배율(기기 픽셀 정수 칸 — skin.effScale 과 같은 반올림)로 크기를 어림한다.
    const effective = (id, k) => {
      const base = this.deps.basePx(id) || 1;
      return Math.max(1, Math.round(base * k)) / base;
    };
    const fixed = def.sizes.screen ? [{ id: "screen", x: def.screen.x * rect.w, y: def.screen.y * rect.h, w: def.sizes.screen.w, h: def.sizes.screen.h, shape: "box" }] : [];
    // 상단 아이콘(도구) 버튼도 움직이지 않는 것 — 조작부보다 위에 그려져 밀려 들어간 버튼이 가려진다(가로 모바일 소프트 키 등).
    // 접힌 햄버거 창 안 도구는 visibility:hidden 이라 빼고 센다.
    const win = this.deps.win();
    for (const tool of this.deps.el().bar?.querySelectorAll(".tool") ?? []) {
      const r = tool.getBoundingClientRect();
      if (r.width < 1 || tool.offsetParent === null || win.getComputedStyle(tool).visibility === "hidden") continue;
      fixed.push({ id: "bar", x: r.left + r.width / 2 - rect.left, y: r.top + r.height / 2 - rect.top, w: r.width, h: r.height, shape: "box" });
    }
    let items = [];
    for (let attempt = 0; attempt < 24; attempt++) {
      items = [];
      for (const c of CONTROLS) {
        if (c.id === "screen") continue;
        const at = def.controls[c.id];
        const size = def.sizes[c.id];
        if (!at || !size) continue;
        const gi = groupOf[c.id];
        const k = gi === undefined ? 1 : effective(c.id, factor[gi]);
        const rigid = gi !== undefined && groups[gi][2];
        items.push({ id: c.id, x: at.x * rect.w, y: at.y * rect.h, w: size.w * (rigid ? 1 : k), h: size.h * (rigid ? 1 : k), k, group: rigid ? gi : undefined, shape: ROUND_IDS.has(c.id) ? "round" : c.id === "dir" ? "disc" : "box" });
      }
      // 덩어리는 둘레 상자 가운데를 기준으로 자리 간격까지 같은 배로 — 기본 배치의 서로 자리 그대로 커진다(덩어리 안은 안 겹침).
      for (let gi = 0; gi < groups.length; gi++) {
        const body = items.filter((it) => it.group === gi);
        if (!body.length) continue;
        const ax = (Math.min(...body.map((o) => o.x - o.w / 2)) + Math.max(...body.map((o) => o.x + o.w / 2))) / 2;
        const ay = (Math.min(...body.map((o) => o.y - o.h / 2)) + Math.max(...body.map((o) => o.y + o.h / 2))) / 2;
        for (const o of body) {
          o.x = ax + (o.x - ax) * o.k;
          o.y = ay + (o.y - ay) * o.k;
          o.w *= o.k;
          o.h *= o.k;
        }
        // 화면 끝까지 벌어진 묶음(L·R, 소프트 키 양옆)은 화면 안에 들어오도록 간격만 좁힌다.
        for (const [pos, len, max] of [["x", "w", rect.w], ["y", "h", rect.h]]) {
          const lo = body.reduce((m, o) => (o[pos] < m[pos] ? o : m));
          const hi = body.reduce((m, o) => (o[pos] > m[pos] ? o : m));
          const span = hi[pos] - lo[pos];
          const room = max - 8 - (lo[len] + hi[len]) / 2;
          if (span > room && span > 0) {
            const mid = pos === "x" ? ax : ay;
            const f = Math.max(0, room) / span;
            for (const o of body) o[pos] = mid + (o[pos] - mid) * f;
          }
        }
      }
      const left = separate(items, fixed, rect.w, rect.h);
      if (!left.length) break;
      let shrink = new Set(left.flat().map((id) => groupOf[id]).filter((gi) => gi !== undefined && factor[gi] > 1));
      // 겹친 짝이 더 줄일 수 없는 것끼리면(밀려난 방향·L 이 아이콘에 닿음 등) 커진 묶음 모두를 함께 줄인다 — 다 1배면 기본 배치(안 겹침).
      if (!shrink.size) shrink = new Set(factor.map((k, gi) => (k > 1 ? gi : -1)).filter((gi) => gi >= 0));
      if (!shrink.size) break;
      for (const gi of shrink) factor[gi] = Math.max(1, Math.round((factor[gi] - 0.05) * 100) / 100);
    }
    const controls = {};
    for (const it of items) {
      const gi = groupOf[it.id];
      controls[it.id] = { x: it.x / rect.w, y: it.y / rect.h, ...(gi !== undefined && factor[gi] > 1 ? { scale: factor[gi] } : {}) };
    }
    return { controls };
  }

  // ---- 편집 모드 진입/종료 ------------------------------------------------
  canEdit(landscape) {
    return this.deps.landscape() === landscape && this.deps.padOn();
  }

  // 지금 signature·방향의 저장값(없으면 기본 격자 가운데)으로 작업 사본을 만든다.
  buildSeed(landscape) {
    const saved = this.sideFor(this.sig, landscape);
    const def = this.captureDefaults();
    const seed = { controls: {} };
    for (const c of CONTROLS) {
      if (c.id === "screen") {
        seed.controls.screen = { ...(def.screen ?? { x: 0.5, y: 0.5 }), scale: saved?.controls?.screen?.scale ?? 1 };
        continue;
      }
      const base = def.controls[c.id];
      if (!base) continue;
      seed.controls[c.id] = { ...base, ...(saved?.controls?.[c.id] ?? {}) };
      if (!Number.isFinite(seed.controls[c.id].x)) seed.controls[c.id].x = base.x;
      if (!Number.isFinite(seed.controls[c.id].y)) seed.controls[c.id].y = base.y;
    }
    return seed;
  }

  startEdit(landscape) {
    if (this.editing || !this.canEdit(landscape)) return;
    this.orient = orientationKey(landscape);
    this.setKind = "game";
    this.sig = this.currentSig();
    this.before = { placement: this.placement(), layout: this.deps.prefs().padLayout };
    this.workBySig = {};
    this.defaultsBySig = {};
    this.loadWork(landscape);
    this.selected = null;
    this.editing = true;
    this.deps.setPlacement("custom", { silent: true });
    this.deps.hold(true);
    this.deps.relayout();
    this.buildOverlay();
  }

  // 조작부 집합 전환: 현재 작업본 보관 → 해당 버튼 강제 표시 → 그 집합의 작업본(없으면 저장값·기본)으로 구성.
  pickSet(kind) {
    if (!this.editing || !PadEditor.SETS.includes(kind) || kind === this.setKind) return;
    this.stashWork();
    this.setKind = kind;
    this.deps.forceSet(kind);
    this.sig = this.currentSig();
    this.selected = null;
    this.loadWork(this.orient === "landscape");
    this.applyModel(this.work);
    this.syncFrames();
    this.renderCard();
  }

  // 현재 작업본을 signature 별 보관함에 넣는다(집합을 바꿔도 아까 만지던 배치 유지).
  stashWork() {
    if (this.sig && this.work) this.workBySig[this.sig] = this.work;
  }

  // 지금 signature 의 작업본을 불러온다: ① 세션 중 만지던 것 → ② 저장값·기본 격자. 기본 배치(reset 용)도 보관.
  loadWork(landscape) {
    if (!this.defaultsBySig[this.sig]) this.defaultsBySig[this.sig] = JSON.parse(JSON.stringify(this.buildSeed(landscape)));
    this.defaultsSeed = this.defaultsBySig[this.sig];
    this.work = this.workBySig[this.sig] ?? JSON.parse(JSON.stringify(this.defaultsSeed));
    this.workBySig[this.sig] = this.work;
  }

  exit(apply) {
    if (!this.editing) return;
    this.editing = false;
    this.selected = null;
    this.teardownOverlay();
    this.deps.hold(false);
    if (!apply && this.before) {
      this.deps.prefs().padLayout = this.before.layout;
      this.deps.setPlacement(this.before.placement, { silent: true });
    }
    this.before = null;
    this.work = null;
    this.setKind = "game";
    this.deps.forceSet?.("game"); // 강제로 켠 버튼을 실제 게임 상태로 원복
    this.deps.relayout();
  }

  save() {
    if (!this.editing) return;
    this.stashWork();
    const all = normalizeLayout(this.deps.prefs().padLayout);
    // 이 세션에서 만진 모든 집합(signature)을 현재 방향에 저장.
    for (const [sig, work] of Object.entries(this.workBySig)) all[sig] = { ...(all[sig] ?? {}), [this.orient]: work };
    const layout = normalizeLayout(all);
    this.deps.prefs().padLayout = layout;
    this.deps.setPlacement("custom", { silent: true });
    this.deps.persist({ padPlacement: "custom", padLayout: layout });
    this.exit(true);
  }

  reset() {
    if (!this.editing || !this.defaultsSeed) return;
    this.work = JSON.parse(JSON.stringify(this.defaultsSeed));
    this.workBySig[this.sig] = this.work;
    this.defaultsCache = null;
    this.applyModel(this.work);
    this.syncFrames();
    this.renderCard();
  }

  // ---- 편집 오버레이 DOM ---------------------------------------------------
  buildOverlay() {
    const doc = this.deps.doc();
    const t = this.deps.t;
    const mk = (cls, parent) => {
      const n = doc.createElement("div");
      if (cls) n.className = cls;
      parent?.append(n);
      return n;
    };
    // 점 격자(배경 참고)는 조작부 아래 층(별도 element). 조작부는 그 위에서 또렷하게 보이고, 테두리·손잡이는 맨 위.
    const backdrop = mk("padedit__grid");
    backdrop.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (this.selected) this.select(null);
    });
    // 맨 앞(.app 첫 자식)에 둔다 — z-index 뿐 아니라 DOM 순서로도 조작부·막대보다 뒤에 깔리게(스타일 누락 대비).
    (this.deps.mountBack ?? this.deps.mount)(backdrop);
    this.backdrop = backdrop;
    const root = mk("padedit");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", t(`web.pad.edit.title.${this.orient}`));
    // 점선 테두리·손잡이는 막대·카드 아래 층(막대·카드가 늘 위에서 눌리게).
    this.framesLayer = mk("padedit__frames", root);
    // 막대 3줄: 제목·안내 / 동작 버튼(좌 = 편집 보조, 우 = 취소·저장) / 조작부 집합. 카드는 조작부를 선택했을 때만.
    const bar = mk("padedit__bar", root);
    const head = mk("padedit__head", bar);
    const title = mk("padedit__title", head);
    title.textContent = t(`web.pad.edit.title.${this.orient}`);
    this.hint = mk("padedit__hint", head);
    this.hint.textContent = t("web.pad.edit.help1");
    const acts = mk("padedit__acts", bar);
    const tools = mk("padedit__actgroup", acts);
    const ends = mk("padedit__actgroup padedit__actgroup--end", acts);
    const btn = (label, cls, on, group = tools) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = `padedit__btn${cls ? " " + cls : ""}`;
      b.textContent = label;
      b.addEventListener("click", on);
      group.append(b);
      return b;
    };
    this.snapBtn = btn(t("web.pad.edit.snap"), "padedit__btn--toggle", () => {
      this.snapOn = !this.snapOn;
      this.snapBtn.classList.toggle("is-on", this.snapOn);
      this.snapBtn.setAttribute("aria-pressed", String(this.snapOn));
    });
    this.snapBtn.classList.toggle("is-on", this.snapOn);
    this.snapBtn.setAttribute("aria-pressed", String(this.snapOn));
    btn(t("web.pad.edit.reset"), "", () => this.reset());
    btn(t("web.pad.edit.cancel"), "", () => this.exit(false), ends);
    btn(t("web.pad.edit.save"), "padedit__btn--primary", () => this.save(), ends);
    this.sets = mk("padedit__sets", bar);
    this.card = mk("padedit__card", root);
    this.overlay = root;
    this.deps.mount(root);
    this.deps.body.setAttribute("data-pad-edit", "");
    this.syncFrames();
    this.renderCard();
    this.onKey = (event) => {
      if (event.key === "Escape") this.exit(false);
    };
    doc.addEventListener("keydown", this.onKey);
  }

  teardownOverlay() {
    if (this.onKey) this.deps.doc().removeEventListener("keydown", this.onKey);
    this.cleanupDrag();
    this.overlay?.remove();
    this.overlay = null;
    this.backdrop?.remove();
    this.backdrop = null;
    this.framesLayer = null;
    this.hint = null;
    this.sets = null;
    this.card = null;
    this.frames.clear();
    this.deps.body.removeAttribute("data-pad-edit");
  }

  // 조작부마다 점선 테두리 + 손잡이(선택했을 때). 모서리 = 같은 비율 크기, 변 = 가로만·세로만(둘 다 가운데 기준).
  // 변 손잡이는 화면 가운데 쪽 변에 둔다(화면 끝에 붙은 조작부도 손잡이가 화면 안) — 화면(게임 그림)은 비율을 지켜 변 손잡이 없음.
  syncFrames() {
    if (!this.framesLayer) return;
    const rect = this.deps.appRect();
    const doc = this.deps.doc();
    for (const c of CONTROLS) {
      const node = this.node(c);
      const visible = node && !node.hidden && !node.hasAttribute("data-off") && this.work.controls[c.id];
      let f = this.frames.get(c.id);
      if (!visible) {
        f?.box.remove();
        this.frames.delete(c.id);
        continue;
      }
      if (!f) {
        const box = doc.createElement("div");
        box.className = "padedit__sel";
        box.dataset.ctl = c.id;
        box.dataset.label = this.ctlName(c.id);
        const handle = doc.createElement("div");
        handle.className = "padedit__handle";
        const badge = doc.createElement("div");
        badge.className = "padedit__badge";
        box.append(handle, badge);
        box.addEventListener("pointerdown", (e) => this.onDown(e, c.id, "move"));
        handle.addEventListener("pointerdown", (e) => this.onDown(e, c.id, "resize"));
        f = { box, handle, badge, hx: null, hy: null };
        if (c.id !== "screen") {
          f.hx = doc.createElement("div");
          f.hx.className = "padedit__handle padedit__handle--x";
          f.hy = doc.createElement("div");
          f.hy.className = "padedit__handle padedit__handle--y";
          box.append(f.hx, f.hy);
          f.hx.addEventListener("pointerdown", (e) => this.onDown(e, c.id, "resize-x"));
          f.hy.addEventListener("pointerdown", (e) => this.onDown(e, c.id, "resize-y"));
        }
        this.framesLayer.append(box);
        this.frames.set(c.id, f);
      }
      const r = node.getBoundingClientRect();
      Object.assign(f.box.style, {
        left: `${r.left - rect.left}px`,
        top: `${r.top - rect.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      const on = this.selected === c.id;
      f.box.classList.toggle("is-on", on);
      f.box.classList.toggle("is-right", r.left + r.width / 2 - rect.left > rect.w / 2);
      f.box.classList.toggle("is-low", r.top + r.height / 2 - rect.top > rect.h / 2);
      const rec = this.work.controls[c.id];
      f.badge.textContent = `${this.ctlName(c.id)} ${sizeText(rec)}`;
      f.badge.hidden = !on;
      f.handle.hidden = !on;
      if (f.hx) f.hx.hidden = !on;
      if (f.hy) f.hy.hidden = !on;
    }
  }

  select(id) {
    this.selected = id;
    this.syncFrames();
    this.renderCard();
  }

  // 조작부 집합 선택(세그먼트): 현재 게임이 안 쓰는 C·D·RS·키패드도 편집용으로 꺼내 배치·저장한다.
  segmentRow() {
    const doc = this.deps.doc();
    const t = this.deps.t;
    const row = doc.createElement("div");
    row.className = "padedit__row padedit__row--seg";
    const name = doc.createElement("span");
    name.className = "padedit__name";
    name.textContent = t("web.pad.edit.set");
    const group = doc.createElement("div");
    group.className = "padedit__segs";
    row.append(name, group);
    for (const kind of PadEditor.SETS) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "padedit__seg";
      b.textContent = t(`web.pad.edit.set.${kind}`);
      const on = (this.setKind || "game") === kind;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", () => this.pickSet(kind));
      group.append(b);
    }
    return row;
  }

  // 막대의 조작부 집합 줄 + 미세 조절 카드(선택한 조작부 이름·크기 − + ·색 고르기). 선택이 없으면 카드를 숨겨 조작부를 가리지 않는다.
  renderCard() {
    if (!this.card) return;
    const doc = this.deps.doc();
    const t = this.deps.t;
    this.sets?.replaceChildren(this.segmentRow());
    this.hint?.classList.toggle("is-off", Boolean(this.selected));
    this.card.replaceChildren();
    this.card.hidden = !this.selected;
    if (!this.selected) { this.card.classList.remove("padedit__card--top"); return; }
    const help = doc.createElement("p");
    help.className = "padedit__help";
    help.textContent = t("web.pad.edit.help2");
    this.card.append(help);
    const c = CONTROL_BY_ID[this.selected];
    // 카드가 선택한 조작부·손잡이를 가리지 않게: 조작부가 화면 아래쪽이면 카드를 위로.
    const node = this.node(c);
    const rect = this.deps.appRect();
    const nr = node?.getBoundingClientRect();
    const lower = nr ? (nr.top + nr.height / 2 - rect.top) > rect.h * 0.5 : false;
    this.card.classList.toggle("padedit__card--top", lower);
    const rec = this.work.controls[c.id] ?? (this.work.controls[c.id] = { x: 0.5, y: 0.5, scale: 1 });
    const row = doc.createElement("div");
    row.className = "padedit__row";
    const name = doc.createElement("span");
    name.className = "padedit__name";
    name.textContent = `${t("web.pad.edit.size")} · ${this.ctlName(c.id)}`;
    const minus = this.cardBtn("−", () => this.bumpScale(-1));
    const val = doc.createElement("span");
    const stretched = Number.isFinite(rec.sx);
    val.className = `padedit__val${stretched ? " padedit__val--wide" : ""}`;
    val.textContent = sizeText(rec);
    const plus = this.cardBtn("", () => this.bumpScale(1));
    // "+" 글자는 글꼴 안에서 반 픽셀 낮게 앉는다 — 잉크 세로 가운데로 글자만 반 픽셀 올린다(버튼 상자는 −·값과 같은 줄).
    const glyph = doc.createElement("span");
    glyph.className = "padedit__plus";
    glyph.textContent = "+";
    plus.append(glyph);
    row.append(name, minus, val, plus);
    this.card.append(row);
    // 가로·세로를 따로 바꿨으면 "원래 비율"(지금 그림 배율의 같은 비율로) 버튼.
    if (stretched) {
      const ratio = doc.createElement("div");
      ratio.className = "padedit__row padedit__row--ratio";
      const fix = this.cardBtn(t("web.pad.edit.ratio"), () => this.resetRatio());
      fix.classList.add("padedit__ratio");
      ratio.append(fix);
      this.card.append(ratio);
    }
    if (c.color !== false) this.card.append(this.colorRow(c, rec));
  }

  resetRatio() {
    const rec = this.work.controls[this.selected];
    if (!rec) return;
    setBox(rec, rec.scale ?? 1, rec.scale ?? 1);
    this.applyModel(this.work);
    this.syncFrames();
    this.renderCard();
  }

  cardBtn(label, on) {
    const b = this.deps.doc().createElement("button");
    b.type = "button";
    b.className = "padedit__cardbtn";
    b.textContent = label;
    b.addEventListener("click", on);
    return b;
  }

  // 지정 없을 때 체크할 기본 색. 방향 조작부는 모드에 따라(스틱 = 강조색 손잡이, 십자 = 몸통).
  defaultColorId(control) {
    if (control.id === "dir" && this.deps.skin().mode === "stick") return "accent";
    return control.colorDefault ?? null;
  }

  colorRow(control, rec) {
    const doc = this.deps.doc();
    const t = this.deps.t;
    const row = doc.createElement("div");
    row.className = "padedit__row padedit__row--color";
    const name = doc.createElement("span");
    name.className = "padedit__name";
    name.textContent = t("web.pad.edit.color");
    row.append(name);
    const choices = colorChoices(this.deps.skin().palette);
    const active = rec.color ?? this.defaultColorId(control);
    for (const choice of choices) {
      const sw = doc.createElement("button");
      sw.type = "button";
      sw.className = "padedit__swatch";
      sw.style.setProperty("--sw", choice.hex);
      sw.setAttribute("aria-label", choice.id);
      sw.setAttribute("aria-pressed", String(choice.id === active));
      sw.classList.toggle("is-on", choice.id === active);
      sw.addEventListener("click", () => this.pickColor(control, choice.id));
      row.append(sw);
    }
    const auto = this.cardBtn(t("web.pad.edit.auto"), () => this.pickColor(control, null));
    auto.classList.add("padedit__auto");
    auto.classList.toggle("is-on", !rec.color);
    row.append(auto);
    return row;
  }

  pickColor(control, id) {
    const rec = this.work.controls[control.id] ?? (this.work.controls[control.id] = { x: 0.5, y: 0.5, scale: 1 });
    if (id) rec.color = id;
    else delete rec.color;
    this.applyModel(this.work);
    this.syncFrames();
    this.renderCard();
  }

  bumpScale(dir) {
    const c = CONTROL_BY_ID[this.selected];
    const rec = this.work.controls[c.id];
    if (!rec) return;
    const basePx = this.deps.basePx(c.id);
    const before = rec.scale ?? 1;
    const next = scaleStep(before, dir, basePx);
    // 가로·세로를 따로 바꾼 조작부는 그 비율 그대로 함께 키우고 줄인다(그림 배율 = 작은 쪽이 한 칸씩).
    if (Number.isFinite(rec.sx) && c.id !== "screen") {
      const box = boxScale(rec);
      const f = next / before;
      setBox(rec, box.x * f, box.y * f);
    } else rec.scale = next;
    this.applyModel(this.work);
    this.syncFrames();
    this.renderCard();
  }

  // ---- 끌기/크기(한 프레임에 1번만 — rAF coalesce) ------------------------
  // 끌기 시작: 지금 가운데(appRect 기준)·크기를 잡아 둔다. 손가락과 요소의 시작 간격은 가운데+포인터 델타로 유지(점프 없음).
  onDown(event, id, kind) {
    event.preventDefault();
    event.stopPropagation();
    this.select(id);
    const node = this.node(CONTROL_BY_ID[id]);
    const r = node.getBoundingClientRect();
    const rect = this.deps.appRect();
    const rec = this.work.controls[id] ?? (this.work.controls[id] = { x: 0.5, y: 0.5, scale: 1 });
    const box = boxScale(rec);
    this.drag = {
      id,
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cx: r.left + r.width / 2 - rect.left,
      cy: r.top + r.height / 2 - rect.top,
      w: r.width,
      h: r.height,
      baseW: Math.max(12, r.width),
      baseH: Math.max(12, r.height),
      scale: clampScale(rec.scale ?? 1),
      bx: box.x,
      by: box.y,
      basePx: this.deps.basePx(id),
    };
    const win = this.deps.win();
    // 손잡이·테두리 자체가 포인터를 잡아 두어(손가락이 벗어나도) 다른 요소로 새지 않게 — 리사이징이 늘 시작되게.
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    this.moveFn = (e) => this.onMove(e);
    this.upFn = (e) => this.onUp(e);
    win.addEventListener("pointermove", this.moveFn, { passive: false });
    win.addEventListener("pointerup", this.upFn);
    win.addEventListener("pointercancel", this.upFn);
  }

  onMove(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    event.preventDefault();
    this.pending = { x: event.clientX, y: event.clientY };
    if (this.raf) return;
    this.raf = this.deps.win().requestAnimationFrame(() => {
      this.raf = 0;
      this.applyPending();
    });
  }

  // rAF 한 프레임에 1번: 저장된 좌표만 반영한다(레이아웃 thrash 방지). 끄는 중에는 해당 node 만 바꾼다.
  applyPending() {
    if (!this.drag || !this.pending) return;
    const d = this.drag;
    const rect = this.deps.appRect();
    const node = this.node(CONTROL_BY_ID[d.id]);
    if (!node) return;
    const dx = this.pending.x - d.startX;
    const dy = this.pending.y - d.startY;
    if (d.kind === "move") {
      let cx = d.cx + dx;
      let cy = d.cy + dy;
      const others = this.otherBoxes(d.id, rect);
      const snapped = snapCenter(cx, cy, d.w, d.h, { left: 0, top: 0, w: rect.w, h: rect.h }, others, { snapOn: this.snapOn });
      ({ cx, cy } = clampCenter(snapped.cx, snapped.cy, d.w, d.h, rect.w, rect.h));
      this.live = { cx, cy };
      this.placeNode(node, cx, cy, d.w, d.h, rect); // 화면·버튼 모두 같은 기준(현재 위치·offsetParent 원점)
      this.drawGuides(snapped.guides, rect);
    } else if (d.kind === "resize-x" || d.kind === "resize-y") {
      this.resizeEdge(d, node, rect);
      this.updateBadge(d.id);
    } else {
      // 크기: 손잡이를 가운데에서 멀리 끌수록 커진다(모서리 무관·가운데 고정). 기기 픽셀 정수 칸은 skin.effScale 이 반올림.
      // 가로·세로를 따로 바꾼 조작부는 그 비율 그대로 함께(그림 배율 = 작은 쪽 0.75~2, 상자는 4 까지).
      const r0 = Math.hypot(d.baseW / 2, d.baseH / 2) || 1;
      const now = Math.hypot(this.pending.x - (rect.left + d.cx), this.pending.y - (rect.top + d.cy));
      const rec = this.work.controls[d.id];
      if (d.id === "screen" || (d.bx === d.by && d.bx <= SCALE_MAX)) {
        const target = clampScale(d.scale * now / r0);
        this.live = { scale: target };
        if (d.id === "screen") rec.scale = target;
        else setBox(rec, target, target);
      } else {
        const lo = Math.min(d.bx, d.by);
        const hi = Math.max(d.bx, d.by);
        const f = Math.max(SCALE_MIN / lo, Math.min(now / r0, SCALE_MAX / lo, STRETCH_MAX / hi));
        setBox(rec, d.bx * f, d.by * f);
        this.live = { scale: rec.scale };
      }
      if (d.id === "screen") { rec.x = d.cx / rect.w; rec.y = d.cy / rect.h; }
      this.refreshLook(this.work);
      if (d.id === "screen") {
        this.positionScreen(rec, null, rect);
      } else {
        const size = this.sizeOf(node);
        this.placeNode(node, d.cx, d.cy, size.w, size.h, rect);
      }
      this.updateBadge(d.id);
    }
    this.syncSelectedFrame();
  }

  // 변 손잡이: 가로만(또는 세로만) 늘이고 줄인다. 모서리처럼 가운데 기준 — 손잡이와 가운데 사이 거리의 두 배가 그 방향 길이.
  // 손잡이가 화면 가운데 쪽 변에 있어, 어디에 놓인 조작부든 반대쪽 화면 끝까지 끌면 가로(세로) 100% 가 된다
  // (화면을 넘으면 화면 크기에서 멈추고 화면 안으로 밀려 들어온다). 격자 맞춤이면 100%·원래 비율에 붙는다.
  resizeEdge(d, node, rect) {
    const rec = this.work.controls[d.id];
    const horiz = d.kind === "resize-x";
    const span = horiz ? rect.w : rect.h;
    const size0 = horiz ? d.w : d.h;
    const center = horiz ? d.cx : d.cy;
    const at = horiz ? this.pending.x - rect.left : this.pending.y - rect.top;
    let want = Math.max(12, Math.min(span, 2 * Math.abs(at - center)));
    const full = this.snapOn && span - want <= SNAP_TOL * 2;
    if (full) want = span;
    const other = horiz ? d.by : d.bx;
    let mul = (horiz ? d.bx : d.by) * (want / size0);
    if (!full && this.snapOn && Math.abs(mul - other) / other < 0.03) mul = other; // 원래 비율 근처면 원래 비율로
    const apply = (m) => {
      if (horiz) setBox(rec, m, d.by);
      else setBox(rec, d.bx, m);
      this.refreshLook(this.work);
      return this.sizeOf(node);
    };
    const len = (s) => (horiz ? s.w : s.h);
    let size = apply(mul);
    // 그림 칸 수는 정수라 반올림으로 몇 px 어긋난다 — 100% 에 붙였으면 화면 크기에 가깝게 맞추고, 화면보다 크면 줄인다.
    for (let i = 0; i < 4 && full && len(size) < span - 0.5; i++) {
      mul *= span / len(size);
      size = apply(mul);
    }
    for (let i = 0; i < 6 && len(size) > span + 0.5; i++) {
      mul *= (span / len(size)) * 0.998;
      size = apply(mul);
    }
    const { cx, cy } = clampCenter(d.cx, d.cy, size.w, size.h, rect.w, rect.h);
    this.live = { cx, cy };
    this.placeNode(node, cx, cy, size.w, size.h, rect);
  }

  updateBadge(id) {
    const f = this.frames.get(id);
    if (!f) return;
    const rec = this.work.controls[id];
    f.badge.textContent = `${this.ctlName(id)} ${sizeText(rec)}`;
  }

  otherBoxes(skipId, rect) {
    const out = [];
    for (const c of CONTROLS) {
      if (c.id === skipId) continue;
      const node = this.node(c);
      if (!node || node.hidden || node.hasAttribute("data-off") || !this.work.controls[c.id]) continue;
      const r = node.getBoundingClientRect();
      out.push({
        cx: r.left + r.width / 2 - rect.left,
        cy: r.top + r.height / 2 - rect.top,
        left: r.left - rect.left,
        right: r.right - rect.left,
        top: r.top - rect.top,
        bottom: r.bottom - rect.top,
      });
    }
    return out;
  }

  drawGuides(guides, rect) {
    if (!this.framesLayer) return;
    for (const g of this.framesLayer.querySelectorAll(".padedit__guide")) g.remove();
    for (const g of guides) {
      const line = this.deps.doc().createElement("div");
      line.className = "padedit__guide";
      if (g.x != null) Object.assign(line.style, { left: `${Math.round(g.x)}px`, top: "0", width: "1px", height: `${rect.h}px` });
      else Object.assign(line.style, { top: `${Math.round(g.y)}px`, left: "0", height: "1px", width: `${rect.w}px` });
      this.framesLayer.append(line);
    }
  }

  syncSelectedFrame() {
    const f = this.frames.get(this.selected);
    if (!f) return;
    const node = this.node(CONTROL_BY_ID[this.selected]);
    const rect = this.deps.appRect();
    const r = node.getBoundingClientRect();
    Object.assign(f.box.style, { left: `${r.left - rect.left}px`, top: `${r.top - rect.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  // 끌기 리스너·rAF·임시 상태를 모두 해제(업·취소·오버레이 철거 공용 — 재진입 때 깨끗하게).
  cleanupDrag() {
    const win = this.deps.win();
    if (this.moveFn) win.removeEventListener("pointermove", this.moveFn);
    if (this.upFn) { win.removeEventListener("pointerup", this.upFn); win.removeEventListener("pointercancel", this.upFn); }
    this.moveFn = null;
    this.upFn = null;
    if (this.raf) { win.cancelAnimationFrame(this.raf); this.raf = 0; }
    this.drag = null;
    this.pending = null;
    this.live = null;
  }

  onUp(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const d = this.drag;
    const rect = this.deps.appRect();
    const rec = this.work.controls[d.id] ?? (this.work.controls[d.id] = {});
    if ((d.kind === "move" || d.kind === "resize-x" || d.kind === "resize-y") && this.live) {
      // 변으로 늘이다 화면 끝에 닿으면 화면 안으로 밀려 가운데가 바뀐다 — 그 가운데를 저장.
      rec.x = Math.min(1, Math.max(0, this.live.cx / rect.w));
      rec.y = Math.min(1, Math.max(0, this.live.cy / rect.h));
    } else if (d.kind === "resize" && this.live) {
      rec.scale = clampScale(this.live.scale);
    }
    this.cleanupDrag();
    for (const g of this.framesLayer?.querySelectorAll(".padedit__guide") ?? []) g.remove();
    this.syncFrames();
    this.renderCard();
  }
}
