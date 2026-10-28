//! The fish shop's database. Each entry bumps `PRAGMA user_version` by one.
//! Never edit an existing entry once released — append a new one instead.
//! 1–2 are release 0.2.0's, byte for byte, so installed shops upgrade from where they are.

pub const MIGRATIONS: &[&str] = &[
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
    // 3. A sale can be paid with several methods. `payment_method` moves to `sale_payments`, one row per
    //    old sale for its whole total (cash change was already taken off it). A sale with a zero total had
    //    nothing paid, so it gets no payment row. `sales.paid` stays what was handed over in total.
    r#"
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
INSERT INTO sale_payments (sale_id, method, amount)
    SELECT id, payment_method, total FROM sales WHERE total > 0 ORDER BY id;

DROP TABLE sales;
ALTER TABLE sales_new RENAME TO sales;

CREATE INDEX idx_sales_created ON sales(created_at);
CREATE INDEX idx_sale_payments_sale ON sale_payments(sale_id);
"#,
    // 4. Money taken out of the shop for running costs (rent, electricity). `user_id` is who recorded it.
    r#"
CREATE TABLE expenses (
    id         INTEGER PRIMARY KEY,
    amount     INTEGER NOT NULL CHECK (amount > 0),
    reason     TEXT NOT NULL CHECK (trim(reason) != ''),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);

CREATE INDEX idx_expenses_created ON expenses(created_at);
"#,
    // 5. Weights and prices are in grams. A price per gram is kept in thousandths of a cent, so the old
    //    prices per kilo (in cents) are already the same numbers: 90.00 a kilo is 0.09 a gram, nothing rounds.
    //    Sale lines sold by weight keep their unit price the same way.
    r#"
ALTER TABLE products RENAME COLUMN price_per_kg TO price_per_gram;
ALTER TABLE products RENAME COLUMN cost_per_kg TO cost_per_gram;
"#,
    // 6. Add-ons (salad, juice, water…), sold by the piece on the same sale.
    crate::commands::extras::MIGRATION,
    // 7. A discount on the whole sale.
    crate::commands::sales::DISCOUNT_MIGRATION,
];
