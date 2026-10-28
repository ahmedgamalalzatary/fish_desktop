//! Selling on credit: the customer pays part now and the rest later, in as many payments as they like,
//! each with one method or several. Shared, but only shops with `shop::CREDIT_SALES` use it (and add
//! `MIGRATION` to their list); in the others every command here refuses.
//!
//! What is left on a sale = its total − what was paid at the sale (`sale_payments`) − what was paid
//! later (`credit_payment_methods`). The whole sale counts as revenue on the day it was made; later
//! payments count as money taken in on the day they come in.

use super::reports::query;
use super::sales::{Payment, PaymentInput, Sale, load_sale, settle_part};
use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

// Listed only by the shops that sell on credit.
#[allow(dead_code)]
pub const MIGRATION: &str = r#"
-- People who bought on credit, known by their phone number.
CREATE TABLE customers (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL CHECK (trim(name) != ''),
    phone      TEXT NOT NULL UNIQUE CHECK (trim(phone) != ''),
    created_at TEXT NOT NULL
);

-- A sale made on credit, and who owes the rest of it.
CREATE TABLE credit_sales (
    sale_id     INTEGER PRIMARY KEY REFERENCES sales(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id)
);

-- A payment towards a sale on credit after the day of sale. `paid` is everything handed over, cash
-- change included; its methods add up to what it covered.
CREATE TABLE credit_payments (
    id         INTEGER PRIMARY KEY,
    sale_id    INTEGER NOT NULL REFERENCES credit_sales(sale_id),
    paid       INTEGER NOT NULL CHECK (paid > 0),
    change_due INTEGER NOT NULL DEFAULT 0 CHECK (change_due >= 0),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);

CREATE TABLE credit_payment_methods (
    id         INTEGER PRIMARY KEY,
    payment_id INTEGER NOT NULL REFERENCES credit_payments(id) ON DELETE CASCADE,
    method     TEXT NOT NULL CHECK (method IN ('cash', 'card', 'wallet')),
    amount     INTEGER NOT NULL CHECK (amount > 0)
);

CREATE INDEX idx_credit_sales_customer ON credit_sales(customer_id);
CREATE INDEX idx_credit_payments_sale ON credit_payments(sale_id);
CREATE INDEX idx_credit_payments_created ON credit_payments(created_at);
CREATE INDEX idx_credit_payment_methods_payment ON credit_payment_methods(payment_id);
"#;

/// What is still owed on the sale `s`.
const LEFT: &str = "(s.total
    - COALESCE((SELECT SUM(p.amount) FROM sale_payments p WHERE p.sale_id = s.id), 0)
    - COALESCE((SELECT SUM(m.amount) FROM credit_payment_methods m
                JOIN credit_payments cp ON cp.id = m.payment_id WHERE cp.sale_id = s.id), 0))";

/// Who is buying on credit, as typed at checkout.
#[derive(Deserialize)]
pub struct CustomerInput {
    name: String,
    phone: String,
}

#[derive(Serialize)]
pub struct Customer {
    id: i64,
    name: String,
    phone: String,
}

/// A payment made after the day of sale.
#[derive(Serialize)]
pub struct LaterPayment {
    id: i64,
    created_at: String,
    user_name: String,
    paid: i64,
    change_due: i64,
    payments: Vec<Payment>,
}

/// The credit side of a sale: who owes it, what they paid since, and what is left.
#[derive(Serialize)]
pub struct SaleCredit {
    customer_id: i64,
    customer_name: String,
    customer_phone: String,
    later: Vec<LaterPayment>,
    remaining: i64,
}

fn enabled() -> AppResult<()> {
    if crate::shop::CREDIT_SALES {
        Ok(())
    } else {
        invalid("البيع الآجل غير متاح في هذا المحل")
    }
}

/// Digits only (Arabic digits read as Western), keeping a leading +, so one phone is one customer
/// however it was typed.
fn normal_phone(phone: &str) -> String {
    let digits: String = phone
        .chars()
        .filter_map(|c| match c {
            '0'..='9' => Some(c),
            '٠'..='٩' => char::from_digit(c as u32 - '٠' as u32, 10),
            _ => None,
        })
        .collect();
    if phone.trim_start().starts_with('+') && !digits.is_empty() {
        format!("+{digits}")
    } else {
        digits
    }
}

/// Marks a new sale as on credit to the customer with this phone, adding them (or renaming them to
/// what was typed) first.
pub fn open(tx: &Connection, sale_id: i64, customer: &CustomerInput, ts: &str) -> AppResult<()> {
    enabled()?;
    let (name, phone) = (customer.name.trim(), normal_phone(&customer.phone));
    if name.is_empty() || phone.is_empty() {
        return invalid("اكتب اسم العميل ورقم هاتفه للبيع الآجل");
    }
    let id: Option<i64> = tx
        .query_row("SELECT id FROM customers WHERE phone = ?1", [&phone], |r| {
            r.get(0)
        })
        .optional()?;
    let id = match id {
        Some(id) => {
            tx.execute(
                "UPDATE customers SET name = ?1 WHERE id = ?2",
                params![name, id],
            )?;
            id
        }
        None => {
            tx.execute(
                "INSERT INTO customers (name, phone, created_at) VALUES (?1, ?2, ?3)",
                params![name, phone, ts],
            )?;
            tx.last_insert_rowid()
        }
    };
    tx.execute(
        "INSERT INTO credit_sales (sale_id, customer_id) VALUES (?1, ?2)",
        params![sale_id, id],
    )?;
    Ok(())
}

/// The credit side of a sale, or None for a sale paid in full at the time.
pub fn load(db: &Connection, sale_id: i64) -> AppResult<Option<SaleCredit>> {
    if !crate::shop::CREDIT_SALES {
        return Ok(None);
    }
    let Some(mut credit) = db
        .query_row(
            &format!(
                "SELECT c.id, c.name, c.phone, {LEFT} FROM credit_sales cs
                 JOIN customers c ON c.id = cs.customer_id JOIN sales s ON s.id = cs.sale_id
                 WHERE cs.sale_id = ?1"
            ),
            [sale_id],
            |r| {
                Ok(SaleCredit {
                    customer_id: r.get(0)?,
                    customer_name: r.get(1)?,
                    customer_phone: r.get(2)?,
                    later: vec![],
                    remaining: r.get(3)?,
                })
            },
        )
        .optional()?
    else {
        return Ok(None);
    };
    credit.later = query(
        db,
        "SELECT cp.id, cp.created_at, u.name, cp.paid, cp.change_due FROM credit_payments cp
         JOIN users u ON u.id = cp.user_id WHERE cp.sale_id = ?1 ORDER BY cp.id",
        [sale_id],
        |r| {
            Ok(LaterPayment {
                id: r.get(0)?,
                created_at: r.get(1)?,
                user_name: r.get(2)?,
                paid: r.get(3)?,
                change_due: r.get(4)?,
                payments: vec![],
            })
        },
    )?;
    for payment in &mut credit.later {
        payment.payments = query(
            db,
            "SELECT method, amount FROM credit_payment_methods WHERE payment_id = ?1 ORDER BY id",
            [payment.id],
            |r| Ok(Payment::new(r.get(0)?, r.get(1)?)),
        )?;
    }
    Ok(Some(credit))
}

/// Whether the sale was made on credit (a cashier may open those receipts from the customers page).
pub fn is_credit_sale(db: &Connection, sale_id: i64) -> AppResult<bool> {
    if !crate::shop::CREDIT_SALES {
        return Ok(false);
    }
    let found: Option<i64> = db
        .query_row(
            "SELECT sale_id FROM credit_sales WHERE sale_id = ?1",
            [sale_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(found.is_some())
}

/// The customer with this phone, to fill in their name at checkout.
#[tauri::command]
pub fn find_customer(state: State<AppState>, phone: String) -> AppResult<Option<Customer>> {
    state.user()?;
    enabled()?;
    let db = state.db.lock().unwrap();
    Ok(db
        .query_row(
            "SELECT id, name, phone FROM customers WHERE phone = ?1",
            [normal_phone(&phone)],
            |r| {
                Ok(Customer {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    phone: r.get(2)?,
                })
            },
        )
        .optional()?)
}

#[derive(Serialize)]
pub struct CustomerRow {
    id: i64,
    name: String,
    phone: String,
    sales_count: i64,
    /// What their sales on credit came to.
    total: i64,
    paid: i64,
    owed: i64,
    last_sale: String,
}

/// Every customer with what they bought on credit and still owe, those owing most first.
#[tauri::command]
pub fn list_customers(state: State<AppState>) -> AppResult<Vec<CustomerRow>> {
    state.user()?;
    enabled()?;
    let db = state.db.lock().unwrap();
    query(
        &db,
        &format!(
            "SELECT c.id, c.name, c.phone, COUNT(*), SUM(s.total), SUM({LEFT}), MAX(s.created_at)
             FROM customers c JOIN credit_sales cs ON cs.customer_id = c.id JOIN sales s ON s.id = cs.sale_id
             GROUP BY c.id ORDER BY SUM({LEFT}) DESC, MAX(s.created_at) DESC"
        ),
        [],
        |r| {
            let (total, owed): (i64, i64) = (r.get(4)?, r.get(5)?);
            Ok(CustomerRow {
                id: r.get(0)?,
                name: r.get(1)?,
                phone: r.get(2)?,
                sales_count: r.get(3)?,
                total,
                paid: total - owed,
                owed,
                last_sale: r.get(6)?,
            })
        },
    )
}

/// A customer's sales on credit, newest first, each with its lines and every payment.
#[tauri::command]
pub fn customer_sales(state: State<AppState>, customer_id: i64) -> AppResult<Vec<Sale>> {
    state.user()?;
    enabled()?;
    let db = state.db.lock().unwrap();
    let ids = query(
        &db,
        "SELECT sale_id FROM credit_sales WHERE customer_id = ?1 ORDER BY sale_id DESC",
        [customer_id],
        |r| r.get::<_, i64>(0),
    )?;
    ids.into_iter().map(|id| load_sale(&db, id)).collect()
}

/// Records a later payment towards a sale on credit, with one method or several; returns the sale
/// with it, for the receipt.
#[tauri::command]
pub fn add_credit_payment(
    state: State<AppState>,
    sale_id: i64,
    payments: Vec<PaymentInput>,
) -> AppResult<Sale> {
    let user = state.user()?;
    let mut db = state.db.lock().unwrap();
    pay(&mut db, user.id, sale_id, &payments)?;
    load_sale(&db, sale_id)
}

/// A later payment: what it covers may be less than what is left, and cash over it is given back.
pub fn pay(
    db: &mut Connection,
    user_id: i64,
    sale_id: i64,
    payments: &[PaymentInput],
) -> AppResult<i64> {
    enabled()?;
    let tx = db.transaction()?;
    let left: i64 = tx
        .query_row(
            &format!("SELECT {LEFT} FROM credit_sales cs JOIN sales s ON s.id = cs.sale_id WHERE cs.sale_id = ?1"),
            [sale_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(AppError::NotFound("الفاتورة الآجلة"))?;
    if left <= 0 {
        return invalid("هذه الفاتورة مسددة بالكامل");
    }
    let (covered, paid) = settle_part(left, payments)?;
    if paid == 0 {
        return invalid("اكتب المبلغ المدفوع");
    }
    tx.execute(
        "INSERT INTO credit_payments (sale_id, paid, change_due, user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![sale_id, paid, (paid - left).max(0), user_id, now()],
    )?;
    let id = tx.last_insert_rowid();
    for (method, amount) in covered {
        tx.execute(
            "INSERT INTO credit_payment_methods (payment_id, method, amount) VALUES (?1, ?2, ?3)",
            params![id, method, amount],
        )?;
    }
    tx.commit()?;
    Ok(id)
}

/// What the summary report shows of the sales on credit.
pub struct CreditSummary {
    /// Still owed now on the sales on credit made in the period.
    pub owed: i64,
    /// Paid later, in the period.
    pub collected: i64,
    /// That money by method, as `(method, payments, amount)`.
    pub by_method: Vec<(String, i64, i64)>,
}

/// The credit figures for the summary report; all zero in a shop that doesn't sell on credit.
pub fn summary(db: &Connection, from: &str, to: &str) -> AppResult<CreditSummary> {
    if !crate::shop::CREDIT_SALES {
        return Ok(CreditSummary {
            owed: 0,
            collected: 0,
            by_method: vec![],
        });
    }
    let owed: i64 = db.query_row(
        &format!(
            "SELECT COALESCE(SUM({LEFT}), 0) FROM credit_sales cs JOIN sales s ON s.id = cs.sale_id
             WHERE date(s.created_at) BETWEEN ?1 AND ?2"
        ),
        [from, to],
        |r| r.get(0),
    )?;
    let by_method = query(
        db,
        "SELECT m.method, COUNT(DISTINCT cp.id), SUM(m.amount) FROM credit_payment_methods m
         JOIN credit_payments cp ON cp.id = m.payment_id
         WHERE date(cp.created_at) BETWEEN ?1 AND ?2 GROUP BY m.method",
        [from, to],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let collected = by_method.iter().map(|(_, _, amount)| amount).sum();
    Ok(CreditSummary {
        owed,
        collected,
        by_method,
    })
}

#[derive(Serialize)]
pub struct CreditReportRow {
    sale_id: i64,
    created_at: String,
    customer_id: i64,
    customer_name: String,
    customer_phone: String,
    cashier_name: String,
    total: i64,
    paid: i64,
    remaining: i64,
}

/// The sales on credit made in the period, with what is left on each now.
#[tauri::command]
pub fn report_credit(
    state: State<AppState>,
    from: String,
    to: String,
) -> AppResult<Vec<CreditReportRow>> {
    state.admin()?;
    enabled()?;
    let db = state.db.lock().unwrap();
    query(
        &db,
        &format!(
            "SELECT s.id, s.created_at, c.id, c.name, c.phone, u.name, s.total, {LEFT}
             FROM credit_sales cs JOIN sales s ON s.id = cs.sale_id JOIN customers c ON c.id = cs.customer_id
             JOIN users u ON u.id = s.user_id
             WHERE date(s.created_at) BETWEEN ?1 AND ?2 ORDER BY s.id DESC"
        ),
        [&from, &to],
        |r| {
            let (total, remaining): (i64, i64) = (r.get(6)?, r.get(7)?);
            Ok(CreditReportRow {
                sale_id: r.get(0)?,
                created_at: r.get(1)?,
                customer_id: r.get(2)?,
                customer_name: r.get(3)?,
                customer_phone: r.get(4)?,
                cashier_name: r.get(5)?,
                total,
                paid: total - remaining,
                remaining,
            })
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::sales::{Terms, sell};
    use crate::shop::testing;

    fn pays(list: &[(&str, i64)]) -> Vec<PaymentInput> {
        serde_json::from_value(serde_json::Value::Array(
            list.iter()
                .map(|(m, a)| serde_json::json!({ "method": m, "amount": a }))
                .collect(),
        ))
        .unwrap()
    }

    fn on_credit(name: &str, phone: &str) -> Terms {
        Terms {
            customer: Some(CustomerInput {
                name: name.into(),
                phone: phone.into(),
            }),
            ..Terms::default()
        }
    }

    fn left(db: &Connection, sale_id: i64) -> i64 {
        load(db, sale_id).unwrap().unwrap().remaining
    }

    #[test]
    fn a_shop_that_does_not_sell_on_credit_refuses_it() {
        if crate::shop::CREDIT_SALES {
            return;
        }
        let (mut db, path) = crate::test_support::temp_db("credit-off");
        let cart = testing::cart_worth(&db, &[(10_000, 5_000)]);
        let sale = sell(
            &mut db,
            1,
            &cart,
            &[],
            &pays(&[("cash", 1_000)]),
            &on_credit("أ", "010"),
        );
        assert!(sale.is_err());
        let sales: i64 = db
            .query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sales, 0);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn reads_a_phone_however_it_was_typed() {
        assert_eq!(normal_phone(" 0100-123 4567 "), "01001234567");
        assert_eq!(normal_phone("٠١٠٠١٢٣٤٥٦٧"), "01001234567");
        assert_eq!(normal_phone("+20 100 123"), "+20100123");
        assert_eq!(normal_phone("—"), "");
    }

    #[test]
    fn a_sale_on_credit_is_paid_off_in_parts_with_several_methods() {
        if !crate::shop::CREDIT_SALES {
            return;
        }
        let (mut db, path) = crate::test_support::temp_db("credit-parts");
        // A 25,000 phone: 15,000 now (10,000 card + 5,000 cash), the rest later.
        let cart = testing::cart_worth(&db, &[(2_500_000, 2_000_000)]);
        let terms = on_credit("أحمد", "0100 123 4567");
        let id = sell(
            &mut db,
            1,
            &cart,
            &[],
            &pays(&[("card", 1_000_000), ("cash", 500_000)]),
            &terms,
        )
        .unwrap();
        assert_eq!(left(&db, id), 1_000_000);

        // 5,000 cash, then 5,000 as 3,000 wallet + 2,050 cash handed over (50 back).
        pay(&mut db, 1, id, &pays(&[("cash", 500_000)])).unwrap();
        assert_eq!(left(&db, id), 500_000);
        pay(
            &mut db,
            1,
            id,
            &pays(&[("wallet", 300_000), ("cash", 205_000)]),
        )
        .unwrap();
        let credit = load(&db, id).unwrap().unwrap();
        assert_eq!(credit.remaining, 0);
        assert_eq!(
            (
                credit.customer_name.as_str(),
                credit.customer_phone.as_str()
            ),
            ("أحمد", "01001234567")
        );
        let last = &credit.later[1];
        assert_eq!((last.paid, last.change_due), (505_000, 5_000));
        let covered: Vec<_> = last.payments.iter().map(Payment::parts).collect();
        assert_eq!(covered, [("cash", 200_000), ("wallet", 300_000)]);

        assert!(
            pay(&mut db, 1, id, &pays(&[("cash", 100)])).is_err(),
            "paid off already"
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn refuses_what_is_not_a_part_payment() {
        if !crate::shop::CREDIT_SALES {
            return;
        }
        let (mut db, path) = crate::test_support::temp_db("credit-refused");
        let cart = testing::cart_worth(&db, &[(10_000, 5_000)]);
        // Paid in full, so not on credit; no name; card over the total.
        assert!(
            sell(
                &mut db,
                1,
                &cart,
                &[],
                &pays(&[("cash", 10_000)]),
                &on_credit("أ", "010")
            )
            .is_err()
        );
        assert!(
            sell(
                &mut db,
                1,
                &cart,
                &[],
                &pays(&[("cash", 1_000)]),
                &on_credit(" ", "010")
            )
            .is_err()
        );
        assert!(
            sell(
                &mut db,
                1,
                &cart,
                &[],
                &pays(&[("card", 12_000)]),
                &on_credit("أ", "010")
            )
            .is_err()
        );
        // Nothing down is fine.
        let id = sell(&mut db, 1, &cart, &[], &[], &on_credit("أ", "010")).unwrap();
        assert_eq!(left(&db, id), 10_000);
        // A later payment: nothing, card over what is left, an unknown sale.
        assert!(pay(&mut db, 1, id, &[]).is_err());
        assert!(pay(&mut db, 1, id, &pays(&[("card", 10_001)])).is_err());
        assert!(pay(&mut db, 1, id + 99, &pays(&[("cash", 1)])).is_err());
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn one_phone_is_one_customer_and_the_reports_count_the_debt() {
        if !crate::shop::CREDIT_SALES {
            return;
        }
        let (mut db, path) = crate::test_support::temp_db("credit-customer");
        for (name, down) in [("محمد", 4_000), ("محمد علي", 0)] {
            let cart = testing::cart_worth(&db, &[(10_000, 6_000)]);
            sell(
                &mut db,
                1,
                &cart,
                &[],
                &pays(&[("cash", down)]),
                &on_credit(name, "01112223334"),
            )
            .unwrap();
        }
        pay(&mut db, 1, 1, &pays(&[("card", 1_000)])).unwrap();
        let customers: i64 = db
            .query_row("SELECT COUNT(*) FROM customers", [], |r| r.get(0))
            .unwrap();
        let name: String = db
            .query_row("SELECT name FROM customers", [], |r| r.get(0))
            .unwrap();
        assert_eq!((customers, name.as_str()), (1, "محمد علي"));

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let credit = summary(&db, &today, &today).unwrap();
        assert_eq!((credit.owed, credit.collected), (5_000 + 10_000, 1_000));
        assert_eq!(credit.by_method, [("card".to_string(), 1, 1_000)]);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
