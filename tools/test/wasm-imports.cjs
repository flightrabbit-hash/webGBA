// wasm 파일의 가져오기·내보내기 목록을 본다.
//   node tools/test/wasm-imports.cjs <파일.wasm>
const fs = require("fs");

const file = process.argv[2];
if (!file) {
  console.error("사용법: node tools/test/wasm-imports.cjs <파일.wasm>");
  process.exit(2);
}

const mod = new WebAssembly.Module(fs.readFileSync(file));
console.log("가져오기:");
for (const item of WebAssembly.Module.imports(mod)) console.log(`  ${item.module}.${item.name} (${item.kind})`);
const list = WebAssembly.Module.exports(mod);
console.log(`내보내기 ${list.length}개 (Web_Debug* 제외):`);
for (const item of list) if (!item.name.startsWith("Web_Debug")) console.log(`  ${item.name} (${item.kind})`);
