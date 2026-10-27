//! `bin/ini/setting.ini` — 사람이 고치는 설정(아비터와 같은 `키: 값` 꼴, `#` 은 주석).
//!
//! 모르는 키는 무시하고, 빠진 키는 기본값. 파일이 깨져도 앱은 뜬다.
//! 설정 창(SAVE)은 `EDITABLE` 의 키만 줄 단위로 값만 바꾼다 — 사람이 적은 주석·순서는 그대로 둔다(없는 키는 끝에 붙임).

use serde::Serialize;
use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::ui;

/// 설정 창이 바꾸는 `setting.ini` 키(모두 참·거짓). 창 크기 등 나머지는 파일에서만 고친다.
pub const EDITABLE: [&str; 3] = ["pauseWhenHidden", "saveBackup", "useDevelopKit"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub app_width: f64,
    pub app_height: f64,
    pub app_min_width: f64,
    pub app_min_height: f64,
    /// 개발자 도구·오른쪽 클릭 메뉴·시험용 원격 디버깅 허용.
    pub use_develop_kit: bool,
    /// 창이 최소화되거나 가려지면 게임을 멈춘다.
    pub pause_when_hidden: bool,
    /// 세이브를 처음 덮어쓸 때 `.bak` 을 남긴다.
    pub save_backup: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            app_width: 960.0,
            app_height: 720.0,
            app_min_width: 520.0,
            app_min_height: 420.0,
            use_develop_kit: false,
            pause_when_hidden: false,
            save_backup: true,
        }
    }
}

pub fn path() -> std::path::PathBuf {
    ui::dir(ui::INI_DIR).join("setting.ini")
}

pub fn load() -> Settings {
    let mut settings = Settings::default();
    let Ok(bytes) = std::fs::read(path()) else {
        return settings;
    };
    let text = String::from_utf8_lossy(&bytes);
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else { continue };
        let value = value.trim().trim_matches('"');
        let number = || value.parse::<f64>().ok().filter(|v| v.is_finite() && *v > 0.0);
        let flag = || match value.to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => Some(true),
            "false" | "0" | "no" | "off" => Some(false),
            _ => None,
        };
        match key.trim() {
            "appWidth" => settings.app_width = number().unwrap_or(settings.app_width),
            "appHeight" => settings.app_height = number().unwrap_or(settings.app_height),
            "appMinWidth" => settings.app_min_width = number().unwrap_or(settings.app_min_width),
            "appMinHeight" => settings.app_min_height = number().unwrap_or(settings.app_min_height),
            "useDevelopKit" => settings.use_develop_kit = flag().unwrap_or(settings.use_develop_kit),
            "pauseWhenHidden" => settings.pause_when_hidden = flag().unwrap_or(settings.pause_when_hidden),
            "saveBackup" => settings.save_backup = flag().unwrap_or(settings.save_backup),
            _ => {}
        }
    }
    settings
}

/// 설정 창의 SAVE. `patch` 는 `EDITABLE` 키 → 참·거짓. 고친 뒤 다시 읽은 값을 돌려준다.
pub fn save(patch: &Map<String, Value>) -> Result<Settings> {
    let text = std::fs::read(path()).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    std::fs::write(path(), rewrite(&text, patch)?).map_err(|e| Error::Config(e.to_string()))?;
    Ok(load())
}

fn rewrite(text: &str, patch: &Map<String, Value>) -> Result<String> {
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    for (key, value) in patch {
        if !EDITABLE.contains(&key.as_str()) {
            return Err(Error::Config(crate::i18n::tr1("rs.unknownSetting", key)));
        }
        let Some(flag) = value.as_bool() else {
            return Err(Error::Config(crate::i18n::tr1("rs.unknownSetting", format!("{key}: {value}"))));
        };
        let line = format!("{key}: {flag}");
        let found = lines.iter().position(|one| {
            let one = one.trim();
            !one.starts_with('#') && one.split_once(':').map(|(k, _)| k.trim() == key).unwrap_or(false)
        });
        match found {
            Some(at) => lines[at] = line,
            None => lines.push(line),
        }
    }
    let mut out = lines.join("\n");
    out.push('\n');
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrite_keeps_comments_and_changes_only_values() {
        let text = "# webGBA\n#GAME\n# pauseWhenHidden 설명\npauseWhenHidden: false\nsaveBackup: true\nappWidth: 960\n";
        let mut patch = Map::new();
        patch.insert("pauseWhenHidden".into(), Value::Bool(true));
        patch.insert("useDevelopKit".into(), Value::Bool(false));
        let out = rewrite(text, &patch).unwrap();
        assert_eq!(out, "# webGBA\n#GAME\n# pauseWhenHidden 설명\npauseWhenHidden: true\nsaveBackup: true\nappWidth: 960\nuseDevelopKit: false\n");

        let mut bad = Map::new();
        bad.insert("appWidth".into(), Value::Bool(true));
        assert!(rewrite(text, &bad).is_err(), "설정 창이 바꾸지 않는 키는 거절");
    }
}
