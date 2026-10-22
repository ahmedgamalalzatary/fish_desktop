use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::State;

/// What the shop owes a supplier right now. Negative means the supplier owes the shop.
pub const BALANCE_SQL: &str = "s.opening_balance
    + COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id = s.id), 0)
    - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id = s.id), 0)";

#[derive(Serialize)]
pub struct Supplier {
    id: i64,
    name: String,
    phone: String,
    note: String,
    opening_balance: i64,
    active: bool,
    purchases_count: i64,
    purchases_total: i64,
    paid_total: i64,
    balance: i64,
    last_purchase: Option<String>,
}

#[derive(Deserialize)]
pub struct SupplierInput {
    name: String,
    phone: String,
    note: String,
    opening_balance: i64,
    active: bool,
}

impl SupplierInput {
    fn validate(&self) -> AppResult<()> {
        if self.name.trim().is_empty() {
            return invalid("اسم المورد مطلوب");
        }
        if self.opening_balance < 0 {
            return invalid("الرصيد السابق لا يمكن أن يكون سالباً");
        }
        Ok(())
    }
}

#[tauri::command]
pub fn list_suppliers(state: State<AppState>) -> AppResult<Vec<Supplier>> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    let sql = format!(
        "SELECT s.id, s.name, s.phone, s.note, s.opening_balance, s.active,
                (SELECT COUNT(*) FROM purchases WHERE supplier_id = s.id),
                COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id = s.id), 0),
                COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id = s.id), 0),
                {BALANCE_SQL},
                (SELECT MAX(created_at) FROM purchases WHERE supplier_id = s.id)
         FROM suppliers s ORDER BY s.active DESC, s.name"
    );
    let mut stmt = db.prepare(&sql)?;
    let rows = stmt.query_map([], |r| {
        Ok(Supplier {
            id: r.get(0)?,
            name: r.get(1)?,
            phone: r.get(2)?,
            note: r.get(3)?,
            opening_balance: r.get(4)?,
            active: r.get(5)?,
            purchases_count: r.get(6)?,
            purchases_total: r.get(7)?,
            paid_total: r.get(8)?,
            balance: r.get(9)?,
            last_purchase: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[tauri::command]
pub fn create_supplier(state: State<AppState>, input: SupplierInput) -> AppResult<i64> {
    state.admin()?;
    input.validate()?;
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO suppliers (name, phone, note, opening_balance, active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            input.name.trim(),
            input.phone.trim(),
            input.note.trim(),
            input.opening_balance,
            input.active,
            now()
        ],
    )?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_supplier(state: State<AppState>, id: i64, input: SupplierInput) -> AppResult<()> {
    state.admin()?;
    input.validate()?;
    let db = state.db.lock().unwrap();
    let changed = db.execute(
        "UPDATE suppliers SET name = ?1, phone = ?2, note = ?3, opening_balance = ?4, active = ?5 WHERE id = ?6",
        params![
            input.name.trim(),
            input.phone.trim(),
            input.note.trim(),
            input.opening_balance,
            input.active,
            id
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("المورد"));
    }
    Ok(())
}

/// Suppliers with invoices or payments are deactivated instead, so their history stays in reports.
#[tauri::command]
pub fn delete_supplier(state: State<AppState>, id: i64) -> AppResult<&'static str> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    let history: i64 = db.query_row(
        "SELECT (SELECT COUNT(*) FROM purchases WHERE supplier_id = ?1) + (SELECT COUNT(*) FROM supplier_payments WHERE supplier_id = ?1)",
        [id],
        |r| r.get(0),
    )?;
    if history > 0 {
        db.execute("UPDATE suppliers SET active = 0 WHERE id = ?1", [id])?;
        Ok("deactivated")
    } else {
        db.execute("DELETE FROM suppliers WHERE id = ?1", [id])?;
        Ok("deleted")
    }
}

pub fn insert_payment(
    db: &Connection,
    supplier_id: i64,
    purchase_id: Option<i64>,
    amount: i64,
    note: &str,
    user_id: i64,
) -> AppResult<()> {
    db.execute(
        "INSERT INTO supplier_payments (supplier_id, purchase_id, amount, note, user_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![supplier_id, purchase_id, amount, note.trim(), user_id, now()],
    )?;
    Ok(())
}

#[tauri::command]
pub fn add_supplier_payment(
    state: State<AppState>,
    supplier_id: i64,
    amount: i64,
    note: String,
) -> AppResult<()> {
    let user = state.admin()?;
    if amount <= 0 {
        return invalid("أدخل مبلغاً صحيحاً");
    }
    let db = state.db.lock().unwrap();
    insert_payment(&db, supplier_id, None, amount, &note, user.id)
}

#[tauri::command]
pub fn delete_supplier_payment(state: State<AppState>, id: i64) -> AppResult<()> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    if db.execute("DELETE FROM supplier_payments WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound("الدفعة"));
    }
    Ok(())
}

/// One line of a supplier's account: an invoice adds to what the shop owes, a payment reduces it.
#[derive(Serialize)]
pub struct StatementRow {
    kind: &'static str,
    id: i64,
    created_at: String,
    /// Supplier's invoice number for purchases, the payment note for payments.
    reference: String,
    /// Set on payments made while receiving an invoice.
    purchase_id: Option<i64>,
    amount: i64,
}

#[tauri::command]
pub fn supplier_statement(
    state: State<AppState>,
    supplier_id: i64,
) -> AppResult<Vec<StatementRow>> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT 'purchase', id, created_at, invoice_no, NULL, total FROM purchases WHERE supplier_id = ?1
         UNION ALL
         SELECT 'payment', id, created_at, note, purchase_id, amount FROM supplier_payments WHERE supplier_id = ?1
         ORDER BY 3, 1 DESC, 2",
    )?;
    let rows = stmt.query_map([supplier_id], |r| {
        let kind: String = r.get(0)?;
        Ok(StatementRow {
            kind: if kind == "purchase" {
                "purchase"
            } else {
                "payment"
            },
            id: r.get(1)?,
            created_at: r.get(2)?,
            reference: r.get(3)?,
            purchase_id: r.get(4)?,
            amount: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}
