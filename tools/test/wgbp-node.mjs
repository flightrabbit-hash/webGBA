// .wgbp 적용 시험(앱과 같은 코드 src-bundle/src/js/core/wgbp.js 를 node 에서). 롬 종류별 결과·안내 코드, 망가진 .wgbp.
//   node tools/test/wgbp-node.mjs <파일.wgbp> <결과 롬.gba> <바탕 롬…>
// 바탕 롬들(.wgbp 를 만들 때의 --base)은 모두 기대 .wgba(manifest.wgba.sha1)를 만들어야 한다. 그 밖의 경우는 첫 바탕 롬을 고쳐
// 만든다: 뒤 FF 를 자른 롬·32MB 로 늘린 롬(받음), 결과 롬(이미 패치됨), 머리를 다른 게임·다른 언어로 바꾼 것, 한 바이트 고친 것,
// GBA 가 아닌 것, 빈 것(안내 코드). 망가진 .wgbp(머리·목록·덩어리·잘림·판)는 각자 맞는 안내 코드.
// ZIP(앱이 롬 대신 .zip 을 받을 때와 같은 romChoices): 안 .gba 하나·하위 폴더·ZIP64·여럿 중 맞는 하나는 롬을 바로 준 것과 같은
// 바이트, .gba 없음·맞는 것 없음(첫 .gba 의 이유)·손상·암호·모르는 방식·32MB 넘는 항목은 각자 맞는 안내 코드. ZIP 은 시험 중에 만든다.
import crypto from "crypto";
import fs from "fs";
import { buildGame, readPatch, WgbpError } from "../../src-bundle/src/js/core/wgbp.js";
import { extractRom, romChoices, zipFile } from "../../src-bundle/src/js/core/zip.js";
import { makeZip } from "./zip-make.mjs";

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

const direct = Buffer.from((await buildGame(patch, first)).wgba);
const zipped = (files, options) => new Uint8Array(makeZip(files, options));
async function expectZip(name, zip, entry) {
  const t0 = Date.now();
  try {
    const made = await buildGame(patch, romChoices(zip));
    check(name, made.sha1 === want && Buffer.from(made.wgba).equals(direct) && made.entry === entry, `${made.entry} · ${made.wgba.length}바이트 · 롬 직접과 바이트 ${Buffer.from(made.wgba).equals(direct) ? "같음" : "다름"} · ${Date.now() - t0}ms`);
  } catch (error) {
    check(name, false, String(error.message));
  }
}
async function expectZipCode(name, zip, code, test = () => true) {
  try {
    await buildGame(patch, romChoices(zip));
    check(name, false, "만들어짐(거절해야 함)");
  } catch (error) {
    const p = error?.params ?? {};
    check(name, error instanceof WgbpError && error.code === code && test(p), `${error.code ?? error.message}${p.why ? ` ${p.why}` : ""}${p.method ? ` ${p.method}` : ""}${p.entry ? ` · ${p.entry}` : ""}${p.code ? ` ${p.code}` : ""}`);
  }
}
const readme = { name: "readme.txt", data: Buffer.from("not a rom") };
const other = header("BPGE", "POKEMON LEAF");
await expectZip("ZIP: 안 .gba 하나(Deflate)", zipped([readme, { name: "FireRed.gba", data: first }]), "FireRed.gba");
await expectZip("ZIP: 하위 폴더 안 .gba(저장 방식)", zipped([{ name: "roms/", data: [], method: 0 }, { name: "roms/gba/파이어레드.gba", data: first, method: 0 }]), "파이어레드.gba");
await expectZip("ZIP: ZIP64 형식", zipped([{ name: "FireRed.gba", data: first }], { zip64: true }), "FireRed.gba");
await expectZip("ZIP: macOS 덧붙이 파일(__MACOSX/._*.gba)은 건너뜀", zipped([{ name: "__MACOSX/._FireRed.gba", data: Buffer.alloc(4096, 1) }, { name: "._FireRed.gba", data: Buffer.alloc(4096, 2) }, { name: "FireRed.gba", data: first }]), "FireRed.gba");
const many = [{ name: "1 패치됨.gba", data: fs.readFileSync(targetPath) }, { name: "2 다른 게임.gba", data: other }, { name: "3 원래.gba", data: first }, { name: "4 고친.gba", data: edited }];
await expectZip("ZIP: 여러 개 중 맞는 하나(패치됨·다른 게임 뒤 셋째)", zipped(many), "3 원래.gba");
if (bases[1]) {
  const made = await buildGame(patch, romChoices(zipped([{ name: "a.gba", data: other }, { name: "b.gba", data: bases[1] }]))).catch((error) => error);
  check("ZIP: 여러 개 중 맞는 하나(바탕 롬 2)", made.sha1 === want && made.entry === "b.gba", `${made.entry ?? made.message} · ${made.base?.name ?? ""}`);
}
await expectZipCode("ZIP: .gba 없음", zipped([readme, { name: "FireRed.gbc", data: Buffer.alloc(1024) }]), "zipNoRom");
await expectZipCode("ZIP: 빈 ZIP", zipped([]), "zipNoRom");
await expectZipCode("ZIP: 맞는 것 없음 → 첫 .gba(다른 게임)의 이유", zipped([readme, { name: "x/다른 게임.gba", data: other }, { name: "고친.gba", data: edited }]), "romOther", (p) => p.entry === "다른 게임.gba" && p.code === "BPGE");
await expectZipCode("ZIP: 맞는 것 없음 → 첫 .gba(패치됨)의 이유", zipped([{ name: "패치됨.gba", data: fs.readFileSync(targetPath) }, { name: "고친.gba", data: edited }]), "romAlready", (p) => p.entry === "패치됨.gba");
const good = makeZip([{ name: "FireRed.gba", data: first }]);
await expectZipCode("ZIP: 손상(끝이 잘림)", new Uint8Array(good.subarray(0, good.length - 30)), "zipCorrupt");
await expectZipCode("ZIP: 손상(중앙 디렉토리 자리가 밖)", (() => { const b = new Uint8Array(good); b[b.length - 6] ^= 0x40; return b; })(), "zipCorrupt");
await expectZipCode("ZIP: 손상(압축 바이트 깨짐)", (() => { const b = new Uint8Array(good); b[30 + 11 + 5000] ^= 0xff; return b; })(), "zipCorrupt", (p) => p.entry === "FireRed.gba");
await expectZipCode("ZIP: 손상(CRC 다름, 저장 방식)", zipped([{ name: "FireRed.gba", data: first, method: 0, crc: 0x12345678 }]), "zipCorrupt", (p) => p.why === "crc");
await expectZipCode("ZIP: 손상(풀린 크기가 적힌 것보다 큼)", zipped([{ name: "FireRed.gba", data: first, size: first.length - 1 }]), "zipCorrupt");
await expectZipCode("ZIP: 손상(머리만 PK)", Uint8Array.from([0x50, 0x4b, 3, 4, ...new Uint8Array(200)]), "zipCorrupt");
try {
  zipFile(first);
  check("ZIP: 이름만 .zip 인 다른 형식(앱이 고른 .zip 을 넘기기 전)", false, "받음(거절해야 함)");
} catch (error) {
  check("ZIP: 이름만 .zip 인 다른 형식(앱이 고른 .zip 을 넘기기 전)", error instanceof WgbpError && error.code === "zipCorrupt" && error.params.why === "format", `${error.code} ${error.params?.why}`);
}
await expectZipCode("ZIP: 암호", zipped([{ name: "FireRed.gba", data: first, method: 0, flags: 1 }]), "zipEncrypted", (p) => p.entry === "FireRed.gba");
await expectZipCode("ZIP: AES 암호(방식 99)", zipped([{ name: "FireRed.gba", data: first, method: 99 }]), "zipEncrypted");
await expectZipCode("ZIP: 모르는 방식(LZMA)", zipped([{ name: "FireRed.gba", data: first, method: 14 }]), "zipMethod", (p) => p.method === "LZMA");
await expectZipCode("ZIP: 32MB 넘는 항목", zipped([{ name: "big.gba", data: Buffer.alloc(16), method: 0, size: 0x02000001 }]), "romTooBig");
await expectZip("ZIP: 암호 걸린 첫 .gba 뒤에 맞는 것", zipped([{ name: "a.gba", data: first, method: 0, flags: 1 }, { name: "b.gba", data: first }]), "b.gba");
try {
  const one = extractRom(new Uint8Array(makeZip([{ name: "small.bin", data: Buffer.alloc(64) }, { name: "dir/FireRed.gba", data: first }])));
  check("ZIP 열기(웹 일반 열기 extractRom): 가장 큰 .gba", one.name === "FireRed.gba" && Buffer.from(one.bytes).equals(Buffer.from(first)), one.name);
} catch (error) {
  check("ZIP 열기(웹 일반 열기 extractRom): 가장 큰 .gba", false, String(error.message));
}

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
