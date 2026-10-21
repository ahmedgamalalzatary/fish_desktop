use rusqlite::Connection;
use std::path::Path;

/// Schema migrations, applied in order. Each entry bumps `PRAGMA user_version` by one.
/// Never edit an existing entry once released — append a new one instead.
const MIGRATIONS: &[&str] = &[r#"
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

-- Prices are integer cents, weights are integer grams.
-- Stock is tracked per product in grams; fixed-weight variants draw from the same stock.
CREATE TABLE products (
    id               INTEGER PRIMARY KEY,
    name             TEXT NOT NULL,
    category_id      INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    sell_by_weight   INTEGER NOT NULL DEFAULT 1,
    price_per_kg     INTEGER NOT NULL DEFAULT 0,
    cost_per_kg      INTEGER NOT NULL DEFAULT 0,
    stock_grams      INTEGER NOT NULL DEFAULT 0,
    low_stock_grams  INTEGER NOT NULL DEFAULT 0,
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE product_variants (
    id           INTEGER PRIMARY KEY,
    product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    label        TEXT NOT NULL,
    weight_grams INTEGER NOT NULL,
    price        INTEGER NOT NULL,
    cost         INTEGER NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1,
    sort         INTEGER NOT NULL DEFAULT 0
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
    variant_id    INTEGER,
    product_name  TEXT NOT NULL,
    variant_label TEXT,
    quantity      INTEGER NOT NULL,
    weight_grams  INTEGER NOT NULL,
    unit_price    INTEGER NOT NULL,
    line_total    INTEGER NOT NULL,
    line_cost     INTEGER NOT NULL
);

CREATE TABLE stock_movements (
    id           INTEGER PRIMARY KEY,
    product_id   INTEGER NOT NULL REFERENCES products(id),
    change_grams INTEGER NOT NULL,
    reason       TEXT NOT NULL CHECK (reason IN ('sale', 'purchase', 'adjustment')),
    cost_total   INTEGER,
    note         TEXT,
    sale_id      INTEGER REFERENCES sales(id),
    user_id      INTEGER NOT NULL REFERENCES users(id),
    created_at   TEXT NOT NULL
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
    ('shop_name', 'محل الأسماك'),
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
"#];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    migrate(&mut conn)?;
    Ok(conn)
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", i + 1)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}
