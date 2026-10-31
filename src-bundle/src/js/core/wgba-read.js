// 앱(exe·웹)이 .wgba 를 열 때 쓰는 읽기 — 목차(webgba.toc)가 있으면 설명서·롬팩 그림·code·롬 조각을 꺼낸다.
// 목차가 없는 옛 .wgba·.wasm 은 null(지금처럼 파일 전체를 컴파일하고 webgba.rom 구획을 찾는다).
// code 조각만 컴파일하므로 롬·그림이 wasm 엔진 메모리에 올라가지 않는다. 조각마다 목차의 SHA-256 을 확인한다
// (롬팩 그림은 망가져도 그 그림만 빼고 연다 — 규격 6장). 문장은 t() 키를 코드에 그대로 적는다(i18n-keys 검사).
import { t } from "../shell/i18n.js";
import { buildId, CART_PARTS, cartScale, checkManifest, codeWasm, FLAG_REQUIRED, imageHead, KIND_NAME, LIMITS, NEEDS, readTocFrom, romHeader, sha256Hex, unpackChunk, WgbaError } from "./wgba-format.js";

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** 이 호스트가 지금 해 줄 수 있는 needs(멀티플레이는 아직). */
export const HOST_HAS = Object.freeze({ pointer: true, state: true, keyboard: true, net: false });

/**
 * 파일 전체 바이트 → { toc, manifest, build, code, romPayload, romSha1, images } 또는 null(목차 없음).
 * code·romPayload 는 bytes 의 subarray(복사 없음). images = { label|front|spine: { bytes, format, width, height, scale } }.
 * 망가졌거나 새 규격이면 WgbaError(code "newer" = 새 webGBA 필요).
 */
export async function readWgba(bytes) {
  const toc = await readTocFrom(bytes);
  if (!toc) return null;
  if (toc.fileLen !== bytes.length) throw new WgbaError(`목차의 파일 길이 ${toc.fileLen} ≠ 실제 ${bytes.length}`, "length");
  for (const e of toc.entries) {
    if (e.end < e.start || e.end > bytes.length) throw new WgbaError(`조각 ${e.name} 이 파일 밖입니다`, "range");
    if (!(e.kind in KIND_NAME) && e.flags & FLAG_REQUIRED) throw new WgbaError(`모르는 필수 조각 종류 ${e.kind}`, "newer");
  }
  const entry = (name) => toc.entries.find((e) => e.name === name) ?? null;
  const stored = async (e) => {
    const part = bytes.subarray(e.start, e.end);
    if ((await sha256Hex(part)) !== e.sha256) throw new WgbaError(`조각 ${e.name} 의 SHA-256 이 다릅니다`, "hash");
    return part;
  };
  const me = entry("manifest");
  if (!me) throw new WgbaError("설명서 조각이 없습니다", "manifest");
  if (me.size > LIMITS.manifest) throw new WgbaError("설명서가 64KB 를 넘습니다", "manifest");
  let manifest;
  try {
    manifest = JSON.parse(utf8.decode(unpackChunk(await stored(me), me)));
  } catch (error) {
    if (error instanceof WgbaError) throw error;
    throw new WgbaError(`설명서 JSON: ${error.message}`, "manifest");
  }
  if (Number.isInteger(manifest?.wgba) && manifest.wgba > 1) throw new WgbaError(`설명서 규격 ${manifest.wgba}`, "newer");
  const unknownNeeds = (Array.isArray(manifest?.needs) ? manifest.needs : []).filter((need) => !NEEDS.includes(need));
  if (unknownNeeds.length) throw new WgbaError(`needs ${unknownNeeds.join(", ")}`, "newer");
  const errors = [];
  checkManifest(manifest, errors, []);
  if (errors.length) throw new WgbaError(errors[0], "manifest");
  const ce = entry("code");
  if (!ce) throw new WgbaError("조각 code 가 없습니다", "code");
  const code = await stored(ce);
  const re = entry("rom");
  let romPayload = null;
  let romSha1 = "";
  if (re) {
    romPayload = await stored(re);
    romSha1 = romHeader(romPayload).sha1;
  }
  const images = {};
  for (const [part, info] of Object.entries(CART_PARTS)) {
    const e = entry(info.chunk);
    if (!e || e.size > LIMITS.cart) continue;
    try {
      const data = unpackChunk(await stored(e), e);
      const head = imageHead(data);
      const scale = head?.lossless ? cartScale(part, head.width, head.height) : 0;
      if (scale) images[part] = { bytes: data, format: head.format, width: head.width, height: head.height, scale };
    } catch {
      // 그 그림만 기본 모양
    }
  }
  return { toc, manifest, build: await buildId(toc), code, romPayload, romSha1, images };
}

/** code 조각 → 컴파일한 모듈(wasm 머리를 붙여서). */
export const compileCode = (code) => WebAssembly.compile(codeWasm(code));

/** 설명서의 글(글 하나 또는 언어별 객체) → 보일 글: 사용자 언어 → en → 첫 값. */
export function pickText(value, lang = "ko") {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return value[lang] ?? value.en ?? Object.values(value).find((v) => typeof v === "string") ?? "";
}

/** 이 webGBA 가 아직 못 여는 게임이면 그 까닭 { code, … }, 열 수 있으면 null. */
export function supportProblem(manifest, has = HOST_HAS) {
  if (manifest.runtime === "script") return { code: "script" };
  const width = manifest.screen?.width ?? 240;
  const height = manifest.screen?.height ?? 160;
  if (width !== 240 || height !== 160) return { code: "screen", width, height };
  const missing = (manifest.needs ?? []).filter((need) => !has[need]);
  if (missing.length) return { code: "needs", list: missing };
  return null;
}

export function problemText(problem) {
  if (problem.code === "script") return t("wgba.noScript");
  if (problem.code === "screen") return t("wgba.noScreen", { width: problem.width, height: problem.height });
  return t("wgba.noNeeds", { list: problem.list.map((need) => (need === "net" ? t("wgba.need.net") : need)).join(", ") });
}

/** readWgba 의 오류 → 보일 문장. */
export function wgbaErrorText(error) {
  const code = error?.code ?? "";
  if (code === "newer") return t("wgba.newer");
  if (code === "manifest") return t("wgba.badManifest", { why: error.message });
  if (code === "rom") return t("wgba.badRom");
  return t("wgba.damaged");
}

/** 설명서 → 앱이 게임 항목에 둘 값(라이브러리·정보 화면). 그림 바이트는 따로. */
export function gameInfo(wgba) {
  const m = wgba.manifest;
  const cart = {};
  if (m.cart?.color) cart.color = m.cart.color;
  for (const [part, image] of Object.entries(wgba.images)) {
    cart[part] = { format: image.format, width: image.width, height: image.height, scale: image.scale };
    if (part === "front" && Array.isArray(m.cart?.front?.labelAt)) cart.front.labelAt = m.cart.front.labelAt;
    if (part === "spine" && Array.isArray(m.cart?.spine?.textArea)) cart.spine.textArea = m.cart.spine.textArea;
  }
  return {
    gameId: m.id,
    version: m.version,
    build: wgba.build,
    title: m.name,
    shortName: m.shortName ?? "",
    author: typeof m.author === "string" ? m.author : "",
    romSha1: wgba.romSha1,
    cart,
  };
}

/** 정보 화면 한 줄: "포켓몬 Rapid 1.2.0" */
export const titleLine = (info, lang) => `${pickText(info.title, lang)} ${info.version}`.trim();
