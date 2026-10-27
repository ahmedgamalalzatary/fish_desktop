//! Reports that depend on what the mobile shop sells, and how it counts units for the shared ones.

use crate::commands::reports::query;
use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

/// Units on a sale line `i`: every line is one phone.
pub const UNITS_SOLD: &str = "1";
/// Units in a stock movement `m`: +1 or -1 phone.
pub const MOVEMENT_UNITS: &str = "m.change_qty";

#[derive(Serialize)]
pub struct ProductRow {
    product_id: i64,
    name: String,
    units: i64,
    revenue: i64,
    cost: i64,
    profit: i64,
}

#[tauri::command]
pub fn report_by_product(
    state: State<AppState>,
    from: String,
    to: String,
) -> AppResult<Vec<ProductRow>> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    query(
        &db,
        "SELECT p.id, p.name, COUNT(*), SUM(i.price), SUM(i.cost)
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         JOIN products p ON p.id = i.product_id
         WHERE date(s.created_at) BETWEEN ?1 AND ?2
         GROUP BY p.id ORDER BY SUM(i.price) DESC",
        [&from, &to],
        |r| {
            let (revenue, cost): (i64, i64) = (r.get(3)?, r.get(4)?);
            Ok(ProductRow {
                product_id: r.get(0)?,
                name: r.get(1)?,
                units: r.get(2)?,
                revenue,
                cost,
                profit: revenue - cost,
            })
        },
    )
}

#[derive(Serialize)]
pub struct MovementRow {
    id: i64,
    created_at: String,
    product_name: String,
    serial: String,
    storage: String,
    color: String,
    change_qty: i64,
    reason: String,
    cost_total: Option<i64>,
    note: Option<String>,
    sale_id: Option<i64>,
    purchase_id: Option<i64>,
    supplier_name: Option<String>,
    user_name: String,
}

#[tauri::command]
pub fn report_movements(
    state: State<AppState>,
    from: String,
    to: String,
    reason: Option<String>,
) -> AppResult<Vec<MovementRow>> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    query(
        &db,
        "SELECT m.id, m.created_at, p.name, ph.serial, ph.storage, ph.color, m.change_qty, m.reason, m.cost_total,
                m.note, m.sale_id, m.purchase_id, s.name, u.name
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         JOIN phones ph ON ph.id = m.phone_id
         JOIN users u ON u.id = m.user_id
         LEFT JOIN purchases pu ON pu.id = m.purchase_id
         LEFT JOIN suppliers s ON s.id = pu.supplier_id
         WHERE date(m.created_at) BETWEEN ?1 AND ?2 AND (?3 IS NULL OR m.reason = ?3)
         ORDER BY m.id DESC LIMIT 2000",
        rusqlite::params![from, to, reason],
        |r| {
            Ok(MovementRow {
                id: r.get(0)?,
                created_at: r.get(1)?,
                product_name: r.get(2)?,
                serial: r.get(3)?,
                storage: r.get(4)?,
                color: r.get(5)?,
                change_qty: r.get(6)?,
                reason: r.get(7)?,
                cost_total: r.get(8)?,
                note: r.get(9)?,
                sale_id: r.get(10)?,
                purchase_id: r.get(11)?,
                supplier_name: r.get(12)?,
                user_name: r.get(13)?,
            })
        },
    )
}
