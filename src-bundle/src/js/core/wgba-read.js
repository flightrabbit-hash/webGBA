// 앱(exe·웹)이 .wgba 를 열 때 쓰는 읽기 — 목차(webgba.toc)가 있으면 설명서·롬팩 그림·code·롬 조각을 꺼낸다.
// 목차가 없는 옛 .wgba·.wasm 은 null(지금처럼 파일 전체를 컴파일하고 webgba.rom 구획을 찾는다).
// code 조각만 컴파일하므로 롬·그림이 wasm 엔진 메모리에 올라가지 않는다. 조각마다 목차의 SHA-256 을 확인한다
// (롬팩 그림은 망가져도 그 그림만 빼고 연다 — 규격 6장). 문장은 t() 키를 코드에 그대로 적는다(i18n-keys 검사).
import { t } from "../shell/i18n.js";
import { buildId, CART_PARTS, cartScale, CATEGORY_RE, checkManifest, codeWasm, FLAG_REQUIRED, GAME_GROUPS, imageHead, isMobile, KIND, KIND_NAME, LIMITS, NEEDS, parseAspect, ratioOf, readTocFrom, romHeader, sha256Hex, shownTitle, unpackChunk, WgbaError } from "./wgba-format.js";
import { pickText } from "./lang-text.js";

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** 이 호스트가 지금 해 줄 수 있는 needs. */
export const HOST_HAS = Object.freeze({ pointer: true, state: true, keyboard: true, net: true });

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
  // ② 자체 JS: 조각 js(풀어서, 규격 1 은 이름이 늘 "js" — entry.js 의 다른 값은 check 가 경고), 데이터 조각은 게임이 부를 때(chunk) 확인·풀기
  let js = null;
  if (manifest.runtime === "script") {
    const je = entry("js");
    if (!je || je.kind !== KIND.js) throw new WgbaError("조각 js 가 없습니다", "code");
    js = unpackChunk(await stored(je), je);
  }
  const chunk = async (name) => {
    const e = entry(name);
    if (!e || e.kind !== KIND.data) throw new WgbaError(`데이터 조각 ${name} 이 없습니다`, "data");
    return unpackChunk(await stored(e), e);
  };
  return { toc, manifest, build: await buildId(toc), code, romPayload, romSha1, images, js, chunk };
}

/** code 조각 → 컴파일한 모듈(wasm 머리를 붙여서). */
export const compileCode = (code) => WebAssembly.compile(codeWasm(code));

export { pickText };

/** 이 webGBA 가 아직 못 여는 게임이면 그 까닭 { code, … }, 열 수 있으면 null. ② 자체 JS·240×160 이 아닌 화면도 연다(S4). */
export function supportProblem(manifest, has = HOST_HAS) {
  const missing = (manifest.needs ?? []).filter((need) => !has[need]);
  if (missing.length) return { code: "needs", list: missing };
  return null;
}

export function problemText(problem) {
  return t("wgba.noNeeds", { list: problem.list.map((need) => (need === "net" ? t("wgba.need.net") : need)).join(", ") });
}

/** 설명서 화면 크기 { width, height, integer, aspect, stretch } — 없으면 GBA 240×160, scale "integer" 면 정수 배율 권장. */
export function screenOf(manifest) {
  const s = manifest?.screen ?? {};
  const width = s.width ?? 240;
  const height = s.height ?? 160;
  const own = ratioOf(width, height);
  const aspect = parseAspect(manifest?.display?.aspect) ?? own;
  return { width, height, integer: s.scale === "integer", aspect, stretch: aspect[0] !== own[0] || aspect[1] !== own[1] };
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
    title: shownTitle(m.name, m),
    shortName: m.shortName ? shownTitle(m.shortName, m) : "",
    mobile: isMobile(m),
    ...(GAME_GROUPS.includes(m.group) ? { group: m.group, category: typeof m.category === "string" && CATEGORY_RE.test(m.category) ? m.category : "" } : {}),
    author: typeof m.author === "string" ? m.author : "",
    romSha1: wgba.romSha1,
    cart,
    update: m.update && typeof m.update === "object" ? { feed: String(m.update.feed ?? ""), key: String(m.update.key ?? "") } : null,
  };
}

/** 정보 화면 한 줄: "포켓몬 Rapid 1.2.0" */
export const titleLine = (info, lang) => `${pickText(info.title, lang)} ${info.version}`.trim();
