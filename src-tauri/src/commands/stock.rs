use super::products::variant_owner;
use crate::db::now;
use crate::error::{AppResult, invalid};
use crate::state::AppState;
use rusqlite::params;
use tauri::State;

// Goods received are recorded as supplier invoices, see `purchases.rs`.

/// Sets a variant's stock to a counted value (e.g. after a stock-take or a damaged piece) and logs the difference.
#[tauri::command]
pub fn adjust_stock(
    state: State<AppState>,
    variant_id: i64,
    new_qty: i64,
    note: Option<String>,
) -> AppResult<()> {
    let user = state.admin()?;
    if new_qty < 0 {
        return invalid("الكمية لا يمكن أن تكون سالبة");
    }
    let mut db = state.db.lock().unwrap();
    let tx = db.transaction()?;
    let (product_id, _) = variant_owner(&tx, variant_id)?;
    let current: i64 = tx.query_row(
        "SELECT stock FROM product_variants WHERE id = ?1",
        [variant_id],
        |r| r.get(0),
    )?;
    let diff = new_qty - current;
    if diff == 0 {
        return Ok(());
    }
    tx.execute(
        "INSERT INTO stock_movements (product_id, variant_id, change_qty, reason, note, user_id, created_at)
         VALUES (?1, ?2, ?3, 'adjustment', ?4, ?5, ?6)",
        params![
            product_id,
            variant_id,
            diff,
            note.filter(|n| !n.trim().is_empty()),
            user.id,
            now()
        ],
    )?;
    tx.execute(
        "UPDATE product_variants SET stock = ?1 WHERE id = ?2",
        params![new_qty, variant_id],
    )?;
    tx.commit()?;
    Ok(())
}
