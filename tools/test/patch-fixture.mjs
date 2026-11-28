// 패치 고르기 시험용 둘째 패치 재료(롬 없음 · 저장소 밖 출력). 같은 부모 롬에 패치가 2개일 때(여러 개 체크)를 시험하려고
// 부모 롬의 바이트 1개를 바꾼 결과 롬 + 작은 wasm 의 .wgba(id local.patchtest)를 만든다. 이어서 make-wgbp 로 .wgbp 를 만든다.
//   node tools/test/patch-fixture.mjs <부모 롬.gba> <출력 폴더>
//   node tools/make-wgbp.mjs <출력>/patchtest.wgba <출력>/patchtest.gba <출력>/patchtest.wgbp --base <부모 롬.gba> --label "<이름>" --title "Patch Test"
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";

const [romPath, outDir] = process.argv.slice(2);
if (!romPath || !outDir) {
  console.error("사용법: node tools/test/patch-fixture.mjs <부모 롬.gba> <출력 폴더>");
  process.exit(2);
}
if (path.resolve(outDir).toLowerCase().startsWith(fileURLToPath(new URL("../..", import.meta.url)).toLowerCase())) {
  console.error("출력 폴더가 저장소 안입니다(롬이 든 파일은 저장소에 두지 않음)");
  process.exit(2);
}
const u = (n) => {
  const o = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    o.push(b);
  } while (n);
  return o;
};
const str = (t) => [...u(t.length), ...Buffer.from(t)];
const sec = (id, body) => [id, ...u(body.length), ...body];
const vec = (items) => [...u(items.length), ...items.flat()];
const types = sec(1, vec([[0x60, 0, 1, 0x7f]]));
const funcs = sec(3, vec([[0], [0], [0]]));
const mem = sec(5, vec([[0x00, 1]]));
const exps = sec(7, vec([[...str("memory"), 2, 0], [...str("Web_Init"), 0, 0], [...str("Web_RunFrame"), 0, 1], [...str("Web_GetFramebuffer"), 0, 2]]));
const code = sec(10, vec([[...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 0, 0x0b]]));
const wasm = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...funcs, ...mem, ...exps, ...code]);

const rom = new Uint8Array(fs.readFileSync(romPath));
const target = rom.slice();
target[0x00f00000] ^= 0x5a;
fs.mkdirSync(outDir, { recursive: true });
const manifest = { wgba: 1, id: "local.patchtest", version: "1.0.0", name: { ko: "시험 패치", en: "Patch Test" }, runtime: "webapi", input: { preset: "gba" } };
const { bytes } = await packWgba({ wasm, manifest, rom: target });
fs.writeFileSync(path.join(outDir, "patchtest.gba"), target);
fs.writeFileSync(path.join(outDir, "patchtest.wgba"), bytes);
console.log(`만듦 ${path.join(outDir, "patchtest.wgba")} ${bytes.length}바이트 · 결과 롬 patchtest.gba`);
