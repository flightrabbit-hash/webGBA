use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

/// 코어 전역 오류. `Serialize` 로 `invoke(...).catch(e => ...)` 에 문장 그대로 전달된다.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    File(String),

    #[error("{}", crate::i18n::tr1("rs.config", .0))]
    Config(String),

    #[error("{0}")]
    Window(String),

    #[error("{0}")]
    Game(String),
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// 경로를 붙인 입출력 오류.
pub fn io_at(path: &std::path::Path) -> impl Fn(std::io::Error) -> Error + '_ {
    move |e| Error::File(format!("{}: {e}", path.display()))
}
