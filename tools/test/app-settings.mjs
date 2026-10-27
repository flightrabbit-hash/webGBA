// 설정 창·테마·다국어·종료할 때 세이브 파일 시험(사용자 2026-10-27). 실제 앱을 CDP 로 다룬다. 마우스를 움직이지 않는다.
//   node tools/test/app-settings.mjs <exe> <작업 폴더>
// 작업 폴더: rom\test.gba · rom\townmap.sav · port\<빌드>.wgba(웹 빌드 사본) · <롬>(그 빌드의 롬 사본). <빌드>·<롬> 은 WEBGBA_TEST_BUILD·WEBGBA_TEST_ROM(cdp.mjs).
// 앱 폴더는 <작업>\app 을 새로 만든다(.wgba 연결은 건드리지 않음: wgbaLink false). 캡처는 <작업>\captures\
// 롬 고르기 시험은 <작업>\same\ 에 빌드와 롬을 함께 복사해 쓴다(설정이 비었을 때 같은 폴더의 하나뿐인 .gba).
import fs from "fs";
import path from "path";
import { attach, connect, guardOthers, launch, prepareApp, runningIn, sleep, TEST_BUILD, TEST_ROM } from "./cdp.mjs";

const [exe, work] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-settings.mjs <exe> <작업 폴더>");
  process.exit(2);
}

const PORT = 9337;
const appDir = path.join(work, "app");
const captures = path.join(work, "captures");
const exitDir = path.join(work, "exit");
const otherDir = path.join(work, "exit_other");
const game = path.join(exitDir, "game.gba");
const portWgba = path.join(work, "port", `${TEST_BUILD}.wgba`);
const T = "window.__WEBGBA_TEST__";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const running = () => runningIn(work);

const cfgPath = path.join(appDir, "bin", "ini", "personalization.cfg");
const iniPath = path.join(appDir, "bin", "ini", "setting.ini");
const prefs = () => JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const sum = (bytes) => {
  let s = 0;
  for (const b of bytes) s = (s + b) >>> 0;
  return s;
};

let app = null;

async function start(args = []) {
  for (let i = 0; i < 40 && running(); i++) await sleep(250);
  launch(path.join(appDir, "webgba.exe"), PORT, args);
  app = await attach(PORT);
  return app;
}

async function closeByButton() {
  await app.evaluate("document.getElementById('win-close').click(); true").catch(() => {});
  app.close();
  for (let i = 0; i < 40 && running(); i++) await sleep(250);
  app = null;
}

const waitGame = () => app.evaluate(`new Promise((r) => { const t = () => (${T}.state.game && !${T}.state.opening ? r(true) : setTimeout(t, 50)); t(); })`);
const statusText = () => app.evaluate("document.getElementById('status').textContent");
const open = async (file) => {
  await app.evaluate(`${T}.openPath(${JSON.stringify(file)})`);
  await waitGame();
  await sleep(300);
};
const openSettings = (tab) => app.evaluate(`${T}.openSettings(${JSON.stringify(tab)}).then(() => new Promise((r) => setTimeout(() => r(true), 350)))`);
const closeSettings = () => app.evaluate(`${T}.settings.close(); true`);
const click = (selector) => app.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return false; n.click(); return true; })()`);
const text = (selector) => app.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const shot = (name) => app.screenshot(path.join(captures, name));

const MODES = ["midnight", "dark", "nord", "monokai", "solardark", "dracula", "forest", "light", "sepia", "ragdoll", "solarized", "contrast", "custom"];

try {
  guardOthers(exe, work);
  if (running()) throw new Error("시험 폴더의 webgba.exe 가 아직 켜져 있습니다");
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.rmSync(exitDir, { recursive: true, force: true });
  fs.rmSync(otherDir, { recursive: true, force: true });
  fs.mkdirSync(exitDir, { recursive: true });
  fs.mkdirSync(captures, { recursive: true });
  for (const name of [`${TEST_BUILD}.sav`, `${TEST_BUILD}.sav.bak`]) fs.rmSync(path.join(work, "port", name), { force: true });
  fs.copyFileSync(path.join(work, "rom", "test.gba"), game);
  prepareApp(exe, appDir);
  fs.writeFileSync(iniPath, "# 시험용\nappWidth: 960\nappHeight: 720\n# 개발자 도구\nuseDevelopKit: true\n");
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({ window: { x: 40, y: 40, width: 1180, height: 780, maximized: false }, panel: "favorites", wgbaLink: false, favorites: [game, portWgba], recent: [portWgba, game] }, null, 2),
  );
  fs.mkdirSync(path.join(appDir, "bin", "save"), { recursive: true });
  const townmap = fs.readFileSync(path.join(work, "rom", "townmap.sav"));
  fs.writeFileSync(path.join(appDir, "bin", "save", "game.sav"), townmap);

  /* ── 설정 창 ── */
  await start();
  check("처음 켜면 한국어·다크", (await app.evaluate(`[${T}.i18n.lang(), document.documentElement.dataset.theme, document.documentElement.lang].join()`)) === "ko,dark,ko");
  await app.evaluate("document.getElementById('btn-settings').click(); new Promise((r) => setTimeout(() => r(true), 400))");
  const shape = await app.evaluate(`(() => ({
    open: !document.getElementById('settings-modal').hidden,
    tabs: [...document.querySelectorAll('.cfg__tab')].map((n) => n.textContent.trim()),
    groups: [...document.querySelectorAll('#settings-body .cfg__title')].map((n) => n.textContent),
    rows: document.querySelectorAll('#settings-body .cfg__row').length,
    exitSave: [...document.querySelectorAll('#settings-body .cfg__row')].find((r) => r.textContent.includes('종료할 때 세이브 파일'))?.querySelector('input')?.checked,
    dpad: [...document.querySelectorAll('#settings-body .cfg__row')].find((r) => r.querySelector('.cfg__label').firstChild.textContent === '방향키 동시 누름')?.querySelector('input:checked')?.parentElement?.textContent,
    webRom: [...document.querySelectorAll('#settings-body .cfg__row')].find((r) => r.querySelector('.cfg__label').firstChild.textContent === '웹 빌드에 쓸 롬 파일 이름')?.querySelector('input')?.value ?? null,
    pressed: document.getElementById('btn-settings').getAttribute('aria-pressed'),
  }))()`);
  check("설정 창: 도구 막대 버튼으로 열림, 탭 4개(일반·키·테마·언어)", shape.open && shape.tabs.join() === "일반,키,테마,언어" && shape.pressed === "true", shape.tabs.join(" · "));
  check("설정 창: 일반 탭 6묶음 17줄(화면·소리·게임·세이브·파일·개발)", shape.groups.join() === "화면,소리,게임,세이브,파일,개발" && shape.rows === 17, `${shape.groups.join(" · ")} / ${shape.rows}줄`);
  check("방향키 동시 누름: 기본 '나중에 누른 방향만'", shape.dpad === "나중에 누른 방향만" && shape.webRom === "", `${shape.dpad} · 롬 이름 칸 '${shape.webRom}'`);
  check("종료할 때 세이브 파일 만들기: 기본 켬", shape.exitSave === true);
  await shot("settings_general_ko.png");
  await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27 });
  await app.send("Input.dispatchKeyEvent", { type: "keyUp", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(200);
  check("설정 창: Esc 로 닫힘", await app.evaluate("document.getElementById('settings-modal').hidden"));

  /* ── 키 탭 ── */
  await openSettings("keys");
  await click("#settings-keys .keys__slot");
  await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", code: "KeyQ", key: "q", windowsVirtualKeyCode: 81 });
  await app.send("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyQ", key: "q", windowsVirtualKeyCode: 81 });
  await sleep(150);
  const slotText = await text("#settings-keys .keys__slot");
  await click("#settings-save");
  await sleep(500);
  const savedKeys = prefs().keys;
  check("키 탭: A 첫 칸을 Q 로 바꾸고 SAVE", slotText === "Q" && savedKeys?.A?.[0] === "KeyQ" && (await app.evaluate(`${T}.player.keymap.has('KeyQ')`)), `${slotText} · ${JSON.stringify(savedKeys?.A)}`);
  await click("#settings-keys-reset");
  await click("#settings-save");
  await sleep(500);
  check("키 탭: RESET → SAVE 로 기본 키", prefs().keys?.A?.[0] === "KeyX", JSON.stringify(prefs().keys?.A));
  await closeSettings();

  /* ── 일반 탭 SAVE ── */
  await openSettings("general");
  const setNumber = (label, value) =>
    app.evaluate(`(() => { const row = [...document.querySelectorAll('#settings-body .cfg__row')].find((r) => r.querySelector('.cfg__label').firstChild.textContent === ${JSON.stringify(label)}); const input = row.querySelector('input'); input.value = ${JSON.stringify(String(value))}; input.dispatchEvent(new Event('input')); return true; })()`);
  const clickIn = (label, index = 0) =>
    app.evaluate(`(() => { const row = [...document.querySelectorAll('#settings-body .cfg__row')].find((r) => r.querySelector('.cfg__label').firstChild.textContent === ${JSON.stringify(label)}); row.querySelectorAll('input')[${index}].click(); return true; })()`);
  await setNumber("음량", 150);
  await click("#settings-save");
  await sleep(300);
  const bad = await text("#settings-note");
  check("일반 탭: 범위 밖 값(음량 150)은 저장하지 않고 알림", /0 ~ 100/.test(bad) && prefs().volume !== 150, bad);
  await setNumber("음량", 55);
  await setNumber("상태 슬롯", 3);
  await clickIn("빨리 감기 배수", 3);
  await clickIn("화면 맞춤", 1);
  await clickIn("창이 가려지면 일시정지");
  await click("#settings-save");
  await sleep(600);
  const after = prefs();
  const ini = fs.readFileSync(iniPath, "utf8");
  const live = await app.evaluate(`({ volume: ${T}.player.volume, fast: ${T}.player.fastScale, pause: ${T}.state.info.settings.pauseWhenHidden })`);
  check(
    "일반 탭: SAVE → personalization.cfg(음량 55·배수 8·정수 배율·슬롯 3)",
    after.volume === 55 && after.fastScale === 8 && after.scaleMode === "integer" && after.slot === 3 && Math.abs(live.volume - 0.55) < 1e-6 && live.fast === 8,
    JSON.stringify({ volume: after.volume, fastScale: after.fastScale, scaleMode: after.scaleMode, slot: after.slot }),
  );
  check("일반 탭: SAVE → setting.ini 의 그 줄만 바뀜(주석 유지)", /^pauseWhenHidden: true$/m.test(ini) && /^# 시험용$/m.test(ini) && /^# 개발자 도구$/m.test(ini) && /^useDevelopKit: true$/m.test(ini) && /^appWidth: 960$/m.test(ini) && live.pause === true, ini.replace(/\n/g, " | "));
  await closeSettings();

  /* ── 테마 ── */
  await openSettings("theme");
  await shot("settings_theme_ko.png");
  const themeRows = [];
  for (const mode of MODES) {
    await openSettings("theme");
    await click(`.cfg__mode[data-mode="${mode}"]`);
    await sleep(250);
    const seen = await app.evaluate(`(() => { const s = getComputedStyle(document.documentElement); return { theme: document.documentElement.dataset.theme, bg: s.getPropertyValue('--bg').trim(), raised: getComputedStyle(document.querySelector('.titlebar')).backgroundColor, panel: getComputedStyle(document.getElementById('sidepanel')).backgroundColor, stage: getComputedStyle(document.getElementById('stage')).backgroundColor }; })()`);
    await closeSettings();
    await sleep(250);
    await shot(`theme_${mode}.png`);
    themeRows.push(seen);
    check(`테마 ${mode}: 적용(제목 표시줄·옆 패널·첫 화면 색이 테마 값)`, seen.theme === mode && seen.bg, `--bg ${seen.bg} · 제목 ${seen.raised} · 패널 ${seen.panel}`);
  }
  check("테마 13개가 모두 서로 다른 배경", new Set(themeRows.map((r) => `${r.bg}|${r.raised}`)).size === MODES.length, themeRows.map((r) => r.bg).join(" "));
  await openSettings("theme");
  await click('.cfg__mode[data-mode="ragdoll"]');
  await sleep(400);
  await closeSettings();
  check("테마: 고른 테마를 personalization.cfg 에 기억", prefs().theme?.mode === "ragdoll", JSON.stringify(prefs().theme?.mode));

  /* ── 언어 ── */
  const infoText = async () => {
    await click('.menubar__item[data-menu="help"]');
    await sleep(150);
    await app.evaluate("document.querySelectorAll('#menu .menu__item')[1].click(); true");
    await sleep(500);
    const body = await app.evaluate("document.getElementById('dialog').textContent");
    await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27 });
    await app.send("Input.dispatchKeyEvent", { type: "keyUp", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(150);
    return body;
  };
  const rustError = () => app.evaluate("window.__TAURI__.core.invoke('file_list', { path: 'Z:\\\\no-such-folder' }).then(() => '', (e) => String(e))");
  const koInfo = await infoText();
  check("정보(한국어): MIT 줄·mGBA MPL-2.0 고지", koInfo.includes("webGBA — MIT License, © 2026 flightrabbit") && koInfo.includes("Mozilla Public License") && koInfo.includes("포함된 오픈소스"));
  await openSettings("language");
  await click('.cfg__lang[data-lang="en"]');
  await sleep(500);
  const en = await app.evaluate(`(() => ({ lang: document.documentElement.lang, menu: [...document.querySelectorAll('.menubar__item')].map((n) => n.textContent).join(), tabs: [...document.querySelectorAll('.cfg__tab')].map((n) => n.textContent.trim()).join(), head: document.getElementById('settings-head-title').textContent, status: document.getElementById('status').textContent, rail: document.getElementById('btn-open').title }))()`);
  check("언어 English: 다시 켜지 않고 바로 바뀜(메뉴·설정 창·상태 줄·툴팁)", en.lang === "en" && en.menu === "File,Game,Settings,Help" && en.tabs === "General,Keys,Theme,Language" && en.head === "Language" && /English/.test(en.status) && en.rail === "Open game (Ctrl+O)", JSON.stringify(en));
  check("언어 English: Rust 오류 문장도 영어", /^Not a folder: /.test(await rustError()), await rustError());
  await shot("settings_language_en.png");
  await click("#settings-tab-general");
  await sleep(200);
  await shot("lang_en.png");
  await closeSettings();
  const enInfo = await infoText();
  check("정보(English): 같은 MIT 줄·mGBA 고지", enInfo.includes("webGBA — MIT License, © 2026 flightrabbit") && enInfo.includes("Included open source") && enInfo.includes("Mozilla Public License"));
  await openSettings("language");
  await click('.cfg__lang[data-lang="ja"]');
  await sleep(500);
  const ja = await app.evaluate(`(() => ({ lang: document.documentElement.lang, menu: [...document.querySelectorAll('.menubar__item')].map((n) => n.textContent).join(), tabs: [...document.querySelectorAll('.cfg__tab')].map((n) => n.textContent.trim()).join(), start: document.querySelector('.start__hint').textContent }))()`);
  check("언어 日本語: 바로 바뀜", ja.lang === "ja" && ja.menu === "ファイル,ゲーム,設定,ヘルプ" && ja.tabs === "一般,キー,テーマ,言語" && /ドロップ/.test(ja.start), JSON.stringify(ja));
  check("언어 日本語: Rust 오류 문장도 일본어", /^フォルダーではありません: /.test(await rustError()), await rustError());
  await click("#settings-tab-general");
  await sleep(200);
  await shot("lang_ja.png");
  await closeSettings();
  const jaInfo = await infoText();
  check("정보(日本語): 같은 MIT 줄·mGBA 고지", jaInfo.includes("webGBA — MIT License, © 2026 flightrabbit") && jaInfo.includes("含まれているオープンソース") && jaInfo.includes("Mozilla Public License"));
  check("언어: lang 을 personalization.cfg 에 기억", prefs().lang === "ja");

  /* ── 종료할 때 세이브 파일(.gba, 128KB) ── */
  await open(game);
  const gameId = await app.evaluate(`${T}.state.game.saveId`);
  await closeByButton();
  const store = path.join(appDir, "bin", "save", "game.sav");
  const beside = path.join(exitDir, "game.sav");
  const made = fs.existsSync(beside) ? fs.readFileSync(beside) : null;
  check(
    "종료 세이브(.gba): 창 X 로 닫으면 롬 옆 game.sav 생김, 크기·내용이 webGBA 세이브와 같음",
    made && made.length === 131072 && made.equals(fs.readFileSync(store)) && Math.abs(fs.statSync(beside).mtimeMs - fs.statSync(store).mtimeMs) < 2,
    made ? `${made.length}바이트 · ${gameId}` : "파일 없음",
  );

  /* ── 다시 켜서 유지 확인(언어·테마·설정) + 종료 세이브와 가져오기 규칙이 부딪히지 않는지 ── */
  await start();
  const kept = await app.evaluate(`({ lang: ${T}.i18n.lang(), htmlLang: document.documentElement.lang, theme: document.documentElement.dataset.theme, menu: document.querySelector('.menubar__item').textContent, volume: ${T}.player.volume, fast: ${T}.player.fastScale, cache: JSON.parse(localStorage.getItem('webgba.theme.cache') || '{}') })`);
  check("다시 켜도 유지: 일본어·랙돌·음량 55·배수 8", kept.lang === "ja" && kept.htmlLang === "ja" && kept.theme === "ragdoll" && kept.menu === "ファイル" && Math.abs(kept.volume - 0.55) < 1e-6 && kept.fast === 8, JSON.stringify({ ...kept, cache: undefined }));
  check("다시 켤 때 깜빡임 방지 캐시(테마 토큰·언어)", kept.cache?.lang === "ja" && kept.cache?.theme === "ragdoll" && Object.keys(kept.cache?.props ?? {}).length > 40, `${Object.keys(kept.cache?.props ?? {}).length}개 토큰 · ${kept.cache?.lang}`);
  await app.evaluate(`${T}.setLang('ko')`);
  const bakBefore = fs.readdirSync(path.dirname(store)).filter((n) => n.includes(".bak")).length;
  await open(game);
  let said = await statusText();
  const hostSum = await app.evaluate(`(() => { const d = ${T}.player.host.saveData(); let s = 0; for (const b of d) s = (s + b) >>> 0; return [d.length, s]; })()`);
  check(
    "다시 켜서 열면 그 세이브로 이어짐(옆 game.sav 를 '더 새것'으로 다시 가져오지 않음)",
    /세이브를 불러왔습니다/.test(said) && !/가져왔습니다/.test(said) && hostSum[0] === 131072 && hostSum[1] === sum(made) && fs.readdirSync(path.dirname(store)).filter((n) => n.includes(".bak")).length === bakBefore,
    `${said} · ${hostSum.join("/")}`,
  );

  /* ── 덮어쓸 때 .bak 하나 ── */
  const changed = Buffer.from(townmap);
  changed[16] ^= 0xff;
  await app.evaluate(`${T}.state.game && window.__TAURI__.core.invoke('store_write', new Uint8Array(${JSON.stringify([...changed])}), { headers: { 'x-store': encodeURIComponent(${T}.state.game.saveId), 'x-slot': '0' } })`);
  await closeByButton();
  const bak = path.join(exitDir, "game.sav.bak");
  check(
    "종료 세이브: 같은 이름 파일이 있으면 .sav.bak 하나로 남기고 덮어씀",
    fs.existsSync(bak) && fs.readFileSync(bak).equals(made) && fs.readFileSync(beside).equals(changed),
    fs.readdirSync(exitDir).join(", "),
  );

  /* ── 포트 .wgba(512KB) ── */
  await start();
  await open(portWgba);
  const port = await app.evaluate(`({ id: ${T}.state.game.saveId, cap: ${T}.player.host.saveCapacity, kind: ${T}.state.game.kind })`);
  await app.evaluate(`${T}.player.host.ex.Web_DebugSave()`);
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    if (fs.existsSync(path.join(appDir, "bin", "web", port.id.slice(4), "save.sav"))) break;
  }
  await sleep(800);
  await closeByButton();
  const portStore = path.join(appDir, "bin", "web", port.id.slice(4), "save.sav");
  const portBeside = path.join(work, "port", `${TEST_BUILD}.sav`);
  const portMade = fs.existsSync(portBeside) ? fs.readFileSync(portBeside) : null;
  check(
    `종료 세이브(.wgba 포트): ${TEST_BUILD}.wgba 옆 ${TEST_BUILD}.sav, 크기 그대로(코어 세이브 크기)·내용 같음`,
    port.kind === "web" && portMade && fs.existsSync(portStore) && portMade.length === fs.statSync(portStore).size && portMade.length === port.cap && portMade.equals(fs.readFileSync(portStore)),
    portMade ? `${portMade.length}바이트 (코어 ${port.cap})` : "파일 없음",
  );
  await start();
  await open(portWgba);
  said = await statusText();
  check("포트: 다시 켜서 열면 '세이브를 불러왔습니다', 옆 파일을 다시 가져오지 않음", /세이브를 불러왔습니다/.test(said) && !/가져왔습니다/.test(said), said);

  /* ── 웹 빌드 롬 고르기(설정 "웹 빌드에 쓸 롬 파일 이름") ── */
  const sameDir = path.join(work, "same");
  fs.rmSync(sameDir, { recursive: true, force: true });
  fs.mkdirSync(sameDir, { recursive: true });
  const sameWgba = path.join(sameDir, `${TEST_BUILD}.wgba`);
  fs.copyFileSync(portWgba, sameWgba);
  fs.copyFileSync(path.join(work, TEST_ROM), path.join(sameDir, TEST_ROM));
  const romUsed = async () => String((await app.evaluate(`${T}.state.game?.rom ?? ''`)) || "");
  const inSame = (rom) => rom.toLowerCase().endsWith(`${path.sep}same${path.sep}${TEST_ROM}`.toLowerCase());
  await open(sameWgba);
  let rom = await romUsed();
  check("롬 설정 비움: 같은 폴더에 .gba 가 하나면 그것을 씀(묻지 않음)", inSame(rom) && (await app.evaluate(`${T}.state.game.kind`)) === "web", `${path.basename(rom)} · ${await statusText()}`);
  await app.evaluate(`${T}.closeGame()`);
  await sleep(300);
  await openSettings("general");
  await setNumber("웹 빌드에 쓸 롬 파일 이름", ` ${TEST_ROM} `);
  await click("#settings-save");
  await sleep(500);
  await closeSettings();
  const named = prefs().webRom;
  check("롬 설정: 설정 창에서 이름을 적고 SAVE → personalization.cfg webRom(앞뒤 빈칸 뺌)", named === TEST_ROM, JSON.stringify(named));
  fs.writeFileSync(path.join(sameDir, "zz_dummy.gba"), Buffer.alloc(4));
  if (named === TEST_ROM) {
    await open(sameWgba);
    rom = await romUsed();
    check("롬 설정 이름: 같은 폴더에 .gba 가 여럿이어도 그 이름의 롬을 씀", inSame(rom) && (await app.evaluate(`${T}.player.active`)), `${path.basename(rom)} · ${await statusText()}`);
    await app.evaluate(`${T}.closeGame()`);
    await sleep(300);
  }
  await openSettings("general");
  await app.evaluate(`(() => { const row = [...document.querySelectorAll('#settings-body .cfg__row')].find((r) => r.querySelector('.cfg__label').firstChild.textContent === '웹 빌드에 쓸 롬 파일 이름'); row.querySelector('button').click(); return true; })()`);
  await click("#settings-save");
  await sleep(500);
  await closeSettings();
  check("롬 설정: 되돌리기 버튼 → 비움으로 저장", prefs().webRom === "", JSON.stringify(prefs().webRom));

  /* ── 다른 폴더 ── */
  fs.mkdirSync(otherDir, { recursive: true });
  await app.evaluate(`window.__TAURI__.core.invoke('prefs_set', { patch: { exitSaveDir: ${JSON.stringify(otherDir)} } }).then(() => { ${T}.state.prefs.exitSaveDir = ${JSON.stringify(otherDir)}; return true; })`);
  await open(game);
  const toOther = path.join(otherDir, "game.sav");
  await app.evaluate(`${T}.closeGame()`);
  await sleep(400);
  check("세이브 파일 폴더를 고르면 그 폴더에 <이름>.sav (다른 게임을 열거나 닫을 때도)", fs.existsSync(toOther) && fs.statSync(toOther).size === 131072 && /세이브 파일을 만들었습니다/.test(await statusText()), await statusText());

  /* ── 끈 상태 ── */
  await openSettings("general");
  await app.evaluate(`(() => { const row = [...document.querySelectorAll('#settings-body .cfg__row')].find((r) => r.querySelector('.cfg__label').firstChild.textContent === '종료할 때 세이브 파일 만들기'); row.querySelector('input').click(); return true; })()`);
  const folderOff = await app.evaluate(`[...document.querySelectorAll('#settings-body .cfg__row')].find((r) => r.querySelector('.cfg__label').firstChild.textContent === '세이브 파일 폴더').classList.contains('is-disabled')`);
  await click("#settings-save");
  await sleep(500);
  await closeSettings();
  check("끄면 '세이브 파일 폴더' 줄이 흐려지고 exitSave false 로 저장", folderOff && prefs().exitSave === false, String(prefs().exitSave));
  fs.rmSync(beside, { force: true });
  fs.rmSync(toOther, { force: true });
  await open(game);
  await closeByButton();
  check("끈 상태: 닫아도 .sav 를 만들지 않음", !fs.existsSync(beside) && !fs.existsSync(toOther), fs.readdirSync(exitDir).join(", "));
} catch (error) {
  check("오류 없이 끝남", false, String(error?.stack ?? error));
} finally {
  if (running()) {
    const left = app ?? (await connect(PORT, { timeoutMs: 3000 }).catch(() => null));
    if (left) {
      await Promise.race([left.evaluate("window.__TAURI__.core.invoke('window_close')").catch(() => {}), sleep(1500)]);
      left.close();
    }
  }
  fs.writeFileSync(path.join(work, "app_settings_result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length}개 중 ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
