// hello-webapi: the smallest runtime "webapi" game for .wgba (no JS, no ROM).
// The whole 240x160 screen is filled with a colour that changes with the pressed buttons.
//
// Build (in this folder; game.wasm is already here, so this step is optional):
//   clang --target=wasm32 -O2 -nostdlib -Wl,--no-entry -o game.wasm game.c
// Pack and check (from the webGBA repository root):
//   node tools/wgba.mjs pack -o hello.wgba --wasm docs/wgba/examples/hello-webapi/game.wasm
//        --manifest docs/wgba/examples/hello-webapi/manifest.json --cart-dir docs/wgba/examples/hello-webapi/cart
//   node tools/wgba.mjs check hello.wgba
#include <stdint.h>

#define W 240
#define H 160

// Pixels in memory order R, G, B, A (one little-endian uint32 = 0xAABBGGRR).
static uint32_t fb[W * H];

// Import "webgba.v1" (does nothing). Hosts that do not know this spec refuse the game instead of
// asking for a ROM it does not need.
__attribute__((import_module("webgba"), import_name("v1"))) void webgba_v1(void);

__attribute__((export_name("Web_Init"))) int Web_Init(void) {
  webgba_v1();
  return 1;
}

// keys: bit 0 A, 1 B, 2 SELECT, 3 START, 4 RIGHT, 5 LEFT, 6 UP, 7 DOWN, 8 R, 9 L (input preset "gba").
__attribute__((export_name("Web_RunFrame"))) int Web_RunFrame(int keys) {
  static uint32_t t;
  t++;
  uint32_t r = (keys & 1) ? 0xF0 : 0x30;          // A: red
  uint32_t g = (keys & 2) ? 0xD0 : 0x40;          // B: green
  uint32_t b = 0x60 + ((t >> 1) & 0x7F);          // slow blue pulse
  if (keys & 0xF0) b = 0xFF;                      // any direction: bright blue
  uint32_t color = 0xFF000000u | (b << 16) | (g << 8) | r;
  for (int i = 0; i < W * H; i++) fb[i] = color;
  return 1;  // 0 would stop the game
}

__attribute__((export_name("Web_GetFramebuffer"))) uint32_t *Web_GetFramebuffer(void) { return fb; }
