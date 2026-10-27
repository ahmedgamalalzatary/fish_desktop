//! The phone side of a sale: which phones, at what price, and taking them out of stock.

use crate::error::{AppError, AppResult, invalid};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

/// The phones being sold, by id.
pub type Cart = Vec<i64>;

/// A phone as sold, copied at the time of sale.
#[derive(Serialize)]
pub struct SaleItem {
    product_name: String,
    serial: String,
    storage: String,
    color: String,
    battery: Option<i64>,
    price: i64,
}

struct Line {
    phone_id: i64,
    product_id: i64,
    name: String,
    serial: String,
    storage: String,
    color: String,
    battery: Option<i64>,
    price: i64,
    cost: i64,
}

/// The cart checked and priced from the database.
pub struct Priced {
    pub total: i64,
    pub cost: i64,
    lines: Vec<Line>,
}

/// Prices always come from the database, never from the client.
pub fn price(tx: &Connection, phone_ids: &Cart) -> AppResult<Priced> {
    let mut lines = Vec::with_capacity(phone_ids.len());
    for (i, id) in phone_ids.iter().enumerate() {
        if phone_ids[..i].contains(id) {
            return invalid("الجهاز نفسه مكرر في الفاتورة");
        }
        let (line, status): (Line, String) = tx
            .query_row(
                "SELECT ph.product_id, p.name, ph.serial, ph.storage, ph.color, ph.battery, ph.price, ph.cost, ph.status
                 FROM phones ph JOIN products p ON p.id = ph.product_id WHERE ph.id = ?1",
                [id],
                |r| {
                    Ok((
                        Line {
                            phone_id: *id,
                            product_id: r.get(0)?,
                            name: r.get(1)?,
                            serial: r.get(2)?,
                            storage: r.get(3)?,
                            color: r.get(4)?,
                            battery: r.get(5)?,
                            price: r.get(6)?,
                            cost: r.get(7)?,
                        },
                        r.get(8)?,
                    ))
                },
            )
            .optional()?
            .ok_or(AppError::NotFound("الجهاز"))?;
        if status != "in_stock" {
            return invalid(format!(
                "الجهاز {} ({}) لم يعد في المخزون",
                line.serial, line.name
            ));
        }
        lines.push(line);
    }
    Ok(Priced {
        total: lines.iter().map(|l| l.price).sum(),
        cost: lines.iter().map(|l| l.cost).sum(),
        lines,
    })
}

/// Writes the sale's lines and takes its phones out of stock.
pub fn record(
    tx: &Connection,
    sale_id: i64,
    user_id: i64,
    ts: &str,
    priced: &Priced,
) -> AppResult<()> {
    for l in &priced.lines {
        tx.execute(
            "INSERT INTO sale_items (sale_id, phone_id, product_id, product_name, serial, storage, color, battery, price, cost)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![sale_id, l.phone_id, l.product_id, l.name, l.serial, l.storage, l.color, l.battery, l.price, l.cost],
        )?;
        tx.execute(
            "UPDATE phones SET status = 'sold' WHERE id = ?1",
            [l.phone_id],
        )?;
        tx.execute(
            "INSERT INTO stock_movements (phone_id, product_id, change_qty, reason, sale_id, user_id, created_at)
             VALUES (?1, ?2, -1, 'sale', ?3, ?4, ?5)",
            params![l.phone_id, l.product_id, sale_id, user_id, ts],
        )?;
    }
    Ok(())
}

pub fn load_items(db: &Connection, sale_id: i64) -> AppResult<Vec<SaleItem>> {
    let mut stmt = db.prepare(
        "SELECT product_name, serial, storage, color, battery, price
         FROM sale_items WHERE sale_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map([sale_id], |r| {
        Ok(SaleItem {
            product_name: r.get(0)?,
            serial: r.get(1)?,
            storage: r.get(2)?,
            color: r.get(3)?,
            battery: r.get(4)?,
            price: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use crate::commands::sales::{PaymentInput, insert_sale};
    use rusqlite::Connection;

    fn setup(name: &str) -> (Connection, std::path::PathBuf) {
        let (db, path) = crate::test_support::temp_db(name);
        db.execute_batch(
            "INSERT INTO products (id, name, created_at, updated_at) VALUES (1, 'iPhone 15', '2026-01-01 00:00:00', '2026-01-01 00:00:00');
             INSERT INTO phones (id, product_id, serial, storage, color, battery, price, cost, created_at) VALUES
                 (1, 1, 'SN-1', '128GB', 'أسود', 91, 3000000, 2700000, '2026-01-01 00:00:00'),
                 (2, 1, 'SN-2', '256GB', 'أزرق', NULL, 3500000, 3100000, '2026-01-01 00:00:00');",
        )
        .unwrap();
        (db, path)
    }

    fn cash(amount: i64) -> Vec<PaymentInput> {
        serde_json::from_value(serde_json::json!([{ "method": "cash", "amount": amount }])).unwrap()
    }

    fn status(db: &Connection, id: i64) -> String {
        db.query_row("SELECT status FROM phones WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .unwrap()
    }

    #[test]
    fn sale_takes_the_phones_out_and_snapshots_them() {
        let (mut db, path) = setup("mobile-sale");
        let id = insert_sale(&mut db, 1, &vec![1, 2], &[], &cash(6500000)).unwrap();
        assert_eq!(
            (status(&db, 1), status(&db, 2)),
            ("sold".into(), "sold".into())
        );
        let items = super::load_items(&db, id).unwrap();
        assert_eq!(items[0].serial, "SN-1");
        assert_eq!(items[0].battery, Some(91));
        let total: i64 = db
            .query_row("SELECT total FROM sales WHERE id = ?1", [id], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 6500000);

        // A sold phone cannot be sold again.
        assert!(insert_sale(&mut db, 1, &vec![1], &[], &cash(3000000)).is_err());
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_the_same_phone_twice_in_one_sale() {
        let (mut db, path) = setup("mobile-sale-twice");
        assert!(insert_sale(&mut db, 1, &vec![1, 1], &[], &cash(6000000)).is_err());
        assert_eq!(status(&db, 1), "in_stock");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
