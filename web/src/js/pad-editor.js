// 모바일 패드 자율배치 에디터: "직접 배치"(custom) 배치에서 조작부를 화면 위에서 끌어 옮기고(자유 위치),
// 모서리로 크기를 바꾸고, 테마 색 안에서 색을 고른다. 가로·세로 배치를 따로 저장한다.
// 순수 함수(데이터 모델·좌표·색 계산)는 node 로 바로 시험한다 — 아래 export. 편집 UI(PadEditor)는 브라우저에서만 생성.

export const PAD_PLACEMENTS = ["default", "big", "custom"];
export const SCALE_MIN = 0.75;
export const SCALE_MAX = 2;
export const SNAP_GRID = 8;
export const SNAP_TOL = 6;

// 편집 단위(조작부). keys = skin 배율을 거는 part 이름, colorKeys = 색을 거는 part(없으면 keys),
// colorDefault = 자동 색의 색 고르기 id. screen 은 게임 화면(색 없음).
export const CONTROLS = [
  { id: "dir", sel: "[data-dpad]", keys: ["dir"], colorDefault: "button" },
  { id: "face", sel: ".face", keys: ["A", "B", "C", "D", "RS"], colorKeys: ["A", "B", "C", "D"], colorDefault: "accent" },
  { id: "L", sel: ".key--l", keys: ["L"], colorDefault: "button" },
  { id: "R", sel: ".key--r", keys: ["R"], colorDefault: "button" },
  { id: "START", sel: ".key--start", keys: ["START"], colorDefault: "pill" },
  { id: "SELECT", sel: ".key--select", keys: ["SELECT"], colorDefault: "pill" },
  { id: "keypad", sel: ".keypad", keys: ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "STAR", "N0", "HASH", "CLEAR", "OK", "SOFT1", "SOFT2"], colorDefault: "button" },
  { id: "screen", sel: ".stage", keys: [], color: false },
];
export const CONTROL_BY_ID = Object.fromEntries(CONTROLS.map((c) => [c.id, c]));

export const orientationKey = (landscape) => (landscape ? "landscape" : "portrait");

// 저장 레이아웃 정리: 방향별 { controls: { id: {x,y,scale,color} }, screen:{x,y,scale} }. 모르는 값은 버린다.
export function normalizeLayout(raw) {
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
    if (Object.keys(controls).length) out[orient] = { controls };
  }
  return out;
}

export const hasLayout = (layout, landscape) => {
  const side = layout?.[orientationKey(landscape)];
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
  }

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

  // 지금 방향에 자유 배치를 적용할지. custom = 저장된 방향만, big = 항상(프리셋).
  freeActive(landscape) {
    const place = this.placement();
    if (place === "big") return true;
    if (place === "custom") return this.editing || hasLayout(this.layout(), landscape);
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
    const model = this.editing ? this.work : this.placement() === "big" ? this.bigLayout(landscape) : this.layout()[this.orient];
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
      if (c.id === "face") this.applyFaceVars(rec?.scale ?? 1);
      node.style.position = "absolute";
      const size = this.sizeOf(node);
      if (size.w < 1 || size.h < 1) continue;
      const def = whole ? rec : defaults().controls[c.id] ?? { x: 0.5, y: 0.5 };
      let cx = (Number.isFinite(def.x) ? def.x : 0.5) * rect.w;
      let cy = (Number.isFinite(def.y) ? def.y : 0.5) * rect.h;
      ({ cx, cy } = clampCenter(cx, cy, size.w, size.h, rect.w, rect.h));
      node.style.left = `${Math.round(cx - size.w / 2)}px`;
      node.style.top = `${Math.round(cy - size.h / 2)}px`;
    }
  }

  positionScreen(rec, def, rect) {
    const base = this.deps.screenBase();
    const scale = clampScale(rec?.scale ?? 1);
    const sw = Math.max(80, Math.round(base.w * scale));
    const sh = Math.max(53, Math.round(base.h * scale));
    this.deps.setScreenSize(sw, sh);
    const cx = (Number.isFinite(rec?.x) ? rec.x : (def?.x ?? 0.5)) * rect.w;
    const cy = (Number.isFinite(rec?.y) ? rec.y : (def?.y ?? 0.5)) * rect.h;
    const c = clampCenter(cx, cy, sw, sh, rect.w, rect.h);
    this.deps.setScreenCenter(c.cx, c.cy);
  }

  // face 묶음 내부 크기(--face-w 등)를 face 배율에 맞춰 element 에 직접 건다.
  applyFaceVars(mul) {
    const node = this.deps.el().face;
    if (!node) return;
    if (!mul || mul === 1) {
      for (const v of ["--face-w", "--face-h", "--face-up", "--rs-band"]) node.style.removeProperty(v);
      return;
    }
    const vars = this.deps.faceVars(mul);
    for (const [k, v] of Object.entries(vars)) node.style.setProperty(k, `${v}px`);
  }

  node(control) {
    const el = this.deps.el();
    if (control.id === "screen") return el.stage;
    if (control.id === "dir") return el.dpad;
    if (control.id === "face") return el.face;
    return this.deps.pad().querySelector(control.sel);
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
      saved.push([node, node.style.position, node.style.left, node.style.top, node.style.translate]);
      node.style.removeProperty("position");
      node.style.removeProperty("left");
      node.style.removeProperty("top");
      node.style.removeProperty("translate");
    }
    const controls = {};
    let screen = { x: 0.5, y: 0.5 };
    for (const c of CONTROLS) {
      const node = this.node(c);
      if (!node || node.hidden || node.hasAttribute("data-off")) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cx = (r.left + r.width / 2 - rect.left) / rect.w;
      const cy = (r.top + r.height / 2 - rect.top) / rect.h;
      if (c.id === "screen") screen = { x: cx, y: cy };
      else controls[c.id] = { x: cx, y: cy };
    }
    for (const [node, position, left, top, translate] of saved) {
      node.style.position = position;
      node.style.left = left;
      node.style.top = top;
      node.style.translate = translate;
    }
    if (had) body.setAttribute("data-pad-free", "");
    return { controls, screen };
  }

  // "크게"(방향 1 안 A) 프리셋: 기본 가운데 + 버튼만 키운다. 저장하지 않고 그때그때 만든다.
  bigLayout(landscape) {
    const bump = { face: 1.5, START: 1.4, SELECT: 1.4, L: 1.17, R: 1.17, keypad: 1.25 };
    const controls = {};
    for (const [id, scale] of Object.entries(bump)) controls[id] = { scale };
    void landscape;
    return { controls };
  }

  // ---- 편집 모드 진입/종료 ------------------------------------------------
  canEdit(landscape) {
    return this.deps.landscape() === landscape && this.deps.padOn();
  }

  startEdit(landscape) {
    if (this.editing || !this.canEdit(landscape)) return;
    const orient = orientationKey(landscape);
    this.orient = orient;
    const saved = this.layout()[orient];
    this.before = { placement: this.placement(), layout: this.deps.prefs().padLayout };
    // 저장된 배치가 없으면 기본 격자에서 가운데를 포착해 씨앗으로(저장값 우선).
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
    this.defaultsSeed = JSON.parse(JSON.stringify(seed));
    this.work = seed;
    this.selected = null;
    this.editing = true;
    this.deps.setPlacement("custom", { silent: true });
    this.deps.hold(true);
    this.deps.relayout();
    this.buildOverlay();
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
    this.deps.relayout();
  }

  save() {
    if (!this.editing) return;
    const layout = normalizeLayout({ ...this.deps.prefs().padLayout, [this.orient]: this.work });
    this.deps.prefs().padLayout = layout;
    this.deps.setPlacement("custom", { silent: true });
    this.deps.persist({ padPlacement: "custom", padLayout: layout });
    this.exit(true);
  }

  reset() {
    if (!this.editing || !this.defaultsSeed) return;
    this.work = JSON.parse(JSON.stringify(this.defaultsSeed));
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
    const root = mk("padedit");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", t(`web.pad.edit.title.${this.orient}`));
    const grid = mk("padedit__grid", root);
    // 빈 곳을 누르면 선택 해제(아래 조작부·화면으로 입력이 새지 않게 막는다).
    grid.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (this.selected) this.select(null);
    });
    // 점선 테두리·손잡이는 막대·카드 아래 층(막대·카드가 늘 위에서 눌리게).
    this.framesLayer = mk("padedit__frames", root);
    const bar = mk("padedit__bar", root);
    const title = mk("padedit__title", bar);
    title.textContent = t(`web.pad.edit.title.${this.orient}`);
    const btn = (label, cls, on) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = `padedit__btn${cls ? " " + cls : ""}`;
      b.textContent = label;
      b.addEventListener("click", on);
      bar.append(b);
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
    btn(t("web.pad.edit.cancel"), "", () => this.exit(false));
    btn(t("web.pad.edit.save"), "padedit__btn--primary", () => this.save());
    this.card = mk("padedit__card", root);
    this.overlay = root;
    this.deps.mount(root);
    this.syncFrames();
    this.renderCard();
    this.onKey = (event) => {
      if (event.key === "Escape") this.exit(false);
    };
    doc.addEventListener("keydown", this.onKey);
  }

  teardownOverlay() {
    if (this.onKey) this.deps.doc().removeEventListener("keydown", this.onKey);
    this.overlay?.remove();
    this.overlay = null;
    this.frames.clear();
    if (this.raf) {
      this.deps.win().cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.pending = null;
    this.drag = null;
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

  // 가운데 미세 조절 카드: 선택한 조작부 이름·크기 − + ·색 고르기.
  renderCard() {
    if (!this.card) return;
    const doc = this.deps.doc();
    const t = this.deps.t;
    this.card.replaceChildren();
    const help = doc.createElement("p");
    help.className = "padedit__help";
    help.textContent = this.selected ? t("web.pad.edit.help2") : t("web.pad.edit.help1");
    this.card.append(help);
    if (!this.selected) return;
    const c = CONTROL_BY_ID[this.selected];
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
      scale: rec.scale ?? 1,
      basePx: this.deps.basePx(id),
    };
    const win = this.deps.win();
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
    const dx = this.pending.x - d.startX;
    const dy = this.pending.y - d.startY;
    if (d.kind === "move") {
      let cx = d.cx + dx;
      let cy = d.cy + dy;
      const others = this.otherBoxes(d.id, rect);
      const snapped = snapCenter(cx, cy, d.w, d.h, { left: 0, top: 0, w: rect.w, h: rect.h }, others, { snapOn: this.snapOn });
      ({ cx, cy } = clampCenter(snapped.cx, snapped.cy, d.w, d.h, rect.w, rect.h));
      this.live = { cx, cy };
      if (d.id === "screen") this.deps.setScreenCenter(cx, cy);
      else {
        node.style.left = `${Math.round(cx - d.w / 2)}px`;
        node.style.top = `${Math.round(cy - d.h / 2)}px`;
      }
      this.drawGuides(snapped.guides, rect);
    } else {
      // 크기: 손잡이를 바깥으로 끌수록 커진다. 가운데는 고정(d.cx·d.cy).
      const far = (dx + dy) / 2;
      const target = clampScale(d.scale * (1 + far / Math.max(40, d.w)));
      this.live = { scale: target };
      const rec = this.work.controls[d.id];
      rec.scale = target;
      if (d.id === "face") this.applyFaceVars(target);
      this.deps.skin().setOverrides(this.overridesFromWork(this.work));
      if (d.id !== "screen") {
        const size = this.sizeOf(node);
        node.style.left = `${Math.round(d.cx - size.w / 2)}px`;
        node.style.top = `${Math.round(d.cy - size.h / 2)}px`;
      } else {
        this.positionScreen(rec, null, rect);
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

  onUp(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const win = this.deps.win();
    win.removeEventListener("pointermove", this.moveFn);
    win.removeEventListener("pointerup", this.upFn);
    win.removeEventListener("pointercancel", this.upFn);
    if (this.raf) {
      win.cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    const d = this.drag;
    const rect = this.deps.appRect();
    const rec = this.work.controls[d.id] ?? (this.work.controls[d.id] = {});
    if (d.kind === "move" && this.live) {
      rec.x = Math.min(1, Math.max(0, this.live.cx / rect.w));
      rec.y = Math.min(1, Math.max(0, this.live.cy / rect.h));
    } else if (d.kind === "resize" && this.live) {
      rec.scale = clampScale(this.live.scale);
    }
    this.drag = null;
    this.pending = null;
    this.live = null;
    for (const g of this.framesLayer?.querySelectorAll(".padedit__guide") ?? []) g.remove();
    this.syncFrames();
    this.renderCard();
  }
}
