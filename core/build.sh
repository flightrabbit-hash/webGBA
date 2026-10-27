#!/bin/bash
# mGBA 0.10.1 코어를 wasm 으로 만든다. 도커 emscripten/emsdk:4.0.10 안에서 돈다(tools/core-build.cjs 가 --rm 으로 띄움).
#   /work = 이 core 폴더. 결과: /work/out/mgba_core.wasm (Web_* 규약, 글루 .js 없이 webGBA 내장 호스트가 돌림)
# mGBA 소스는 vendor/mgba-0.10.1 (없으면 공식 태그를 받음). mGBA 파일은 고치지 않는다.
set -euo pipefail

cd /work
VERSION=0.10.1
SRC="vendor/mgba-${VERSION}"

if [ ! -f "${SRC}/CMakeLists.txt" ]; then
	mkdir -p vendor
	python3 - "$VERSION" <<'PY'
import sys, urllib.request, tarfile, io
version = sys.argv[1]
url = f"https://codeload.github.com/mgba-emu/mgba/tar.gz/refs/tags/{version}"
data = urllib.request.urlopen(url, timeout=120).read()
tarfile.open(fileobj=io.BytesIO(data), mode="r:gz").extractall("vendor")
PY
fi

BUILD=build/mgba
mkdir -p "$BUILD" out/glue
pushd "$BUILD" > /dev/null
emcmake cmake "/work/${SRC}" \
	-DCMAKE_BUILD_TYPE=Release \
	-DSKIP_GIT=ON \
	-DBUILD_STATIC=ON -DBUILD_SHARED=OFF \
	-DBUILD_QT=OFF -DBUILD_SDL=OFF -DBUILD_LIBRETRO=OFF \
	-DBUILD_GL=OFF -DBUILD_GLES2=OFF -DBUILD_GLES3=OFF -DUSE_EPOXY=OFF \
	-DUSE_FFMPEG=OFF -DUSE_ZLIB=OFF -DUSE_MINIZIP=OFF -DUSE_PNG=OFF -DUSE_LIBZIP=OFF \
	-DUSE_SQLITE3=OFF -DUSE_ELF=OFF -DUSE_LUA=OFF -DUSE_LZMA=OFF -DUSE_DISCORD_RPC=OFF \
	-DENABLE_SCRIPTING=OFF -DUSE_DEBUGGERS=OFF -DUSE_GDB_STUB=OFF -DUSE_EDITLINE=OFF \
	-DM_CORE_GB=OFF -DM_CORE_GBA=ON -DBUILD_LTO=OFF \
	-DCMAKE_C_FLAGS="-D_GNU_SOURCE -DDISABLE_THREADING -O2" > /work/out/cmake.log
emmake make -j"$(nproc)" mgba > /work/out/make.log
popd > /dev/null

# 포트 웹 빌드와 같은 모양: 글루 .js 는 버리고 .wasm 만 쓴다. 바깥 함수는 기본 몇 개만 남게 파일 시스템을 끈다.
emcc -O2 \
	-I "/work/${SRC}/include" -I "/work/${BUILD}/include" \
	-D_GNU_SOURCE -DM_CORE_GBA -DDISABLE_THREADING \
	src/webgba_core.c src/host_stubs.c "${BUILD}/libmgba.a" \
	-o out/glue/mgba_core.js \
	--no-entry \
	-sENVIRONMENT=web \
	-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sSTACK_SIZE=1048576 \
	-sFILESYSTEM=0

mv out/glue/mgba_core.wasm out/mgba_core.wasm
cp "/work/${SRC}/LICENSE" out/mgba-LICENSE.txt
cp "/work/${SRC}/src/third-party/blip_buf/license.txt" out/blip_buf-LICENSE.txt
cp "/work/${SRC}/src/third-party/inih/LICENSE.txt" out/inih-LICENSE.txt
ls -la out/mgba_core.wasm
