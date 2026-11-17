// 자율배치 에디터 헤드리스 시험(node 만, 화면·브라우저 없음): 데이터 모델·좌표·배율·색 계산, pixel-ui 색 교체, skin 조작부별 배율·색.
//   node --test web/test/web-pad-editor.mjs
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeLayout, hasLayout, orientationKey, clampScale, scalePercent, scaleStep,
  clampCenter, snapCenter, colorChoices, colorHexOf, activeColorId, CONTROL_BY_ID,
  layoutSignature, CONTROLS, PadEditor,
} from "../src/js/pad-editor.js";
import * as PX from "../src/js/pixel-ui.js";

test("placeNode subtracts offsetParent origin (no jump in any container)", () => {
  const ed = new PadEditor();
  const mk = (opLeft, opTop) => ({ offsetParent: { getBoundingClientRect: () => ({ left: opLeft, top: opTop }) }, style: {} });
  const rect = { left: 0, top: 0, w: 800, h: 400 };
  // offsetParent 원점 = appRect 원점(.pad) → 보정 0
  const a = mk(0, 0);
  ed.placeNode(a, 100, 80, 20, 10, rect);
  assert.equal(a.style.left, "90px"); // 100 - 10 - 0
  assert.equal(a.style.top, "75px"); // 80 - 5 - 0
  // offsetParent 가 화면 중간(.face) → 그 원점만큼 빼 같은 화면 자리에 놓임
  const b = mk(40, 20);
  ed.placeNode(b, 100, 80, 20, 10, rect);
  assert.equal(b.style.left, "50px"); // 100 - 10 - 40
  assert.equal(b.style.top, "55px"); // 80 - 5 - 20
});

const PAL = PX.paletteOf({ body: "#101828", button: "#35406a", accent: "#6c93ff", ink: "#eef1f8", outline: "#05070e" });
const SIG = "a,b,dir";

test("orientationKey", () => {
  assert.equal(orientationKey(true), "landscape");
  assert.equal(orientationKey(false), "portrait");
});

test("layoutSignature = sorted present ids, screen excluded, deterministic", () => {
  assert.equal(layoutSignature(["dir", "a", "b"]), "a,b,dir");
  assert.equal(layoutSignature(["b", "a", "dir"]), "a,b,dir"); // 순서 무관
  assert.equal(layoutSignature(["dir", "a", "b", "screen"]), "a,b,dir"); // 화면 제외
  assert.equal(layoutSignature(["a", "a", "b"]), "a,b"); // 중복 제거
  assert.equal(layoutSignature([]), "default");
});

test("buttons are independent controls (a·b·c·d·rs), no face group", () => {
  const ids = CONTROLS.map((c) => c.id);
  for (const id of ["a", "b", "c", "d", "rs"]) assert.ok(ids.includes(id), `has ${id}`);
  assert.ok(!ids.includes("face"), "no face group");
  assert.equal(CONTROL_BY_ID.a.keys[0], "A");
  assert.equal(CONTROL_BY_ID.b.keys[0], "B");
});

test("normalizeLayout keeps valid per signature, drops unknown", () => {
  const raw = { [SIG]: { landscape: { controls: { a: { x: 0.4, y: 0.6, scale: 1.3, color: "accent" }, bogus: { x: 0.1 }, screen: { color: "x", scale: 1.2 } } } }, "": { landscape: { controls: { a: { x: 0.2 } } } } };
  const out = normalizeLayout(raw);
  assert.deepEqual(out[SIG].landscape.controls.a, { x: 0.4, y: 0.6, scale: 1.3, color: "accent" });
  assert.equal(out[SIG].landscape.controls.bogus, undefined);
  assert.equal("color" in out[SIG].landscape.controls.screen, false); // screen 은 색 없음
  assert.equal(out[SIG].landscape.controls.screen.scale, 1.2);
  assert.equal(out[SIG].portrait, undefined);
  assert.equal(out[""], undefined); // 빈 signature 키는 버림
});

test("normalizeLayout clamps ranges", () => {
  const out = normalizeLayout({ [SIG]: { portrait: { controls: { L: { x: 2, y: -1, scale: 9 } } } } });
  assert.equal(out[SIG].portrait.controls.L.x, 1);
  assert.equal(out[SIG].portrait.controls.L.y, 0);
  assert.equal(out[SIG].portrait.controls.L.scale, 2);
});

test("hasLayout checks signature + orientation", () => {
  const lay = normalizeLayout({ [SIG]: { landscape: { controls: { L: { x: 0.5 } } } } });
  assert.equal(hasLayout(lay, true, SIG), true);
  assert.equal(hasLayout(lay, false, SIG), false); // 세로 없음
  assert.equal(hasLayout(lay, true, "a,dir"), false); // 다른 집합
  assert.equal(hasLayout({}, true, SIG), false);
});

test("clampScale range", () => {
  assert.equal(clampScale(0.1), 0.75);
  assert.equal(clampScale(5), 2);
  assert.equal(clampScale(1.25), 1.25);
});

test("scalePercent", () => {
  assert.equal(scalePercent(1), 100);
  assert.equal(scalePercent(1.337), 134);
});

test("scaleStep moves by one device pixel and clamps", () => {
  assert.equal(scaleStep(1, 1, 10), 1.1);
  assert.equal(scaleStep(1, -1, 10), 0.9);
  assert.equal(scaleStep(2, 1, 10), 2); // 상한
  assert.equal(scaleStep(0.75, -1, 10), 0.75); // 하한
});

test("clampCenter keeps box inside, centers oversize", () => {
  assert.deepEqual(clampCenter(5, 5, 20, 20, 100, 100), { cx: 10, cy: 10 });
  assert.deepEqual(clampCenter(95, 95, 20, 20, 100, 100), { cx: 90, cy: 90 });
  assert.deepEqual(clampCenter(50, 50, 200, 100, 100, 80), { cx: 50, cy: 40 });
});

test("snapCenter off = unchanged, no guides", () => {
  const r = snapCenter(103, 57, 20, 20, { left: 0, top: 0, w: 200, h: 200 }, [], { snapOn: false });
  assert.equal(r.cx, 103);
  assert.equal(r.cy, 57);
  assert.equal(r.guides.length, 0);
});

test("snapCenter snaps to container center then grid", () => {
  const r = snapCenter(103, 57, 20, 20, { left: 0, top: 0, w: 200, h: 200 }, [], { snapOn: true, grid: 8, tol: 6 });
  assert.equal(r.cx, 100); // 테두리 가운데(100)로
  assert.ok(r.guides.some((g) => g.x === 100));
  assert.equal(r.cy % 8, 0); // 정렬선 없으면 8px 격자
});

test("snapCenter aligns to another control edge", () => {
  const others = [{ cx: 40, cy: 40, left: 30, right: 50, top: 30, bottom: 50 }];
  const r = snapCenter(43, 120, 20, 20, { left: 0, top: 0, w: 200, h: 200 }, others, { snapOn: true, tol: 6 });
  assert.equal(r.cx, 40); // 다른 조작부에 맞춰 당겨짐(왼쪽 가장자리 30 정렬)
  assert.ok(r.guides.some((g) => g.x === 30));
});

test("colorChoices = theme palette faces, deduped, stable ids", () => {
  const list = colorChoices(PAL);
  const ids = list.map((c) => c.id);
  assert.ok(ids.includes("accent"));
  assert.ok(ids.includes("cd"));
  assert.ok(ids.includes("pill"));
  assert.equal(new Set(list.map((c) => c.hex)).size, list.length); // 색 중복 없음
  assert.equal(colorHexOf(PAL, "accent"), PAL.ab.toLowerCase());
});

test("activeColorId = override else control default", () => {
  const a = CONTROL_BY_ID.a;
  assert.equal(activeColorId(a, { color: "cd" }), "cd");
  assert.equal(activeColorId(a, {}), "accent"); // A·B 기본 = 강조색
  assert.equal(activeColorId(a, undefined), "accent");
  assert.equal(activeColorId(CONTROL_BY_ID.c, {}), "cd"); // C·D 기본 = cd
});

test("recolorRoles rebuilds one role face, memoizes, no-op when empty", () => {
  const r = PX.recolorRoles(PAL, { ab: "#ff0000" });
  assert.notEqual(r, PAL);
  assert.equal(r.ab, "#ff0000");
  assert.equal(r.sh, PAL.sh); // 다른 역할은 그대로
  assert.notEqual(r.abHi, PAL.abHi); // 빛·옆면도 새 색 계열
  const r2 = PX.recolorRoles(PAL, { ab: "#ff0000" });
  assert.equal(r2, r); // 같은 입력 = 같은 객체(캐시)
  assert.equal(PX.recolorRoles(PAL, {}), PAL); // 지정 없으면 그대로
});

// 원형 패드(스틱) N2 그래픽: 받침 2단 그림자·방향 호·강조색 손잡이. 역할 맵(_art)으로 검사(canvas stub).
function stubCanvas() {
  if (globalThis.OffscreenCanvas) return;
  const ctx = {
    imageSmoothingEnabled: false,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData() {},
    drawImage() {},
  };
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx; } };
}
const roleSet = (render) => new Set(render._art.roles.filter(Boolean));

test("palette has 2-step shadow roles, darker than well", () => {
  for (const k of ["wellSh1", "wellSh2", "offSh1", "offSh2"]) assert.equal(typeof PAL[k], "string");
  assert.notEqual(PAL.wellSh1, PAL.well);
  assert.notEqual(PAL.wellSh1, PAL.wellSh2); // 2단(진한·옅은)
});

test("stick base idle = 2-step shadow + well, no body/ring, 1px outline only", () => {
  stubCanvas();
  const r = roleSet(PX.renderStickBase({ palette: PAL }));
  for (const k of ["outline", "wellSh1", "wellSh2", "well"]) assert.ok(r.has(k), `has ${k}`);
  for (const k of ["body", "bodyHi", "bodyLo2", "ring", "ringHi"]) assert.ok(!r.has(k), `no ${k}`);
});

test("stick base direction arc only while dragging", () => {
  stubCanvas();
  const idle = roleSet(PX.renderStickBase({ palette: PAL })); // 방향 없음(평소) = 호 없음
  assert.ok(!idle.has("ring") && !idle.has("ringHi"));
  const drag = roleSet(PX.renderStickBase({ state: "pressed", direction: "up", palette: PAL }));
  assert.ok(drag.has("ring") && drag.has("ringHi")); // 끌 때(방향 전달) 호(가운데 가장 밝음)
  const off = roleSet(PX.renderStickBase({ state: "disabled", direction: "up", palette: PAL }));
  assert.ok(!off.has("ring") && !off.has("ringHi")); // 비활성화 시 호 없음
});

test("stick base disabled uses off shadow steps", () => {
  stubCanvas();
  const r = roleSet(PX.renderStickBase({ state: "disabled", palette: PAL }));
  assert.ok(r.has("offSh1") && r.has("offSh2"));
});

test("stick knob is accent(ab)", () => {
  stubCanvas();
  const r = roleSet(PX.renderStickKnob({ palette: PAL }));
  assert.ok(r.has("ab"), "accent face");
  assert.ok(!r.has("btn"), "no button face");
});

// skin 조작부별 배율·색: DOM 없이 constructor + 순수 메서드만 시험(그리기 호출하지 않음).
test("skin per-control scale and color (no DOM draw)", async () => {
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.document = { documentElement: { dataset: {}, style: { getPropertyValue: () => "", setProperty() {} } } };
  const { Skin } = await import("../src/js/skin.js");
  const skin = new Skin({ pad: {}, dpad: {} });
  skin.dpr = 2;
  // 역할 매핑
  assert.equal(skin.roleOf("a"), "ab");
  assert.equal(skin.roleOf("c"), "cd");
  assert.equal(skin.roleOf("l"), "sh");
  assert.equal(skin.roleOf("start"), "pill");
  assert.equal(skin.roleOf("rs"), "rs");
  // 기본(override 없음) = scaleOf 그대로
  assert.equal(skin.effScale("A", 3), skin.scaleOf(3));
  // 배율 곱 → 기기 픽셀 정수
  skin.scaleMul = { A: 1.5 };
  assert.equal(skin.effScale("A", 3), Math.max(1, Math.round(skin.px(3) * 1.5)));
  // 색 지정 → recolor 팔레트, 없으면 원본
  skin.colorHex = { A: "#00ff00" };
  const pal = skin.paletteFor("a", "A");
  assert.notEqual(pal, skin.palette);
  assert.equal(pal.ab, "#00ff00");
  assert.equal(skin.paletteFor("b", "B"), skin.palette); // 지정 없는 part 는 원본
});

// 터치 스틱: 입력 상태는 즉시, 손잡이 redraw 만 rAF 1프레임 1회로 coalesce(입력 지연 없이 시각 비용만 줄임).
test("skin.stick coalesces redraw to one per frame, state immediate", async () => {
  const cbs = [];
  globalThis.requestAnimationFrame = (fn) => { cbs.push(fn); return cbs.length; };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.document = { documentElement: { dataset: {}, style: { getPropertyValue: () => "", setProperty() {} } } };
  const { Skin } = await import("../src/js/skin.js");
  const skin = new Skin({ pad: {}, dpad: {} });
  skin.mode = "stick";
  let draws = 0;
  skin.drawDir = () => { draws += 1; };
  for (let i = 0; i < 100; i++) skin.stick(i / 100, 0, true); // 입력 100회(빠른 이동)
  assert.equal(draws, 0, "redraw 는 rAF 전에는 0회(move 마다 그리지 않음)");
  assert.equal(skin.stickState.x, 0.99, "상태는 즉시 최신(입력 저지연)");
  assert.equal(cbs.length, 1, "중복 rAF 예약 금지 — 한 프레임 1건만");
  cbs[0](); // 프레임 flush
  assert.equal(draws, 1, "한 프레임에 redraw 1회(100 입력 → 1 그리기)");
  skin.stick(0, 0, false); // 다음 프레임 예약
  assert.equal(cbs.length, 2);
  cbs[1]();
  assert.equal(draws, 2);
});
