//! The phone side of a supplier invoice: one line per phone, each with its own buy price.

use super::phones::{PhoneInput, insert_phone};
use crate::error::{AppResult, invalid};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// One phone on the invoice; its `cost` is what the supplier charged for it.
#[derive(Deserialize)]
pub struct PurchaseItemInput {
    pub product_id: i64,
    #[serde(flatten)]
    pub phone: PhoneInput,
}

pub type Lines = Vec<PurchaseItemInput>;

/// Phones on an invoice, for the purchases list.
pub const ITEMS_COUNT_SQL: &str = "(SELECT COUNT(*) FROM phones ph WHERE ph.purchase_id = p.id)";

/// Whether the invoice has no phones (it may still have extras).
pub fn is_empty(lines: &Lines) -> bool {
    lines.is_empty()
}

/// The invoice total: what the supplier charged for its phones.
pub fn total(lines: &Lines) -> AppResult<i64> {
    Ok(lines.iter().map(|i| i.phone.cost).sum())
}

/// Adds every phone on the invoice to stock.
pub fn record(
    tx: &Connection,
    purchase_id: i64,
    user_id: i64,
    ts: &str,
    lines: &Lines,
) -> AppResult<()> {
    for item in lines {
        insert_phone(
            tx,
            item.product_id,
            &item.phone,
            Some(purchase_id),
            user_id,
            ts,
        )?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct PurchaseItem {
    product_name: String,
    serial: String,
    storage: String,
    color: String,
    battery: Option<i64>,
    cost: i64,
    /// in_stock, sold or removed.
    status: String,
}

pub fn load_items(db: &Connection, purchase_id: i64) -> AppResult<Vec<PurchaseItem>> {
    let mut stmt = db.prepare(
        "SELECT pr.name, ph.serial, ph.storage, ph.color, ph.battery, ph.cost, ph.status
         FROM phones ph JOIN products pr ON pr.id = ph.product_id
         WHERE ph.purchase_id = ?1 ORDER BY ph.id",
    )?;
    let rows = stmt.query_map([purchase_id], |r| {
        Ok(PurchaseItem {
            product_name: r.get(0)?,
            serial: r.get(1)?,
            storage: r.get(2)?,
            color: r.get(3)?,
            battery: r.get(4)?,
            cost: r.get(5)?,
            status: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Deletes the invoice's phones. Refused once any of them has been sold or taken out, since that
/// history must stay.
pub fn remove(tx: &Connection, purchase_id: i64) -> AppResult<()> {
    let gone: i64 = tx.query_row(
        "SELECT COUNT(*) FROM phones WHERE purchase_id = ?1 AND status != 'in_stock'",
        [purchase_id],
        |r| r.get(0),
    )?;
    if gone > 0 {
        return invalid(format!(
            "بِيع أو خرج {gone} جهاز من هذه الفاتورة، فلا يمكن حذفها"
        ));
    }
    tx.execute(
        "DELETE FROM stock_movements WHERE purchase_id = ?1",
        [purchase_id],
    )?;
    tx.execute("DELETE FROM phones WHERE purchase_id = ?1", [purchase_id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::commands::purchases::{PurchaseInput, insert_purchase, remove_purchase};
    use crate::shop::testing;

    #[test]
    fn an_invoice_with_a_sold_phone_stays() {
        let (mut db, path) = crate::test_support::temp_db("mobile-purchase-sold");
        db.execute(
            "INSERT INTO suppliers (id, name, created_at) VALUES (1, 'مورد', '2026-01-01 00:00:00')",
            [],
        )
        .unwrap();
        let input = PurchaseInput {
            supplier_id: 1,
            invoice_no: String::new(),
            note: String::new(),
            paid: 0,
            items: testing::lines_costing(&db, &[1_000, 1_000, 1_000]),
            extras: vec![],
        };
        let id = insert_purchase(&mut db, 1, &input).unwrap();
        db.execute(
            "UPDATE phones SET status = 'sold' WHERE id = (SELECT MIN(id) FROM phones)",
            [],
        )
        .unwrap();
        assert!(remove_purchase(&mut db, id).is_err());
        assert_eq!(testing::stock_units(&db), 2);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
