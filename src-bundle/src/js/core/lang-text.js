export const TEXT_LANGS = Object.freeze(["en", "ko", "ja"]);

const filled = (value) => typeof value === "string" && value.trim() !== "";

export function pickTextKey(value, lang) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of [lang, ...TEXT_LANGS]) if (typeof key === "string" && Object.hasOwn(value, key) && filled(value[key])) return key;
  return Object.keys(value).find((key) => filled(value[key])) ?? null;
}

export function pickText(value, lang) {
  if (typeof value === "string") return value;
  const key = pickTextKey(value, lang);
  return key === null ? "" : value[key];
}
