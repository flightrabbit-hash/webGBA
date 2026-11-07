// 차이 패치 SourceCopy 시험 — node 만, 롬·앱·네트워크 없이. node tools/test/wgbd-srccopy.mjs
// ① 롬이 그대로인 버전 사이에서 새 code 가 롬 블록(원작 롬과 같은 바이트)을 담으면 원작 롬 검사에 걸리지 않게 확장 바탕으로 다시 만들어
//    그 블록을 옛 롬에서 복사(SourceCopy)하는지, 앱과 같은 코드(applyDelta)로 적용해 새 파일과 같은지.
// ② 확장 바탕의 뒤쪽(풀린 롬)이 같은 4바이트 열쇠로 해시 사슬을 채워도 앞쪽(옛 파일)의 일치를 찾는지(split).
// 임의 바이트("rom" 조각·"원작 롬" — 롬 아님)만 쓴다.
import crypto from "crypto";
import { inflate } from "../../src-bundle/src/js/vendor/pako.js";
import { packWgba } from "../../src-bundle/src/js/core/wgba-format.js";
import { bpsApply } from "../../src-bundle/src/js/core/wgbp.js";
import { applyDelta, readDeltaHead } from "../../src-bundle/src/js/core/wgba-update.js";
import { makeBps } from "../lib/bps-make.mjs";
import { loadOrig, makeDelta, origHits } from "../lib/wgbd-make.mjs";

let failed = 0;
const ok = (cond, text, detail = "") => {
  console.log(`${cond ? "통과" : "실패"} ${text}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const rnd = (n) => new Uint8Array(crypto.randomBytes(n));

/** BPS 동작별 바이트 수 [SourceRead, TargetRead, SourceCopy, TargetCopy]. */
function commandBytes(bps) {
  let at = 4;
  const num = () => {
    let data = 0;
    let shift = 1;
    for (;;) {
      const x = bps[at++];
      data += (x & 0x7f) * shift;
      if (x & 0x80) return data;
      shift *= 128;
      data += shift;
    }
  };
  num();
  num();
  at += num();
  const end = bps.length - 12;
  const by = [0, 0, 0, 0];
  while (at < end) {
    const data = num();
    const command = data % 4;
    const length = Math.floor(data / 4) + 1;
    by[command] += length;
    if (command === 1) at += length;
    else if (command >= 2) num();
  }
  return by;
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

function gameWasm(payload) {
  const types = sec(1, vec([[0x60, 0, 1, 0x7f], [0x60, 1, 0x7f, 1, 0x7f]]));
  const funcs = sec(3, vec([[0], [1], [0]]));
  const mem = sec(5, vec([[0x00, 3]]));
  const exps = sec(7, vec([[...str("memory"), 2, 0], [...str("Web_Init"), 0, 0], [...str("Web_RunFrame"), 0, 1], [...str("Web_GetFramebuffer"), 0, 2]]));
  const code = sec(10, vec([[...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 1, 0x0b], [...u(4), 0, 0x41, 0, 0x0b]]));
  const blob = sec(0, [...str("x.blob"), ...payload]);
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...funcs, ...mem, ...exps, ...code, ...blob]);
}

/* ── ① 같은 롬 · 새 code 에 롬 블록 ── */
// 롬은 16가지 값만 써서 zlib 이 실제로 압축하게 — 완전한 임의 바이트는 저장 블록으로 들어가 옛 파일에 날바이트로 남음
const nibbles = (n) => rnd(n).map((b) => 0x30 + (b & 15));
const orig = nibbles(512 * 1024);
const rom = orig.slice();
rom.set(nibbles(1000), 10000);
rom[0xb2] = 0x96;
const payload1 = rnd(200 * 1024);
const payload2 = payload1.slice();
const ROM_AT = 300000;
const ROM_LEN = 6000;
payload2.set(rom.subarray(ROM_AT, ROM_AT + ROM_LEN), 60000);
payload2.set(payload1.subarray(10000, 14000), 120000);
payload2.set(rnd(500), 150000);
const manifest = (version) => ({ wgba: 1, id: "io.example.srccopy-test", version, name: "SourceCopy Test", runtime: "webapi", input: { preset: "gba" } });
const v1 = (await packWgba({ wasm: gameWasm(payload1), manifest: manifest("1.0.0"), rom })).bytes;
const v2 = (await packWgba({ wasm: gameWasm(payload2), manifest: manifest("1.1.0"), rom })).bytes;
const origs = [loadOrig("orig.bin", orig)];

const plainBps = makeBps(v1, v2, "");
const plainHits = origHits(plainBps, origs).hits[0];
ok(plainHits.count > 0 && plainHits.bytes >= ROM_LEN - 64, "옛 파일만 바탕으로 하면 롬 블록이 새 바이트로 들어감(원작 롬 검사에 걸림)", `${plainHits.count}개 ${plainHits.bytes}바이트`);

const unchecked = await makeDelta(v1, v2);
ok(unchecked.info.sameRom && !unchecked.info.expanded, "원작 롬을 주지 않으면 그대로 옛 파일만 바탕(적용이 빠름)");

const logs = [];
const checked = await makeDelta(v1, v2, { origs, log: (line) => logs.push(line) });
const checkedHits = checked.info.orig.hits[0];
ok(checked.info.sameRom && checked.info.expanded, "원작 롬 검사에 걸리면 확장 바탕(옛 파일 ‖ 풀린 옛 롬)으로 다시 만듦", logs.join(" / "));
ok(checkedHits.count === 0 && checkedHits.bytes === 0, "다시 만든 패치에는 원작 롬과 같은 구간 0", JSON.stringify(checkedHits));
const head = readDeltaHead(checked.bytes);
const bps = inflate(checked.bytes.subarray(head.headLen));
const by = commandBytes(bps);
ok(by[1] < 1500 && by[2] >= ROM_LEN + 4000, "롬 블록·옮긴 블록은 SourceCopy, 새로 넣는 바이트는 바뀐 500바이트 정도", `SourceRead ${by[0]} · TargetRead ${by[1]} · SourceCopy ${by[2]} · TargetCopy ${by[3]}`);
ok(same(await applyDelta(v1, checked.bytes), v2), "앱과 같은 코드(applyDelta)로 적용 → 새 파일과 바이트까지 같음");
ok(checked.bytes.length < unchecked.bytes.length, "패치 크기도 줄어듦", `${unchecked.bytes.length} → ${checked.bytes.length}바이트`);

/* ── ② 확장 바탕 구역별 해시 사슬 ── */
const file = rnd(64 * 1024);
const BLOCK_AT = 20000;
const BLOCK_LEN = 2048;
const block = file.subarray(BLOCK_AT, BLOCK_AT + BLOCK_LEN);
// 블록의 모든 자리에 대해 "5바이트만 같고 6번째가 다른" 조각을 49개씩 → 열쇠마다 사슬(48)이 뒤쪽 자리로 가득 참
const pieces = [];
for (let i = 0; i + 6 <= BLOCK_LEN; i++) {
  const piece = new Uint8Array(6);
  piece.set(block.subarray(i, i + 5));
  piece[5] = block[i + 5] ^ 0x5a;
  for (let k = 0; k < 49; k++) pieces.push(piece);
}
const tail = new Uint8Array(pieces.length * 6);
pieces.forEach((piece, k) => tail.set(piece, k * 6));
const source = new Uint8Array(file.length + tail.length);
source.set(file);
source.set(tail, file.length);
const target = new Uint8Array(8192);
target.set(rnd(3000));
target.set(block, 3000);
target.set(rnd(target.length - 3000 - BLOCK_LEN), 3000 + BLOCK_LEN);
const one = makeBps(source, target, "");
const two = makeBps(source, target, "", { split: file.length });
const oneBy = commandBytes(one);
const twoBy = commandBytes(two);
ok(oneBy[1] > 3000 + BLOCK_LEN / 2, "사슬 하나면 앞쪽 블록을 놓침(시험이 뜻이 있음)", `TargetRead ${oneBy[1]}`);
ok(twoBy[1] <= target.length - BLOCK_LEN + 8 && twoBy[2] >= BLOCK_LEN - 8, "구역을 나누면 앞쪽 블록을 SourceCopy 로 찾음", `TargetRead ${twoBy[1]} · SourceCopy ${twoBy[2]}`);
ok(same(bpsApply(source, one), target) && same(bpsApply(source, two), target), "두 BPS 모두 앱 코드(bpsApply)로 적용 → 결과 같음");

console.log(failed ? `실패 ${failed}개` : "모두 통과");
process.exitCode = failed ? 1 : 0;
