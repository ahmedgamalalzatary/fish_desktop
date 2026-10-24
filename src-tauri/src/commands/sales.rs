use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Deserialize)]
pub struct CartItem {
    variant_id: i64,
    quantity: i64,
}

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

#[derive(Serialize)]
pub struct SaleItem {
    product_name: String,
    variant_label: Option<String>,
    quantity: i64,
    unit_price: i64,
    line_total: i64,
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

struct Line {
    product_id: i64,
    variant_id: i64,
    name: String,
    label: Option<String>,
    quantity: i64,
    unit_price: i64,
    unit_cost: i64,
}

#[tauri::command]
pub fn create_sale(
    state: State<AppState>,
    items: Vec<CartItem>,
    payments: Vec<PaymentInput>,
) -> AppResult<Sale> {
    let user = state.user()?;
    let mut db = state.db.lock().unwrap();
    let sale_id = insert_sale(&mut db, user.id, &items, &payments)?;
    load_sale(&db, sale_id)
}

pub fn insert_sale(
    db: &mut Connection,
    user_id: i64,
    items: &[CartItem],
    payments: &[PaymentInput],
) -> AppResult<i64> {
    if items.is_empty() {
        return invalid("السلة فارغة");
    }

    let tx = db.transaction()?;
    let allow_negative = tx
        .query_row(
            "SELECT value FROM settings WHERE key = 'allow_negative_stock'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .is_some_and(|v| v == "1");

    // Prices always come from the database, never from the client.
    // The same variant may sit on several cart lines, so stock is checked against their sum.
    let mut lines = Vec::with_capacity(items.len());
    let mut needed: HashMap<i64, (i64, i64, String)> = HashMap::new();
    for item in items {
        if item.quantity <= 0 {
            return invalid("الكمية يجب أن تكون أكبر من صفر");
        }
        let (product_id, name, label, price, cost, stock): (i64, String, String, i64, i64, i64) =
            tx.query_row(
                "SELECT p.id, p.name, v.label, v.price, v.cost, v.stock
                 FROM product_variants v JOIN products p ON p.id = v.product_id
                 WHERE v.id = ?1 AND v.active = 1 AND p.active = 1",
                [item.variant_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                },
            )
            .optional()?
            .ok_or(AppError::NotFound("المنتج"))?;
        let display = if label.is_empty() {
            name.clone()
        } else {
            format!("{name} — {label}")
        };
        needed
            .entry(item.variant_id)
            .or_insert((0, stock, display))
            .0 += item.quantity;
        lines.push(Line {
            product_id,
            variant_id: item.variant_id,
            name,
            label: (!label.is_empty()).then_some(label),
            quantity: item.quantity,
            unit_price: price,
            unit_cost: cost,
        });
    }

    if !allow_negative {
        for (wanted, stock, name) in needed.values() {
            if stock < wanted {
                return invalid(format!(
                    "المخزون غير كافٍ من «{name}»: المتوفر {stock} والمطلوب {wanted}"
                ));
            }
        }
    }

    let total: i64 = lines.iter().map(|l| l.unit_price * l.quantity).sum();
    let cost_total: i64 = lines.iter().map(|l| l.unit_cost * l.quantity).sum();
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
    for l in &lines {
        tx.execute(
            "INSERT INTO sale_items (sale_id, product_id, variant_id, product_name, variant_label, quantity, unit_price, line_total, line_cost)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                sale_id,
                l.product_id,
                l.variant_id,
                l.name,
                l.label,
                l.quantity,
                l.unit_price,
                l.unit_price * l.quantity,
                l.unit_cost * l.quantity
            ],
        )?;
        tx.execute(
            "UPDATE product_variants SET stock = stock - ?1 WHERE id = ?2",
            params![l.quantity, l.variant_id],
        )?;
        tx.execute(
            "INSERT INTO stock_movements (product_id, variant_id, change_qty, reason, sale_id, user_id, created_at)
             VALUES (?1, ?2, ?3, 'sale', ?4, ?5, ?6)",
            params![l.product_id, l.variant_id, -l.quantity, sale_id, user_id, ts],
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
        "SELECT product_name, variant_label, quantity, unit_price, line_total
         FROM sale_items WHERE sale_id = ?1 ORDER BY id",
    )?;
    sale.items = stmt
        .query_map([id], |r| {
            Ok(SaleItem {
                product_name: r.get(0)?,
                variant_label: r.get(1)?,
                quantity: r.get(2)?,
                unit_price: r.get(3)?,
                line_total: r.get(4)?,
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
                (SELECT COALESCE(SUM(quantity), 0) FROM sale_items i WHERE i.sale_id = s.id)
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
             INSERT INTO categories (id, name, created_at) VALUES (1, 'c', '2026-01-01 00:00:00');
             INSERT INTO products (id, name, category_id, created_at, updated_at) VALUES (1, 'iPhone 15', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
             INSERT INTO product_variants (id, product_id, label, price, cost, stock) VALUES (1, 1, '128GB', 3000000, 2700000, 2);",
        )
        .unwrap();
        (db, path)
    }

    fn stock(db: &Connection) -> i64 {
        db.query_row("SELECT stock FROM product_variants WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap()
    }

    #[test]
    fn sale_deducts_pieces_and_snapshots_prices() {
        let (mut db, path) = setup();
        let items = [CartItem {
            variant_id: 1,
            quantity: 2,
        }];
        let id = insert_sale(&mut db, 1, &items, &[pay("cash", 6000000)]).unwrap();
        assert_eq!(stock(&db), 0);
        let sale = load_sale(&db, id).unwrap();
        assert_eq!(sale.total, 6000000);
        assert_eq!(sale.change_due, 0);
        assert_eq!(sale.items[0].variant_label.as_deref(), Some("128GB"));
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn checks_stock_against_all_lines_of_the_same_variant() {
        let (mut db, path) = setup();
        let line = |quantity| CartItem {
            variant_id: 1,
            quantity,
        };
        assert!(insert_sale(&mut db, 1, &[line(2), line(1)], &[pay("card", 9000000)]).is_err());
        assert_eq!(stock(&db), 2);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    fn pay(method: &str, amount: i64) -> PaymentInput {
        PaymentInput {
            method: method.into(),
            amount,
        }
    }

    #[test]
    fn splits_a_sale_over_several_methods_with_cash_change() {
        let (mut db, path) = setup();
        let items = [CartItem {
            variant_id: 1,
            quantity: 1,
        }];
        // 30,000 due: 15,000 by card, 5,000 by wallet and 12,000 cash handed over.
        let payments = [
            pay("card", 1500000),
            pay("wallet", 500000),
            pay("cash", 1200000),
        ];
        let id = insert_sale(&mut db, 1, &items, &payments).unwrap();
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
