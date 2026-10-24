use super::phones::{PhoneInput, insert_phone};
use super::suppliers::insert_payment;
use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

/// One phone on the invoice; its `cost` is what the supplier charged for it.
#[derive(Deserialize)]
pub struct PurchaseItemInput {
    product_id: i64,
    #[serde(flatten)]
    phone: PhoneInput,
}

#[derive(Deserialize)]
pub struct PurchaseInput {
    supplier_id: i64,
    invoice_no: String,
    note: String,
    /// Paid to the supplier now; the rest is added to their balance.
    paid: i64,
    items: Vec<PurchaseItemInput>,
}

/// Records a supplier invoice: adds every phone to stock and the unpaid part to the supplier's balance.
pub fn insert_purchase(db: &mut Connection, user_id: i64, input: &PurchaseInput) -> AppResult<i64> {
    if input.items.is_empty() {
        return invalid("أضف جهازاً واحداً على الأقل");
    }
    let total: i64 = input.items.iter().map(|i| i.phone.cost).sum();
    if input.paid < 0 || input.paid > total {
        return invalid("المبلغ المدفوع يجب ألا يزيد عن إجمالي الفاتورة");
    }

    let tx = db.transaction()?;
    let active: Option<bool> = tx
        .query_row(
            "SELECT active FROM suppliers WHERE id = ?1",
            [input.supplier_id],
            |r| r.get(0),
        )
        .optional()?;
    match active {
        None => return Err(AppError::NotFound("المورد")),
        Some(false) => return invalid("هذا المورد موقوف"),
        Some(true) => {}
    }

    let ts = now();
    tx.execute(
        "INSERT INTO purchases (supplier_id, invoice_no, total, note, user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![input.supplier_id, input.invoice_no.trim(), total, input.note.trim(), user_id, ts],
    )?;
    let purchase_id = tx.last_insert_rowid();

    for item in &input.items {
        insert_phone(
            &tx,
            item.product_id,
            &item.phone,
            Some(purchase_id),
            user_id,
            &ts,
        )?;
    }

    if input.paid > 0 {
        insert_payment(
            &tx,
            input.supplier_id,
            Some(purchase_id),
            input.paid,
            "",
            user_id,
        )?;
    }
    tx.commit()?;
    Ok(purchase_id)
}

#[tauri::command]
pub fn create_purchase(state: State<AppState>, input: PurchaseInput) -> AppResult<i64> {
    let user = state.admin()?;
    let mut db = state.db.lock().unwrap();
    insert_purchase(&mut db, user.id, &input)
}

#[derive(Serialize)]
pub struct PurchaseSummary {
    id: i64,
    created_at: String,
    supplier_id: i64,
    supplier_name: String,
    invoice_no: String,
    /// Phones on the invoice.
    items_count: i64,
    total: i64,
    /// Paid while receiving this invoice; later payments go to the supplier's account.
    paid: i64,
    user_name: String,
}

const SUMMARY_SQL: &str = "SELECT p.id, p.created_at, s.id, s.name, p.invoice_no,
        (SELECT COUNT(*) FROM phones ph WHERE ph.purchase_id = p.id),
        p.total,
        COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0),
        u.name
    FROM purchases p
    JOIN suppliers s ON s.id = p.supplier_id
    JOIN users u ON u.id = p.user_id";

fn summary_row(r: &rusqlite::Row) -> rusqlite::Result<PurchaseSummary> {
    Ok(PurchaseSummary {
        id: r.get(0)?,
        created_at: r.get(1)?,
        supplier_id: r.get(2)?,
        supplier_name: r.get(3)?,
        invoice_no: r.get(4)?,
        items_count: r.get(5)?,
        total: r.get(6)?,
        paid: r.get(7)?,
        user_name: r.get(8)?,
    })
}

#[tauri::command]
pub fn list_purchases(
    state: State<AppState>,
    from: String,
    to: String,
    supplier_id: Option<i64>,
) -> AppResult<Vec<PurchaseSummary>> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(&format!(
        "{SUMMARY_SQL}
         WHERE date(p.created_at) BETWEEN ?1 AND ?2 AND (?3 IS NULL OR p.supplier_id = ?3)
         ORDER BY p.id DESC LIMIT 2000"
    ))?;
    let rows = stmt.query_map(params![from, to, supplier_id], summary_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
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

#[derive(Serialize)]
pub struct Purchase {
    #[serde(flatten)]
    summary: PurchaseSummary,
    note: String,
    items: Vec<PurchaseItem>,
}

#[tauri::command]
pub fn get_purchase(state: State<AppState>, id: i64) -> AppResult<Purchase> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    let summary = db
        .query_row(&format!("{SUMMARY_SQL} WHERE p.id = ?1"), [id], summary_row)
        .optional()?
        .ok_or(AppError::NotFound("فاتورة الشراء"))?;
    let note: String = db.query_row("SELECT note FROM purchases WHERE id = ?1", [id], |r| {
        r.get(0)
    })?;
    let mut stmt = db.prepare(
        "SELECT pr.name, ph.serial, ph.storage, ph.color, ph.battery, ph.cost, ph.status
         FROM phones ph JOIN products pr ON pr.id = ph.product_id
         WHERE ph.purchase_id = ?1 ORDER BY ph.id",
    )?;
    let items = stmt
        .query_map([id], |r| {
            Ok(PurchaseItem {
                product_name: r.get(0)?,
                serial: r.get(1)?,
                storage: r.get(2)?,
                color: r.get(3)?,
                battery: r.get(4)?,
                cost: r.get(5)?,
                status: r.get(6)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(Purchase {
        summary,
        note,
        items,
    })
}

/// Undoes an invoice entered by mistake: deletes its phones and its payment. Refused once any of its
/// phones has been sold or taken out, since that history must stay.
pub fn remove_purchase(db: &mut Connection, id: i64) -> AppResult<()> {
    let tx = db.transaction()?;
    let gone: i64 = tx.query_row(
        "SELECT COUNT(*) FROM phones WHERE purchase_id = ?1 AND status != 'in_stock'",
        [id],
        |r| r.get(0),
    )?;
    if gone > 0 {
        return invalid(format!(
            "بِيع أو خرج {gone} جهاز من هذه الفاتورة، فلا يمكن حذفها"
        ));
    }
    tx.execute("DELETE FROM stock_movements WHERE purchase_id = ?1", [id])?;
    tx.execute("DELETE FROM phones WHERE purchase_id = ?1", [id])?;
    tx.execute("DELETE FROM supplier_payments WHERE purchase_id = ?1", [id])?;
    if tx.execute("DELETE FROM purchases WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound("فاتورة الشراء"));
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn delete_purchase(state: State<AppState>, id: i64) -> AppResult<()> {
    state.admin()?;
    let mut db = state.db.lock().unwrap();
    remove_purchase(&mut db, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (Connection, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "mobile-pos-purchase-{}-{:?}.db",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_file(&path);
        let db = crate::db::open(&path).unwrap();
        db.execute_batch(
            "INSERT INTO users (id, name, username, password_hash, role, created_at) VALUES (1, 'a', 'a', 'x', 'admin', '2026-01-01 00:00:00');
             INSERT INTO products (id, name, created_at, updated_at)
                 VALUES (1, 'Galaxy A55', '2026-01-01 00:00:00', '2026-01-01 00:00:00');
             INSERT INTO suppliers (id, name, opening_balance, created_at) VALUES (1, 'مورد', 10000, '2026-01-01 00:00:00');",
        )
        .unwrap();
        (db, path)
    }

    fn balance(db: &Connection) -> i64 {
        db.query_row(
            &format!(
                "SELECT {} FROM suppliers s WHERE id = 1",
                super::super::suppliers::BALANCE_SQL
            ),
            [],
            |r| r.get(0),
        )
        .unwrap()
    }

    fn stock(db: &Connection) -> i64 {
        db.query_row(
            "SELECT COUNT(*) FROM phones WHERE status = 'in_stock'",
            [],
            |r| r.get(0),
        )
        .unwrap()
    }

    fn item(serial: &str) -> PurchaseItemInput {
        PurchaseItemInput {
            product_id: 1,
            phone: PhoneInput {
                serial: serial.into(),
                storage: "256GB".into(),
                color: String::new(),
                battery: None,
                price: 1900000,
                cost: 1600000,
            },
        }
    }

    fn input(paid: i64) -> PurchaseInput {
        PurchaseInput {
            supplier_id: 1,
            invoice_no: "77".into(),
            note: String::new(),
            paid,
            items: ["S1", "S2", "S3", "S4"].map(item).into(),
        }
    }

    #[test]
    fn purchase_adds_stock_and_unpaid_part_to_balance_and_can_be_undone() {
        let (mut db, path) = setup();
        let id = insert_purchase(&mut db, 1, &input(4000000)).unwrap();
        assert_eq!(stock(&db), 4);
        assert_eq!(balance(&db), 10000 + 6400000 - 4000000);

        remove_purchase(&mut db, id).unwrap();
        assert_eq!(stock(&db), 0);
        assert_eq!(balance(&db), 10000);

        // Once one of its phones is sold, the invoice stays.
        let id = insert_purchase(&mut db, 1, &input(0)).unwrap();
        db.execute("UPDATE phones SET status = 'sold' WHERE serial = 'S2'", [])
            .unwrap();
        assert!(remove_purchase(&mut db, id).is_err());
        assert_eq!(stock(&db), 3);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_paying_more_than_the_invoice() {
        let (mut db, path) = setup();
        assert!(insert_purchase(&mut db, 1, &input(6400001)).is_err());
        assert_eq!(stock(&db), 0);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
