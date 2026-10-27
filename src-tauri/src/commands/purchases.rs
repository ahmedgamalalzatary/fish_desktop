use super::extras::{self, ExtraPurchaseLine, PurchaseExtra};
use super::suppliers::insert_payment;
use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::shop::purchases as shop;
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Deserialize)]
pub struct PurchaseInput {
    pub(crate) supplier_id: i64,
    pub(crate) invoice_no: String,
    pub(crate) note: String,
    /// Paid to the supplier now; the rest is added to their balance.
    pub(crate) paid: i64,
    /// The shop's invoice lines.
    pub(crate) items: shop::Lines,
    /// Counted add-ons or accessories on the same invoice.
    #[serde(default)]
    pub(crate) extras: Vec<ExtraPurchaseLine>,
}

/// Records a supplier invoice: the shop adds its lines to stock, the extras theirs, and the unpaid
/// part goes on the supplier's balance.
pub fn insert_purchase(db: &mut Connection, user_id: i64, input: &PurchaseInput) -> AppResult<i64> {
    if shop::is_empty(&input.items) && input.extras.is_empty() {
        return invalid("أضف صنفاً واحداً على الأقل");
    }
    let total = shop::total(&input.items)? + extras::purchase_total(&input.extras)?;
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
    shop::record(&tx, purchase_id, user_id, &ts, &input.items)?;
    extras::record_purchase(&tx, purchase_id, user_id, &ts, &input.extras)?;

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
    /// Lines on the invoice, counted the shop's way.
    items_count: i64,
    /// What came in on the invoice, in the shop's units (phones, grams…).
    units: i64,
    total: i64,
    /// Paid while receiving this invoice; later payments go to the supplier's account.
    paid: i64,
    user_name: String,
}

fn summary_sql() -> String {
    format!(
        "SELECT p.id, p.created_at, s.id, s.name, p.invoice_no,
            {} + {},
            COALESCE((SELECT SUM({}) FROM stock_movements m WHERE m.purchase_id = p.id AND m.reason = 'purchase'), 0),
            p.total,
            COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0),
            u.name
        FROM purchases p
        JOIN suppliers s ON s.id = p.supplier_id
        JOIN users u ON u.id = p.user_id",
        shop::ITEMS_COUNT_SQL,
        extras::ITEMS_COUNT_SQL,
        crate::shop::reports::MOVEMENT_UNITS
    )
}

fn summary_row(r: &rusqlite::Row) -> rusqlite::Result<PurchaseSummary> {
    Ok(PurchaseSummary {
        id: r.get(0)?,
        created_at: r.get(1)?,
        supplier_id: r.get(2)?,
        supplier_name: r.get(3)?,
        invoice_no: r.get(4)?,
        items_count: r.get(5)?,
        units: r.get(6)?,
        total: r.get(7)?,
        paid: r.get(8)?,
        user_name: r.get(9)?,
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
        "{}
         WHERE date(p.created_at) BETWEEN ?1 AND ?2 AND (?3 IS NULL OR p.supplier_id = ?3)
         ORDER BY p.id DESC LIMIT 2000",
        summary_sql()
    ))?;
    let rows = stmt.query_map(params![from, to, supplier_id], summary_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[derive(Serialize)]
pub struct Purchase {
    #[serde(flatten)]
    summary: PurchaseSummary,
    note: String,
    items: Vec<shop::PurchaseItem>,
    extras: Vec<PurchaseExtra>,
}

#[tauri::command]
pub fn get_purchase(state: State<AppState>, id: i64) -> AppResult<Purchase> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    let summary = db
        .query_row(
            &format!("{} WHERE p.id = ?1", summary_sql()),
            [id],
            summary_row,
        )
        .optional()?
        .ok_or(AppError::NotFound("فاتورة الشراء"))?;
    let note: String = db.query_row("SELECT note FROM purchases WHERE id = ?1", [id], |r| {
        r.get(0)
    })?;
    Ok(Purchase {
        summary,
        note,
        items: shop::load_items(&db, id)?,
        extras: extras::load_purchase_extras(&db, id)?,
    })
}

/// Undoes an invoice entered by mistake: the shop takes its lines back out of stock (or refuses, when
/// that history must stay), then its payment and the invoice go.
pub fn remove_purchase(db: &mut Connection, id: i64) -> AppResult<()> {
    let tx = db.transaction()?;
    shop::remove(&tx, id)?;
    extras::remove_purchase(&tx, id)?;
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
    use crate::shop::testing;

    fn setup(name: &str) -> (Connection, std::path::PathBuf) {
        let (db, path) = crate::test_support::temp_db(name);
        db.execute(
            "INSERT INTO suppliers (id, name, opening_balance, created_at) VALUES (1, 'مورد', 10000, '2026-01-01 00:00:00')",
            [],
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

    fn input(db: &Connection, paid: i64) -> PurchaseInput {
        PurchaseInput {
            supplier_id: 1,
            invoice_no: "77".into(),
            note: String::new(),
            paid,
            items: testing::lines_costing(db, &[1_600_000; 4]),
            extras: vec![],
        }
    }

    #[test]
    fn purchase_adds_stock_and_unpaid_part_to_balance_and_can_be_undone() {
        let (mut db, path) = setup("purchase");
        let invoice = input(&db, 4_000_000);
        let id = insert_purchase(&mut db, 1, &invoice).unwrap();
        assert_eq!(testing::stock_units(&db), 4 * testing::ITEM_UNITS);
        assert_eq!(balance(&db), 10_000 + 6_400_000 - 4_000_000);
        let summary = db
            .query_row(
                &format!("{} WHERE p.id = ?1", summary_sql()),
                [id],
                summary_row,
            )
            .unwrap();
        assert_eq!(
            (summary.units, summary.total, summary.paid),
            (4 * testing::ITEM_UNITS, 6_400_000, 4_000_000)
        );

        remove_purchase(&mut db, id).unwrap();
        assert_eq!(testing::stock_units(&db), 0);
        assert_eq!(balance(&db), 10_000);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_paying_more_than_the_invoice() {
        let (mut db, path) = setup("purchase-overpaid");
        let invoice = input(&db, 6_400_001);
        assert!(insert_purchase(&mut db, 1, &invoice).is_err());
        assert_eq!(testing::stock_units(&db), 0);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
