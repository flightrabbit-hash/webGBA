// webGBA exe 자체 업데이트 발행·확인(node, 롬 없음, 실제 R2 안 씀). 버전 조회에 --webgba-version 이 되는 exe 가 필요(시험 식별자 빌드).
//   node tools/test/app-feed.mjs <시험 exe> [--old-core <0.8.1 의 src-bundle/src/js/core/wgba-update.js>]
// 1) 경로 규칙 2) app 발행(시험 식별자 거부·--dry-run·낮은 버전·같은 버전 다른 파일 거부) 3) 게임 + 앱 목록 → 새 클라이언트(목록 1번으로 게임·앱) ·
// 옛 클라이언트(0.8.1)도 같은 목록의 게임 확인 그대로 4) 앱 항목 변조 → 앱 버전 파일 대체, 서명 틀림 → 실패, 목록에 앱 없음 → 추가 요청 없음 ·
// 5) 바뀐 파일만·받은 파일 손상 6) verify·upload --dry-run 순서(파일 → latest.json → index.json).
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { publicOf, signText } from "../lib/update-cmds.mjs";
import { APP_ID, appPathOk, appSource, fetchAppFile, indexedApp, loadApp, planApp, verifyApp } from "../../src-bundle/src/js/core/app-update.js";
import { checkGames, indexedFeed, verifyIndex } from "../../src-bundle/src/js/core/wgba-update.js";
import { deflate } from "../../src-bundle/src/js/vendor/pako.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const args = process.argv.slice(2);
const exe = args[0];
const oldCore = args.includes("--old-core") ? args[args.indexOf("--old-core") + 1] : null;
if (!exe) {
  console.error("사용법: node tools/test/app-feed.mjs <시험 exe> [--old-core <0.8.1 wgba-update.js>]");
  process.exit(2);
}
const results = [];
const ok = (pass, name, detail = "") => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "webgba-appfeed-"));
const tool = (...a) => spawnSync(process.execPath, [path.join(repo, "tools", "wgba.mjs"), ...a], { encoding: "utf8" });

try {
  /* 1) 경로 규칙 */
  const good = ["webgba.exe", "LICENSE", "THIRD_PARTY_NOTICES", "tools/x-1.dll"];
  const bad = ["", "bin/ini/setting.ini", "BIN/core/x", "../x", "a/../b", "./a", "a/", "/a", "a\\b", "C:/x", ".webgba-update/x", "x.old", "a./b", ".hidden", "a b"];
  ok(good.every(appPathOk) && !bad.some(appPathOk), "경로 규칙: 앱 파일만 · bin/(설정·퀵슬롯)·상위·절대·.old 거부");

  /* 2) 발행 */
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const keyFile = path.join(tmp, "k.pem");
  fs.writeFileSync(keyFile, privateKey.export({ format: "pem", type: "pkcs8" }));
  const pub = publicOf(privateKey);
  const bundle = path.join(tmp, "bundle");
  const appDir = path.join(bundle, APP_ID);
  const refused = tool("app", "--dir", appDir, "--key", keyFile, "--exe", exe, "--no-index");
  ok(refused.status !== 0 && /시험 식별자/.test(refused.stderr), "시험 식별자 exe 는 --test-id 없이 거부");
  const dry = tool("app", "--dir", appDir, "--key", keyFile, "--exe", exe, "--test-id", "--no-index", "--dry-run");
  ok(dry.status === 0 && !fs.existsSync(appDir), "--dry-run: 서명 확인까지 하고 아무것도 쓰지 않음", dry.stdout.trim().split("\n").pop());
  const pubd = tool("app", "--dir", appDir, "--key", keyFile, "--exe", exe, "--test-id", "--no-index", "--time", "2026-11-10T00:00:00Z");
  const envelope = JSON.parse(fs.readFileSync(path.join(appDir, "latest.json"), "utf8"));
  const app = await verifyApp(JSON.stringify(envelope), pub, `https://feed.invalid/${APP_ID}/latest.json`);
  const version = app.version;
  ok(pubd.status === 0 && envelope.wgbaApp === 1 && app.files.map((f) => f.path).join(",") === "webgba.exe,LICENSE,THIRD_PARTY_NOTICES" && app.platform === "windows-x64", `발행: exe 버전 ${version} · 파일 3개(exe·LICENSE·THIRD_PARTY_NOTICES) · windows-x64`, app.files.map((f) => `${f.path} ${f.size}→${f.get.size}`).join(", "));
  const same = tool("app", "--dir", appDir, "--key", keyFile, "--exe", exe, "--test-id", "--no-index", "--file", path.join(repo, "README.md"));
  ok(same.status !== 0 && /같은 버전/.test(same.stderr), "같은 버전인데 파일이 다르면 거부");
  const higher = JSON.stringify({ ...JSON.parse(envelope.signed), version: "99.0.0" });
  const prev = path.join(tmp, "prev");
  fs.mkdirSync(path.join(prev, APP_ID), { recursive: true });
  fs.writeFileSync(path.join(prev, APP_ID, "latest.json"), JSON.stringify({ wgbaApp: 1, signed: higher, signature: signText(higher, privateKey) }));
  const lower = tool("app", "--dir", path.join(prev, APP_ID), "--key", keyFile, "--exe", exe, "--test-id", "--no-index");
  ok(lower.status !== 0 && /낮습니다/.test(lower.stderr), "이전 발행보다 낮은 버전 거부");

  /* 3) 게임 + 앱 목록 */
  const gameId = "com.flightrabbit.rapid";
  const gameSigned = JSON.stringify({ id: gameId, version: "1.0.0", time: "2026-11-10T00:00:00Z", wgba: { sha1: "a".repeat(40), size: 10 }, from: [] });
  fs.mkdirSync(path.join(bundle, gameId), { recursive: true });
  fs.writeFileSync(path.join(bundle, gameId, "latest.json"), JSON.stringify({ wgbaFeed: 1, signed: gameSigned, signature: signText(gameSigned, privateKey) }));
  const idx = tool("index", "--root", bundle, "--key", keyFile, "--time", "2026-11-10T00:00:00Z");
  const indexText = fs.readFileSync(path.join(bundle, "index.json"), "utf8");
  const indexJson = JSON.parse(indexText);
  ok(idx.status === 0 && indexJson.feeds[gameId] && indexJson.apps?.[APP_ID] && JSON.parse(indexJson.signed).apps?.[APP_ID], "index: feeds 에 게임 · apps 에 webGBA(서명 글에 해시)", idx.stdout.trim().split("\n").pop());

  const BASE = "http://127.0.0.1:1/";
  const files = new Map([["index.json", indexText], [`${APP_ID}/latest.json`, fs.readFileSync(path.join(appDir, "latest.json"), "utf8")], [`${gameId}/latest.json`, fs.readFileSync(path.join(bundle, gameId, "latest.json"), "utf8")]]);
  const served = [];
  const fakeFetch = (table) => async (url) => {
    const key = url.replace(BASE, "");
    served.push(key);
    if (!table.has(key)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const body = Buffer.from(table.get(key));
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  };
  const overrides = { index: { url: `${BASE}index.json`, key: pub }, feeds: {} };
  const memory = { get: () => 0, set: () => {} };
  const run = async (table) => {
    served.length = 0;
    const cache = new Map();
    const source = appSource(overrides);
    const got = await loadApp(source, { fetchImpl: fakeFetch(table), cache, memory }).catch((error) => ({ app: null, error, thrown: true }));
    return { got, cache, count: [...served] };
  };
  const first = await run(files);
  ok(first.got.app?.version === version && first.count.join(",") === "index.json", "새 클라이언트: 목록 1번으로 webGBA 항목", first.count.join(","));
  const knownGames = await checkGames([{ gameId, version: "0.9.0", update: null }], { overrides, fetchImpl: fakeFetch(files), cache: first.cache, memory });
  ok(knownGames.length === 1 && knownGames[0].feed.version === "1.0.0" && served.join(",") === "index.json", "같은 실행의 알려진 게임 확인 = 같은 목록 사용(요청 합계 1번)", served.join(","));
  const list = await verifyIndex(indexText, pub, { memory });
  const viaIndex = await indexedFeed(list, gameId, { key: pub, feed: `${BASE}${gameId}/latest.json` });
  served.length = 0;
  ok(viaIndex.version === "1.0.0" && (await indexedApp(list, { key: pub, feed: `${BASE}${APP_ID}/latest.json` })).version === version, "같은 목록에서 게임 봉투·앱 봉투 모두 확인");
  if (oldCore) {
    const old = await import(pathToFileURL(path.resolve(oldCore)).href);
    const oldList = await old.verifyIndex(indexText, pub, { memory });
    const oldFeed = await old.indexedFeed(oldList, gameId, { key: pub, feed: `${BASE}${gameId}/latest.json` });
    ok(oldFeed.version === "1.0.0", "옛 클라이언트(0.8.1): apps 가 든 목록에서 게임 확인 그대로");
  } else console.log("건너뜀 옛 클라이언트(--old-core 없음)");

  /* 4) 변조·없음 */
  const tampered = JSON.parse(indexText);
  tampered.apps[APP_ID].signed = tampered.apps[APP_ID].signed.replace(`"version":"${version}"`, '"version":"9.9.9"');
  const t1 = await run(new Map([...files, ["index.json", JSON.stringify(tampered)]]));
  ok(t1.got.app?.version === version && t1.got.error?.code === "indexBad" && t1.count.join(",") === `index.json,${APP_ID}/latest.json`, "목록의 앱 항목 해시 다름 → 앱 버전 파일로 대체(요청 +1)", t1.count.join(","));
  const badLatest = JSON.parse(files.get(`${APP_ID}/latest.json`));
  badLatest.signed = badLatest.signed.replace(`"version":"${version}"`, '"version":"9.9.9"');
  const t2 = await run(new Map([...files, ["index.json", JSON.stringify(tampered)], [`${APP_ID}/latest.json`, JSON.stringify(badLatest)]]));
  ok(t2.got.thrown && t2.got.error?.code === "feedSignature", "앱 버전 파일 서명 틀림 → 실패(업데이트 없음)", t2.got.error?.code);
  const noApps = JSON.parse(indexText);
  delete noApps.apps;
  const t3 = await run(new Map([...files, ["index.json", JSON.stringify(noApps)]]));
  ok(!t3.got.app && !t3.got.error && t3.count.join(",") === "index.json", "목록에 앱 항목 없음(발행 전) → 추가 요청 없음", t3.count.join(","));

  /* 5) 바뀐 파일만 · 손상 */
  const exeFile = app.files.find((f) => f.path === "webgba.exe");
  const plan = planApp(app, { "webgba.exe": "0".repeat(64), LICENSE: app.files[1].sha256, THIRD_PARTY_NOTICES: app.files[2].sha256 });
  ok(plan.files.length === 1 && plan.files[0].path === "webgba.exe" && plan.size === exeFile.get.size, "로컬과 다른 파일만 받기(exe 1개)");
  const blob = fs.readFileSync(path.join(appDir, ...exeFile.get.url.replace(`https://feed.invalid/${APP_ID}/`, "").split("/")));
  const fileFetch = (body) => async () => ({ ok: true, status: 200, body: null, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) });
  const fine = await fetchAppFile(exeFile, { fetchImpl: fileFetch(blob) });
  ok(sha256(fine) === sha256(fs.readFileSync(exe)), "받은 파일 풀기 → exe 와 같은 SHA-256");
  const wrongInner = Buffer.from(deflate(Buffer.from("not the exe"), { level: 9 }));
  const fakeRef = { ...exeFile, get: { ...exeFile.get, size: wrongInner.length, sha256: sha256(wrongInner) } };
  const e1 = await fetchAppFile(fakeRef, { fetchImpl: fileFetch(wrongInner) }).catch((e) => e);
  const flipped = Buffer.from(blob);
  flipped[flipped.length >> 1] ^= 0xff;
  const e2 = await fetchAppFile(exeFile, { fetchImpl: fileFetch(flipped) }).catch((e) => e);
  ok(e1?.code === "appFile" && e2?.code === "downloadHash", "푼 파일 SHA-256 다름 → appFile · 받은 파일 손상 → downloadHash", `${e1?.code} ${e2?.code}`);

  /* 6) verify · upload --dry-run */
  const v = tool("verify", bundle, "--pub", pub);
  ok(v.status === 0 && /통과$/.test(v.stdout.trim()), "verify 묶음: 목록 서명 · 게임 · 앱(압축·푼 파일 SHA-256) 통과");
  const up = tool("upload", bundle, "--dry-run");
  const keys = up.stdout.split("\n").filter((l) => l.startsWith("올릴 것 ")).map((l) => l.split(" ")[2]);
  const at = (k) => keys.findIndex((x) => x === k);
  ok(up.status === 0 && keys.length === 6 && keys.filter((k) => k.includes("/files/")).every((k) => at(k) < at(`${APP_ID}/latest.json`)) && keys[keys.length - 1] === "index.json", "upload --dry-run: 앱 파일 → latest.json → index.json 마지막", keys.join(" "));
  fs.writeFileSync(path.join(appDir, ...exeFile.get.url.replace(`https://feed.invalid/${APP_ID}/`, "").split("/")), flipped);
  const vb = tool("verify", bundle, "--pub", pub);
  ok(vb.status !== 0, "verify: 앱 압축 파일 손상 → 실패");
} catch (error) {
  ok(false, "시험 진행", String(error?.stack ?? error));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `실패 ${failed.length}/${results.length}` : `모두 통과 ${results.length}`);
process.exitCode = failed.length ? 1 : 0;
