//! `.wgbp` 확장자 연결(사용자 2026-11-02 "wgbp만 연결하는걸로 할게"). 아비터 abtapp.rs 의 `.abtapp` 연결과 같은 방식.
//!
//! 새 확장자라 `HKCU\Software\Classes` 의 ProgID 등록으로 충분하다(관리자 권한 불필요, UserChoice 제약 없음).
//!   .wgbp                              (기본값) webGBA.wgbp
//!   webGBA.wgbp                        (기본값) webGBA 패치(롬이 없는 공유용 패치 — 열면 롬을 선택해 .wgba 를 생성)
//!   webGBA.wgbp\DefaultIcon            "<exe>",0   ← 앱 아이콘
//!   webGBA.wgbp\shell\open\command     "<exe>" "%1"
//! 이 exe 를 가리켜야 "연결됨". 앱을 켤 때 등록된 exe 가 현재 exe 와 다르거나 빠졌으면 고쳐 쓴다(폴더를 이동해도 계속 열림).
//! 사용자가 "연결 해제"를 선택하면 `personalization.cfg` 의 `wgbaLink: false` 를 남기고 다시 등록하지 않는다.
//!
//! `.wgba`·`.gb`·`.gbc` 는 연결하지 않는다(더블클릭으로 게임이 바로 실행되므로). 이전 버전이 쓴 값은 연결·해제·앱 시작 때 지운다:
//!   .wgba (기본값) webGBA.wgba · .gb·.gbc (기본값) webGBA.gb·webGBA.gbc · <ext>\OpenWithProgids 의 같은 이름 값 · ProgID 키
//! webGBA 이름의 값만 지우고, 다른 프로그램의 값·사용자가 선택한 기본 앱(UserChoice)은 건드리지 않는다.

use serde::Serialize;

use crate::error::Result;

/// (확장자, ProgID, 탐색기 "유형" 칸 번역 키)
const KINDS: [(&str, &str, &str); 1] = [(".wgbp", "webGBA.wgbp", "rs.assocPatchLabel")];

/// 이전 버전이 연결했던 확장자와 ProgID.
const OLD_KINDS: [(&str, &str); 3] = [(".wgba", "webGBA.wgba"), (".gb", "webGBA.gb"), (".gbc", "webGBA.gbc")];

/// 연결 프로그램 목록 키(`HKCU\Software\Classes\<ext>\OpenWithProgids`).
fn open_with(ext: &str) -> String {
    format!(r"Software\Classes\{ext}\OpenWithProgids")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `.wgbp` 가 이 exe 로 연결되어 있음.
    pub linked: bool,
    /// webGBA 로 연결되어 있으나 다른 exe(이동 전 위치 등)를 가리킴.
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
    Status { linked: all, elsewhere: any && !all }
}

/// `<ext>` 의 webGBA 값(우리 ProgID 를 가리키는 기본값·OpenWithProgids 의 같은 이름 값)과 ProgID 키를 지운다.
/// 다른 프로그램의 값이 남은 키는 그대로 둔다. 지울 것이 있었으면 true.
#[cfg(windows)]
fn clear(ext: &str, progid: &str) -> Result<bool> {
    let key = format!(r"Software\Classes\{ext}");
    let progid_key = format!(r"Software\Classes\{progid}");
    let ours = reg::get_default(&key).as_deref() == Some(progid);
    if !ours && !reg::has_value(&open_with(ext), progid) && !reg::exists(&progid_key) {
        return Ok(false);
    }
    reg::delete_value(&open_with(ext), Some(progid))?;
    if ours {
        reg::delete_value(&key, None)?;
    }
    reg::delete_if_empty(&open_with(ext));
    reg::delete_if_empty(&key);
    reg::delete_tree(&progid_key)?;
    Ok(true)
}

/// 이전 버전이 쓴 `.wgba`·`.gb`·`.gbc` 연결 값을 지운다.
#[cfg(windows)]
fn clear_old() -> Result<bool> {
    let mut changed = false;
    for (ext, progid) in OLD_KINDS {
        changed |= clear(ext, progid)?;
    }
    Ok(changed)
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
    clear_old()?;
    for (ext, progid, label) in KINDS {
        reg::set_default(&format!(r"Software\Classes\{ext}"), progid)?;
        write_progid(progid, label, &exe)?;
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
    for (_, progid, label) in KINDS {
        changed |= reg::set_default(&format!(r"Software\Classes\{progid}"), &crate::i18n::tr(label)).is_ok();
    }
    if changed {
        reg::notify();
    }
}

#[cfg(not(windows))]
pub fn refresh_label() {}

/// 연결을 해제한다. 확장자가 다른 프로그램을 가리키면 해당 연결은 건드리지 않는다.
#[cfg(windows)]
pub fn unlink() -> Result<()> {
    for (ext, progid, _) in KINDS {
        clear(ext, progid)?;
    }
    clear_old()?;
    reg::notify();
    Ok(())
}

/// 켤 때: 이전 버전의 연결 값을 지우고, 해제를 선택하지 않았으면 연결을 이 exe 로 맞춘다.
pub fn ensure_on_start() {
    match clear_old() {
        Ok(true) => {
            reg_notify();
            crate::logging::write("INFO", "이전 버전의 .wgba·.gb·.gbc 연결을 해제했습니다");
        }
        Ok(false) => {}
        Err(e) => crate::logging::write("WARN", &format!("이전 버전의 .wgba·.gb·.gbc 연결을 해제하지 못했습니다: {e}")),
    }
    let refused = crate::config::prefs().get("wgbaLink").and_then(|v| v.as_bool()) == Some(false);
    if refused {
        return;
    }
    if !status().linked {
        if let Err(e) = link() {
            crate::logging::write("WARN", &format!(".wgbp 연결을 쓰지 못했습니다: {e}"));
        } else {
            crate::logging::write("INFO", ".wgbp 를 이 실행 파일로 연결했습니다");
        }
    }
}

#[cfg(windows)]
fn reg_notify() {
    reg::notify();
}

#[cfg(not(windows))]
fn reg_notify() {}

#[cfg(not(windows))]
fn clear_old() -> Result<bool> {
    Ok(false)
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
        RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_ANY, RRF_RT_REG_SZ,
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

    /// `HKCU\<sub>` 에 이름 `name` 값이 있는지(형식 무관).
    pub fn has_value(sub: &str, name: &str) -> bool {
        let (wsub, wname) = (wide(sub), wide(name));
        let rc = unsafe { RegGetValueW(HKEY_CURRENT_USER, PCWSTR(wsub.as_ptr()), PCWSTR(wname.as_ptr()), RRF_RT_ANY, None, None, None) };
        rc == ERROR_SUCCESS
    }

    /// `HKCU\<sub>` 키가 있는지.
    pub fn exists(sub: &str) -> bool {
        let wsub = wide(sub);
        let mut key = HKEY::default();
        if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(wsub.as_ptr()), None, KEY_READ, &mut key) } != ERROR_SUCCESS {
            return false;
        }
        unsafe {
            let _ = RegCloseKey(key);
        }
        true
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
