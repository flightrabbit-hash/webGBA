//! `bin/ini/personalization.cfg` — 앱이 기억하는 값(JSON). 아비터와 같은 자리·이름.
//!
//! 창 위치(`window`)는 Rust 가 쓰고, 나머지(최근 연 파일·키 설정·소리·화면·웹 빌드별 롬)는 화면이
//! `prefs_set` 으로 맨 위 키 단위로 덮어쓴다. 파일이 깨져 있으면 빈 값으로 시작한다(앱은 떠야 한다).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::ui;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct WindowSpot {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
}

static LOCK: Mutex<()> = Mutex::new(());

pub fn path() -> std::path::PathBuf {
    ui::dir(ui::INI_DIR).join("personalization.cfg")
}

fn read() -> Map<String, Value> {
    std::fs::read(path())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn write(map: &Map<String, Value>) -> Result<()> {
    let text = serde_json::to_string_pretty(&Value::Object(map.clone())).map_err(|e| Error::Config(e.to_string()))?;
    let target = path();
    let temp = target.with_extension("cfg.tmp");
    std::fs::write(&temp, text).map_err(|e| Error::Config(e.to_string()))?;
    std::fs::rename(&temp, &target).map_err(|e| Error::Config(e.to_string()))
}

/// 화면에 넘길 값(창 위치는 빼고).
pub fn prefs() -> Value {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut map = read();
    map.remove("window");
    Value::Object(map)
}

/// 맨 위 키 단위로 덮어쓴다. `null` 은 그 키를 지운다. `window` 는 받지 않는다.
pub fn merge(patch: Value) -> Result<()> {
    let Value::Object(patch) = patch else {
        return Err(Error::Config(crate::i18n::tr("rs.configObject")));
    };
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut map = read();
    for (key, value) in patch {
        if key == "window" {
            continue;
        }
        if value.is_null() {
            map.remove(&key);
        } else {
            map.insert(key, value);
        }
    }
    write(&map)
}

pub fn window_spot() -> Option<WindowSpot> {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    read().get("window").and_then(|v| serde_json::from_value(v.clone()).ok())
}

pub fn set_window_spot(spot: WindowSpot) {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut map = read();
    if let Ok(value) = serde_json::to_value(spot) {
        map.insert("window".into(), value);
        let _ = write(&map);
    }
}
