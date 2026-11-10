// webGBA exe 자체 업데이트 발행(wgba.mjs app). 규격 = README 12.6. 목록·검사·올리기는 update-cmds.mjs 가 이 파일의 함수로 앱 폴더도 다룬다.
//
//   app --dir <묶음>/com.flightrabbit.webgba --key <비밀 키.pem> --exe <webgba.exe> [--file <LICENSE 등>]… [--notes <글.json>] [--no-index] [--dry-run] [--test-id]
//       exe 를 --webgba-version 으로 실행해 버전을 조회(이 기능이 없는 exe 는 거부). 파일마다 zlib(9) → files/<압축 SHA-256>.z,
//       서명한 latest.json(wgbaApp 1), 묶음에 index.json 이 있으면 목록도 다시 만든다. --file 이 없으면 저장소 LICENSE · THIRD_PARTY_NOTICES.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { deflate, inflate } from "../../src-bundle/src/js/vendor/pako.js";
import { APP_EXE, APP_FORMAT, APP_ID, APP_PLATFORM, appPathOk, verifyApp } from "../../src-bundle/src/js/core/app-update.js";
import { compareVersions, VERSION_RE } from "../../src-bundle/src/js/core/wgba-format.js";
import { buildIndex, loadSecret, publicOf, signText, writeAtomic } from "./update-cmds.mjs";

const n = (v) => v.toLocaleString("en-US");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const readBytes = (file) => new Uint8Array(fs.readFileSync(file));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
export const APP_BASE = `https://feed.invalid/${APP_ID}/latest.json`;
const IMMUTABLE = "public, max-age=31536000, immutable";
const FEED_CACHE = "no-cache";

/** <dir>/latest.json 이 앱 봉투(wgbaApp)인지. */
export function isAppDir(dir) {
  const file = path.join(dir, "latest.json");
  if (!fs.existsSync(file)) return false;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).wgbaApp !== undefined;
  } catch {
    return false;
  }
}

export function appDirs(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name === APP_ID && isAppDir(path.join(root, entry.name)))
    .map((entry) => entry.name);
}

/** exe 를 --webgba-version 으로 실행해 버전. 이 기능이 든 exe 만 자체 업데이트 대상이라 버전을 못 읽으면 발행하지 않는다. */
function exeVersion(exe) {
  const out = spawnSync(path.resolve(exe), ["--webgba-version"], { encoding: "utf8", timeout: 15000, windowsHide: true });
  const version = /^webGBA (\S+)/.exec((out.stdout ?? "").trim())?.[1] ?? "";
  if (out.status !== 0 || !VERSION_RE.test(version)) throw new Error(`exe 버전을 읽지 못했습니다(--webgba-version 출력 ${JSON.stringify((out.stdout ?? "").trim())}) — 자체 업데이트 기능이 든 exe 만 발행합니다`);
  return version;
}

const localOf = (dir, ref) => path.join(dir, ...new URL(ref.url).pathname.replace(`/${APP_ID}/`, "").split("/"));

export async function appPublish({ dir, key, exe, files = [], notes = null, index = true, dryRun = false, testId = false, time = null }) {
  if (path.basename(path.resolve(dir)) !== APP_ID) throw new Error(`발행 폴더 이름은 ${APP_ID} 입니다(버킷의 ${APP_ID}/ 와 같게): ${dir}`);
  const secret = loadSecret(key);
  const pub = publicOf(secret);
  const exeBytes = readBytes(exe);
  if (/com\.flightrabbit\.webgba\.[a-z]/.test(Buffer.from(exeBytes).toString("latin1")) && !testId) throw new Error("시험 식별자로 빌드한 exe 입니다 — 배포용(기본 식별자) exe 를 주세요");
  const version = exeVersion(exe);
  const extra = files.length ? files : ["LICENSE", "THIRD_PARTY_NOTICES"].map((name) => path.join(repoRoot, name)).filter((file) => fs.existsSync(file));
  const list = [{ path: APP_EXE, bytes: exeBytes }];
  for (const file of extra) {
    const name = path.basename(file);
    if (!appPathOk(name) || name.toLowerCase() === APP_EXE) throw new Error(`올릴 수 없는 파일 이름: ${name}`);
    list.push({ path: name, bytes: readBytes(file) });
  }
  const latest = path.join(dir, "latest.json");
  if (fs.existsSync(latest)) {
    const prev = await verifyApp(fs.readFileSync(latest, "utf8"), pub, APP_BASE);
    const order = compareVersions(version, prev.version);
    if (order < 0) throw new Error(`새 버전 ${version} 이 이전 ${prev.version} 보다 낮습니다`);
    if (order === 0 && list.some((item) => prev.files.find((f) => f.path === item.path)?.sha256 !== sha256(item.bytes))) throw new Error(`이전 발행과 같은 버전 ${version} 인데 파일이 다릅니다 — 버전을 올린 exe 로 발행합니다`);
    console.log(`이전 발행 ${prev.version} → 새 ${version}`);
  }
  const entries = [];
  for (const item of list) {
    const packed = deflate(item.bytes, { level: 9 });
    const hash = sha256(packed);
    const rel = `files/${hash}.z`;
    if (!dryRun) writeAtomic(path.join(dir, rel), packed);
    entries.push({ path: item.path, size: item.bytes.length, sha256: sha256(item.bytes), get: { url: rel, size: packed.length, sha256: hash } });
    console.log(`${dryRun ? "만들 것" : "파일"} ${item.path} ${n(item.bytes.length)}바이트 → zlib ${n(packed.length)}바이트 ${rel}`);
  }
  const signedObj = {
    id: APP_ID,
    version,
    time: time ?? nowIso(),
    platform: APP_PLATFORM,
    files: entries,
    ...(notes ? { notes: JSON.parse(fs.readFileSync(notes, "utf8").replace(/^﻿/, "")) } : {}),
  };
  const text = JSON.stringify(signedObj);
  const body = `${JSON.stringify({ wgbaApp: APP_FORMAT, signed: text, signature: signText(text, secret) }, null, 1)}\n`;
  await verifyApp(body, pub, APP_BASE);
  if (dryRun) {
    console.log(`--dry-run: 쓰지 않았습니다 — latest.json ${APP_ID} ${version} · 파일 ${entries.length}개 · 받는 양(모두 바뀔 때) ${n(entries.reduce((s, e) => s + e.get.size, 0))}바이트 · 서명 확인 통과`);
    return 0;
  }
  writeAtomic(latest, Buffer.from(body, "utf8"));
  console.log(`latest.json ${APP_ID} ${version} · 파일 ${entries.length}개 · 서명 확인 통과 · 공개 키 ${pub}`);
  const root = path.dirname(path.resolve(dir));
  if (index && fs.existsSync(path.join(root, "index.json"))) await buildIndex(root, secret);
  else if (index) console.log("묶음에 index.json 이 없어 목록은 만들지 않았습니다(wgba.mjs index --root <묶음> 로 생성)");
  return 0;
}

/** 목록에 넣을 앱 봉투(이 키로 서명·id = 폴더 이름) → { apps, hashes }. */
export async function appIndexPart(root, pub) {
  const apps = {};
  const hashes = {};
  for (const id of appDirs(root)) {
    const text = fs.readFileSync(path.join(root, id, "latest.json"), "utf8");
    try {
      await verifyApp(text, pub, APP_BASE);
    } catch (error) {
      console.log(`뺌  ${id}: 이 키의 서명이 아니거나 형식이 다름(${error.code ?? error.message})`);
      continue;
    }
    const envelope = JSON.parse(text);
    apps[id] = { wgbaApp: envelope.wgbaApp, signed: envelope.signed, signature: envelope.signature };
    hashes[id] = sha256(Buffer.from(envelope.signed, "utf8"));
  }
  return { apps, hashes };
}

/** 앱 발행 폴더 검사 → 오류 수. 받을 파일 크기·SHA-256, 푼 파일 크기·SHA-256. */
export async function verifyAppDir(dir, publicKey) {
  const app = await verifyApp(fs.readFileSync(path.join(dir, "latest.json"), "utf8"), publicKey, APP_BASE);
  console.log(`서명 통과 ${app.id} ${app.version} · ${app.platform} · 파일 ${app.files.length}개`);
  let errors = 0;
  for (const file of app.files) {
    const local = localOf(dir, file.get);
    if (!fs.existsSync(local)) {
      console.log(`오류  파일 없음 ${file.path} (${file.get.url.split("/").slice(-2).join("/")})`);
      errors++;
      continue;
    }
    const packed = readBytes(local);
    let bytes = null;
    try {
      bytes = inflate(packed);
    } catch {
      bytes = null;
    }
    const ok = packed.length === file.get.size && sha256(packed) === file.get.sha256 && bytes && bytes.length === file.size && sha256(bytes) === file.sha256;
    console.log(`  ${file.path.padEnd(20)} ${n(file.size)}바이트 · zlib ${n(file.get.size)}바이트 ${ok ? "일치" : "다름"}`);
    if (!ok) errors++;
  }
  return { errors, id: app.id };
}

/** 올릴 파일: 압축 파일(immutable) → latest.json. */
export function appPlan(dir, expectId) {
  const text = fs.readFileSync(path.join(dir, "latest.json"), "utf8");
  const envelope = JSON.parse(text);
  const signed = JSON.parse(envelope.signed);
  if (expectId && signed.id !== expectId) throw new Error(`${expectId}/latest.json 의 id ${signed.id} 가 폴더 이름과 다릅니다`);
  const refs = [...new Map((signed.files ?? []).map((f) => [f.get.url, f.get])).values()];
  return {
    id: signed.id,
    version: signed.version,
    signedText: envelope.signed,
    items: [
      ...refs.map((ref) => ({ key: `${signed.id}/${ref.url}`, file: path.join(dir, ...ref.url.split("/")), size: ref.size, type: "application/octet-stream", cache: IMMUTABLE })),
      { key: `${signed.id}/latest.json`, file: path.join(dir, "latest.json"), size: Buffer.byteLength(text), type: "application/json", cache: FEED_CACHE },
    ],
  };
}
