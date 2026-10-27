//! Throwaway: builds tests/fixtures/mobile-0.4.0.db through mobile 0.4.0's own commands.
//! Run: SEED_OUT=<path> cargo test --lib seed -- --ignored --nocapture

use crate::commands::*;
use crate::state::AppState;
use serde_json::{from_value, json};
use tauri::Manager;

#[test]
#[ignore]
fn seed() {
    let out = std::env::var("SEED_OUT").expect("SEED_OUT");
    let tmp = std::env::temp_dir().join(format!("seed-mobile-{}.db", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    app.manage(AppState::new(crate::db::open(&tmp).unwrap()));
    let s = || app.state::<AppState>();

    auth::setup_admin(s(), "أحمد".into(), "admin".into(), "admin123".into()).unwrap();
    users::create_user(
        s(),
        from_value(json!({"name":"سارة","username":"sara","role":"cashier","active":true,"password":"1234"})).unwrap(),
    )
    .unwrap();

    for name in ["iPhone 15", "Samsung Galaxy S24", "Redmi Note 13"] {
        products::create_product(s(), name.into()).unwrap();
    }
    let supplier = |name: &str, opening: i64| {
        suppliers::create_supplier(
            s(),
            from_value(json!({"name":name,"phone":"","note":"","opening_balance":opening,"active":true})).unwrap(),
        )
        .unwrap()
    };
    assert_eq!(supplier("مورد الأجهزة", 100_000), 1);
    assert_eq!(supplier("مورد شاومي", 0), 2);

    let phone = |serial: &str, storage: &str, color: &str, battery: Option<i64>, price: i64, cost: i64| {
        json!({"serial":serial,"storage":storage,"color":color,"battery":battery,"price":price,"cost":cost})
    };
    // I1 = 1, I2 = 2: added without an invoice.
    phones::add_phones(
        s(),
        1,
        from_value(json!([
            phone("I1", "128GB", "أسود", Some(100), 3_000_000, 2_600_000),
            phone("I2", "256GB", "أبيض", Some(88), 3_200_000, 2_800_000)
        ]))
        .unwrap(),
    )
    .unwrap();
    let purchase = |supplier: i64, paid: i64, items: serde_json::Value| {
        purchases::create_purchase(
            s(),
            from_value(json!({"supplier_id":supplier,"invoice_no":"","note":"","paid":paid,"items":items})).unwrap(),
        )
        .unwrap()
    };
    let line = |product: i64, p: serde_json::Value| {
        let mut p = p;
        p["product_id"] = json!(product);
        p
    };
    // G1 = 3, G2 = 4: partly paid. R1 = 5, R2 = 6: fully paid. R3 = 7: invoice deleted.
    purchase(
        1,
        3_000_000,
        json!([
            line(2, phone("G1", "256GB", "رمادي", None, 2_900_000, 2_500_000)),
            line(2, phone("G2", "256GB", "أسود", None, 2_900_000, 2_500_000))
        ]),
    );
    purchase(
        2,
        1_400_000,
        json!([
            line(3, phone("R1", "128GB", "أزرق", None, 900_000, 700_000)),
            line(3, phone("R2", "128GB", "أسود", None, 900_000, 700_000))
        ]),
    );
    let wrong = purchase(2, 0, json!([line(3, phone("R3", "128GB", "أخضر", None, 900_000, 700_000))]));
    purchases::delete_purchase(s(), wrong).unwrap();
    suppliers::add_supplier_payment(s(), 1, 500_000, "دفعة".into()).unwrap();

    let pay = |v: serde_json::Value| from_value(v).unwrap();
    // M1: cash, 30,500.00 handed over for 30,000.00.
    sales::create_sale(s(), vec![1], pay(json!([{"method":"cash","amount":3_050_000}]))).unwrap();
    phones::remove_phone(s(), 2, "شاشة مكسورة".into()).unwrap();
    expenses::create_expense(s(), 200_000, "إيجار".into()).unwrap();

    auth::logout(s());
    auth::login(s(), "sara".into(), "1234".into()).unwrap();
    // M2: card + wallet + cash, exact.
    sales::create_sale(
        s(),
        vec![3],
        pay(json!([
            {"method":"card","amount":2_000_000},
            {"method":"wallet","amount":500_000},
            {"method":"cash","amount":400_000}
        ])),
    )
    .unwrap();
    expenses::create_expense(s(), 15_000, "كهرباء".into()).unwrap();

    auth::logout(s());
    auth::login(s(), "admin".into(), "admin123".into()).unwrap();
    // M3: two phones by card.
    sales::create_sale(s(), vec![5, 6], pay(json!([{"method":"card","amount":1_800_000}]))).unwrap();

    // Spread the history over three months so day/month reports have something to group.
    let state = s();
    let db = state.db.lock().unwrap();
    db.execute_batch(
        "UPDATE users SET created_at = '2026-08-01 09:00:00';
         UPDATE products SET created_at = '2026-08-01 09:00:00', updated_at = '2026-08-01 09:00:00';
         UPDATE suppliers SET created_at = '2026-08-01 09:00:00';
         UPDATE phones SET created_at = '2026-08-01 10:00:00';
         UPDATE purchases SET created_at = '2026-08-01 10:00:00';
         UPDATE supplier_payments SET created_at = '2026-08-01 10:00:00' WHERE purchase_id IS NOT NULL;
         UPDATE supplier_payments SET created_at = '2026-09-01 10:00:00' WHERE purchase_id IS NULL;
         UPDATE stock_movements SET created_at = '2026-08-01 10:00:00' WHERE reason IN ('added', 'purchase');
         UPDATE stock_movements SET created_at = '2026-09-15 16:00:00' WHERE reason = 'removed';
         UPDATE sales SET created_at = CASE id WHEN 1 THEN '2026-08-10 11:00:00'
                                               WHEN 2 THEN '2026-09-05 12:30:00'
                                               ELSE '2026-10-02 18:15:00' END;
         UPDATE stock_movements SET created_at = (SELECT created_at FROM sales WHERE id = sale_id) WHERE reason = 'sale';
         UPDATE expenses SET created_at = CASE user_id WHEN 1 THEN '2026-08-31 20:00:00' ELSE '2026-09-30 20:00:00' END;",
    )
    .unwrap();
    let _ = std::fs::remove_file(&out);
    db.execute("VACUUM INTO ?1", [&out]).unwrap();
}
