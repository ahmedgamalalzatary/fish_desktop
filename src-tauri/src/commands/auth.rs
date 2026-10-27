use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::{AppState, SessionUser};
use argon2::Argon2;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use rusqlite::{OptionalExtension, params};
use tauri::State;

pub fn hash_password(password: &str) -> AppResult<String> {
    if password.chars().count() < 4 {
        return invalid("كلمة المرور يجب ألا تقل عن 4 أحرف");
    }
    let salt = SaltString::generate(&mut rand_core::OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Other(e.to_string()))
}

fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|h| {
            Argon2::default()
                .verify_password(password.as_bytes(), &h)
                .is_ok()
        })
        .unwrap_or(false)
}

/// True on first run, when no user exists and the first admin must be created.
#[tauri::command]
pub fn needs_setup(state: State<AppState>) -> AppResult<bool> {
    let db = state.db.lock().unwrap();
    let count: i64 = db.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
    Ok(count == 0)
}

#[tauri::command]
pub fn setup_admin(
    state: State<AppState>,
    name: String,
    username: String,
    password: String,
) -> AppResult<SessionUser> {
    state.activation.require()?;
    let (name, username) = (name.trim().to_string(), username.trim().to_string());
    if name.is_empty() || username.is_empty() {
        return invalid("الاسم واسم المستخدم مطلوبان");
    }
    let hash = hash_password(&password)?;
    let db = state.db.lock().unwrap();
    let count: i64 = db.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
    if count > 0 {
        return Err(AppError::Forbidden);
    }
    db.execute(
        "INSERT INTO users (name, username, password_hash, role, created_at) VALUES (?1, ?2, ?3, 'admin', ?4)",
        params![name, username, hash, now()],
    )?;
    let user = SessionUser {
        id: db.last_insert_rowid(),
        name,
        username,
        role: "admin".into(),
    };
    *state.session.lock().unwrap() = Some(user.clone());
    Ok(user)
}

#[tauri::command]
pub fn login(state: State<AppState>, username: String, password: String) -> AppResult<SessionUser> {
    state.activation.require()?;
    let db = state.db.lock().unwrap();
    let row = db
        .query_row(
            "SELECT id, name, username, role, password_hash FROM users WHERE username = ?1 AND active = 1",
            [username.trim()],
            |r| {
                Ok((
                    SessionUser { id: r.get(0)?, name: r.get(1)?, username: r.get(2)?, role: r.get(3)? },
                    r.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?;
    match row {
        Some((user, hash)) if verify_password(&password, &hash) => {
            *state.session.lock().unwrap() = Some(user.clone());
            Ok(user)
        }
        _ => invalid("اسم المستخدم أو كلمة المرور غير صحيحة"),
    }
}

#[tauri::command]
pub fn logout(state: State<AppState>) {
    *state.session.lock().unwrap() = None;
}

#[tauri::command]
pub fn current_user(state: State<AppState>) -> Option<SessionUser> {
    state.session.lock().unwrap().clone()
}

#[tauri::command]
pub fn change_password(
    state: State<AppState>,
    current: String,
    new_password: String,
) -> AppResult<()> {
    let user = state.user()?;
    let db = state.db.lock().unwrap();
    let hash: String = db.query_row(
        "SELECT password_hash FROM users WHERE id = ?1",
        [user.id],
        |r| r.get(0),
    )?;
    if !verify_password(&current, &hash) {
        return invalid("كلمة المرور الحالية غير صحيحة");
    }
    db.execute(
        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
        params![hash_password(&new_password)?, user.id],
    )?;
    Ok(())
}
