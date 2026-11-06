// 업데이트 목록(index.json)·바로 가는 패치 시험 — node 만, 롬 없이(임의 바이트 "rom" 조각). 흉내 R2(update-server.mjs)를 띄우고 끝나면 닫는다.
//   node tools/test/feed-index.mjs [--old-core <0.8.0 의 src-bundle/src/js/core/wgba-update.js>] [--real <발행 폴더 묶음>]
// 1) 발행 도구: feed --old(바로 가는 패치·건너뛰는 줄 빼기·전체 설치 이어받기) · index · feed 가 목록 다시 만들기 · verify(묶음·게임) · upload --dry-run(목록 마지막, 어긋난 목록 거부)
// 2) 새 클라이언트: 목록 1번으로 판정 · 목록 없음/서명 실패/오래된 목록/게임 빠짐 → 게임별 대체 · 서버에 닿지 않으면 대체 없이 기록 1줄 · 바로 가는 패치 1번
// 3) 옛 클라이언트(--old-core, 0.8.0 동작): 같은 발행 묶음에서 게임별 latest.json 으로 정상 · 바로 가는 패치 1번
// 4) --real: 실제 발행 묶음(실제 공개 키)을 실제 주소 그대로 흉내 받기로 앱 실행 1회 요청 수 전후(옛 = 게임 수, 새 = 1)
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { checkGames, FEED_INDEX, KNOWN_FEEDS, planUpdate, readOverrides, runSteps } from "../../src-bundle/src/js/core/wgba-update.js";
import { buildIndex, feed, publicOf, signText, upload, verify } from "../lib/update-cmds.mjs";
import { makeDelta } from "../lib/wgbd-make.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) opt[argv[i].replace(/^--/, "")] = argv[++i];

let failed = 0;
const ok = (cond, text, detail = "") => {
  console.log(`${cond ? "통과" : "실패"} ${text}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const quiet = async (work) => {
  const keep = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    return { value: await work(), lines };
  } catch (error) {
    return { error, lines };
  } finally {
    console.log = keep;
  }
};

const u = (n) => {
  const o = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    o.push(b);
  } while (n);
  return o;
};
const str = (t) => [...u(t.length), ...Buffer.from(t)];
const sec = (id, body) => [id, ...u(body.length), ...body];
const vec = (items) => [...u(items.length), ...items.flat()];
function gameWasm(payload) {
  const types = sec(1, vec([[0x60, 0, 1, 0x7f], [0x60, 1, 0x7f, 1, 0x7f]]));
  const funcs = sec(3, vec([[0], [1], [0]]));
  const mem = sec(5, vec([[0x00, 3]]));
  const exps = sec(7, vec([[...str("memory"), 2, 0], [...str("Web_Init"), 0, 0], [...str("Web_RunFrame"), 0, 1], [...str("Web_GetFramebuffer"), 0, 2]]));
  const code = sec(10, vec([[...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 0, 0x0b]]));
  const blob = sec(0, [...str("x.blob"), ...payload]);
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...funcs, ...mem, ...exps, ...code, ...blob]);
}
const rnd = (n) => new Uint8Array(crypto.randomBytes(n));
const manifest = (id, version) => ({ wgba: 1, id, version, name: "Index Test", runtime: "webapi", input: { preset: "gba" } });

const MAIN = "com.flightrabbit.rapid";
const SIDE = ["local.atetris", "local.kof98"];
const work = fs.mkdtempSync(path.join(os.tmpdir(), "webgba-feed-index-"));
const children = [];
try {
  /* ── 시험 파일: MAIN 1.0.0 → 1.1.0(code) → 1.2.0(롬) → 1.3.0(code), SIDE 는 1.0.0 하나씩 ── */
  const payload = [rnd(150 * 1024)];
  const rom = [rnd(384 * 1024)];
  rom[0][0xb2] = 0x96;
  payload[1] = payload[0].slice();
  payload[1].set(rnd(600), 40000);
  rom[1] = rom[0].slice();
  rom[1].set(rnd(800), 200000);
  payload[2] = payload[1].slice();
  payload[2].set(rnd(500), 90000);
  const versions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"];
  const parts = [
    [payload[0], rom[0]],
    [payload[1], rom[0]],
    [payload[1], rom[1]],
    [payload[2], rom[1]],
  ];
  const v = [];
  for (const [i, version] of versions.entries()) {
    const bytes = (await packWgba({ wasm: gameWasm(parts[i][0]), manifest: manifest(MAIN, version), rom: parts[i][1] })).bytes;
    v.push(path.join(work, `main_${version}.wgba`));
    fs.writeFileSync(v[i], bytes);
  }
  const side = [];
  for (const id of SIDE) {
    const file = path.join(work, `${id}.wgba`);
    fs.writeFileSync(file, (await packWgba({ wasm: gameWasm(rnd(4096)), manifest: manifest(id, "1.0.0"), rom: rnd(1024) })).bytes);
    side.push(file);
  }
  const shaOf = (file) => sha1(fs.readFileSync(file));
  const sha = v.map(shaOf);
  const orig = path.join(work, "orig.bin");
  fs.writeFileSync(orig, rnd(64 * 1024));

  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const keyFile = path.join(work, "test.pem");
  fs.writeFileSync(keyFile, privateKey.export({ format: "pem", type: "pkcs8" }));
  const pub = publicOf(privateKey);

  /* ── 1) 발행 도구 ── */
  const root = path.join(work, "pub");
  const dirOf = (id) => path.join(root, id);
  const patch = async (a, b) => {
    const file = path.join(work, `${path.basename(a)}-${path.basename(b)}.wgbd`);
    fs.writeFileSync(file, (await makeDelta(fs.readFileSync(a), fs.readFileSync(b))).bytes);
    return file;
  };
  const fromOf = (id) => JSON.parse(JSON.parse(fs.readFileSync(path.join(dirOf(id), "latest.json"), "utf8")).signed);
  const fullFile = path.join(work, "full.bin");
  fs.writeFileSync(fullFile, rnd(100));
  await quiet(async () => feed({ dir: dirOf(MAIN), key: keyFile, wgba: v[1], patches: [] }));
  const s1 = await quiet(async () => feed({ dir: dirOf(MAIN), key: keyFile, wgba: v[1], patches: [], olds: [v[0]] }));
  ok(s1.error && /--orig/.test(s1.error.message), "--old 인데 새 파일에 롬이 있고 --orig 가 없으면 거절", s1.error?.message);
  await quiet(async () => feed({ dir: dirOf(MAIN), key: keyFile, wgba: v[1], patches: [await patch(v[0], v[1])] }));
  const r2 = await quiet(async () => feed({ dir: dirOf(MAIN), key: keyFile, wgba: v[2], patches: [await patch(v[1], v[2])], olds: [v[0]], origs: [orig] }));
  ok(!r2.error, "feed 1.2.0 + --old 1.0.0", r2.error?.message ?? r2.lines.filter((l) => /바로 가는/.test(l)).join(" | "));
  const f2 = fromOf(MAIN);
  ok(f2.from.length === 3 && f2.from.some((item) => item.sha1 === sha[0] && item.to === sha[2]), "1.2.0 from = 단계 2줄 + 1.0.0 → 1.2.0 바로 가는 줄", f2.from.map((item) => `${item.version}→${item.to.slice(0, 6)}`).join(" "));
  const r3 = await quiet(async () => feed({ dir: dirOf(MAIN), key: keyFile, wgba: v[3], patches: [await patch(v[2], v[3])], olds: [work], origs: [orig] }));
  const f3 = fromOf(MAIN);
  const pairs = f3.from.map((item) => `${item.version}→${versions[sha.indexOf(item.to)]}`).sort();
  ok(!r3.error && pairs.join(",") === "1.0.0→1.1.0,1.0.0→1.3.0,1.1.0→1.2.0,1.1.0→1.3.0,1.2.0→1.3.0", "1.3.0 + --old 폴더: 단계 줄 유지 · 옛 버전마다 바로 가는 줄 · 이전 바로 가는 줄(1.0.0 → 1.2.0) 뺌 · 다른 게임·같은 파일 건너뜀", `${pairs.join(" ")} ${r3.error?.message ?? ""}`);
  ok(r3.lines.some((l) => /건너뜀 local\.atetris\.wgba: 다른 게임/.test(l)) && r3.lines.some((l) => /건너뜀 main_1\.3\.0\.wgba: 새 버전과 같은 파일/.test(l)) && r3.lines.some((l) => /있음 {2}1\.2\.0 → 1\.3\.0/.test(l)), "폴더 안 다른 게임·새 버전 파일·이미 있는 쌍 알림");
  for (const [i, at] of sha.slice(0, 3).entries()) {
    const plan = planUpdate({ ...fromOf(MAIN), full: null }, at);
    ok(plan.kind === "patch" && plan.steps.length === 1, `${versions[i]} → 1.3.0 = 패치 1번`, `${plan.kind} ${plan.steps.length}단계`);
  }
  // 같은 .wgba 로 다시 feed(바로 가는 패치만 더할 때) → 전체 설치·글 이어받기
  const fullDir = path.join(work, "full-case");
  fs.mkdirSync(path.join(fullDir, "full"), { recursive: true });
  fs.writeFileSync(path.join(fullDir, "full", "x.wgbp"), fs.readFileSync(fullFile));
  const fullRef = { url: "full/x.wgbp", size: 100, sha256: crypto.createHash("sha256").update(fs.readFileSync(fullFile)).digest("hex") };
  const seed = JSON.stringify({ id: MAIN, version: "1.3.0", time: "2026-01-01T00:00:00Z", wgba: { sha1: sha[3], size: fs.statSync(v[3]).size }, from: f3.from, full: fullRef, notes: { ko: "글" } });
  fs.writeFileSync(path.join(fullDir, "latest.json"), JSON.stringify({ wgbaFeed: 1, signed: seed, signature: signText(seed, privateKey) }));
  for (const item of f3.from) fs.cpSync(path.join(dirOf(MAIN), item.patch.url), path.join(fullDir, item.patch.url), { recursive: true });
  await quiet(async () => feed({ dir: fullDir, key: keyFile, wgba: v[3], olds: [v[0]], origs: [orig] }));
  const again = JSON.parse(JSON.parse(fs.readFileSync(path.join(fullDir, "latest.json"), "utf8")).signed);
  ok(again.full?.url === "full/x.wgbp" && again.notes?.ko === "글", "같은 .wgba 로 다시 feed → 전체 설치·글 이어받음", JSON.stringify({ full: again.full?.url, notes: again.notes }));

  for (const [i, id] of SIDE.entries()) await quiet(async () => feed({ dir: dirOf(id), key: keyFile, wgba: side[i] }));
  const ix = await quiet(async () => buildIndex(root, privateKey));
  const index = JSON.parse(fs.readFileSync(path.join(root, "index.json"), "utf8"));
  ok(!ix.error && index.wgbaIndex === 1 && Object.keys(index.feeds).sort().join() === [MAIN, ...SIDE].sort().join(), "index: 게임 3개 봉투 그대로 + 서명", ix.error?.message ?? ix.lines.join(" | "));
  ok(index.feeds[MAIN].signed === JSON.parse(fs.readFileSync(path.join(dirOf(MAIN), "latest.json"), "utf8")).signed, "목록 안 봉투 = latest.json 봉투(서명 글 바이트 그대로)");
  ok((await quiet(async () => verify(root, { pub }))).value === 0, "verify 묶음 → 통과");
  ok((await quiet(async () => verify(dirOf(MAIN), { pub }))).value === 0, "verify 게임 폴더(목록 줄도 확인) → 통과");
  const dry = await quiet(async () => upload(root, { dryRun: true }));
  ok(!dry.error && dry.lines.filter((l) => l.startsWith("올릴 것")).at(-1)?.includes("올릴 것 index.json") && dry.lines.filter((l) => /latest\.json/.test(l)).length === 3, "upload 묶음 --dry-run: 게임 파일 → latest.json 3개 → index.json 마지막", dry.error?.message ?? `${dry.lines.length}줄`);
  const dryGame = await quiet(async () => upload(dirOf(MAIN), { dryRun: true }));
  ok(!dryGame.error && dryGame.lines.some((l) => l.includes("올릴 것 index.json")) && dryGame.lines.some((l) => l.includes(`${SIDE[0]}/latest.json`)), "upload 게임 폴더(묶음에 목록 있음) → 묶음 전체 + 목록", dryGame.error?.message ?? "");
  // 목록을 다시 만들지 않고 게임만 바꾸면 verify·upload 가 막음, feed 는 목록을 같이 다시 만듦
  const before = index.signed;
  await quiet(async () => feed({ dir: dirOf(SIDE[0]), key: keyFile, wgba: side[0], index: false, time: "2030-01-01T00:00:00Z" }));
  ok((await quiet(async () => verify(root, { pub }))).value === 1, "목록과 다른 latest.json → verify 실패");
  const stale = await quiet(async () => upload(root, { dryRun: true }));
  ok(Boolean(stale.error) && /index/.test(stale.error.message), "목록과 다른 latest.json → upload 거절", stale.error?.message);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await quiet(async () => feed({ dir: dirOf(SIDE[0]), key: keyFile, wgba: side[0] }));
  const index2 = JSON.parse(fs.readFileSync(path.join(root, "index.json"), "utf8"));
  ok(index2.signed !== before && Date.parse(JSON.parse(index2.signed).time) > Date.parse(JSON.parse(before).time) && (await quiet(async () => verify(root, { pub }))).value === 0, "feed 가 묶음의 목록을 다시 만듦(시각 앞으로) → verify 통과");

  /* ── 흉내 R2 모드: ok · noidx · badidx · oldidx · missing ── */
  const bundle = path.join(work, "bundle");
  const mode = (name, edit = null) => {
    fs.cpSync(root, path.join(bundle, name), { recursive: true });
    if (edit) edit(path.join(bundle, name, "index.json"));
  };
  mode("ok");
  mode("noidx", (file) => fs.rmSync(file));
  mode("badidx", (file) => {
    const e = JSON.parse(fs.readFileSync(file, "utf8"));
    e.signed = e.signed.replace(/"time":"[^"]+"/, '"time":"2099-01-01T00:00:00Z"');
    fs.writeFileSync(file, JSON.stringify(e));
  });
  mode("missing", (file) => {
    const e = JSON.parse(fs.readFileSync(file, "utf8"));
    const s = JSON.parse(e.signed);
    delete s.feeds[MAIN];
    delete e.feeds[MAIN];
    e.signed = JSON.stringify(s);
    e.signature = signText(e.signed, privateKey);
    fs.writeFileSync(file, JSON.stringify(e));
  });
  const PORT = 9483;
  const R2 = `http://127.0.0.1:${PORT}`;
  const server = spawn(process.execPath, [path.join(here, "update-server.mjs"), bundle, String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  children.push(server);
  await new Promise((resolve) => server.stdout.once("data", resolve));
  const use = (name) => fetch(`${R2}/__use?mode=${name}`);
  const clear = () => fetch(`${R2}/__clear`);
  const served = async () => {
    const log = await (await fetch(`${R2}/__log`)).json();
    return { index: log.filter((l) => l.path === "/index.json").length, latest: log.filter((l) => l.path.endsWith("/latest.json")).length, patches: log.filter((l) => l.path.includes("/patches/")).length };
  };
  const games = [
    { key: "m", gameId: MAIN, version: "1.0.0" },
    { key: "a", gameId: SIDE[0], version: "1.0.0" },
    { key: "k", gameId: SIDE[1], version: "1.0.0" },
  ];
  const testOverride = { index: { url: `${R2}/index.json`, key: pub } };
  const overrides = readOverrides({ getItem: () => JSON.stringify(testOverride) });
  ok(overrides?.index?.url === `${R2}/index.json` && Object.keys(overrides.feeds).length === 0, "시험 덮어쓰기 index(루프백)");
  const memoryOf = (start = {}) => {
    const seen = { ...start };
    return { get: (url) => seen[url] ?? 0, set: (url, time) => (seen[url] = Math.max(seen[url] ?? 0, time)), seen };
  };

  /* ── 2) 새 클라이언트 ── */
  const run = async (name, { memory = memoryOf(), list = games } = {}) => {
    await use(name);
    await clear();
    const logs = [];
    const found = await checkGames(list, { overrides, memory, log: (level, text) => logs.push(`${level} ${text}`) });
    return { found, logs, count: await served(), memory };
  };
  const a = await run("ok");
  ok(a.count.index === 1 && a.count.latest === 0 && a.found.length === 1 && a.found[0].feed.version === "1.3.0" && a.logs.length === 0, "새 클라이언트: 게임 3개 → 목록 1번(게임별 0번)으로 판정 · 1.0.0 만 새 버전", JSON.stringify({ ...a.count, found: a.found.map((f) => f.game.key), logs: a.logs }));
  const plan = planUpdate(a.found[0].feed, sha[0]);
  await clear();
  const out = await runSteps(new Uint8Array(fs.readFileSync(v[0])), plan, a.found[0].feed);
  const got = await served();
  ok(plan.steps.length === 1 && got.patches === 1 && sha1(out) === sha[3], "바로 가는 패치 1번 받아 1.0.0 → 1.3.0 · SHA-1 일치", `${plan.steps.length}단계 · 패치 요청 ${got.patches}`);
  ok(Object.values(a.memory.seen)[0] === Date.parse(JSON.parse(index2.signed).time), "본 목록 시각을 기억");
  const b = await run("noidx");
  ok(b.count.index === 1 && b.count.latest === 3 && b.found.length === 1 && b.logs.length === 1 && /^INFO/.test(b.logs[0]), "목록 없음(404) → 게임별 latest.json 3번으로 대체 · 기록 1줄", JSON.stringify({ ...b.count, logs: b.logs }));
  const c = await run("badidx");
  ok(c.count.index === 1 && c.count.latest === 3 && c.found.length === 1 && c.logs.length === 1 && /feedSignature/.test(c.logs[0]), "목록 서명 실패 → 게임별 대체", JSON.stringify({ ...c.count, logs: c.logs }));
  const later = memoryOf({ [`${R2}/index.json`]: Date.parse("2099-01-01T00:00:00Z") });
  const d = await run("ok", { memory: later });
  ok(d.count.index === 1 && d.count.latest === 3 && d.found.length === 1 && /indexOld/.test(d.logs[0] ?? ""), "전에 본 것보다 이른 목록(되돌리기) → 게임별 대체", JSON.stringify({ ...d.count, logs: d.logs }));
  const e = await run("missing");
  ok(e.count.index === 1 && e.count.latest === 1 && e.found.length === 1 && /indexMissing/.test(e.logs[0] ?? ""), "목록에 게임이 빠짐 → 그 게임만 게임별", JSON.stringify({ ...e.count, logs: e.logs }));
  await use("ok");
  await clear();
  const offLogs = [];
  const off = await checkGames(games, { overrides: { index: { url: "http://127.0.0.1:9/index.json", key: pub }, feeds: {} }, memory: memoryOf(), log: (level, text) => offLogs.push(`${level} ${text}`), timeout: 3000 });
  ok(off.length === 0 && offLogs.length === 1 && /^WARN/.test(offLogs[0]) && /index\.json/.test(offLogs[0]), "목록 서버에 닿지 않음(오프라인) → 게임별 대체 없이 빈 결과 · 기록 1줄", offLogs.join(" | "));
  const cache = new Map();
  await use("ok");
  await clear();
  await checkGames(games, { overrides, memory: memoryOf(), cache });
  await checkGames(games, { overrides, memory: memoryOf(), cache });
  ok((await served()).index === 1, "같은 cache(앱 실행 1번) 안에서는 목록 1번만");
  await use("ok");
  await clear();
  const elsewhere = "https://feed.example/";
  const mixedFound = await checkGames([...games, { key: "x", gameId: MAIN.replace("com.", "io."), version: "1.0.0", update: { feed: `${elsewhere}${MAIN}/latest.json`, key: pub } }], {
    overrides,
    memory: memoryOf(),
    fetchImpl: (url, options) => fetch(url.replace(elsewhere, `${R2}/`), options),
  });
  const mixed = await served();
  ok(mixed.index === 1 && mixed.latest === 1 && mixedFound.length === 1, "설명서 update 의 다른 주소 게임은 게임별 그대로(목록 1 + 그 게임 1)", JSON.stringify(mixed));

  /* ── 3) 옛 클라이언트(0.8.0) ── */
  if (opt["old-core"]) {
    const old = await import(pathToFileURL(path.resolve(opt["old-core"])).href);
    const oldOverrides = Object.fromEntries([MAIN, ...SIDE].map((id) => [id, { feed: `${R2}/${id}/latest.json`, key: pub }]));
    await use("ok");
    await clear();
    const found = await old.checkGames(games, { overrides: oldOverrides });
    const count = await served();
    ok(count.index === 0 && count.latest === 3 && found.length === 1 && found[0].feed.version === "1.3.0", "옛 클라이언트: 게임별 latest.json 3번(목록 안 봄) · 1.0.0 만 새 버전", JSON.stringify(count));
    const oldPlan = old.planUpdate(found[0].feed, sha[0]);
    await clear();
    const oldOut = await old.runSteps(new Uint8Array(fs.readFileSync(v[0])), oldPlan, found[0].feed);
    ok(oldPlan.steps.length === 1 && (await served()).patches === 1 && sha1(oldOut) === sha[3], "옛 클라이언트도 바로 가는 패치 1번 → 1.3.0 SHA-1 일치", `${oldPlan.steps.length}단계`);
    for (const [i, at] of sha.slice(1, 3).entries()) ok(old.planUpdate(found[0].feed, at).steps.length === 1, `옛 클라이언트 ${versions[i + 1]} → 1.3.0 = 패치 1번`);
  } else console.log("건너뜀 옛 클라이언트(--old-core 없음)");

  /* ── 4) 실제 발행 묶음으로 요청 수 전후 ── */
  if (opt.real) {
    const realRoot = path.resolve(opt.real);
    const host = new URL(FEED_INDEX.url).origin;
    const requests = [];
    const fakeFetch = async (url) => {
      requests.push(url);
      if (!url.startsWith(`${host}/`)) return new Response("no", { status: 404 });
      const file = path.join(realRoot, ...new URL(url).pathname.split("/").filter(Boolean));
      return fs.existsSync(file) ? new Response(fs.readFileSync(file), { status: 200 }) : new Response("no", { status: 404 });
    };
    const ids = Object.keys(KNOWN_FEEDS).filter((id) => fs.existsSync(path.join(realRoot, id, "latest.json")));
    const realGames = ids.map((id) => ({ key: id, gameId: id, version: "0.0.1" }));
    const pick = (n) => realGames.slice(0, n);
    const old = opt["old-core"] ? await import(pathToFileURL(path.resolve(opt["old-core"])).href) : null;
    for (const n of [3, realGames.length]) {
      requests.length = 0;
      const after = await checkGames(pick(n), { fetchImpl: fakeFetch, memory: memoryOf() });
      const newCount = requests.length;
      requests.length = 0;
      const beforeFound = old ? await old.checkGames(pick(n), { fetchImpl: fakeFetch }) : [];
      const oldCount = requests.length;
      const oldKnown = old ? pick(n).filter((game) => old.KNOWN_FEEDS[game.gameId]).length : 0;
      ok(newCount === 1 && after.length === n && (!old || (oldCount === oldKnown && beforeFound.length === oldKnown)), `실제 발행 묶음 · 게임 ${n}개 · 앱 실행 1회 요청 수 옛 ${old ? `${oldCount}번(옛 표에 있는 ${oldKnown}개)` : "?"} → 새 ${newCount}번(목록)`, after.map((f) => `${f.game.gameId} ${f.feed.version}`).join(", "));
    }
  } else console.log("건너뜀 실제 발행 묶음(--real 없음)");
} catch (error) {
  ok(false, "시험 진행", String(error?.stack ?? error));
} finally {
  for (const child of children) child.kill();
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(failed ? `실패 ${failed}개` : "모두 통과");
process.exitCode = failed ? 1 : 0;
