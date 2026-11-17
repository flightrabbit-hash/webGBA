// 모바일 패드 자율배치 에디터: "직접 배치"(custom) 배치에서 조작부를 화면 위에서 끌어 옮기고(자유 위치),
// 모서리로 크기를 바꾸고, 테마 색 안에서 색을 고른다. 가로·세로 배치를 따로 저장한다.
// 순수 함수(데이터 모델·좌표·색 계산)는 node 로 바로 시험한다 — 아래 export. 편집 UI(PadEditor)는 브라우저에서만 생성.

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
  { id: "START", sel: ".key--start", keys: ["START"], colorDefault: "pill" },
  { id: "SELECT", sel: ".key--select", keys: ["SELECT"], colorDefault: "pill" },
  { id: "keypad", sel: ".keypad", keys: ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "STAR", "N0", "HASH", "CLEAR", "OK"], colorDefault: "button" },
  { id: "soft1", sel: ".key--soft1", keys: ["SOFT1"], colorDefault: "pill", sig: false },
  { id: "soft2", sel: ".key--soft2", keys: ["SOFT2"], colorDefault: "pill", sig: false },
  { id: "screen", sel: ".stage", keys: [], color: false },
];
export const CONTROL_BY_ID = Object.fromEntries(CONTROLS.map((c) => [c.id, c]));
const SOFT_IDS = ["soft1", "soft2"];

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
    const model = this.editing ? this.work : this.placement() === "big" ? this.bigLayout(landscape) : this.sideFor(this.currentSig(), landscape);
    this.model = model ?? { controls: {} };
    this.defaultsCache = null;
    body.setAttribute("data-pad-free", "");
    this.applyModel(this.model);
    if (this.editing) this.syncFrames();
  }

  // 모델 → skin 배율·색 override 묶음. 색 id → 지금 테마 hex.
  overridesFromWork(model) {
    const palette = this.deps.skin().palette;
    const scaleMul = {};
    const colorHex = {};
    for (const c of CONTROLS) {
      if (c.id === "screen") continue;
      const rec = model.controls?.[c.id];
      if (!rec) continue;
      if (rec.scale && rec.scale !== 1) for (const k of c.keys) scaleMul[k] = rec.scale;
      if (c.color !== false && rec.color) {
        const hex = colorHexOf(palette, rec.color);
        if (hex) for (const k of c.colorKeys ?? c.keys) colorHex[k] = hex;
      }
    }
    return { scaleMul, colorHex };
  }

  applyModel(model) {
    this.deps.skin().setOverrides(this.overridesFromWork(model));
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
      for (const v of ["position", "left", "top", "translate"]) node.style.removeProperty(v);
    }
    if (el.face) for (const v of ["--face-w", "--face-h", "--face-up", "--rs-band"]) el.face.style.removeProperty(v);
    this.deps.clearScreenInline?.();
  }

  // 기본(격자) 배치에서의 조작부 가운데(비율)·화면 크기. 자유 CSS 를 잠깐 끄고 rect 를 읽는다.
  captureDefaults() {
    const { body } = this.deps;
    const rect = this.deps.appRect();
    const had = body.hasAttribute("data-pad-free");
    if (had) body.removeAttribute("data-pad-free");
    const saved = [];
    for (const c of CONTROLS) {
      const node = this.node(c);
      if (!node) continue;
      // 화면은 자유 배치에서 폭·높이도 인라인이라 함께 비워야 격자 기준 rect 가 읽힌다(버튼 크기는 skin 값이라 건드리지 않음).
      const isScreen = c.id === "screen";
      saved.push([node, node.style.position, node.style.left, node.style.top, node.style.translate, node.style.width, node.style.height, isScreen]);
      for (const v of ["position", "left", "top", "translate"]) node.style.removeProperty(v);
      if (isScreen) { node.style.removeProperty("width"); node.style.removeProperty("height"); }
    }
    const controls = {};
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
    }
    for (const [node, position, left, top, translate, width, height, isScreen] of saved) {
      node.style.position = position;
      node.style.left = left;
      node.style.top = top;
      node.style.translate = translate;
      if (isScreen) { node.style.width = width; node.style.height = height; }
    }
    if (had) body.setAttribute("data-pad-free", "");
    return { controls, screen };
  }

  // "크게"(방향 1 안 A) 프리셋: 기본 가운데 + 버튼만 키운다. 저장하지 않고 그때그때 만든다.
  bigLayout(landscape) {
    const bump = { a: 1.5, b: 1.5, c: 1.5, d: 1.5, rs: 1.5, START: 1.4, SELECT: 1.4, L: 1.17, R: 1.17, keypad: 1.25 };
    const controls = {};
    for (const [id, scale] of Object.entries(bump)) controls[id] = { scale };
    void landscape;
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

  // 조작부마다 점선 테두리 + 모서리 손잡이. 선택한 것은 강조·크기 배지.
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
        box.dataset.label = this.deps.t(`web.pad.ctl.${c.id}`);
        const handle = doc.createElement("div");
        handle.className = "padedit__handle";
        const badge = doc.createElement("div");
        badge.className = "padedit__badge";
        box.append(handle, badge);
        box.addEventListener("pointerdown", (e) => this.onDown(e, c.id, "move"));
        handle.addEventListener("pointerdown", (e) => this.onDown(e, c.id, "resize"));
        this.framesLayer.append(box);
        f = { box, handle, badge };
        this.frames.set(c.id, f);
      }
      const r = node.getBoundingClientRect();
      Object.assign(f.box.style, {
        left: `${r.left - rect.left}px`,
        top: `${r.top - rect.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      f.box.classList.toggle("is-on", this.selected === c.id);
      f.box.classList.toggle("is-right", r.left + r.width / 2 - rect.left > rect.w / 2);
      const rec = this.work.controls[c.id];
      f.badge.textContent = `${this.deps.t(`web.pad.ctl.${c.id}`)} ${scalePercent(rec?.scale ?? 1)}%`;
      f.badge.hidden = this.selected !== c.id;
      f.handle.hidden = this.selected !== c.id;
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
    name.textContent = `${t("web.pad.edit.size")} · ${t(`web.pad.ctl.${c.id}`)}`;
    const minus = this.cardBtn("−", () => this.bumpScale(-1));
    const val = doc.createElement("span");
    val.className = "padedit__val";
    val.textContent = `${scalePercent(rec.scale ?? 1)}%`;
    const plus = this.cardBtn("+", () => this.bumpScale(1));
    row.append(name, minus, val, plus);
    this.card.append(row);
    if (c.color !== false) this.card.append(this.colorRow(c, rec));
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
    rec.scale = scaleStep(rec.scale ?? 1, dir, basePx);
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
    } else {
      // 크기: 손잡이를 가운데에서 멀리 끌수록 커진다(모서리 무관·가운데 고정). 기기 픽셀 정수 칸은 skin.effScale 이 반올림.
      const r0 = Math.hypot(d.baseW / 2, d.baseH / 2) || 1;
      const now = Math.hypot(this.pending.x - (rect.left + d.cx), this.pending.y - (rect.top + d.cy));
      const target = clampScale(d.scale * now / r0);
      this.live = { scale: target };
      const rec = this.work.controls[d.id];
      rec.scale = target;
      if (d.id === "screen") { rec.x = d.cx / rect.w; rec.y = d.cy / rect.h; }
      this.deps.skin().setOverrides(this.overridesFromWork(this.work));
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

  updateBadge(id) {
    const f = this.frames.get(id);
    if (!f) return;
    const rec = this.work.controls[id];
    f.badge.textContent = `${this.deps.t(`web.pad.ctl.${id}`)} ${scalePercent(rec?.scale ?? 1)}%`;
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
    if (d.kind === "move" && this.live) {
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
