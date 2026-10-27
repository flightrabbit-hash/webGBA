//! 세이브·상태 파일 자리. 화면은 저장 이름(`gba/<롬 이름>` 또는 `web/<빌드 이름>-<키>`)만 넘긴다.
//!
//!   gba/<n>  세이브 bin/save/<n>.sav        상태 bin/state/<n>.ssN
//!   web/<n>  세이브 bin/web/<n>/save.sav    상태 bin/web/<n>/state.ssN

use std::path::PathBuf;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::ui;

/// 파일 이름으로 못 쓰는 글자를 `_` 로. 경로 구분자가 남지 않게 한다.
pub fn clean_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "game".into()
    } else {
        trimmed.chars().take(120).collect()
    }
}

fn split(id: &str) -> Result<(&str, String)> {
    let (scope, name) = id.split_once('/').ok_or_else(|| Error::File(crate::i18n::tr1("rs.badStoreId", id)))?;
    match scope {
        "gba" | "web" => Ok((scope, clean_name(name))),
        _ => Err(Error::File(crate::i18n::tr1("rs.badStoreId", id))),
    }
}

/// `slot` 0 = 세이브, 1~9 = 상태 슬롯.
pub fn path_of(id: &str, slot: u8) -> Result<PathBuf> {
    if slot > 9 {
        return Err(Error::File(crate::i18n::tr1("rs.badSlot", slot)));
    }
    let (scope, name) = split(id)?;
    Ok(match (scope, slot) {
        ("gba", 0) => ui::dir(ui::SAVE_DIR).join(format!("{name}.sav")),
        ("gba", n) => ui::dir(ui::STATE_DIR).join(format!("{name}.ss{n}")),
        (_, 0) => ui::dir(ui::WEB_DIR).join(&name).join("save.sav"),
        (_, n) => ui::dir(ui::WEB_DIR).join(&name).join(format!("state.ss{n}")),
    })
}

pub fn read(id: &str, slot: u8) -> Result<Vec<u8>> {
    let path = path_of(id, slot)?;
    match std::fs::read(&path) {
        Ok(bytes) => Ok(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(Error::File(format!("{}: {e}", path.display()))),
    }
}

pub fn write(id: &str, slot: u8, bytes: &[u8], backup: bool) -> Result<String> {
    if bytes.len() > 16 * 1024 * 1024 {
        return Err(Error::File(crate::i18n::tr("rs.tooLarge")));
    }
    let path = path_of(id, slot)?;
    if slot == 0 {
        keep_shorter_save(&path, bytes.len());
    }
    crate::files::write_atomic(&path, bytes, backup && slot == 0)?;
    Ok(path.to_string_lossy().into_owned())
}

/// 세이브가 처음으로 커질 때(예: 포트 128KB → 512KB) 옛 크기 파일을 한 번만 `save.sav.128k.bak` 처럼 남긴다.
/// 게임이 옛 세이브를 읽어 큰 세이브로 옮겨 쓰므로, 옮기기 전 것을 되돌릴 수 있게.
fn keep_shorter_save(path: &std::path::Path, new_len: usize) {
    let Ok(meta) = std::fs::metadata(path) else { return };
    let old = meta.len() as usize;
    if old == 0 || old >= new_len {
        return;
    }
    let kept = PathBuf::from(format!("{}.{}k.bak", path.display(), old / 1024));
    if !kept.exists() {
        let _ = std::fs::copy(path, &kept);
    }
}

/// 롬 옆 세이브 가져오기 결과. `action`: `none`(그대로) · `copied`(webGBA 세이브가 없어 복사) · `replaced`(옆 세이브가 더 새것이라 백업 뒤 가져옴).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub action: &'static str,
    pub source: String,
    pub backup: Option<String>,
}

/// 롬 옆의 같은 이름 `.sav`(다른 실행기·웹 빌드 서버가 흔히 쓰는 자리)를 webGBA 세이브로 가져온다(사용자 2026-10-26).
///   webGBA 세이브가 없으면 복사, 옆 세이브가 더 새것이면 지금 세이브를 `<이름>.sav.<시각>.bak` 으로 남기고 가져온다.
/// 가져온 파일의 수정 시각은 옆 세이브와 같게 맞춘다 — 다음에 열 때 같은 세이브를 또 가져오지 않게.
pub fn import_beside(rom: &str, id: &str) -> Result<Imported> {
    let beside = std::path::Path::new(rom).with_extension("sav");
    import_file(&beside, &path_of(id, 0)?)
}

/// 정해 준 `.sav` 파일을 같은 규칙으로 가져온다("종료할 때 세이브 파일 만들기"가 쓴 파일을 다음에 열 때).
pub fn import_from(source: &str, id: &str) -> Result<Imported> {
    import_file(std::path::Path::new(source), &path_of(id, 0)?)
}

/// 세이브 파일 내보내기 결과. `action`: `none`(webGBA 세이브 없음) · `same`(내용이 같아 그대로) · `written`(씀).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exported {
    pub action: &'static str,
    pub path: String,
    pub backup: Option<String>,
}

/// 종료할 때 세이브 파일 만들기(사용자 2026-10-27). webGBA 세이브를 크기 그대로 `target` 에 쓴다.
///   같은 이름 파일이 있고 내용이 다르면 `<target>.bak` 하나로 남긴 뒤 덮어쓴다(이전 `.bak` 은 바뀜).
///   쓴 파일의 수정 시각은 webGBA 세이브와 같게 맞춘다 — 다음에 열 때 "더 새 세이브"로 다시 가져오지 않게.
pub fn export_to(id: &str, target: &str) -> Result<Exported> {
    export_file(&path_of(id, 0)?, std::path::Path::new(target))
}

fn export_file(source: &std::path::Path, target: &std::path::Path) -> Result<Exported> {
    let path = target.to_path_buf();
    let shown = path.to_string_lossy().into_owned();
    let bytes = match std::fs::read(source) {
        Ok(bytes) if !bytes.is_empty() => bytes,
        _ => return Ok(Exported { action: "none", path: shown, backup: None }),
    };
    let source_time = std::fs::metadata(source).and_then(|m| m.modified()).ok();
    let align = |file: &std::path::Path| {
        if let Some(time) = source_time {
            if let Ok(handle) = std::fs::OpenOptions::new().write(true).open(file) {
                let _ = handle.set_modified(time);
            }
        }
    };

    let mut backup = None;
    if let Ok(now) = std::fs::read(&path) {
        if now == bytes {
            align(&path);
            return Ok(Exported { action: "same", path: shown, backup: None });
        }
        let kept = PathBuf::from(format!("{}.bak", path.display()));
        std::fs::copy(&path, &kept).map_err(|e| Error::File(format!("{}: {e}", kept.display())))?;
        backup = Some(kept.to_string_lossy().into_owned());
    }
    crate::files::write_atomic(&path, &bytes, false)?;
    align(&path);
    Ok(Exported { action: "written", path: shown, backup })
}

fn import_file(beside: &std::path::Path, target: &std::path::Path) -> Result<Imported> {
    let source = beside.to_string_lossy().into_owned();
    let none = |source: String| Ok(Imported { action: "none", source, backup: None });
    let Ok(source_meta) = std::fs::metadata(beside) else { return none(source) };
    if !source_meta.is_file() || source_meta.len() == 0 || source_meta.len() > 1024 * 1024 {
        return none(source);
    }
    let bytes = std::fs::read(beside).map_err(|e| Error::File(format!("{source}: {e}")))?;
    let source_time = source_meta.modified().ok();

    let mut backup = None;
    let action = match std::fs::metadata(target) {
        Err(_) => "copied",
        Ok(target_meta) => {
            let target_time = target_meta.modified().ok();
            let newer = matches!((source_time, target_time), (Some(s), Some(t)) if s > t);
            if !newer || std::fs::read(target).map(|now| now == bytes).unwrap_or(false) {
                return none(source);
            }
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
            let kept = PathBuf::from(format!("{}.{stamp}.bak", target.display()));
            std::fs::copy(target, &kept).map_err(|e| Error::File(format!("{}: {e}", kept.display())))?;
            backup = Some(kept.to_string_lossy().into_owned());
            "replaced"
        }
    };

    crate::files::write_atomic(target, &bytes, false)?;
    if let Some(time) = source_time {
        if let Ok(file) = std::fs::OpenOptions::new().write(true).open(target) {
            let _ = file.set_modified(time);
        }
    }
    Ok(Imported { action, source, backup })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub slot: u8,
    pub modified: Option<String>,
}

/// 상태 슬롯 중 파일이 있는 것.
pub fn slots(id: &str) -> Result<Vec<Slot>> {
    let mut out = Vec::new();
    for slot in 1..=9u8 {
        let path = path_of(id, slot)?;
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        out.push(Slot {
            slot,
            modified: meta.modified().ok().map(|t| {
                let local: chrono::DateTime<chrono::Local> = t.into();
                local.format("%Y-%m-%d %H:%M:%S").to_string()
            }),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_cannot_escape_the_folder() {
        assert_eq!(clean_name("../../x"), "_.._x");
        assert_eq!(clean_name("a\\b/c:d"), "a_b_c_d");
        assert_eq!(clean_name("  ..  "), "game");
        assert_eq!(clean_name("게임 (E)"), "게임 (E)");
    }

    #[test]
    fn import_copies_then_only_newer_with_backup() {
        let dir = std::env::temp_dir().join("webgba-import-beside");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        let sav = dir.join("game.sav");
        let target = dir.join("bin").join("game.sav");

        assert_eq!(import_file(&sav, &target).unwrap().action, "none", "옆 세이브가 없으면 그대로");

        std::fs::write(&sav, b"first").unwrap();
        assert_eq!(import_file(&sav, &target).unwrap().action, "copied");
        assert_eq!(std::fs::read(&target).unwrap(), b"first");
        assert_eq!(import_file(&sav, &target).unwrap().action, "none", "같은 시각이면 다시 가져오지 않는다");

        std::fs::write(&target, b"played").unwrap();
        assert_eq!(import_file(&sav, &target).unwrap().action, "none", "webGBA 세이브가 더 새것이면 그대로");

        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(&sav, b"second").unwrap();
        let done = import_file(&sav, &target).unwrap();
        assert_eq!(done.action, "replaced");
        assert_eq!(std::fs::read(&target).unwrap(), b"second");
        assert_eq!(std::fs::read(done.backup.unwrap()).unwrap(), b"played", "바꾸기 전 세이브를 남긴다");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn export_keeps_one_backup_and_does_not_come_back_as_newer() {
        let dir = std::env::temp_dir().join("webgba-export-on-exit");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        let store = dir.join("bin").join("game.sav");
        let beside = dir.join("game.sav");

        assert_eq!(export_file(&store, &beside).unwrap().action, "none", "webGBA 세이브가 없으면 쓰지 않는다");
        assert!(!beside.exists());

        let big: Vec<u8> = (0..524_288u32).map(|i| (i % 251) as u8).collect();
        std::fs::write(&store, &big).unwrap();
        let first = export_file(&store, &beside).unwrap();
        assert_eq!(first.action, "written");
        assert!(first.backup.is_none(), "처음에는 백업할 파일이 없다");
        assert_eq!(std::fs::read(&beside).unwrap(), big, "크기·내용 그대로(512KB)");
        assert_eq!(import_file(&beside, &store).unwrap().action, "none", "다음에 열 때 다시 가져오지 않는다");
        assert_eq!(export_file(&store, &beside).unwrap().action, "same");

        std::fs::write(&beside, b"vba").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(&store, b"played").unwrap();
        let second = export_file(&store, &beside).unwrap();
        assert_eq!(second.action, "written");
        assert_eq!(std::fs::read(second.backup.unwrap()).unwrap(), b"vba", "덮어쓰기 전 파일을 .bak 으로 남긴다");
        assert_eq!(std::fs::read(&beside).unwrap(), b"played");
        assert_eq!(import_file(&beside, &store).unwrap().action, "none");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ids_need_a_known_scope() {
        assert!(split("gba/test").is_ok());
        assert!(split("web/x-abc").is_ok());
        assert!(split("etc/x").is_err());
        assert!(split("plain").is_err());
    }
}
