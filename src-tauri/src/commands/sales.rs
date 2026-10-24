use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

/// One way the customer paid. For cash, `amount` is what was handed over, change included.
#[derive(Deserialize)]
pub struct PaymentInput {
    method: String,
    amount: i64,
}

/// What a method covered of the sale, change already taken off.
#[derive(Serialize)]
pub struct Payment {
    method: String,
    amount: i64,
}

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

#[derive(Serialize)]
pub struct Sale {
    id: i64,
    created_at: String,
    cashier_name: String,
    total: i64,
    payments: Vec<Payment>,
    paid: i64,
    change_due: i64,
    items: Vec<SaleItem>,
}

#[derive(Serialize)]
pub struct SaleSummary {
    id: i64,
    created_at: String,
    cashier_name: String,
    total: i64,
    methods: Vec<String>,
    items_count: i64,
}

#[tauri::command]
pub fn create_sale(
    state: State<AppState>,
    phone_ids: Vec<i64>,
    payments: Vec<PaymentInput>,
) -> AppResult<Sale> {
    let user = state.user()?;
    let mut db = state.db.lock().unwrap();
    let sale_id = insert_sale(&mut db, user.id, &phone_ids, &payments)?;
    load_sale(&db, sale_id)
}

pub fn insert_sale(
    db: &mut Connection,
    user_id: i64,
    phone_ids: &[i64],
    payments: &[PaymentInput],
) -> AppResult<i64> {
    if phone_ids.is_empty() {
        return invalid("السلة فارغة");
    }
    let tx = db.transaction()?;

    // Prices always come from the database, never from the client.
    let mut lines = Vec::with_capacity(phone_ids.len());
    for (i, id) in phone_ids.iter().enumerate() {
        if phone_ids[..i].contains(id) {
            return invalid("الجهاز نفسه مكرر في الفاتورة");
        }
        let line: (i64, String, String, String, String, Option<i64>, i64, i64, String) = tx
            .query_row(
                "SELECT ph.product_id, p.name, ph.serial, ph.storage, ph.color, ph.battery, ph.price, ph.cost, ph.status
                 FROM phones ph JOIN products p ON p.id = ph.product_id WHERE ph.id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                    ))
                },
            )
            .optional()?
            .ok_or(AppError::NotFound("الجهاز"))?;
        if line.8 != "in_stock" {
            return invalid(format!("الجهاز {} ({}) لم يعد في المخزون", line.2, line.1));
        }
        lines.push((*id, line));
    }

    let total: i64 = lines.iter().map(|(_, l)| l.6).sum();
    let cost_total: i64 = lines.iter().map(|(_, l)| l.7).sum();
    let (covered, paid) = settle(total, payments)?;
    let ts = now();
    tx.execute(
        "INSERT INTO sales (user_id, created_at, total, cost_total, paid, change_due)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![user_id, ts, total, cost_total, paid, paid - total],
    )?;
    let sale_id = tx.last_insert_rowid();
    for (method, amount) in covered {
        tx.execute(
            "INSERT INTO sale_payments (sale_id, method, amount) VALUES (?1, ?2, ?3)",
            params![sale_id, method, amount],
        )?;
    }
    for (phone_id, (product_id, name, serial, storage, color, battery, price, cost, _)) in &lines {
        tx.execute(
            "INSERT INTO sale_items (sale_id, phone_id, product_id, product_name, serial, storage, color, battery, price, cost)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![sale_id, phone_id, product_id, name, serial, storage, color, battery, price, cost],
        )?;
        tx.execute(
            "UPDATE phones SET status = 'sold' WHERE id = ?1",
            [phone_id],
        )?;
        tx.execute(
            "INSERT INTO stock_movements (phone_id, product_id, change_qty, reason, sale_id, user_id, created_at)
             VALUES (?1, ?2, -1, 'sale', ?3, ?4, ?5)",
            params![phone_id, product_id, sale_id, user_id, ts],
        )?;
    }
    tx.commit()?;
    Ok(sale_id)
}

const METHODS: [&str; 3] = ["cash", "card", "wallet"];

/// Splits a sale total over the payments the customer made. Returns what each method covered, in
/// a fixed order, and the total handed over. Only cash can be more than needed, since change is
/// given back in cash; card and wallet together may not pass the total.
fn settle(total: i64, payments: &[PaymentInput]) -> AppResult<(Vec<(&'static str, i64)>, i64)> {
    let mut given = [0; 3];
    for p in payments {
        let Some(i) = METHODS.iter().position(|m| *m == p.method) else {
            return invalid("طريقة دفع غير صحيحة");
        };
        if p.amount < 0 {
            return invalid("المبلغ لا يمكن أن يكون سالباً");
        }
        given[i] += p.amount;
    }
    let [cash, card, wallet] = given;
    if card + wallet > total {
        return invalid("مبلغ البطاقة والمحفظة أكبر من الإجمالي، والباقي يُرد نقداً فقط");
    }
    let paid = cash + card + wallet;
    if paid < total {
        return invalid("المبلغ المدفوع أقل من الإجمالي");
    }
    let change = paid - total;
    let covered = METHODS
        .into_iter()
        .zip([cash - change, card, wallet])
        .filter(|(_, amount)| *amount > 0)
        .collect();
    Ok((covered, paid))
}

fn load_sale(db: &Connection, id: i64) -> AppResult<Sale> {
    let mut sale = db
        .query_row(
            "SELECT s.id, s.created_at, u.name, s.total, s.paid, s.change_due
             FROM sales s JOIN users u ON u.id = s.user_id WHERE s.id = ?1",
            [id],
            |r| {
                Ok(Sale {
                    id: r.get(0)?,
                    created_at: r.get(1)?,
                    cashier_name: r.get(2)?,
                    total: r.get(3)?,
                    payments: vec![],
                    paid: r.get(4)?,
                    change_due: r.get(5)?,
                    items: vec![],
                })
            },
        )
        .optional()?
        .ok_or(AppError::NotFound("الفاتورة"))?;
    let mut stmt = db.prepare(
        "SELECT product_name, serial, storage, color, battery, price
         FROM sale_items WHERE sale_id = ?1 ORDER BY id",
    )?;
    sale.items = stmt
        .query_map([id], |r| {
            Ok(SaleItem {
                product_name: r.get(0)?,
                serial: r.get(1)?,
                storage: r.get(2)?,
                color: r.get(3)?,
                battery: r.get(4)?,
                price: r.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let mut stmt =
        db.prepare("SELECT method, amount FROM sale_payments WHERE sale_id = ?1 ORDER BY id")?;
    sale.payments = stmt
        .query_map([id], |r| {
            Ok(Payment {
                method: r.get(0)?,
                amount: r.get(1)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(sale)
}

/// Cashiers may only open their own receipts.
#[tauri::command]
pub fn get_sale(state: State<AppState>, id: i64) -> AppResult<Sale> {
    let user = state.user()?;
    let db = state.db.lock().unwrap();
    if !user.is_admin() {
        let owner: Option<i64> = db
            .query_row("SELECT user_id FROM sales WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .optional()?;
        if owner != Some(user.id) {
            return Err(AppError::Forbidden);
        }
    }
    load_sale(&db, id)
}

/// Dates are inclusive `YYYY-MM-DD`. Cashiers always get only their own sales for today.
#[tauri::command]
pub fn list_sales(
    state: State<AppState>,
    from: String,
    to: String,
    user_id: Option<i64>,
) -> AppResult<Vec<SaleSummary>> {
    let user = state.user()?;
    let (from, to, user_id) = if user.is_admin() {
        (from, to, user_id)
    } else {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        (today.clone(), today, Some(user.id))
    };
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT s.id, s.created_at, u.name, s.total,
                (SELECT GROUP_CONCAT(method) FROM sale_payments p WHERE p.sale_id = s.id),
                (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id)
         FROM sales s JOIN users u ON u.id = s.user_id
         WHERE date(s.created_at) BETWEEN ?1 AND ?2 AND (?3 IS NULL OR s.user_id = ?3)
         ORDER BY s.id DESC LIMIT 1000",
    )?;
    let rows = stmt.query_map(params![from, to, user_id], |r| {
        Ok(SaleSummary {
            id: r.get(0)?,
            created_at: r.get(1)?,
            cashier_name: r.get(2)?,
            total: r.get(3)?,
            methods: r
                .get::<_, Option<String>>(4)?
                .map(|m| m.split(',').map(String::from).collect())
                .unwrap_or_default(),
            items_count: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (Connection, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "mobile-pos-sale-{}-{:?}.db",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_file(&path);
        let db = crate::db::open(&path).unwrap();
        db.execute_batch(
            "INSERT INTO users (id, name, username, password_hash, role, created_at) VALUES (1, 'a', 'a', 'x', 'admin', '2026-01-01 00:00:00');
             INSERT INTO products (id, name, created_at, updated_at) VALUES (1, 'iPhone 15', '2026-01-01 00:00:00', '2026-01-01 00:00:00');
             INSERT INTO phones (id, product_id, serial, storage, color, battery, price, cost, created_at) VALUES
                 (1, 1, 'SN-1', '128GB', 'أسود', 91, 3000000, 2700000, '2026-01-01 00:00:00'),
                 (2, 1, 'SN-2', '256GB', 'أزرق', NULL, 3500000, 3100000, '2026-01-01 00:00:00');",
        )
        .unwrap();
        (db, path)
    }

    fn pay(method: &str, amount: i64) -> PaymentInput {
        PaymentInput {
            method: method.into(),
            amount,
        }
    }

    fn status(db: &Connection, id: i64) -> String {
        db.query_row("SELECT status FROM phones WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .unwrap()
    }

    #[test]
    fn sale_takes_the_phones_out_and_snapshots_them() {
        let (mut db, path) = setup();
        let id = insert_sale(&mut db, 1, &[1, 2], &[pay("cash", 6500000)]).unwrap();
        assert_eq!(
            (status(&db, 1), status(&db, 2)),
            ("sold".into(), "sold".into())
        );
        let sale = load_sale(&db, id).unwrap();
        assert_eq!(sale.total, 6500000);
        assert_eq!(sale.items[0].serial, "SN-1");
        assert_eq!(sale.items[0].battery, Some(91));

        // A sold phone cannot be sold again.
        assert!(insert_sale(&mut db, 1, &[1], &[pay("cash", 3000000)]).is_err());
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_the_same_phone_twice_in_one_sale() {
        let (mut db, path) = setup();
        assert!(insert_sale(&mut db, 1, &[1, 1], &[pay("cash", 6000000)]).is_err());
        assert_eq!(status(&db, 1), "in_stock");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn splits_a_sale_over_several_methods_with_cash_change() {
        let (mut db, path) = setup();
        // 30,000 due: 15,000 by card, 5,000 by wallet and 12,000 cash handed over.
        let payments = [
            pay("card", 1500000),
            pay("wallet", 500000),
            pay("cash", 1200000),
        ];
        let id = insert_sale(&mut db, 1, &[1], &payments).unwrap();
        let sale = load_sale(&db, id).unwrap();
        assert_eq!(sale.paid, 3200000);
        assert_eq!(sale.change_due, 200000);
        let covered: Vec<_> = sale
            .payments
            .iter()
            .map(|p| (p.method.as_str(), p.amount))
            .collect();
        assert_eq!(
            covered,
            [("cash", 1000000), ("card", 1500000), ("wallet", 500000)]
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_short_payments_and_change_from_a_card() {
        assert!(settle(1000, &[pay("cash", 400), pay("card", 500)]).is_err());
        assert!(settle(1000, &[pay("card", 1200)]).is_err());
        assert!(settle(1000, &[pay("cheque", 1000)]).is_err());
        let (covered, paid) = settle(1000, &[pay("card", 1000), pay("cash", 0)]).unwrap();
        assert_eq!((covered, paid), (vec![("card", 1000)], 1000));
    }
}
