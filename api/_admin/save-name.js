const WIN_BAD = /[\\/:*?"<>|\x00-\x1f]/g;
const WIN_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

// 저장 이름은 버킷 객체 이름(사용자가 올린 firered.wgba 등)을 따르지 않고 게임 id로 정한다 — 사용자 폴더 이름과 맞춤.
// 표에 없는 게임 = 영어 이름을 소문자·하이픈으로. 영어 이름이 사용자 폴더 이름과 다른 게임만 표에 둔다.
export const SAVE_NAMES = Object.freeze({
  "com.flightrabbit.rapid": "pokemon-rapid-v.{version}",
  "local.bublbob2": "bubble-bobble-2",
  "local.hwanse": "gensei-kitan",
  "local.kof98": "king-of-fighters-98",
});

export function safeFileName(text, fallback = "game") {
  let name = String(text ?? "").replace(WIN_BAD, "_").replace(/\s+/g, " ").trim().replace(/^[. ]+|[. ]+$/g, "");
  name = [...name].slice(0, 80).join("").trim();
  if (!name) name = fallback;
  if (WIN_RESERVED.test(name)) name = `_${name}`;
  return `${name}.wgba`;
}

export function slugName(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function saveFileName({ id = "", version = "", names = null } = {}, fallback = "game") {
  const idText = String(id ?? "");
  const pattern = SAVE_NAMES[idText];
  if (pattern) return safeFileName(version ? pattern.replace("{version}", version) : pattern.replace(/[-.v]*\{version\}/, ""), fallback);
  const en = typeof names === "string" ? names : names?.en;
  return safeFileName(slugName(en) || slugName(idText.split(".").pop()), fallback);
}
