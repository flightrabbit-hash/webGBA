// net-webapi: a tiny runtime "webapi" multiplayer example for .wgba (no JS, no ROM).
// It only uses the multiplayer exports of the .wgba spec (chapter 7): webGBA opens the
// multiplayer window when Web_NetWanted() becomes non-zero, and the game just sends bytes.
//
//   A       ask for players (Web_NetWanted: purpose 1, 2-4 players)
//   L / R   ask as "host only" / "join only"
//   START   host: start a round when 2+ players are in the room (TO_ORDERED START)
//   B       send one 16384-byte message to everyone (TO_ORDERED)
//   SELECT  stop multiplayer (Web_NetWanted returns 0)
//
// During a round every player sends small commands with TO_ORDERED. Everybody folds the
// commands into one hash in the order webGBA delivers them, so all screens show the same
// colour bar at the end (the hash is also exported as Net_Hash for tests).
//
// Build (game.wasm is already here, so this step is optional):
//   clang --target=wasm32 -O2 -nostdlib -fno-builtin -Wl,--no-entry -o game.wasm game.c
#include <stdint.h>

#define W 240
#define H 160
#define ROUND_FRAMES 600
#define MSG 8
#define BIG 16384
#define OUT_CAP 65536

#define EXPORT(name) __attribute__((export_name(name)))

__attribute__((import_module("webgba"), import_name("v1"))) void webgba_v1(void);

void *memset(void *dst, int c, unsigned long n) {
  uint8_t *d = dst;
  while (n--) *d++ = (uint8_t)c;
  return dst;
}

void *memcpy(void *dst, const void *src, unsigned long n) {
  uint8_t *d = dst;
  const uint8_t *s = src;
  while (n--) *d++ = *s++;
  return dst;
}

enum { T_START = 1, T_CMD = 2, T_FIN = 3, T_END = 4, T_BIG = 5 };
enum { EV_OPEN = 1, EV_JOIN = 2, EV_LEAVE = 3, EV_CLOSED = 4, EV_STALL = 5, EV_RESUME = 6 };
enum { TO_ORDERED = 0xFE, TO_ALL = 0xFF };

static uint32_t fb[W * H];
static uint8_t out[OUT_CAP];
static uint32_t out_len;
static uint8_t in_buf[BIG];
static uint8_t big_msg[BIG];
static uint8_t alloc_area[1024];
static const char compat[] = "net-webapi-1";

static uint32_t host_protocol, host_flags;
static uint32_t wanted;
static uint32_t serial;
static int32_t slot = -1, count, is_open, closed_why;
static int32_t started, ended;
static uint32_t frame, rng = 1, hash = 2166136261u, applied, sent, fins, taken, prev_keys;
static uint32_t big_ok, big_bad, stalls;
static uint32_t ev_log[32], ev_count;

static void fold(uint32_t x) {
  for (int i = 0; i < 4; i++) hash = (hash ^ ((x >> (i * 8)) & 255u)) * 16777619u;
}

static int push(uint32_t to, const uint8_t *data, uint32_t n) {
  uint32_t need = 4 + ((n + 3) & ~3u);
  if (out_len + need > OUT_CAP) return 0;
  uint8_t *p = out + out_len;
  p[0] = (uint8_t)(n & 255);
  p[1] = (uint8_t)(n >> 8);
  p[2] = (uint8_t)to;
  p[3] = 0;
  memcpy(p + 4, data, n);
  out_len += need;
  return 1;
}

static int push_msg(uint32_t type, uint32_t value) {
  uint8_t m[MSG];
  m[0] = (uint8_t)type;
  m[1] = (uint8_t)slot;
  m[2] = 0;
  m[3] = 0;
  m[4] = (uint8_t)value;
  m[5] = (uint8_t)(value >> 8);
  m[6] = (uint8_t)(value >> 16);
  m[7] = (uint8_t)(value >> 24);
  return push(TO_ORDERED, m, MSG);
}

static uint32_t popcount(uint32_t x) {
  uint32_t n = 0;
  while (x) {
    n += x & 1u;
    x >>= 1;
  }
  return n;
}

static void apply(uint32_t from, const uint8_t *b, uint32_t len) {
  if (len < MSG) return;
  uint32_t type = b[0];
  uint32_t value = (uint32_t)b[4] | ((uint32_t)b[5] << 8) | ((uint32_t)b[6] << 16) | ((uint32_t)b[7] << 24);
  if (type == T_BIG) {
    int good = len == BIG && b[1] == from;
    for (uint32_t i = MSG; good && i < len; i++) good = b[i] == (uint8_t)(i * 7u + from);
    if (good) big_ok++;
    else big_bad++;
    return;
  }
  if (type == T_START) {
    started = 1;
    ended = 0;
    frame = 0;
    fins = 0;
    hash = 2166136261u;
    applied = 0;
    sent = 0;
    rng = 1;
  }
  if (!started || ended) return;
  fold(type | ((uint32_t)b[1] << 8) | (from << 16));
  fold(value);
  applied++;
  if (type == T_FIN) {
    fins |= 1u << b[1];
    if (slot == 0 && (int32_t)popcount(fins) >= count) push_msg(T_END, applied);
  }
  if (type == T_END) ended = 1;
}

EXPORT("Web_Init") int Web_Init(void) {
  webgba_v1();
  for (uint32_t i = 0; i < BIG; i++) big_msg[i] = 0;
  return 1;
}

EXPORT("Web_GetFramebuffer") uint32_t *Web_GetFramebuffer(void) { return fb; }

EXPORT("Web_NetHost") void Web_NetHost(uint32_t protocol, uint32_t flags) {
  host_protocol = protocol;
  host_flags = flags;
}

EXPORT("Web_NetWanted") uint32_t Web_NetWanted(void) { return wanted; }

EXPORT("Web_NetEvent") void Web_NetEvent(uint32_t kind, uint32_t a, uint32_t b) {
  ev_log[ev_count++ & 31] = (kind << 24) | ((a & 255u) << 16) | (b & 0xFFFFu);
  if (kind == EV_OPEN) {
    is_open = 1;
    slot = (int32_t)a;
    count = (int32_t)b;
    closed_why = 0;
  } else if (kind == EV_JOIN) {
    count = (int32_t)b;
  } else if (kind == EV_LEAVE) {
    if (count > 1) count--;
  } else if (kind == EV_CLOSED) {
    is_open = 0;
    closed_why = (int32_t)a;
    wanted = 0;
    started = 0;
    out_len = 0;
  } else if (kind == EV_STALL) {
    stalls++;
  }
}

EXPORT("Web_NetOut") uint8_t *Web_NetOut(void) { return out; }
EXPORT("Web_NetOutLen") uint32_t Web_NetOutLen(void) { return out_len; }
EXPORT("Web_NetOutClear") void Web_NetOutClear(void) { out_len = 0; }

EXPORT("Web_NetInBuffer") uint8_t *Web_NetInBuffer(uint32_t len) {
  if (len > BIG || taken >= 2) return 0;
  return in_buf;
}

EXPORT("Web_NetIn") void Web_NetIn(uint32_t from, uint32_t len) {
  taken++;
  apply(from, in_buf, len);
}

EXPORT("Web_NetCompat") const char *Web_NetCompat(void) { return compat; }

static void ask(uint32_t role) {
  serial = serial % 255u + 1u;
  wanted = 1u | (2u << 8) | (4u << 12) | (role << 16) | (serial << 24);
  closed_why = 0;
}

static void rect(int x, int y, int w, int h, uint32_t c) {
  for (int j = y; j < y + h && j < H; j++)
    for (int i = x; i < x + w && i < W; i++) fb[j * W + i] = c;
}

static uint32_t rgb(uint32_t r, uint32_t g, uint32_t b) { return 0xFF000000u | (b << 16) | (g << 8) | r; }

static void draw(void) {
  uint32_t bg = rgb(40, 44, 52);
  if (wanted && !is_open) bg = rgb(36, 60, 110);
  if (is_open) bg = rgb(30, 90, 60);
  if (started) bg = rgb(60, 40, 90);
  if (ended) bg = rgb(120, 96, 20);
  if (closed_why) bg = rgb(110, 36, 36);
  rect(0, 0, W, H, bg);
  for (int s = 0; s < 8; s++) {
    uint32_t c = s < count ? rgb(220, 220, 220) : rgb(70, 70, 70);
    if (s == slot) c = rgb(255, 210, 60);
    rect(8 + s * 28, 8, 22, 22, c);
  }
  if (started) rect(8, 40, (int)(224u * (frame > ROUND_FRAMES ? ROUND_FRAMES : frame) / ROUND_FRAMES), 8, rgb(240, 240, 240));
  for (int i = 0; i < 32; i++) rect(8 + (i % 16) * 14, 60 + (i / 16) * 14, 12, 12, (hash >> i) & 1u ? rgb(250, 250, 250) : rgb(20, 20, 20));
  if (ended) rect(8, 100, 224, 20, rgb(hash & 255u, (hash >> 8) & 255u, (hash >> 16) & 255u));
  for (uint32_t i = 0; i < big_ok && i < 16; i++) rect(8 + (int)i * 14, 130, 10, 10, rgb(80, 200, 255));
  if (!host_protocol) rect(0, H - 4, W, 4, rgb(255, 80, 80));
}

EXPORT("Web_RunFrame") int Web_RunFrame(int keys) {
  uint32_t k = (uint32_t)keys;
  uint32_t pressed = k & ~prev_keys;
  prev_keys = k;
  taken = 0;
  if (host_protocol) {
    if ((pressed & 1u) && !wanted) ask(0);
    if ((pressed & (1u << 9)) && !wanted) ask(1);
    if ((pressed & (1u << 8)) && !wanted) ask(2);
    if (pressed & 4u) wanted = 0;
    if ((pressed & 8u) && is_open && slot == 0 && count >= 2 && !started) push_msg(T_START, (uint32_t)count);
    if ((pressed & 2u) && is_open) {
      big_msg[0] = T_BIG;
      big_msg[1] = (uint8_t)slot;
      for (uint32_t i = MSG; i < BIG; i++) big_msg[i] = (uint8_t)(i * 7u + (uint32_t)slot);
      push(TO_ORDERED, big_msg, BIG);
    }
  }
  if (started && !ended && is_open) {
    frame++;
    if (frame <= ROUND_FRAMES) {
      rng = rng * 1103515245u + 12345u + (uint32_t)slot * 7919u;
      if (((rng >> 16) % 10u) < 3u && push_msg(T_CMD, sent)) sent++;
      if (frame == ROUND_FRAMES) push_msg(T_FIN, sent);
    }
  }
  draw();
  return 1;
}

EXPORT("Web_Alloc") uint8_t *Web_Alloc(uint32_t n) { return n <= sizeof alloc_area ? alloc_area : 0; }
EXPORT("Web_Free") void Web_Free(uint8_t *p) { (void)p; }
EXPORT("Web_StateSize") uint32_t Web_StateSize(void) { return 16; }

EXPORT("Web_StateSave") int Web_StateSave(uint8_t *p) {
  uint32_t v[4] = {0x4E455431u, frame, hash, applied};
  memcpy(p, v, sizeof v);
  return 1;
}

EXPORT("Web_StateLoad") int Web_StateLoad(const uint8_t *p) {
  uint32_t v[4];
  memcpy(v, p, sizeof v);
  if (v[0] != 0x4E455431u) return 0;
  frame = v[1];
  hash = v[2];
  applied = v[3];
  return 1;
}

EXPORT("Net_Hash") uint32_t Net_Hash(void) { return hash; }
EXPORT("Net_Applied") uint32_t Net_Applied(void) { return applied; }
EXPORT("Net_Sent") uint32_t Net_Sent(void) { return sent; }
EXPORT("Net_Slot") int32_t Net_Slot(void) { return slot; }
EXPORT("Net_Count") int32_t Net_Count(void) { return count; }
EXPORT("Net_Open") int32_t Net_Open(void) { return is_open; }
EXPORT("Net_Started") int32_t Net_Started(void) { return started; }
EXPORT("Net_Ended") int32_t Net_Ended(void) { return ended; }
EXPORT("Net_Closed") int32_t Net_Closed(void) { return closed_why; }
EXPORT("Net_BigOk") uint32_t Net_BigOk(void) { return big_ok; }
EXPORT("Net_BigBad") uint32_t Net_BigBad(void) { return big_bad; }
EXPORT("Net_Stalls") uint32_t Net_Stalls(void) { return stalls; }
EXPORT("Net_HostProtocol") uint32_t Net_HostProtocol(void) { return host_protocol; }
EXPORT("Net_Event") uint32_t Net_Event(uint32_t i) { return ev_log[i & 31]; }
EXPORT("Net_EventCount") uint32_t Net_EventCount(void) { return ev_count; }
