// BPS 패치 만들기(make-wgbp.mjs 가 씀). 적용은 src-bundle/src/js/core/wgbp.js 의 bpsApply(앱과 같은 코드).
// 형식: byuu 의 BPS — "BPS1", 원본·결과·메타 크기(가변 길이 수), 동작 SourceRead / TargetRead / SourceCopy / TargetCopy,
// 끝 12바이트 = 원본·결과·패치 CRC32. 찾기는 4바이트 열쇠 해시 사슬(원본·지금까지 쓴 결과), 같은 자리 읽기를 먼저 본다.
import { crc32 } from "../../src-bundle/src/js/core/wgbp.js";

const HBITS = 22;
const HSIZE = 1 << HBITS;
const MIN = 6;
const CHAIN = 48;

function key4(b, i) {
  return Math.imul(b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24), 2654435761) >>> (32 - HBITS);
}

class Out {
  constructor(capacity) {
    this.buf = new Uint8Array(Math.max(1024, capacity));
    this.n = 0;
  }
  grow(k) {
    if (this.n + k <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }
  byte(x) {
    this.grow(1);
    this.buf[this.n++] = x;
  }
  bytes(src, start, end) {
    this.grow(end - start);
    this.buf.set(src.subarray(start, end), this.n);
    this.n += end - start;
  }
  num(v) {
    for (;;) {
      const x = v % 128;
      v = Math.floor(v / 128);
      if (v === 0) {
        this.byte(0x80 | x);
        return;
      }
      this.byte(x);
      v--;
    }
  }
  u32(v) {
    this.byte(v & 0xff);
    this.byte((v >>> 8) & 0xff);
    this.byte((v >>> 16) & 0xff);
    this.byte((v >>> 24) & 0xff);
  }
}

/** 원본 → 결과 BPS(Uint8Array). meta 는 패치 안에 남는 글(utf8). */
export function makeBps(source, target, meta = "") {
  const sHead = new Int32Array(HSIZE).fill(-1);
  const sPrev = new Int32Array(source.length).fill(-1);
  for (let i = 0; i + 4 <= source.length; i++) {
    const k = key4(source, i);
    sPrev[i] = sHead[k];
    sHead[k] = i;
  }
  const tHead = new Int32Array(HSIZE).fill(-1);
  const tPrev = new Int32Array(target.length).fill(-1);
  let tIndexed = 0;
  const out = new Out(target.length >> 3);
  out.bytes(new TextEncoder().encode("BPS1"), 0, 4);
  out.num(source.length);
  out.num(target.length);
  const m = new TextEncoder().encode(meta);
  out.num(m.length);
  if (m.length) out.bytes(m, 0, m.length);
  const N = target.length;
  let at = 0;
  let literal = -1;
  let sourceRel = 0;
  let targetRel = 0;
  const flush = () => {
    if (literal < 0) return;
    out.num((at - literal - 1) * 4 + 1);
    out.bytes(target, literal, at);
    literal = -1;
  };
  const indexTarget = (upto) => {
    for (; tIndexed < upto && tIndexed + 4 <= N; tIndexed++) {
      const k = key4(target, tIndexed);
      tPrev[tIndexed] = tHead[k];
      tHead[k] = tIndexed;
    }
  };
  while (at < N) {
    let same = 0;
    while (at + same < N && at + same < source.length && source[at + same] === target[at + same]) same++;
    let best = 0;
    let kind = 0;
    let from = 0;
    if (same < 32 && at + 4 <= N) {
      const k = key4(target, at);
      const trySource = (p) => {
        if (p < 0 || p >= source.length) return;
        let l = 0;
        while (at + l < N && p + l < source.length && source[p + l] === target[at + l]) l++;
        const gain = l - (p === sourceRel ? 1 : 4);
        const bestGain = best - (kind === 2 && from === sourceRel ? 1 : 4);
        if (l >= MIN && gain > bestGain) {
          best = l;
          kind = 2;
          from = p;
        }
      };
      trySource(sourceRel);
      for (let p = sHead[k], c = 0; p >= 0 && c < CHAIN; p = sPrev[p], c++) trySource(p);
      indexTarget(at);
      for (let p = tHead[k], c = 0; p >= 0 && c < CHAIN; p = tPrev[p], c++) {
        let l = 0;
        while (at + l < N && target[p + l] === target[at + l]) l++;
        if (l >= MIN && l > best + 2) {
          best = l;
          kind = 3;
          from = p;
        }
      }
    }
    if (same >= 4 && same + 3 >= best) {
      flush();
      out.num((same - 1) * 4);
      at += same;
      continue;
    }
    if (best >= MIN) {
      flush();
      out.num((best - 1) * 4 + kind);
      const rel = kind === 2 ? sourceRel : targetRel;
      const d = from - rel;
      out.num(Math.abs(d) * 2 + (d < 0 ? 1 : 0));
      if (kind === 2) sourceRel = from + best;
      else targetRel = from + best;
      at += best;
      continue;
    }
    if (literal < 0) literal = at;
    at++;
  }
  flush();
  out.u32(crc32(source));
  out.u32(crc32(target));
  out.u32(crc32(out.buf, 0, out.n));
  return out.buf.slice(0, out.n);
}
