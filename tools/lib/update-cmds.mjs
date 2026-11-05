// 온라인 업데이트 배포 명령(wgba.mjs keygen · diff · feed · verify · upload). 규격 = README 12장.
//
//   keygen -o <비밀 키.pem> [--force]       ECDSA P-256 열쇠 만들기. 비밀 키는 저장소 밖에만(git 저장소 안이면 거절), 화면에는 공개 키만.
//   diff <옛.wgba> <새.wgba> -o <패치.wgbd> [--orig <원작 롬>]… [--no-expand]
//   feed --dir <발행 폴더> --key <비밀 키.pem> --wgba <새.wgba> [--patch <패치.wgbd>]… [--full <새.wgbp>] [--notes <글.json>] [--prev <이전 latest.json>]
//        발행 폴더 = 버킷의 <게임 id>/ 와 같은 짜임: latest.json · patches/<SHA-256>.wgbd · full/<SHA-256>.wgbp.
//        이전 latest.json(기본 = 발행 폴더 안 것)의 from 표를 이어받아 새 패치를 더하고, 모든 이전 버전이 새 버전까지 이어지는지 확인한다.
//   verify <발행 폴더> (--pub <공개 키> | --key <비밀 키.pem>) [--wgba <옛.wgba>]…   서명·파일 크기·SHA-256, 옛 파일마다 끝까지 적용
//   upload <발행 폴더> [--dry-run]           R2 에 올리기(patches·full 먼저, latest.json 마지막). 환경 변수 R2_ACCOUNT_ID ·
//                                            R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET (값은 출력하지 않음)
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { loadOrig, makeDelta, manifestOf } from "./wgbd-make.mjs";
import { r2Config, r2Has, r2Put } from "./r2.mjs";
import { applyDelta, FEED_FORMAT, fromBase64, planUpdate, readDeltaHead, romPlace, verifyFeed } from "../../src-bundle/src/js/core/wgba-update.js";
import { compareVersions } from "../../src-bundle/src/js/core/wgba-format.js";
import { readPatch } from "../../src-bundle/src/js/core/wgbp.js";

const n = (v) => v.toLocaleString("en-US");
const sha1 = (bytes) => crypto.createHash("sha1").update(bytes).digest("hex");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const readBytes = (file) => new Uint8Array(fs.readFileSync(file));
const IMMUTABLE = "public, max-age=31536000, immutable";
const FEED_CACHE = "no-cache";

function writeAtomic(file, bytes) {
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

function loadSecret(file) {
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

export async function feed({ dir, key, wgba, patches = [], full = null, notes = null, prev = null, time = null }) {
  const secret = loadSecret(key);
  const pub = publicOf(secret);
  const newBytes = readBytes(wgba);
  const meta = await manifestOf(newBytes);
  if (!meta.id) throw new Error("새 .wgba 에 설명서가 없습니다");
  const base = `https://feed.invalid/${meta.id}/latest.json`;
  const prevFile = prev ?? (fs.existsSync(path.join(dir, "latest.json")) ? path.join(dir, "latest.json") : null);
  let from = [];
  let fullRef;
  if (prevFile) {
    const old = await verifyFeed(fs.readFileSync(prevFile, "utf8"), pub, base);
    if (old.id !== meta.id) throw new Error(`이전 latest.json 의 id 가 다릅니다: ${old.id}`);
    if (compareVersions(meta.version, old.version) < 0) throw new Error(`새 버전 ${meta.version} 이 이전 ${old.version} 보다 낮습니다`);
    const raw = JSON.parse(JSON.parse(fs.readFileSync(prevFile, "utf8")).signed);
    from = raw.from ?? [];
    console.log(`이전 버전 파일 ${old.version} 의 from ${from.length}줄을 이어받음`);
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
    time: time ?? new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    wgba: { sha1: sha1(newBytes), size: newBytes.length },
    from,
    ...(fullRef ? { full: fullRef } : {}),
    ...(notes ? { notes: JSON.parse(fs.readFileSync(notes, "utf8").replace(/^﻿/, "")) } : {}),
  };
  const text = JSON.stringify(signedObj);
  const envelope = { wgbaFeed: FEED_FORMAT, signed: text, signature: signText(text, secret) };
  const body = `${JSON.stringify(envelope, null, 1)}\n`;
  const checked = await verifyFeed(body, pub, base);
  const broken = checked.from.filter((item) => planUpdate(checked, item.sha1).kind !== "patch");
  if (broken.length) throw new Error(`새 버전까지 이어지지 않는 이전 버전이 있습니다: ${broken.map((item) => item.version || item.sha1.slice(0, 8)).join(", ")}`);
  writeAtomic(path.join(dir, "latest.json"), Buffer.from(body, "utf8"));
  console.log(`latest.json ${meta.id} ${meta.version} · SHA-1 ${signedObj.wgba.sha1} · from ${from.length}줄${fullRef ? " · 전체 설치 있음" : ""} · 서명 확인 통과`);
  console.log(`공개 키 ${pub}`);
  return 0;
}

export async function verify(dir, { pub = null, key = null, olds = [] }) {
  const publicKey = pub ?? publicOf(loadSecret(key));
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
  for (const item of checked.from) {
    const plan = planUpdate(checked, item.sha1);
    console.log(`  ${(item.version || "?").padEnd(10)} ${item.sha1.slice(0, 12)} → ${plan.kind === "patch" ? `${plan.steps.length}단계 ${n(plan.size)}바이트` : "이어지지 않음"}`);
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
  console.log(errors ? `실패(오류 ${errors})` : "통과");
  return errors ? 1 : 0;
}

export async function upload(dir, { dryRun = false } = {}) {
  const text = fs.readFileSync(path.join(dir, "latest.json"), "utf8");
  const signed = JSON.parse(JSON.parse(text).signed);
  const id = signed.id;
  const files = [...(signed.from ?? []).map((item) => item.patch), ...(signed.full ? [signed.full] : [])];
  const plan = [
    ...files.map((ref) => ({ key: `${id}/${ref.url}`, file: path.join(dir, ...ref.url.split("/")), size: ref.size, type: "application/octet-stream", cache: IMMUTABLE })),
    { key: `${id}/latest.json`, file: path.join(dir, "latest.json"), size: Buffer.byteLength(text), type: "application/json", cache: FEED_CACHE },
  ];
  for (const item of plan) if (!fs.existsSync(item.file)) throw new Error(`파일이 없습니다: ${relOf(path.relative(dir, item.file))}`);
  if (dryRun) {
    for (const item of plan) console.log(`올릴 것 ${item.key} ${n(item.size)}바이트 · Cache-Control ${item.cache}`);
    console.log("--dry-run: 올리지 않았습니다");
    return 0;
  }
  const config = r2Config();
  for (const item of plan) {
    const last = item.key.endsWith("latest.json");
    if (!last && (await r2Has(config, item.key, item.size))) {
      console.log(`있음  ${item.key}`);
      continue;
    }
    await r2Put(config, item.key, readBytes(item.file), { contentType: item.type, cacheControl: item.cache });
    console.log(`올림  ${item.key} ${n(item.size)}바이트`);
  }
  console.log(`완료 — ${id} ${signed.version}`);
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
    const o = parseList(rest, ["--dir", "--key", "--wgba", "--full", "--notes", "--prev", "--time"], ["--patch"]);
    if (!o["--dir"] || !o["--key"] || !o["--wgba"] || o.positional.length) return -1;
    return feed({ dir: o["--dir"], key: o["--key"], wgba: o["--wgba"], patches: o["--patch"], full: o["--full"] ?? null, notes: o["--notes"] ?? null, prev: o["--prev"] ?? null, time: o["--time"] ?? null });
  }
  if (cmd === "verify") {
    const o = parseList(rest, ["--pub", "--key"], ["--wgba"]);
    if (o.positional.length !== 1 || (!o["--pub"] && !o["--key"])) return -1;
    if (o["--pub"]) fromBase64(o["--pub"]);
    return verify(o.positional[0], { pub: o["--pub"] ?? null, key: o["--key"] ?? null, olds: o["--wgba"] });
  }
  if (cmd === "upload") {
    const o = parseList(rest, []);
    if (o.positional.length !== 1) return -1;
    return upload(o.positional[0], { dryRun: Boolean(o["--dry-run"]) });
  }
  return null;
}


