//! Upgrade test: a database written by fish 0.2.0 must open with the current code and keep every sale,
//! payment, gram of stock and balance. The fixture in `tests/fixtures/` was seeded through 0.2.0's own
//! commands; the expected numbers below are worked out by hand from that scenario
//! (see `tests/fixtures/README.md`).

use crate::test_support::{int, open_fixture};

#[test]
fn fish_0_2_0_database_keeps_its_history() {
    let (db, path) = open_fixture("fish-0.2.0.db");
    assert_eq!(int(&db, "PRAGMA user_version"), 4);

    // Sales: 135.00 + 310.00 + 475.00 + 1,000.00, bought for 90.00 + 220.00 + 345.00 + 720.00.
    assert_eq!(int(&db, "SELECT COUNT(*) FROM sales"), 4);
    assert_eq!(int(&db, "SELECT SUM(total) FROM sales"), 192_000);
    assert_eq!(int(&db, "SELECT SUM(cost_total) FROM sales"), 137_500);
    assert_eq!(int(&db, "SELECT SUM(change_due) FROM sales"), 6_500);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM sale_items"), 5);

    // Each old sale became one payment for its whole total, by the method it was paid with.
    let by_method = |m: &str| {
        int(
            &db,
            &format!("SELECT COALESCE(SUM(amount), 0) FROM sale_payments WHERE method = '{m}'"),
        )
    };
    assert_eq!(
        (by_method("cash"), by_method("card"), by_method("wallet")),
        (113_500, 31_000, 47_500)
    );
    assert_eq!(
        int(
            &db,
            "SELECT COUNT(*) FROM sales s
             WHERE s.total != (SELECT COALESCE(SUM(amount), 0) FROM sale_payments p WHERE p.sale_id = s.id)"
        ),
        0
    );

    // Stock in grams: بلطي, جمبري, and كابوريا sold below zero.
    let stock = |id: i64| {
        int(
            &db,
            &format!("SELECT stock_grams FROM products WHERE id = {id}"),
        )
    };
    assert_eq!((stock(1), stock(2), stock(3)), (28_000, 3_250, -1_000));

    // Supplier 1: 500.00 opening + 1,200.00 invoice − 1,000.00 paid on it − 300.00 later.
    let balance = |id: i64| {
        int(
            &db,
            &format!(
                "SELECT {} FROM suppliers s WHERE s.id = {id}",
                crate::commands::suppliers::BALANCE_SQL
            ),
        )
    };
    assert_eq!((balance(1), balance(2)), (40_000, 0));
    assert_eq!(int(&db, "SELECT COUNT(*) FROM purchases"), 2);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM supplier_payments"), 3);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM stock_movements"), 10);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM product_variants"), 2);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM categories"), 3);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM expenses"), 0);
    let negative: String = db
        .query_row(
            "SELECT value FROM settings WHERE key = 'allow_negative_stock'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(negative, "1");

    drop(db);
    let _ = std::fs::remove_file(&path);
}
