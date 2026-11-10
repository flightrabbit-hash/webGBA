// 온라인 업데이트 배포 명령(wgba.mjs keygen · diff · feed · app · index · verify · upload). 규격 = README 12장.
// app(webGBA exe 자체 업데이트 발행)은 app-cmds.mjs. index · verify · upload 는 묶음의 앱 폴더(com.flightrabbit.webgba)도 함께 다룬다.
//
//   keygen -o <비밀 키.pem> [--force]       ECDSA P-256 열쇠 만들기. 비밀 키는 저장소 밖에만(git 저장소 안이면 거절), 화면에는 공개 키만.
//   diff <옛.wgba> <새.wgba> -o <패치.wgbd> [--orig <원작 롬>]… [--no-expand]
//   feed --dir <발행 폴더> --key <비밀 키.pem> --wgba <새.wgba> [--patch <패치.wgbd>]… [--old <옛.wgba|폴더>]… [--orig <원작 롬>]…
//        [--full <새.wgbp>] [--notes <글.json>] [--prev <이전 latest.json>] [--no-index]
//        발행 폴더 = 버킷의 <게임 id>/ 와 같은 짜임: latest.json · patches/<SHA-256>.wgbd · full/<SHA-256>.wgbp.
//        이전 latest.json(기본 = 발행 폴더 안 것)의 from 표를 이어받아 새 패치를 더하고, 모든 이전 버전이 새 버전까지 이어지는지 확인한다.
//        --old: 옛 버전마다 새 버전으로 바로 가는 패치를 만들어 더한다(원작 롬 검사는 패치마다, 걸리면 그 패치만 뺌).
//        발행 폴더 묶음(위 폴더)에 index.json 이 있으면 목록도 다시 만든다(--no-index 로 끔).
//   index --root <발행 폴더 묶음> --key <비밀 키.pem>   <묶음>/<게임 id>/latest.json 을 모두 담은 서명 목록 <묶음>/index.json
//   verify <발행 폴더|묶음> (--pub <공개 키> | --key <비밀 키.pem>) [--wgba <옛.wgba>]…   서명·파일 크기·SHA-256, 옛 파일마다 끝까지 적용.
//        묶음이면 목록 서명·게임마다 latest.json 과 같은지, 게임 폴더면 목록이 있을 때 그 게임 줄이 latest.json 과 같은지도 본다.
//   upload <발행 폴더|묶음> [--dry-run [--remote]]   R2 에 올리기(patches·full 먼저, latest.json 다음, index.json 마지막). 환경 변수 R2_ACCOUNT_ID ·
//                                            R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET (값은 출력하지 않음)
//        버킷에 같은 내용이 있는 파일은 건너뜀 — 버킷 확인은 목록 조회 1번(ListObjectsV2, Class A). 목록이 실패하면 파일마다 HEAD(Class B).
//        --dry-run 은 버킷에 연결하지 않음, --dry-run --remote 는 목록 1번으로 버킷과 비교만(쓰기 없음).
//   r2-stats [--days <일 수>|--since <ISO 시각> [--until <ISO 시각>]] [--top <줄 수>]   R2 요청 수(GraphQL r2OperationsAdaptiveGroups) —
//        객체·동작·응답 코드별, 날짜별. 환경 변수 CF_API_TOKEN(Account Analytics 읽기) · R2_ACCOUNT_ID · R2_BUCKET(값은 출력하지 않음)
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { loadOrig, makeDelta, manifestOf } from "./wgbd-make.mjs";
import { r2Config, r2Head, r2List, r2Put } from "./r2.mjs";
import { r2Stats } from "./r2-stats.mjs";
import { adminKey, privatePrune, privateUpload } from "./admin-cmds.mjs";
import { appDirs, appIndexPart, appPlan, appPublish, isAppDir, verifyAppDir, APP_BASE } from "./app-cmds.mjs";
import { indexedApp } from "../../src-bundle/src/js/core/app-update.js";
import { applyDelta, FEED_FORMAT, fromBase64, INDEX_FORMAT, INDEX_MAX, indexedFeed, planUpdate, readDeltaHead, romPlace, verifyFeed, verifyIndex } from "../../src-bundle/src/js/core/wgba-update.js";
import { compareVersions, ID_RE, VERSION_RE } from "../../src-bundle/src/js/core/wgba-format.js";
import { readPatch } from "../../src-bundle/src/js/core/wgbp.js";

const n = (v) => v.toLocaleString("en-US");
const sha1 = (bytes) => crypto.createHash("sha1").update(bytes).digest("hex");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const readBytes = (file) => new Uint8Array(fs.readFileSync(file));
const IMMUTABLE = "public, max-age=31536000, immutable";
const FEED_CACHE = "no-cache";

export function writeAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
}

function insideGit(dir) {
  let probe = path.resolve(dir);
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const out = spawnSync("git", ["-C", probe, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : "";
}

export function publicOf(keyObject) {
  const jwk = crypto.createPublicKey(keyObject).export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.of(4), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return raw.toString("base64");
}

export function loadSecret(file) {
  const key = crypto.createPrivateKey(fs.readFileSync(file));
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("비밀 키가 ECDSA P-256 이 아닙니다");
  return key;
}

export function signText(text, secret) {
  return crypto.sign("sha256", Buffer.from(text, "utf8"), { key: secret, dsaEncoding: "ieee-p1363" }).toString("base64");
}

export function keygen(out, { force = false } = {}) {
  const repo = insideGit(path.dirname(path.resolve(out)));
  if (repo) throw new Error(`git 저장소 안에는 비밀 키를 두지 않습니다(${repo}). 저장소 밖 경로를 주세요`);
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, privateKey.export({ format: "pem", type: "pkcs8" }), { flag: force ? "w" : "wx", mode: 0o600 });
  const pub = publicOf(privateKey);
  console.log(`비밀 키를 썼습니다: ${path.basename(out)} (내용은 출력하지 않음 — 잃으면 이 게임의 업데이트를 더 낼 수 없습니다)`);
  console.log(`공개 키(설명서 update.key · webGBA 알려진 게임 표): ${pub}`);
  return 0;
}

export async function diff(oldPath, newPath, out, { origs = [], expand = true } = {}) {
  const oldBytes = readBytes(oldPath);
  const newBytes = readBytes(newPath);
  const [a, b] = [await manifestOf(oldBytes), await manifestOf(newBytes)];
  if (!a.id || a.id !== b.id) throw new Error(`게임 id 가 다릅니다: ${a.id || "(없음)"} → ${b.id || "(없음)"}`);
  if (compareVersions(b.version, a.version) <= 0) throw new Error(`새 버전이 옛 버전보다 높지 않습니다: ${a.version} → ${b.version}`);
  const loaded = origs.map((file) => loadOrig(path.basename(file), readBytes(file)));
  const { bytes, info } = await makeDelta(oldBytes, newBytes, { expand, origs: loaded, log: (line) => console.log(`알림  ${line}`) });
  if (info.orig) {
    for (const hit of info.orig.hits) console.log(`원작 롬 ${hit.name}: 같은 구간 ${hit.count}개 · ${n(hit.bytes)}바이트 (새로 넣는 바이트 ${n(info.orig.literal)}바이트 중 32바이트 이상 구간)`);
    if (info.orig.hits.some((hit) => hit.count)) throw new Error("패치에 원작 롬과 같은 바이트가 들어 있어 쓰지 않았습니다 — 이 버전은 .wgbp(전체 설치)로만 냅니다");
  } else if (await hasRom(newBytes)) console.log("경고  --orig 를 주지 않아 원작 롬 바이트 검사를 하지 않았습니다");
  writeAtomic(out, bytes);
  console.log(`${a.id} ${a.version} → ${b.version} · ${info.mode === "rebuilt" ? "롬 다시 묶기" : "파일 그대로"}${info.expanded ? " · 확장 바탕" : ""}${info.sameRom ? " · 롬 같음" : ""}`);
  console.log(`패치 ${path.basename(out)} ${n(bytes.length)}바이트(BPS ${n(info.bps)}) · SHA-256 ${sha256(bytes)} · 만들기 ${(info.makeMs / 1000).toFixed(1)}초 · 적용 확인 ${info.applyMs}ms`);
  return 0;
}

const hasRom = async (bytes) => Boolean(await romPlace(bytes));

const relOf = (file) => file.split(path.sep).join("/");
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const versionOk = (v) => typeof v === "string" && VERSION_RE.test(v);

/** --old 로 받은 파일·폴더 → .wgba 경로(폴더는 바로 아래 *.wgba, 이름순). */
function oldFiles(list) {
  const out = [];
  for (const entry of list) {
    if (fs.statSync(entry).isDirectory()) {
      for (const name of fs.readdirSync(entry).sort()) if (/\.wgba$/i.test(name)) out.push(path.join(entry, name));
    } else out.push(entry);
  }
  return out;
}

/**
 * 옛 버전 → 새 버전 바로 가는 패치. 같은 쌍이 이미 from 에 있으면 건너뜀. 원작 롬과 같은 구간이 있는 패치는 쓰지 않고 그 옛 버전은
 * 기존 단계 연쇄(있으면)로 남긴다. 결과 { from, made, skipped }.
 */
async function directPatches({ dir, newBytes, meta, files, origs, from }) {
  const newSha1 = sha1(newBytes);
  const loaded = origs.map((file) => loadOrig(path.basename(file), readBytes(file)));
  const seen = new Set([newSha1]);
  const made = [];
  const skipped = [];
  for (const file of files) {
    const label = path.basename(file);
    const bytes = readBytes(file);
    const hash = sha1(bytes);
    if (seen.has(hash)) {
      console.log(`건너뜀 ${label}: ${hash === newSha1 ? "새 버전과 같은 파일" : "앞에서 본 파일과 같음"}`);
      continue;
    }
    seen.add(hash);
    const m = await manifestOf(bytes).catch(() => ({ id: "", version: "" }));
    if (m.id !== meta.id) {
      console.log(`건너뜀 ${label}: 다른 게임(${m.id || "설명서 없음"})`);
      continue;
    }
    if (!versionOk(m.version) || compareVersions(m.version, meta.version) >= 0) {
      console.log(`건너뜀 ${label}: ${m.version} 이 새 버전 ${meta.version} 보다 낮지 않음`);
      continue;
    }
    if (from.some((item) => item.sha1 === hash && item.to === newSha1)) {
      console.log(`있음  ${m.version} → ${meta.version} 바로 가는 패치(${label})`);
      continue;
    }
    const { bytes: delta, info } = await makeDelta(bytes, newBytes, { origs: loaded, log: (line) => console.log(`알림  ${m.version} → ${meta.version}: ${line}`) });
    const hits = info.orig?.hits.filter((hit) => hit.count) ?? [];
    if (hits.length) {
      const why = hits.map((hit) => `${hit.name} ${hit.count}개 ${n(hit.bytes)}바이트`).join(", ");
      console.log(`제외  ${m.version} → ${meta.version}: 원작 롬과 같은 구간(${why}) — 패치를 쓰지 않음`);
      skipped.push({ version: m.version, sha1: hash, why });
      continue;
    }
    const digest = sha256(delta);
    const rel = `patches/${digest}.wgbd`;
    writeAtomic(path.join(dir, rel), delta);
    from = from.filter((item) => !(item.sha1 === hash && item.to === newSha1));
    from.push({ sha1: hash, version: m.version, to: newSha1, patch: { url: rel, size: delta.length, sha256: digest } });
    made.push({ version: m.version, size: delta.length });
    console.log(`바로 가는 패치 ${m.version} → ${meta.version} ${n(delta.length)}바이트(${info.mode === "rebuilt" ? "롬 다시 묶기" : "파일 그대로"}${info.expanded ? " · 확장 바탕" : ""}${info.orig ? ` · 원작 롬 ${info.orig.hits.length}개와 같은 구간 0` : ""}) · 만들기 ${(info.makeMs / 1000).toFixed(1)}초 → ${rel}`);
  }
  return { from, made, skipped };
}

/**
 * 새 버전으로 바로 가는 줄이 있는 옛 버전의 "건너뛰는 줄"(바로 다음 버전이 아닌 곳으로 가는 줄)을 뺀다 — from 이 출시마다
 * 버전 수만큼 늘어 256줄(옛 webGBA 한도)에 닿지 않게. 바로 다음 버전으로 가는 단계 줄과 새 버전으로 가는 줄은 그대로.
 */
export function pruneFrom(from, latestSha1, latestVersion) {
  const versionOf = new Map(from.map((item) => [item.sha1, item.version]));
  versionOf.set(latestSha1, latestVersion);
  const versions = [...new Set(versionOf.values())].filter(versionOk);
  const direct = new Set(from.filter((item) => item.to === latestSha1).map((item) => item.sha1));
  const kept = [];
  const dropped = [];
  for (const item of from) {
    const to = versionOf.get(item.to);
    const skips = item.to !== latestSha1 && direct.has(item.sha1) && versionOk(item.version) && versionOk(to) && versions.some((v) => compareVersions(v, item.version) > 0 && compareVersions(v, to) < 0);
    (skips ? dropped : kept).push(item);
  }
  return { kept, dropped, versionOf };
}

export async function feed({ dir, key, wgba, patches = [], olds = [], origs = [], full = null, notes = null, prev = null, time = null, index = true }) {
  const secret = loadSecret(key);
  const pub = publicOf(secret);
  const newBytes = readBytes(wgba);
  const meta = await manifestOf(newBytes);
  if (!meta.id) throw new Error("새 .wgba 에 설명서가 없습니다");
  const newSha1 = sha1(newBytes);
  const base = `https://feed.invalid/${meta.id}/latest.json`;
  const prevFile = prev ?? (fs.existsSync(path.join(dir, "latest.json")) ? path.join(dir, "latest.json") : null);
  const files = oldFiles(olds);
  if (files.length && !origs.length && (await hasRom(newBytes))) throw new Error("--old 로 바로 가는 패치를 만들 때는 --orig(원작 롬)를 줍니다 — 패치마다 원작 롬 바이트를 검사");
  let from = [];
  let fullRef;
  let keptNotes = null;
  if (prevFile) {
    const old = await verifyFeed(fs.readFileSync(prevFile, "utf8"), pub, base);
    if (old.id !== meta.id) throw new Error(`이전 latest.json 의 id 가 다릅니다: ${old.id}`);
    if (compareVersions(meta.version, old.version) < 0) throw new Error(`새 버전 ${meta.version} 이 이전 ${old.version} 보다 낮습니다`);
    const raw = JSON.parse(JSON.parse(fs.readFileSync(prevFile, "utf8")).signed);
    from = raw.from ?? [];
    console.log(`이전 버전 파일 ${old.version} 의 from ${from.length}줄을 이어받음`);
    // 같은 .wgba 에 바로 가는 패치만 더할 때(버전 그대로) 전체 설치·글을 잃지 않게
    if (raw.wgba?.sha1 === newSha1) {
      if (!full && raw.full) {
        fullRef = raw.full;
        console.log(`전체 설치 ${n(raw.full.size)}바이트를 이어받음(같은 .wgba)`);
      }
      if (!notes && raw.notes) keptNotes = raw.notes;
    }
  }
  fs.mkdirSync(path.join(dir, "patches"), { recursive: true });
  for (const file of patches) {
    const bytes = readBytes(file);
    const head = readDeltaHead(bytes);
    if (head.meta.id && head.meta.id !== meta.id) throw new Error(`${path.basename(file)}: 다른 게임(${head.meta.id})의 패치입니다`);
    const hash = sha256(bytes);
    const rel = `patches/${hash}.wgbd`;
    writeAtomic(path.join(dir, rel), bytes);
    from = from.filter((item) => !(item.sha1 === head.sourceSha1 && item.to === head.targetSha1));
    from.push({ sha1: head.sourceSha1, version: head.meta.from ?? "", to: head.targetSha1, patch: { url: rel, size: bytes.length, sha256: hash } });
    console.log(`패치 ${head.meta.from ?? "?"} → ${head.meta.to ?? "?"} ${n(bytes.length)}바이트 → ${rel}`);
  }
  let direct = null;
  if (files.length) {
    direct = await directPatches({ dir, newBytes, meta, files, origs, from });
    from = direct.from;
  }
  const pruned = pruneFrom(from, newSha1, meta.version);
  for (const item of pruned.dropped) console.log(`뺀 줄 ${item.version} → ${pruned.versionOf.get(item.to) ?? item.to.slice(0, 8)}(바로 가는 패치가 있어 쓰지 않음 · 파일은 그대로)`);
  from = pruned.kept;
  if (full) {
    const bytes = readBytes(full);
    const patch = readPatch(bytes);
    if (patch.manifest.wgba?.sha1 !== sha1(newBytes)) throw new Error(".wgbp 가 만드는 .wgba 의 SHA-1 이 새 .wgba 와 다릅니다(같은 빌드로 만든 .wgbp 가 아님)");
    const hash = sha256(bytes);
    const rel = `full/${hash}.wgbp`;
    fs.mkdirSync(path.join(dir, "full"), { recursive: true });
    writeAtomic(path.join(dir, rel), bytes);
    fullRef = { url: rel, size: bytes.length, sha256: hash };
    console.log(`전체 설치 ${n(bytes.length)}바이트 → ${rel}`);
  }
  const signedObj = {
    id: meta.id,
    version: meta.version,
    time: time ?? nowIso(),
    wgba: { sha1: newSha1, size: newBytes.length },
    from,
    ...(fullRef ? { full: fullRef } : {}),
    ...(notes ? { notes: JSON.parse(fs.readFileSync(notes, "utf8").replace(/^﻿/, "")) } : keptNotes ? { notes: keptNotes } : {}),
  };
  const text = JSON.stringify(signedObj);
  const envelope = { wgbaFeed: FEED_FORMAT, signed: text, signature: signText(text, secret) };
  const body = `${JSON.stringify(envelope, null, 1)}\n`;
  const checked = await verifyFeed(body, pub, base);
  const broken = checked.from.filter((item) => planUpdate(checked, item.sha1).kind !== "patch");
  if (broken.length) throw new Error(`새 버전까지 이어지지 않는 이전 버전이 있습니다: ${broken.map((item) => item.version || item.sha1.slice(0, 8)).join(", ")}`);
  writeAtomic(path.join(dir, "latest.json"), Buffer.from(body, "utf8"));
  const olders = [...new Set(checked.from.map((item) => item.sha1))];
  const oneStep = olders.filter((at) => planUpdate(checked, at).steps.length === 1).length;
  console.log(`latest.json ${meta.id} ${meta.version} · SHA-1 ${newSha1} · from ${from.length}줄 · 옛 버전 ${olders.length}개 중 바로 가는 패치 ${oneStep}개${fullRef ? " · 전체 설치 있음" : ""} · 서명 확인 통과`);
  if (direct) console.log(`바로 가는 패치 새로 ${direct.made.length}개${direct.skipped.length ? ` · 원작 롬 검사로 제외 ${direct.skipped.map((s) => s.version).join(", ")}` : ""}`);
  console.log(`공개 키 ${pub}`);
  const root = path.dirname(path.resolve(dir));
  if (index && fs.existsSync(path.join(root, "index.json"))) await buildIndex(root, secret);
  return 0;
}

function readIndexFile(root) {
  const file = path.join(root, "index.json");
  const text = fs.readFileSync(file, "utf8");
  const envelope = JSON.parse(text);
  return { file, text, envelope, signed: JSON.parse(envelope.signed) };
}

/** 묶음 안 게임 폴더(<게임 id>/latest.json 이 있는 것), 이름순. */
function gameDirs(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && ID_RE.test(entry.name) && fs.existsSync(path.join(root, entry.name, "latest.json")) && !isAppDir(path.join(root, entry.name)))
    .map((entry) => entry.name)
    .sort();
}

/**
 * 묶음의 게임별 latest.json 봉투를 그대로 담은 서명 목록 index.json. signed = { time, feeds: { <id>: SHA-256(latest.json 의 signed 글) } } —
 * 앱은 목록 서명·시각(전보다 이르면 거부)·해시를 확인한 뒤 게임마다 latest.json 과 같은 확인(verifyFeed)을 한다.
 */
export async function buildIndex(root, secret, { time = null } = {}) {
  const pub = publicOf(secret);
  const feeds = {};
  const hashes = {};
  for (const id of gameDirs(root)) {
    const text = fs.readFileSync(path.join(root, id, "latest.json"), "utf8");
    let checked;
    try {
      checked = await verifyFeed(text, pub, `https://feed.invalid/${id}/latest.json`);
    } catch (error) {
      console.log(`뺌  ${id}: 이 키의 서명이 아님(${error.code ?? error.message})`);
      continue;
    }
    if (checked.id !== id) {
      console.log(`뺌  ${id}: latest.json 의 id ${checked.id} 가 폴더 이름과 다름`);
      continue;
    }
    const envelope = JSON.parse(text);
    feeds[id] = { wgbaFeed: envelope.wgbaFeed, signed: envelope.signed, signature: envelope.signature };
    hashes[id] = sha256(Buffer.from(envelope.signed, "utf8"));
  }
  const ids = Object.keys(feeds);
  // webGBA exe 자체 업데이트(README 12.6): 같은 목록에 apps 로 — 옛 webGBA 는 feeds·time 만 조회
  const app = await appIndexPart(root, pub);
  const appIds = Object.keys(app.apps);
  if (!ids.length && !appIds.length) throw new Error(`${root} 에 이 키로 서명한 <게임 id>/latest.json 이 없습니다`);
  let at = time ?? nowIso();
  if (!time && fs.existsSync(path.join(root, "index.json"))) {
    // 앱은 전에 본 목록보다 이른 시각의 목록을 거부하므로, PC 시계가 늦어도 시각이 뒤로 가지 않게
    const before = readIndexFile(root).signed.time;
    if (Date.parse(before) > Date.parse(at)) at = before;
  }
  const text = JSON.stringify({ time: at, feeds: hashes, ...(appIds.length ? { apps: app.hashes } : {}) });
  const envelope = { wgbaIndex: INDEX_FORMAT, signed: text, signature: signText(text, secret), feeds, ...(appIds.length ? { apps: app.apps } : {}) };
  const body = `${JSON.stringify(envelope, null, 1)}\n`;
  if (Buffer.byteLength(body) > INDEX_MAX) throw new Error(`index.json 이 ${n(Buffer.byteLength(body))}바이트로 앱 한도 ${n(INDEX_MAX)}바이트를 넘습니다`);
  const list = await verifyIndex(body, pub);
  for (const id of ids) await indexedFeed(list, id, { key: pub, feed: `https://feed.invalid/${id}/latest.json` });
  if (appIds.length && !(await indexedApp(list, { key: pub, feed: APP_BASE }))) throw new Error("목록의 webGBA 항목을 확인하지 못했습니다");
  writeAtomic(path.join(root, "index.json"), Buffer.from(body, "utf8"));
  console.log(`index.json 게임 ${ids.length}개${appIds.length ? ` + 앱 ${appIds.join(", ")}` : ""} · ${n(Buffer.byteLength(body))}바이트 · 시각 ${at} · 서명 확인 통과(${ids.join(", ")})`);
  return 0;
}

/** 게임 발행 폴더 하나 검사 → 오류 수. */
async function verifyGame(dir, publicKey, olds) {
  const text = fs.readFileSync(path.join(dir, "latest.json"), "utf8");
  const probe = JSON.parse(text);
  const id = JSON.parse(probe.signed).id;
  const base = `https://feed.invalid/${id}/latest.json`;
  const checked = await verifyFeed(text, publicKey, base);
  console.log(`서명 통과 ${checked.id} ${checked.version} · from ${checked.from.length}줄 · 전체 설치 ${checked.full ? "있음" : "없음"}`);
  let errors = 0;
  const local = (ref) => path.join(dir, ...new URL(ref.url).pathname.replace(`/${id}/`, "").split("/"));
  for (const ref of [...checked.from.map((item) => item.patch), ...(checked.full ? [checked.full] : [])]) {
    const file = local(ref);
    if (!fs.existsSync(file)) {
      console.log(`오류  파일 없음 ${relOf(path.relative(dir, file))}`);
      errors++;
      continue;
    }
    const bytes = readBytes(file);
    if (bytes.length !== ref.size || sha256(bytes) !== ref.sha256) {
      console.log(`오류  크기·SHA-256 다름 ${relOf(path.relative(dir, file))}`);
      errors++;
    }
  }
  for (const at of [...new Set(checked.from.map((item) => item.sha1))]) {
    const plan = planUpdate(checked, at);
    const version = checked.from.find((item) => item.sha1 === at).version || "?";
    console.log(`  ${version.padEnd(10)} ${at.slice(0, 12)} → ${plan.kind === "patch" ? `${plan.steps.length}단계 ${n(plan.size)}바이트` : "이어지지 않음"}`);
    if (plan.kind !== "patch") errors++;
  }
  for (const file of olds) {
    let bytes = readBytes(file);
    const plan = planUpdate(checked, sha1(bytes));
    if (plan.kind === "latest") {
      console.log(`${path.basename(file)}: 이미 최신`);
      continue;
    }
    if (plan.kind !== "patch") {
      console.log(`${path.basename(file)}: from 표에 없음 → ${plan.kind === "full" ? "원본 롬으로 전체 설치" : "업데이트 방법 없음"}`);
      continue;
    }
    for (const step of plan.steps) bytes = await applyDelta(bytes, readBytes(local(step.patch)));
    const ok = sha1(bytes) === checked.wgba.sha1 && bytes.length === checked.wgba.size;
    console.log(`${path.basename(file)}: ${plan.steps.length}단계 적용 → ${ok ? "새 버전 SHA-1 일치" : "SHA-1 다름"}`);
    if (!ok) errors++;
  }
  return { errors, id };
}

/** 목록 서명·시각·해시 + 게임 줄마다 latest.json 과 같은지 → { errors, ids }. ids = 목록에 든 게임. */
async function verifyIndexFile(root, publicKey, only = null) {
  const { text, signed } = readIndexFile(root);
  let errors = 0;
  let list;
  try {
    list = await verifyIndex(text, publicKey);
  } catch (error) {
    console.log(`오류  index.json 서명·형식: ${error.code ?? ""} ${error.message}`);
    return { errors: 1, ids: [] };
  }
  const ids = Object.keys(signed.feeds ?? {}).sort();
  const appIds = Object.keys(signed.apps ?? {}).sort();
  console.log(`목록 서명 통과 index.json · 게임 ${ids.length}개${appIds.length ? ` · 앱 ${appIds.join(", ")}` : ""} · 시각 ${signed.time}`);
  for (const id of appIds.filter((id) => !only || only.includes(id))) {
    const file = path.join(root, id, "latest.json");
    try {
      if (!(await indexedApp(list, { key: publicKey, feed: APP_BASE }))) throw new Error("항목 없음");
    } catch (error) {
      console.log(`오류  목록의 ${id}: ${error.code ?? ""} ${error.message}`);
      errors++;
      continue;
    }
    if (!fs.existsSync(file) || JSON.parse(fs.readFileSync(file, "utf8")).signed !== list.apps[id].signed) {
      console.log(`오류  목록의 ${id} 가 ${id}/latest.json 과 다름(또는 없음) — wgba.mjs index 로 목록을 다시 만듭니다`);
      errors++;
    }
  }
  for (const id of (only ?? ids).filter((id) => !appIds.includes(id))) {
    const file = path.join(root, id, "latest.json");
    try {
      await indexedFeed(list, id, { key: publicKey, feed: `https://feed.invalid/${id}/latest.json` });
    } catch (error) {
      console.log(`오류  목록의 ${id}: ${error.code ?? ""} ${error.message}`);
      errors++;
      continue;
    }
    if (!fs.existsSync(file)) {
      console.log(`오류  목록에 있는 ${id} 의 latest.json 이 묶음에 없음`);
      errors++;
    } else if (JSON.parse(fs.readFileSync(file, "utf8")).signed !== list.feeds[id].signed) {
      console.log(`오류  목록의 ${id} 가 ${id}/latest.json 과 다름 — wgba.mjs index 로 목록을 다시 만듭니다`);
      errors++;
    }
  }
  return { errors, ids, appIds };
}

export async function verify(dir, { pub = null, key = null, olds = [] }) {
  const publicKey = pub ?? publicOf(loadSecret(key));
  let errors = 0;
  if (!fs.existsSync(path.join(dir, "latest.json")) && fs.existsSync(path.join(dir, "index.json"))) {
    const head = await verifyIndexFile(dir, publicKey);
    errors += head.errors;
    const byId = new Map();
    for (const file of olds) {
      const m = await manifestOf(readBytes(file)).catch(() => ({ id: "" }));
      if (!byId.has(m.id)) byId.set(m.id, []);
      byId.get(m.id).push(file);
    }
    for (const id of gameDirs(dir)) {
      if (!head.ids.includes(id)) {
        console.log(`오류  ${id}/latest.json 이 목록에 없음 — wgba.mjs index 로 목록을 다시 만듭니다`);
        errors++;
      }
      console.log(`── ${id}`);
      errors += (await verifyGame(path.join(dir, id), publicKey, byId.get(id) ?? [])).errors;
      byId.delete(id);
    }
    for (const [id, files] of byId) console.log(`알림  ${files.map((f) => path.basename(f)).join(", ")}: 묶음에 없는 게임(${id || "설명서 없음"})`);
    for (const id of appDirs(dir)) {
      if (!head.appIds.includes(id)) {
        console.log(`오류  ${id}/latest.json 이 목록에 없음 — wgba.mjs index 로 목록을 다시 만듭니다`);
        errors++;
      }
      console.log(`── ${id}`);
      errors += (await verifyAppDir(path.join(dir, id), publicKey)).errors;
    }
  } else if (isAppDir(dir)) {
    const app = await verifyAppDir(dir, publicKey);
    errors += app.errors;
    const root = path.dirname(path.resolve(dir));
    if (fs.existsSync(path.join(root, "index.json"))) errors += (await verifyIndexFile(root, publicKey, [app.id])).errors;
  } else {
    const game = await verifyGame(dir, publicKey, olds);
    errors += game.errors;
    const root = path.dirname(path.resolve(dir));
    if (fs.existsSync(path.join(root, "index.json"))) errors += (await verifyIndexFile(root, publicKey, [game.id])).errors;
  }
  console.log(errors ? `실패(오류 ${errors})` : "통과");
  return errors ? 1 : 0;
}

function gamePlan(dir, expectId) {
  const text = fs.readFileSync(path.join(dir, "latest.json"), "utf8");
  const envelope = JSON.parse(text);
  const signed = JSON.parse(envelope.signed);
  const id = signed.id;
  if (expectId && id !== expectId) throw new Error(`${expectId}/latest.json 의 id ${id} 가 폴더 이름과 다릅니다`);
  const files = [...(signed.from ?? []).map((item) => item.patch), ...(signed.full ? [signed.full] : [])];
  const unique = [...new Map(files.map((ref) => [ref.url, ref])).values()];
  return {
    id,
    version: signed.version,
    signedText: envelope.signed,
    items: [
      ...unique.map((ref) => ({ key: `${id}/${ref.url}`, file: path.join(dir, ...ref.url.split("/")), size: ref.size, type: "application/octet-stream", cache: IMMUTABLE })),
      { key: `${id}/latest.json`, file: path.join(dir, "latest.json"), size: Buffer.byteLength(text), type: "application/json", cache: FEED_CACHE },
    ],
  };
}

export async function upload(dir, { dryRun = false, remote = false, config = null } = {}) {
  const asRoot = !fs.existsSync(path.join(dir, "latest.json")) && fs.existsSync(path.join(dir, "index.json"));
  const root = asRoot ? dir : path.dirname(path.resolve(dir));
  const withIndex = fs.existsSync(path.join(root, "index.json"));
  let games;
  if (withIndex) {
    // 목록이 가리키는 모든 게임의 파일이 버킷에 있어야 새 webGBA 가 목록대로 받으므로 묶음 전체를 올린다(이미 있는 파일은 건너뜀)
    if (!asRoot) console.log("묶음에 index.json 이 있어 묶음 전체(게임 파일 → latest.json → index.json)를 올립니다");
    const { signed, envelope } = readIndexFile(root);
    const ids = Object.keys(signed.feeds ?? {}).sort();
    games = ids.map((id) => gamePlan(path.join(root, id), id));
    for (const game of games) if (envelope.feeds?.[game.id]?.signed !== game.signedText) throw new Error(`index.json 의 ${game.id} 가 ${game.id}/latest.json 과 다릅니다 — wgba.mjs index 로 다시 만든 뒤 올립니다`);
    const appIds = Object.keys(signed.apps ?? {}).sort();
    const apps = appIds.map((id) => appPlan(path.join(root, id), id));
    for (const app of apps) if (envelope.apps?.[app.id]?.signed !== app.signedText) throw new Error(`index.json 의 ${app.id} 가 ${app.id}/latest.json 과 다릅니다 — wgba.mjs index 로 다시 만든 뒤 올립니다`);
    games.push(...apps);
    const missing = [...gameDirs(root).filter((id) => !ids.includes(id)), ...appDirs(root).filter((id) => !appIds.includes(id))];
    if (missing.length) throw new Error(`목록에 없는 게임 폴더가 있습니다: ${missing.join(", ")} — wgba.mjs index 로 다시 만든 뒤 올립니다`);
  } else games = [isAppDir(dir) ? appPlan(dir, null) : gamePlan(dir, null)];
  const plan = games.flatMap((game) => game.items);
  if (withIndex) {
    const file = path.join(root, "index.json");
    plan.push({ key: "index.json", file, size: fs.statSync(file).size, type: "application/json", cache: FEED_CACHE });
  }
  for (const item of plan) if (!fs.existsSync(item.file)) throw new Error(`파일이 없습니다: ${relOf(path.relative(root, item.file))}`);
  if (dryRun && !remote) {
    for (const item of plan) console.log(`올릴 것 ${item.key} ${n(item.size)}바이트 · Cache-Control ${item.cache}`);
    console.log(`--dry-run: 올리지 않았습니다(게임 ${games.length}개 · 파일 ${plan.length}개 · ${n(plan.reduce((sum, item) => sum + item.size, 0))}바이트)`);
    return 0;
  }
  const r2 = config ?? r2Config();
  // 버킷 쪽 확인은 목록 1번(ListObjectsV2 = Class A, 1,000개당 1번). 파일마다 HEAD 하면 실행마다 Class B 가 파일 수만큼 든다
  let listed = null;
  try {
    listed = await r2List(r2);
    console.log(`버킷 목록 ${n(listed.objects.size)}개 · 요청 ${listed.requests}번(ListObjectsV2)`);
  } catch (error) {
    console.log(`경고  버킷 목록을 받지 못해 파일마다 HEAD 로 확인합니다(${error.message})`);
  }
  let put = 0;
  let sent = 0;
  let same = 0;
  let heads = 0;
  for (const item of plan) {
    const bytes = readBytes(item.file);
    // 묶음 전체를 올려도 바뀌지 않은 latest.json 은 다시 쓰지 않게 내용(ETag = MD5)까지 비교. 여러 조각으로 올린 객체(ETag 에 "-")는 크기만
    const head = listed ? (listed.objects.get(item.key) ?? null) : (heads++, await r2Head(r2, item.key));
    const md5 = crypto.createHash("md5").update(bytes).digest("hex");
    if (head && head.size === bytes.length && (head.etag === md5 || (item.cache === IMMUTABLE && head.etag.includes("-")))) {
      console.log(`같음  ${item.key}`);
      same++;
      continue;
    }
    if (dryRun) {
      console.log(`올릴 것 ${item.key} ${n(bytes.length)}바이트 · ${head ? "버킷과 다름" : "버킷에 없음"}`);
      put++;
      sent += bytes.length;
      continue;
    }
    await r2Put(r2, item.key, bytes, { contentType: item.type, cacheControl: item.cache });
    console.log(`올림  ${item.key} ${n(bytes.length)}바이트`);
    put++;
    sent += bytes.length;
  }
  const checks = listed ? `목록 ${listed.requests}번` : `HEAD ${heads}번`;
  if (dryRun) console.log(`--dry-run --remote: 올리지 않았습니다 — 올릴 것 ${put}개 ${n(sent)}바이트 · 같음 ${same}개 · 버킷 확인 ${checks}`);
  else console.log(`완료 — 올림 ${put}개 ${n(sent)}바이트 · 같아서 건너뜀 ${same}개 · 버킷 확인 ${checks} · ${games.map((game) => `${game.id} ${game.version}`).join(", ")}${withIndex ? " + index.json" : ""}`);
  return 0;
}

export function parseList(argv, takes, many = []) {
  const opts = { positional: [] };
  for (const name of many) opts[name] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (many.includes(a)) opts[a].push(argv[++i]);
    else if (takes.includes(a)) opts[a] = argv[++i];
    else if (a.startsWith("--")) opts[a] = true;
    else opts.positional.push(a);
  }
  return opts;
}

export async function updateCommand(cmd, rest) {
  if (cmd === "keygen") {
    const o = parseList(rest, ["-o"]);
    if (!o["-o"]) return -1;
    return keygen(o["-o"], { force: Boolean(o["--force"]) });
  }
  if (cmd === "diff") {
    const o = parseList(rest, ["-o"], ["--orig"]);
    if (o.positional.length !== 2 || !o["-o"]) return -1;
    return diff(o.positional[0], o.positional[1], o["-o"], { origs: o["--orig"], expand: !o["--no-expand"] });
  }
  if (cmd === "feed") {
    const o = parseList(rest, ["--dir", "--key", "--wgba", "--full", "--notes", "--prev", "--time"], ["--patch", "--old", "--orig"]);
    if (!o["--dir"] || !o["--key"] || !o["--wgba"] || o.positional.length) return -1;
    return feed({ dir: o["--dir"], key: o["--key"], wgba: o["--wgba"], patches: o["--patch"], olds: o["--old"], origs: o["--orig"], full: o["--full"] ?? null, notes: o["--notes"] ?? null, prev: o["--prev"] ?? null, time: o["--time"] ?? null, index: !o["--no-index"] });
  }
  if (cmd === "app") {
    const o = parseList(rest, ["--dir", "--key", "--exe", "--notes", "--time"], ["--file"]);
    if (!o["--dir"] || !o["--key"] || !o["--exe"] || o.positional.length) return -1;
    return appPublish({ dir: o["--dir"], key: o["--key"], exe: o["--exe"], files: o["--file"], notes: o["--notes"] ?? null, index: !o["--no-index"], dryRun: Boolean(o["--dry-run"]), testId: Boolean(o["--test-id"]), time: o["--time"] ?? null });
  }
  if (cmd === "index") {
    const o = parseList(rest, ["--root", "--key", "--time"]);
    if (!o["--root"] || !o["--key"] || o.positional.length) return -1;
    return buildIndex(o["--root"], loadSecret(o["--key"]), { time: o["--time"] ?? null });
  }
  if (cmd === "verify") {
    const o = parseList(rest, ["--pub", "--key"], ["--wgba"]);
    if (o.positional.length !== 1 || (!o["--pub"] && !o["--key"])) return -1;
    if (o["--pub"]) fromBase64(o["--pub"]);
    return verify(o.positional[0], { pub: o["--pub"] ?? null, key: o["--key"] ?? null, olds: o["--wgba"] });
  }
  if (cmd === "upload") {
    const o = parseList(rest, [], ["--wgba"]);
    if (o.positional.length > 1 || (!o.positional.length && !o["--wgba"].length)) return -1;
    if (o["--remote"] && !o["--dry-run"]) return -1;
    const flags = { dryRun: Boolean(o["--dry-run"]), remote: Boolean(o["--remote"]) };
    if (o["--wgba"].length) await privateUpload(o["--wgba"], flags);
    return o.positional.length ? upload(o.positional[0], flags) : 0;
  }
  if (cmd === "private-prune") {
    const o = parseList(rest, []);
    if (o.positional.length) return -1;
    return privatePrune({ dryRun: Boolean(o["--dry-run"]) });
  }
  if (cmd === "admin-key") {
    const o = parseList(rest, []);
    if (o.positional.length) return -1;
    return adminKey({ dryRun: Boolean(o["--dry-run"]) });
  }
  if (cmd === "r2-stats") {
    const o = parseList(rest, ["--days", "--since", "--until", "--top"]);
    if (o.positional.length) return -1;
    return r2Stats({ days: o["--days"] ? Number(o["--days"]) : null, since: o["--since"] ?? null, until: o["--until"] ?? null, top: o["--top"] ? Number(o["--top"]) : 30 });
  }
  return null;
}


