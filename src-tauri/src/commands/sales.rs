use super::extras::{self, ExtraLine, SaleExtra};
use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::shop::sales as shop;
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

/// The discount columns, added to every shop's `sales` table by its migration list. `total` is what is
/// due after the discount; the lines keep their full prices, so the subtotal is `total + discount`.
pub const DISCOUNT_MIGRATION: &str = r#"
ALTER TABLE sales ADD COLUMN discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0);
-- How the cashier gave it: 'fixed' (`discount_value` in cents) or 'percent' (`discount_value` 1–100).
ALTER TABLE sales ADD COLUMN discount_type TEXT CHECK (discount_type IN ('fixed', 'percent'));
ALTER TABLE sales ADD COLUMN discount_value INTEGER;
"#;

/// A discount on the whole sale: `value` is cents for "fixed", a whole percent for "percent".
#[derive(Deserialize, Clone)]
pub struct DiscountInput {
    kind: String,
    value: i64,
}

/// How a sale is made, besides its lines and payments.
#[derive(Default)]
pub struct Terms {
    pub discount: Option<DiscountInput>,
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
pub struct Sale {
    id: i64,
    created_at: String,
    cashier_name: String,
    /// What the lines add up to, before the discount.
    subtotal: i64,
    discount: i64,
    discount_type: Option<String>,
    discount_value: Option<i64>,
    /// What was due: the subtotal less the discount.
    total: i64,
    payments: Vec<Payment>,
    paid: i64,
    change_due: i64,
    /// The shop's lines, as printed on the receipt.
    items: Vec<shop::SaleItem>,
    /// Add-ons or accessories sold with them.
    extras: Vec<SaleExtra>,
}

#[derive(Serialize)]
pub struct SaleSummary {
    id: i64,
    created_at: String,
    cashier_name: String,
    total: i64,
    discount: i64,
    methods: Vec<String>,
    items_count: i64,
}

#[tauri::command]
pub fn create_sale(
    state: State<AppState>,
    items: shop::Cart,
    extras: Vec<ExtraLine>,
    payments: Vec<PaymentInput>,
    discount: Option<DiscountInput>,
) -> AppResult<Sale> {
    let user = state.user()?;
    let mut db = state.db.lock().unwrap();
    let sale_id = sell(
        &mut db,
        user.id,
        &items,
        &extras,
        &payments,
        &Terms { discount },
    )?;
    load_sale(&db, sale_id)
}

/// A sale with no discount.
#[cfg(test)]
pub fn insert_sale(
    db: &mut Connection,
    user_id: i64,
    cart: &shop::Cart,
    extra_lines: &[ExtraLine],
    payments: &[PaymentInput],
) -> AppResult<i64> {
    sell(db, user_id, cart, extra_lines, payments, &Terms::default())
}

/// Records a sale: the shop prices its cart from the database (never from the client) and writes its
/// lines and stock changes, the extras the same way; the discount and payments are checked and stored
/// here. All or nothing.
pub fn sell(
    db: &mut Connection,
    user_id: i64,
    cart: &shop::Cart,
    extra_lines: &[ExtraLine],
    payments: &[PaymentInput],
    terms: &Terms,
) -> AppResult<i64> {
    if cart.is_empty() && extra_lines.is_empty() {
        return invalid("السلة فارغة");
    }
    let tx = db.transaction()?;
    let priced = shop::price(&tx, cart)?;
    let added = extras::price(&tx, extra_lines)?;
    let (subtotal, cost) = (priced.total + added.total, priced.cost + added.cost);
    let discount = terms
        .discount
        .as_ref()
        .map(|d| discount_of(subtotal, d))
        .transpose()?;
    let total = subtotal - discount.unwrap_or(0);
    let (covered, paid) = settle(total, payments)?;
    let ts = now();
    tx.execute(
        "INSERT INTO sales (user_id, created_at, total, cost_total, paid, change_due, discount, discount_type, discount_value)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            user_id,
            ts,
            total,
            cost,
            paid,
            paid - total,
            discount.unwrap_or(0),
            terms.discount.as_ref().map(|d| &d.kind),
            terms.discount.as_ref().map(|d| d.value),
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
    extras::record(&tx, sale_id, user_id, &ts, &added)?;
    tx.commit()?;
    Ok(sale_id)
}

/// What a discount takes off `subtotal`: a fixed amount up to the whole of it, or a whole percent of it
/// rounded to the nearest cent.
fn discount_of(subtotal: i64, d: &DiscountInput) -> AppResult<i64> {
    match d.kind.as_str() {
        "fixed" if d.value > 0 && d.value <= subtotal => Ok(d.value),
        "fixed" => invalid("الخصم يجب أن يكون أكبر من صفر ولا يزيد عن إجمالي الفاتورة"),
        "percent" if (1..=100).contains(&d.value) => Ok((subtotal * d.value + 50) / 100),
        "percent" => invalid("نسبة الخصم يجب أن تكون من 1 إلى 100"),
        _ => invalid("نوع خصم غير صحيح"),
    }
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
            "SELECT s.id, s.created_at, u.name, s.total, s.paid, s.change_due,
                    s.discount, s.discount_type, s.discount_value
             FROM sales s JOIN users u ON u.id = s.user_id WHERE s.id = ?1",
            [id],
            |r| {
                Ok(Sale {
                    id: r.get(0)?,
                    created_at: r.get(1)?,
                    cashier_name: r.get(2)?,
                    subtotal: r.get::<_, i64>(3)? + r.get::<_, i64>(6)?,
                    discount: r.get(6)?,
                    discount_type: r.get(7)?,
                    discount_value: r.get(8)?,
                    total: r.get(3)?,
                    payments: vec![],
                    paid: r.get(4)?,
                    change_due: r.get(5)?,
                    items: vec![],
                    extras: vec![],
                })
            },
        )
        .optional()?
        .ok_or(AppError::NotFound("الفاتورة"))?;
    sale.items = shop::load_items(db, id)?;
    sale.extras = extras::load_sale_extras(db, id)?;
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
        "SELECT s.id, s.created_at, u.name, s.total, s.discount,
                (SELECT GROUP_CONCAT(method) FROM sale_payments p WHERE p.sale_id = s.id),
                (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id)
                    + (SELECT COUNT(*) FROM sale_extras x WHERE x.sale_id = s.id)
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
            discount: r.get(4)?,
            methods: r
                .get::<_, Option<String>>(5)?
                .map(|m| m.split(',').map(String::from).collect())
                .unwrap_or_default(),
            items_count: r.get(6)?,
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
        let id = insert_sale(&mut db, 1, &cart, &[], &payments).unwrap();
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

    fn discount(kind: &str, value: i64) -> Terms {
        Terms {
            discount: Some(DiscountInput {
                kind: kind.into(),
                value,
            }),
        }
    }

    #[test]
    fn a_discount_lowers_what_is_due_and_is_kept_with_the_sale() {
        let (mut db, path) = crate::test_support::temp_db("sale-discount");
        // 1,000.00 less 10%: 900.00 due, paid with exactly that.
        let cart = testing::cart_worth(&db, &[(100_000, 60_000)]);
        let id = sell(
            &mut db,
            1,
            &cart,
            &[],
            &[pay("cash", 90_000)],
            &discount("percent", 10),
        )
        .unwrap();
        let sale = load_sale(&db, id).unwrap();
        assert_eq!(
            (sale.subtotal, sale.discount, sale.total, sale.change_due),
            (100_000, 10_000, 90_000, 0)
        );
        assert_eq!(
            (sale.discount_type.as_deref(), sale.discount_value),
            (Some("percent"), Some(10))
        );
        assert_eq!(sale.payments[0].amount, 90_000);

        // 50.00 off the next one; paying the full price would leave 50.00 change.
        let cart = testing::cart_worth(&db, &[(100_000, 60_000)]);
        let id = sell(
            &mut db,
            1,
            &cart,
            &[],
            &[pay("cash", 100_000)],
            &discount("fixed", 5_000),
        )
        .unwrap();
        let sale = load_sale(&db, id).unwrap();
        assert_eq!(
            (sale.discount, sale.total, sale.change_due),
            (5_000, 95_000, 5_000)
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_discount_never_passes_the_subtotal_and_rounds_to_the_cent() {
        let pct = |v| DiscountInput {
            kind: "percent".into(),
            value: v,
        };
        let fixed = |v| DiscountInput {
            kind: "fixed".into(),
            value: v,
        };
        assert_eq!(discount_of(999, &pct(10)).unwrap(), 100);
        assert_eq!(discount_of(994, &pct(10)).unwrap(), 99);
        assert_eq!(discount_of(1000, &pct(100)).unwrap(), 1000);
        assert_eq!(discount_of(1000, &fixed(1000)).unwrap(), 1000);
        assert!(discount_of(1000, &fixed(1001)).is_err());
        assert!(discount_of(1000, &fixed(0)).is_err());
        assert!(discount_of(1000, &pct(0)).is_err());
        assert!(discount_of(1000, &pct(101)).is_err());
        let other = DiscountInput {
            kind: "coupon".into(),
            value: 5,
        };
        assert!(discount_of(1000, &other).is_err());
    }

    #[test]
    fn a_short_payment_saves_nothing() {
        let (mut db, path) = crate::test_support::temp_db("sale-short");
        let cart = testing::cart_worth(&db, &[(1_000, 600)]);
        let stock = testing::stock_units(&db);
        assert!(insert_sale(&mut db, 1, &cart, &[], &[pay("cash", 999)]).is_err());
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
