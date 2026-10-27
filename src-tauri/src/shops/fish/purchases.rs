//! The fish side of a supplier invoice: grams of each product and what they cost.

use crate::error::{AppError, AppResult, invalid};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct PurchaseItemInput {
    pub product_id: i64,
    pub grams: i64,
    /// What was paid for this line, in cents.
    pub cost_total: i64,
}

#[derive(Deserialize)]
pub struct Lines {
    /// Set each product's cost per gram from this invoice.
    pub update_cost: bool,
    pub lines: Vec<PurchaseItemInput>,
}

/// Lines on an invoice, for the purchases list.
pub const ITEMS_COUNT_SQL: &str =
    "(SELECT COUNT(*) FROM stock_movements m WHERE m.purchase_id = p.id)";

/// Whether the invoice has none of the shop's lines (it may still have extras).
pub fn is_empty(lines: &Lines) -> bool {
    lines.lines.is_empty()
}

/// The invoice total: what was paid for its lines.
pub fn total(lines: &Lines) -> AppResult<i64> {
    if lines.lines.iter().any(|i| i.grams <= 0 || i.cost_total < 0) {
        return invalid("أدخل وزناً وتكلفة صحيحين لكل صنف");
    }
    Ok(lines.lines.iter().map(|i| i.cost_total).sum())
}

/// Adds every line to stock, and sets the product's cost per gram (thousandths of a cent) when asked.
pub fn record(
    tx: &Connection,
    purchase_id: i64,
    user_id: i64,
    ts: &str,
    lines: &Lines,
) -> AppResult<()> {
    for item in &lines.lines {
        tx.execute(
            "INSERT INTO stock_movements (product_id, change_grams, reason, cost_total, purchase_id, user_id, created_at)
             VALUES (?1, ?2, 'purchase', ?3, ?4, ?5, ?6)",
            params![item.product_id, item.grams, item.cost_total, purchase_id, user_id, ts],
        )?;
        let changed = tx.execute(
            "UPDATE products SET stock_grams = stock_grams + ?1 WHERE id = ?2",
            params![item.grams, item.product_id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("المنتج"));
        }
        if lines.update_cost && item.cost_total > 0 {
            let per_gram = (item.cost_total as f64 * 1000.0 / item.grams as f64).round() as i64;
            tx.execute(
                "UPDATE products SET cost_per_gram = ?1 WHERE id = ?2",
                params![per_gram, item.product_id],
            )?;
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct PurchaseItem {
    product_name: String,
    grams: i64,
    cost_total: i64,
}

pub fn load_items(db: &Connection, purchase_id: i64) -> AppResult<Vec<PurchaseItem>> {
    let mut stmt = db.prepare(
        "SELECT pr.name, m.change_grams, COALESCE(m.cost_total, 0)
         FROM stock_movements m JOIN products pr ON pr.id = m.product_id
         WHERE m.purchase_id = ?1 ORDER BY m.id",
    )?;
    let rows = stmt.query_map([purchase_id], |r| {
        Ok(PurchaseItem {
            product_name: r.get(0)?,
            grams: r.get(1)?,
            cost_total: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Takes the invoice's weight back out of stock. Product cost prices changed by the invoice are left
/// as they are.
pub fn remove(tx: &Connection, purchase_id: i64) -> AppResult<()> {
    tx.execute(
        "UPDATE products SET stock_grams = stock_grams - (
             SELECT SUM(m.change_grams) FROM stock_movements m WHERE m.purchase_id = ?1 AND m.product_id = products.id)
         WHERE id IN (SELECT product_id FROM stock_movements WHERE purchase_id = ?1)",
        [purchase_id],
    )?;
    tx.execute(
        "DELETE FROM stock_movements WHERE purchase_id = ?1",
        [purchase_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::purchases::{PurchaseInput, insert_purchase};
    use crate::test_support::{int, temp_db};

    #[test]
    fn an_invoice_can_set_the_cost_per_gram() {
        let (mut db, path) = temp_db("fish-purchase-cost");
        db.execute_batch(
            "INSERT INTO categories (id, name, created_at) VALUES (1, 'c', '2026-01-01 00:00:00');
             INSERT INTO products (id, name, category_id, cost_per_gram, stock_grams, created_at, updated_at)
                 VALUES (1, 'بلطي', 1, 5000, 1000, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
             INSERT INTO suppliers (id, name, created_at) VALUES (1, 'مورد', '2026-01-01 00:00:00');",
        )
        .unwrap();
        let invoice = |update_cost| PurchaseInput {
            supplier_id: 1,
            invoice_no: String::new(),
            note: String::new(),
            paid: 0,
            items: Lines {
                update_cost,
                lines: vec![PurchaseItemInput {
                    product_id: 1,
                    grams: 4000,
                    cost_total: 24000,
                }],
            },
            extras: vec![],
        };
        insert_purchase(&mut db, 1, &invoice(false)).unwrap();
        assert_eq!(
            int(&db, "SELECT cost_per_gram FROM products WHERE id = 1"),
            5000
        );
        insert_purchase(&mut db, 1, &invoice(true)).unwrap();
        // 240.00 for 4,000 g is 0.06 a gram.
        assert_eq!(
            int(&db, "SELECT cost_per_gram FROM products WHERE id = 1"),
            6000
        );
        assert_eq!(
            int(&db, "SELECT stock_grams FROM products WHERE id = 1"),
            9000
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
