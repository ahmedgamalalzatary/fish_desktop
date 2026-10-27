use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::shop::sales as shop;
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

#[derive(Serialize)]
pub struct Sale {
    id: i64,
    created_at: String,
    cashier_name: String,
    total: i64,
    payments: Vec<Payment>,
    paid: i64,
    change_due: i64,
    /// The shop's lines, as printed on the receipt.
    items: Vec<shop::SaleItem>,
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
    items: shop::Cart,
    payments: Vec<PaymentInput>,
) -> AppResult<Sale> {
    let user = state.user()?;
    let mut db = state.db.lock().unwrap();
    let sale_id = insert_sale(&mut db, user.id, &items, &payments)?;
    load_sale(&db, sale_id)
}

/// Records a sale: the shop prices the cart from the database (never from the client) and writes its
/// lines and stock changes; the payments are checked and stored here. All or nothing.
pub fn insert_sale(
    db: &mut Connection,
    user_id: i64,
    cart: &shop::Cart,
    payments: &[PaymentInput],
) -> AppResult<i64> {
    let tx = db.transaction()?;
    let priced = shop::price(&tx, cart)?;
    let (covered, paid) = settle(priced.total, payments)?;
    let ts = now();
    tx.execute(
        "INSERT INTO sales (user_id, created_at, total, cost_total, paid, change_due)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            user_id,
            ts,
            priced.total,
            priced.cost,
            paid,
            paid - priced.total
        ],
    )?;
    let sale_id = tx.last_insert_rowid();
    for (method, amount) in covered {
        tx.execute(
            "INSERT INTO sale_payments (sale_id, method, amount) VALUES (?1, ?2, ?3)",
            params![sale_id, method, amount],
        )?;
    }
    shop::record(&tx, sale_id, user_id, &ts, &priced)?;
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
    sale.items = shop::load_items(db, id)?;
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
    use crate::shop::testing;

    fn pay(method: &str, amount: i64) -> PaymentInput {
        PaymentInput {
            method: method.into(),
            amount,
        }
    }

    #[test]
    fn splits_a_sale_over_several_methods_with_cash_change() {
        let (mut db, path) = crate::test_support::temp_db("sale-split");
        // 30,000 due: 15,000 by card, 5,000 by wallet and 12,000 cash handed over.
        let cart = testing::cart_worth(&db, &[(3_000_000, 2_700_000)]);
        let payments = [
            pay("card", 1_500_000),
            pay("wallet", 500_000),
            pay("cash", 1_200_000),
        ];
        let id = insert_sale(&mut db, 1, &cart, &payments).unwrap();
        let sale = load_sale(&db, id).unwrap();
        assert_eq!(
            (sale.total, sale.paid, sale.change_due),
            (3_000_000, 3_200_000, 200_000)
        );
        let covered: Vec<_> = sale
            .payments
            .iter()
            .map(|p| (p.method.as_str(), p.amount))
            .collect();
        assert_eq!(
            covered,
            [
                ("cash", 1_000_000),
                ("card", 1_500_000),
                ("wallet", 500_000)
            ]
        );
        let cost: i64 = db
            .query_row("SELECT cost_total FROM sales WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(cost, 2_700_000);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_short_payment_saves_nothing() {
        let (mut db, path) = crate::test_support::temp_db("sale-short");
        let cart = testing::cart_worth(&db, &[(1_000, 600)]);
        let stock = testing::stock_units(&db);
        assert!(insert_sale(&mut db, 1, &cart, &[pay("cash", 999)]).is_err());
        let sales: i64 = db
            .query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
            .unwrap();
        assert_eq!((sales, testing::stock_units(&db)), (0, stock));
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
