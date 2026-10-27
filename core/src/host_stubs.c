// mGBA 정적 라이브러리가 끌어오는 파일·시간 함수를 코어 안에서 채워, 바깥(호스트)이 줄 함수를 기본 몇 개로 줄인다.
// 롬과 세이브는 메모리로만 오가므로 파일 함수는 쓰이지 않는다 — 불리면 ENOSYS 로 실패한다.
// 시간(RTC)은 emscripten_date_now(호스트) + Web_SetTimeZone 으로 받은 시차로 계산한다.
#include <errno.h>
#include <stdint.h>
#include <string.h>
#include <sys/types.h>
#include <time.h>

#include <emscripten/emscripten.h>

static long sZoneSeconds;

EMSCRIPTEN_KEEPALIVE void Web_SetTimeZone(int offsetSeconds) {
	sZoneSeconds = offsetSeconds;
}

int __syscall_openat(int dirfd, intptr_t path, int flags, ...) {
	(void) dirfd;
	(void) path;
	(void) flags;
	return -ENOSYS;
}

int __syscall_mkdirat(int dirfd, intptr_t path, int mode) {
	(void) dirfd;
	(void) path;
	(void) mode;
	return -ENOSYS;
}

int __syscall_newfstatat(int dirfd, intptr_t path, intptr_t buf, int flags) {
	(void) dirfd;
	(void) path;
	(void) buf;
	(void) flags;
	return -ENOSYS;
}

int __syscall_fstat64(int fd, intptr_t buf) {
	(void) fd;
	(void) buf;
	return -ENOSYS;
}

int __syscall_ftruncate64(int fd, off_t length) {
	(void) fd;
	(void) length;
	return -ENOSYS;
}

int __syscall_getcwd(intptr_t buf, size_t size) {
	if (size < 2) {
		return -ERANGE;
	}
	memcpy((char*) buf, "/", 2);
	return 2;
}

int __syscall_utimensat(int dirfd, intptr_t path, intptr_t times, int flags) {
	(void) dirfd;
	(void) path;
	(void) times;
	(void) flags;
	return -ENOSYS;
}

int _mmap_js(size_t length, int prot, int flags, int fd, off_t offset, int* allocated, void** addr) {
	(void) length;
	(void) prot;
	(void) flags;
	(void) fd;
	(void) offset;
	(void) allocated;
	(void) addr;
	return -ENOSYS;
}

int _munmap_js(intptr_t addr, size_t length, int prot, int flags, int fd, off_t offset) {
	(void) addr;
	(void) length;
	(void) prot;
	(void) flags;
	(void) fd;
	(void) offset;
	return -ENOSYS;
}

int _msync_js(intptr_t addr, size_t length, int prot, int flags, int fd, off_t offset) {
	(void) addr;
	(void) length;
	(void) prot;
	(void) flags;
	(void) fd;
	(void) offset;
	return -ENOSYS;
}

void _tzset_js(long* timezone, int* daylight, char* stdName, char* dstName) {
	*timezone = -sZoneSeconds;
	*daylight = 0;
	strcpy(stdName, "LCL");
	strcpy(dstName, "LCL");
}

static int64_t daysFromCivil(int64_t y, int m, int d) {
	y -= m <= 2;
	int64_t era = (y >= 0 ? y : y - 399) / 400;
	int64_t yoe = y - era * 400;
	int64_t doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
	int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
	return era * 146097 + doe - 719468;
}

static void civilFromDays(int64_t z, int64_t* y, int* m, int* d) {
	z += 719468;
	int64_t era = (z >= 0 ? z : z - 146096) / 146097;
	int64_t doe = z - era * 146097;
	int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
	int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
	int64_t mp = (5 * doy + 2) / 153;
	*d = (int) (doy - (153 * mp + 2) / 5 + 1);
	*m = (int) (mp < 10 ? mp + 3 : mp - 9);
	*y = yoe + era * 400 + (*m <= 2);
}

void _localtime_js(time_t t, struct tm* tm) {
	int64_t local = (int64_t) t + sZoneSeconds;
	int64_t days = local >= 0 ? local / 86400 : -((-local + 86399) / 86400);
	int64_t secs = local - days * 86400;
	int64_t year;
	int month, day;
	civilFromDays(days, &year, &month, &day);
	memset(tm, 0, sizeof(*tm));
	tm->tm_sec = (int) (secs % 60);
	tm->tm_min = (int) ((secs / 60) % 60);
	tm->tm_hour = (int) (secs / 3600);
	tm->tm_mday = day;
	tm->tm_mon = month - 1;
	tm->tm_year = (int) (year - 1900);
	tm->tm_wday = (int) ((days % 7 + 11) % 7);
	tm->tm_yday = (int) (days - daysFromCivil(year, 1, 1));
	tm->tm_isdst = 0;
	tm->tm_gmtoff = sZoneSeconds;
}

time_t _mktime_js(struct tm* tm) {
	int64_t days = daysFromCivil(tm->tm_year + 1900, tm->tm_mon + 1, 1) + tm->tm_mday - 1;
	int64_t local = days * 86400 + tm->tm_hour * 3600 + tm->tm_min * 60 + tm->tm_sec;
	time_t t = (time_t) (local - sZoneSeconds);
	_localtime_js(t, tm);
	return t;
}
