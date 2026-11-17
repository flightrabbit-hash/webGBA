// webGBA 호스트 → game.js fastMute 배선 계약 시험(헤드리스, node 만).
//   node --test web/test/web-fastmute.mjs
// 계약: 호스트가 게임에 { type: "fastMute", on: <boolean> } 를 보낸다(script-host.post).
import test from "node:test";
import assert from "node:assert/strict";
// 모듈이 로드 때 window·document 를 참조 → node 용 최소 스텁 후 동적 import.
globalThis.window ??= { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { href: "" }, navigator: { userAgent: "node" } };
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, documentElement: { style: { setProperty() {}, getPropertyValue: () => "" }, dataset: {} }, visibilityState: "visible", createElement: () => ({ getContext: () => ({ createImageData: () => ({}) }) }) };
globalThis.navigator ??= { userAgent: "node", maxTouchPoints: 0 };
const { ScriptHost } = await import("../../src-bundle/src/js/core/script-host.js");
const { Player } = await import("../../src-bundle/src/js/app/player.js");

test("script-host.setFastMute: {type:'fastMute',on} 전송 + 중복 생략", () => {
  const posts = [];
  const fake = { post: (m) => posts.push(m) }; // fastMute 미설정(초기 false 취급)
  ScriptHost.prototype.setFastMute.call(fake, true);
  ScriptHost.prototype.setFastMute.call(fake, true); // 같은 값 → 생략
  ScriptHost.prototype.setFastMute.call(fake, false);
  ScriptHost.prototype.setFastMute.call(fake, 0); // 불리언으로 정규화(false) → 생략
  assert.deepEqual(posts, [{ type: "fastMute", on: true }, { type: "fastMute", on: false }]);
});

function fakePlayer(fastMute) {
  const calls = [];
  const host = { script: true, setInput() {}, setSpeed() {}, setFastMute(on) { calls.push(on); } };
  const self = { host, running: true, paused: false, fastMute, held: 0, padNow: 0, macroOut: 0, runSpeed: 1, withMacro: (a) => a, resolveDpad: (a) => a, pushScript: Player.prototype.pushScript };
  return { self, calls, host };
}

test("player.pushScript: 지금 fastMute 를 host.setFastMute 로 전달", () => {
  const a = fakePlayer(true);
  Player.prototype.pushScript.call(a.self);
  assert.deepEqual(a.calls, [true]);
  const b = fakePlayer(false);
  Player.prototype.pushScript.call(b.self);
  assert.deepEqual(b.calls, [false]);
});

test("player.setFastMute: 값 설정 + pushScript 로 전송(토글 반영)", () => {
  const a = fakePlayer(false);
  Player.prototype.setFastMute.call(a.self, true);
  assert.equal(a.self.fastMute, true);
  assert.deepEqual(a.calls, [true]);
  Player.prototype.setFastMute.call(a.self, false);
  assert.equal(a.self.fastMute, false);
  assert.deepEqual(a.calls, [true, false]);
});

test("player.pushScript: host 에 setFastMute 없어도(일반 wasm 호스트) 안전", () => {
  const host = { script: true, setInput() {}, setSpeed() {} }; // setFastMute 없음
  const self = { host, running: true, paused: false, fastMute: true, held: 0, padNow: 0, macroOut: 0, runSpeed: 1, withMacro: (a) => a, resolveDpad: (a) => a };
  assert.doesNotThrow(() => Player.prototype.pushScript.call(self));
});
