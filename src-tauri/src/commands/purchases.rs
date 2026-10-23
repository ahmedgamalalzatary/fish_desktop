use super::products::variant_owner;
use super::suppliers::insert_payment;
use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Deserialize)]
pub struct PurchaseItemInput {
    variant_id: i64,
    quantity: i64,
    /// Buy price of one piece, in cents.
    unit_cost: i64,
}

#[derive(Deserialize)]
pub struct PurchaseInput {
    supplier_id: i64,
    invoice_no: String,
    note: String,
    /// Paid to the supplier now; the rest is added to their balance.
    paid: i64,
    /// Set each variant's cost price from this invoice.
    update_cost: bool,
    items: Vec<PurchaseItemInput>,
}

/// Records a supplier invoice: adds every line to stock and the unpaid part to the supplier's balance.
pub fn insert_purchase(db: &mut Connection, user_id: i64, input: &PurchaseInput) -> AppResult<i64> {
    if input.items.is_empty() {
        return invalid("أضف صنفاً واحداً على الأقل");
    }
    if input
        .items
        .iter()
        .any(|i| i.quantity <= 0 || i.unit_cost < 0)
    {
        return invalid("أدخل كمية وسعر شراء صحيحين لكل صنف");
    }
    let total: i64 = input.items.iter().map(|i| i.unit_cost * i.quantity).sum();
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
        let (product_id, _) = variant_owner(&tx, item.variant_id)?;
        tx.execute(
            "INSERT INTO stock_movements (product_id, variant_id, change_qty, reason, cost_total, purchase_id, user_id, created_at)
             VALUES (?1, ?2, ?3, 'purchase', ?4, ?5, ?6, ?7)",
            params![product_id, item.variant_id, item.quantity, item.unit_cost * item.quantity, purchase_id, user_id, ts],
        )?;
        tx.execute(
            "UPDATE product_variants SET stock = stock + ?1 WHERE id = ?2",
            params![item.quantity, item.variant_id],
        )?;
        if input.update_cost && item.unit_cost > 0 {
            tx.execute(
                "UPDATE product_variants SET cost = ?1 WHERE id = ?2",
                params![item.unit_cost, item.variant_id],
            )?;
        }
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
    items_count: i64,
    pieces: i64,
    total: i64,
    /// Paid while receiving this invoice; later payments go to the supplier's account.
    paid: i64,
    user_name: String,
}

const SUMMARY_SQL: &str = "SELECT p.id, p.created_at, s.id, s.name, p.invoice_no,
        (SELECT COUNT(*) FROM stock_movements m WHERE m.purchase_id = p.id),
        COALESCE((SELECT SUM(change_qty) FROM stock_movements m WHERE m.purchase_id = p.id), 0),
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
        pieces: r.get(6)?,
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
    variant_label: String,
    quantity: i64,
    cost_total: i64,
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
        "SELECT pr.name, v.label, m.change_qty, COALESCE(m.cost_total, 0)
         FROM stock_movements m
         JOIN products pr ON pr.id = m.product_id
         JOIN product_variants v ON v.id = m.variant_id
         WHERE m.purchase_id = ?1 ORDER BY m.id",
    )?;
    let items = stmt
        .query_map([id], |r| {
            Ok(PurchaseItem {
                product_name: r.get(0)?,
                variant_label: r.get(1)?,
                quantity: r.get(2)?,
                cost_total: r.get(3)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(Purchase {
        summary,
        note,
        items,
    })
}

/// Undoes an invoice entered by mistake: takes its pieces back out of stock and removes its payment.
/// Cost prices changed by the invoice are left as they are.
pub fn remove_purchase(db: &mut Connection, id: i64) -> AppResult<()> {
    let tx = db.transaction()?;
    tx.execute(
        "UPDATE product_variants SET stock = stock - (
             SELECT SUM(m.change_qty) FROM stock_movements m WHERE m.purchase_id = ?1 AND m.variant_id = product_variants.id)
         WHERE id IN (SELECT variant_id FROM stock_movements WHERE purchase_id = ?1)",
        [id],
    )?;
    tx.execute("DELETE FROM stock_movements WHERE purchase_id = ?1", [id])?;
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
             INSERT INTO categories (id, name, created_at) VALUES (1, 'c', '2026-01-01 00:00:00');
             INSERT INTO products (id, name, category_id, created_at, updated_at)
                 VALUES (1, 'Galaxy A55', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
             INSERT INTO product_variants (id, product_id, label, price, cost, stock) VALUES (1, 1, '256GB', 1800000, 1500000, 1);
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

    fn stock(db: &Connection) -> (i64, i64) {
        db.query_row(
            "SELECT stock, cost FROM product_variants WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }

    fn input(paid: i64) -> PurchaseInput {
        PurchaseInput {
            supplier_id: 1,
            invoice_no: "77".into(),
            note: String::new(),
            paid,
            update_cost: true,
            items: vec![PurchaseItemInput {
                variant_id: 1,
                quantity: 4,
                unit_cost: 1600000,
            }],
        }
    }

    #[test]
    fn purchase_adds_stock_and_unpaid_part_to_balance_and_can_be_undone() {
        let (mut db, path) = setup();
        let id = insert_purchase(&mut db, 1, &input(4000000)).unwrap();
        assert_eq!(stock(&db), (5, 1600000));
        assert_eq!(balance(&db), 10000 + 6400000 - 4000000);

        remove_purchase(&mut db, id).unwrap();
        assert_eq!(stock(&db).0, 1);
        assert_eq!(balance(&db), 10000);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_paying_more_than_the_invoice() {
        let (mut db, path) = setup();
        assert!(insert_purchase(&mut db, 1, &input(6400001)).is_err());
        assert_eq!(stock(&db).0, 1);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
