use rusqlite::Connection;
use std::path::Path;

/// Schema migrations, applied in order. Each entry bumps `PRAGMA user_version` by one.
/// Never edit an existing entry once released — append a new one instead.
const MIGRATIONS: &[&str] = &[
    r#"
CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'cashier')),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
);

CREATE TABLE categories (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    parent_id  INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL
);

-- Prices are integer cents, quantities are whole pieces.
-- Every product has at least one variant, and stock lives on the variant. A product sold without
-- options (a charger, a cover) has a single variant with an empty label.
CREATE TABLE products (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE product_variants (
    id         INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    label      TEXT NOT NULL DEFAULT '',
    price      INTEGER NOT NULL,
    cost       INTEGER NOT NULL DEFAULT 0,
    stock      INTEGER NOT NULL DEFAULT 0,
    low_stock  INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    sort       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sales (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    created_at     TEXT NOT NULL,
    total          INTEGER NOT NULL,
    cost_total     INTEGER NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'wallet')),
    paid           INTEGER NOT NULL,
    change_due     INTEGER NOT NULL
);

-- Names and prices are snapshotted so edits to products never rewrite history.
CREATE TABLE sale_items (
    id            INTEGER PRIMARY KEY,
    sale_id       INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id    INTEGER NOT NULL REFERENCES products(id),
    variant_id    INTEGER NOT NULL REFERENCES product_variants(id),
    product_name  TEXT NOT NULL,
    variant_label TEXT,
    quantity      INTEGER NOT NULL,
    unit_price    INTEGER NOT NULL,
    line_total    INTEGER NOT NULL,
    line_cost     INTEGER NOT NULL
);

CREATE TABLE stock_movements (
    id         INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    variant_id INTEGER NOT NULL REFERENCES product_variants(id),
    change_qty INTEGER NOT NULL,
    reason     TEXT NOT NULL CHECK (reason IN ('sale', 'purchase', 'adjustment')),
    cost_total INTEGER,
    note       TEXT,
    sale_id    INTEGER REFERENCES sales(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
    ('shop_name', 'محل الموبايلات'),
    ('shop_phone', ''),
    ('shop_address', ''),
    ('receipt_footer', 'شكراً لزيارتكم'),
    ('currency', 'ج.م'),
    ('allow_negative_stock', '0');

CREATE INDEX idx_sales_created ON sales(created_at);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);
CREATE INDEX idx_movements_created ON stock_movements(created_at);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_variants_product ON product_variants(product_id);
"#,
    r#"
-- `opening_balance` is what the shop already owed the supplier when they were added.
-- A supplier's balance = opening_balance + purchases - payments.
CREATE TABLE suppliers (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    phone           TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    opening_balance INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL
);

-- One row per supplier invoice; its lines are the stock_movements that point at it.
CREATE TABLE purchases (
    id          INTEGER PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    invoice_no  TEXT NOT NULL DEFAULT '',
    total       INTEGER NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL
);

-- `purchase_id` is set when the payment was made while receiving that invoice.
CREATE TABLE supplier_payments (
    id          INTEGER PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    purchase_id INTEGER REFERENCES purchases(id),
    amount      INTEGER NOT NULL CHECK (amount > 0),
    note        TEXT NOT NULL DEFAULT '',
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL
);

ALTER TABLE stock_movements ADD COLUMN purchase_id INTEGER REFERENCES purchases(id);

CREATE INDEX idx_purchases_created ON purchases(created_at);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX idx_payments_supplier ON supplier_payments(supplier_id);
CREATE INDEX idx_movements_purchase ON stock_movements(purchase_id);
"#,
    r#"
-- Money taken out of the shop for running costs (rent, electricity, a delivery). `user_id` is who recorded it.
CREATE TABLE expenses (
    id         INTEGER PRIMARY KEY,
    amount     INTEGER NOT NULL CHECK (amount > 0),
    reason     TEXT NOT NULL CHECK (trim(reason) != ''),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);

CREATE INDEX idx_expenses_created ON expenses(created_at);

-- A sale can be paid with several methods. Each amount is what that method covered, with cash change
-- already taken off, so the amounts of a sale always add up to its total.
-- `sales.paid` stays what the customer handed over in total, so the receipt can show the change.
CREATE TABLE sales_new (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    total      INTEGER NOT NULL,
    cost_total INTEGER NOT NULL,
    paid       INTEGER NOT NULL,
    change_due INTEGER NOT NULL
);
INSERT INTO sales_new (id, user_id, created_at, total, cost_total, paid, change_due)
    SELECT id, user_id, created_at, total, cost_total, paid, change_due FROM sales;

CREATE TABLE sale_payments (
    id      INTEGER PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method  TEXT NOT NULL CHECK (method IN ('cash', 'card', 'wallet')),
    amount  INTEGER NOT NULL CHECK (amount > 0)
);
INSERT INTO sale_payments (sale_id, method, amount) SELECT id, payment_method, total FROM sales;

DROP TABLE sales;
ALTER TABLE sales_new RENAME TO sales;

CREATE INDEX idx_sales_created ON sales(created_at);
CREATE INDEX idx_sale_payments_sale ON sale_payments(sale_id);
"#,
];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    migrate(&mut conn)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

/// Foreign keys are off while migrating, so a migration can rebuild a table other tables point at
/// (with them on, dropping the old table would cascade-delete its children). Each migration is
/// checked for broken references before it commits instead.
fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        let broken: i64 =
            tx.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })?;
        if broken > 0 {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY),
                Some(format!(
                    "migration {} left {broken} broken references",
                    i + 1
                )),
            ));
        }
        tx.pragma_update(None, "user_version", i + 1)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_a_fresh_database_and_is_idempotent() {
        let path = std::env::temp_dir().join(format!("mobile-pos-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        drop(open(&path).unwrap());
        let conn = open(&path).unwrap();
        let version: usize = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len());
        let currency: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'currency'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(currency, "ج.م");
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    /// Sales recorded before split payments keep their items and get one payment row each.
    #[test]
    fn moves_old_sale_payment_methods_into_payment_rows() {
        let path = std::env::temp_dir().join(format!("mobile-pos-mig-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut conn = Connection::open(&path).unwrap();
        for sql in &MIGRATIONS[..2] {
            conn.execute_batch(sql).unwrap();
        }
        conn.pragma_update(None, "user_version", 2).unwrap();
        conn.execute_batch(
            "INSERT INTO users (id, name, username, password_hash, role, created_at) VALUES (1, 'a', 'a', 'x', 'admin', '2026-01-01 00:00:00');
             INSERT INTO categories (id, name, created_at) VALUES (1, 'c', '2026-01-01 00:00:00');
             INSERT INTO products (id, name, category_id, created_at, updated_at) VALUES (1, 'p', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
             INSERT INTO product_variants (id, product_id, price) VALUES (1, 1, 500);
             INSERT INTO sales VALUES (7, 1, '2026-01-02 10:00:00', 500, 300, 'wallet', 500, 0);
             INSERT INTO sale_items (sale_id, product_id, variant_id, product_name, quantity, unit_price, line_total, line_cost)
                 VALUES (7, 1, 1, 'p', 1, 500, 500, 300);",
        )
        .unwrap();
        migrate(&mut conn).unwrap();
        let (method, amount): (String, i64) = conn
            .query_row(
                "SELECT method, amount FROM sale_payments WHERE sale_id = 7",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((method.as_str(), amount), ("wallet", 500));
        let items: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sale_items WHERE sale_id = 7",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(items, 1);
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }
}
