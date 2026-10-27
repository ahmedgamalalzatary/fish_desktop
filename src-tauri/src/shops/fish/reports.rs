//! Reports that depend on what the fish shop sells, and how it counts units for the shared ones.

use crate::commands::reports::query;
use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

/// Units on a sale line `i`: the grams it took out of stock.
pub const UNITS_SOLD: &str = "i.weight_grams";
/// Units in a stock movement `m`: grams in (+) or out (−).
pub const MOVEMENT_UNITS: &str = "m.change_grams";

#[derive(Serialize)]
pub struct ProductRow {
    product_id: i64,
    name: String,
    category_name: String,
    units: i64,
    grams: i64,
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
        "SELECT p.id, p.name, c.name,
                SUM(CASE WHEN i.variant_id IS NOT NULL THEN i.quantity ELSE 0 END),
                SUM(i.weight_grams), SUM(i.line_total), SUM(i.line_cost)
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         JOIN products p ON p.id = i.product_id
         JOIN categories c ON c.id = p.category_id
         WHERE date(s.created_at) BETWEEN ?1 AND ?2
         GROUP BY p.id ORDER BY SUM(i.line_total) DESC",
        [&from, &to],
        |r| {
            let (revenue, cost): (i64, i64) = (r.get(5)?, r.get(6)?);
            Ok(ProductRow {
                product_id: r.get(0)?,
                name: r.get(1)?,
                category_name: r.get(2)?,
                units: r.get(3)?,
                grams: r.get(4)?,
                revenue,
                cost,
                profit: revenue - cost,
            })
        },
    )
}

#[derive(Serialize)]
pub struct CategoryRow {
    category_id: i64,
    name: String,
    parent_id: Option<i64>,
    parent_name: Option<String>,
    grams: i64,
    revenue: i64,
    profit: i64,
}

/// Per leaf category; the frontend rolls sub-categories up into their parent when needed.
#[tauri::command]
pub fn report_by_category(
    state: State<AppState>,
    from: String,
    to: String,
) -> AppResult<Vec<CategoryRow>> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    query(
        &db,
        "SELECT c.id, c.name, pc.id, pc.name, SUM(i.weight_grams), SUM(i.line_total), SUM(i.line_total - i.line_cost)
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         JOIN products p ON p.id = i.product_id
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN categories pc ON pc.id = c.parent_id
         WHERE date(s.created_at) BETWEEN ?1 AND ?2
         GROUP BY c.id ORDER BY SUM(i.line_total) DESC",
        [&from, &to],
        |r| {
            Ok(CategoryRow {
                category_id: r.get(0)?,
                name: r.get(1)?,
                parent_id: r.get(2)?,
                parent_name: r.get(3)?,
                grams: r.get(4)?,
                revenue: r.get(5)?,
                profit: r.get(6)?,
            })
        },
    )
}

#[derive(Serialize)]
pub struct MovementRow {
    id: i64,
    created_at: String,
    product_name: String,
    change_grams: i64,
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
        "SELECT m.id, m.created_at, p.name, m.change_grams, m.reason, m.cost_total, m.note, m.sale_id,
                m.purchase_id, s.name, u.name
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
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
                change_grams: r.get(3)?,
                reason: r.get(4)?,
                cost_total: r.get(5)?,
                note: r.get(6)?,
                sale_id: r.get(7)?,
                purchase_id: r.get(8)?,
                supplier_name: r.get(9)?,
                user_name: r.get(10)?,
            })
        },
    )
}
