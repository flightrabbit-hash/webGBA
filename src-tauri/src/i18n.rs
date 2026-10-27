//! Rust 가 만드는 글(오류·파일 대화상자 형식 이름·`.wgba` 형식 이름)의 번역.
//!
//! 표는 화면과 같은 `src-bundle/src/i18n/<언어>.json` 을 exe 에 넣어 쓴다(한 언어에 표 하나). Rust 쪽 키는 `rs.` 로 시작한다.
//! 지금 언어는 켤 때 `personalization.cfg` 의 `lang` 으로 정하고, 설정 창에서 바꾸면 `lang_set` 으로 바뀐다.
//! 기록(log)은 번역하지 않는다(한국어 그대로).

use std::sync::{OnceLock, RwLock};

use serde_json::{Map, Value};

pub const LANGS: [&str; 3] = ["ko", "en", "ja"];

const TABLES: [(&str, &str); 3] = [
    ("ko", include_str!("../../src-bundle/src/i18n/ko.json")),
    ("en", include_str!("../../src-bundle/src/i18n/en.json")),
    ("ja", include_str!("../../src-bundle/src/i18n/ja.json")),
];

static CURRENT: RwLock<&'static str> = RwLock::new("ko");

static PARSED: OnceLock<Vec<(&'static str, Map<String, Value>)>> = OnceLock::new();

fn parsed() -> &'static [(&'static str, Map<String, Value>)] {
    PARSED.get_or_init(|| {
        TABLES
            .iter()
            .map(|(id, text)| {
                let map = serde_json::from_str::<Value>(text).ok().and_then(|v| v.as_object().cloned()).unwrap_or_default();
                (*id, map)
            })
            .collect()
    })
}

/// 모르는 언어는 한국어.
pub fn set(lang: &str) -> &'static str {
    let id = LANGS.iter().copied().find(|id| *id == lang).unwrap_or("ko");
    *CURRENT.write().unwrap_or_else(|p| p.into_inner()) = id;
    id
}

pub fn current() -> &'static str {
    *CURRENT.read().unwrap_or_else(|p| p.into_inner())
}

fn lookup(lang: &str, key: &str) -> Option<String> {
    parsed()
        .iter()
        .find(|(id, _)| *id == lang)
        .and_then(|(_, map)| map.get(key))
        .and_then(|v| v.as_str())
        .map(str::to_owned)
}

/// 지금 언어 → 한국어 → 키 순서로 찾는다.
pub fn tr(key: &str) -> String {
    lookup(current(), key).or_else(|| lookup("ko", key)).unwrap_or_else(|| key.to_owned())
}

/// `{0}` 자리에 값을 넣는다(Rust 쪽 문장은 자리가 하나뿐).
pub fn tr1(key: &str, value: impl std::fmt::Display) -> String {
    tr(key).replace("{0}", &value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_table_has_the_same_keys_and_slots() {
        let tables = parsed();
        let ko = &tables[0].1;
        assert!(ko.len() > 100, "한국어 표가 비었습니다");
        for (id, map) in tables {
            let mut missing: Vec<_> = ko.keys().filter(|k| !map.contains_key(*k)).collect();
            missing.extend(map.keys().filter(|k| !ko.contains_key(*k)));
            assert!(missing.is_empty(), "{id} 표의 키가 다릅니다: {missing:?}");
            for (key, value) in ko {
                let slots = |text: &str| {
                    let mut found: Vec<String> = text.split('{').skip(1).filter_map(|s| s.split_once('}').map(|(n, _)| n.to_owned())).collect();
                    found.sort();
                    found
                };
                let theirs = map.get(key).and_then(|v| v.as_str()).unwrap_or_default();
                assert_eq!(slots(value.as_str().unwrap_or_default()), slots(theirs), "{id} 의 {key} 자리 표시가 다릅니다");
            }
        }
    }

    #[test]
    fn unknown_language_falls_back_to_korean() {
        assert_eq!(set("fr"), "ko");
        assert_eq!(tr("rs.notFound"), "파일이 존재하지 않습니다");
        assert_eq!(tr1("rs.badSlot", 12), "슬롯은 1~9 입니다: 12");
        assert_eq!(lookup("en", "rs.notFound").as_deref(), Some("The file does not exist"));
        assert_eq!(lookup("ja", "rs.pickerAll").as_deref(), Some("すべてのファイル"));
        assert_eq!(tr("no.such.key"), "no.such.key");
    }
}
