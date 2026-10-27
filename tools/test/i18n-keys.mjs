// 번역 표 검사(앱 없이): 세 언어 표의 키가 같은지, 자리 표시({name} 등)가 같은지, 화면·Rust 코드가 쓰는 키가 모두 있는지.
//   node tools/test/i18n-keys.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = path.join(root, "src-bundle", "src");
const LANGS = ["ko", "en", "ja"];
const tables = Object.fromEntries(LANGS.map((id) => [id, JSON.parse(fs.readFileSync(path.join(src, "i18n", `${id}.json`), "utf8"))]));
const problems = [];

const slots = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const id of LANGS) {
  for (const key of Object.keys(tables.ko)) {
    if (!(key in tables[id])) problems.push(`${id}: 키 없음 ${key}`);
    else if (slots(tables.ko[key]) !== slots(tables[id][key])) problems.push(`${id}: 자리 표시 다름 ${key}`);
    else if (!String(tables[id][key]).trim() && String(tables.ko[key]).trim()) problems.push(`${id}: 빈 값 ${key}`);
  }
  for (const key of Object.keys(tables[id])) if (!(key in tables.ko)) problems.push(`${id}: 한국어 표에 없는 키 ${key}`);
}

const walk = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), ext) : e.name.endsWith(ext) ? [path.join(dir, e.name)] : []));
const used = new Set();
const text = (file) => fs.readFileSync(file, "utf8");
for (const file of walk(path.join(src, "js"), ".js")) {
  for (const m of text(file).matchAll(/\bt\(\s*"([a-zA-Z][\w.-]*)"/g)) used.add(m[1]);
  for (const m of text(file).matchAll(/\?\s*"((?:menu|rail|status|panel|win|theme|cfg)\.[\w.-]+)"\s*:\s*"((?:menu|rail|status|panel|win|theme|cfg)\.[\w.-]+)"/g)) {
    used.add(m[1]);
    used.add(m[2]);
  }
}
for (const m of text(path.join(src, "html", "index.html")).matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)) used.add(m[1]);
for (const file of walk(path.join(root, "src-tauri", "src"), ".rs")) for (const m of text(file).matchAll(/tr1?\(\s*"(rs\.[\w.-]+)"/g)) used.add(m[1]);

const DYNAMIC = [
  ...["general", "keys", "theme", "language"].map((n) => `cfg.tab.${n}`),
  ...["midnight", "dark", "nord", "monokai", "solardark", "dracula", "forest", "light", "sepia", "ragdoll", "solarized", "contrast", "custom"].flatMap((m) => [`theme.mode.${m}`, `theme.note.${m}`]),
  ...["any", "light", "dark"].flatMap((m) => [`theme.tone.${m}`, `theme.tone.${m}.note`]),
  ...["any", "gray", "red", "orange", "yellow", "green", "teal", "blue", "violet", "pink"].flatMap((m) => [`theme.cast.${m}`, `theme.cast.${m}.note`]),
  ...LANGS.map((id) => `lang.${id}`),
  ...["A", "B", "L", "R", "START", "SELECT", "UP", "DOWN", "LEFT", "RIGHT", "FAST"].map((k) => `key.${k}`),
  ...["ShiftRight", "ShiftLeft", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "Space", "Enter", "Backspace", "Tab", "NumpadEnter"].map((k) => `keyCode.${k}`),
  "status.besideCopied", "status.besideReplaced", "status.exitSaveCopied", "status.exitSaveReplaced",
  "panel.favoritesEmpty", "panel.filesEmpty", "panel.filesNone",
];
for (const key of DYNAMIC) used.add(key);

const settingsJs = text(path.join(src, "js", "app", "settings.js"));
const fieldKeys = [...settingsJs.matchAll(/\{ key: "(\w+)"([^}]*)\}/g)];
for (const [, key, rest] of fieldKeys) {
  used.add(`cfg.${key}`);
  used.add(`cfg.${key}.note`);
  const options = /options: \[([^\]]*)\]/.exec(rest);
  if (options) for (const o of options[1].split(",")) used.add(`cfg.${key}.${o.trim().replace(/"/g, "")}`);
  if (/type: "folder"/.test(rest)) for (const s of ["default", "pick", "reset"]) used.add(`cfg.${key}.${s}`);
  if (/type: "clear"/.test(rest)) used.add(`cfg.${key}.clear`);
  if (/type: "text"/.test(rest)) for (const s of ["default", "reset"]) used.add(`cfg.${key}.${s}`);
}
for (const m of settingsJs.matchAll(/group: "(\w+)",(\s*note: true)?/g)) {
  used.add(`cfg.group.${m[1]}`);
  if (m[2]) used.add(`cfg.group.${m[1]}.note`);
}
for (const m of settingsJs.matchAll(/\{ id: "(\w+)", keys: \[([^\]]*)\]/g)) {
  used.add(`theme.group.${m[1]}`);
  if (m[1] !== "text") used.add(`theme.group.${m[1]}.note`);
  for (const k of m[2].split(",")) used.add(`theme.token.${k.trim().replace(/"--|"/g, "")}`);
}
for (const m of settingsJs.matchAll(/"(cfg\.headNote\.\w+)"/g)) used.add(m[1]);

for (const key of used) if (!(key in tables.ko)) problems.push(`쓰는데 표에 없는 키 ${key}`);
const unused = Object.keys(tables.ko).filter((key) => !used.has(key));

console.log(`표 키 ${Object.keys(tables.ko).length}개 · 코드가 쓰는 키 ${used.size}개 · 표에만 있는 키 ${unused.length}개${unused.length ? ` (${unused.join(", ")})` : ""}`);
for (const line of problems) console.log(`실패 ${line}`);
console.log(problems.length ? `\n${problems.length}건 실패` : "\n모두 통과");
process.exit(problems.length ? 1 : 0);
