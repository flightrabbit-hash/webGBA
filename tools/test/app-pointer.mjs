// 마우스 시험(사용자 2026-10-29 "마우스 조작으로 컨트롤 가능하도록 개선(포토체스에만 허용)"). 실제 앱을 CDP 로 다룬다
// (Input.dispatchMouseEvent: 실제 마우스는 움직이지 않음).
//   node tools/test/app-pointer.mjs <exe> <작업 폴더>
// 작업 폴더: rom\test.gba(mGBA 코어로 열 아무 GBA 롬) · port\<빌드>.wgba(Web_Pointer 가 있는 포트 빌드, 롬 내장) · port\<빌드>.sav
// (필드에서 이어하는 포트 세이브). 앱 폴더 <작업>\app_pointer 를 새로 만든다(wgbaLink false: 레지스트리 안 건드림).
// 결과 <작업>\app_pointer_result.json, 캡처 <작업>\captures\pointer_drag.png
// 포트 쪽 상태는 그 빌드의 시험용 내보내기(Web_DebugAcGameScreen·Web_DebugAcGameState·Web_DebugAcMouse)로 본다.
import fs from "fs";
import path from "path";
import { attach, connect, guardOthers, launch, prepareApp, runningIn, sleep, TEST_BUILD } from "./cdp.mjs";

const [exe, work] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-pointer.mjs <exe> <작업 폴더>");
  process.exit(2);
}

const PORT = 9343;
const appDir = path.join(work, "app_pointer");
const T = "window.__WEBGBA_TEST__";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

let app = null;

const RECORD = `(() => {
  const h = ${T}.player.host;
  window.__ptr = [];
  if (h.pointer && !h.__pointer) {
    h.__pointer = h.pointer.bind(h);
    h.pointer = (...a) => { window.__ptr.push(a); return h.__pointer(...a); };
  }
  if (!window.__menuSeen) {
    window.__menuSeen = [];
    window.addEventListener("contextmenu", (e) => { window.__menuSeen.push(e.defaultPrevented); e.preventDefault(); });
  }
  return true;
})()`;
const calls = () => app.evaluate("window.__ptr.slice()");
const clearCalls = () => app.evaluate("(window.__ptr = [], true)");
const last = async () => (await calls()).slice(-1)[0] ?? null;
const box = () => app.evaluate("(() => { const r = document.getElementById('screen').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()");
// a game pixel's middle on the page (the canvas's box now)
const at = (b, gx, gy) => ({ x: b.left + ((gx + 0.5) * b.width) / 240, y: b.top + ((gy + 0.5) * b.height) / 160 });
const mouse = (type, p, extra = {}) => app.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "none", buttons: 0, ...extra });
const moveTo = (p, buttons = 0) => mouse("mouseMoved", p, { buttons, button: buttons & 1 ? "left" : buttons & 2 ? "right" : "none" });
const pressAt = (p, button = "left") => mouse("mousePressed", p, { button, buttons: button === "left" ? 1 : 2, clickCount: 1 });
const releaseAt = (p, button = "left") => mouse("mouseReleased", p, { button, buttons: 0, clickCount: 1 });
const clickAt = async (p, button = "left", wait = 250) => {
  await moveTo(p);
  await sleep(40);
  await pressAt(p, button);
  await sleep(40);
  await releaseAt(p, button);
  await sleep(wait);
};
const wheelAt = (p, deltaY) => mouse("mouseWheel", p, { deltaX: 0, deltaY });

const EX = `${T}.player.host.ex`;
const GAME = `(() => { const ex = ${EX}; const p = ex.Web_DebugAcGameState() >>> 0; return Array.from(new Uint32Array(ex.memory.buffer, p, 36)); })()`;
const st = () => app.evaluate(GAME);
const phase = async () => (await st())[0];
const waitPhase = async (want, ms = 4000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await phase()) === want) return true;
    await sleep(50);
  }
  return (await phase()) === want;
};
const gameU8 = (expr) => app.evaluate(`(() => { const ex = ${EX}; const u8 = new Uint8Array(ex.memory.buffer); return ${expr}; })()`);
const LAYOUT = (k) => `ex.Web_DebugAcGameLayout(${k})`;
const coins = () => gameU8(`(() => { const pl = window.__G + ${LAYOUT(2)}; return u8[pl + ${LAYOUT(9)}] | (u8[pl + ${LAYOUT(9)} + 1] << 8); })()`);
const board = () => gameU8(`(() => { const pl = window.__G + ${LAYOUT(2)}; return Array.from({ length: 20 }, (_, k) => u8[pl + ${LAYOUT(6)} + k * ${LAYOUT(16)}]); })()`);
const bench = () => gameU8(`(() => { const pl = window.__G + ${LAYOUT(2)}; return Array.from({ length: 7 }, (_, k) => u8[pl + ${LAYOUT(7)} + k * ${LAYOUT(16)}]); })()`);
// a zone of the screen (kind, arg) -> its middle in game pixels (hack_autochess_mouse.inc Port_AcMouseDebug)
const zone = (kind, arg) =>
  app.evaluate(`(() => { const ex = ${EX}; const n = ex.Web_DebugAcMouse(0);
    for (let i = n; i-- > 0;) { const a = ex.Web_DebugAcMouse(100 + i) >>> 0, r = ex.Web_DebugAcMouse(200 + i) >>> 0;
      if ((a & 255) === ${kind} && ((a >> 8) & 255) === ${arg} && (a >>> 24)) return [((r & 255) + ((r >>> 16) & 255)) >> 1, (((r >>> 8) & 255) + (r >>> 24)) >> 1]; }
    return null; })()`);

async function mappingTests(label) {
  let b = await box();
  await clearCalls();
  await moveTo(at(b, 120, 80));
  await sleep(80);
  let c = await last();
  const mid = c && c[0] === 120 && c[1] === 80 && c[2] === 0;
  await moveTo(at(b, 0, 0)); // (a game pixel's middle: the page's points are whole pixels, the canvas's edge may not be)
  await sleep(60);
  const tl = await last();
  // (the right / bottom end: a few pixels in - the window's resize grips (.grip) lie over the window's edge, where the canvas
  // may touch it)
  await moveTo(at(b, 236, 156));
  await sleep(60);
  const br = await last();
  await moveTo({ x: b.left - 6, y: b.top + 10 });
  await sleep(60);
  const out = await last();
  check(
    `${label} M1 좌표(화면 맞춤 ${Math.round(b.width)}x${Math.round(b.height)}): 가운데 (120,80) · 왼쪽 위 (0,0) · 오른쪽 아래 (236,156) · 밖 (-1,-1)`,
    mid && tl?.[0] === 0 && tl?.[1] === 0 && br?.[0] === 236 && br?.[1] === 156 && out?.[0] === -1 && out?.[1] === -1,
    JSON.stringify({ mid: c, tl, br, out }),
  );
  await app.evaluate(`(${T}.state.prefs.scaleMode = "integer", window.dispatchEvent(new Event("resize")), true)`);
  await sleep(200);
  b = await box();
  await moveTo(at(b, 60, 40));
  await sleep(60);
  c = await last();
  await moveTo(at(b, 200, 150));
  await sleep(60);
  const c2 = await last();
  check(
    `${label} M2 좌표(정수 배율 ${Math.round(b.width)}x${Math.round(b.height)}): (60,40) · (200,150)`,
    Math.round(b.width) % 240 === 0 && c?.[0] === 60 && c?.[1] === 40 && c2?.[0] === 200 && c2?.[1] === 150,
    JSON.stringify({ c, c2 }),
  );
  await app.evaluate(`(${T}.state.prefs.scaleMode = "fit", window.dispatchEvent(new Event("resize")), true)`);
  await sleep(200);
  b = await box();
  const p = at(b, 100, 70);
  await clearCalls();
  await moveTo(p);
  await sleep(40);
  await pressAt(p, "left");
  await sleep(60);
  const down = await last();
  await releaseAt(p, "left");
  await sleep(60);
  const up = await last();
  await pressAt(p, "right");
  await sleep(60);
  const rdown = await last();
  await releaseAt(p, "right");
  await sleep(60);
  check(`${label} M3 버튼: 왼쪽 누름 1 · 뗌 0 · 오른쪽 누름 2`, down?.[2] === 1 && up?.[2] === 0 && rdown?.[2] === 2, JSON.stringify({ down, up, rdown }));
  await clearCalls();
  await wheelAt(p, 100);
  await sleep(60);
  await wheelAt(p, -100);
  await sleep(60);
  for (let i = 0; i < 4; i++) {
    await wheelAt(p, 12);
    await sleep(30);
  }
  await sleep(60);
  const wheels = (await calls()).map((a) => a[3]).filter((w) => w);
  check(`${label} M4 휠: 한 칸 +1 · -1, 작은 움직임(12px x4)은 모아서 한 칸`, wheels.join() === "1,-1,1", JSON.stringify(wheels));
}

try {
  guardOthers(exe, work);
  if (runningIn(work)) throw new Error("시험 폴더의 webgba.exe 가 아직 켜져 있습니다");
  fs.rmSync(appDir, { recursive: true, force: true });
  const gba = path.join(work, "rom", "test.gba");
  const wgba = path.join(work, "port", `${TEST_BUILD}.wgba`);
  const sav = path.join(work, "port", `${TEST_BUILD}.sav`);
  const savSeed = path.join(work, "port", `${TEST_BUILD}.sav.seed`);
  if (fs.existsSync(savSeed)) fs.copyFileSync(savSeed, sav); // (the field's save as it was: the game may write it)
  fs.mkdirSync(path.join(work, "captures"), { recursive: true });
  prepareApp(exe, appDir);
  fs.writeFileSync(
    path.join(appDir, "bin", "ini", "personalization.cfg"),
    JSON.stringify({ window: { x: 60, y: 60, width: 1100, height: 760, maximized: false }, panel: "files", wgbaLink: false, volume: 80, muted: true, fastScale: 4, slot: 1, recent: [], favorites: [], scaleMode: "fit" }, null, 2),
  );
  launch(path.join(appDir, "webgba.exe"), PORT);
  app = await attach(PORT);
  await app.send("Emulation.setFocusEmulationEnabled", { enabled: true });

  // .gba (the mGBA core): no Web_Pointer - nothing sent, the right click's menu not kept off
  await app.evaluate(`${T}.openPath(${JSON.stringify(gba)})`);
  await app.evaluate(`new Promise((r) => { const t = () => (${T}.state.game && !${T}.state.opening ? r(true) : setTimeout(t, 50)); t(); })`);
  await sleep(1500);
  await app.evaluate(RECORD);
  let b = await box();
  await clickAt(at(b, 120, 80));
  await clickAt(at(b, 120, 80), "right");
  const gbaCalls = await calls();
  const gbaMenu = await app.evaluate("window.__menuSeen.slice(-1)[0]");
  check(".gba G1 mGBA 코어: 마우스를 넘기지 않음, 우클릭 메뉴 막지 않음", (await app.evaluate(`${T}.player.host.hasPointer`)) === false && gbaCalls.length === 0 && gbaMenu === false, JSON.stringify({ calls: gbaCalls.length, prevented: gbaMenu }));

  // .wgba (the port): the mapping, the buttons, the wheel
  await app.evaluate(`${T}.openPath(${JSON.stringify(wgba)})`);
  await app.evaluate(`new Promise((r) => { const t = () => (${T}.state.game && !${T}.state.opening ? r(true) : setTimeout(t, 50)); t(); })`);
  await sleep(1500);
  await app.evaluate(RECORD);
  check(".wgba W1 포트: Web_Pointer 있음, 타이틀에서 Web_PointerWanted 0", (await app.evaluate(`${T}.player.host.hasPointer`)) === true && (await app.evaluate(`${T}.player.host.pointerWanted`)) === false);
  await mappingTests(".wgba");
  b = await box();
  await clickAt(at(b, 120, 80), "right");
  check(".wgba W2 포토체스 밖(타이틀): 우클릭 메뉴 막지 않음", (await app.evaluate("window.__menuSeen.slice(-1)[0]")) === false);

  // the save to the field (START, then A on 이어서 하기; the recap skipped by B)
  await app.evaluate("document.getElementById('stage').focus(); true");
  let field = false;
  for (let i = 0; i < 120 && !field; i++) {
    await app.key(i < 6 ? "Enter" : i % 3 === 0 ? "KeyZ" : "KeyX", 80);
    await sleep(250);
    field = Boolean(await app.evaluate(`${EX}.Web_DebugInOverworld()`));
  }
  await sleep(1500);
  check(".wgba W3 세이브로 필드까지", field);
  check(".wgba W4 필드: Web_PointerWanted 0", (await app.evaluate(`${T}.player.host.pointerWanted`)) === false);

  // the 포토체스 screen (the build's test entry, as test/autochess_mouse.js): the pick, the shop, a drag
  await app.evaluate(`(window.__G = ${EX}.Web_DebugAcGameScreen(7, 30) >>> 0, true)`);
  check(".wgba P1 포토체스: 고르기", await waitPhase(6, 8000));
  await sleep(500);
  check(".wgba P2 포토체스: Web_PointerWanted 1", (await app.evaluate(`${T}.player.host.pointerWanted`)) === true);
  b = await box();
  // (the right button on a card: its info card - the game's; again: closed, the pick as it was)
  await clickAt(at(b, 48 * 2 + 24, 100), "right", 400);
  const infoUp = (await phase()) === 3;
  const kept = await app.evaluate("window.__menuSeen.slice(-1)[0]");
  await clickAt(at(b, 120, 80), "right", 400);
  check(".wgba P3 포토체스: 우클릭 메뉴를 막음(카드 우클릭 = 그 정보 카드, 다시 = 닫힘)", kept === true && infoUp && (await phase()) === 6 && (await app.evaluate("window.__menuSeen.slice(-1)[0]")) === true);
  await moveTo(at(b, 48 * 2 + 24, 100));
  await sleep(200);
  const hover = (await st())[3];
  await clickAt(at(b, 48 * 2 + 24, 100), "left", 300);
  check(".wgba P4 고르기 카드: 올리면 고름, 누르면 받음 → 준비", hover === 2 && (await waitPhase(1, 3000)), JSON.stringify({ hover }));
  await sleep(600);
  const shopZone = await zone(0, 4);
  if (shopZone) await clickAt(at(b, shopZone[0], shopZone[1]), "left", 400);
  check(".wgba P5 아래 줄 R상점 누름 → 상점", shopZone && (await phase()) === 2, JSON.stringify(shopZone));
  const c0 = await coins();
  await clickAt(at(b, 24, 100), "left", 400);
  const c1 = await coins();
  check(".wgba P6 상점 카드 누름 → 삼", c1 < c0, `${c0} → ${c1}`);
  await clickAt(at(b, 120, 40), "left", 400);
  check(".wgba P7 상점 위 누름 → 닫힘", (await phase()) === 1);
  const bk = (await bench()).findIndex((l) => l !== 0xff);
  const line = (await bench())[bk];
  const from = at(b, 8 + bk * 32 + 16, 128), to = at(b, 24 + 24 + 12, 30 + 2 * 16 + 5);
  await moveTo(from);
  await sleep(50);
  await pressAt(from);
  await sleep(120);
  for (let i = 1; i <= 8; i++) {
    await moveTo({ x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 }, 1);
    await sleep(35);
  }
  await sleep(150);
  await app.screenshot(path.join(work, "captures", "pointer_drag.png"), { x: b.left, y: b.top, width: b.width, height: b.height });
  await releaseAt(to);
  await sleep(400);
  const placed = (await board())[2 * 4 + 1];
  check(".wgba P8 대기석에서 칸으로 끌어 놓기 → 그 칸에 놓임", bk >= 0 && placed === line, JSON.stringify({ bk, line, placed }));

  // let go while paused / the settings window: released off the picture - the piece back
  const bp = at(b, 24 + 24 + 12, 30 + 2 * 16 + 8);
  await moveTo(bp);
  await sleep(50);
  await pressAt(bp);
  await sleep(200);
  const held = (await st())[2];
  await app.evaluate(`(${T}.player.setPaused(true), true)`);
  await sleep(100);
  const rel = await last();
  await releaseAt(bp);
  await app.evaluate(`(${T}.player.setPaused(false), true)`);
  await sleep(400);
  const after = (await st())[2];
  check(".wgba P9 누른 채 일시정지: 뗌(밖)을 넘기고, 게임은 끌던 것을 제자리로", held !== 0xffff && rel?.[0] === -1 && rel?.[2] === 0 && after === 0xffff && (await board())[2 * 4 + 1] === line, JSON.stringify({ held, rel, after }));
  await moveTo(bp);
  await sleep(50);
  await pressAt(bp);
  await sleep(150);
  await app.evaluate(`${T}.openSettings('general').then(() => true)`);
  await sleep(300);
  const rel2 = await last();
  await releaseAt(bp);
  await app.key("Escape", 60);
  await sleep(400);
  check(".wgba P10 누른 채 설정 창: 뗌(밖)을 넘김", rel2?.[0] === -1 && rel2?.[2] === 0 && (await st())[2] === 0xffff, JSON.stringify(rel2));
} catch (error) {
  check("오류 없이 끝남", false, String(error?.stack ?? error));
} finally {
  const left = app ?? (await connect(PORT, { timeoutMs: 3000 }).catch(() => null));
  if (left) {
    await Promise.race([left.evaluate("window.__TAURI__.core.invoke('window_close')").catch(() => {}), sleep(1500)]);
    left.close();
  }
  for (let i = 0; i < 20 && runningIn(work); i++) await sleep(250);
  fs.writeFileSync(path.join(work, "app_pointer_result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length}개 중 ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
