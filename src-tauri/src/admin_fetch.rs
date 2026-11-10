//! 관리자 모드 "롬 가져오기" — 서버가 발급한 몇 분짜리 주소(비공개 R2 presigned GET)에서 `.wgba` 를 받아 exe 폴더에 둔다.
//!
//! 비공개 버킷의 CORS 는 웹 버전 출처만 허용하므로 웹뷰 `fetch` 대신 WinHTTP(Windows 내장, 새 크레이트 없음)로 받는다.
//! 주소는 `https://<계정>.r2.cloudflarestorage.com/…` 만 받는다(개발 키트일 때만 루프백 http — 시험 서버).

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{io_at, Error, Result};

pub const SIZE_MAX: u64 = 1 << 30;
const HOST_SUFFIX: &str = ".r2.cloudflarestorage.com";

#[derive(Debug, PartialEq)]
pub struct Target {
    pub secure: bool,
    pub host: String,
    pub port: u16,
    pub path: String,
}

/// 받을 주소 검사·나누기.
pub fn parse_url(url: &str, loopback_ok: bool) -> Result<Target> {
    let bad = || Error::File(crate::i18n::tr("rs.adminUrl"));
    let (secure, rest) = if let Some(rest) = url.strip_prefix("https://") {
        (true, rest)
    } else if let Some(rest) = url.strip_prefix("http://") {
        (false, rest)
    } else {
        return Err(bad());
    };
    let cut = rest.find('/').ok_or_else(bad)?;
    let (authority, path) = rest.split_at(cut);
    if authority.contains('@') || path.chars().any(|c| c.is_control() || c == ' ') {
        return Err(bad());
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().map_err(|_| bad())?),
        None => (authority, if secure { 443 } else { 80 }),
    };
    let host = host.to_ascii_lowercase();
    let loopback = host == "127.0.0.1" || host == "localhost";
    let r2 = secure && port == 443 && host.ends_with(HOST_SUFFIX) && host.len() > HOST_SUFFIX.len() && host.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
    if !(r2 || (loopback && loopback_ok)) {
        return Err(bad());
    }
    Ok(Target { secure, host, port, path: path.to_string() })
}

/// Windows 에서 쓸 수 있는 `<이름>.wgba`(경로 글자·예약어 막음).
pub fn safe_name(name: &str) -> Result<String> {
    let stem = name.strip_suffix(".wgba").or_else(|| name.strip_suffix(".WGBA")).unwrap_or(name);
    let clean: String = stem.chars().map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c }).take(80).collect();
    let clean = clean.trim().trim_matches(|c| c == '.' || c == ' ').to_string();
    if clean.is_empty() {
        return Err(Error::File(crate::i18n::tr("rs.adminName")));
    }
    let upper = clean.to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&upper.as_str()) || ((upper.starts_with("COM") || upper.starts_with("LPT")) && upper.len() == 4 && upper.as_bytes()[3].is_ascii_digit());
    Ok(if reserved { format!("_{clean}.wgba") } else { format!("{clean}.wgba") })
}

/// 같은 이름이 있으면 `<이름> (2).wgba` … — 사용자 파일을 덮어쓰지 않는다.
pub fn free_path(dir: &Path, name: &str) -> PathBuf {
    let stem = name.strip_suffix(".wgba").unwrap_or(name);
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    (2..1000).map(|n| dir.join(format!("{stem} ({n}).wgba"))).find(|p| !p.exists()).unwrap_or(first)
}

#[cfg(windows)]
mod net {
    use super::*;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Networking::WinHttp::*;

    struct Handle(*mut core::ffi::c_void);
    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    let _ = WinHttpCloseHandle(self.0);
                }
            }
        }
    }

    fn fail(step: &str) -> Error {
        Error::File(crate::i18n::tr1("rs.adminNet", format!("{step} {}", unsafe { windows::Win32::Foundation::GetLastError().0 })))
    }

    fn query_number(request: &Handle, level: u32) -> Option<u64> {
        let mut value: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let mut index = 0u32;
        unsafe { WinHttpQueryHeaders(request.0, level | WINHTTP_QUERY_FLAG_NUMBER, PCWSTR::null(), Some(&mut value as *mut u32 as *mut _), &mut size, &mut index) }.ok()?;
        Some(value as u64)
    }

    /// 받은 바이트를 `out` 에 쓴다. 반환 = 받은 길이.
    pub fn get(target: &Target, out: &mut File, on: &mut dyn FnMut(u64, u64)) -> Result<u64> {
        unsafe {
            let session = Handle(WinHttpOpen(&HSTRING::from("webGBA"), WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, PCWSTR::null(), PCWSTR::null(), 0));
            if session.0.is_null() {
                return Err(fail("open"));
            }
            let _ = WinHttpSetTimeouts(session.0, 15_000, 15_000, 30_000, 60_000);
            let connect = Handle(WinHttpConnect(session.0, &HSTRING::from(target.host.as_str()), target.port, 0));
            if connect.0.is_null() {
                return Err(fail("connect"));
            }
            let flags = if target.secure { WINHTTP_FLAG_SECURE } else { WINHTTP_OPEN_REQUEST_FLAGS(0) };
            let request = Handle(WinHttpOpenRequest(connect.0, &HSTRING::from("GET"), &HSTRING::from(target.path.as_str()), PCWSTR::null(), PCWSTR::null(), std::ptr::null(), flags));
            if request.0.is_null() {
                return Err(fail("request"));
            }
            WinHttpSendRequest(request.0, None, None, 0, 0, 0).map_err(|_| fail("send"))?;
            WinHttpReceiveResponse(request.0, std::ptr::null_mut()).map_err(|_| fail("receive"))?;
            let status = query_number(&request, WINHTTP_QUERY_STATUS_CODE).unwrap_or(0);
            if status != 200 {
                return Err(Error::File(crate::i18n::tr1("rs.adminHttp", status)));
            }
            let total = query_number(&request, WINHTTP_QUERY_CONTENT_LENGTH).unwrap_or(0);
            if total > SIZE_MAX {
                return Err(Error::File(crate::i18n::tr("rs.adminSize")));
            }
            let mut done: u64 = 0;
            let mut buf = vec![0u8; 256 * 1024];
            let mut last = std::time::Instant::now();
            on(0, total);
            loop {
                let mut read = 0u32;
                WinHttpReadData(request.0, buf.as_mut_ptr() as *mut _, buf.len() as u32, &mut read).map_err(|_| fail("read"))?;
                if read == 0 {
                    break;
                }
                done += read as u64;
                if done > SIZE_MAX {
                    return Err(Error::File(crate::i18n::tr("rs.adminSize")));
                }
                out.write_all(&buf[..read as usize]).map_err(|e| Error::File(e.to_string()))?;
                if last.elapsed().as_millis() >= 100 {
                    on(done, total);
                    last = std::time::Instant::now();
                }
            }
            if total > 0 && done != total {
                return Err(Error::File(crate::i18n::tr("rs.adminCut")));
            }
            on(done, total.max(done));
            Ok(done)
        }
    }
}

#[cfg(not(windows))]
mod net {
    use super::*;
    pub fn get(_target: &Target, _out: &mut File, _on: &mut dyn FnMut(u64, u64)) -> Result<u64> {
        Err(Error::File(crate::i18n::tr("rs.adminUrl")))
    }
}

/// 받아서 `<exe 폴더>/<이름>.wgba` 로 둔다(먼저 숨은 `.part` 에 받고, 크기·형식이 맞을 때만 이름을 바꿈). 반환 = 둔 경로.
pub fn fetch(url: &str, name: &str, size: u64, loopback_ok: bool, on: &mut dyn FnMut(u64, u64)) -> Result<PathBuf> {
    let target = parse_url(url, loopback_ok)?;
    let file_name = safe_name(name)?;
    let dir = crate::ui::app_root();
    let part = dir.join(format!(".{file_name}.part"));
    let mut out = OpenOptions::new().write(true).create(true).truncate(true).open(&part).map_err(io_at(&part))?;
    let got = net::get(&target, &mut out, on).and_then(|n| {
        out.sync_all().map_err(io_at(&part))?;
        Ok(n)
    });
    drop(out);
    let checked = got.and_then(|n| {
        if size > 0 && n != size {
            return Err(Error::File(crate::i18n::tr("rs.adminCut")));
        }
        let mut head = [0u8; 8];
        use std::io::Read;
        File::open(&part).and_then(|mut f| f.read_exact(&mut head)).map_err(io_at(&part))?;
        if head != [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00] {
            return Err(Error::File(crate::i18n::tr("rs.adminNotWgba")));
        }
        Ok(())
    });
    if let Err(error) = checked {
        let _ = fs::remove_file(&part);
        return Err(error);
    }
    let target_path = free_path(&dir, &file_name);
    fs::rename(&part, &target_path).map_err(|e| {
        let _ = fs::remove_file(&part);
        io_at(&target_path)(e)
    })?;
    Ok(target_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        let ok = parse_url("https://abc123.r2.cloudflarestorage.com/bucket/wgba/a%20b.wgba?X-Amz-Signature=1", false).unwrap();
        assert_eq!(ok, Target { secure: true, host: "abc123.r2.cloudflarestorage.com".into(), port: 443, path: "/bucket/wgba/a%20b.wgba?X-Amz-Signature=1".into() });
        assert!(parse_url("http://abc.r2.cloudflarestorage.com/x", false).is_err());
        assert!(parse_url("https://evil.example/x", false).is_err());
        assert!(parse_url("https://r2.cloudflarestorage.com.evil.example/x", false).is_err());
        assert!(parse_url("https://user@abc.r2.cloudflarestorage.com/x", false).is_err());
        assert!(parse_url("https://abc.r2.cloudflarestorage.com:8443/x", false).is_err());
        assert!(parse_url("http://127.0.0.1:9000/x", false).is_err());
        assert_eq!(parse_url("http://127.0.0.1:9000/b/k?s=1", true).unwrap().port, 9000);
        assert!(parse_url("file:///C:/x", true).is_err());
    }

    #[test]
    fn names() {
        assert_eq!(safe_name("Alpha.wgba").unwrap(), "Alpha.wgba");
        assert_eq!(safe_name("a/b\\c:d.wgba").unwrap(), "a_b_c_d.wgba");
        assert_eq!(safe_name("CON").unwrap(), "_CON.wgba");
        assert_eq!(safe_name("com1.wgba").unwrap(), "_com1.wgba");
        assert!(safe_name(" .. ").is_err());
        let dir = std::env::temp_dir().join(format!("webgba-admin-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("x.wgba"), b"1").unwrap();
        assert_eq!(free_path(&dir, "x.wgba"), dir.join("x (2).wgba"));
        assert_eq!(free_path(&dir, "y.wgba"), dir.join("y.wgba"));
        let _ = fs::remove_dir_all(&dir);
    }
}
