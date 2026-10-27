//! 파일·폴더 선택(`IFileOpenDialog`)·저장(`IFileSaveDialog`) 대화상자.
//!
//! COM STA 전용. 다른 코드가 같은 Thread 를 MTA 로 초기화했을 수 있어 STA 재초기화가 실패한다.
//! 호출별 전용 Thread 생성.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::error::Result;

/// 선택 창 설정.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    /// 최초 표시 폴더(파일명 포함 가능). 미지정 시 OS 기본값.
    pub start: Option<String>,
    /// 창 제목. 미지정 시 OS 기본 제목.
    pub title: Option<String>,
    /// 파일 형식 필터(확장자 목록, 점 미포함). 파일 선택 전용. 예: ["png", "jpg"].
    pub filters: Option<Vec<String>>,
    /// 형식 필터 이름(화면이 번역해 넘김). 미지정 시 `rs.pickerFilter`.
    pub filter_name: Option<String>,
    /// 저장 창의 기본 파일명. 저장 전용.
    pub default_name: Option<String>,
    /// 확장자 생략 시 추가할 확장자(점 미포함). 저장 전용.
    pub default_ext: Option<String>,
}

/// 출력할 창 종류. 세 종류 모두 `IFileDialog` 인터페이스 공용, 설정만 상이.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Folder,
    File,
    Save,
}

/// 선택 요청 1건. 인자 7개를 구조체로 전달.
pub struct Ask {
    pub start: Option<String>,
    pub title: Option<String>,
    pub filters: Option<Vec<String>>,
    pub filter_name: Option<String>,
    pub name: Option<String>,
    pub ext: Option<String>,
    pub owner: isize,
    pub mode: Mode,
}

/// `start` → (열 폴더, 채울 파일명).
///
/// **셸 파싱 이름은 역슬래시만 허용.** 매크로는 슬래시 경로를 전달하므로(`compile.js` 의 `fixWinPaths`)
/// 변환 없이 전달 시 `SHCreateItemFromParsingName` 실패 후 `start` 무시.
///
/// 존재하지 않는 경로는 존재하는 상위 폴더 사용(오타로 OS 기본값이 열리면 원인 파악 불가).
fn resolve_start(start: Option<&str>, folders: bool) -> (Option<PathBuf>, Option<String>) {
    // 앞뒤 공백·개행 제거. 후행 공백으로 is_dir 실패 시 상위로 Fallback 되어 기본 폴더처럼 보인다.
    let Some(given) = start.map(str::trim).filter(|d| !d.is_empty()) else {
        return (None, None);
    };

    let norm = given.replace('/', "\\");
    let trimmed = norm.trim_end_matches('\\');
    // **`C:` 는 루트가 아닌 해당 드라이브의 현재 폴더.** 후미 구분자 제거 후 드라이브 문자만
    // 남으면 상대 경로가 되므로 원래 값 사용.
    let root = trimmed.len() == 2 && trimmed.as_bytes()[1] == b':';
    let path = Path::new(if trimmed.is_empty() || root { norm.as_str() } else { trimmed });

    // 파일 지정 시 해당 폴더를 열고 파일명 설정(파일 선택 전용).
    let (dir, name) = if !folders && path.is_file() {
        (
            path.parent(),
            path.file_name().map(|n| n.to_string_lossy().into_owned()),
        )
    } else {
        (Some(path), None)
    };

    let mut at = dir;
    while let Some(p) = at {
        if p.is_dir() {
            break;
        }
        at = p.parent();
    }

    (at.map(|p| p.to_path_buf()), name)
}

/// 폴더 선택. 선택 시 경로, 취소 시 `None`. `owner` 는 소유 창.
pub fn folder(options: Options, owner: isize) -> Result<Option<String>> {
    imp::pick(Ask {
        start: options.start,
        title: options.title,
        // 폴더 선택은 형식 필터 미사용.
        filters: None,
        filter_name: None,
        name: None,
        ext: None,
        owner,
        mode: Mode::Folder,
    })
}

/// 파일 선택. 선택 시 경로, 취소 시 `None`.
pub fn file(options: Options, owner: isize) -> Result<Option<String>> {
    imp::pick(Ask {
        start: options.start,
        title: options.title,
        filters: options.filters,
        filter_name: options.filter_name,
        name: None,
        ext: None,
        owner,
        mode: Mode::File,
    })
}

/// 저장 위치 선택. 선택 시 경로, 취소 시 `None`.
///
/// 신규 파일 지정을 위해 `FOS_FILEMUSTEXIST` 미적용. 기존 파일 선택 시 OS 가 Overwrite 여부 확인
/// (`FOS_OVERWRITEPROMPT`).
pub fn save(options: Options, owner: isize) -> Result<Option<String>> {
    imp::pick(Ask {
        start: options.start,
        title: options.title,
        filters: options.filters,
        filter_name: options.filter_name,
        name: options.default_name,
        ext: options.default_ext,
        owner,
        mode: Mode::Save,
    })
}

#[cfg(windows)]
mod imp {
    use crate::error::{Error, Result};

    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowThreadProcessId, LoadCursorW, SetCursor, IDC_ARROW,
    };
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{
        FileOpenDialog, FileSaveDialog, IFileDialog, IShellItem, SHCreateItemFromParsingName,
        FILEOPENDIALOGOPTIONS, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_OVERWRITEPROMPT,
        FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
    };

    use super::{Ask, Mode};

    pub fn pick(ask: Ask) -> Result<Option<String>> {
        // STA 전용 Thread 에서 실행(사유는 모듈 문서).
        let worker = std::thread::spawn(move || unsafe { show(&ask) });

        worker
            .join()
            .map_err(|_| Error::Window(crate::i18n::tr("rs.pickerBusy")))?
    }

    unsafe fn show(ask: &Ask) -> Result<Option<String>> {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
            .ok()
            .map_err(|e| Error::Window(crate::i18n::tr1("rs.pickerOpen", e)))?;

        let picked = unsafe { choose(ask) };

        unsafe { CoUninitialize() };

        picked
    }

    unsafe fn choose(ask: &Ask) -> Result<Option<String>> {
        let folders = ask.mode == Mode::Folder;
        let saving = ask.mode == Mode::Save;

        // 세 종류 모두 `IFileDialog` 로 수신(사용하는 옵션·필터·폴더·결과가 해당 인터페이스에 존재).
        let class = if saving { &FileSaveDialog } else { &FileOpenDialog };

        let dialog: IFileDialog =
            unsafe { CoCreateInstance(class, None, CLSCTX_INPROC_SERVER) }
                .map_err(|e| Error::Window(crate::i18n::tr1("rs.pickerOpen", e)))?;

        // FORCEFILESYSTEM: 라이브러리 등 가상 항목은 실제 경로가 없어 제외.
        let mut opts: FILEOPENDIALOGOPTIONS = FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
        opts |= if folders {
            FOS_PICKFOLDERS
        } else if saving {
            // 저장은 신규 파일 지정 허용. 기존 파일은 OS 가 Overwrite 여부 확인.
            FOS_OVERWRITEPROMPT
        } else {
            FOS_FILEMUSTEXIST
        };
        unsafe { dialog.SetOptions(opts) }
            .map_err(|e| Error::Window(crate::i18n::tr1("rs.pickerOpen", e)))?;

        if let Some(t) = ask.title.as_deref().filter(|s| !s.trim().is_empty()) {
            let wide = HSTRING::from(t);
            let _ = unsafe { dialog.SetTitle(PCWSTR(wide.as_ptr())) };
        }

        // 파일·저장 모드에서만 형식 필터. 주의: HSTRING 은 SetFileTypes 호출 동안 유지 필요
        // (PCWSTR 은 포인터만 참조)하므로 현재 스코프에 보관.
        if !folders {
            if let Some(exts) = ask.filters.as_deref() {
                let cleaned: Vec<String> = exts
                    .iter()
                    .map(|e| e.trim().trim_start_matches('.').to_lowercase())
                    .filter(|e| !e.is_empty())
                    .collect();

                if !cleaned.is_empty() {
                    let spec = cleaned
                        .iter()
                        .map(|e| format!("*.{e}"))
                        .collect::<Vec<_>>()
                        .join(";");
                    let label = ask
                        .filter_name
                        .as_deref()
                        .map(str::trim)
                        .filter(|n| !n.is_empty())
                        .map(str::to_owned)
                        .unwrap_or_else(|| crate::i18n::tr("rs.pickerFilter"));
                    let name_w = HSTRING::from(format!("{label} ({spec})"));
                    let spec_w = HSTRING::from(spec.as_str());
                    let all_name = HSTRING::from(format!("{} (*.*)", crate::i18n::tr("rs.pickerAll")));
                    let all_spec = HSTRING::from("*.*");

                    let specs = [
                        COMDLG_FILTERSPEC {
                            pszName: PCWSTR(name_w.as_ptr()),
                            pszSpec: PCWSTR(spec_w.as_ptr()),
                        },
                        COMDLG_FILTERSPEC {
                            pszName: PCWSTR(all_name.as_ptr()),
                            pszSpec: PCWSTR(all_spec.as_ptr()),
                        },
                    ];
                    let _ = unsafe { dialog.SetFileTypes(&specs) };
                }
            }
        }

        // 확장자 생략 시 추가(저장 전용).
        if let Some(e) = ask.ext.as_deref().map(|e| e.trim().trim_start_matches('.')) {
            if !e.is_empty() {
                let wide = HSTRING::from(e);
                let _ = unsafe { dialog.SetDefaultExtension(PCWSTR(wide.as_ptr())) };
            }
        }

        let (dir, found) = super::resolve_start(ask.start.as_deref(), folders);

        if let Some(p) = dir {
            let wide = HSTRING::from(p.to_string_lossy().as_ref());
            if let Ok(item) = unsafe {
                SHCreateItemFromParsingName::<_, _, IShellItem>(PCWSTR(wide.as_ptr()), None)
            } {
                let _ = unsafe { dialog.SetFolder(&item) };
            }
        }

        // 지정 파일명이 `start` 에서 추출한 파일명보다 우선.
        let name = ask
            .name
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(str::to_string)
            .or(found);

        if let Some(n) = name {
            let wide = HSTRING::from(n.as_str());
            let _ = unsafe { dialog.SetFileName(PCWSTR(wide.as_ptr())) };
        }

        let owner = ask.owner;

        let host = if owner == 0 {
            None
        } else {
            Some(HWND(owner as *mut _))
        };

        // cross-thread owner modal 은 입력 큐 분리로 커서가 간헐적으로 사라짐. Show 동안
        // owner(웹뷰) Thread 에 Attach 하여 커서·포커스 공유(아비터와 같은 기법).
        let mut attached = 0u32;
        if owner != 0 {
            let tid = unsafe { GetWindowThreadProcessId(HWND(owner as *mut _), None) };
            if tid != 0 && unsafe { AttachThreadInput(GetCurrentThreadId(), tid, true) }.as_bool() {
                attached = tid;
            }
        }

        // 대화상자가 빈 영역에서 커서 없이 출력되는 경우 대비로 기본 화살표 커서 사전 설정
        // (cross-thread 커서 상태 초기화 보강).
        unsafe {
            if let Ok(arrow) = LoadCursorW(None, IDC_ARROW) {
                SetCursor(Some(arrow));
            }
        }

        // 취소도 오류로 반환되어 실제 실패와 구분 불가. 모두 선택 없음 처리.
        let shown = unsafe { dialog.Show(host) };

        if attached != 0 {
            let _ = unsafe { AttachThreadInput(GetCurrentThreadId(), attached, false) };
        }

        if shown.is_err() {
            return Ok(None);
        }

        let item = unsafe { dialog.GetResult() }
            .map_err(|e| Error::Window(crate::i18n::tr1("rs.pickerFolder", e)))?;

        let raw = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }
            .map_err(|e| Error::Window(crate::i18n::tr1("rs.pickerFolder", e)))?;

        let path = unsafe { raw.to_string() }
            .map_err(|e| Error::Window(crate::i18n::tr1("rs.pickerFolder", e)))?;

        // COM 이 할당한 버퍼라 호출 측에서 해제.
        unsafe { CoTaskMemFree(Some(raw.0 as *const core::ffi::c_void)) };

        Ok(Some(path))
    }
}

#[cfg(not(windows))]
mod imp {
    use crate::error::{Error, Result};

    pub fn pick(_ask: super::Ask) -> Result<Option<String>> {
        Err(Error::Window(crate::i18n::tr("rs.pickerUnsupported")))
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::resolve_start;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{IShellItem, SHCreateItemFromParsingName};

    /// 셸 파싱 이름의 경로 허용 여부.
    fn parses(path: &str) -> bool {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let wide = HSTRING::from(path);
            let ok = SHCreateItemFromParsingName::<_, _, IShellItem>(PCWSTR(wide.as_ptr()), None).is_ok();
            CoUninitialize();
            ok
        }
    }

    /// **매크로는 슬래시 경로 전달**(`compile.js` 의 `fixWinPaths`). 셸 파싱 이름은 역슬래시만
    /// 허용하므로 정규화 없이 전달 시 `start` 무시.
    #[test]
    fn parsing_name_needs_backslashes() {
        let dir = std::env::temp_dir().join("webgba-picker-probe");
        std::fs::create_dir_all(&dir).unwrap();
        let back = dir.display().to_string();
        let fore = back.replace('\\', "/");

        assert!(parses(&back), "역슬래시 경로는 받아들여야 한다: {back}");
        assert!(
            !parses(&fore),
            "슬래시 경로가 통과하면 정규화가 불필요하다는 뜻이다: {fore}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 임시 폴더 하위에 `하위/보고서.txt` 생성 후 루트 경로 반환.
    fn fixture(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("webgba-picker-{tag}"));
        std::fs::create_dir_all(root.join("하위")).unwrap();
        std::fs::write(root.join("하위").join("보고서.txt"), b"x").unwrap();
        root
    }

    /// 슬래시 폴더 경로의 역슬래시 변환 확인(미변환 시 `start` 무시).
    #[test]
    fn resolve_start_turns_slashes_back() {
        let root = fixture("slash");
        let given = root.join("하위").display().to_string().replace('\\', "/");

        let (dir, name) = resolve_start(Some(&given), true);
        assert_eq!(dir.as_deref(), Some(root.join("하위").as_path()));
        assert_eq!(name, None, "폴더 선택에는 파일명을 채우지 않는다");
        assert!(parses(&dir.unwrap().to_string_lossy()), "셸이 받아들여야 한다");

        std::fs::remove_dir_all(&root).ok();
    }

    /// 파일 지정 시 해당 폴더를 열고 파일명 설정(파일 선택 전용).
    #[test]
    fn resolve_start_splits_a_file() {
        let root = fixture("file");
        let given = root.join("하위").join("보고서.txt").display().to_string().replace('\\', "/");

        let (dir, name) = resolve_start(Some(&given), false);
        assert_eq!(dir.as_deref(), Some(root.join("하위").as_path()));
        assert_eq!(name.as_deref(), Some("보고서.txt"));

        // 폴더 선택은 분리하지 않음(파일 선택 불가로 상위 폴더 사용).
        let (dir2, name2) = resolve_start(Some(&given), true);
        assert_eq!(dir2.as_deref(), Some(root.join("하위").as_path()));
        assert_eq!(name2, None);

        std::fs::remove_dir_all(&root).ok();
    }

    /// 존재하지 않는 경로는 존재하는 상위 폴더 사용(OS 기본값 미사용).
    #[test]
    fn resolve_start_climbs_to_an_existing_parent() {
        let root = fixture("climb");
        let given = root.join("없는폴더").join("더없는").display().to_string().replace('\\', "/");

        let (dir, _) = resolve_start(Some(&given), true);
        assert_eq!(dir.as_deref(), Some(root.as_path()));
        // `Path` 비교는 components 기반이라 `/`·`\` 를 동일 취급(정규화 여부 측정 불가).
        // 셸 허용 여부까지 확인.
        assert!(parses(&dir.unwrap().to_string_lossy()), "셸이 받아들여야 한다");

        std::fs::remove_dir_all(&root).ok();
    }

    /// 화면에서 전송된 저장 창 설정의 camelCase 이름 해석 확인.
    #[test]
    fn save_options_come_in_as_camel_case() {
        let options: super::Options = serde_json::from_str(
            r#"{"title":"다른 이름으로 저장","defaultName":"data.bin","defaultExt":"bin"}"#,
        )
        .unwrap();

        assert_eq!(options.default_name.as_deref(), Some("data.bin"));
        assert_eq!(options.default_ext.as_deref(), Some("bin"));
        assert_eq!(options.start, None, "생략한 값은 None 이다");
    }

    /// 빈 값·공백은 미지정과 동일.
    #[test]
    fn resolve_start_ignores_blanks() {
        assert_eq!(resolve_start(None, true), (None, None));
        assert_eq!(resolve_start(Some(""), true), (None, None));
        assert_eq!(resolve_start(Some("   "), false), (None, None));
    }

    /// 후미 구분자 제거 시 드라이브 루트의 상대 경로화 방지.
    #[test]
    fn resolve_start_keeps_a_drive_root() {
        let (dir, _) = resolve_start(Some("C:/"), true);
        assert_eq!(dir.as_deref(), Some(std::path::Path::new("C:\\")));
    }
}
