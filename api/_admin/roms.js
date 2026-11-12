import { saveFileName } from "./save-name.js";

// 롬 가져오기 목록 roms.json(공개 버킷) — 발행 도구 upload --wgba·private-prune 이 쓰고, 서버 list 가 1번 읽는다.
// .wgba 머리를 게임마다 범위 GET 하면 목록 1번 = Class B 게임 수만큼이라, 발행 때 한 파일로 모아 둔다.
export const ROMS = Object.freeze({
  FILE: "roms.json",
  FORMAT: 1,
  URL: "https://pub-da193dc1ff6540a4a6654def95a1a92f.r2.dev/roms.json",
  MAX: 4 * 1024 * 1024,
  LABEL_MAX: 360000,
  ITEMS_MAX: 200,
});

const ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?$/;
const LABEL_RE = /^data:image\/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const NAME_MAX = 120;
const GROUPS = ["emu", "arcade", "mobile"];
const CATEGORY_RE = /^[ -~]{1,24}$/;

const textOk = (value) => typeof value === "string" && value.length > 0 && value.length <= NAME_MAX;

export function cleanNames(value) {
  if (textOk(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const lang of ["ko", "en", "ja"]) if (textOk(value[lang])) out[lang] = value[lang];
  return Object.keys(out).length ? out : null;
}

/** 게임 하나(머리 읽은 값 + 버킷 객체 정보) → roms.json 항목. group·category = 라이브러리 그룹(발행 묶음 groups.json, 없으면 넣지 않음). */
export function romItem({ id, version, key, size, etag = "", names = null, short = null, label = null, group = null, category = null }) {
  const item = { id, version, key, size, etag, file: saveFileName({ id, version, names }), names: cleanNames(names), short: cleanNames(short), label: typeof label === "string" && LABEL_RE.test(label) && label.length <= ROMS.LABEL_MAX ? label : null };
  if (GROUPS.includes(group)) {
    item.group = group;
    if (typeof category === "string" && CATEGORY_RE.test(category)) item.category = category;
  }
  return item;
}

export function romsText(items, time) {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  return `${JSON.stringify({ wgbaRoms: ROMS.FORMAT, time, items: sorted })}\n`;
}

/** roms.json 글 → 서버 list 항목(형식이 다른 항목은 뺌) 또는 null(파일 형식이 다름). 저장 이름은 파일 값을 믿지 않고 다시 계산. */
export function readRoms(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || data.wgbaRoms !== ROMS.FORMAT || !Array.isArray(data.items)) return null;
  const out = [];
  for (const item of data.items.slice(0, ROMS.ITEMS_MAX)) {
    if (!item || typeof item !== "object" || !ID_RE.test(item.id ?? "") || !VERSION_RE.test(item.version ?? "")) continue;
    if (item.key !== `wgba/${item.id}/${item.version}.wgba` || !Number.isSafeInteger(item.size) || item.size <= 0) continue;
    const { file, names, short, label, group, category } = romItem(item);
    out.push({ key: item.key, id: item.id, version: item.version, names, short, size: item.size, file, label, ...(group ? { group, ...(category ? { category } : {}) } : {}) });
  }
  return out;
}
