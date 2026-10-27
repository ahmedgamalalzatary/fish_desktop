//! What the shared tests need from the shop, without knowing what it sells: stock to sell and lines to
//! buy. Every shop provides the same helpers.

use super::purchases::{Lines, PurchaseItemInput};
use super::sales::{Cart, CartItem};
use rusqlite::{Connection, params};

/// Units one test item counts as in reports: a kilo, in grams.
pub const ITEM_UNITS: i64 = 1000;

fn category(db: &Connection) -> i64 {
    db.execute(
        "INSERT OR IGNORE INTO categories (id, name, created_at) VALUES (9999, 'Test', '2026-01-01 00:00:00')",
        [],
    )
    .unwrap();
    9999
}

/// Puts one item per `(price, cost)` in stock, each a one-kilo box of its own product, and returns a
/// cart selling all of them.
pub fn cart_worth(db: &Connection, items: &[(i64, i64)]) -> Cart {
    let category = category(db);
    items
        .iter()
        .map(|(price, cost)| {
            db.execute(
                "INSERT INTO products (name, category_id, sell_by_weight, stock_grams, created_at, updated_at)
                 VALUES ('Test box', ?1, 0, ?2, '2026-01-01 00:00:00', '2026-01-01 00:00:00')",
                params![category, ITEM_UNITS],
            )
            .unwrap();
            let product_id = db.last_insert_rowid();
            db.execute(
                "INSERT INTO product_variants (product_id, label, weight_grams, price, cost) VALUES (?1, 'كيلو', ?2, ?3, ?4)",
                params![product_id, ITEM_UNITS, price, cost],
            )
            .unwrap();
            CartItem {
                product_id,
                variant_id: Some(db.last_insert_rowid()),
                quantity: 1,
                weight_grams: None,
            }
        })
        .collect()
}

/// Invoice lines, one kilo of a test product per cost.
pub fn lines_costing(db: &Connection, costs: &[i64]) -> Lines {
    let category = category(db);
    db.execute(
        "INSERT INTO products (name, category_id, created_at, updated_at) VALUES ('Test fish', ?1, '2026-01-01 00:00:00', '2026-01-01 00:00:00')",
        [category],
    )
    .unwrap();
    let product_id = db.last_insert_rowid();
    Lines {
        update_cost: false,
        lines: costs
            .iter()
            .map(|cost| PurchaseItemInput {
                product_id,
                grams: ITEM_UNITS,
                cost_total: *cost,
            })
            .collect(),
    }
}

/// Everything in stock, in grams.
pub fn stock_units(db: &Connection) -> i64 {
    db.query_row(
        "SELECT COALESCE(SUM(stock_grams), 0) FROM products",
        [],
        |r| r.get(0),
    )
    .unwrap()
}
