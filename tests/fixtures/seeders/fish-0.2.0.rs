//! Throwaway: builds tests/fixtures/fish-0.2.0.db through fish 0.2.0's own commands.
//! Run: SEED_OUT=<path> cargo test --lib seed -- --ignored --nocapture

use crate::commands::*;
use crate::state::AppState;
use rusqlite::Connection;
use serde_json::{from_value, json};
use std::collections::HashMap;
use tauri::Manager;

fn int(db: &Connection, sql: &str) -> i64 {
    db.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
#[ignore]
fn seed() {
    let out = std::env::var("SEED_OUT").expect("SEED_OUT");
    let tmp = std::env::temp_dir().join(format!("seed-fish-{}.db", std::process::id()));
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

    // 1 أسماك ← 2 أسماك نهرية (nested), 3 مأكولات بحرية.
    categories::create_category(s(), "أسماك".into(), None).unwrap();
    categories::create_category(s(), "أسماك نهرية".into(), Some(1)).unwrap();
    categories::create_category(s(), "مأكولات بحرية".into(), None).unwrap();

    let product = |input: serde_json::Value, opening: i64| {
        products::create_product(s(), from_value(input).unwrap(), opening).unwrap()
    };
    // 1 بلطي: by weight only, 10 kg opening stock.
    product(
        json!({"name":"بلطي","category_id":2,"sell_by_weight":true,"price_per_kg":9_000,"cost_per_kg":6_000,
               "low_stock_grams":2_000,"variants":[]}),
        10_000,
    );
    // 2 جمبري: by weight and a half-kilo pack (variant 1).
    product(
        json!({"name":"جمبري","category_id":3,"sell_by_weight":true,"price_per_kg":30_000,"cost_per_kg":22_000,
               "low_stock_grams":0,"variants":[{"id":null,"label":"نصف كيلو","weight_grams":500,"price":15_500,"cost":11_000}]}),
        0,
    );
    // 3 كابوريا: fixed boxes only (variant 2).
    product(
        json!({"name":"كابوريا","category_id":3,"sell_by_weight":false,"price_per_kg":0,"cost_per_kg":0,
               "low_stock_grams":0,"variants":[{"id":null,"label":"علبة كيلو","weight_grams":1_000,"price":25_000,"cost":18_000}]}),
        0,
    );

    let supplier = |name: &str, opening: i64| {
        suppliers::create_supplier(
            s(),
            from_value(json!({"name":name,"phone":"","note":"","opening_balance":opening,"active":true})).unwrap(),
        )
        .unwrap()
    };
    supplier("مورد السمك", 50_000);
    supplier("مورد البحر", 0);
    let purchase = |supplier: i64, paid: i64, items: serde_json::Value| {
        purchases::create_purchase(
            s(),
            from_value(json!({"supplier_id":supplier,"invoice_no":"","note":"","paid":paid,"update_cost":false,"items":items}))
                .unwrap(),
        )
        .unwrap()
    };
    purchase(1, 100_000, json!([{"product_id":1,"grams":20_000,"cost_total":120_000}]));
    purchase(
        2,
        182_000,
        json!([{"product_id":2,"grams":5_000,"cost_total":110_000},{"product_id":3,"grams":4_000,"cost_total":72_000}]),
    );
    let wrong = purchase(2, 0, json!([{"product_id":2,"grams":1_000,"cost_total":22_000}]));
    purchases::delete_purchase(s(), wrong).unwrap();
    suppliers::add_supplier_payment(s(), 1, 30_000, "دفعة".into()).unwrap();
    // Stock-take: 30 kg of بلطي counted as 29.5 kg.
    stock::adjust_stock(s(), 1, 29_500, Some("تالف".into())).unwrap();

    let cart = |v: serde_json::Value| from_value(v).unwrap();
    // F1: 1.5 kg بلطي, 200.00 cash for 135.00.
    sales::create_sale(
        s(),
        cart(json!([{"product_id":1,"variant_id":null,"quantity":1,"weight_grams":1_500}])),
        "cash".into(),
        20_000,
    )
    .unwrap();

    auth::logout(s());
    auth::login(s(), "sara".into(), "1234".into()).unwrap();
    // F2: two half-kilo packs by card.
    sales::create_sale(
        s(),
        cart(json!([{"product_id":2,"variant_id":1,"quantity":2,"weight_grams":null}])),
        "card".into(),
        0,
    )
    .unwrap();

    auth::logout(s());
    auth::login(s(), "admin".into(), "admin123".into()).unwrap();
    // F3: a box of كابوريا and 750 g of جمبري by wallet.
    sales::create_sale(
        s(),
        cart(json!([
            {"product_id":3,"variant_id":2,"quantity":1,"weight_grams":null},
            {"product_id":2,"variant_id":null,"quantity":1,"weight_grams":750}
        ])),
        "wallet".into(),
        0,
    )
    .unwrap();
    // F4: four boxes with only three in stock, allowed by the setting.
    settings::update_settings(s(), HashMap::from([("allow_negative_stock".into(), "1".into())])).unwrap();
    sales::create_sale(
        s(),
        cart(json!([{"product_id":3,"variant_id":2,"quantity":4,"weight_grams":null}])),
        "cash".into(),
        100_000,
    )
    .unwrap();

    let state = s();
    let db = state.db.lock().unwrap();
    // Hand-checked against the scenario above (see tests/fixtures/README.md on the template branch).
    assert_eq!(int(&db, "SELECT COUNT(*) FROM sales"), 4);
    assert_eq!(int(&db, "SELECT SUM(total) FROM sales"), 192_000);
    assert_eq!(int(&db, "SELECT SUM(cost_total) FROM sales"), 137_500);
    assert_eq!(int(&db, "SELECT SUM(change_due) FROM sales"), 6_500);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM sale_items"), 5);
    let by_method = |m: &str| int(&db, &format!("SELECT SUM(total) FROM sales WHERE payment_method = '{m}'"));
    assert_eq!((by_method("cash"), by_method("card"), by_method("wallet")), (113_500, 31_000, 47_500));
    let stock = |id: i64| int(&db, &format!("SELECT stock_grams FROM products WHERE id = {id}"));
    assert_eq!((stock(1), stock(2), stock(3)), (28_000, 3_250, -1_000));
    let balance = |id: i64| {
        int(&db, &format!("SELECT {} FROM suppliers s WHERE s.id = {id}", suppliers::BALANCE_SQL))
    };
    assert_eq!((balance(1), balance(2)), (40_000, 0));
    assert_eq!(int(&db, "SELECT COUNT(*) FROM purchases"), 2);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM supplier_payments"), 3);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM stock_movements"), 10);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM product_variants"), 2);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM categories"), 3);

    db.execute_batch(
        "UPDATE users SET created_at = '2026-08-01 09:00:00';
         UPDATE categories SET created_at = '2026-08-01 09:00:00';
         UPDATE products SET created_at = '2026-08-01 09:00:00', updated_at = '2026-08-01 09:00:00';
         UPDATE suppliers SET created_at = '2026-08-01 09:00:00';
         UPDATE purchases SET created_at = '2026-08-01 10:00:00';
         UPDATE supplier_payments SET created_at = '2026-08-01 10:00:00' WHERE purchase_id IS NOT NULL;
         UPDATE supplier_payments SET created_at = '2026-09-01 10:00:00' WHERE purchase_id IS NULL;
         UPDATE stock_movements SET created_at = '2026-08-01 10:00:00' WHERE reason = 'purchase' OR note = 'مخزون افتتاحي';
         UPDATE stock_movements SET created_at = '2026-08-02 08:00:00' WHERE note = 'تالف';
         UPDATE sales SET created_at = CASE id WHEN 1 THEN '2026-08-10 11:00:00'
                                               WHEN 2 THEN '2026-09-05 12:30:00'
                                               WHEN 3 THEN '2026-09-20 13:00:00'
                                               ELSE '2026-10-02 18:15:00' END;
         UPDATE stock_movements SET created_at = (SELECT created_at FROM sales WHERE id = sale_id) WHERE reason = 'sale';",
    )
    .unwrap();
    let _ = std::fs::remove_file(&out);
    db.execute("VACUUM INTO ?1", [&out]).unwrap();
}
