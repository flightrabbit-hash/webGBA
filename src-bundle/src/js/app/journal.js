import { core } from "../bridge.js";
import { meterLimits } from "./player.js";

const CHECK_MS = 1000;
const BEAT_MS = 5000;
const PERF_MS = 30000;
const FREEZE_MS = 3000;
const STALL_GAP_MS = 10000;
const FAULT_GAP_MS = 60000;
const FAULT_KEEP = 50;
const CORE_PER_SEC = 20;

const sec = (ms) => (ms / 1000).toFixed(1);
const fixed = (n) => n.toFixed(1);

const shortWhere = (text) => text.replace(/https?:\/\/[^/\s)]+\//g, "").replace(/wasm:\/\/wasm\/[0-9a-f]+:/g, "");

function stackWhere(stack) {
  if (typeof stack !== "string") return "";
  const frames = stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "));
  return frames
    .slice(0, 3)
    .map((line) => shortWhere(line.slice(3)))
    .join(" ← ");
}

export function errorText(value, where = "") {
  const head = value && typeof value === "object" && "message" in value ? `${value.name ?? "Error"}: ${value.message}` : String(value);
  const at = where ? shortWhere(where) : stackWhere(value?.stack);
  return at ? `${head} @ ${at}` : head;
}

export class Journal {
  constructor(player) {
    this.player = player;
    this.timer = 0;
    this.watching = false;
    this.beatAt = 0;
    this.frozen = 0;
    this.frameFrozen = 0;
    this.stallAt = -Infinity;
    this.stalls = 0;
    this.faults = new Map();
    this.coreAt = 0;
    this.coreLines = 0;
    this.coreDropped = 0;
  }

  info(tag, text) {
    core.log("INFO", `[${tag}] ${text}`);
  }

  warn(tag, text) {
    core.log("WARN", `[${tag}] ${text}`);
  }

  error(tag, text) {
    core.log("ERROR", `[${tag}] ${text}`);
  }

  watch(on) {
    on = Boolean(on);
    if (on === this.watching) return;
    this.watching = on;
    this.beatAt = performance.now();
    core.logBeat(on);
    if (on && !this.timer) this.timer = setInterval(() => this.check(), CHECK_MS);
    if (!on) {
      clearInterval(this.timer);
      this.timer = 0;
      this.frozen = 0;
      this.frameFrozen = 0;
    }
  }

  where() {
    const p = this.player;
    return [document.hasFocus() ? "창 초점 있음" : "창 초점 없음", p.paused ? "일시정지" : "실행 중", p.net.active ? "멀티플레이 중" : ""].filter(Boolean).join(" · ");
  }

  check() {
    const now = performance.now();
    if (now - this.beatAt >= BEAT_MS) {
      this.beatAt = now;
      core.logBeat(true);
    }
    this.flushCore(now);
    const p = this.player;
    const m = p.meter;
    if (!p.running || !p.host || !m) return;
    if (m.stall) {
      const gap = m.stall;
      m.stall = 0;
      this.stalls++;
      if (this.frozen) {
        this.warn("멈춤", `화면 갱신 다시 옴 · ${sec(gap)}초 멈춤`);
        this.frozen = 0;
      } else if (now - this.stallAt >= STALL_GAP_MS) {
        this.stallAt = now;
        this.warn("멈춤", `화면 갱신이 ${sec(gap)}초 멈췄다가 이어짐 · ${this.where()}`);
      }
    }
    const idle = now - p.last;
    if (idle >= FREEZE_MS && !p.clockOn && !this.frozen) {
      this.frozen = p.last;
      this.warn("멈춤", `화면 갱신(requestAnimationFrame)이 ${sec(idle)}초째 오지 않음 · 페이지 스크립트는 응답함 · ${this.where()}`);
    } else if (this.frozen && idle < FREEZE_MS) {
      this.warn("멈춤", `화면 갱신 다시 옴 · 약 ${sec(now - this.frozen)}초 멈춤`);
      this.frozen = 0;
    }
    if (p.host.script) this.checkFrame(now, m);
    if (m.run >= PERF_MS) this.info("성능", this.perfText(p.takeMeter()));
  }

  checkFrame(now, m) {
    const p = this.player;
    if (!m.statAt || p.paused || p.netHold) return;
    const quiet = now - m.statAt;
    if ((quiet >= FREEZE_MS || m.zero >= FREEZE_MS / 1000) && !this.frameFrozen) {
      this.frameFrozen = now;
      this.warn("멈춤", quiet >= FREEZE_MS ? `게임 틀이 ${sec(quiet)}초째 화면 통계를 보내지 않음(틀 응답 없음)` : `게임 틀 화면 갱신 0fps ${m.zero}초째 · ${this.where()}`);
    } else if (this.frameFrozen && quiet < FREEZE_MS && m.zero === 0) {
      this.warn("멈춤", `게임 틀 화면 갱신 다시 옴 · 약 ${sec(now - this.frameFrozen)}초 뒤`);
      this.frameFrozen = 0;
    }
  }

  perfText(m) {
    const p = this.player;
    const parts = [`${sec(m.run)}초`];
    if (p.host?.script) {
      if (m.fpsN) parts.push(`평균 ${fixed(m.fps / m.fpsN)}fps(게임 틀)`, `최저 ${fixed(m.fpsMin)}fps`, `${meterLimits.lowFps}fps 미만 ${m.low}초`);
      else parts.push("게임 틀 통계 없음");
    } else {
      parts.push(`평균 ${fixed((m.frames * 1000) / Math.max(m.run, 1))}fps`);
      if (m.frames) parts.push(`프레임 처리 평균 ${(m.cost / m.frames).toFixed(2)}ms·최장 ${fixed(m.worst)}ms`, `${meterLimits.slowMs}ms 넘은 프레임 ${m.slow}`);
    }
    parts.push(`화면 간격 최장 ${Math.round(m.gapMax)}ms(${meterLimits.lateMs}ms 넘음 ${m.late})`);
    if (m.fast) parts.push(`빨리 감기 ${sec(m.fast)}초`);
    if (this.stalls) parts.push(`멈춤 ${this.stalls}번`);
    if (p.net.active) parts.push("멀티플레이 중");
    this.stalls = 0;
    return parts.join(" · ");
  }

  fault(kind, value, where = "") {
    const text = errorText(value, where);
    const now = Date.now();
    const key = `${kind}|${text}`;
    const seen = this.faults.get(key);
    if (seen && now - seen.at < FAULT_GAP_MS) {
      seen.more++;
      return;
    }
    if (!seen && this.faults.size >= FAULT_KEEP) this.faults.clear();
    this.faults.set(key, { at: now, more: 0 });
    this.error("오류", `${kind} ${text}${seen?.more ? ` · 지난 1분 같은 오류 ${seen.more}번 더` : ""}`);
  }

  coreLine(line) {
    const now = performance.now();
    this.flushCore(now);
    if (this.coreLines < CORE_PER_SEC) {
      this.coreLines++;
      core.log("WARN", `[코어] ${line}`);
    } else this.coreDropped++;
  }

  flushCore(now) {
    if (now - this.coreAt < 1000) return;
    if (this.coreDropped) this.warn("코어", `줄이 많아 ${this.coreDropped}줄 생략(1초 ${CORE_PER_SEC}줄까지)`);
    this.coreAt = now;
    this.coreLines = 0;
    this.coreDropped = 0;
  }
}
