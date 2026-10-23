use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Deserialize)]
pub struct CartItem {
    variant_id: i64,
    quantity: i64,
}

#[derive(Serialize)]
pub struct SaleItem {
    product_name: String,
    variant_label: Option<String>,
    quantity: i64,
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

struct Line {
    product_id: i64,
    variant_id: i64,
    name: String,
    label: Option<String>,
    quantity: i64,
    unit_price: i64,
    unit_cost: i64,
}

#[tauri::command]
pub fn create_sale(
    state: State<AppState>,
    items: Vec<CartItem>,
    payment_method: String,
    paid: i64,
) -> AppResult<Sale> {
    let user = state.user()?;
    let mut db = state.db.lock().unwrap();
    let sale_id = insert_sale(&mut db, user.id, &items, &payment_method, paid)?;
    load_sale(&db, sale_id)
}

pub fn insert_sale(
    db: &mut Connection,
    user_id: i64,
    items: &[CartItem],
    payment_method: &str,
    paid: i64,
) -> AppResult<i64> {
    if items.is_empty() {
        return invalid("السلة فارغة");
    }
    if !["cash", "card", "wallet"].contains(&payment_method) {
        return invalid("طريقة دفع غير صحيحة");
    }

    let tx = db.transaction()?;
    let allow_negative = tx
        .query_row(
            "SELECT value FROM settings WHERE key = 'allow_negative_stock'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .is_some_and(|v| v == "1");

    // Prices always come from the database, never from the client.
    // The same variant may sit on several cart lines, so stock is checked against their sum.
    let mut lines = Vec::with_capacity(items.len());
    let mut needed: HashMap<i64, (i64, i64, String)> = HashMap::new();
    for item in items {
        if item.quantity <= 0 {
            return invalid("الكمية يجب أن تكون أكبر من صفر");
        }
        let (product_id, name, label, price, cost, stock): (i64, String, String, i64, i64, i64) =
            tx.query_row(
                "SELECT p.id, p.name, v.label, v.price, v.cost, v.stock
                 FROM product_variants v JOIN products p ON p.id = v.product_id
                 WHERE v.id = ?1 AND v.active = 1 AND p.active = 1",
                [item.variant_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                },
            )
            .optional()?
            .ok_or(AppError::NotFound("المنتج"))?;
        let display = if label.is_empty() {
            name.clone()
        } else {
            format!("{name} — {label}")
        };
        needed
            .entry(item.variant_id)
            .or_insert((0, stock, display))
            .0 += item.quantity;
        lines.push(Line {
            product_id,
            variant_id: item.variant_id,
            name,
            label: (!label.is_empty()).then_some(label),
            quantity: item.quantity,
            unit_price: price,
            unit_cost: cost,
        });
    }

    if !allow_negative {
        for (wanted, stock, name) in needed.values() {
            if stock < wanted {
                return invalid(format!(
                    "المخزون غير كافٍ من «{name}»: المتوفر {stock} والمطلوب {wanted}"
                ));
            }
        }
    }

    let total: i64 = lines.iter().map(|l| l.unit_price * l.quantity).sum();
    let cost_total: i64 = lines.iter().map(|l| l.unit_cost * l.quantity).sum();
    let paid = if payment_method == "cash" {
        paid
    } else {
        total
    };
    if paid < total {
        return invalid("المبلغ المدفوع أقل من الإجمالي");
    }
    let ts = now();
    tx.execute(
        "INSERT INTO sales (user_id, created_at, total, cost_total, payment_method, paid, change_due)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![user_id, ts, total, cost_total, payment_method, paid, paid - total],
    )?;
    let sale_id = tx.last_insert_rowid();
    for l in &lines {
        tx.execute(
            "INSERT INTO sale_items (sale_id, product_id, variant_id, product_name, variant_label, quantity, unit_price, line_total, line_cost)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                sale_id,
                l.product_id,
                l.variant_id,
                l.name,
                l.label,
                l.quantity,
                l.unit_price,
                l.unit_price * l.quantity,
                l.unit_cost * l.quantity
            ],
        )?;
        tx.execute(
            "UPDATE product_variants SET stock = stock - ?1 WHERE id = ?2",
            params![l.quantity, l.variant_id],
        )?;
        tx.execute(
            "INSERT INTO stock_movements (product_id, variant_id, change_qty, reason, sale_id, user_id, created_at)
             VALUES (?1, ?2, ?3, 'sale', ?4, ?5, ?6)",
            params![l.product_id, l.variant_id, -l.quantity, sale_id, user_id, ts],
        )?;
    }
    tx.commit()?;
    Ok(sale_id)
}

fn load_sale(db: &Connection, id: i64) -> AppResult<Sale> {
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
        "SELECT product_name, variant_label, quantity, unit_price, line_total
         FROM sale_items WHERE sale_id = ?1 ORDER BY id",
    )?;
    sale.items = stmt
        .query_map([id], |r| {
            Ok(SaleItem {
                product_name: r.get(0)?,
                variant_label: r.get(1)?,
                quantity: r.get(2)?,
                unit_price: r.get(3)?,
                line_total: r.get(4)?,
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
        let owner: Option<i64> = db
            .query_row("SELECT user_id FROM sales WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .optional()?;
        if owner != Some(user.id) {
            return Err(AppError::Forbidden);
        }
    }
    load_sale(&db, id)
}

/// Dates are inclusive `YYYY-MM-DD`. Cashiers always get only their own sales for today.
#[tauri::command]
pub fn list_sales(
    state: State<AppState>,
    from: String,
    to: String,
    user_id: Option<i64>,
) -> AppResult<Vec<SaleSummary>> {
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
                (SELECT COALESCE(SUM(quantity), 0) FROM sale_items i WHERE i.sale_id = s.id)
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
    use super::*;

    fn setup() -> (Connection, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "mobile-pos-sale-{}-{:?}.db",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_file(&path);
        let db = crate::db::open(&path).unwrap();
        db.execute_batch(
            "INSERT INTO users (id, name, username, password_hash, role, created_at) VALUES (1, 'a', 'a', 'x', 'admin', '2026-01-01 00:00:00');
             INSERT INTO categories (id, name, created_at) VALUES (1, 'c', '2026-01-01 00:00:00');
             INSERT INTO products (id, name, category_id, created_at, updated_at) VALUES (1, 'iPhone 15', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
             INSERT INTO product_variants (id, product_id, label, price, cost, stock) VALUES (1, 1, '128GB', 3000000, 2700000, 2);",
        )
        .unwrap();
        (db, path)
    }

    fn stock(db: &Connection) -> i64 {
        db.query_row("SELECT stock FROM product_variants WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap()
    }

    #[test]
    fn sale_deducts_pieces_and_snapshots_prices() {
        let (mut db, path) = setup();
        let items = [CartItem {
            variant_id: 1,
            quantity: 2,
        }];
        let id = insert_sale(&mut db, 1, &items, "cash", 6000000).unwrap();
        assert_eq!(stock(&db), 0);
        let sale = load_sale(&db, id).unwrap();
        assert_eq!(sale.total, 6000000);
        assert_eq!(sale.change_due, 0);
        assert_eq!(sale.items[0].variant_label.as_deref(), Some("128GB"));
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn checks_stock_against_all_lines_of_the_same_variant() {
        let (mut db, path) = setup();
        let line = |quantity| CartItem {
            variant_id: 1,
            quantity,
        };
        assert!(insert_sale(&mut db, 1, &[line(2), line(1)], "card", 0).is_err());
        assert_eq!(stock(&db), 2);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
