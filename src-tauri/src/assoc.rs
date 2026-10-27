//! `.wgba` 확장자 연결(사용자 2026-10-26). 아비터 abtapp.rs 의 `.abtapp` 연결과 같은 방식.
//!
//! 새 확장자라 `HKCU\Software\Classes` 의 ProgID 등록으로 충분하다(관리자 권한 불필요, UserChoice 제약 없음).
//!   .wgba                              (기본값) webGBA.wgba
//!   webGBA.wgba                        (기본값) webGBA 게임
//!   webGBA.wgba\DefaultIcon            "<exe>",0   ← 앱 아이콘
//!   webGBA.wgba\shell\open\command     "<exe>" "%1"
//! 앱을 켤 때 등록된 exe 가 지금 exe 와 다르면 고쳐 쓴다(폴더를 옮겨도 계속 열림). 사람이 "연결 해제"를 고르면
//! `personalization.cfg` 의 `wgbaLink: false` 를 남기고 다시 등록하지 않는다.

use serde::Serialize;

use crate::error::Result;

pub const EXTENSION: &str = ".wgba";
const PROGID: &str = "webGBA.wgba";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `.wgba` 가 이 exe 로 연결되어 있음.
    pub linked: bool,
    /// `.wgba` 가 webGBA 로 연결되어 있으나 다른 exe(옮기기 전 자리 등)를 가리킴.
    pub elsewhere: bool,
}

fn exe() -> Option<String> {
    std::env::current_exe().ok().map(|p| p.display().to_string())
}

fn open_command(exe: &str) -> String {
    format!("\"{exe}\" \"%1\"")
}

#[cfg(windows)]
pub fn status() -> Status {
    let ours = reg::get_default(&format!(r"Software\Classes\{EXTENSION}")).as_deref() == Some(PROGID);
    let command = reg::get_default(&format!(r"Software\Classes\{PROGID}\shell\open\command"));
    let here = exe().map(|e| open_command(&e).to_lowercase());
    let matches = matches!((&command, &here), (Some(c), Some(h)) if c.to_lowercase() == *h);
    Status { linked: ours && matches, elsewhere: ours && !matches }
}

#[cfg(windows)]
pub fn link() -> Result<()> {
    use crate::error::Error;
    let exe = exe().ok_or_else(|| Error::Config(crate::i18n::tr("rs.noExe")))?;
    reg::set_default(&format!(r"Software\Classes\{EXTENSION}"), PROGID)?;
    reg::set_default(&format!(r"Software\Classes\{PROGID}"), &crate::i18n::tr("rs.assocLabel"))?;
    reg::set_default(&format!(r"Software\Classes\{PROGID}\DefaultIcon"), &format!("\"{exe}\",0"))?;
    reg::set_default(&format!(r"Software\Classes\{PROGID}\shell\open\command"), &open_command(&exe))?;
    reg::notify();
    Ok(())
}

/// 언어를 바꾸면 탐색기의 "유형" 칸(ProgID 기본값)도 그 언어로. 연결되어 있을 때만.
#[cfg(windows)]
pub fn refresh_label() {
    if !status().linked {
        return;
    }
    if reg::set_default(&format!(r"Software\Classes\{PROGID}"), &crate::i18n::tr("rs.assocLabel")).is_ok() {
        reg::notify();
    }
}

#[cfg(not(windows))]
pub fn refresh_label() {}

/// 연결을 푼다. `.wgba` 가 다른 프로그램을 가리키면 그 연결은 건드리지 않는다.
#[cfg(windows)]
pub fn unlink() -> Result<()> {
    if reg::get_default(&format!(r"Software\Classes\{EXTENSION}")).as_deref() == Some(PROGID) {
        reg::delete_tree(&format!(r"Software\Classes\{EXTENSION}"))?;
    }
    reg::delete_tree(&format!(r"Software\Classes\{PROGID}"))?;
    reg::notify();
    Ok(())
}

/// 켤 때: 해제를 고르지 않았으면 연결을 이 exe 로 맞춘다.
pub fn ensure_on_start() {
    let refused = crate::config::prefs().get("wgbaLink").and_then(|v| v.as_bool()) == Some(false);
    if refused {
        return;
    }
    if !status().linked {
        if let Err(e) = link() {
            crate::logging::write("WARN", &format!(".wgba 연결을 쓰지 못했습니다: {e}"));
        } else {
            crate::logging::write("INFO", ".wgba 를 이 실행 파일로 연결했습니다");
        }
    }
}

#[cfg(not(windows))]
pub fn status() -> Status {
    Status { linked: false, elsewhere: false }
}

#[cfg(not(windows))]
pub fn link() -> Result<()> {
    Err(crate::error::Error::Config(crate::i18n::tr("rs.assocUnsupported")))
}

#[cfg(not(windows))]
pub fn unlink() -> Result<()> {
    Ok(())
}

#[cfg(windows)]
mod reg {
    use crate::error::{Error, Result};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegGetValueW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE,
        REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_SZ,
    };

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// `HKCU\<sub>` 의 기본값. 없으면 None.
    pub fn get_default(sub: &str) -> Option<String> {
        let wsub = wide(sub);
        let mut size: u32 = 0;
        let rc = unsafe { RegGetValueW(HKEY_CURRENT_USER, PCWSTR(wsub.as_ptr()), PCWSTR::null(), RRF_RT_REG_SZ, None, None, Some(&mut size)) };
        if rc != ERROR_SUCCESS || size == 0 {
            return None;
        }
        let mut buf = vec![0u16; (size as usize / 2) + 1];
        let mut got = (buf.len() * 2) as u32;
        let rc = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                PCWSTR(wsub.as_ptr()),
                PCWSTR::null(),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr() as *mut core::ffi::c_void),
                Some(&mut got),
            )
        };
        if rc != ERROR_SUCCESS {
            return None;
        }
        Some(String::from_utf16_lossy(&buf).trim_end_matches('\0').to_string())
    }

    /// `HKCU\<sub>` 의 기본값을 쓴다(키가 없으면 만든다).
    pub fn set_default(sub: &str, data: &str) -> Result<()> {
        let wsub = wide(sub);
        let mut key = HKEY::default();
        let rc = unsafe {
            RegCreateKeyExW(HKEY_CURRENT_USER, PCWSTR(wsub.as_ptr()), None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut key, None)
        };
        if rc != ERROR_SUCCESS {
            return Err(Error::Config(crate::i18n::tr1("rs.regOpen", sub)));
        }
        let wdata = wide(data);
        let bytes = unsafe { std::slice::from_raw_parts(wdata.as_ptr() as *const u8, wdata.len() * 2) };
        let rc = unsafe { RegSetValueExW(key, PCWSTR::null(), None, REG_SZ, Some(bytes)) };
        unsafe {
            let _ = RegCloseKey(key);
        }
        if rc != ERROR_SUCCESS {
            return Err(Error::Config(crate::i18n::tr1("rs.regWrite", sub)));
        }
        Ok(())
    }

    pub fn delete_tree(sub: &str) -> Result<()> {
        let wsub = wide(sub);
        let rc = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(wsub.as_ptr())) };
        if rc == ERROR_SUCCESS || rc == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(Error::Config(crate::i18n::tr1("rs.regDelete", sub)))
        }
    }

    /// 셸에 연결 변경 통지(아이콘·연결 즉시 반영).
    pub fn notify() {
        unsafe {
            use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
        }
    }
}
