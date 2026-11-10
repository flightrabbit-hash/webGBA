// .wgbd(차이 패치) 만들기 — wgba.mjs diff 가 씀. 적용은 앱과 같은 src-bundle/src/js/core/wgba-update.js 의 applyDelta.
//
// 몸통 = zlib(BPS). BPS 바탕은 옛 파일, 옛 롬 조각이 zlib 이면 옛 파일 ‖ 풀린 옛 롬("확장 바탕" — 새 code 안의 롬과 같은 바이트를
// 옛 롬에서 복사). 롬이 그대로인 버전 사이는 옛 파일만 쓰고, 원작 롬 검사에 걸릴 때만 확장 바탕으로 다시 만든다.
// 새 롬이 옛 롬과 다르고 zlib 이면 BPS 결과 = 새 파일 앞부분(롬 내용 앞까지) ‖ 풀린 새 롬, 앱이 pako 9 로 다시 묶는다
// ("롬 다시 묶기" — 압축된 롬 바이트의 차이는 거의 전부라서). 다시 묶은 결과가 새 파일과 바이트까지 같을 때만 쓰고, 아니면 파일 그대로 BPS.
// 만든 뒤 앱과 같은 코드로 적용해 새 파일과 같은지 확인한다. 원작 롬(--orig)을 주면 패치에 새로 들어가는 바이트(BPS TargetRead)에
// 원작 롬과 32바이트 이상 같은 구간이 있는지 본다(.wgbp 와 같은 기준) — 있으면 실패.
import crypto from "crypto";
import { makeBps } from "./bps-make.mjs";
import { findRomRanges, indexRom } from "./rom-ranges.mjs";
import { concat, romPayloadFrom } from "../../src-bundle/src/js/core/wgbp.js";
import { applyDelta, DELTA_EXPANDED, DELTA_REBUILT, expandedSource, romPlace, writeDelta } from "../../src-bundle/src/js/core/wgba-update.js";
import { readTocFrom, unpackChunk, unpackRom } from "../../src-bundle/src/js/core/wgba-format.js";

const sha1 = (bytes) => crypto.createHash("sha1").update(bytes).digest();

/** 설명서 id·version(없으면 빈 값). */
export async function manifestOf(bytes) {
  const toc = await readTocFrom(bytes);
  const entry = toc?.entries.find((e) => e.name === "manifest");
  if (!entry) return { id: "", version: "" };
  const m = JSON.parse(new TextDecoder().decode(unpackChunk(bytes.subarray(entry.start, entry.end), entry)));
  return { id: m.id ?? "", version: m.version ?? "", names: m.name ?? null };
}

/** BPS 안 TargetRead(새로 넣는 바이트) 구간 [시작, 끝) — 패치 바이트 기준. */
export function bpsLiterals(bps) {
  const spans = [];
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
  while (at < end) {
    const data = num();
    const command = data % 4;
    const length = Math.floor(data / 4) + 1;
    if (command === 1) {
      spans.push([at, at + length]);
      at += length;
    } else if (command >= 2) num();
  }
  return spans;
}

/** 원작 롬과 같은 구간(min 바이트 이상) 개수·합계. */
export function origHits(bps, origs, min = 32) {
  const spans = bpsLiterals(bps).filter(([a, b]) => b - a >= min);
  const hits = [];
  for (const orig of origs) {
    const found = findRomRanges(orig.index, bps, { min, spans });
    hits.push({ name: orig.name, count: found.length, bytes: found.reduce((sum, r) => sum + r.length, 0) });
  }
  return { literal: spans.reduce((sum, [a, b]) => sum + (b - a), 0), hits };
}

export const loadOrig = (name, bytes) => ({ name, index: indexRom(bytes) });

const hitCount = (orig) => orig?.hits.reduce((sum, hit) => sum + hit.count, 0) ?? 0;

/**
 * old·new(.wgba 바이트) → { bytes, mode, info }. mode: "file" | "rebuilt". expand: 확장 바탕 사용(기본 true).
 */
export async function makeDelta(oldBytes, newBytes, { expand = true, origs = [], log = () => {} } = {}) {
  const t0 = Date.now();
  const oldMeta = await manifestOf(oldBytes);
  const newMeta = await manifestOf(newBytes);
  const oldRom = await romPlace(oldBytes);
  const newRom = await romPlace(newBytes);
  const sameRom = Boolean(oldRom && newRom && Buffer.from(oldRom.payload).equals(Buffer.from(newRom.payload)));
  const ctx = { oldMeta, newMeta, newRom, sameRom, origs, log };
  // 롬이 그대로면 옛 롬 조각을 통째로 복사하므로 풀어 붙이지 않는다(적용이 빨라짐). 새 code 가 롬 바이트를 담아 원작 롬 검사에
  // 걸릴 때만 확장 바탕으로 다시 만든다 — 그 바이트는 패치 대신 사용자의 옛 롬에서 복사(SourceCopy)
  let made = await deltaWith(oldBytes, newBytes, expand && !sameRom, ctx);
  let applyMs = made.info.applyMs;
  if (expand && sameRom && hitCount(made.info.orig)) {
    const again = await deltaWith(oldBytes, newBytes, true, ctx);
    applyMs += again.info.applyMs;
    if (again.info.expanded) {
      log(`새 code 에 롬 바이트가 있어 확장 바탕(옛 파일 ‖ 풀린 옛 롬)으로 다시 만들었습니다 — 원작 롬과 같은 구간 ${hitCount(made.info.orig)} → ${hitCount(again.info.orig)}개`);
      if (hitCount(again.info.orig) < hitCount(made.info.orig)) made = again;
    }
  }
  made.info.makeMs = Date.now() - t0 - applyMs;
  return made;
}

async function deltaWith(oldBytes, newBytes, expand, { oldMeta, newMeta, newRom, sameRom, origs, log }) {
  const t0 = Date.now();
  const base = expand ? await expandedSource(oldBytes) : { bytes: oldBytes, expanded: false };
  let target = newBytes;
  let flags = base.expanded ? DELTA_EXPANDED : 0;
  let prefixLen = 0;
  let romLevel = 0;
  let romMethod = 0;
  if (newRom && !sameRom && newRom.payload[7] === 1) {
    const { rom, header } = await unpackRom(newRom.payload);
    const again = romPayloadFrom(rom, Buffer.from(header.sha1, "hex"), { level: 9 });
    if (Buffer.from(again).equals(Buffer.from(newRom.payload))) {
      target = concat([newBytes.subarray(0, newRom.start), rom]);
      flags |= DELTA_REBUILT;
      prefixLen = newRom.start;
      romLevel = 9;
      romMethod = 1;
    } else log("롬 조각을 pako 9 로 다시 묶으면 바이트가 달라 파일 그대로 비교합니다");
  }
  const bps = makeBps(base.bytes, target, "", { split: base.expanded ? oldBytes.length : 0 });
  const tBps = Date.now();
  const bytes = writeDelta({
    flags,
    source: oldBytes.length,
    target: newBytes.length,
    sourceSha1: sha1(oldBytes),
    targetSha1: sha1(newBytes),
    bps,
    prefixLen,
    romLevel,
    romMethod,
    meta: { id: newMeta.id, from: oldMeta.version, to: newMeta.version },
  });
  const t1 = Date.now();
  const back = await applyDelta(oldBytes, bytes);
  const tApply = Date.now() - t1;
  if (!Buffer.from(back).equals(Buffer.from(newBytes))) throw new Error("만든 패치를 적용한 결과가 새 파일과 다릅니다");
  const orig = origs.length ? origHits(bps, origs) : null;
  return {
    bytes,
    info: {
      mode: flags & DELTA_REBUILT ? "rebuilt" : "file",
      expanded: base.expanded,
      bps: bps.length,
      size: bytes.length,
      oldMeta,
      newMeta,
      sameRom,
      makeMs: tBps - t0,
      applyMs: tApply,
      orig,
    },
  };
}
