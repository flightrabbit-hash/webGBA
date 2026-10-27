//! 세이브·상태 파일 자리.
//!
//!   세이브  연 파일 바로 옆 `<연 파일 이름>.sav` 하나(.gba·.zip·.wgba·.wasm 모두, 사용자 2026-10-27)
//!   상태    gba/<n>  bin/state/<n>.ssN      web/<n>  bin/web/<n>/state.ssN
//!
//! 세이브는 그 `.sav` 파일 자체를 열어 직접 덮어쓴다(`files::write_in_place`). 백업·옛 판 세이브 옮기기·비교는 없다
//! (사용자 2026-10-27 "자동저장 기능은 같은 경로의 sav파일을 직접수정하는걸로 … 백업과 비교 등의 기능은 필요없어").

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{Error, Result};
use crate::ui;

/// 세이브로 받아들이는 가장 큰 크기.
const MAX_SAVE: usize = 16 * 1024 * 1024;

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

/* ── 상태 슬롯(앱 안쪽) ── */

/// 상태 슬롯 1~9 자리.
pub fn state_path(id: &str, slot: u8) -> Result<PathBuf> {
    if !(1..=9).contains(&slot) {
        return Err(Error::File(crate::i18n::tr1("rs.badSlot", slot)));
    }
    let (scope, name) = split(id)?;
    Ok(match scope {
        "gba" => ui::dir(ui::STATE_DIR).join(format!("{name}.ss{slot}")),
        _ => ui::dir(ui::WEB_DIR).join(&name).join(format!("state.ss{slot}")),
    })
}

/// 웹 빌드의 앱 안쪽 폴더(`bin/web/<n>`). 상태 슬롯이 있다.
pub fn web_dir(id: &str) -> Result<PathBuf> {
    let (_, name) = split(id)?;
    Ok(ui::dir(ui::WEB_DIR).join(name))
}

pub fn read_state(id: &str, slot: u8) -> Result<Vec<u8>> {
    let path = state_path(id, slot)?;
    match std::fs::read(&path) {
        Ok(bytes) => Ok(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(Error::File(format!("{}: {e}", path.display()))),
    }
}

pub fn write_state(id: &str, slot: u8, bytes: &[u8]) -> Result<()> {
    if bytes.len() > MAX_SAVE {
        return Err(Error::File(crate::i18n::tr("rs.tooLarge")));
    }
    crate::files::write_atomic(&state_path(id, slot)?, bytes)
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
        let path = state_path(id, slot)?;
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

/* ── 세이브(연 파일 옆) ── */

/// 연 파일 → 그 옆의 세이브 `<폴더>/<이름>.sav`.
pub fn beside_of(game: &str) -> PathBuf {
    Path::new(game).with_extension("sav")
}

/// 옆 세이브 읽기. 없으면 빈 바이트(세이브 없이 시작). 못 읽으면 오류 — 빈 세이브로 시작해 진짜 세이브를 덮어쓰지 않게.
pub fn read(path: &Path) -> Result<Vec<u8>> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(Error::File(format!("{}: {e}", path.display()))),
    };
    if bytes.len() > MAX_SAVE {
        return Err(Error::File(crate::i18n::tr1("rs.saveTooBig", path.display())));
    }
    Ok(bytes)
}

/// 세이브 쓰기 결과. `action`: `written`(씀) · `same`(내용이 같아 그대로).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Written {
    pub action: &'static str,
    pub path: String,
}

/// 게임이 쓴 세이브(또는 메뉴 "세이브 가져오기"로 고른 파일)를 옆 `.sav` 에 직접 덮어쓴다. 크기는 받은 그대로(포트 512KB 등).
/// 못 쓰면 오류만 돌려준다(따로 파일을 만들지 않음) — 화면은 메모리의 세이브를 그대로 두고 다음 저장·닫을 때 다시 쓴다.
pub fn write(path: &Path, bytes: &[u8]) -> Result<Written> {
    if bytes.is_empty() {
        return Err(Error::File(crate::i18n::tr("rs.emptySave")));
    }
    if bytes.len() > MAX_SAVE {
        return Err(Error::File(crate::i18n::tr("rs.tooLarge")));
    }
    let shown = path.to_string_lossy().into_owned();
    if std::fs::read(path).map(|now| now == bytes).unwrap_or(false) {
        return Ok(Written { action: "same", path: shown });
    }
    if let Err(e) = crate::files::write_in_place(path, bytes) {
        crate::logging::write("WARN", &format!("세이브를 쓰지 못했습니다 {shown}: {e}"));
        return Err(e);
    }
    Ok(Written { action: "written", path: shown })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Seek};

    fn fresh(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn files_in(dir: &Path) -> Vec<String> {
        let mut out: Vec<String> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        out.sort();
        out
    }

    #[test]
    fn names_cannot_escape_the_folder() {
        assert_eq!(clean_name("../../x"), "_.._x");
        assert_eq!(clean_name("a\\b/c:d"), "a_b_c_d");
        assert_eq!(clean_name("  ..  "), "game");
        assert_eq!(clean_name("게임 (E)"), "게임 (E)");
    }

    #[test]
    fn ids_need_a_known_scope() {
        assert!(split("gba/test").is_ok());
        assert!(split("web/x-abc").is_ok());
        assert!(split("etc/x").is_err());
        assert!(split("plain").is_err());
        assert!(state_path("gba/test", 0).is_err(), "세이브(슬롯 0)는 앱 안쪽에 두지 않는다");
        assert!(state_path("gba/test", 10).is_err());
    }

    #[test]
    fn save_sits_beside_the_opened_file() {
        assert_eq!(beside_of(r"C:\g\firered.wgba"), PathBuf::from(r"C:\g\firered.sav"));
        assert_eq!(beside_of(r"C:\g\Pokemon Fire Red (E).gba"), PathBuf::from(r"C:\g\Pokemon Fire Red (E).sav"));
        assert_eq!(beside_of(r"C:\g\a.b.zip"), PathBuf::from(r"C:\g\a.b.sav"));
    }

    #[test]
    fn write_overwrites_the_file_itself() {
        let dir = fresh("webgba-save-direct");
        let sav = dir.join("game.sav");

        assert!(read(&sav).unwrap().is_empty(), "없으면 빈 세이브로 시작");
        assert_eq!(write(&sav, b"first-long").unwrap().action, "written");
        assert_eq!(std::fs::read(&sav).unwrap(), b"first-long");
        assert_eq!(write(&sav, b"first-long").unwrap().action, "same", "내용이 같으면 쓰지 않는다");

        // 열어 둔 핸들은 그 파일 자체를 가리킨다. 이름 바꾸기로 새 파일을 끼웠다면 옛 내용이 읽힌다.
        let mut held = std::fs::File::open(&sav).unwrap();
        assert_eq!(write(&sav, b"two").unwrap().action, "written");
        let mut seen = Vec::new();
        held.rewind().unwrap();
        held.read_to_end(&mut seen).unwrap();
        assert_eq!(seen, b"two", "같은 파일을 고쳐 쓴다(새 파일로 바꾸지 않음), 짧아지면 뒤쪽을 잘라 낸다");
        drop(held);
        assert_eq!(std::fs::read(&sav).unwrap(), b"two");
        assert!(write(&sav, b"").is_err(), "빈 세이브는 쓰지 않는다");
        assert_eq!(files_in(&dir), ["game.sav"], ".bak·.tmp 같은 다른 파일을 만들지 않는다");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn failed_write_leaves_nothing_else() {
        let dir = fresh("webgba-save-readonly");
        let sav = dir.join("game.sav");
        std::fs::write(&sav, b"keep").unwrap();
        let mut perms = std::fs::metadata(&sav).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&sav, perms.clone()).unwrap();
        assert!(write(&sav, b"new").is_err(), "읽기 전용이면 실패");
        assert_eq!(std::fs::read(&sav).unwrap(), b"keep", "원래 파일은 그대로");
        assert_eq!(files_in(&dir), ["game.sav"], "따로 남기는 파일이 없다");
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        std::fs::set_permissions(&sav, perms).unwrap();
        assert_eq!(write(&sav, b"new").unwrap().action, "written", "다음에 다시 쓰면 된다");
        assert_eq!(std::fs::read(&sav).unwrap(), b"new");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_refuses_unreadable_saves() {
        let dir = fresh("webgba-save-unreadable");
        std::fs::create_dir_all(dir.join("game.sav")).unwrap();
        assert!(read(&dir.join("game.sav")).is_err(), "읽지 못하면 빈 세이브로 시작하지 않는다");
        assert!(write(&dir.join("game.sav"), b"x").is_err(), "폴더면 쓰지 못한다");
        std::fs::remove_dir_all(&dir).ok();
    }
}
