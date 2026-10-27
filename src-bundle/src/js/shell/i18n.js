export const LANGS = [
  { id: "ko", label: "한국어", locale: "ko-KR" },
  { id: "en", label: "English", locale: "en-US" },
  { id: "ja", label: "日本語", locale: "ja-JP" },
];

export const CHANGED = "webgba:i18n";

const tables = {};

let current = "ko";

export const lang = () => current;

export const known = (id) => LANGS.some((item) => item.id === id);

export const locale = () => (LANGS.find((item) => item.id === current) ?? LANGS[0]).locale;

async function load(id) {
  if (tables[id]) return tables[id];
  const response = await fetch(`/i18n/${id}.json`);
  if (!response.ok) throw new Error(`i18n/${id}.json ${response.status}`);
  tables[id] = await response.json();
  return tables[id];
}

export function t(key, vars) {
  const text = tables[current]?.[key] ?? tables.ko?.[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : whole));
}

export function translate(root = document) {
  for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll("[data-i18n-title]")) node.title = t(node.dataset.i18nTitle);
  for (const node of root.querySelectorAll("[data-i18n-aria]")) node.setAttribute("aria-label", t(node.dataset.i18nAria));
}

export async function use(id) {
  const next = known(id) ? id : "ko";
  await load("ko");
  try {
    await load(next);
    current = next;
  } catch {
    current = "ko";
  }
  if (typeof document === "undefined") return current;
  document.documentElement.lang = current;
  translate();
  document.dispatchEvent(new CustomEvent(CHANGED, { detail: { lang: current } }));
  return current;
}
