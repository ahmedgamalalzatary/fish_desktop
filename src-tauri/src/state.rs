use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct SessionUser {
    pub id: i64,
    pub name: String,
    pub username: String,
    pub role: String,
}

impl SessionUser {
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub session: Mutex<Option<SessionUser>>,
}

impl AppState {
    pub fn new(conn: Connection) -> Self {
        Self { db: Mutex::new(conn), session: Mutex::new(None) }
    }

    pub fn user(&self) -> AppResult<SessionUser> {
        self.session.lock().unwrap().clone().ok_or(AppError::Unauthorized)
    }

    pub fn admin(&self) -> AppResult<SessionUser> {
        let user = self.user()?;
        if user.is_admin() { Ok(user) } else { Err(AppError::Forbidden) }
    }
}
