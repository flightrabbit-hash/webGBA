// webGBA 의 mGBA wasm 코어. mGBA 0.10.1 의 공개 API(mCore)만 쓰고 mGBA 소스는 고치지 않는다.
// 디컴파일 포트의 웹 빌드(예: game.wasm)와 같은 Web_* 규약으로 내보내 webGBA 의 내장 호스트 하나로 둘 다 돌린다.
//   필수: Web_Init · Web_RunFrame(keys) · Web_GetFramebuffer(RGBA 240x160)
//   소리: Web_SetAudioRate · Web_GetAudioBuffer(float 스테레오 교차) · Web_GetAudioCount(이번 프레임 표본 수)
//   세이브: Web_GetFlash(128KB 버퍼) · Web_FlashClear · Web_TakeFlashDirty · Web_GetSaveSize · Web_SetSaveSize
//   추가(포트에 없음): Web_RomBuffer(size) · Web_Reset · Web_State* · Web_Alloc/Free · Web_GetTitle/Code
// 롬은 Web_RomBuffer 가 준 자리에 호스트가 쓴다(포트는 0x08000000 고정). 세이브는 Web_GetFlash 버퍼에 쓰고
// Web_SetSaveSize 로 크기를 알린 뒤 Web_Init 을 부른다.
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten/emscripten.h>

#include <mgba/core/blip_buf.h>
#include <mgba/core/core.h>
#include <mgba/core/interface.h>
#include <mgba/core/log.h>
#include <mgba/gba/core.h>
#include <mgba-util/vfs.h>

#define WIDTH 240
#define HEIGHT 160
#define FLASH_SIZE 0x20000
#define AUDIO_CAP 4096

static struct mCore* sCore;
static color_t* sVideo;
static uint8_t sRgba[WIDTH * HEIGHT * 4];
static uint8_t* sRom;
static size_t sRomSize;
static uint8_t sFlash[FLASH_SIZE];
static size_t sSaveSize;
static int16_t sPcm[AUDIO_CAP * 2];
static float sAudio[AUDIO_CAP * 2];
static int sAudioCount;
static int sAudioRate = 48000;
static int sSaveDirty;
static char sTitle[17];
static char sCode[9];
static char sHalt[96];
static struct mCoreCallbacks sCallbacks;

static void quietLog(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	(void) logger;
	(void) category;
	(void) level;
	(void) format;
	(void) args;
}

static struct mLogger sLogger = { .log = quietLog };

// 게임이 세이브를 다 쓴 뒤 mGBA 가 부른다. 사본을 Flash 버퍼로 옮겨 호스트가 읽게 한다.
static void onSavedataUpdated(void* context) {
	(void) context;
	if (!sCore) {
		return;
	}
	void* data = NULL;
	size_t size = sCore->savedataClone(sCore, &data);
	if (data && size && size <= FLASH_SIZE) {
		memcpy(sFlash, data, size);
		sSaveSize = size;
		sSaveDirty = 1;
	}
	free(data);
}

static void applyAudioRate(void) {
	if (!sCore) {
		return;
	}
	blip_set_rates(sCore->getAudioChannel(sCore, 0), sCore->frequency(sCore), sAudioRate);
	blip_set_rates(sCore->getAudioChannel(sCore, 1), sCore->frequency(sCore), sAudioRate);
}

static void unload(void) {
	if (sCore) {
		sCore->unloadROM(sCore);
		sCore->deinit(sCore);
		sCore = NULL;
	}
	free(sVideo);
	sVideo = NULL;
	sAudioCount = 0;
	sSaveDirty = 0;
	sTitle[0] = 0;
	sCode[0] = 0;
}

EMSCRIPTEN_KEEPALIVE void* Web_Alloc(size_t size) {
	return malloc(size);
}

EMSCRIPTEN_KEEPALIVE void Web_Free(void* ptr) {
	free(ptr);
}

// 롬 자리. 다음 Web_Init 이 이 버퍼를 쓴다(코어가 언로드될 때까지 유지).
EMSCRIPTEN_KEEPALIVE uint8_t* Web_RomBuffer(size_t size) {
	unload();
	free(sRom);
	sRom = malloc(size);
	sRomSize = sRom ? size : 0;
	return sRom;
}

EMSCRIPTEN_KEEPALIVE uint8_t* Web_GetFlash(void) {
	return sFlash;
}

EMSCRIPTEN_KEEPALIVE void Web_FlashClear(void) {
	memset(sFlash, 0xFF, sizeof(sFlash));
	sSaveSize = 0;
}

EMSCRIPTEN_KEEPALIVE uint32_t Web_GetSaveSize(void) {
	return sSaveSize ? sSaveSize : FLASH_SIZE;
}

EMSCRIPTEN_KEEPALIVE void Web_SetSaveSize(uint32_t size) {
	sSaveSize = size <= FLASH_SIZE ? size : FLASH_SIZE;
}

EMSCRIPTEN_KEEPALIVE int Web_TakeFlashDirty(void) {
	int dirty = sSaveDirty;
	sSaveDirty = 0;
	return dirty;
}

EMSCRIPTEN_KEEPALIVE const char* Web_GetHaltReason(void) {
	return sHalt;
}

EMSCRIPTEN_KEEPALIVE int Web_Init(void) {
	unload();
	sHalt[0] = 0;
	if (!sRom || !sRomSize) {
		strcpy(sHalt, "no rom");
		return 0;
	}
	mLogSetDefaultLogger(&sLogger);

	struct mCore* core = GBACoreCreate();
	if (!core || !core->init(core)) {
		strcpy(sHalt, "core init failed");
		return 0;
	}
	mCoreInitConfig(core, NULL);

	sVideo = calloc(WIDTH * HEIGHT, sizeof(color_t));
	core->setVideoBuffer(core, sVideo, WIDTH);
	core->setAudioBufferSize(core, 4096);

	struct VFile* romVf = VFileFromMemory(sRom, sRomSize);
	if (!romVf || !core->loadROM(core, romVf)) {
		core->deinit(core);
		free(sVideo);
		sVideo = NULL;
		strcpy(sHalt, "not a GBA rom");
		return 0;
	}

	core->loadSave(core, VFileMemChunk(sSaveSize ? sFlash : NULL, sSaveSize));

	memset(&sCallbacks, 0, sizeof(sCallbacks));
	sCallbacks.savedataUpdated = onSavedataUpdated;
	core->addCoreCallbacks(core, &sCallbacks);

	sCore = core;
	applyAudioRate();
	core->reset(core);

	void* data = NULL;
	size_t size = core->savedataClone(core, &data);
	if (data && size && size <= FLASH_SIZE) {
		memcpy(sFlash, data, size);
		sSaveSize = size;
	}
	free(data);

	memset(sTitle, 0, sizeof(sTitle));
	memset(sCode, 0, sizeof(sCode));
	core->getGameTitle(core, sTitle);
	core->getGameCode(core, sCode);
	return 1;
}

EMSCRIPTEN_KEEPALIVE void Web_Reset(void) {
	if (sCore) {
		sCore->reset(sCore);
		sAudioCount = 0;
	}
}

static void drainAudio(void) {
	blip_t* left = sCore->getAudioChannel(sCore, 0);
	blip_t* right = sCore->getAudioChannel(sCore, 1);
	int avail = blip_samples_avail(left);
	if (avail > AUDIO_CAP) {
		avail = AUDIO_CAP;
	}
	blip_read_samples(left, sPcm, avail, 1);
	blip_read_samples(right, sPcm + 1, avail, 1);
	for (int i = 0; i < avail * 2; ++i) {
		sAudio[i] = sPcm[i] / 32768.0f;
	}
	sAudioCount = avail;
}

EMSCRIPTEN_KEEPALIVE int Web_RunFrame(uint32_t keys) {
	if (!sCore) {
		return 0;
	}
	sCore->setKeys(sCore, keys & 0x3FF);
	sCore->runFrame(sCore);
	drainAudio();
	return 1;
}

EMSCRIPTEN_KEEPALIVE uint8_t* Web_GetFramebuffer(void) {
	if (sVideo) {
		const uint32_t* src = (const uint32_t*) sVideo;
		uint8_t* dst = sRgba;
		for (int i = 0; i < WIDTH * HEIGHT; ++i) {
			uint32_t c = src[i];
			dst[0] = c & 0xFF;
			dst[1] = (c >> 8) & 0xFF;
			dst[2] = (c >> 16) & 0xFF;
			dst[3] = 0xFF;
			dst += 4;
		}
	}
	return sRgba;
}

EMSCRIPTEN_KEEPALIVE void Web_SetAudioRate(int rate) {
	if (rate > 0) {
		sAudioRate = rate;
		applyAudioRate();
	}
}

EMSCRIPTEN_KEEPALIVE float* Web_GetAudioBuffer(void) {
	return sAudio;
}

EMSCRIPTEN_KEEPALIVE int Web_GetAudioCount(void) {
	return sAudioCount;
}

EMSCRIPTEN_KEEPALIVE uint32_t Web_GetFrameCount(void) {
	return sCore ? sCore->frameCounter(sCore) : 0;
}

EMSCRIPTEN_KEEPALIVE uint32_t Web_StateSize(void) {
	return sCore ? sCore->stateSize(sCore) : 0;
}

EMSCRIPTEN_KEEPALIVE int Web_StateSave(void* out) {
	return sCore && sCore->saveState(sCore, out) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int Web_StateLoad(const void* in) {
	if (!sCore || !sCore->loadState(sCore, in)) {
		return 0;
	}
	sAudioCount = 0;
	return 1;
}

EMSCRIPTEN_KEEPALIVE const char* Web_GetTitle(void) {
	return sTitle;
}

EMSCRIPTEN_KEEPALIVE const char* Web_GetCode(void) {
	return sCode;
}
