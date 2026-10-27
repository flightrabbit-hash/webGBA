// 키 입력·빨리 감기 소리 시험(사용자 2026-10-27 "방향키가 가끔 안 먹음", "Space 빨리 감기 중 소리가 안 남"). 실제 앱을 CDP 로 다룬다. 마우스를 움직이지 않는다.
//   node tools/test/app-input.mjs <exe> <작업 폴더> [gba] [wgba]
// 작업 폴더: rom\test.gba · port\<빌드>.wgba(웹 빌드 사본) · <롬>(그 빌드의 롬 사본). <빌드>·<롬> 은 WEBGBA_TEST_BUILD·WEBGBA_TEST_ROM(cdp.mjs).
// port\ 에 가짜 롬 zz_dummy.gba 를 함께 두고 설정 "웹 빌드에 쓸 롬 파일 이름"(webRom)을 <롬> 으로 씨앗에 넣어, 이름으로 위 폴더의 롬을 찾는지도 본다.
// 앱 폴더 <작업>\app_input 을 새로 만든다(.wgba 연결은 건드리지 않음: wgbaLink false). 결과 <작업>\app_input_result.json
// 게임에 넘어간 키는 host.runFrame 을 감싸 프레임마다 기록하고, 소리는 AudioWorklet 으로 보내는 표본 수를 센다.
import fs from "fs";
import path from "path";
import { attach, connect, guardOthers, launch, prepareApp, runningIn, sleep, TEST_BUILD, TEST_ROM } from "./cdp.mjs";

const [exe, work, ...rest] = process.argv.slice(2);
if (!exe || !work) {
  console.error("사용법: node tools/test/app-input.mjs <exe> <작업 폴더> [gba] [wgba]");
  process.exit(2);
}
const kinds = rest.length ? rest : ["gba", "wgba"];

const PORT = 9341;
const appDir = path.join(work, "app_input");
const T = "window.__WEBGBA_TEST__";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const BIT = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
const VK = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, KeyX: 88, KeyZ: 90, KeyK: 75, Enter: 13, Space: 32, Escape: 27, Tab: 9 };
const KEY = { ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Enter: "Enter", Space: " ", Escape: "Escape", Tab: "Tab" };

let app = null;

const keyEvent = (type, code, extra = {}) =>
  app.send("Input.dispatchKeyEvent", { type, code, key: KEY[code] ?? code.replace(/^Key/, "").toLowerCase(), windowsVirtualKeyCode: VK[code] ?? 0, ...extra });
const down = (code, extra) => keyEvent("rawKeyDown", code, extra);
const up = (code, extra) => keyEvent("keyUp", code, extra);
const tap = (code, ms = 100) => down(code).then(() => sleep(ms)).then(() => up(code));

const RECORD = `(() => {
  const p = ${T}.player;
  const h = p.host;
  if (!h.__run) {
    h.__run = h.runFrame.bind(h);
    h.runFrame = (k) => { window.__keys.push(k); return h.__run(k); };
  }
  window.__keys = [];
  window.__snd = { floats: 0, posts: 0, loud: 0 };
  const port = p.audio && p.audio.node.port;
  if (port && !port.__post) {
    port.__post = port.postMessage.bind(port);
    port.postMessage = (m, t) => {
      if (m && typeof m === "object" && m.length) {
        const a = window.__snd;
        a.floats += m.length;
        a.posts++;
        for (let i = 0; i < m.length; i += 7) if (Math.abs(m[i]) > 1e-4) { a.loud++; break; }
      }
      return port.__post(m, t);
    };
  }
  return Boolean(port);
})()`;

const mark = () => app.evaluate("window.__keys.length");
const since = (at) => app.evaluate(`window.__keys.slice(${at})`);
const frameCount = () => app.evaluate("window.__keys.length");
const sound = (reset = false) => app.evaluate(`(() => { const a = { ...window.__snd }; ${reset ? "window.__snd = { floats: 0, posts: 0, loud: 0 };" : ""} return a; })()`);
const rising = (frames, bit, start = 0) => {
  let prev = start & bit;
  let n = 0;
  for (const k of frames) {
    if (k & bit && !prev) n++;
    prev = k & bit;
  }
  return n;
};
const falling = (frames, bit, start = 0) => {
  let prev = start & bit;
  let n = 0;
  for (const k of frames) {
    if (!(k & bit) && prev) n++;
    prev = k & bit;
  }
  return n;
};
const tail = (frames, n = 4) => frames.slice(-n);
const fmt = (frames) => frames.map((k) => k.toString(16)).join(" ");

const rowSelector = (label) => `[...document.querySelectorAll('#settings-body .cfg__row')].find((r) => r.querySelector('.cfg__label').firstChild.textContent === ${JSON.stringify(label)})`;

async function setSetting(label, index) {
  await app.evaluate(`${T}.openSettings('general').then(() => new Promise((r) => setTimeout(() => r(true), 300)))`);
  const found = await app.evaluate(`(() => { const row = ${rowSelector(label)}; if (!row) return false; row.querySelectorAll('input')[${index}].click(); return true; })()`);
  if (found) {
    await app.evaluate("document.getElementById('settings-save').click(); true");
    await sleep(500);
  }
  await app.evaluate(`${T}.settings.close(); true`);
  await sleep(200);
  return found;
}

async function measure(ms) {
  await sound(true);
  const f0 = await frameCount();
  await sleep(ms);
  const s = await sound();
  const f1 = await frameCount();
  const rate = await app.evaluate(`${T}.player.audio.ac.sampleRate`);
  return { perSec: s.floats / 2 / (ms / 1000), ratio: s.floats / 2 / (ms / 1000) / rate, loud: s.loud, posts: s.posts, speed: (f1 - f0) / ((ms / 1000) * 59.7275) };
}

const fill = () => app.evaluate(`${T}.player.audioFill ? ${T}.player.audioFill() : Promise.resolve(null)`);
const showSound = (m) => `초당 ${Math.round(m.perSec)}표본(장치의 ${(m.ratio * 100).toFixed(0)}%) · 소리 있는 묶음 ${m.loud}/${m.posts} · 게임 ${m.speed.toFixed(2)}배`;

async function soundTests(label) {
  let m = await measure(3000);
  check(`${label} S1 보통 속도 소리`, m.ratio > 0.85 && m.ratio < 1.15 && m.loud > 0, showSound(m));
  const q0 = await fill();
  check(`${label} S1 보통 속도 소리 대기열(화면보다 늦게 나오지 않음) 0.1초 아래`, q0 !== null && q0 < 0.1, q0 === null ? "알 수 없음" : `${(q0 * 1000).toFixed(0)}ms`);

  await down("Space");
  await sleep(500);
  m = await measure(5000);
  await up("Space");
  check(`${label} S2 Space 를 누르는 동안 소리가 남(빨라진 소리, 표본 수는 실제 시간만큼)`, m.ratio > 0.8 && m.ratio < 1.2 && m.loud > 0 && m.speed > 3, showSound(m));

  await sleep(150);
  m = await measure(2500);
  const q1 = await fill();
  check(`${label} S3 Space 를 떼면 바로 보통 소리`, m.ratio > 0.85 && m.ratio < 1.15 && m.loud > 0 && m.speed < 1.1 && q1 !== null && q1 < 0.1, `${showSound(m)} · 대기열 ${q1 === null ? "알 수 없음" : `${(q1 * 1000).toFixed(0)}ms`}`);

  await down("Space");
  await sleep(3000);
  m = await measure(12000);
  const q2 = await fill();
  await up("Space");
  check(`${label} S4 오래 눌러도 소리가 밀리지 않음(15초)`, m.ratio > 0.88 && m.ratio < 1.12 && m.loud > 0 && q2 !== null && q2 < 0.1, `${showSound(m)} · 대기열 ${q2 === null ? "알 수 없음" : `${(q2 * 1000).toFixed(0)}ms`}`);

  await tap("Tab", 60);
  await sleep(400);
  m = await measure(3000);
  await tap("Tab", 60);
  await sleep(300);
  const fastOff = await app.evaluate(`${T}.player.speed`);
  check(`${label} S5 Tab 빨리 감기도 소리가 남, 다시 Tab 으로 끔`, m.ratio > 0.8 && m.ratio < 1.2 && m.loud > 0 && m.speed > 3 && fastOff === 1, showSound(m));

  const set = await setSetting("빨리 감기 중 소리 끄기", 0);
  const savedOn = set && JSON.parse(fs.readFileSync(path.join(appDir, "bin", "ini", "personalization.cfg"), "utf8")).fastMute === true;
  await down("Space");
  await sleep(400);
  const muted = await measure(2000);
  await up("Space");
  await sleep(150);
  const back = await measure(2000);
  check(`${label} S6 "빨리 감기 중 소리 끄기"를 켜면 빨리 감기 동안만 조용함`, savedOn && muted.posts === 0 && back.ratio > 0.85 && back.loud > 0, set ? `빨리 감기 ${muted.posts}묶음 · 뗀 뒤 ${showSound(back)}` : "설정 줄 없음");
  if (set) await setSetting("빨리 감기 중 소리 끄기", 0);
  const prefsFile = JSON.parse(fs.readFileSync(path.join(appDir, "bin", "ini", "personalization.cfg"), "utf8"));
  if (set) check(`${label} S6 설정 저장(다시 끔 → fastMute false)`, prefsFile.fastMute === false, JSON.stringify({ fastMute: prefsFile.fastMute }));
}

async function inputTests(label) {
  const firstMode = await app.evaluate(`${T}.player.dpadMode`);
  const firstSaved = JSON.parse(fs.readFileSync(path.join(appDir, "bin", "ini", "personalization.cfg"), "utf8")).dpadMode;
  let at = await mark();
  await down("ArrowLeft");
  await sleep(120);
  await down("ArrowUp");
  await sleep(150);
  const upOnly = await since(at);
  await up("ArrowUp");
  await sleep(150);
  let f = await since(at);
  await up("ArrowLeft");
  await sleep(100);
  check(
    `${label} K1 기본 "나중에 누른 방향만": ←누른 채 ↑ 누르면 ↑만, ↑를 떼면 ←는 그대로`,
    firstMode === "latest" && (firstSaved ?? "latest") === "latest" && tail(upOnly).every((k) => (k & 240) === BIT.UP) && tail(f).every((k) => (k & 240) === BIT.LEFT),
    `${firstMode} · 저장값 ${firstSaved ?? "없음"} · ${fmt(tail(upOnly, 3))} | ${fmt(tail(f, 3))}`,
  );

  at = await mark();
  await down("KeyX");
  await sleep(120);
  await down("KeyK");
  await sleep(120);
  await up("KeyK");
  await sleep(150);
  f = await since(at);
  await up("KeyX");
  await sleep(100);
  check(`${label} K2 같은 버튼(A)의 두 키(X·K)를 함께 누르고 K 만 떼도 A 는 눌린 채`, tail(f).every((k) => k & BIT.A), fmt(tail(f, 6)));

  at = await mark();
  await down("KeyZ");
  await down("ArrowRight");
  await sleep(150);
  await up("KeyZ");
  await sleep(150);
  f = await since(at);
  await up("ArrowRight");
  await sleep(100);
  check(`${label} K3 B(달리기)+방향에서 B 만 떼도 방향은 그대로`, f.some((k) => (k & 18) === 18) && tail(f).every((k) => k & BIT.RIGHT && !(k & BIT.B)), fmt(tail(f, 6)));

  at = await mark();
  for (let i = 0; i < 20; i++) {
    await Promise.all([down("ArrowDown"), up("ArrowDown")]);
    await sleep(70);
  }
  f = await since(at);
  const shortSeen = rising(f, BIT.DOWN);
  check(`${label} K4 아주 짧은 누름(누르고 바로 뗌) 20번이 모두 게임에 1프레임 이상`, shortSeen === 20, `${shortSeen}/20`);

  await down("ArrowRight");
  await sleep(150);
  at = await mark();
  for (let i = 0; i < 10; i++) {
    await Promise.all([up("ArrowRight"), down("ArrowRight")]);
    await sleep(100);
  }
  f = await since(at);
  await up("ArrowRight");
  await sleep(100);
  const gaps = falling(f, BIT.RIGHT, BIT.RIGHT);
  check(`${label} K5 누른 채 아주 짧게 뗐다 다시 누름 10번이 모두 게임에 새 누름으로`, gaps === 10, `${gaps}/10`);

  const opposite = await setSetting("방향키 동시 누름", 1);
  if (!opposite) {
    check(`${label} K6 방향키 동시 누름 설정(반대쪽은 나중 것·나중 방향만)`, false, "설정 줄 없음");
  } else {
    at = await mark();
    await down("ArrowLeft");
    await sleep(120);
    await down("ArrowRight");
    await sleep(150);
    const both = await since(at);
    await up("ArrowRight");
    await sleep(150);
    const left = await since(at);
    await down("ArrowUp");
    await sleep(150);
    const diag = await since(at);
    await up("ArrowUp");
    await up("ArrowLeft");
    await sleep(100);
    check(
      `${label} K6 "반대쪽은 나중 것": ←누른 채 → 누르면 →만, →를 떼면 ←, ↑는 함께`,
      tail(both).every((k) => (k & 48) === BIT.RIGHT) && tail(left).every((k) => (k & 48) === BIT.LEFT) && tail(diag).every((k) => (k & 96) === 96),
      `${fmt(tail(both, 3))} | ${fmt(tail(left, 3))} | ${fmt(tail(diag, 3))}`,
    );
    await setSetting("방향키 동시 누름", 2);
    at = await mark();
    await down("ArrowUp");
    await sleep(120);
    await down("ArrowLeft");
    await sleep(150);
    const latest = await since(at);
    await up("ArrowLeft");
    await sleep(150);
    const back = await since(at);
    await up("ArrowUp");
    await sleep(100);
    check(
      `${label} K7 "나중에 누른 방향만": ↑누른 채 ← 누르면 ←만(바로 꺾음), ←를 떼면 ↑`,
      tail(latest).every((k) => (k & 240) === BIT.LEFT) && tail(back).every((k) => (k & 240) === BIT.UP),
      `${fmt(tail(latest, 3))} | ${fmt(tail(back, 3))}`,
    );
    await setSetting("방향키 동시 누름", 0);
    at = await mark();
    await down("ArrowLeft");
    await down("ArrowRight");
    await sleep(150);
    f = await since(at);
    await up("ArrowRight");
    await up("ArrowLeft");
    await sleep(100);
    const saved = JSON.parse(fs.readFileSync(path.join(appDir, "bin", "ini", "personalization.cfg"), "utf8")).dpadMode;
    check(`${label} K8 "모두 넘기기(GBA)": ←+→ 둘 다 넘김, 설정 저장`, tail(f).every((k) => (k & 48) === 48) && saved === "both", `${fmt(tail(f, 3))} · dpadMode ${saved}`);
    at = await mark();
    await down("ArrowLeft");
    await sleep(120);
    await down("ArrowUp");
    await sleep(150);
    await up("ArrowUp");
    await sleep(150);
    f = await since(at);
    await up("ArrowLeft");
    await sleep(100);
    check(`${label} K9 "모두 넘기기": 두 방향을 함께 누르고 한쪽만 떼면 다른 쪽은 그대로`, f.some((k) => (k & 96) === 96) && tail(f).every((k) => k & BIT.LEFT && !(k & BIT.UP)), fmt(tail(f, 6)));
    await setSetting("방향키 동시 누름", 2);
  }

  await app.evaluate("document.getElementById('sidepanel-list').focus(); true");
  const before = await app.evaluate(`${T}.state.selected`);
  at = await mark();
  await tap("ArrowDown", 150);
  await sleep(100);
  f = await since(at);
  const after = await app.evaluate(`${T}.state.selected`);
  check(`${label} F1 파일 목록에 초점이 있어도 방향키는 게임으로(목록은 움직이지 않음)`, f.some((k) => k & BIT.DOWN) && before === after, `게임 ${f.some((k) => k & BIT.DOWN) ? "받음" : "못 받음"} · 목록 ${before}→${after}`);

  await app.evaluate("document.getElementById('btn-pause').focus(); true");
  at = await mark();
  await tap("Enter", 100);
  await down("Space");
  await sleep(300);
  const fastWhile = await app.evaluate(`${T}.player.speed`);
  await up("Space");
  await sleep(150);
  f = await since(at);
  const paused = await app.evaluate(`${T}.player.paused`);
  check(`${label} F2 도구 막대 버튼에 초점이 있어도 Enter(START)·Space(빨리 감기)는 게임으로, 버튼은 눌리지 않음`, f.some((k) => k & BIT.START) && fastWhile > 1 && paused === false, `START ${f.some((k) => k & BIT.START)} · 빨리 감기 ${fastWhile} · 일시정지 ${paused}`);
  await app.evaluate("document.getElementById('stage').focus(); true");

  await down("ArrowRight");
  await sleep(150);
  await app.evaluate("window.dispatchEvent(new Event('blur')); true");
  await sleep(50);
  at = await mark();
  await sleep(150);
  f = await since(at);
  check(`${label} F3 창이 초점을 잃으면 누르던 키를 모두 뗌`, f.length > 0 && f.every((k) => !(k & BIT.RIGHT)), fmt(tail(f, 4)));
  await app.evaluate("window.dispatchEvent(new Event('focus')); true");
  at = await mark();
  await down("ArrowRight", { autoRepeat: true });
  await sleep(150);
  f = await since(at);
  await up("ArrowRight");
  await sleep(100);
  check(`${label} F4 초점이 돌아온 뒤 계속 누르고 있던 키(자동 반복)는 다시 눌림`, tail(f).every((k) => k & BIT.RIGHT), fmt(tail(f, 4)));

  await down("ArrowRight");
  await sleep(120);
  await app.evaluate(`${T}.openSettings('general').then(() => true)`);
  await sleep(300);
  at = await mark();
  await tap("ArrowDown", 120);
  await sleep(150);
  f = await since(at);
  await up("ArrowRight");
  const settingsOpen = await app.evaluate("!document.getElementById('settings-modal').hidden");
  await tap("Escape", 60);
  await sleep(200);
  check(`${label} F5 설정 창이 열리면 키는 설정 창으로(게임에 안 감), 누르던 키도 뗌`, settingsOpen && f.length > 0 && f.every((k) => !(k & (BIT.DOWN | BIT.RIGHT))), fmt(tail(f, 4)));

  await app.evaluate("document.querySelector('.menubar__item[data-menu=\"help\"]').click(); true");
  await sleep(150);
  await app.evaluate("document.querySelectorAll('#menu .menu__item')[1].click(); true");
  await sleep(400);
  at = await mark();
  await tap("ArrowDown", 120);
  await sleep(150);
  f = await since(at);
  const dialogOpen = await app.evaluate("!document.getElementById('layer').hidden");
  await tap("Escape", 60);
  await sleep(200);
  check(`${label} F6 대화상자가 열려 있으면 키는 대화상자로(게임에 안 감)`, dialogOpen && f.every((k) => !(k & BIT.DOWN)), `대화상자 ${dialogOpen} · ${fmt(tail(f, 4))}`);
  await app.evaluate("document.getElementById('stage').focus(); true");

  at = await mark();
  await down("KeyZ", { key: "Process", windowsVirtualKeyCode: 229 });
  await sleep(150);
  const imeHeld = await since(at);
  await up("KeyZ");
  await sleep(150);
  f = await since(at);
  check(`${label} I1 한글 입력기(keydown "Process"/229)에서도 문자키(Z=B)`, tail(imeHeld).every((k) => k & BIT.B) && tail(f).every((k) => !(k & BIT.B)), fmt(tail(imeHeld, 3)));

  at = await mark();
  await down("ArrowLeft", { key: "Process", windowsVirtualKeyCode: 229 });
  await sleep(150);
  f = await since(at);
  await up("ArrowLeft");
  await sleep(100);
  check(`${label} I2 한글 입력기(keydown "Process"/229)에서도 방향키`, tail(f).every((k) => k & BIT.LEFT), fmt(tail(f, 3)));

  at = await mark();
  await down("", { key: "ArrowLeft", windowsVirtualKeyCode: 37 });
  await sleep(150);
  const noCode = await since(at);
  await up("", { key: "ArrowLeft", windowsVirtualKeyCode: 37 });
  await down("", { key: "ㅋ", windowsVirtualKeyCode: 90 });
  await sleep(150);
  const jamo = await since(at);
  await up("", { key: "ㅋ", windowsVirtualKeyCode: 90 });
  await sleep(150);
  f = await since(at);
  check(`${label} I3 물리 키 이름(code)이 비어 오는 키(가상 키 입력·일부 입력기)도 키 번호로`, tail(noCode).every((k) => k & BIT.LEFT) && tail(jamo).every((k) => k & BIT.B) && tail(f).every((k) => !(k & (BIT.LEFT | BIT.B))), `${fmt(tail(noCode, 2))} | ${fmt(tail(jamo, 2))} | ${fmt(tail(f, 2))}`);
}

try {
  guardOthers(exe, work);
  if (runningIn(work)) throw new Error("시험 폴더의 webgba.exe 가 아직 켜져 있습니다");
  fs.rmSync(appDir, { recursive: true, force: true });
  const games = path.join(work, "games");
  fs.mkdirSync(games, { recursive: true });
  const gba = path.join(games, "test.gba");
  if (!fs.existsSync(gba) || fs.statSync(gba).size !== fs.statSync(path.join(work, "rom", "test.gba")).size) fs.copyFileSync(path.join(work, "rom", "test.gba"), gba);
  fs.writeFileSync(path.join(games, "zz_dummy.gba"), Buffer.alloc(4));
  const wgba = path.join(work, "port", `${TEST_BUILD}.wgba`);
  fs.writeFileSync(path.join(work, "port", "zz_dummy.gba"), Buffer.alloc(4));
  for (const name of [`${TEST_BUILD}.sav`, `${TEST_BUILD}.sav.bak`]) fs.rmSync(path.join(work, "port", name), { force: true });
  for (const name of ["test.sav", "test.sav.bak"]) fs.rmSync(path.join(games, name), { force: true });
  prepareApp(exe, appDir);
  fs.writeFileSync(
    path.join(appDir, "bin", "ini", "personalization.cfg"),
    JSON.stringify({ window: { x: 60, y: 60, width: 1100, height: 760, maximized: false }, panel: "files", wgbaLink: false, volume: 80, muted: false, fastScale: 4, slot: 1, recent: [], favorites: [], webRom: TEST_ROM }, null, 2),
  );
  launch(path.join(appDir, "webgba.exe"), PORT);
  app = await attach(PORT);
  await app.send("Emulation.setFocusEmulationEnabled", { enabled: true });

  for (const kind of kinds) {
    const label = kind === "gba" ? ".gba" : ".wgba";
    const file = kind === "gba" ? gba : wgba;
    await app.evaluate(`${T}.openPath(${JSON.stringify(file)})`);
    await app.evaluate(`new Promise((r) => { const t = () => (${T}.state.game && !${T}.state.opening ? r(true) : setTimeout(t, 50)); t(); })`);
    await app.evaluate("document.getElementById('stage').focus(); true");
    await sleep(5000);
    const hooked = await app.evaluate(RECORD);
    const audio = await app.evaluate(`(() => { const a = ${T}.player.audio; return a ? a.ac.state : "없음"; })()`);
    const usedRom = path.basename((await app.evaluate(`${T}.state.game?.rom ?? ''`)) || "");
    const romOk = kind === "gba" || usedRom === TEST_ROM;
    check(`${label} 열림(${path.basename(file)}${kind === "gba" ? "" : ` · 설정 이름으로 위 폴더의 롬 ${usedRom}`}) · 소리 장치 ${audio}`, (await app.evaluate(`${T}.player.active`)) && hooked && audio === "running" && romOk, await app.evaluate("document.getElementById('status').textContent"));
    await soundTests(label);
    await inputTests(label);
  }
} catch (error) {
  check("오류 없이 끝남", false, String(error?.stack ?? error));
} finally {
  const left = app ?? (await connect(PORT, { timeoutMs: 3000 }).catch(() => null));
  if (left) {
    await Promise.race([left.evaluate("window.__TAURI__.core.invoke('window_close')").catch(() => {}), sleep(1500)]);
    left.close();
  }
  for (let i = 0; i < 20 && runningIn(work); i++) await sleep(250);
  fs.writeFileSync(path.join(work, "app_input_result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length}개 중 ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
