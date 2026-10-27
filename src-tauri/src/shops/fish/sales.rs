//! The fish side of a sale: weighed or fixed-weight lines, and taking their grams out of stock.

use crate::error::{AppError, AppResult, invalid};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Deserialize)]
pub struct CartItem {
    pub product_id: i64,
    /// Set for a fixed-weight option; None means sold by entered weight.
    pub variant_id: Option<i64>,
    /// Number of units of the variant. Ignored for weight sales.
    pub quantity: i64,
    /// Entered weight. Only used for weight sales.
    pub weight_grams: Option<i64>,
}

pub type Cart = Vec<CartItem>;

/// A line as sold, copied at the time of sale.
#[derive(Serialize)]
pub struct SaleItem {
    product_name: String,
    variant_label: Option<String>,
    quantity: i64,
    weight_grams: i64,
    unit_price: i64,
    line_total: i64,
}

struct Line {
    product_id: i64,
    variant_id: Option<i64>,
    name: String,
    label: Option<String>,
    quantity: i64,
    grams: i64,
    unit_price: i64,
    line_total: i64,
    line_cost: i64,
}

/// The cart checked and priced from the database.
pub struct Priced {
    pub total: i64,
    pub cost: i64,
    lines: Vec<Line>,
    /// Grams taken out of each product's stock.
    needed: HashMap<i64, i64>,
}

/// Price for a weight, rounded to the nearest cent. `per_gram` is in thousandths of a cent.
fn price_for_grams(per_gram: i64, grams: i64) -> i64 {
    (per_gram * grams + 500) / 1000
}

/// Prices always come from the database, never from the client. Refuses to sell more than is in stock
/// unless the shop allows it (`allow_negative_stock`).
pub fn price(tx: &Connection, items: &Cart) -> AppResult<Priced> {
    let allow_negative = tx
        .query_row(
            "SELECT value FROM settings WHERE key = 'allow_negative_stock'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .is_some_and(|v| v == "1");

    let mut lines = Vec::with_capacity(items.len());
    let mut needed: HashMap<i64, i64> = HashMap::new();
    for item in items {
        let (name, sell_by_weight, price_per_gram, cost_per_gram): (String, bool, i64, i64) = tx
            .query_row(
                "SELECT name, sell_by_weight, price_per_gram, cost_per_gram FROM products WHERE id = ?1 AND active = 1",
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
                Line {
                    product_id: item.product_id,
                    variant_id: Some(variant_id),
                    name,
                    label: Some(label),
                    quantity: item.quantity,
                    grams: weight * item.quantity,
                    unit_price: price,
                    line_total: price * item.quantity,
                    line_cost: cost * item.quantity,
                }
            }
            None => {
                if !sell_by_weight {
                    return invalid(format!("المنتج «{name}» لا يُباع بالوزن"));
                }
                let grams = item
                    .weight_grams
                    .filter(|g| *g > 0)
                    .ok_or_else(|| AppError::Invalid("أدخل وزناً صحيحاً".into()))?;
                Line {
                    product_id: item.product_id,
                    variant_id: None,
                    name,
                    label: None,
                    quantity: 1,
                    grams,
                    unit_price: price_per_gram,
                    line_total: price_for_grams(price_per_gram, grams),
                    line_cost: price_for_grams(cost_per_gram, grams),
                }
            }
        };
        *needed.entry(item.product_id).or_default() += line.grams;
        lines.push(line);
    }

    if !allow_negative {
        for (product_id, grams) in &needed {
            let (name, stock): (String, i64) = tx.query_row(
                "SELECT name, stock_grams FROM products WHERE id = ?1",
                [product_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            if stock < *grams {
                return invalid(format!(
                    "المخزون غير كافٍ من «{name}»: المتوفر {stock} جم والمطلوب {grams} جم"
                ));
            }
        }
    }

    Ok(Priced {
        total: lines.iter().map(|l| l.line_total).sum(),
        cost: lines.iter().map(|l| l.line_cost).sum(),
        lines,
        needed,
    })
}

/// Writes the sale's lines and takes their weight out of stock, one movement per product.
pub fn record(
    tx: &Connection,
    sale_id: i64,
    user_id: i64,
    ts: &str,
    priced: &Priced,
) -> AppResult<()> {
    for l in &priced.lines {
        tx.execute(
            "INSERT INTO sale_items (sale_id, product_id, variant_id, product_name, variant_label, quantity, weight_grams, unit_price, line_total, line_cost)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![sale_id, l.product_id, l.variant_id, l.name, l.label, l.quantity, l.grams, l.unit_price, l.line_total, l.line_cost],
        )?;
    }
    for (product_id, grams) in &priced.needed {
        tx.execute(
            "UPDATE products SET stock_grams = stock_grams - ?1 WHERE id = ?2",
            params![grams, product_id],
        )?;
        tx.execute(
            "INSERT INTO stock_movements (product_id, change_grams, reason, sale_id, user_id, created_at)
             VALUES (?1, ?2, 'sale', ?3, ?4, ?5)",
            params![product_id, -grams, sale_id, user_id, ts],
        )?;
    }
    Ok(())
}

pub fn load_items(db: &Connection, sale_id: i64) -> AppResult<Vec<SaleItem>> {
    let mut stmt = db.prepare(
        "SELECT product_name, variant_label, quantity, weight_grams, unit_price, line_total
         FROM sale_items WHERE sale_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map([sale_id], |r| {
        Ok(SaleItem {
            product_name: r.get(0)?,
            variant_label: r.get(1)?,
            quantity: r.get(2)?,
            weight_grams: r.get(3)?,
            unit_price: r.get(4)?,
            line_total: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::price_for_grams;
    use crate::commands::sales::{PaymentInput, insert_sale};
    use crate::test_support::{int, temp_db};

    #[test]
    fn rounds_weight_price_to_nearest_cent() {
        assert_eq!(price_for_grams(18000, 1000), 18000);
        assert_eq!(price_for_grams(18000, 750), 13500);
        assert_eq!(price_for_grams(999, 333), 333); // 332.667 -> 333
        assert_eq!(price_for_grams(1000, 1), 1);
    }

    fn cash(amount: i64) -> Vec<PaymentInput> {
        serde_json::from_value(serde_json::json!([{ "method": "cash", "amount": amount }])).unwrap()
    }

    fn cart(v: serde_json::Value) -> super::Cart {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn a_weighed_sale_takes_its_grams_and_more_than_stock_needs_the_setting() {
        let (mut db, path) = temp_db("fish-sale");
        db.execute_batch(
            "INSERT INTO categories (id, name, created_at) VALUES (1, 'c', '2026-01-01 00:00:00');
             INSERT INTO products (id, name, category_id, price_per_gram, cost_per_gram, stock_grams, created_at, updated_at)
                 VALUES (1, 'بلطي', 1, 9000, 6000, 2000, '2026-01-01 00:00:00', '2026-01-01 00:00:00');",
        )
        .unwrap();
        // 1,500 g at 0.09 a gram = 135.00.
        let weighed = cart(
            serde_json::json!([{ "product_id": 1, "variant_id": null, "quantity": 1, "weight_grams": 1500 }]),
        );
        insert_sale(&mut db, 1, &weighed, &[], &cash(13_500)).unwrap();
        assert_eq!(
            int(&db, "SELECT stock_grams FROM products WHERE id = 1"),
            500
        );
        assert_eq!(int(&db, "SELECT SUM(line_cost) FROM sale_items"), 9_000);

        // Another 1,500 g with 500 g left: refused, then allowed by the setting.
        assert!(insert_sale(&mut db, 1, &weighed, &[], &cash(13_500)).is_err());
        db.execute(
            "UPDATE settings SET value = '1' WHERE key = 'allow_negative_stock'",
            [],
        )
        .unwrap();
        insert_sale(&mut db, 1, &weighed, &[], &cash(13_500)).unwrap();
        assert_eq!(
            int(&db, "SELECT stock_grams FROM products WHERE id = 1"),
            -1_000
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
