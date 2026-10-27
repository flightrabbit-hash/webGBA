// 실제 webGBA 앱을 띄워 시험한다(시험 C1~C5, W1·W2, D2). 결과와 캡처는 <작업 폴더>/captures.
//   node tools/test/app-smoke.mjs <exe> <작업 폴더> <시험 이름...>
// 시험 이름: gba  (test.gba 사본 → 타이틀·키·상태·세이브)   portwasm  (wasm_only\<빌드>.wasm 만 → 타이틀·세이브)
//            other  (다른 emscripten 빌드 — 페이지 없음/있음, IDBFS 저장)   explorer  (같은 폴더 이전·다음)
// <빌드> 는 환경 변수 WEBGBA_TEST_BUILD(cdp.mjs). 그 빌드의 롬은 작업 폴더에 하나만 둔다(같은 폴더에 롬이 없으면 위 폴더의 하나뿐인 .gba).
import fs from "fs";
import path from "path";
import { attach, connect, guardOthers, launch, prepareApp, sleep, TEST_BUILD } from "./cdp.mjs";

const [exe, work, ...names] = process.argv.slice(2);
if (!exe || !work || !names.length) {
  console.error("사용법: node tools/test/app-smoke.mjs <exe> <작업 폴더> <gba|portwasm|other|explorer ...>");
  process.exit(2);
}

const PORT = 9333;
const appDir = path.join(work, "app");
const captures = path.join(work, "captures");
fs.mkdirSync(captures, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

guardOthers(exe, work);
const appExe = prepareApp(exe, appDir);
launch(appExe, PORT);
const app = await attach(PORT);

const stageClip = async () => app.evaluate("(() => { const b = document.getElementById('screen').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()");
const statusText = () => app.evaluate("document.getElementById('status').textContent");
const frames = () => app.evaluate("window.__WEBGBA_TEST__.player.host ? window.__WEBGBA_TEST__.player.host.ex.Web_GetFrameCount?.() ?? -1 : -1");
const open = (file, options = {}) => app.evaluate(`window.__WEBGBA_TEST__.openPath(${JSON.stringify(file)}, ${JSON.stringify(options)})`);
const screenHash = () =>
  app.evaluate("(() => { const c = document.getElementById('screen'); const d = c.getContext('2d').getImageData(0,0,240,160).data; let h = 2166136261; for (let i = 0; i < d.length; i += 4) { h ^= d[i] | (d[i+1] << 8) | (d[i+2] << 16); h = Math.imul(h, 16777619); } const colors = new Set(); for (let i = 0; i < d.length; i += 148) colors.add(d[i] << 16 | d[i+1] << 8 | d[i+2]); return { hash: h >>> 0, colors: colors.size }; })()");

try {
  if (names.includes("gba")) {
    const rom = path.join(work, "rom", "test.gba");
    const saveSrc = path.join(work, "rom", "townmap.sav");
    const binSave = path.join(appDir, "bin", "save", "test.sav");
    fs.mkdirSync(path.dirname(binSave), { recursive: true });
    fs.copyFileSync(saveSrc, binSave);
    const before = fs.statSync(binSave).mtimeMs;

    check("C1 열기", await open(rom), await statusText());
    await sleep(21000);
    const title = await screenHash();
    check("C1 타이틀까지", title.colors > 8, `프레임 ${await frames()} · 색 ${title.colors}`);
    await app.screenshot(path.join(captures, "app_gba_title.png"), await stageClip());

    for (let i = 0; i < 3; i++) {
      await app.key("Enter");
      await sleep(2500);
    }
    const menu = await screenHash();
    check("C2 키 입력(START → 메뉴)", menu.hash !== title.hash, `색 ${menu.colors}`);
    await app.screenshot(path.join(captures, "app_gba_menu.png"), await stageClip());

    const audio = await app.evaluate("(() => { const a = window.__WEBGBA_TEST__.player.audio; return a ? { state: a.ac.state, rate: a.ac.sampleRate } : null; })()");
    check("C3 소리 장치", audio?.state === "running", JSON.stringify(audio));

    const hostHash =
      "(() => { const h0 = window.__WEBGBA_TEST__.player.host; h0.runFrame(0); const d = h0.framebuffer(); let h = 2166136261; for (let i = 0; i < d.length; i += 4) { h ^= d[i] | (d[i+1] << 8) | (d[i+2] << 16); h = Math.imul(h, 16777619); } return h >>> 0; })()";
    await app.evaluate("window.__WEBGBA_TEST__.player.setPaused(true)");
    const saved = await app.evaluate("window.__WEBGBA_TEST__.saveStateTo(3).then(() => document.getElementById('status').textContent)");
    const snap = await app.evaluate(hostHash);
    await app.evaluate("window.__WEBGBA_TEST__.player.setPaused(false)");
    await app.key("ArrowDown");
    await app.key("KeyX");
    await sleep(1500);
    await app.evaluate("window.__WEBGBA_TEST__.player.setPaused(true)");
    await app.evaluate("window.__WEBGBA_TEST__.loadStateFrom(3)");
    const back = await app.evaluate(hostHash);
    await app.evaluate("window.__WEBGBA_TEST__.player.setPaused(false)");
    const stateFile = path.join(appDir, "bin", "state", "test.ss3");
    check("C5 상태 저장·불러오기", fs.existsSync(stateFile) && back === snap, `${saved} · 파일 ${fs.existsSync(stateFile) ? fs.statSync(stateFile).size : 0}바이트 · 화면 ${back === snap ? "같음" : "다름"}`);

    await app.evaluate("(async () => { const p = window.__WEBGBA_TEST__.player; p.savePending = true; await p.flushSave(); })()");
    const after = fs.statSync(binSave);
    check("C4 세이브 파일 쓰기", after.mtimeMs > before && after.size === 131072 && fs.existsSync(`${binSave}.bak`), `${after.size}바이트 · .bak ${fs.existsSync(`${binSave}.bak`)}`);
    await app.evaluate("window.__WEBGBA_TEST__.closeGame()");
  }

  if (names.includes("gbasave")) {
    const rom = path.join(work, "rom", "test.gba");
    const binSave = path.join(appDir, "bin", "save", "test.sav");
    fs.mkdirSync(path.dirname(binSave), { recursive: true });
    fs.copyFileSync(path.join(work, "rom", "townmap.sav"), binSave);
    const before = fs.readFileSync(binSave);
    await open(rom);
    await sleep(21000);
    for (let i = 0; i < 3; i++) {
      await app.key("Enter");
      await sleep(2500);
    }
    await sleep(3000);
    await app.key("KeyX", 300);
    await sleep(6000);
    await app.screenshot(path.join(captures, "app_gbasave_1_field.png"), await stageClip());
    await app.key("Enter", 250);
    await sleep(2000);
    await app.screenshot(path.join(captures, "app_gbasave_2_menu.png"), await stageClip());
    const steps = (process.env.WEBGBA_SAVE_KEYS ?? "ArrowDown,ArrowRight").split(",").filter(Boolean);
    for (const code of steps) {
      await app.key(code, 250);
      await sleep(600);
    }
    await app.screenshot(path.join(captures, "app_gbasave_3_cursor.png"), await stageClip());
    for (let i = 0; i < 4; i++) {
      await app.key("KeyX", 250);
      await sleep(2500);
    }
    await sleep(4000);
    await app.screenshot(path.join(captures, "app_gbasave_4_after.png"), await stageClip());
    const after = fs.readFileSync(binSave);
    check("C4 게임 안 저장 → 세이브 파일", !after.equals(before) && after.length === 131072, `${after.length}바이트 · ${(await statusText())}`);
    await app.evaluate("window.__WEBGBA_TEST__.closeGame()");
  }

  if (names.includes("portwasm")) {
    const wasm = path.join(work, "wasm_only", `${TEST_BUILD}.wasm`);
    check("W1 열기(.wasm 만, .js 없음)", await open(wasm), await statusText());
    await sleep(26000);
    const title = await screenHash();
    check("W1 타이틀까지", title.colors > 8, `색 ${title.colors}`);
    await app.screenshot(path.join(captures, "app_portwasm_title.png"), await stageClip());
    const saveId = await app.evaluate("window.__WEBGBA_TEST__.state.game.saveId");
    const wrote = await app.evaluate("window.__WEBGBA_TEST__.player.host.ex.Web_DebugSave()");
    await sleep(1500);
    const savePath = path.join(appDir, "bin", "web", saveId.slice(4), "save.sav");
    check("W1 세이브 쓰기", fs.existsSync(savePath) && fs.statSync(savePath).size === 131072, `결과 ${wrote} · ${savePath}`);
    await app.evaluate("window.__WEBGBA_TEST__.closeGame()");
    const reopened = await open(wasm);
    const reopenStatus = await statusText();
    check("W1 다시 열면 세이브를 불러옴", reopened && /세이브를 불러왔습니다/.test(reopenStatus), reopenStatus);
    await sleep(26000);
    for (let i = 0; i < 3; i++) {
      await app.key("Enter", 250);
      await sleep(2500);
    }
    await app.screenshot(path.join(captures, "app_portwasm_continue.png"), await stageClip());
    await app.evaluate("window.__WEBGBA_TEST__.closeGame()");
  }

  if (names.includes("other")) {
    const em = path.join(work, "emtest", "out");
    await app.evaluate("window.__EMLOG__ = []; window.addEventListener('message', (e) => { if (e.data?.type === 'emtest') window.__EMLOG__.push(e.data); }); true");
    const lastOf = (name) => app.evaluate(`(window.__EMLOG__.filter((m) => m.name === ${JSON.stringify(name)}).at(-1) ?? null)`);
    const waitFor = async (name, test, ms = 15000) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        const last = await lastOf(name);
        if (last && test(last)) return last;
        await sleep(300);
      }
      return lastOf(name);
    };

    check("W3 페이지 있는 빌드 열기", await open(path.join(em, "page", "emtest.wasm")), await statusText());
    const page = await waitFor("page", () => true);
    check("W3 원래 페이지 실행", Boolean(page), JSON.stringify(page));
    await sleep(800);
    await app.key("KeyQ", 150);
    const direct = await waitFor("page", (m) => m.lastKey === "KeyQ", 5000);
    check("W3 키 입력(iframe 에 초점)", direct?.lastKey === "KeyQ", direct?.lastKey);
    await app.evaluate("document.getElementById('stage').focus(); document.activeElement === document.getElementById('webframe') ? 'frame' : document.activeElement?.id");
    await app.evaluate("window.focus(); document.body.focus(); true");
    await app.key("KeyW", 150);
    const forwarded = await waitFor("page", (m) => m.lastKey === "KeyW", 5000);
    check("W3 키 입력(본 창에서 넘김)", forwarded?.lastKey === "KeyW", forwarded?.lastKey);
    await app.screenshot(path.join(captures, "app_other_page.png"));

    check("W2 페이지 없는 빌드(MODULARIZE) 열기", await open(path.join(em, "glue", "emglue.wasm")), await statusText());
    const glue = await waitFor("glue", () => true);
    check("W2 글루로 실행", Boolean(glue), JSON.stringify(glue));
    check("W4 저장 공간 분리", glue && glue.other !== "page" && glue.origin !== page?.origin, `glue 가 본 값=${glue?.other} · 출처 ${glue?.origin} / ${page?.origin}`);
    await app.screenshot(path.join(captures, "app_other_glue.png"));

    check("W2 페이지 없는 빌드(보통 글루) 열기", await open(path.join(em, "classic", "emclassic.wasm")), await statusText());
    const classic = await waitFor("classic", () => true);
    check("W2 보통 글루 실행", Boolean(classic), JSON.stringify(classic));
    fs.writeFileSync(path.join(work, "other_counts.json"), JSON.stringify({ page: page?.count, glue: glue?.count, classic: classic?.count }));
    await app.evaluate("window.__WEBGBA_TEST__.closeGame()");
  }

  if (names.includes("portpage")) {
    const wasm = path.join(work, "웹버전", `${TEST_BUILD}.wasm`);
    check("W5 포트 웹버전(페이지 있음)은 내장 호스트가 먼저", await open(wasm), await statusText());
    await sleep(3000);
    await app.evaluate("window.__WEBGBA_TEST__.player.host.ex.Web_DebugSave()");
    await sleep(1500);
    await app.evaluate("window.__WEBGBA_TEST__.closeGame()");
    check("W5 포트 웹버전을 원래 페이지로 열기", await open(wasm, { preferPage: true }), await statusText());
    await sleep(4000);
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const frameTarget = list.find((item) => item.url.includes("game."));
    let inner = null;
    if (frameTarget) {
      inner = await connect(PORT, { match: "game." });
    }
    check("W5 페이지 대상 찾기(CDP)", Boolean(inner), list.map((item) => `${item.type} ${item.url}`).join(" | "));
    if (inner) {
      const overlay = await inner.evaluate("document.getElementById('overlayText')?.textContent ?? ''");
      const pageStatus = await inner.evaluate("document.getElementById('status')?.textContent ?? ''");
      check("W5 /rom 호환으로 롬을 받아 준비됨", /준비되었습니다/.test(overlay), `${overlay} · ${pageStatus}`);
      await inner.evaluate("document.getElementById('startBtn')?.click(); true");
      await sleep(26000);
      await app.screenshot(path.join(captures, "app_portpage_title.png"));
      const put = await inner.evaluate("fetch('save').then(async (r) => ({ get: r.status, size: (await r.arrayBuffer()).byteLength }))");
      check("W5 /save 호환(내장 호스트와 같은 세이브)", put.get === 200 && put.size === 131072, JSON.stringify(put));
      inner.close();
    }
    await app.evaluate("window.__WEBGBA_TEST__.closeGame()");
  }

  if (names.includes("drop")) {
    const { spawnSync } = await import("child_process");
    const rom = path.join(work, "rom", "test.gba");
    await app.evaluate("window.__WEBGBA_TEST__.closeGame()");
    await app.evaluate("window.__DRAGLOG__ = []; window.addEventListener('webgba:os-drag', (e) => window.__DRAGLOG__.push(e.detail.phase)); window.addEventListener('webgba:os-drop', (e) => window.__DRAGLOG__.push('drop:' + e.detail.paths.join('|'))); true");
    const script = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "drag-drop.ps1");
    const done = spawnSync("powershell", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", script, "-File", rom], { encoding: "utf8", timeout: 40000 });
    const said = `${done.stdout ?? ""}${done.stderr ?? ""}`.trim();
    console.log(`  끌기 도구: ${said}`);
    await sleep(2500);
    const log = await app.evaluate("window.__DRAGLOG__");
    const current = await app.evaluate("window.__WEBGBA_TEST__.state.game?.path ?? ''");
    check("D1 일반 권한(Medium)으로 실행", /Medium/.test(said), said.split(" · ")[0]);
    check("D1 끌어 놓기로 열림(일반 권한 끌기 원본)", current.endsWith("test.gba"), `이벤트 ${log.filter((x) => x !== "over").join(", ")} · over ${log.filter((x) => x === "over").length}회`);
    await app.screenshot(path.join(captures, "app_drop.png"));
    await app.evaluate("window.__WEBGBA_TEST__.closeGame()");
  }

  if (names.includes("ui")) {
    await app.evaluate("window.__WEBGBA_TEST__.closeGame()");
    await sleep(500);
    await app.screenshot(path.join(captures, "ui_start.png"));
    await app.evaluate("document.querySelector('.menubar__item[data-menu=\"game\"]').click(); true");
    await sleep(300);
    await app.screenshot(path.join(captures, "ui_menu_game.png"));
    await app.evaluate("document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); true");
    await app.evaluate("document.getElementById('btn-keys').click(); true");
    await sleep(300);
    await app.screenshot(path.join(captures, "ui_keys.png"));
    const icons = await app.evaluate("[...document.querySelectorAll('.titlebar .icon')].filter((e) => getComputedStyle(e).maskImage.includes('/icons/')).length");
    check("화면: 제목 표시줄 아이콘 주소", icons >= 10, `${icons}개`);
    await app.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
  }

  if (names.includes("persist")) {
    const em = path.join(work, "emtest", "out");
    const before = JSON.parse(fs.readFileSync(path.join(work, "other_counts.json"), "utf8"));
    await app.evaluate("window.__EMLOG__ = []; window.addEventListener('message', (e) => { if (e.data?.type === 'emtest') window.__EMLOG__.push(e.data); }); true");
    await open(path.join(em, "glue", "emglue.wasm"));
    let glue = null;
    for (let i = 0; i < 50 && !glue; i++) {
      glue = await app.evaluate("window.__EMLOG__.find((m) => m.name === 'glue') ?? null");
      if (!glue) await sleep(300);
    }
    check("W2 앱을 다시 켜도 IDBFS 저장이 남음", glue?.count === before.glue + 1, `전 ${before.glue} → 지금 ${glue?.count}`);
    await app.evaluate("window.__WEBGBA_TEST__.closeGame()");
  }

} catch (error) {
  check("오류 없이 끝남", false, String(error?.stack ?? error));
} finally {
  await Promise.race([app.evaluate("window.__TAURI__.core.invoke('window_close')").catch(() => {}), sleep(1500)]);
  app.close();
  fs.writeFileSync(path.join(work, "app_smoke_result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length}개 중 ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
