// 웹 가상 버튼 여러 손가락 시험(로컬 전용, 롬 없음): 방향(스틱·십자 패드)을 누른 채 두 번째 손가락으로 B 를 누르면 둘 다 눌리는지
// (pad.down 과 player.held 의 LEFT·B 비트). 게임 없이 시작 화면의 가상 버튼으로 본다.
// ① 크롬 CDP Input.dispatchTouchEvent 로 실제 두 손가락(Pointer·Touch 사건을 브라우저가 만듦): 세로·가로 × 스틱·십자 × 기본·크게·직접 배치.
// ② 크롬·웹킷 합성 TouchEvent — 헤드리스 브라우저는 만들지 않지만 실기기에서 올 수 있는 사건 흐름:
//    두 번째 손가락의 touchstart 가 패드에 오지 않고 움직이는 첫 손가락 touchmove 의 touches 에만 보임,
//    첫 손가락이 Pointer 로만 잡힌 뒤 패드가 처음 받는 touchstart 가 두 번째 손가락 것,
//    blur(모두 놓기) 뒤 그대로 있는 손가락, 한 손가락 touchcancel, 패드 밖에서 시작한 손가락.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-multitouch.mjs <주소> [--chrome <chrome.exe>] [--only chromium|webkit]
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium, webkit } = require("playwright-core");

const args = process.argv.slice(2);
const URL_BASE = args[0];
const opt = {};
for (let i = 1; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
const CHROME = opt.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const CUSTOM = {
  portrait: { dir: { x: 0.25, y: 0.78 }, b: { x: 0.62, y: 0.8 }, a: { x: 0.85, y: 0.72 }, L: { x: 0.15, y: 0.6 }, R: { x: 0.85, y: 0.6 }, START: { x: 0.7, y: 0.95 }, SELECT: { x: 0.3, y: 0.95 } },
  landscape: { dir: { x: 0.1, y: 0.65 }, b: { x: 0.8, y: 0.7 }, a: { x: 0.92, y: 0.55 }, L: { x: 0.08, y: 0.3 }, R: { x: 0.92, y: 0.3 }, START: { x: 0.9, y: 0.92 }, SELECT: { x: 0.1, y: 0.92 } },
};

async function open(browser, engine, { orient = "portrait", dirInput = "stick", placement = "default" } = {}) {
  const viewport = orient === "portrait" ? { width: 390, height: 844 } : { width: 844, height: 390 };
  const context = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 3, reducedMotion: "reduce", ...(engine === "chromium" ? { isMobile: true } : {}) });
  await context.addInitScript((prefs) => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    localStorage.setItem("webgba.installHint", "1");
    localStorage.setItem("webgba.prefs", JSON.stringify({ lang: "ko", ...prefs }));
  }, { dirInput, padPlacement: placement });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(URL_BASE);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  if (placement === "custom") {
    await page.evaluate(
      ({ orient, controls }) => {
        const w = window.webgba;
        w.state.prefs.padLayout = { [w.padEditor.currentSig()]: { [orient]: { controls } } };
        w.layout();
      },
      { orient, controls: CUSTOM[orient] },
    );
  }
  await page.waitForTimeout(200);
  return { context, page, errors };
}

const state = (page) =>
  page.evaluate(() => {
    const { pad, player } = window.webgba;
    const bit = (id) => player.bitOf.get(id) ?? 0;
    return { down: [...pad.down].sort().join("+") || "-", left: Boolean(player.held & bit("LEFT")), b: Boolean(player.held & bit("B")), fingers: pad.fingers().length, free: document.body.hasAttribute("data-pad-free") };
  });

const both = (s) => s.left && s.b;
const none = (s) => !s.left && !s.b && s.down === "-" && s.fingers === 0;
const show = (s) => `${s.down}${s.fingers ? ` (${s.fingers}손가락)` : ""}`;

// ① 실제 두 손가락(CDP): 왼쪽으로 민 방향 손가락을 조금씩 움직이는 동안 B 를 누르고, B 를 누른 채 방향 손가락을 더 움직인다.
async function realTouch(browser, cfg) {
  const { context, page, errors } = await open(browser, "chromium", cfg);
  const cdp = await context.newCDPSession(page);
  const send = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })) });
  const box = await page.evaluate(() => {
    const r = (sel) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width };
    };
    return { dir: r("[data-dpad]"), b: r('[data-key="B"]') };
  });
  const f1 = (dx, dy = 0) => ({ id: 1, x: box.dir.x - box.dir.w * 0.3 + dx, y: box.dir.y + dy });
  const f2 = { id: 2, x: box.b.x, y: box.b.y };
  await send("touchStart", [f1(0)]);
  await send("touchMove", [f1(-2, 1)]);
  const one = await state(page);
  await send("touchStart", [f1(-2, 1), f2]);
  const two = await state(page);
  await send("touchMove", [f1(-5, 2), f2]);
  await send("touchMove", [f1(-7, 3), f2]);
  const moved = await state(page);
  await send("touchEnd", []);
  await page.waitForTimeout(50);
  const off = await state(page);
  const name = `[크롬 실제 두 손가락 · ${cfg.orient === "portrait" ? "세로" : "가로"} · ${cfg.dirInput === "stick" ? "스틱" : "십자"} · ${{ default: "기본", big: "크게", custom: "직접 배치" }[cfg.placement]}] 방향 누른 채 B → 둘 다, 방향을 더 움직여도 B 유지, 떼면 0`;
  ok(name, one.left && !one.b && both(two) && both(moved) && none(off) && (cfg.placement === "default") !== two.free && !errors.length, `${show(one)} → ${show(two)} → ${show(moved)} → ${show(off)}${errors.length ? ` · 오류 ${errors[0]}` : ""}`);
  await context.close();
}

// ② 합성 TouchEvent 흐름. 사건마다 대상 요소에 보내고(패드 루트로 올라감), 단계마다 상태를 돌려준다.
function flow(kind) {
  const list = (arr) => (typeof document.createTouchList === "function" ? document.createTouchList(...arr) : arr);
  const mk = (id, target, p) => {
    try {
      return new Touch({ identifier: id, target, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y, screenX: p.x, screenY: p.y, radiusX: 8, radiusY: 8, force: 1 });
    } catch {
      return document.createTouch(window, target, id, p.x, p.y, p.x, p.y, 8, 8, 0, 1);
    }
  };
  const fire = (type, target, changed, touches) => target.dispatchEvent(new TouchEvent(type, { touches: list(touches), targetTouches: list(touches.filter((t) => t.target === target)), changedTouches: list(changed), bubbles: true, cancelable: true }));
  const pointer = (type, target, id, p) => target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: true, clientX: p.x, clientY: p.y, width: 16, height: 16, bubbles: true, cancelable: true }));
  const at = (node, dx = 0) => {
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2 + dx * r.width, y: r.top + r.height / 2 };
  };
  const snap = () => {
    const { pad, player } = window.webgba;
    const bit = (id) => player.bitOf.get(id) ?? 0;
    return { down: [...pad.down].sort().join("+") || "-", left: Boolean(player.held & bit("LEFT")), b: Boolean(player.held & bit("B")), fingers: pad.fingers().length, late: pad.lateTouches ?? null };
  };
  const dir = document.querySelector("[data-dpad]");
  const key = document.querySelector('[data-key="B"]');
  const p1 = at(dir, -0.3);
  const p1b = { x: p1.x - 3, y: p1.y + 1 };
  const p2 = at(key);
  const out = [];
  if (kind === "missedStart") {
    const t1 = mk(1, dir, p1);
    fire("touchstart", dir, [t1], [t1]);
    out.push(snap());
    const t1b = mk(1, dir, p1b);
    const t2 = mk(2, key, p2);
    fire("touchmove", dir, [t1b], [t1b, t2]);
    out.push(snap());
    fire("touchend", key, [t2], [t1b]);
    out.push(snap());
    fire("touchend", dir, [t1b], []);
    out.push(snap());
  } else if (kind === "pointerFirst") {
    pointer("pointerdown", dir, 11, p1);
    out.push(snap());
    pointer("pointerdown", key, 12, p2);
    const t1 = mk(1, dir, p1);
    const t2 = mk(2, key, p2);
    fire("touchstart", key, [t2], [t1, t2]);
    out.push(snap());
    const t1b = mk(1, dir, p1b);
    fire("touchmove", dir, [t1b], [t1b, t2]);
    out.push(snap());
    pointer("pointerup", key, 12, p2);
    pointer("pointerup", dir, 11, p1b);
    fire("touchend", key, [t2], [t1b]);
    fire("touchend", dir, [t1b], []);
    out.push(snap());
  } else if (kind === "blur") {
    const t1 = mk(1, dir, p1);
    const t2 = mk(2, key, p2);
    fire("touchstart", dir, [t1], [t1]);
    fire("touchstart", key, [t2], [t1, t2]);
    out.push(snap());
    window.dispatchEvent(new Event("blur"));
    out.push(snap());
    const t1b = mk(1, dir, p1b);
    fire("touchmove", dir, [t1b], [t1b, t2]);
    out.push(snap());
    fire("touchend", key, [t2], [t1b]);
    fire("touchend", dir, [t1b], []);
    const t3 = mk(3, key, p2);
    fire("touchstart", key, [t3], [t3]);
    out.push(snap());
    fire("touchend", key, [t3], []);
  } else if (kind === "cancel") {
    const t1 = mk(1, dir, p1);
    const t2 = mk(2, key, p2);
    fire("touchstart", dir, [t1], [t1]);
    fire("touchstart", key, [t2], [t1, t2]);
    out.push(snap());
    fire("touchcancel", key, [t2], [t1]);
    out.push(snap());
    const t1b = mk(1, dir, p1b);
    fire("touchmove", dir, [t1b], [t1b]);
    out.push(snap());
    fire("touchend", dir, [t1b], []);
    out.push(snap());
  } else if (kind === "outside") {
    const canvas = document.getElementById("canvas");
    const t1 = mk(1, dir, p1);
    fire("touchstart", dir, [t1], [t1]);
    const t3 = mk(3, canvas, at(canvas));
    fire("touchstart", canvas, [t3], [t1, t3]);
    const t1b = mk(1, dir, p1b);
    const t3b = mk(3, canvas, p2);
    fire("touchmove", dir, [t1b], [t1b, t3b]);
    out.push(snap());
    fire("touchend", canvas, [t3b], [t1b]);
    fire("touchend", dir, [t1b], []);
    out.push(snap());
  }
  return out;
}

const FLOWS = [
  ["missedStart", "두 번째 손가락 touchstart 가 패드에 오지 않음 → 움직이는 방향 손가락 touchmove 의 touches 로 B 잡기, B 떼면 방향만, 다 떼면 0", (s) => s[0].left && !s[0].b && both(s[1]) && s[2].left && !s[2].b && none(s[3])],
  ["pointerFirst", "방향 손가락이 Pointer 로만 잡힌 뒤 첫 touchstart 가 B 손가락 것 → 방향 유지 + B, 움직여도 둘 다, 다 떼면 0", (s) => s[0].left && both(s[1]) && both(s[2]) && none(s[3])],
  ["blur", "blur(모두 놓기) 뒤 그대로 있는 손가락은 다시 누르지 않음(전과 같음), 새로 누른 손가락은 바로", (s) => both(s[0]) && none(s[1]) && none(s[2]) && s[3].b && !s[3].left],
  ["cancel", "B 손가락만 touchcancel → 방향 유지·B 풀림, 다음 move 에도 B 다시 안 눌림, 떼면 0", (s) => both(s[0]) && s[1].left && !s[1].b && s[2].left && !s[2].b && none(s[3])],
  ["outside", "패드 밖(게임 화면)에서 시작한 손가락은 B 자리로 와도 누르지 않음", (s) => s[0].left && !s[0].b && s[0].fingers === 1 && none(s[1])],
];

async function flows(browser, engine) {
  for (const [kind, text, pass] of FLOWS) {
    for (const cfg of [{ orient: "portrait", dirInput: "stick" }, { orient: "landscape", dirInput: "dpad" }]) {
      const { context, page, errors } = await open(browser, engine, cfg);
      const steps = await page.evaluate(flow, kind);
      const where = `${cfg.orient === "portrait" ? "세로 스틱" : "가로 십자"}`;
      ok(`[${engine === "chromium" ? "크롬" : "웹킷"} 합성 · ${where}] ${text}`, pass(steps) && !errors.length, `${steps.map(show).join(" → ")}${steps.at(-1).late !== null ? ` · 늦게 잡은 손가락 ${steps.at(-1).late}` : ""}${errors.length ? ` · 오류 ${errors[0]}` : ""}`);
      await context.close();
    }
  }
}

if (opt.only !== "webkit") {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    for (const orient of ["portrait", "landscape"]) for (const dirInput of ["stick", "dpad"]) for (const placement of ["default", "big", "custom"]) await realTouch(browser, { orient, dirInput, placement });
    await flows(browser, "chromium");
  } finally {
    await browser.close();
  }
}
if (opt.only !== "chromium") {
  const browser = await webkit.launch({ headless: true });
  try {
    await flows(browser, "webkit");
  } finally {
    await browser.close();
  }
}
const failed = results.filter((r) => !r.pass).length;
console.log(`결과: ${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
