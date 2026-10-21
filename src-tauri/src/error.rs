use serde::{Serialize, Serializer};

/// Errors returned to the frontend. The message is shown to the user as-is, so it is in Arabic.
#[derive(Debug)]
pub enum AppError {
    Unauthorized,
    Forbidden,
    NotFound(&'static str),
    Invalid(String),
    Db(rusqlite::Error),
    Other(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Unauthorized => write!(f, "يجب تسجيل الدخول أولاً"),
            AppError::Forbidden => write!(f, "ليس لديك صلاحية لهذا الإجراء"),
            AppError::NotFound(what) => write!(f, "{what} غير موجود"),
            AppError::Invalid(msg) => write!(f, "{msg}"),
            AppError::Db(e) => write!(f, "خطأ في قاعدة البيانات: {e}"),
            AppError::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e)
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub fn invalid<T>(msg: impl Into<String>) -> AppResult<T> {
    Err(AppError::Invalid(msg.into()))
}
