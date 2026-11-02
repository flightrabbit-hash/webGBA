//! `.wgba`·`.wgbp` 확장자 연결(사용자 2026-10-26, `.wgbp` 2026-10-28). 아비터 abtapp.rs 의 `.abtapp` 연결과 같은 방식.
//!
//! 새 확장자라 `HKCU\Software\Classes` 의 ProgID 등록으로 충분하다(관리자 권한 불필요, UserChoice 제약 없음).
//!   .wgba                              (기본값) webGBA.wgba
//!   webGBA.wgba                        (기본값) webGBA 게임
//!   webGBA.wgba\DefaultIcon            "<exe>",0   ← 앱 아이콘
//!   webGBA.wgba\shell\open\command     "<exe>" "%1"
//!   .wgbp / webGBA.wgbp                같은 짜임, 이름 "webGBA 패치"(롬이 들어 있지 않은 공유용 패치 — 열면 롬을 골라 .wgba 를 만듦)
//! 넷을 함께 다룬다: 모두 이 exe 를 가리켜야 "연결됨". 앱을 켤 때 등록된 exe 가 지금 exe 와 다르거나 하나가 빠졌으면
//! 고쳐 쓴다(폴더를 옮겨도 계속 열림, 옛 판이 `.wgba` 만 등록했어도 나머지가 더해짐). 사람이 "연결 해제"를 고르면
//! `personalization.cfg` 의 `wgbaLink: false` 를 남기고 다시 등록하지 않는다.
//!
//! `.gb`·`.gbc`(결정 146)는 다른 에뮬레이터가 이미 쓰는 확장자라 남의 연결을 덮지 않는다:
//!   .gb\OpenWithProgids               webGBA.gb = ""   ← 탐색기 "연결 프로그램" 목록에 webGBA 를 더함(늘)
//!   .gb                               (기본값) webGBA.gb  ← 합친 보기(HKCR)에 기본 프로그램이 없거나 이미 webGBA 일 때만
//!   webGBA.gb / webGBA.gbc            같은 짜임, 이름 "webGBA GB 게임"·"webGBA GBC 게임"
//! 해제는 우리 값(OpenWithProgids 의 webGBA.gb, 우리를 가리키는 기본값, ProgID)만 지운다. 사람이 고른 기본 앱(UserChoice)은 건드리지 않는다.

use serde::Serialize;

use crate::error::Result;

pub const EXTENSION: &str = ".wgba";

/// (확장자, ProgID, 탐색기 "유형" 칸 번역 키) — 새 확장자라 기본값을 바로 가짐.
const KINDS: [(&str, &str, &str); 2] = [(".wgba", "webGBA.wgba", "rs.assocLabel"), (".wgbp", "webGBA.wgbp", "rs.assocPatchLabel")];

/// 남도 쓰는 확장자(GB·GBC 롬). "연결 프로그램" 목록에 넣고, 기본값은 비어 있을 때만 가짐.
const SHARED_KINDS: [(&str, &str, &str); 2] = [(".gb", "webGBA.gb", "rs.assocGbLabel"), (".gbc", "webGBA.gbc", "rs.assocGbcLabel")];

/// 연결 프로그램 목록 키(`HKCU\Software\Classes\<ext>\OpenWithProgids`).
fn open_with(ext: &str) -> String {
    format!(r"Software\Classes\{ext}\OpenWithProgids")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `.wgba`·`.wgbp`·`.gb`·`.gbc` 가 모두 이 exe 로 연결되어 있음(`.gb`·`.gbc` 는 연결 프로그램 목록에 있으면 됨).
    pub linked: bool,
    /// 하나라도 webGBA 로 연결되어 있으나 다른 exe(옮기기 전 자리 등)를 가리키거나 하나가 빠짐.
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
    let here = exe().map(|e| open_command(&e).to_lowercase());
    let mut all = true;
    let mut any = false;
    let mut check = |ours: bool, progid: &str| {
        let command = reg::get_default(&format!(r"Software\Classes\{progid}\shell\open\command"));
        let matches = matches!((&command, &here), (Some(c), Some(h)) if c.to_lowercase() == *h);
        all &= ours && matches;
        any |= ours;
    };
    for (ext, progid, _) in KINDS {
        check(reg::get_default(&format!(r"Software\Classes\{ext}")).as_deref() == Some(progid), progid);
    }
    for (ext, progid, _) in SHARED_KINDS {
        check(reg::has_value(&open_with(ext), progid), progid);
    }
    Status { linked: all, elsewhere: any && !all }
}

#[cfg(windows)]
fn write_progid(progid: &str, label: &str, exe: &str) -> Result<()> {
    reg::set_default(&format!(r"Software\Classes\{progid}"), &crate::i18n::tr(label))?;
    reg::set_default(&format!(r"Software\Classes\{progid}\DefaultIcon"), &format!("\"{exe}\",0"))?;
    reg::set_default(&format!(r"Software\Classes\{progid}\shell\open\command"), &open_command(exe))
}

#[cfg(windows)]
pub fn link() -> Result<()> {
    use crate::error::Error;
    let exe = exe().ok_or_else(|| Error::Config(crate::i18n::tr("rs.noExe")))?;
    for (ext, progid, label) in KINDS {
        reg::set_default(&format!(r"Software\Classes\{ext}"), progid)?;
        write_progid(progid, label, &exe)?;
    }
    for (ext, progid, label) in SHARED_KINDS {
        write_progid(progid, label, &exe)?;
        reg::set_value(&open_with(ext), progid, "")?;
        let owner = reg::classes_default(ext);
        if owner.as_deref().map(|o| o.is_empty() || o == progid).unwrap_or(true) {
            reg::set_default(&format!(r"Software\Classes\{ext}"), progid)?;
        }
    }
    reg::notify();
    Ok(())
}

/// 언어를 바꾸면 탐색기의 "유형" 칸(ProgID 기본값)도 그 언어로. 연결되어 있을 때만.
#[cfg(windows)]
pub fn refresh_label() {
    if !status().linked {
        return;
    }
    let mut changed = false;
    for (_, progid, label) in KINDS.into_iter().chain(SHARED_KINDS) {
        changed |= reg::set_default(&format!(r"Software\Classes\{progid}"), &crate::i18n::tr(label)).is_ok();
    }
    if changed {
        reg::notify();
    }
}

#[cfg(not(windows))]
pub fn refresh_label() {}

/// 연결을 푼다. 확장자가 다른 프로그램을 가리키면 그 연결은 건드리지 않는다.
#[cfg(windows)]
pub fn unlink() -> Result<()> {
    for (ext, progid, _) in KINDS {
        if reg::get_default(&format!(r"Software\Classes\{ext}")).as_deref() == Some(progid) {
            reg::delete_tree(&format!(r"Software\Classes\{ext}"))?;
        }
        reg::delete_tree(&format!(r"Software\Classes\{progid}"))?;
    }
    for (ext, progid, _) in SHARED_KINDS {
        let key = format!(r"Software\Classes\{ext}");
        reg::delete_value(&open_with(ext), Some(progid))?;
        if reg::get_default(&key).as_deref() == Some(progid) {
            reg::delete_value(&key, None)?;
        }
        reg::delete_if_empty(&open_with(ext));
        reg::delete_if_empty(&key);
        reg::delete_tree(&format!(r"Software\Classes\{progid}"))?;
    }
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
            crate::logging::write("WARN", &format!(".wgba·.wgbp·.gb·.gbc 연결을 쓰지 못했습니다: {e}"));
        } else {
            crate::logging::write("INFO", ".wgba·.wgbp·.gb·.gbc 를 이 실행 파일로 연결했습니다");
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
        RegCloseKey, RegCreateKeyExW, RegDeleteKeyValueW, RegDeleteKeyW, RegDeleteTreeW, RegGetValueW, RegOpenKeyExW, RegQueryInfoKeyW,
        RegSetValueExW, HKEY, HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_ANY,
        RRF_RT_REG_SZ,
    };

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// `<root>\<sub>` 의 기본값(문자열). 없으면 None.
    fn read_default(root: HKEY, sub: &str) -> Option<String> {
        let wsub = wide(sub);
        let mut size: u32 = 0;
        let rc = unsafe { RegGetValueW(root, PCWSTR(wsub.as_ptr()), PCWSTR::null(), RRF_RT_REG_SZ, None, None, Some(&mut size)) };
        if rc != ERROR_SUCCESS || size == 0 {
            return None;
        }
        let mut buf = vec![0u16; (size as usize / 2) + 1];
        let mut got = (buf.len() * 2) as u32;
        let rc = unsafe {
            RegGetValueW(root, PCWSTR(wsub.as_ptr()), PCWSTR::null(), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as *mut core::ffi::c_void), Some(&mut got))
        };
        if rc != ERROR_SUCCESS {
            return None;
        }
        Some(String::from_utf16_lossy(&buf).trim_end_matches('\0').to_string())
    }

    /// `HKCU\<sub>` 의 기본값. 없으면 None.
    pub fn get_default(sub: &str) -> Option<String> {
        read_default(HKEY_CURRENT_USER, sub)
    }

    /// 합친 보기(HKCR = HKCU 위 HKLM)의 확장자 기본값 — 다른 프로그램이 기본 연결을 가졌는지 본다.
    pub fn classes_default(ext: &str) -> Option<String> {
        read_default(HKEY_CLASSES_ROOT, ext)
    }

    /// `HKCU\<sub>` 에 이름 `name` 값이 있는지(형식 무관).
    pub fn has_value(sub: &str, name: &str) -> bool {
        let (wsub, wname) = (wide(sub), wide(name));
        let rc = unsafe { RegGetValueW(HKEY_CURRENT_USER, PCWSTR(wsub.as_ptr()), PCWSTR(wname.as_ptr()), RRF_RT_ANY, None, None, None) };
        rc == ERROR_SUCCESS
    }

    /// `HKCU\<sub>` 에 문자열 값을 쓴다(키가 없으면 만든다). name 이 None 이면 기본값.
    fn write_sz(sub: &str, name: Option<&str>, data: &str) -> Result<()> {
        let wsub = wide(sub);
        let wname = name.map(wide);
        let mut key = HKEY::default();
        let rc = unsafe {
            RegCreateKeyExW(HKEY_CURRENT_USER, PCWSTR(wsub.as_ptr()), None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut key, None)
        };
        if rc != ERROR_SUCCESS {
            return Err(Error::Config(crate::i18n::tr1("rs.regOpen", sub)));
        }
        let wdata = wide(data);
        let bytes = unsafe { std::slice::from_raw_parts(wdata.as_ptr() as *const u8, wdata.len() * 2) };
        let value = wname.as_ref().map(|w| PCWSTR(w.as_ptr())).unwrap_or(PCWSTR::null());
        let rc = unsafe { RegSetValueExW(key, value, None, REG_SZ, Some(bytes)) };
        unsafe {
            let _ = RegCloseKey(key);
        }
        if rc != ERROR_SUCCESS {
            return Err(Error::Config(crate::i18n::tr1("rs.regWrite", sub)));
        }
        Ok(())
    }

    /// `HKCU\<sub>` 의 기본값을 쓴다(키가 없으면 만든다).
    pub fn set_default(sub: &str, data: &str) -> Result<()> {
        write_sz(sub, None, data)
    }

    /// `HKCU\<sub>` 에 이름 있는 문자열 값을 쓴다.
    pub fn set_value(sub: &str, name: &str, data: &str) -> Result<()> {
        write_sz(sub, Some(name), data)
    }

    /// `HKCU\<sub>` 의 값 하나를 지운다(None = 기본값). 없으면 그대로 성공.
    pub fn delete_value(sub: &str, name: Option<&str>) -> Result<()> {
        let wsub = wide(sub);
        let wname = name.map(wide);
        let value = wname.as_ref().map(|w| PCWSTR(w.as_ptr())).unwrap_or(PCWSTR::null());
        let rc = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, PCWSTR(wsub.as_ptr()), value) };
        if rc == ERROR_SUCCESS || rc == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(Error::Config(crate::i18n::tr1("rs.regDelete", sub)))
        }
    }

    /// `HKCU\<sub>` 에 값·하위 키가 하나도 없으면 키를 지운다(연결로 우리가 만든 빈 키 정리). 실패는 무시.
    pub fn delete_if_empty(sub: &str) {
        let wsub = wide(sub);
        let mut key = HKEY::default();
        if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(wsub.as_ptr()), None, KEY_READ, &mut key) } != ERROR_SUCCESS {
            return;
        }
        let (mut subkeys, mut values) = (0u32, 0u32);
        let rc = unsafe { RegQueryInfoKeyW(key, None, None, None, Some(&mut subkeys), None, None, Some(&mut values), None, None, None, None) };
        unsafe {
            let _ = RegCloseKey(key);
        }
        if rc == ERROR_SUCCESS && subkeys == 0 && values == 0 {
            unsafe {
                let _ = RegDeleteKeyW(HKEY_CURRENT_USER, PCWSTR(wsub.as_ptr()));
            }
        }
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
