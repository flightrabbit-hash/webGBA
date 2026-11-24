// 스플래시 배경 선택 테스트(브라우저 없음) — web/src/splash/plan.js 를 node vm 에서 그대로 실행.
// 시각·요일·날짜별 묶음과 행사, 평일 집 복도 경계, 최근 3개 제외, 무게 분포, 캐시에 없는 배경 재선택, 배경 파일·자료 1:1 대응.
//   node web/test/web-splash-plan.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "src", "splash");
const script = new vm.Script(fs.readFileSync(path.join(dir, "plan.js"), "utf8"), { filename: "plan.js" });
const KEY = "webgba.splashRecent";
const BASE = ["meadow", "home", "sunset"];

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const env = { now: 0, store: new Map(), sw: "on", broken: new Set(), phone: true, random: Math.random, decoded: [] };
class FakeDate extends Date {
  constructor(...args) {
    if (args.length) super(...args);
    else super(env.now);
  }
  static now() {
    return env.now;
  }
}
const sandbox = {
  Date: FakeDate,
  Math: Object.assign(Object.create(Math), { random: () => env.random() }),
  matchMedia: () => ({ matches: env.phone }),
  screen: { width: 390, height: 844 },
  localStorage: {
    getItem: (key) => (env.store.has(key) ? env.store.get(key) : null),
    setItem: (key, value) => env.store.set(key, String(value)),
  },
  Image: class {
    set src(value) {
      this.url = value;
    }
    decode() {
      env.decoded.push(this.url);
      return env.broken.has(this.url) ? Promise.reject(new Error("decode")) : Promise.resolve();
    }
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
const setWorker = () => {
  sandbox.navigator = env.sw === null ? {} : { serviceWorker: { controller: env.sw === "on" ? {} : null } };
};

function at(y, mo, d, h, mi = 0, s = 0) {
  return new Date(y, mo - 1, d, h, mi, s, 0).getTime();
}
function plan(when, { recent = null, keep = false } = {}) {
  env.now = when;
  if (!keep) env.store = new Map();
  if (recent) env.store.set(KEY, JSON.stringify(recent));
  env.decoded = [];
  setWorker();
  sandbox.webgbaSplashPlan = undefined;
  script.runInContext(sandbox);
  return sandbox.webgbaSplashPlan;
}
async function pick(when, options) {
  const p = plan(when, options);
  const [variant] = await p.ready;
  return { variant, plan: p, recent: JSON.parse(env.store.get(KEY) || "[]") };
}
const listText = (list) => list.map(([id, w]) => (w === 1 ? id : `${id}*${w}`)).join(" ");
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const label = (when) => {
  const d = new Date(when);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}(${DOW[d.getDay()]}) ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

const NIGHT_AUTUMN = "starry-hill sunset crystal-cave neon-street space*0.5 underwater*0.5";
const EVENING = "library train castle greenhouse rain-alley";
const CASES = [
  [at(2026, 11, 24, 3, 59, 59), "night", NIGHT_AUTUMN],
  [at(2026, 11, 24, 4, 0), "dawn", "meadow bamboo autumn-maple*2"],
  [at(2026, 11, 24, 8, 59, 59), "dawn", "meadow bamboo autumn-maple*2"],
  [at(2026, 11, 24, 9, 0), "day", "market temple desert cloud-path*0.5 candy*0.5"],
  [at(2026, 11, 24, 16, 59, 59), "day", "market temple desert cloud-path*0.5 candy*0.5"],
  [at(2026, 11, 24, 17, 0, 0), "home", "home"],
  [at(2026, 11, 24, 18, 59, 59), "home", "home"],
  [at(2026, 11, 24, 19, 0, 0), "home", "home"],
  [at(2026, 11, 24, 19, 0, 59), "home", "home"],
  [at(2026, 11, 24, 19, 1, 0), "evening", EVENING],
  [at(2026, 11, 24, 22, 59, 59), "evening", EVENING],
  [at(2026, 11, 24, 23, 0), "night", NIGHT_AUTUMN],
  [at(2026, 11, 23, 17, 0), "home", "home"],
  [at(2026, 11, 27, 19, 0, 30), "home", "home"],
  [at(2026, 11, 28, 16, 59, 59), "day", "market temple desert cloud-path*0.5 candy*0.5"],
  [at(2026, 11, 28, 17, 0), "dusk", "sunset market rain-alley"],
  [at(2026, 11, 29, 18, 59, 59), "dusk", "sunset market rain-alley"],
  [at(2026, 11, 28, 19, 0, 0), "evening", `${EVENING} home`],
  [at(2026, 11, 29, 19, 0, 30), "evening", `${EVENING} home`],
  [at(2026, 5, 5, 6, 0), "dawn", "meadow bamboo spring-cherry*2 tulip*2"],
  [at(2026, 7, 7, 6, 0), "dawn", "meadow bamboo sunflower*2"],
  [at(2027, 1, 12, 6, 0), "dawn", "meadow bamboo winter-snow*2"],
  [at(2026, 7, 7, 12, 0), "day", "market temple desert cloud-path*0.5 candy*0.5 summer-beach*2"],
  [at(2026, 6, 10, 12, 0), "day", "market temple desert cloud-path*0.5 candy*0.5 summer-beach*2 hydrangea*2"],
  [at(2026, 7, 11, 17, 30), "dusk", "sunset market rain-alley festival*2"],
  [at(2027, 1, 12, 20, 0), "evening", `${EVENING} christmas*2`],
  [at(2027, 1, 16, 20, 0), "evening", `${EVENING} home christmas*2`],
  [at(2026, 7, 7, 1, 0), "night", "starry-hill sunset crystal-cave neon-street space*0.5 underwater*0.5 festival*2"],
  [at(2026, 12, 18, 19, 0, 30), "home", "home"],
  [at(2026, 12, 18, 19, 1, 0), "christmas", "christmas"],
  [at(2026, 12, 20, 19, 0, 0), "christmas", "christmas"],
  [at(2026, 12, 25, 3, 59, 59), "christmas", "christmas"],
  [at(2026, 12, 25, 4, 0), "dawn", "meadow bamboo winter-snow*2"],
  [at(2026, 12, 17, 21, 0), "evening", `${EVENING} christmas*2`],
  [at(2026, 12, 26, 21, 0), "evening", `${EVENING} home christmas*2`],
  [at(2026, 12, 19, 17, 30), "dusk", "sunset market rain-alley"],
  [at(2026, 10, 25, 23, 0), "halloween", "halloween"],
  [at(2026, 10, 31, 3, 59), "halloween", "halloween"],
  [at(2026, 10, 24, 23, 0), "night", NIGHT_AUTUMN],
  [at(2026, 10, 28, 22, 59), "evening", EVENING],
  [at(2026, 10, 28, 17, 30), "home", "home"],
  [at(2026, 4, 1, 4, 0), "cherry", "spring-cherry"],
  [at(2026, 4, 14, 16, 59, 59), "cherry", "spring-cherry"],
  [at(2026, 4, 14, 17, 0), "home", "home"],
  [at(2026, 4, 11, 17, 0), "dusk", "sunset market rain-alley"],
  [at(2026, 4, 15, 10, 0), "day", "market temple desert cloud-path*0.5 candy*0.5"],
  [at(2026, 4, 5, 3, 59), "night", "starry-hill sunset crystal-cave neon-street space*0.5 underwater*0.5"],
];
const wrong = [];
for (const [when, slot, list] of CASES) {
  const p = plan(when);
  const got = listText(p.list);
  if (p.slot !== slot || got !== list) wrong.push(`${label(when)} → ${p.slot} [${got}] (기대 ${slot} [${list}])`);
}
ok(`시각·요일·날짜별 묶음·행사 ${CASES.length}건`, !wrong.length, wrong.join(" | ") || `예: ${label(CASES[0][0])} ${CASES[0][1]}`);

{
  const marks = [[at(2026, 11, 24, 16, 59, 59), false], [at(2026, 11, 24, 17, 0, 0), true], [at(2026, 11, 24, 18, 59, 59), true], [at(2026, 11, 24, 19, 0, 0), true], [at(2026, 11, 24, 19, 0, 59), true], [at(2026, 11, 24, 19, 1, 0), false], [at(2026, 11, 28, 17, 0, 0), false], [at(2026, 11, 29, 19, 0, 30), false]];
  const seen = [];
  let right = true;
  for (const [when, home] of marks) {
    const runs = [];
    for (let i = 0; i < 40; i++) runs.push((await pick(when)).variant);
    const always = runs.every((v) => v === "home");
    if (always !== home) right = false;
    seen.push(`${label(when)} ${always ? "집 복도 고정" : `고정 아님(${[...new Set(runs)].join(",")})`}`);
  }
  ok("평일 17:00·18:59·19:00·19:00:59 = 집 복도, 16:59·19:01 = 아님, 주말 17:00·19:00 = 고정 아님", right, seen.join(" · "));
}

{
  const all = new Set();
  for (const [when] of CASES) for (const [id] of plan(when).list) all.add(id);
  const scenes = fs.readFileSync(path.join(dir, "splash.js"), "utf8").match(/const SCENES = \{([\s\S]*?)\n  \};/)[1];
  const sceneIds = [...scenes.matchAll(/^\s*"?([\w-]+)"?: \[/gm)].map((m) => m[1]);
  const css = fs.readFileSync(path.join(dir, "splash.css"), "utf8");
  const missing = [];
  for (const id of all) {
    if (!fs.existsSync(path.join(dir, `${id}.png`))) missing.push(`${id}.png`);
    if (!BASE.includes(id) && !sceneIds.includes(id)) missing.push(`SCENES.${id}`);
    if (!BASE.includes(id) && !new RegExp(`--sp-${id}-marks: #`).test(css)) missing.push(`--sp-${id}-marks`);
  }
  const extra = sceneIds.filter((id) => !all.has(id));
  ok("배경 29장 모두 어떤 묶음에 들고, 그림·SCENES·표식 색이 짝을 이룸", all.size === 29 && !missing.length && !extra.length && sceneIds.length === 26, `배경 ${all.size} · SCENES ${sceneIds.length} · 빠짐 ${missing.join(",") || "없음"} · 남음 ${extra.join(",") || "없음"}`);
  const bad = [];
  let bytes = 0;
  for (const id of all) {
    const png = fs.readFileSync(path.join(dir, `${id}.png`));
    bytes += png.length;
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    if (png[25] !== 3) bad.push(`${id} 색 형식 ${png[25]}`);
    if (!BASE.includes(id) && (w !== 416 || h !== 416)) bad.push(`${id} ${w}x${h}`);
  }
  ok("배경 그림 = 팔레트 PNG(새 26장 416×416)", !bad.length, `합계 ${bytes}바이트${bad.length ? ` · ${bad.join(",")}` : ""}`);
}

{
  const p = plan(at(2026, 11, 24, 10, 0), {});
  env.phone = false;
  const off = plan(at(2026, 11, 24, 10, 0));
  env.phone = true;
  ok("휴대폰이 아니면 고르지 않음(계획 없음)", p && !off);
}

async function shares(when, runs) {
  const count = new Map();
  for (let i = 0; i < runs; i++) {
    const { variant } = await pick(when);
    count.set(variant, (count.get(variant) || 0) + 1);
  }
  return count;
}
for (const [when, name] of [[at(2026, 11, 24, 6, 0), "새벽(가을)"], [at(2026, 11, 24, 12, 0), "낮(가을)"], [at(2026, 11, 24, 1, 0), "밤(가을)"], [at(2026, 6, 10, 12, 0), "낮(6월)"]]) {
  const runs = 20000;
  const list = plan(when).list;
  const total = list.reduce((sum, [, w]) => sum + w, 0);
  const count = await shares(when, runs);
  let worst = 0;
  const text = list.map(([id, w]) => {
    const got = (count.get(id) || 0) / runs;
    worst = Math.max(worst, Math.abs(got - w / total));
    return `${id} ${(got * 100).toFixed(1)}%/${((w / total) * 100).toFixed(1)}%`;
  });
  ok(`무게 분포 ${name} ${runs}회(계절 2·가끔 0.5·나머지 1, 차이 1.5%p 이하)`, worst < 0.015 && [...count.keys()].every((id) => list.some(([one]) => one === id)), text.join(" · "));
}

{
  const when = at(2026, 11, 24, 12, 0);
  const count = new Map();
  for (let i = 0; i < 2000; i++) {
    const { variant } = await pick(when, { recent: ["market", "temple", "desert"] });
    count.set(variant, (count.get(variant) || 0) + 1);
  }
  ok("최근 3개 빼기: 낮 5개 묶음에서 최근 market·temple·desert 는 나오지 않음", [...count.keys()].every((id) => ["cloud-path", "candy"].includes(id)) && count.size === 2, [...count].map(([id, n]) => `${id} ${n}`).join(" · "));
}

for (const [when, name, depth] of [[at(2026, 11, 24, 12, 0), "낮 5개", 3], [at(2026, 11, 24, 1, 0), "밤 6개", 3], [at(2026, 11, 28, 20, 0), "주말 저녁 6개", 3], [at(2026, 11, 24, 6, 0), "새벽 3개", 1], [at(2026, 11, 28, 17, 30), "주말 17시 3개", 1]]) {
  env.store = new Map();
  const seq = [];
  let broken = 0;
  for (let i = 0; i < 3000; i++) {
    const { variant, recent } = await pick(when, { keep: true });
    if (seq.slice(-depth).includes(variant)) broken++;
    if (recent.at(-1) !== variant || recent.length > 3 || new Set(recent).size !== recent.length) broken++;
    seq.push(variant);
  }
  ok(`연속 3000회 ${name}: 직전 ${depth}개와 겹치지 않음, 기록 = 최근 3개(중복 없음)`, !broken, `어긋남 ${broken} · 앞 12개 ${seq.slice(0, 12).join(",")}`);
}

{
  const runs = [];
  for (let i = 0; i < 50; i++) runs.push((await pick(at(2026, 11, 24, 17, 30), { recent: ["home"] })).variant);
  const event = [];
  for (let i = 0; i < 50; i++) event.push((await pick(at(2026, 12, 20, 21, 0), { recent: ["library", "train", "christmas"] })).variant);
  ok("후보 1개(집 복도 고정·행사)는 직전과 같아도 그대로", runs.every((v) => v === "home") && event.every((v) => v === "christmas"));
}

{
  env.sw = "idle";
  const rows = [];
  let right = true;
  for (const [when, want] of [[at(2026, 11, 24, 12, 0), "meadow"], [at(2026, 11, 24, 1, 0), "sunset"], [at(2026, 11, 24, 6, 0), "meadow"], [at(2026, 11, 24, 21, 0), "meadow"], [at(2026, 11, 28, 21, 0), "home"], [at(2026, 11, 28, 17, 30), "sunset"], [at(2026, 12, 20, 21, 0), "meadow"]]) {
    const got = new Set();
    const loadedNew = [];
    for (let i = 0; i < 60; i++) {
      const { variant } = await pick(when);
      got.add(variant);
      loadedNew.push(...env.decoded.filter((url) => !/\/(cat|text|meadow|home|sunset)\.png$/.test(url)));
    }
    if (got.size !== 1 || !got.has(want) || loadedNew.length) right = false;
    rows.push(`${label(when)} ${[...got].join(",")}`);
  }
  ok("서비스 워커가 아직 맡지 않은 첫 접속(캐시 없음): 새 배경은 받지 않고 묶음 안 기존 배경(없으면 코드로 그리는 초원)", right, rows.join(" · "));
  const night = new Set();
  for (let i = 0; i < 60; i++) night.add((await pick(at(2026, 11, 24, 1, 0), { recent: ["starry-hill", "crystal-cave", "sunset"] })).variant);
  ok("다시 고를 때 최근 빼기로 남는 것이 없으면 묶음 전체에서 있는 것(밤 sunset 이 최근이어도 sunset)", night.size === 1 && night.has("sunset"), [...night].join(","));
  env.sw = "on";
  env.broken = new Set(["/splash/temple.png"]);
  env.random = () => 0.3;
  const failed = await pick(at(2026, 11, 24, 12, 0));
  env.random = Math.random;
  env.broken = new Set();
  ok("고른 새 배경을 풀지 못하면 초원으로(기록도 초원)", failed.variant === "meadow" && failed.recent.at(-1) === "meadow", `${failed.variant} · 기록 ${failed.recent}`);
  env.sw = null;
  const open = new Set();
  for (let i = 0; i < 200; i++) open.add((await pick(at(2026, 11, 24, 12, 0))).variant);
  env.sw = "on";
  ok("서비스 워커가 없는 화면(보안 문맥 아님 — LAN 테스트 빌드)은 새 배경도 그대로 받음", open.size >= 4 && !open.has("meadow"), [...open].join(","));
}

{
  env.random = () => 0;
  const base = plan(at(2026, 11, 24, 6, 0));
  const fresh = plan(at(2026, 11, 24, 12, 0));
  env.sw = "idle";
  const idle = plan(at(2026, 11, 24, 12, 0));
  env.sw = "on";
  env.random = Math.random;
  const want = base.variant === "meadow" && fresh.variant === null && (await fresh.ready)[0] === "market" && idle.variant === "meadow";
  ok("고르기는 기다림 없이 바로 정해짐(기존 배경은 지금처럼 plan.variant, 새 배경은 그림을 푼 뒤 ready)", want, `새벽 ${base.variant} · 낮 ${fresh.variant}→${(await fresh.ready)[0]} · 첫 접속 낮 ${idle.variant}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
