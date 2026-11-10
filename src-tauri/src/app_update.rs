//! webGBA exe 자체 업데이트(설계 33절, README 12.6). 받기·서명 확인은 화면(`app/update-app.js`)이 하고,
//! 여기는 exe 폴더 안 단계 폴더 기록 → 새 exe 확인 → 이름 바꾸기 교체(실패하면 되돌림) → 새 exe 실행 → 정리만 맡는다.
//!
//! ```text
//!   webgba.exe            → webgba.exe.old (실행 중 exe 도 이름 바꾸기는 된다) → 새 화면이 뜬 뒤 삭제
//!   .webgba-update/       단계 폴더: 받은 파일 · cleanup(지울 .old 목록)
//! ```

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::error::{Error, Result};
use crate::i18n::tr1;
use crate::{logging, ui};

pub const VERSION_FLAG: &str = "--webgba-version";
const UPDATED_FLAG: &str = "--webgba-updated=";
const FROM_FLAG: &str = "--webgba-from=";
const STAGE_DIR: &str = ".webgba-update";
const CLEANUP_FILE: &str = "cleanup";
/// 규격의 exe 이름. 사용자가 exe 이름을 바꿨어도 지금 실행 중인 파일을 바꾼다.
const EXE_NAME: &str = "webgba.exe";

/// 업데이트 뒤 다시 시작한 실행이면 옛 버전.
pub fn updated_from() -> Option<String> {
    std::env::args().find_map(|a| a.strip_prefix(FROM_FLAG).map(str::to_owned))
}

/// Tauri·단일 인스턴스보다 먼저: 버전 확인 실행이면 버전만 출력하고 끝(→ true), 업데이트 뒤 실행이면 옛 프로세스가 끝나기를 기다림.
/// 기다리지 않으면 단일 인스턴스 플러그인이 아직 살아 있는 옛 창으로 넘기고 새 exe 가 끝난다.
pub fn early() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == VERSION_FLAG) {
        use std::io::Write;
        let _ = writeln!(std::io::stdout(), "webGBA {}", env!("CARGO_PKG_VERSION"));
        return true;
    }
    if let Some(pid) = args.iter().find_map(|a| a.strip_prefix(UPDATED_FLAG)).and_then(|p| p.parse::<u32>().ok()) {
        wait_exit(pid, 30_000);
        wait_webview_free(Duration::from_secs(20));
    }
    false
}

/// 옛 웹뷰 브라우저 프로세스가 사용자 데이터 폴더를 놓을 때까지(보통 옛 exe 종료 뒤 1초). 놓기 전에 새 웹뷰를 만들면 Chromium 단일 프로세스
/// 확인이 끝나 가는 옛 프로세스에 묻다가 시간 초과까지 기다려 새 창이 10~50초 늦게 뜸(실측 — 정상 다시 실행은 옛 프로세스 1초).
/// `lockfile` = 브라우저가 쓰기 공유 없이 열고 닫으면 지워지는 파일.
fn wait_webview_free(limit: Duration) {
    let lock = ui::dir(ui::WEBVIEW_DIR).join("EBWebView").join("lockfile");
    let until = Instant::now() + limit;
    while Instant::now() < until {
        match std::fs::OpenOptions::new().write(true).open(&lock) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => std::thread::sleep(Duration::from_millis(100)),
            _ => return,
        }
    }
}

#[cfg(windows)]
fn wait_exit(pid: u32, ms: u32) {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
    unsafe {
        if let Ok(handle) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
            WaitForSingleObject(handle, ms);
            let _ = CloseHandle(handle);
        }
    }
}

#[cfg(not(windows))]
fn wait_exit(_pid: u32, _ms: u32) {}

/// 규격 경로: 영문·숫자·`._-` 조각, `.`·`..` 조각 금지, `bin/`(설정·기록·퀵슬롯) 아래 금지, `.old` 로 끝나는 이름 금지.
pub fn path_ok(rel: &str) -> bool {
    if rel.is_empty() || rel.len() > 128 || rel.to_ascii_lowercase().ends_with(".old") {
        return false;
    }
    let parts: Vec<&str> = rel.split('/').collect();
    if parts[0].eq_ignore_ascii_case(ui::BIN_DIR) || parts[0].eq_ignore_ascii_case(STAGE_DIR) {
        return false;
    }
    parts.iter().all(|part| {
        !part.is_empty()
            && !part.starts_with('.')
            && !part.ends_with('.')
            && part.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    })
}

fn exe_path() -> Result<PathBuf> {
    std::env::current_exe().map_err(|e| Error::File(e.to_string()))
}

pub fn exe_name() -> String {
    exe_path().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())).unwrap_or_else(|| EXE_NAME.into())
}

fn stage_dir() -> PathBuf {
    ui::app_root().join(STAGE_DIR)
}

/// 규격 경로 → exe 폴더 안 실제 파일.
fn target_of(rel: &str) -> PathBuf {
    if rel.eq_ignore_ascii_case(EXE_NAME) {
        return ui::app_root().join(exe_name());
    }
    rel.split('/').fold(ui::app_root(), |at, part| at.join(part))
}

fn staged_of(rel: &str) -> PathBuf {
    rel.split('/').fold(stage_dir(), |at, part| at.join(part))
}

fn old_of(target: &Path) -> PathBuf {
    let mut name = target.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".old");
    target.with_file_name(name)
}

fn bad_path(rel: &str) -> Error {
    Error::File(tr1("rs.appUpdatePath", rel))
}

/// 받은 파일 하나를 단계 폴더에. `first` 면 이전 단계 폴더(실패한 업데이트의 남은 파일)를 먼저 비운다.
pub fn stage(rel: &str, bytes: &[u8], first: bool) -> Result<()> {
    if !path_ok(rel) {
        return Err(bad_path(rel));
    }
    if first {
        cleanup();
    }
    let file = staged_of(rel);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(crate::error::io_at(parent))?;
    }
    std::fs::write(&file, bytes).map_err(crate::error::io_at(&file))
}

/// 바이러스 검사 등이 방금 쓴 파일을 잠깐 열고 있을 수 있어 몇 번 다시 시도.
fn retry(mut work: impl FnMut() -> std::io::Result<()>) -> std::io::Result<()> {
    let mut tries = 0;
    loop {
        match work() {
            Ok(()) => return Ok(()),
            Err(e) if tries < 10 && e.kind() != std::io::ErrorKind::NotFound => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e),
        }
    }
}

/// 단계 폴더의 새 exe 를 버전 확인으로 실행 — 이 PC 에서 실행되는지, 봉투 버전과 같은지.
fn check_exe(exe: &Path, version: &str) -> Result<()> {
    let fail = |why: String| Error::File(tr1("rs.appUpdateCheck", why));
    let mut command = std::process::Command::new(exe);
    command.arg(VERSION_FLAG).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|e| fail(e.to_string()))?;
    let until = Instant::now() + Duration::from_secs(10);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(fail("timeout".into()));
            }
            Err(e) => return Err(fail(e.to_string())),
        }
    };
    let mut out = String::new();
    if let Some(mut pipe) = child.stdout.take() {
        let _ = pipe.read_to_string(&mut out);
    }
    let said = out.trim().strip_prefix("webGBA ").unwrap_or("").to_owned();
    if !status.success() || said != version {
        return Err(fail(format!("{} ≠ {version}", if said.is_empty() { out.trim() } else { &said })));
    }
    Ok(())
}

struct Swapped {
    target: PathBuf,
    old: Option<PathBuf>,
}

fn roll_back(done: &[Swapped]) {
    for item in done.iter().rev() {
        let _ = retry(|| std::fs::remove_file(&item.target));
        if let Some(old) = &item.old {
            if let Err(e) = retry(|| std::fs::rename(old, &item.target)) {
                logging::write("ERROR", &format!("[앱] 업데이트 되돌리기 실패 {} → {}: {e}", old.display(), item.target.display()));
            }
        }
    }
}

fn swap_one(rel: &str) -> std::io::Result<Swapped> {
    let staged = staged_of(rel);
    let target = target_of(rel);
    let had = target.exists();
    let old = old_of(&target);
    if had {
        if old.exists() {
            retry(|| std::fs::remove_file(&old))?;
        }
        retry(|| std::fs::rename(&target, &old))?;
    } else if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if let Err(e) = retry(|| std::fs::rename(&staged, &target)) {
        if had {
            let _ = retry(|| std::fs::rename(&old, &target));
        }
        return Err(e);
    }
    Ok(Swapped { target, old: had.then_some(old) })
}

/// 단계 폴더의 파일로 교체하고 새 exe 를 실행한다. 어느 단계든 실패하면 바꾼 파일을 모두 되돌린다.
/// 성공하면 화면이 정상 종료(게임 종료·기록 flush)하고, 새 exe 는 이 프로세스가 끝나기를 기다린 뒤 뜬다.
pub fn install(version: &str, from: &str, files: &[String]) -> Result<()> {
    if files.is_empty() {
        return Err(bad_path(""));
    }
    for rel in files {
        if !path_ok(rel) {
            return Err(bad_path(rel));
        }
        if !staged_of(rel).is_file() {
            return Err(Error::File(tr1("rs.appUpdateSwap", rel)));
        }
    }
    if files.iter().any(|rel| rel.eq_ignore_ascii_case(EXE_NAME)) {
        check_exe(&staged_of(EXE_NAME), version)?;
    }
    let mut done: Vec<Swapped> = Vec::new();
    for rel in files {
        match swap_one(rel) {
            Ok(item) => done.push(item),
            Err(e) => {
                roll_back(&done);
                logging::write("WARN", &format!("[앱] 업데이트 교체 실패 → 되돌림 · {rel}: {e}"));
                return Err(Error::File(tr1("rs.appUpdateSwap", format!("{rel}: {e}"))));
            }
        }
    }
    let olds: Vec<String> = done.iter().filter_map(|item| item.old.as_ref()).map(|p| p.to_string_lossy().into_owned()).collect();
    let _ = std::fs::write(stage_dir().join(CLEANUP_FILE), olds.join("\n"));
    let exe = ui::app_root().join(exe_name());
    let from: String = from.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+')).take(32).collect();
    let args = [format!("{UPDATED_FLAG}{}", std::process::id()), format!("{FROM_FLAG}{from}")];
    if let Err(e) = spawn_clean(&exe, &args, &ui::app_root()) {
        roll_back(&done);
        logging::write("WARN", &format!("[앱] 업데이트 뒤 새 exe 실행 실패 → 되돌림 · {e}"));
        return Err(Error::File(tr1("rs.appUpdateStart", e)));
    }
    logging::write("INFO", &format!("[앱] 업데이트 교체 완료 {from} → {version} · 파일 {}개 · 새 exe 실행 → 이 프로세스 종료", files.len()));
    Ok(())
}

/// 새 exe 실행. std `Command` 는 핸들 상속을 켜서 상속 가능한 핸들(WebView2 것 포함)까지 새 exe 로 넘어가,
/// 새 exe 를 닫아도 그 웹뷰 프로세스가 남았다(실측) → 상속 없이 실행.
#[cfg(windows)]
fn spawn_clean(exe: &Path, args: &[String], cwd: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{CreateProcessW, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOW};
    let wide = |s: &std::ffi::OsStr| s.encode_wide().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let app = wide(exe.as_os_str());
    let dir = wide(cwd.as_os_str());
    let line = format!("\"{}\" {}", exe.display(), args.join(" "));
    let mut line: Vec<u16> = line.encode_utf16().chain(std::iter::once(0)).collect();
    let startup = STARTUPINFOW { cb: std::mem::size_of::<STARTUPINFOW>() as u32, ..Default::default() };
    let mut info = PROCESS_INFORMATION::default();
    unsafe {
        CreateProcessW(PCWSTR(app.as_ptr()), Some(PWSTR(line.as_mut_ptr())), None, None, false, PROCESS_CREATION_FLAGS(0), None, PCWSTR(dir.as_ptr()), &startup, &mut info)
            .map_err(|e| std::io::Error::other(e.message()))?;
        let _ = CloseHandle(info.hThread);
        let _ = CloseHandle(info.hProcess);
    }
    Ok(())
}

#[cfg(not(windows))]
fn spawn_clean(exe: &Path, args: &[String], cwd: &Path) -> std::io::Result<()> {
    std::process::Command::new(exe).args(args).current_dir(cwd).spawn().map(|_| ())
}

/// 지난 업데이트의 `.old` 와 단계 폴더를 지운다. 업데이트 뒤 실행은 화면이 다 뜬 뒤(새 exe 가 시작하지 못하면 `.old` 로 되돌릴 수 있게),
/// 보통 실행은 시작할 때.
pub fn cleanup() {
    let dir = stage_dir();
    if !dir.exists() {
        return;
    }
    if let Ok(list) = std::fs::read_to_string(dir.join(CLEANUP_FILE)) {
        let root = ui::app_root();
        for line in list.lines().map(str::trim).filter(|l| !l.is_empty()) {
            let old = PathBuf::from(line);
            if old.starts_with(&root) && old.to_string_lossy().to_ascii_lowercase().ends_with(".old") {
                if let Err(e) = retry(|| std::fs::remove_file(&old)) {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        logging::write("WARN", &format!("[앱] 지난 업데이트 파일을 지우지 못함 {}: {e}", old.display()));
                        return;
                    }
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_out_of_user_data() {
        for ok in ["webgba.exe", "LICENSE", "THIRD_PARTY_NOTICES", "tools/x-1.dll"] {
            assert!(path_ok(ok), "{ok}");
        }
        for bad in ["", "bin/ini/setting.ini", "BIN/core/x", "../x", "a/../b", "./a", "a/", "/a", "a\\b", "C:/x", ".webgba-update/x", "x.old", "a./b", ".hidden", "a b"] {
            assert!(!path_ok(bad), "{bad}");
        }
    }
}
