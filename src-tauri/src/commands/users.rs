use super::auth::hash_password;
use crate::db::now;
use crate::error::{AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize)]
pub struct User {
    id: i64,
    name: String,
    username: String,
    role: String,
    active: bool,
    created_at: String,
    sales_count: i64,
}

#[derive(Deserialize)]
pub struct UserInput {
    name: String,
    username: String,
    role: String,
    active: bool,
    /// Required on create; on update an empty value keeps the current password.
    password: Option<String>,
}

impl UserInput {
    fn validate(&self) -> AppResult<()> {
        if self.name.trim().is_empty() || self.username.trim().is_empty() {
            return invalid("الاسم واسم المستخدم مطلوبان");
        }
        if self.role != "admin" && self.role != "cashier" {
            return invalid("صلاحية غير صحيحة");
        }
        Ok(())
    }
}

fn map_unique(e: rusqlite::Error) -> crate::error::AppError {
    if let rusqlite::Error::SqliteFailure(f, _) = &e
        && f.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
    {
        return crate::error::AppError::Invalid("اسم المستخدم مستخدم بالفعل".into());
    }
    e.into()
}

/// Refuses changes that would leave the shop with no active admin.
fn ensure_other_admin(db: &Connection, user_id: i64) -> AppResult<()> {
    let others: i64 = db.query_row(
        "SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id != ?1",
        [user_id],
        |r| r.get(0),
    )?;
    if others == 0 {
        invalid("يجب أن يبقى مدير واحد نشط على الأقل")
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn list_users(state: State<AppState>) -> AppResult<Vec<User>> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT u.id, u.name, u.username, u.role, u.active, u.created_at,
                (SELECT COUNT(*) FROM sales s WHERE s.user_id = u.id)
         FROM users u ORDER BY u.active DESC, u.name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(User {
            id: r.get(0)?,
            name: r.get(1)?,
            username: r.get(2)?,
            role: r.get(3)?,
            active: r.get(4)?,
            created_at: r.get(5)?,
            sales_count: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[tauri::command]
pub fn create_user(state: State<AppState>, input: UserInput) -> AppResult<i64> {
    state.admin()?;
    input.validate()?;
    let hash = hash_password(input.password.as_deref().unwrap_or(""))?;
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO users (name, username, password_hash, role, active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![input.name.trim(), input.username.trim(), hash, input.role, input.active, now()],
    )
    .map_err(map_unique)?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_user(state: State<AppState>, id: i64, input: UserInput) -> AppResult<()> {
    let me = state.admin()?;
    input.validate()?;
    let db = state.db.lock().unwrap();
    if id == me.id && (!input.active || input.role != "admin") {
        return invalid("لا يمكنك إيقاف حسابك أو تغيير صلاحيتك");
    }
    if !input.active || input.role != "admin" {
        ensure_other_admin(&db, id)?;
    }
    db.execute(
        "UPDATE users SET name = ?1, username = ?2, role = ?3, active = ?4 WHERE id = ?5",
        params![
            input.name.trim(),
            input.username.trim(),
            input.role,
            input.active,
            id
        ],
    )
    .map_err(map_unique)?;
    if let Some(pw) = input.password.as_deref().filter(|p| !p.is_empty()) {
        db.execute(
            "UPDATE users SET password_hash = ?1 WHERE id = ?2",
            params![hash_password(pw)?, id],
        )?;
    }
    Ok(())
}

/// Deletes a user with no history; users who made sales are deactivated instead so reports stay intact.
#[tauri::command]
pub fn delete_user(state: State<AppState>, id: i64) -> AppResult<&'static str> {
    let me = state.admin()?;
    if id == me.id {
        return invalid("لا يمكنك حذف حسابك");
    }
    let db = state.db.lock().unwrap();
    ensure_other_admin(&db, id)?;
    let history: i64 = db.query_row(
        "SELECT (SELECT COUNT(*) FROM sales WHERE user_id = ?1) + (SELECT COUNT(*) FROM stock_movements WHERE user_id = ?1)",
        [id],
        |r| r.get(0),
    )?;
    if history > 0 {
        db.execute("UPDATE users SET active = 0 WHERE id = ?1", [id])?;
        Ok("deactivated")
    } else {
        db.execute("DELETE FROM users WHERE id = ?1", [id])?;
        Ok("deleted")
    }
}
