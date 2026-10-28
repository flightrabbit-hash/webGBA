// .wgbp 적용 시험(앱과 같은 코드 src-bundle/src/js/core/wgbp.js 를 node 에서). 롬 종류별 결과·안내 코드, 망가진 .wgbp.
//   node tools/test/wgbp-node.mjs <파일.wgbp> <결과 롬.gba> <바탕 롬…>
// 바탕 롬들(.wgbp 를 만들 때의 --base)은 모두 기대 .wgba(manifest.wgba.sha1)를 만들어야 한다. 그 밖의 경우는 첫 바탕 롬을 고쳐
// 만든다: 뒤 FF 를 자른 롬·32MB 로 늘린 롬(받음), 결과 롬(이미 패치됨), 머리를 다른 게임·다른 언어로 바꾼 것, 한 바이트 고친 것,
// GBA 가 아닌 것, 빈 것(안내 코드). 망가진 .wgbp(머리·목록·덩어리·잘림·판)는 각자 맞는 안내 코드.
import crypto from "crypto";
import fs from "fs";
import { buildGame, readPatch, WgbpError } from "../../src-bundle/src/js/core/wgbp.js";

const [patchPath, targetPath, ...basePaths] = process.argv.slice(2);
if (!patchPath || !targetPath || !basePaths.length) {
  console.error("사용법: node tools/test/wgbp-node.mjs <파일.wgbp> <결과 롬.gba> <바탕 롬…>");
  process.exit(2);
}
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "통과" : "실패"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const file = new Uint8Array(fs.readFileSync(patchPath));
const patch = readPatch(file);
const want = patch.manifest.wgba.sha1;

async function expectGame(name, rom) {
  const t0 = Date.now();
  try {
    const made = await buildGame(patch, rom);
    check(name, made.sha1 === want && made.same, `${made.base.name} · ${made.wgba.length}바이트 · ${Date.now() - t0}ms`);
  } catch (error) {
    check(name, false, String(error.message));
  }
}

async function expectCode(name, rom, code, p = patch) {
  try {
    await buildGame(p, rom);
    check(name, false, "만들어짐(거절해야 함)");
  } catch (error) {
    check(name, error instanceof WgbpError && error.code === code, `${error.code ?? error.message}${error.params?.code ? ` ${error.params.code}` : ""}${error.params?.why ? ` ${error.params.why}` : ""}`);
  }
}

function expectRead(name, bytes, code, why) {
  try {
    readPatch(bytes);
    check(name, false, "읽힘(거절해야 함)");
  } catch (error) {
    check(name, error instanceof WgbpError && error.code === code && (!why || error.params?.why === why), `${error.code}${error.params?.why ? ` ${error.params.why}` : ""}`);
  }
}

const bases = basePaths.map((p) => new Uint8Array(fs.readFileSync(p)));
for (const [i, rom] of bases.entries()) await expectGame(`바탕 롬 ${i + 1}`, rom);
const first = bases[0];
let end = first.length;
while (end > 0 && first[end - 1] === 0xff) end--;
await expectGame("뒤 FF 를 자른 롬", first.slice(0, Math.ceil(end / 0x10000) * 0x10000));
const doubled = new Uint8Array(first.length * 2).fill(0xff);
doubled.set(first);
await expectGame("32MB 로 늘린 롬(뒤가 FF)", doubled);
await expectCode("이미 패치된 롬", new Uint8Array(fs.readFileSync(targetPath)), "romAlready");
const header = (code, title) => {
  const rom = first.slice();
  for (let k = 0; k < 4; k++) rom[0xac + k] = code.charCodeAt(k);
  if (title) for (let k = 0; k < 12; k++) rom[0xa0 + k] = k < title.length ? title.charCodeAt(k) : 0;
  let sum = 0;
  for (let k = 0xa0; k <= 0xbc; k++) sum += rom[k];
  rom[0xbd] = -(sum + 0x19) & 0xff;
  return rom;
};
const code = String.fromCharCode(...first.subarray(0xac, 0xb0));
await expectCode("다른 게임(머리 BPGE)", header("BPGE", "POKEMON LEAF"), "romOther");
await expectCode("다른 언어판(머리 마지막 글자 J)", header(`${code.slice(0, 3)}J`), "romOtherLang");
const edited = first.slice();
edited[0x100000] ^= 0xff;
await expectCode("한 바이트 고친 롬", edited, "romModified");
await expectCode("GBA 가 아닌 파일", new Uint8Array(4096).fill(0x41), "romNotGba");
await expectCode("빈 파일", new Uint8Array(0), "romNotGba");

expectRead("머리가 다른 파일", Uint8Array.from([0x50, 0x4b, 3, 4, ...new Uint8Array(64)]), "notPatch");
const v2 = file.slice();
v2[6] = 2;
expectRead("모르는 형식 판", v2, "patchVersion");
const badList = file.slice();
badList[16 + 5] ^= 0x01;
expectRead("목록 한 바이트 깨짐", badList, "patchCorrupt", "manifest");
expectRead("목록 중간에서 잘림", file.slice(0, 40), "patchCorrupt", "header");
const blobAt = 16 + new DataView(file.buffer, file.byteOffset).getUint32(8, true);
const badBlob = file.slice();
badBlob[blobAt + patch.manifest.wasm.blob.off + 1000] ^= 0xff;
await expectCode("wasm 덩어리 깨짐", bases[0], "patchCorrupt", readPatch(badBlob));
await expectCode("뒤가 잘린 .wgbp", bases[0], "patchCorrupt", readPatch(file.slice(0, file.length - 4096)));

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length}개 중 ${results.length - failed}개 통과 · 기대 .wgba SHA-1 ${want} · 결과 롬 ${sha1(fs.readFileSync(targetPath)).slice(0, 8)}`);
process.exitCode = failed ? 1 : 0;
