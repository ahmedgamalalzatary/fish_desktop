use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

/// One physical phone in stock.
#[derive(Serialize)]
pub struct Phone {
    pub id: i64,
    pub product_id: i64,
    serial: String,
    storage: String,
    color: String,
    /// Battery health in percent; None when not recorded (e.g. a new phone).
    battery: Option<i64>,
    price: i64,
    cost: i64,
    /// Set when the phone came in on a supplier invoice; its buy price then belongs to that invoice.
    purchase_id: Option<i64>,
    created_at: String,
}

#[derive(Deserialize)]
pub struct PhoneInput {
    pub serial: String,
    pub storage: String,
    pub color: String,
    pub battery: Option<i64>,
    /// Sell price, in cents.
    pub price: i64,
    /// Buy price, in cents.
    pub cost: i64,
}

impl PhoneInput {
    pub fn validate(&self) -> AppResult<()> {
        if self.serial.trim().is_empty() {
            return invalid("الرقم التسلسلي مطلوب لكل جهاز");
        }
        if self.price <= 0 {
            return invalid("سعر البيع مطلوب");
        }
        if self.cost < 0 {
            return invalid("سعر الشراء لا يمكن أن يكون سالباً");
        }
        if self.battery.is_some_and(|b| !(1..=100).contains(&b)) {
            return invalid("نسبة البطارية بين 1 و100");
        }
        Ok(())
    }
}

/// Phones in stock, oldest first, for every model.
pub fn load_phones(db: &Connection, hide_cost: bool) -> AppResult<Vec<Phone>> {
    let mut stmt = db.prepare(
        "SELECT id, product_id, serial, storage, color, battery, price, cost, purchase_id, created_at
         FROM phones WHERE status = 'in_stock' ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Phone {
            id: r.get(0)?,
            product_id: r.get(1)?,
            serial: r.get(2)?,
            storage: r.get(3)?,
            color: r.get(4)?,
            battery: r.get(5)?,
            price: r.get(6)?,
            cost: if hide_cost { 0 } else { r.get(7)? },
            purchase_id: r.get(8)?,
            created_at: r.get(9)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn check_serial_free(db: &Connection, serial: &str, except: Option<i64>) -> AppResult<()> {
    let taken: Option<String> = db
        .query_row(
            "SELECT p.name FROM phones ph JOIN products p ON p.id = ph.product_id
             WHERE ph.serial = ?1 COLLATE NOCASE AND ph.status = 'in_stock' AND ph.id IS NOT ?2",
            params![serial, except],
            |r| r.get(0),
        )
        .optional()?;
    match taken {
        Some(model) => invalid(format!(
            "الرقم التسلسلي {serial} موجود بالفعل في المخزون ({model})"
        )),
        None => Ok(()),
    }
}

/// Adds one phone to stock and logs it. `purchase_id` is set when it arrives on a supplier invoice.
pub fn insert_phone(
    tx: &Connection,
    product_id: i64,
    input: &PhoneInput,
    purchase_id: Option<i64>,
    user_id: i64,
    ts: &str,
) -> AppResult<i64> {
    input.validate()?;
    let serial = input.serial.trim();
    check_serial_free(tx, serial, None)?;
    let active: Option<bool> = tx
        .query_row(
            "SELECT active FROM products WHERE id = ?1",
            [product_id],
            |r| r.get(0),
        )
        .optional()?;
    match active {
        None => return Err(AppError::NotFound("الموديل")),
        Some(false) => return invalid("هذا الموديل مؤرشف، استرجعه أولاً"),
        Some(true) => {}
    }
    tx.execute(
        "INSERT INTO phones (product_id, serial, storage, color, battery, price, cost, purchase_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            product_id,
            serial,
            input.storage.trim(),
            input.color.trim(),
            input.battery,
            input.price,
            input.cost,
            purchase_id,
            ts
        ],
    )?;
    let phone_id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO stock_movements (phone_id, product_id, change_qty, reason, cost_total, purchase_id, user_id, created_at)
         VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7)",
        params![
            phone_id,
            product_id,
            if purchase_id.is_some() { "purchase" } else { "added" },
            input.cost,
            purchase_id,
            user_id,
            ts
        ],
    )?;
    Ok(phone_id)
}

/// Adds phones of one model without a supplier invoice. All or none are saved.
#[tauri::command]
pub fn add_phones(
    state: State<AppState>,
    product_id: i64,
    phones: Vec<PhoneInput>,
) -> AppResult<()> {
    let user = state.admin()?;
    let mut db = state.db.lock().unwrap();
    add_phones_to(&mut db, user.id, product_id, &phones)
}

pub fn add_phones_to(
    db: &mut Connection,
    user_id: i64,
    product_id: i64,
    phones: &[PhoneInput],
) -> AppResult<()> {
    if phones.is_empty() {
        return invalid("أضف جهازاً واحداً على الأقل");
    }
    let tx = db.transaction()?;
    let ts = now();
    for phone in phones {
        insert_phone(&tx, product_id, phone, None, user_id, &ts)?;
    }
    tx.commit()?;
    Ok(())
}

/// Corrects a phone in stock. The buy price of a phone from a supplier invoice is fixed by that invoice.
#[tauri::command]
pub fn update_phone(state: State<AppState>, id: i64, input: PhoneInput) -> AppResult<()> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    edit_phone(&db, id, &input)
}

pub fn edit_phone(db: &Connection, id: i64, input: &PhoneInput) -> AppResult<()> {
    input.validate()?;
    let (status, purchase_id, cost): (String, Option<i64>, i64) = db
        .query_row(
            "SELECT status, purchase_id, cost FROM phones WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or(AppError::NotFound("الجهاز"))?;
    if status != "in_stock" {
        return invalid("هذا الجهاز لم يعد في المخزون");
    }
    if purchase_id.is_some() && input.cost != cost {
        return invalid("سعر شراء هذا الجهاز من فاتورة المورد، ولا يتغير من هنا");
    }
    let serial = input.serial.trim();
    check_serial_free(db, serial, Some(id))?;
    db.execute(
        "UPDATE phones SET serial = ?1, storage = ?2, color = ?3, battery = ?4, price = ?5, cost = ?6 WHERE id = ?7",
        params![
            serial,
            input.storage.trim(),
            input.color.trim(),
            input.battery,
            input.price,
            input.cost,
            id
        ],
    )?;
    // Keep the "added" movement's cost in step, so reports value the stock that came in correctly.
    db.execute(
        "UPDATE stock_movements SET cost_total = ?1 WHERE phone_id = ?2 AND reason = 'added'",
        params![input.cost, id],
    )?;
    Ok(())
}

/// Takes a phone out of stock without selling it (added by mistake, returned to the supplier, lost).
#[tauri::command]
pub fn remove_phone(state: State<AppState>, id: i64, note: String) -> AppResult<()> {
    let user = state.admin()?;
    let mut db = state.db.lock().unwrap();
    take_out(&mut db, user.id, id, &note)
}

pub fn take_out(db: &mut Connection, user_id: i64, id: i64, note: &str) -> AppResult<()> {
    if note.trim().is_empty() {
        return invalid("اكتب سبب إخراج الجهاز");
    }
    let tx = db.transaction()?;
    let product_id: i64 = tx
        .query_row(
            "SELECT product_id FROM phones WHERE id = ?1 AND status = 'in_stock'",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(AppError::NotFound("الجهاز"))?;
    tx.execute("UPDATE phones SET status = 'removed' WHERE id = ?1", [id])?;
    tx.execute(
        "INSERT INTO stock_movements (phone_id, product_id, change_qty, reason, note, user_id, created_at)
         VALUES (?1, ?2, -1, 'removed', ?3, ?4, ?5)",
        params![id, product_id, note.trim(), user_id, now()],
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn phone(serial: &str) -> PhoneInput {
        PhoneInput {
            serial: serial.into(),
            storage: "256GB".into(),
            color: "أسود".into(),
            battery: Some(88),
            price: 2500000,
            cost: 2200000,
        }
    }

    fn count(db: &Connection, sql: &str) -> i64 {
        db.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn serials_are_unique_in_stock_and_a_batch_saves_whole() {
        let path =
            std::env::temp_dir().join(format!("mobile-pos-phones-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut db = crate::db::open(&path).unwrap();
        db.execute_batch(
            "INSERT INTO users (id, name, username, password_hash, role, created_at) VALUES (1, 'a', 'a', 'x', 'admin', '2026-01-01 00:00:00');
             INSERT INTO products (id, name, created_at, updated_at) VALUES (1, 'iPhone 15', '2026-01-01 00:00:00', '2026-01-01 00:00:00');",
        )
        .unwrap();

        add_phones_to(&mut db, 1, 1, &[phone("A1"), phone("A2")]).unwrap();
        // The second line repeats a serial already in stock: nothing from this batch is kept.
        assert!(add_phones_to(&mut db, 1, 1, &[phone("B1"), phone("a1")]).is_err());
        assert_eq!(count(&db, "SELECT COUNT(*) FROM phones"), 2);
        assert!(
            add_phones_to(
                &mut db,
                1,
                1,
                &[PhoneInput {
                    battery: Some(0),
                    ..phone("C1")
                }]
            )
            .is_err()
        );

        // Once A1 leaves stock its serial can come back, e.g. as a trade-in.
        let a1: i64 = count(&db, "SELECT id FROM phones WHERE serial = 'A1'");
        assert!(take_out(&mut db, 1, a1, " ").is_err());
        take_out(&mut db, 1, a1, "أُضيف بالخطأ").unwrap();
        add_phones_to(&mut db, 1, 1, &[phone("A1")]).unwrap();
        assert_eq!(
            count(&db, "SELECT COUNT(*) FROM phones WHERE status = 'in_stock'"),
            2
        );
        assert_eq!(count(&db, "SELECT SUM(change_qty) FROM stock_movements"), 2);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
