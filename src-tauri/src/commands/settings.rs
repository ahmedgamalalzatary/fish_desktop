use crate::error::{AppResult, invalid};
use crate::state::AppState;
use std::collections::HashMap;
use tauri::State;

const KEYS: &[&str] = &[
    "shop_name",
    "shop_phone",
    "shop_address",
    "receipt_footer",
    "currency",
];

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AppResult<HashMap<String, String>> {
    state.user()?;
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[tauri::command]
pub fn update_settings(state: State<AppState>, values: HashMap<String, String>) -> AppResult<()> {
    state.admin()?;
    let mut db = state.db.lock().unwrap();
    let tx = db.transaction()?;
    for (key, value) in &values {
        if !KEYS.contains(&key.as_str()) {
            return invalid(format!("إعداد غير معروف: {key}"));
        }
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            [key, value.trim()],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Writes a consistent copy of the database to `path`, even while the app is running.
#[tauri::command]
pub fn backup_database(state: State<AppState>, path: String) -> AppResult<()> {
    state.admin()?;
    let _ = std::fs::remove_file(&path);
    state.db.lock().unwrap().execute("VACUUM INTO ?1", [path])?;
    Ok(())
}
