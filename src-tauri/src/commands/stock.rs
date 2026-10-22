use crate::db::now;
use crate::error::{AppResult, invalid};
use crate::state::AppState;
use rusqlite::params;
use tauri::State;

// Goods received are recorded as supplier invoices, see `purchases.rs`.

/// Sets stock to a counted value (e.g. after a stock-take or spoilage) and logs the difference.
#[tauri::command]
pub fn adjust_stock(
    state: State<AppState>,
    product_id: i64,
    new_grams: i64,
    note: Option<String>,
) -> AppResult<()> {
    let user = state.admin()?;
    if new_grams < 0 {
        return invalid("الكمية لا يمكن أن تكون سالبة");
    }
    let mut db = state.db.lock().unwrap();
    let tx = db.transaction()?;
    let current: i64 = tx.query_row(
        "SELECT stock_grams FROM products WHERE id = ?1",
        [product_id],
        |r| r.get(0),
    )?;
    let diff = new_grams - current;
    if diff == 0 {
        return Ok(());
    }
    tx.execute(
        "INSERT INTO stock_movements (product_id, change_grams, reason, note, user_id, created_at)
         VALUES (?1, ?2, 'adjustment', ?3, ?4, ?5)",
        params![
            product_id,
            diff,
            note.filter(|n| !n.trim().is_empty()),
            user.id,
            now()
        ],
    )?;
    tx.execute(
        "UPDATE products SET stock_grams = ?1 WHERE id = ?2",
        params![new_grams, product_id],
    )?;
    tx.commit()?;
    Ok(())
}
