//! What the shared tests need from the shop, without knowing what it sells: stock to sell and lines to
//! buy. Every shop provides the same helpers.

use super::phones::PhoneInput;
use super::purchases::{Lines, PurchaseItemInput};
use super::sales::Cart;
use rusqlite::{Connection, params};
use std::sync::atomic::{AtomicU64, Ordering};

/// Units one test item counts as in reports: one phone.
pub const ITEM_UNITS: i64 = 1;

static SERIAL: AtomicU64 = AtomicU64::new(1);

fn serial() -> String {
    format!("T{}", SERIAL.fetch_add(1, Ordering::Relaxed))
}

fn model(db: &Connection) -> i64 {
    db.execute(
        "INSERT OR IGNORE INTO products (name, created_at, updated_at) VALUES ('Test model', '2026-01-01 00:00:00', '2026-01-01 00:00:00')",
        [],
    )
    .unwrap();
    db.query_row(
        "SELECT id FROM products WHERE name = 'Test model'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

/// Puts one item per `(price, cost)` in stock and returns a cart selling all of them.
pub fn cart_worth(db: &Connection, items: &[(i64, i64)]) -> Cart {
    let product = model(db);
    items
        .iter()
        .map(|(price, cost)| {
            db.execute(
                "INSERT INTO phones (product_id, serial, price, cost, created_at) VALUES (?1, ?2, ?3, ?4, '2026-01-01 00:00:00')",
                params![product, serial(), price, cost],
            )
            .unwrap();
            db.last_insert_rowid()
        })
        .collect()
}

/// Invoice lines, one item per cost.
pub fn lines_costing(db: &Connection, costs: &[i64]) -> Lines {
    let product = model(db);
    costs
        .iter()
        .map(|cost| PurchaseItemInput {
            product_id: product,
            phone: PhoneInput {
                serial: serial(),
                storage: String::new(),
                color: String::new(),
                battery: None,
                price: cost + 1,
                cost: *cost,
            },
        })
        .collect()
}

/// Everything in stock, in units.
pub fn stock_units(db: &Connection) -> i64 {
    db.query_row(
        "SELECT COUNT(*) FROM phones WHERE status = 'in_stock'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}
