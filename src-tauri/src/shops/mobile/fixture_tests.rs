//! Upgrade tests: a database written by an older release must open with the current code and keep every
//! sale, payment, phone and balance. The fixtures in `tests/fixtures/` were seeded through the old
//! release's own commands; the expected numbers below are worked out by hand from that seed scenario
//! (see `tests/fixtures/README.md`).

use crate::test_support::{int, open_fixture};

#[test]
fn mobile_0_4_0_database_keeps_its_history() {
    let (db, path) = open_fixture("mobile-0.4.0.db");

    // Sales: 30,000.00 + 29,000.00 + 18,000.00, bought for 26,000.00 + 25,000.00 + 14,000.00.
    assert_eq!(int(&db, "SELECT COUNT(*) FROM sales"), 3);
    assert_eq!(int(&db, "SELECT SUM(total) FROM sales"), 7_700_000);
    assert_eq!(int(&db, "SELECT SUM(cost_total) FROM sales"), 6_500_000);
    assert_eq!(int(&db, "SELECT SUM(change_due) FROM sales"), 50_000);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM sale_items"), 4);

    // Each method's share, change already taken off cash.
    let by_method = |m: &str| {
        int(
            &db,
            &format!("SELECT COALESCE(SUM(amount), 0) FROM sale_payments WHERE method = '{m}'"),
        )
    };
    assert_eq!(
        (by_method("cash"), by_method("card"), by_method("wallet")),
        (3_400_000, 3_800_000, 500_000)
    );
    assert_eq!(int(&db, "SELECT COUNT(*) FROM sale_payments"), 5);

    // Phones: I1, G1, R1, R2 sold; I2 taken out; G2 still in stock. R3's invoice was deleted.
    let status = |s: &str| {
        int(
            &db,
            &format!("SELECT COUNT(*) FROM phones WHERE status = '{s}'"),
        )
    };
    assert_eq!(
        (status("sold"), status("removed"), status("in_stock")),
        (4, 1, 1)
    );
    assert_eq!(
        int(&db, "SELECT COUNT(*) FROM phones WHERE serial = 'R3'"),
        0
    );
    assert_eq!(int(&db, "SELECT COUNT(*) FROM stock_movements"), 11);

    // Supplier 1: 1,000.00 opening + 50,000.00 invoice − 30,000.00 paid on it − 5,000.00 later.
    let balance = |id: i64| {
        int(
            &db,
            &format!(
                "SELECT {} FROM suppliers s WHERE s.id = {id}",
                crate::commands::suppliers::BALANCE_SQL
            ),
        )
    };
    assert_eq!((balance(1), balance(2)), (1_600_000, 0));
    assert_eq!(int(&db, "SELECT COUNT(*) FROM purchases"), 2);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM supplier_payments"), 3);

    assert_eq!(int(&db, "SELECT COUNT(*) FROM expenses"), 2);
    assert_eq!(int(&db, "SELECT SUM(amount) FROM expenses"), 215_000);
    assert_eq!(int(&db, "SELECT COUNT(*) FROM users"), 2);

    drop(db);
    let _ = std::fs::remove_file(&path);
}
