// 관리자 모드 "롬 가져오기" 발행 도구 — 비공개 R2 버킷(공개 주소 꺼짐)에 키 파일·전체 .wgba 를 올린다(설계.md 34절).
// 계정·키는 환경 변수 R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_PRIVATE_BUCKET 에서만 읽고, 값을 출력·기록하지 않는다.
// 6자리 값과 그 SHA-256 은 어디에도 출력·저장하지 않는다(12글자 6칸 = 약 300만 가지라 해시만으로 바로 역산된다).
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { manifestOf } from "./wgbd-make.mjs";
import { r2Delete, r2Head, r2List, r2Put } from "./r2.mjs";
import { saveFileName } from "../../api/_admin/save-name.js";

export const PRIVATE_ENV = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PRIVATE_BUCKET"];
export const KEY_FILE = "authentication.key";
export const PIN_RE = /^[0-9!#]{6}$/;
const SEMVER_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?$/;
const n = (v) => v.toLocaleString("en-US");

export function privateConfig(env = process.env) {
  const missing = PRIVATE_ENV.filter((name) => !env[name]);
  if (missing.length) throw new Error(`환경 변수가 없습니다: ${missing.join(", ")}`);
  return { account: env.R2_ACCOUNT_ID, accessKey: env.R2_ACCESS_KEY_ID, secret: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_PRIVATE_BUCKET, host: `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` };
}

/** 한국 시각 "YYYY-MM-DD HH:mm"(서버가 시각대 없는 값을 +09:00 으로 읽음). */
export function kstStamp(ms = Date.now()) {
  return new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");
}

export function keyFileText(pin, ms = Date.now()) {
  if (!PIN_RE.test(pin)) throw new Error("6자리는 0~9 · ! · # 로만 6글자입니다");
  return `${JSON.stringify({ sha256: crypto.createHash("sha256").update(pin, "utf8").digest("hex"), updated: kstStamp(ms) })}\n`;
}

/** 화면에 글자 대신 • 만 찍으며 한 줄을 받는다(TTY 전용 — 파이프·기록에 값이 남지 않게). */
function askHidden(prompt) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") throw new Error("입력을 화면에 숨길 수 없는 창입니다 — PowerShell·명령 프롬프트에서 실행합니다");
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    const done = (error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\u0003") return done(new Error("취소했습니다"));
        if (ch === "\r" || ch === "\n") return done(null);
        if (ch === "\b" || ch === "\u007f") {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (value.length < 16 && ch >= " ") {
          value += ch;
          process.stdout.write("•");
        }
      }
    };
    input.on("data", onData);
  });
}

export async function adminKey({ dryRun = false, config = null, ask = askHidden, now = Date.now } = {}) {
  const first = await ask("관리자 6자리(0~9 · ! · #): ");
  if (!PIN_RE.test(first)) throw new Error("6자리는 0~9 · ! · # 로만 6글자입니다");
  const second = await ask("한 번 더: ");
  if (second !== first) throw new Error("두 번 입력한 값이 다릅니다 — 올리지 않았습니다");
  const ms = now();
  const text = keyFileText(first, ms);
  if (dryRun) {
    console.log(`--dry-run: 올리지 않았습니다(${KEY_FILE} 형식 확인 · 갱신일자 ${kstStamp(ms)})`);
    return 0;
  }
  const r2 = config ?? privateConfig();
  const bytes = new TextEncoder().encode(text);
  await r2Put(r2, KEY_FILE, bytes, { contentType: "application/json", cacheControl: "no-store" });
  // 올린 뒤 크기를 다시 확인(내용은 받지 않음) — 0바이트 키 파일이면 서버가 형식 오류로 막아 관리자 모드를 켤 수 없음
  const head = await r2Head(r2, KEY_FILE);
  if (!head || head.size !== bytes.length) throw new Error(`올린 ${KEY_FILE} 크기가 다릅니다(버킷 ${head ? head.size : "없음"} · 보낸 ${bytes.length}바이트) — admin-key 를 다시 실행하세요`);
  console.log(`${KEY_FILE} 를 비공개 버킷에 올렸습니다 · 갱신일자 ${kstStamp(ms)}(한국 시각) — 이 시각 전에 켠 관리자 모드는 "롬 가져오기" 때 다시 입력합니다. 서버 반영까지 최대 1분`);
  return 0;
}

const GAME_KEY_RE = /^wgba\/([a-z0-9][a-z0-9.-]{0,63})\/(\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?)\.wgba$/;

/** semver 비교(x.y.z 숫자, 같으면 접미사 없는 쪽이 높음). */
export function compareVersions(a, b) {
  const split = (v) => [v.split("-")[0].split(".").map(Number), v.includes("-") ? v.slice(v.indexOf("-") + 1) : null];
  const [na, pa] = split(a);
  const [nb, pb] = split(b);
  for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return na[i] < nb[i] ? -1 : 1;
  if (pa === pb) return 0;
  if (pa === null) return 1;
  if (pb === null) return -1;
  return pa < pb ? -1 : 1;
}

/** 게임 id 마다 keep(id → 남길 버전)보다 낮은 wgba/<id>/<버전>.wgba 삭제. wgba/ 밖·형식이 다른 키·keep 에 없는 id 는 건드리지 않음. */
async function pruneOld(r2, keys, keep, { dryRun }) {
  let count = 0;
  let bytes = 0;
  for (const [key, size] of keys) {
    const hit = GAME_KEY_RE.exec(key);
    if (!hit || !keep.has(hit[1]) || compareVersions(hit[2], keep.get(hit[1])) >= 0) continue;
    if (!dryRun) await r2Delete(r2, key);
    console.log(`${dryRun ? "삭제할 것" : "삭제함"}  비공개 ${key} ${n(size)}바이트`);
    count++;
    bytes += size;
  }
  return { count, bytes };
}

/** 이미 올라간 이전 버전 정리: 게임 id 마다 가장 높은 버전만 남김. */
export async function privatePrune({ dryRun = false, config = null } = {}) {
  const r2 = config ?? privateConfig();
  const listed = await r2List(r2, { prefix: "wgba/" });
  const keep = new Map();
  for (const key of listed.objects.keys()) {
    const hit = GAME_KEY_RE.exec(key);
    if (hit && (!keep.has(hit[1]) || compareVersions(hit[2], keep.get(hit[1])) > 0)) keep.set(hit[1], hit[2]);
  }
  const done = await pruneOld(r2, [...listed.objects].map(([k, v]) => [k, v.size]), keep, { dryRun });
  console.log(`${dryRun ? "--dry-run: 삭제하지 않았습니다 — 삭제할 것" : "비공개 버킷 정리 완료 — 삭제"} ${done.count}개 ${n(done.bytes)}바이트 · 남김 ${[...keep].map(([id, v]) => `${id} ${v}`).join(", ")}`);
  return 0;
}

/** 전체 .wgba → 비공개 버킷 wgba/<게임 id>/<버전>.wgba(원본 파일 이름과 무관, 받을 때 저장 이름 = saveFileName, 같은 크기·내용이면 건너뜀, 버킷 확인 = 목록 1번). */
export async function privateUpload(files, { dryRun = false, remote = false, config = null } = {}) {
  const plan = [];
  for (const file of files) {
    const bytes = new Uint8Array(fs.readFileSync(file));
    const { id, version, names } = await manifestOf(bytes);
    if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(id) || !id.includes(".")) throw new Error(`게임 id 가 없거나 형식이 다릅니다: ${path.basename(file)}`);
    if (!SEMVER_RE.test(version)) throw new Error(`버전이 x.y.z 형식이 아닙니다: ${path.basename(file)} (${version})`);
    plan.push({ key: `wgba/${id}/${version}.wgba`, bytes, file, save: saveFileName({ id, version, names }) });
  }
  if (dryRun && !remote) {
    for (const item of plan) console.log(`비공개 올릴 것 ${item.key} ${n(item.bytes.length)}바이트 · 저장 이름 ${item.save} (원본 ${path.basename(item.file)})`);
    console.log(`--dry-run: 비공개 버킷에 올리지 않았습니다(${plan.length}개)`);
    return 0;
  }
  const r2 = config ?? privateConfig();
  const listed = await r2List(r2, { prefix: "wgba/" });
  let put = 0;
  for (const item of plan) {
    const head = listed.objects.get(item.key);
    const md5 = crypto.createHash("md5").update(item.bytes).digest("hex");
    if (head && head.size === item.bytes.length && (head.etag === md5 || head.etag.includes("-"))) {
      console.log(`같음  비공개 ${item.key}`);
      continue;
    }
    if (dryRun) {
      console.log(`비공개 올릴 것 ${item.key} ${n(item.bytes.length)}바이트 · 저장 이름 ${item.save} · ${head ? "버킷과 다름" : "버킷에 없음"}`);
      put++;
      continue;
    }
    await r2Put(r2, item.key, item.bytes, { contentType: "application/octet-stream", cacheControl: "no-store" });
    listed.objects.set(item.key, { size: item.bytes.length, etag: md5 });
    console.log(`올림  비공개 ${item.key} ${n(item.bytes.length)}바이트 · 저장 이름 ${item.save}`);
    put++;
  }
  console.log(`${dryRun ? "--dry-run --remote: 비공개 버킷에 올리지 않았습니다 — 올릴 것" : "비공개 버킷 완료 — 올림"} ${put}개 · 같음 ${plan.length - put}개 · 버킷 확인 목록 ${listed.requests}번`);
  // 올리기가 모두 끝난 뒤에만: 같은 게임 id 의 이번에 올린 최고 버전보다 낮은 것 삭제
  const keep = new Map();
  for (const item of plan) {
    const [, id, version] = GAME_KEY_RE.exec(item.key);
    if (!keep.has(id) || compareVersions(version, keep.get(id)) > 0) keep.set(id, version);
  }
  const done = await pruneOld(r2, [...listed.objects].map(([k, v]) => [k, v.size]), keep, { dryRun });
  if (done.count) console.log(`${dryRun ? "삭제할 것" : "이전 버전 삭제"} ${done.count}개 ${n(done.bytes)}바이트`);
  return 0;
}
