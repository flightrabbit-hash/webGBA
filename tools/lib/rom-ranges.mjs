// wasm 안에서 원작 롬과 같은 구간 찾기(make-wgbp.mjs 의 "빼고 다시 채우기").
// 32바이트 창 롤링 해시로 롬의 모든 자리를 색인하고(다른 바이트 값이 4개 미만인 창은 우연히 같을 수 있어 뺌),
// wasm 의 구획마다 일치를 찾아 양쪽으로 늘린다. 최소 길이(min) 이상만 남긴다. 비운 뒤 다시 찾아 더 없을 때까지 되풀이.
import { sections } from "../pack-wgba.mjs";

const K = 32;
const HB = 24;

function lowEntropy(b, i) {
  const seen = new Uint8Array(256);
  let count = 0;
  for (let k = 0; k < K; k++) {
    if (!seen[b[i + k]]) {
      seen[b[i + k]] = 1;
      if (++count >= 4) return false;
    }
  }
  return true;
}

let POW = 1;
for (let k = 0; k < K - 1; k++) POW = Math.imul(POW, 257) >>> 0;

function rolling(b, start, end, fn) {
  if (end - start < K) return;
  let h = 0;
  for (let k = 0; k < K; k++) h = (Math.imul(h, 257) + b[start + k]) >>> 0;
  for (let i = start; ; i++) {
    if (fn(i, h) === false) return;
    if (i + K >= end) break;
    h = (Math.imul((h - Math.imul(b[i], POW)) >>> 0, 257) + b[i + K]) >>> 0;
  }
}

export function indexRom(rom) {
  const head = new Int32Array(1 << HB).fill(-1);
  const next = new Int32Array(rom.length).fill(-1);
  rolling(rom, 0, rom.length, (i, h) => {
    if (lowEntropy(rom, i)) return;
    const k = h >>> (32 - HB);
    next[i] = head[k];
    head[k] = i;
  });
  return { rom, head, next };
}

function onePass(index, wasm, taken, min, spans) {
  const { rom, head, next } = index;
  const found = [];
  const free = (j) => {
    for (let k = 0; k < K; k++) if (taken[j + k]) return false;
    return true;
  };
  for (const [start, end] of spans) {
    let covered = start;
    let i = start;
    while (i + K <= end) {
      let hit = null;
      rolling(wasm, i, end, (j, h) => {
        if (lowEntropy(wasm, j)) return;
        if (head[h >>> (32 - HB)] < 0 || !free(j)) return;
        let best = null;
        for (let p = head[h >>> (32 - HB)], c = 0; p >= 0 && c < 64; p = next[p], c++) {
          let ok = true;
          for (let k = 0; k < K; k++) {
            if (rom[p + k] !== wasm[j + k]) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          let a = j;
          let b = p;
          while (a > covered && b > 0 && !taken[a - 1] && wasm[a - 1] === rom[b - 1]) {
            a--;
            b--;
          }
          let e = j + K;
          let f = p + K;
          while (e < end && f < rom.length && !taken[e] && wasm[e] === rom[f]) {
            e++;
            f++;
          }
          if (!best || e - a > best.length) best = { at: a, from: b, length: e - a };
        }
        if (best) {
          hit = { ...best, window: j };
          return false;
        }
      });
      if (!hit) break;
      if (hit.length >= min) {
        found.push(hit);
        covered = hit.at + hit.length;
      }
      i = hit.length >= min ? Math.max(hit.at + hit.length, i + 1) : Math.max(hit.window + 1, i + 1);
    }
  }
  return found;
}

/** wasm(바뀌지 않음) 안의 롬과 같은 구간들(겹치지 않음, 자리 순). spans 를 주지 않으면 wasm 의 모든 구획. */
export function findRomRanges(index, wasm, { min = 32, passes = 4, spans = null } = {}) {
  const where = spans ?? sections(Buffer.from(wasm.buffer, wasm.byteOffset, wasm.byteLength)).map((s) => [s.start, s.end]);
  const taken = new Uint8Array(wasm.length);
  const all = [];
  for (let pass = 0; pass < passes; pass++) {
    const found = onePass(index, wasm, taken, min, where);
    if (!found.length) break;
    for (const r of found) {
      taken.fill(1, r.at, r.at + r.length);
      all.push(r);
    }
  }
  all.sort((x, y) => x.at - y.at);
  return all;
}
