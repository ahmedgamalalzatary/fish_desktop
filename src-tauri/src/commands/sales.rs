use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Deserialize)]
pub struct CartItem {
    product_id: i64,
    /// Set for a fixed-weight option; None means sold by entered weight.
    variant_id: Option<i64>,
    /// Number of units of the variant. Ignored for weight sales.
    quantity: i64,
    /// Entered weight. Only used for weight sales.
    weight_grams: Option<i64>,
}

#[derive(Serialize)]
pub struct SaleItem {
    product_name: String,
    variant_label: Option<String>,
    quantity: i64,
    weight_grams: i64,
    unit_price: i64,
    line_total: i64,
}

#[derive(Serialize)]
pub struct Sale {
    id: i64,
    created_at: String,
    cashier_name: String,
    total: i64,
    payment_method: String,
    paid: i64,
    change_due: i64,
    items: Vec<SaleItem>,
}

#[derive(Serialize)]
pub struct SaleSummary {
    id: i64,
    created_at: String,
    cashier_name: String,
    total: i64,
    payment_method: String,
    items_count: i64,
}

/// Price for a weight, rounded to the nearest cent.
fn price_for_grams(per_kg: i64, grams: i64) -> i64 {
    (per_kg * grams + 500) / 1000
}

#[tauri::command]
pub fn create_sale(
    state: State<AppState>,
    items: Vec<CartItem>,
    payment_method: String,
    paid: i64,
) -> AppResult<Sale> {
    let user = state.user()?;
    if items.is_empty() {
        return invalid("السلة فارغة");
    }
    if !["cash", "card", "wallet"].contains(&payment_method.as_str()) {
        return invalid("طريقة دفع غير صحيحة");
    }

    let mut db = state.db.lock().unwrap();
    let tx = db.transaction()?;
    let allow_negative = tx
        .query_row("SELECT value FROM settings WHERE key = 'allow_negative_stock'", [], |r| r.get::<_, String>(0))
        .optional()?
        .is_some_and(|v| v == "1");

    // Prices always come from the database, never from the client.
    let mut lines = Vec::with_capacity(items.len());
    let mut needed: HashMap<i64, i64> = HashMap::new();
    for item in &items {
        let (name, sell_by_weight, price_per_kg, cost_per_kg): (String, bool, i64, i64) = tx
            .query_row(
                "SELECT name, sell_by_weight, price_per_kg, cost_per_kg FROM products WHERE id = ?1 AND active = 1",
                [item.product_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?
            .ok_or(AppError::NotFound("المنتج"))?;

        let line = match item.variant_id {
            Some(variant_id) => {
                if item.quantity <= 0 {
                    return invalid("الكمية يجب أن تكون أكبر من صفر");
                }
                let (label, weight, price, cost): (String, i64, i64, i64) = tx
                    .query_row(
                        "SELECT label, weight_grams, price, cost FROM product_variants
                         WHERE id = ?1 AND product_id = ?2 AND active = 1",
                        [variant_id, item.product_id],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                    )
                    .optional()?
                    .ok_or(AppError::NotFound("الوزن المحدد"))?;
                (item.product_id, Some(variant_id), name, Some(label), item.quantity, weight * item.quantity, price, price * item.quantity, cost * item.quantity)
            }
            None => {
                if !sell_by_weight {
                    return invalid(format!("المنتج «{name}» لا يُباع بالكيلو"));
                }
                let grams = item.weight_grams.filter(|g| *g > 0).ok_or_else(|| AppError::Invalid("أدخل وزناً صحيحاً".into()))?;
                (item.product_id, None, name, None, 1, grams, price_per_kg, price_for_grams(price_per_kg, grams), price_for_grams(cost_per_kg, grams))
            }
        };
        *needed.entry(item.product_id).or_default() += line.5;
        lines.push(line);
    }

    if !allow_negative {
        for (product_id, grams) in &needed {
            let (name, stock): (String, i64) =
                tx.query_row("SELECT name, stock_grams FROM products WHERE id = ?1", [product_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
            if stock < *grams {
                return invalid(format!(
                    "المخزون غير كافٍ من «{name}»: المتوفر {:.3} كجم والمطلوب {:.3} كجم",
                    stock as f64 / 1000.0,
                    *grams as f64 / 1000.0
                ));
            }
        }
    }

    let total: i64 = lines.iter().map(|l| l.7).sum();
    let cost_total: i64 = lines.iter().map(|l| l.8).sum();
    let paid = if payment_method == "cash" { paid } else { total };
    if paid < total {
        return invalid("المبلغ المدفوع أقل من الإجمالي");
    }
    let ts = now();
    tx.execute(
        "INSERT INTO sales (user_id, created_at, total, cost_total, payment_method, paid, change_due)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![user.id, ts, total, cost_total, payment_method, paid, paid - total],
    )?;
    let sale_id = tx.last_insert_rowid();
    for (product_id, variant_id, name, label, qty, grams, unit_price, line_total, line_cost) in &lines {
        tx.execute(
            "INSERT INTO sale_items (sale_id, product_id, variant_id, product_name, variant_label, quantity, weight_grams, unit_price, line_total, line_cost)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![sale_id, product_id, variant_id, name, label, qty, grams, unit_price, line_total, line_cost],
        )?;
    }
    for (product_id, grams) in &needed {
        tx.execute("UPDATE products SET stock_grams = stock_grams - ?1 WHERE id = ?2", params![grams, product_id])?;
        tx.execute(
            "INSERT INTO stock_movements (product_id, change_grams, reason, sale_id, user_id, created_at)
             VALUES (?1, ?2, 'sale', ?3, ?4, ?5)",
            params![product_id, -grams, sale_id, user.id, ts],
        )?;
    }
    tx.commit()?;
    load_sale(&db, sale_id)
}

fn load_sale(db: &rusqlite::Connection, id: i64) -> AppResult<Sale> {
    let mut sale = db
        .query_row(
            "SELECT s.id, s.created_at, u.name, s.total, s.payment_method, s.paid, s.change_due
             FROM sales s JOIN users u ON u.id = s.user_id WHERE s.id = ?1",
            [id],
            |r| {
                Ok(Sale {
                    id: r.get(0)?,
                    created_at: r.get(1)?,
                    cashier_name: r.get(2)?,
                    total: r.get(3)?,
                    payment_method: r.get(4)?,
                    paid: r.get(5)?,
                    change_due: r.get(6)?,
                    items: vec![],
                })
            },
        )
        .optional()?
        .ok_or(AppError::NotFound("الفاتورة"))?;
    let mut stmt = db.prepare(
        "SELECT product_name, variant_label, quantity, weight_grams, unit_price, line_total
         FROM sale_items WHERE sale_id = ?1 ORDER BY id",
    )?;
    sale.items = stmt
        .query_map([id], |r| {
            Ok(SaleItem {
                product_name: r.get(0)?,
                variant_label: r.get(1)?,
                quantity: r.get(2)?,
                weight_grams: r.get(3)?,
                unit_price: r.get(4)?,
                line_total: r.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(sale)
}

/// Cashiers may only open their own receipts.
#[tauri::command]
pub fn get_sale(state: State<AppState>, id: i64) -> AppResult<Sale> {
    let user = state.user()?;
    let db = state.db.lock().unwrap();
    if !user.is_admin() {
        let owner: Option<i64> = db.query_row("SELECT user_id FROM sales WHERE id = ?1", [id], |r| r.get(0)).optional()?;
        if owner != Some(user.id) {
            return Err(AppError::Forbidden);
        }
    }
    load_sale(&db, id)
}

/// Dates are inclusive `YYYY-MM-DD`. Cashiers always get only their own sales for today.
#[tauri::command]
pub fn list_sales(state: State<AppState>, from: String, to: String, user_id: Option<i64>) -> AppResult<Vec<SaleSummary>> {
    let user = state.user()?;
    let (from, to, user_id) = if user.is_admin() {
        (from, to, user_id)
    } else {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        (today.clone(), today, Some(user.id))
    };
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT s.id, s.created_at, u.name, s.total, s.payment_method,
                (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id)
         FROM sales s JOIN users u ON u.id = s.user_id
         WHERE date(s.created_at) BETWEEN ?1 AND ?2 AND (?3 IS NULL OR s.user_id = ?3)
         ORDER BY s.id DESC LIMIT 1000",
    )?;
    let rows = stmt.query_map(params![from, to, user_id], |r| {
        Ok(SaleSummary {
            id: r.get(0)?,
            created_at: r.get(1)?,
            cashier_name: r.get(2)?,
            total: r.get(3)?,
            payment_method: r.get(4)?,
            items_count: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::price_for_grams;

    #[test]
    fn rounds_weight_price_to_nearest_cent() {
        assert_eq!(price_for_grams(18000, 1000), 18000);
        assert_eq!(price_for_grams(18000, 750), 13500);
        assert_eq!(price_for_grams(999, 333), 333); // 332.667 -> 333
        assert_eq!(price_for_grams(1000, 1), 1);
    }
}
