use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct Expense {
    id: i64,
    created_at: String,
    amount: i64,
    reason: String,
    user_id: i64,
    user_name: String,
}

/// Anyone signed in can record an expense; it is always booked under their own name.
#[tauri::command]
pub fn create_expense(state: State<AppState>, amount: i64, reason: String) -> AppResult<i64> {
    let user = state.user()?;
    let db = state.db.lock().unwrap();
    insert_expense(&db, user.id, amount, &reason)
}

pub fn insert_expense(db: &Connection, user_id: i64, amount: i64, reason: &str) -> AppResult<i64> {
    if amount <= 0 {
        return invalid("أدخل مبلغاً صحيحاً");
    }
    if reason.trim().is_empty() {
        return invalid("سبب المصروف مطلوب");
    }
    db.execute(
        "INSERT INTO expenses (amount, reason, user_id, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![amount, reason.trim(), user_id, now()],
    )?;
    Ok(db.last_insert_rowid())
}

pub fn query_expenses(
    db: &Connection,
    from: &str,
    to: &str,
    user_id: Option<i64>,
) -> AppResult<Vec<Expense>> {
    let mut stmt = db.prepare(
        "SELECT e.id, e.created_at, e.amount, e.reason, e.user_id, u.name
         FROM expenses e JOIN users u ON u.id = e.user_id
         WHERE date(e.created_at) BETWEEN ?1 AND ?2 AND (?3 IS NULL OR e.user_id = ?3)
         ORDER BY e.id DESC",
    )?;
    let rows = stmt.query_map(params![from, to, user_id], |r| {
        Ok(Expense {
            id: r.get(0)?,
            created_at: r.get(1)?,
            amount: r.get(2)?,
            reason: r.get(3)?,
            user_id: r.get(4)?,
            user_name: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Dates are inclusive `YYYY-MM-DD`. Cashiers always get only their own expenses for today.
#[tauri::command]
pub fn list_expenses(
    state: State<AppState>,
    from: String,
    to: String,
    user_id: Option<i64>,
) -> AppResult<Vec<Expense>> {
    let user = state.user()?;
    let db = state.db.lock().unwrap();
    if user.is_admin() {
        query_expenses(&db, &from, &to, user_id)
    } else {
        query_expenses(&db, &today(), &today(), Some(user.id))
    }
}

/// Admins can delete any expense. Cashiers can only take back their own, on the day they made it.
#[tauri::command]
pub fn delete_expense(state: State<AppState>, id: i64) -> AppResult<()> {
    let user = state.user()?;
    let db = state.db.lock().unwrap();
    let (owner, day): (i64, String) = db
        .query_row(
            "SELECT user_id, date(created_at) FROM expenses WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or(AppError::NotFound("المصروف"))?;
    if !user.is_admin() && (owner != user.id || day != today()) {
        return Err(AppError::Forbidden);
    }
    db.execute("DELETE FROM expenses WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_expenses_under_the_user_and_filters_by_them() {
        let path = std::env::temp_dir().join(format!("mobile-pos-exp-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = crate::db::open(&path).unwrap();
        db.execute_batch(
            "INSERT INTO users (id, name, username, password_hash, role, created_at) VALUES
                 (1, 'أحمد', 'a', 'x', 'admin', '2026-01-01 00:00:00'),
                 (2, 'سارة', 's', 'x', 'cashier', '2026-01-01 00:00:00');",
        )
        .unwrap();
        assert!(insert_expense(&db, 1, 0, "إيجار").is_err());
        assert!(insert_expense(&db, 1, 500, "   ").is_err());
        insert_expense(&db, 1, 500000, "إيجار المحل").unwrap();
        insert_expense(&db, 2, 3000, " كهرباء ").unwrap();

        let all = query_expenses(&db, "2000-01-01", "2100-01-01", None).unwrap();
        assert_eq!(all.len(), 2);
        let hers = query_expenses(&db, "2000-01-01", "2100-01-01", Some(2)).unwrap();
        assert_eq!(hers.len(), 1);
        assert_eq!(
            (hers[0].reason.as_str(), hers[0].user_name.as_str()),
            ("كهرباء", "سارة")
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
