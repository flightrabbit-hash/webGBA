// UI/UX 검토 고침(결정 300) 측정 시험(로컬 전용): 알림 위치·게임 종료 확인 창·오버레이 최대·가로 도구 우선순위·태블릿 상한·
// 첫 화면·라이브러리·설정·관리자 숫자패드·모바일 키패드 줄을 화면 좌표와 잉크로 잰다(px 차이 0 규칙). 게임은 저장소 예제(hello-webapi·net-webapi)를
// 메모리에서 묶어 쓰고, 라이브러리 줄은 가짜 기록(롬 아님)으로 만든다.
//   PLAYWRIGHT_DIR=<playwright-core 폴더> node web/test/web-uiux.mjs <주소> <캡처 폴더> [--chrome <chrome.exe>]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, "noop.js") : import.meta.url);
const { chromium } = require("playwright-core");

const [URL_BASE, SHOTS, ...rest] = process.argv.slice(2);
const chromeAt = rest.indexOf("--chrome");
const CHROME = chromeAt >= 0 ? rest[chromeAt + 1] : "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  if (!pass) console.log(`실패 ${name}${detail ? ` — ${detail}` : ""}`);
};

const { packWgba } = await import("../../src-bundle/src/js/core/wgba-format.js");
async function example(name, patch = (m) => m) {
  const dir = fileURLToPath(new URL(`../../docs/wgba/examples/${name}/`, import.meta.url));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const res = await packWgba({ wasm: fs.readFileSync(path.join(dir, "game.wasm")), manifest: patch(manifest) });
  return Buffer.from(res.bytes);
}
const FILES = { "hello.wgba": await example("hello-webapi"), "net.wgba": await example("net-webapi") };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function open({ width, height, dpr = 2, touch = true, prefs = { lang: "ko" }, query = "" }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: touch, hasTouch: touch, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.addInitScript((prefs) => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    if (window !== window.top) return;
    localStorage.setItem("webgba.installHint", "1");
    if (!sessionStorage.getItem("uiux.seeded")) {
      localStorage.setItem("webgba.prefs", JSON.stringify(prefs));
      sessionStorage.setItem("uiux.seeded", "1");
    }
  }, prefs);
  await context.route("**/__uiux/*", (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop());
    return FILES[name] ? route.fulfill({ status: 200, body: FILES[name], contentType: "application/octet-stream" }) : route.fulfill({ status: 404 });
  });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(URL_BASE + query);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 30000 });
  return { context, page };
}

async function game(page, name = "hello.wgba") {
  await page.evaluate(async (name) => {
    const data = new Uint8Array(await (await fetch(`/__uiux/${encodeURIComponent(name)}`)).arrayBuffer());
    await window.webgba.openFiles([new File([data], name)]);
  }, name);
  await page.waitForFunction(() => window.webgba.player.running && !window.webgba.state.opening, null, { timeout: 30000 });
  await page.waitForTimeout(400);
}

async function seed(page, count = 4, extra = []) {
  await page.evaluate(
    async ({ count, extra }) => {
      const s = window.webgba.store;
      let t = Date.now();
      for (let i = 0; i < count; i++) {
        const name = `테스트 게임 ${i + 1}.gba`;
        await s.putRom({ id: `u${i}`, name, file: name, type: "gba" }, new Uint8Array(1024 + i));
        await s.patch(s.romKey(`u${i}`), { opened: (t -= 1000) });
      }
      for (const rec of extra) await s.putGame(rec, new Uint8Array(2048), { carts: [] });
    },
    { count, extra },
  );
}

const box = (page, sel) =>
  page.evaluate((sel) => {
    const n = typeof sel === "string" ? document.querySelector(sel) : null;
    if (!n || !n.getClientRects().length) return null;
    const r = n.getBoundingClientRect();
    const f = (v) => Math.round(v * 100) / 100;
    return { l: f(r.left), t: f(r.top), r: f(r.right), b: f(r.bottom), w: f(r.width), h: f(r.height), cx: f((r.left + r.right) / 2), cy: f((r.top + r.bottom) / 2) };
  }, sel);

const ink = (page, sel) =>
  page.evaluate((sel) => {
    const n = document.querySelector(sel);
    return n ? window.webgba.textInk(n) : null;
  }, sel);

const wait = (page, ms = 250) => page.waitForTimeout(ms);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) });
const sheet = async (page, name) => {
  await page.evaluate((n) => window.webgba.openSheet(n), name);
  await wait(page, 400);
};
const esc = async (page) => {
  await page.keyboard.press("Escape");
  await wait(page, 300);
};

// 1. 알림: 시트·확인 창이 열려 있으면 그 위(화면 하단 16px 가운데), 닫혀 있으면 게임 화면 하단 8px
for (const view of [{ width: 390, height: 844, dpr: 3 }, { width: 1366, height: 768, dpr: 1, touch: false }]) {
  const { context, page } = await open(view);
  const name = `${view.width}x${view.height}`;
  await page.evaluate(() => window.webgba.toast("알림 위치 확인", "warn", 8000));
  await wait(page);
  const t0 = await box(page, "#toast");
  const sc = await box(page, "#screen");
  ok(`${name} 알림(시트 없음) = 게임 화면 하단 8px·가운데`, t0 && Math.abs(sc.b - t0.b - 8) <= 0.5 && Math.abs(t0.l - sc.l - (sc.r - t0.r)) <= 1, JSON.stringify({ t0, sc }));
  for (const which of ["library", "settings"]) {
    await sheet(page, which);
    await page.evaluate(() => window.webgba.toast("알림 위치 확인", "warn", 8000));
    await wait(page);
    const t = await box(page, "#toast");
    const top = await page.evaluate(() => {
      const n = document.getElementById("toast");
      const r = n.getBoundingClientRect();
      n.style.pointerEvents = "auto";
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      n.style.pointerEvents = "";
      return hit === n || n.contains(hit);
    });
    ok(`${name} 알림이 ${which} 시트 위(가림 0)·하단 16px·좌우 여백 같음`, top && Math.abs(view.height - t.b - 16) <= 0.5 && Math.abs(t.l - (view.width - t.r)) <= 1, JSON.stringify(t));
    if (which === "library") await shot(page, `알림_시트위_${name}.png`);
    await esc(page);
  }
  await context.close();
}

// 2. 게임 종료 확인 창(메뉴·일시정지 막·라이브러리) + 빨강 통일·나가기 아이콘 + 터치 일시정지 버튼
{
  const { context, page } = await open({ width: 390, height: 844, dpr: 3 });
  await game(page);
  await page.click("#btnMenu");
  await wait(page, 400);
  const pause = await page.evaluate(() => {
    const b = document.getElementById("btnPause");
    return { shown: !b.hidden && b.getClientRects().length > 0, disabled: b.disabled, parent: b.parentElement.className };
  });
  ok("터치 메뉴에 일시정지(게임 중 활성)", pause.shown && !pause.disabled && /bar__group--files/.test(pause.parent), JSON.stringify(pause));
  const rowTools = await page.evaluate(() => [...document.querySelectorAll(".bar__group--files .tool")].filter((n) => n.getClientRects().length).map((n) => { const r = n.getBoundingClientRect(); return [r.top, r.bottom]; }));
  ok("메뉴 줄 도구 위·아래 차이 0", rowTools.every(([t, b]) => t === rowTools[0][0] && b === rowTools[0][1]), JSON.stringify(rowTools));
  await page.click("#btnQuit");
  await wait(page, 400);
  const dialog = await page.evaluate(() => ({ open: !document.getElementById("dialog").hidden, title: document.getElementById("dialogTitle").textContent, buttons: [...document.querySelectorAll("#dialogActions .btn")].map((b) => [b.textContent, b.className]) }));
  ok("메뉴 게임 종료 → 확인 창(취소·종료 = 위험 색)", dialog.open && dialog.title === "게임을 종료할까요?" && dialog.buttons.length === 2 && dialog.buttons[0][0] === "취소" && dialog.buttons[1][0] === "종료" && /btn--danger/.test(dialog.buttons[1][1]), JSON.stringify(dialog));
  await shot(page, "게임종료_확인창_390x844.png");
  await page.click("#dialogActions .btn:first-child");
  await wait(page, 400);
  ok("취소 → 게임 그대로", await page.evaluate(() => Boolean(window.webgba.state.game) && document.body.dataset.view === "game"));
  await page.evaluate(() => document.getElementById("btnPause").click());
  await wait(page, 300);
  const veil = await page.evaluate(() => ({ shown: !document.getElementById("pauseVeil").hidden, close: document.getElementById("veilClose").className, icon: document.querySelector("#veilClose .icon").dataset.icon }));
  ok("일시정지 버튼 → 일시정지 막, 막의 게임 종료 = 빨강(btn--danger)·나가기 아이콘", veil.shown && /btn--danger/.test(veil.close) && veil.icon === "exit", JSON.stringify(veil));
  await page.click("#veilClose");
  await wait(page, 400);
  ok("일시정지 막 게임 종료 → 확인 창", await page.evaluate(() => !document.getElementById("dialog").hidden));
  await esc(page);
  await page.click("#veilResume");
  await wait(page, 300);
  await sheet(page, "library");
  await wait(page, 300);
  const close = await page.evaluate(() => { const b = document.querySelector(".lib__card [data-action='close-game']"); return b ? { cls: b.className, icon: b.querySelector(".icon")?.dataset.icon } : null; });
  ok("라이브러리 게임 종료 = 빨강·나가기 아이콘", close && /btn--danger/.test(close.cls) && close.icon === "exit", JSON.stringify(close));
  await page.click(".lib__card [data-action='close-game']");
  await wait(page, 400);
  ok("라이브러리 게임 종료 → 확인 창", await page.evaluate(() => !document.getElementById("dialog").hidden && document.getElementById("dialogTitle").textContent === "게임을 종료할까요?"));
  await esc(page);
  await esc(page);
  // 퀵슬롯 제목 = 표시 이름(파일 이름 아님)
  const title = await page.evaluate(async () => {
    window.webgba.openSheet("quick");
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById("sheetTitle").textContent;
  });
  ok("퀵슬롯 제목 = 표시 이름", !/\.wgba/.test(title) && /안녕 wgba/.test(title), title);
  await esc(page);
  // 소리 끄기 단축키 M·조작법 줄
  const muted0 = await page.evaluate(() => Boolean(window.webgba.state.prefs.muted));
  await page.keyboard.press("KeyM");
  await wait(page, 150);
  const muted1 = await page.evaluate(() => Boolean(window.webgba.state.prefs.muted));
  await page.keyboard.press("KeyM");
  ok("M = 소리 끄기·켜기", muted0 !== muted1, `${muted0} → ${muted1}`);
  await sheet(page, "help");
  const help = await page.evaluate(() => [...document.querySelectorAll("#sheetBody dt")].map((d) => `${d.textContent}=${d.nextElementSibling?.textContent}`));
  ok("조작법: 좌측·우측 낱말·음소거 M 줄", help.some((r) => r.startsWith("좌측")) && help.some((r) => r.startsWith("우측")) && help.includes("소리 끄기·켜기=M"), JSON.stringify(help));
  await esc(page);
  await sheet(page, "rs");
  const rs = await page.evaluate(() => [...document.querySelectorAll("#sheetBody .rs-off")].map((n) => n.textContent));
  ok("RS 사용 안 함 = 다음 행동 안내 줄", rs.includes("1~5를 누르면 프리셋을 만듭니다."), JSON.stringify(rs));
  await esc(page);
  await context.close();
}

// 3. 가로: 오버레이 = 높이 전체·도구 44x50 좌우 칸 / 표시 = 소리 버튼이 메뉴 밖
{
  const ov = await open({ width: 844, height: 390, dpr: 3, prefs: { lang: "ko", pad: "overlay" } });
  await game(ov.page);
  const sc = await box(ov.page, "#screen");
  const tools = await ov.page.evaluate(() => [...document.querySelectorAll("#bar .tool")].filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden" && n.closest(".bar__group--files")?.dataset.open !== "closing").map((n) => { const r = n.getBoundingClientRect(); return { id: n.id, l: r.left, r: r.right, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 }; }));
  ok("가로 오버레이: 게임 화면 높이 = 화면 높이(390)", sc.h === 390 && sc.t === 0, JSON.stringify(sc));
  ok("가로 오버레이: 도구 44x50 · 게임 화면 밖 좌우 칸", tools.length >= 4 && tools.every((t) => t.w === 44 && t.h === 50 && (t.r <= sc.l || t.l >= sc.r)), JSON.stringify(tools));
  await shot(ov.page, "오버레이_844x390.png");
  await ov.context.close();
  const on = await open({ width: 844, height: 390, dpr: 3 });
  await game(on.page);
  const sound = await on.page.evaluate(() => { const b = document.getElementById("btnSound"); return { parent: b.parentElement.className, shown: getComputedStyle(b).visibility !== "hidden" && b.getClientRects().length > 0 }; });
  ok("가로 표시: 소리 버튼이 메뉴 밖에 보임(우선순위 설정 > 소리 > 멀티 > 재생 속도 > 전체 화면)", sound.shown && !/bar__group--files/.test(sound.parent), JSON.stringify(sound));
  await on.context.close();
}

// 4. 태블릿 세로: 짧은 변 700 이상 = 상한 1.25배
{
  const { context, page } = await open({ width: 820, height: 1180, dpr: 2 });
  await game(page);
  const dir = await box(page, "#pad [data-dpad]");
  const a = await box(page, '#pad [data-key="A"]');
  ok("태블릿 820x1180: 스틱 185 초과 231 이하 · A 커짐", dir.w > 185 && dir.w <= 231 && a.w > 80.5, JSON.stringify({ dir, a }));
  await context.close();
}

// 5. 첫 화면: 최근 줄 묶음 세로 가운데 · 게임 없으면 패드 끔 모양
{
  const { context, page } = await open({ width: 1366, height: 768, dpr: 1, touch: false });
  await seed(page, 3);
  await page.evaluate(() => window.webgba.refreshStart());
  await wait(page, 500);
  const sc = await box(page, "#screen");
  const head = await box(page, ".start__head");
  const all = await box(page, "#startAll");
  const pad = (v) => Math.round(v * 100) / 100;
  const top = pad(head.t - sc.t);
  const bottom = pad(sc.b - all.b);
  ok("첫 화면 최근 줄 묶음 세로 가운데(위·아래 여백 차이 ≤ 1)", Math.abs(top - bottom) <= 1, JSON.stringify({ top, bottom }));
  await context.close();
  const p = await open({ width: 390, height: 844, dpr: 3 });
  const dim = await p.page.evaluate(() => [...document.querySelectorAll("#pad .key, #pad .dpad")].filter((n) => n.getClientRects().length).map((n) => getComputedStyle(n).opacity));
  ok("게임 없음: 가상 버튼 끔 모양(opacity 0.4)", dim.length > 0 && dim.every((o) => o === "0.4"), JSON.stringify(dim));
  await game(p.page);
  const live = await p.page.evaluate(() => [...document.querySelectorAll("#pad .key, #pad .dpad")].filter((n) => n.getClientRects().length).map((n) => getComputedStyle(n).opacity));
  ok("게임 중: 가상 버튼 opacity 1", live.every((o) => o === "1"), JSON.stringify(live));
  await p.context.close();
}

// 6. 라이브러리: 빈 상태 안내 = 첫 선반 + 칸 우측 세로 가운데 · 0개면 크기 표기 없음 · 넓은 화면 시트 높이 = 내용
{
  const { context, page } = await open({ width: 1366, height: 768, dpr: 1, touch: false });
  await sheet(page, "library");
  await wait(page, 300);
  const add = await page.evaluate(() => {
    const n = document.querySelector(".spine--add");
    const r = n.getBoundingClientRect();
    const shelf = parseFloat(getComputedStyle(n).paddingBottom) || 14;
    return { l: r.left, r: r.right, top: r.bottom - 14 - 92, bottom: r.bottom - 14, shelf };
  });
  const hint = await ink(page, ".lib__emptyText");
  const hb = await box(page, ".lib__emptyText");
  const storage = await page.evaluate(() => document.querySelector(".lib__storage")?.textContent ?? "");
  const panel = await box(page, ".sheet__panel");
  const up = Math.round((hint.top - add.top) * 100) / 100;
  const down = Math.round((add.bottom - hint.bottom) * 100) / 100;
  ok("빈 라이브러리: 안내가 + 칸 우측", hb.l > add.r, JSON.stringify({ hb, add }));
  ok("빈 라이브러리: 안내 잉크가 + 칸 점선 상자 세로 가운데(차이 ≤ 1)", Math.abs(up - down) <= 1, JSON.stringify({ up, down }));
  ok("빈 라이브러리: 저장소 줄에 게임 파일 크기 없음", storage && !/게임 파일|webGBA/.test(storage), storage);
  ok("넓은 화면: 시트 높이 = 내용(빈 라이브러리 < 500)", panel.h < 500, JSON.stringify(panel));
  await shot(page, "빈라이브러리_1366x768.png");
  await context.close();
}

// 7. 라이브러리(그룹): 줄 끝 롬팩 앞면 누름 · 가로에서 + 칸이 안 보이면 머리 줄 추가 버튼 · 저장소 줄 이름 · .wmba 형식 글
{
  const wmba = { id: "mob", name: "rhythm.wmba", file: "rhythm.wmba", type: "wgba", gameId: "dev.example.mobile", version: "1.0.0", build: "c".repeat(64), title: "Mobile Test", shortName: "", author: "", romSha1: "", cart: { color: "#5a7d3a" } };
  for (const view of [{ width: 390, height: 844, dpr: 3 }, { width: 844, height: 390, dpr: 3 }]) {
    const name = `${view.width}x${view.height}`;
    const { context, page } = await open(view);
    await seed(page, 4, [wmba]);
    await sheet(page, "library");
    await wait(page, 500);
    const dead = await page.evaluate(() => {
      const list = [...document.querySelectorAll(".lib__case .spine:not(.spine--add)")];
      const out = [];
      list.forEach((s, i) => {
        const next = list[i + 1];
        if (next && next.offsetTop === s.offsetTop) return;
        const art = s.querySelector(".spine__iso").getBoundingClientRect();
        const y = art.top + art.height * 0.6;
        for (let x = Math.ceil(art.left) + 1; x < art.right - 1; x += 2) {
          const hit = document.elementFromPoint(x, y);
          if (hit && hit.closest(".lib__scroll") && hit.closest(".spine") !== s) out.push(Math.round(x));
        }
      });
      return out;
    });
    ok(`${name} 줄 끝 롬팩 그림 전체가 그 롬팩 버튼(눌리지 않는 곳 0)`, dead.length === 0, dead.slice(0, 12).join(","));
    const head = await page.evaluate(() => {
      const sc = document.querySelector(".lib__scroll");
      const add = document.querySelector(".spine--add");
      const btn = document.querySelector("[data-action='add-file-head']");
      return { addInView: add.offsetTop + add.offsetHeight <= sc.clientHeight, headShown: Boolean(btn && !btn.hidden) };
    });
    ok(`${name} + 칸이 안 보이면 머리 줄 추가 버튼(보이면 숨김)`, head.addInView !== head.headShown, JSON.stringify(head));
    const row = await page.evaluate(() => [...document.querySelectorAll(".lib__shelfHead > *")].filter((n) => n.getClientRects().length).map((n) => { const r = n.getBoundingClientRect(); return { c: n.className, top: r.top, bottom: r.bottom }; }));
    const btns = row.filter((r) => /btn/.test(r.c));
    ok(`${name} 머리 줄 버튼 위·아래 차이 0`, btns.every((b) => b.top === btns[0].top && b.bottom === btns[0].bottom), JSON.stringify(row));
    const storage = await page.evaluate(() => document.querySelector(".lib__storage")?.textContent ?? "");
    ok(`${name} 저장소 줄 = 게임 파일 크기`, /\(게임 파일 /.test(storage), storage);
    const choose = async (label) => {
      const picked = await page.evaluate((label) => {
        const spine = [...document.querySelectorAll(".lib__case .spine:not(.spine--add)")].find((s) => s.getAttribute("aria-label") === label);
        return spine && document.querySelector(".lib__card")?.dataset.key === spine.dataset.key;
      }, label);
      if (!picked) await page.click(`.lib__case .spine[aria-label="${label}"]`);
      await wait(page, 400);
    };
    if (view.width === 390) {
      await choose("Mobile Test");
      const meta = await page.evaluate(() => document.querySelector(".lib__card .lib__meta")?.textContent ?? "");
      ok("라이브러리 칸 .wmba 형식 글 = .wmba", /\.wmba/.test(meta) && !/\.wgba/.test(meta), meta);
      await page.click(".lib__card [data-action='delete']");
      await wait(page, 300);
      const text = await page.evaluate(() => document.getElementById("dialogBody").textContent);
      ok("지우기 확인 = 표시 이름(파일 이름 아님)", /^Mobile Test을\(를\) 이 브라우저/.test(text), text);
      await esc(page);
      await choose("테스트 게임 1");
      await page.click(".lib__card [data-action='delete']");
      await wait(page, 300);
      const text2 = await page.evaluate(() => document.getElementById("dialogBody").textContent);
      ok("지우기 확인 조사 = 받침에 맞춤(테스트 게임 1을)", text2.startsWith("테스트 게임 1을 이 브라우저"), text2);
      await esc(page);
    }
    await shot(page, `라이브러리_${name}.png`);
    await context.close();
  }
}

// 8. 설정: 우측 끝 한 값 · 진동 미지원 기기 = 진동 줄 없음 · 음소거 이름 · 정보 진단 줄은 개발 표시에서만
{
  const { context, page } = await open({ width: 390, height: 844, dpr: 3 });
  await page.click("#btnSettings");
  await wait(page, 400);
  const rights = await page.evaluate(() => [...document.querySelectorAll("#sheetBody .field")].filter((f) => f.getClientRects().length).map((f) => { const c = f.lastElementChild; return { label: f.querySelector(".field__label")?.textContent, right: Math.round(c.getBoundingClientRect().right * 100) / 100, range: c.type === "range" }; }));
  const ends = [...new Set(rights.filter((r) => !r.range).map((r) => r.right))];
  ok("설정 줄 조작 요소 우측 끝 한 값(차이 0)", ends.length === 1, JSON.stringify(rights));
  const labels = await page.evaluate(() => [...document.querySelectorAll("#sheetBody .field__label")].map((n) => n.textContent));
  ok("소리 스위치 이름 = 음소거", labels.includes("음소거") && !labels.includes("소리 끄기"), JSON.stringify(labels.filter((l) => /소리|음소거/.test(l))));
  await esc(page);
  await sheet(page, "info");
  const audio = await page.evaluate(() => [...document.querySelectorAll("#sheetBody .info__line")].some((n) => /^소리:/.test(n.textContent)));
  ok("정보 화면: 소리 진단 줄 없음(일반)", !audio);
  await context.close();
  const dev = await open({ width: 390, height: 844, dpr: 3, query: "?dev=1" });
  await sheet(dev.page, "info");
  const audioDev = await dev.page.evaluate(() => [...document.querySelectorAll("#sheetBody .info__line")].some((n) => /^소리:/.test(n.textContent)));
  ok("정보 화면: 소리 진단 줄(?dev=1)", audioDev);
  await dev.context.close();
  const pc = await open({ width: 1920, height: 1080, dpr: 1, touch: false });
  const haptic = await pc.page.evaluate(() => "vibrate" in navigator);
  await pc.page.click("#btnSettings");
  await wait(pc.page, 400);
  const vib = await pc.page.evaluate(() => [...document.querySelectorAll("#sheetBody .field__label")].map((n) => n.textContent).filter((t) => /진동/.test(t)));
  ok(`진동 미지원 기기(PC): 진동 줄 숨김 (vibrate API ${haptic ? "있음" : "없음"})`, vib.length === 0 || haptic, JSON.stringify(vib));
  await pc.context.close();
}

// 9. 관리자 숫자패드: 낮은 가로(844x390) = 2열, 키 12개 모두 누를 수 있음·취소·확인과 겹침 0
{
  const { context, page } = await open({ width: 844, height: 390, dpr: 3 });
  await page.click("#btnSettings");
  await wait(page, 400);
  const btn = await page.$("#sheetBody [data-action*='admin']");
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await wait(page, 500);
  const pad = await page.evaluate(() => {
    const r = (n) => { const b = n.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const keys = [...document.querySelectorAll(".apad__keys .apad__key")].map((k) => ({ key: k.dataset.key, ...r(k) }));
    const acts = [...document.querySelectorAll("#dialogActions .btn")].map(r);
    const card = r(document.querySelector(".dialog__card"));
    const blocked = keys.filter((k) => { const el = document.elementFromPoint((k.l + k.r) / 2, (k.t + k.b) / 2); return !el?.closest?.(".apad__key"); }).map((k) => k.key);
    const overlap = keys.filter((k) => acts.some((a) => k.l < a.r && a.l < k.r && k.t < a.b && a.t < k.b)).map((k) => k.key);
    return { keys: keys.length, blocked, overlap, card, vh: innerHeight };
  });
  ok("관리자 숫자패드 844x390: 키 12개 모두 누름·취소·확인과 겹침 0·카드 화면 안", pad.keys === 12 && !pad.blocked.length && !pad.overlap.length && pad.card.t >= 0 && pad.card.b <= pad.vh, JSON.stringify(pad));
  await shot(page, "관리자패드_844x390.png");
  await context.close();
}

// 10. 멀티플레이 참가: 코드 6자리 전에는 들어가기 끔
{
  const { context, page } = await open({ width: 390, height: 844, dpr: 3, prefs: { lang: "ko", netOn: true } });
  await game(page, "net.wgba");
  await page.evaluate(() => {
    window.webgba.player.keyDown("KeyZ");
    setTimeout(() => window.webgba.player.keyUp("KeyZ"), 120);
  });
  await page.waitForFunction(() => window.webgba.state.sheet === "net", null, { timeout: 8000 });
  await wait(page, 600);
  const go0 = await page.evaluate(() => document.querySelector("[data-action='net-code-go']")?.disabled ?? null);
  const input = await page.$("[data-action='net-code-in']");
  if (input) await input.type("123456");
  await wait(page, 200);
  const go6 = await page.evaluate(() => document.querySelector("[data-action='net-code-go']")?.disabled ?? null);
  ok("참가 코드 빈 상태 = 들어가기 끔 · 6자리 = 켬", go0 === true && go6 === false, JSON.stringify({ go0, go6 }));
  await context.close();
}

// 11. 모바일 키패드: CLR 1/3 · OK 2/3 같은 줄(위·아래 차이 0) · 좌측 하단 칸 비움 · PC 키 상한
{
  const mobile = { preset: "none", buttons: ["up", "down", "left", "right", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9", "star", "num0", "hash", "ok", "clear"].map((role, bit) => ({ id: role, role, bit })) };
  for (const view of [{ width: 390, height: 844, dpr: 3 }, { width: 844, height: 390, dpr: 3 }, { width: 1366, height: 768, dpr: 1, touch: false }]) {
    const name = `${view.width}x${view.height}`;
    const { context, page } = await open(view);
    await game(page);
    await page.evaluate((input) => window.webgba.setInput(input), mobile);
    await wait(page, 400);
    const k = await page.evaluate(() => {
      const r = (sel) => { const n = document.querySelector(sel); if (!n || !n.getClientRects().length) return null; const b = n.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      return { clr: r('#pad [data-key="CLEAR"]'), ok: r('#pad [data-key="OK"]'), n7: r('#pad [data-key="STAR"]'), n9: r('#pad [data-key="HASH"]'), n1: r('#pad [data-key="N1"]'), dir: r("#pad [data-dpad]") };
    });
    const same = k.clr && k.ok && k.clr.t === k.ok.t && k.clr.b === k.ok.b;
    ok(`${name} 키패드 아래 [CLR · OK] 같은 줄 위·아래 차이 0`, same, JSON.stringify({ clr: k.clr, ok: k.ok }));
    ok(`${name} CLR = 첫째 열 · OK = 둘째~셋째 열`, same && Math.abs(k.clr.l - k.n7.l) <= 1 && Math.abs(k.ok.r - k.n9.r) <= 1 && k.clr.t > k.n7.b, JSON.stringify(k));
    if (view.width === 390) ok("390x844 숫자 키 49 초과 · 스틱 185 미만", k.n1.w > 49 && k.dir.w < 185, JSON.stringify({ n1: k.n1, dir: k.dir }));
    if (view.width === 1366) ok("PC 숫자 키 폭 63 이하", k.n1.w <= 63, JSON.stringify(k.n1));
    await shot(page, `모바일키패드_${name}.png`);
    await context.close();
  }
}

// 12. 문구: 조사 붙여 쓰기
{
  const ko = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../src/i18n/ko.json", import.meta.url)), "utf8"));
  const bad = [];
  for (const [key, value] of Object.entries(ko)) for (const word of ["webGBA 를", "webGBA 는", "webGBA 가", "Safari 로", "Chrome 으로", "Edge 로", "Dock 의", ".sav 는", ".sav 가", "BIOS 는", "} 을(를)", "} 이(가)", "} 은(는)", "} 의 ", "} 에 ", ".wgba 의", ".wgba 입니다"]) if (String(value).includes(word)) bad.push(`${key}: ${word}`);
  ok("ko 문구 조사 띄어쓰기 0", bad.length === 0, bad.join(" / "));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(SHOTS, "uiux.json"), JSON.stringify(results, null, 1));
console.log(`결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
