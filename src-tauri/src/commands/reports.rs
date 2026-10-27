use super::suppliers::BALANCE_SQL;
use crate::error::{AppResult, invalid};
use crate::shop::reports::{MOVEMENT_UNITS, UNITS_SOLD};
use crate::state::AppState;
use rusqlite::{Connection, Params, Row};
use serde::Serialize;
use std::collections::BTreeMap;
use tauri::State;

// All date ranges are inclusive local dates in `YYYY-MM-DD` form. Units (pieces, grams…) are counted the
// shop's way: `UNITS_SOLD` for a sale line `i`, `MOVEMENT_UNITS` for a stock movement `m`.

pub(crate) fn query<T, P: Params>(
    db: &Connection,
    sql: &str,
    params: P,
    f: impl FnMut(&Row) -> rusqlite::Result<T>,
) -> AppResult<Vec<T>> {
    let mut stmt = db.prepare(sql)?;
    let rows = stmt.query_map(params, f)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[derive(Serialize)]
pub struct PaymentTotal {
    method: String,
    count: i64,
    total: i64,
}

#[derive(Serialize)]
pub struct Summary {
    sales_count: i64,
    revenue: i64,
    cost: i64,
    /// Revenue minus the cost of the pieces sold.
    profit: i64,
    units_sold: i64,
    expenses: i64,
    /// Profit after expenses.
    net_profit: i64,
    purchases_cost: i64,
    purchases_units: i64,
    supplier_paid: i64,
    by_payment: Vec<PaymentTotal>,
}

#[tauri::command]
pub fn report_summary(state: State<AppState>, from: String, to: String) -> AppResult<Summary> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    let (sales_count, revenue, cost): (i64, i64, i64) = db.query_row(
        "SELECT COUNT(*), COALESCE(SUM(total), 0), COALESCE(SUM(cost_total), 0)
         FROM sales WHERE date(created_at) BETWEEN ?1 AND ?2",
        [&from, &to],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let units_sold: i64 = db.query_row(
        &format!(
            "SELECT COALESCE(SUM({UNITS_SOLD}), 0) FROM sale_items i JOIN sales s ON s.id = i.sale_id
             WHERE date(s.created_at) BETWEEN ?1 AND ?2"
        ),
        [&from, &to],
        |r| r.get(0),
    )?;
    let (purchases_cost, purchases_units): (i64, i64) = db.query_row(
        &format!(
            "SELECT COALESCE(SUM(m.cost_total), 0), COALESCE(SUM({MOVEMENT_UNITS}), 0) FROM stock_movements m
             WHERE m.reason = 'purchase' AND date(m.created_at) BETWEEN ?1 AND ?2"
        ),
        [&from, &to],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let supplier_paid: i64 = db.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM supplier_payments WHERE date(created_at) BETWEEN ?1 AND ?2",
        [&from, &to],
        |r| r.get(0),
    )?;
    let expenses: i64 = db.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE date(created_at) BETWEEN ?1 AND ?2",
        [&from, &to],
        |r| r.get(0),
    )?;
    // A split sale counts once under each method it used; the amounts still add up to the revenue.
    let by_payment = query(
        &db,
        "SELECT p.method, COUNT(*), SUM(p.amount) FROM sale_payments p JOIN sales s ON s.id = p.sale_id
         WHERE date(s.created_at) BETWEEN ?1 AND ?2 GROUP BY p.method ORDER BY SUM(p.amount) DESC",
        [&from, &to],
        |r| {
            Ok(PaymentTotal {
                method: r.get(0)?,
                count: r.get(1)?,
                total: r.get(2)?,
            })
        },
    )?;
    Ok(Summary {
        sales_count,
        revenue,
        cost,
        profit: revenue - cost,
        units_sold,
        expenses,
        net_profit: revenue - cost - expenses,
        purchases_cost,
        purchases_units,
        supplier_paid,
        by_payment,
    })
}

#[derive(Serialize)]
pub struct DailyRow {
    day: String,
    sales_count: i64,
    revenue: i64,
    profit: i64,
}

#[tauri::command]
pub fn report_daily(state: State<AppState>, from: String, to: String) -> AppResult<Vec<DailyRow>> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    query(
        &db,
        "SELECT date(created_at) d, COUNT(*), SUM(total), SUM(total - cost_total) FROM sales
         WHERE date(created_at) BETWEEN ?1 AND ?2 GROUP BY d ORDER BY d",
        [&from, &to],
        |r| {
            Ok(DailyRow {
                day: r.get(0)?,
                sales_count: r.get(1)?,
                revenue: r.get(2)?,
                profit: r.get(3)?,
            })
        },
    )
}

#[derive(Serialize, Default)]
pub struct PeriodRow {
    /// `YYYY-MM-DD`, `YYYY-MM` or `YYYY`, depending on the grouping.
    period: String,
    sales_count: i64,
    units_sold: i64,
    revenue: i64,
    cost: i64,
    profit: i64,
    expenses: i64,
    net_profit: i64,
    purchases_cost: i64,
    purchases_units: i64,
}

/// Bought, sold, spent and earned per day, month or year. Periods with no activity are left out.
#[tauri::command]
pub fn report_periods(
    state: State<AppState>,
    from: String,
    to: String,
    group: String,
) -> AppResult<Vec<PeriodRow>> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    periods(&db, &from, &to, &group)
}

pub fn periods(db: &Connection, from: &str, to: &str, group: &str) -> AppResult<Vec<PeriodRow>> {
    let format = match group {
        "day" => "%Y-%m-%d",
        "month" => "%Y-%m",
        "year" => "%Y",
        _ => return invalid("تجميع غير صحيح"),
    };
    let mut rows: BTreeMap<String, PeriodRow> = BTreeMap::new();
    let mut add = |sql: &str, apply: fn(&mut PeriodRow, i64, i64)| -> AppResult<()> {
        for (period, a, b) in query(db, sql, [format, from, to], |r| {
            Ok((r.get::<_, String>(0)?, r.get(1)?, r.get(2)?))
        })? {
            let row = rows.entry(period.clone()).or_insert_with(|| PeriodRow {
                period,
                ..Default::default()
            });
            apply(row, a, b);
        }
        Ok(())
    };
    add(
        "SELECT strftime(?1, created_at) k, COUNT(*), 0 FROM sales
         WHERE date(created_at) BETWEEN ?2 AND ?3 GROUP BY k",
        |r, count, _| r.sales_count = count,
    )?;
    add(
        "SELECT strftime(?1, created_at) k, SUM(total), SUM(cost_total) FROM sales
         WHERE date(created_at) BETWEEN ?2 AND ?3 GROUP BY k",
        |r, revenue, cost| (r.revenue, r.cost) = (revenue, cost),
    )?;
    add(
        &format!(
            "SELECT strftime(?1, s.created_at) k, SUM({UNITS_SOLD}), 0
             FROM sale_items i JOIN sales s ON s.id = i.sale_id
             WHERE date(s.created_at) BETWEEN ?2 AND ?3 GROUP BY k"
        ),
        |r, units, _| r.units_sold = units,
    )?;
    add(
        "SELECT strftime(?1, created_at) k, SUM(amount), 0 FROM expenses
         WHERE date(created_at) BETWEEN ?2 AND ?3 GROUP BY k",
        |r, amount, _| r.expenses = amount,
    )?;
    add(
        &format!(
            "SELECT strftime(?1, m.created_at) k, COALESCE(SUM(m.cost_total), 0), SUM({MOVEMENT_UNITS})
             FROM stock_movements m
             WHERE m.reason = 'purchase' AND date(m.created_at) BETWEEN ?2 AND ?3 GROUP BY k"
        ),
        |r, cost, units| (r.purchases_cost, r.purchases_units) = (cost, units),
    )?;
    Ok(rows
        .into_values()
        .map(|r| PeriodRow {
            profit: r.revenue - r.cost,
            net_profit: r.revenue - r.cost - r.expenses,
            ..r
        })
        .collect())
}

#[derive(Serialize)]
pub struct PurchasedItemRow {
    product_id: i64,
    name: String,
    units: i64,
    cost: i64,
}

/// What came in from suppliers in the period, per product.
#[tauri::command]
pub fn report_purchased_items(
    state: State<AppState>,
    from: String,
    to: String,
) -> AppResult<Vec<PurchasedItemRow>> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    query(
        &db,
        &format!(
            "SELECT p.id, p.name, SUM({MOVEMENT_UNITS}), COALESCE(SUM(m.cost_total), 0)
             FROM stock_movements m
             JOIN products p ON p.id = m.product_id
             WHERE m.reason = 'purchase' AND date(m.created_at) BETWEEN ?1 AND ?2
             GROUP BY p.id ORDER BY SUM(m.cost_total) DESC"
        ),
        [&from, &to],
        |r| {
            Ok(PurchasedItemRow {
                product_id: r.get(0)?,
                name: r.get(1)?,
                units: r.get(2)?,
                cost: r.get(3)?,
            })
        },
    )
}

#[derive(Serialize)]
pub struct CashierRow {
    user_id: i64,
    name: String,
    sales_count: i64,
    revenue: i64,
    profit: i64,
    first_sale: String,
    last_sale: String,
}

#[tauri::command]
pub fn report_by_cashier(
    state: State<AppState>,
    from: String,
    to: String,
) -> AppResult<Vec<CashierRow>> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    query(
        &db,
        "SELECT u.id, u.name, COUNT(*), SUM(s.total), SUM(s.total - s.cost_total), MIN(s.created_at), MAX(s.created_at)
         FROM sales s JOIN users u ON u.id = s.user_id
         WHERE date(s.created_at) BETWEEN ?1 AND ?2
         GROUP BY u.id ORDER BY SUM(s.total) DESC",
        [&from, &to],
        |r| {
            Ok(CashierRow {
                user_id: r.get(0)?,
                name: r.get(1)?,
                sales_count: r.get(2)?,
                revenue: r.get(3)?,
                profit: r.get(4)?,
                first_sale: r.get(5)?,
                last_sale: r.get(6)?,
            })
        },
    )
}

#[derive(Serialize)]
pub struct SupplierRow {
    supplier_id: i64,
    name: String,
    purchases_count: i64,
    purchases_total: i64,
    pieces: i64,
    paid: i64,
    /// Current balance, regardless of the period.
    balance: i64,
}

/// Purchases and payments per supplier in the period. Suppliers still owed money are listed even when idle.
#[tauri::command]
pub fn report_by_supplier(
    state: State<AppState>,
    from: String,
    to: String,
) -> AppResult<Vec<SupplierRow>> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    let sql = format!(
        "SELECT * FROM (
             SELECT s.id, s.name,
                    (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id AND date(p.created_at) BETWEEN ?1 AND ?2) AS cnt,
                    COALESCE((SELECT SUM(total) FROM purchases p WHERE p.supplier_id = s.id AND date(p.created_at) BETWEEN ?1 AND ?2), 0) AS total,
                    COALESCE((SELECT SUM({MOVEMENT_UNITS}) FROM stock_movements m JOIN purchases p ON p.id = m.purchase_id
                              WHERE p.supplier_id = s.id AND date(p.created_at) BETWEEN ?1 AND ?2), 0),
                    COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id AND date(sp.created_at) BETWEEN ?1 AND ?2), 0) AS paid,
                    {BALANCE_SQL} AS balance
             FROM suppliers s
         ) WHERE cnt > 0 OR paid != 0 OR balance != 0
         ORDER BY total DESC, balance DESC"
    );
    query(&db, &sql, [&from, &to], |r| {
        Ok(SupplierRow {
            supplier_id: r.get(0)?,
            name: r.get(1)?,
            purchases_count: r.get(2)?,
            purchases_total: r.get(3)?,
            pieces: r.get(4)?,
            paid: r.get(5)?,
            balance: r.get(6)?,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::purchases::{PurchaseInput, insert_purchase};
    use crate::commands::sales::insert_sale;
    use crate::shop::testing;

    fn cash(amount: i64) -> Vec<crate::commands::sales::PaymentInput> {
        serde_json::from_value(serde_json::json!([{ "method": "cash", "amount": amount }])).unwrap()
    }

    #[test]
    fn groups_sales_expenses_and_purchases_by_month() {
        let (mut db, path) = crate::test_support::temp_db("periods");
        db.execute(
            "INSERT INTO suppliers (id, name, created_at) VALUES (1, 'مورد', '2026-01-01 00:00:00')",
            [],
        )
        .unwrap();
        // February: an invoice of two items costing 3,500 each.
        let invoice = PurchaseInput {
            supplier_id: 1,
            invoice_no: String::new(),
            note: String::new(),
            paid: 0,
            items: testing::lines_costing(&db, &[3_500, 3_500]),
        };
        insert_purchase(&mut db, 1, &invoice).unwrap();
        // March: two sales, the first of two items; April: one sale. Each item sells for 1,000, cost 700.
        for items in [2, 1, 1] {
            let cart = testing::cart_worth(&db, &vec![(1_000, 700); items]);
            insert_sale(&mut db, 1, &cart, &cash(1_000 * items as i64)).unwrap();
        }
        db.execute_batch(
            "UPDATE purchases SET created_at = '2026-02-27 09:00:00';
             UPDATE stock_movements SET created_at = '2026-02-27 09:00:00' WHERE reason = 'purchase';
             UPDATE sales SET created_at = CASE id WHEN 1 THEN '2026-03-02 10:00:00'
                                                   WHEN 2 THEN '2026-03-20 10:00:00'
                                                   ELSE '2026-04-01 10:00:00' END;
             INSERT INTO expenses (amount, reason, user_id, created_at) VALUES (250, 'r', 1, '2026-03-05 09:00:00');",
        )
        .unwrap();

        let rows = periods(&db, "2026-01-01", "2026-12-31", "month").unwrap();
        let months: Vec<_> = rows.iter().map(|r| r.period.as_str()).collect();
        assert_eq!(months, ["2026-02", "2026-03", "2026-04"]);
        let march = &rows[1];
        assert_eq!(
            (march.sales_count, march.units_sold, march.revenue),
            (2, 3 * testing::ITEM_UNITS, 3_000)
        );
        assert_eq!(
            (march.profit, march.expenses, march.net_profit),
            (900, 250, 650)
        );
        assert_eq!(
            (rows[0].purchases_units, rows[0].purchases_cost),
            (2 * testing::ITEM_UNITS, 7_000)
        );
        assert!(periods(&db, "2026-01-01", "2026-12-31", "week").is_err());
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
