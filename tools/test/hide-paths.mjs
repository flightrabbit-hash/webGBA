// 화면 글에서 전체 경로를 파일 이름으로 바꾸는 규칙(index.js 의 hidePaths)을 확인한다.
//   node tools/test/hide-paths.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src-bundle", "src", "js", "pages", "index.js"), "utf8");
const line = source.split("\n").find((l) => l.startsWith("const PATH_IN_TEXT"));
const PATH_IN_TEXT = eval(line.replace("const PATH_IN_TEXT = ", "").replace(/;$/, ""));
const hidePaths = (text) => String(text).replace(PATH_IN_TEXT, (whole, name) => name);

const cases = [
  ["열지 못했습니다: C:\\a b\\rom\\test.gba: 지정된 경로를 찾을 수 없습니다. (os error 3)", "열지 못했습니다: test.gba: 지정된 경로를 찾을 수 없습니다. (os error 3)"],
  ["D:\\Games\\내 게임\\My Game (E).gba", "My Game (E).gba"],
  ["\\\\?\\C:\\x\\웹 빌드\\game.wasm: 오류", "game.wasm: 오류"],
  ["세이브를 내보냈습니다: test.sav", "세이브를 내보냈습니다: test.sav"],
  ["롬 C:\\g\\a.gba · 세이브를 불러왔습니다", "롬 a.gba · 세이브를 불러왔습니다"],
  ["준비되었습니다", "준비되었습니다"],
];
let failed = 0;
for (const [input, want] of cases) {
  const got = hidePaths(input);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "통과" : "실패"} ${got}${ok ? "" : `  (기대: ${want})`}`);
}
process.exit(failed ? 1 : 0);
