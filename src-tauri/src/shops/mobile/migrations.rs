//! The mobile shop's database. Each entry bumps `PRAGMA user_version` by one.
//! Never edit an existing entry once released — append a new one instead.
//! (The phone-per-serial version started over with a new database file, `phones.db`.)

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

-- A phone model, named the way the shop says it: "Samsung Galaxy S24 Ultra".
CREATE TABLE products (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE suppliers (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    phone           TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    -- What the shop already owed the supplier when they were added.
    -- A supplier's balance = opening_balance + purchases - payments.
    opening_balance INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL
);

-- One row per supplier invoice; its lines are the phones that point at it.
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

-- One row per physical phone: stock is the number of phones still 'in_stock'.
-- Money is integer cents. A serial is unique among the phones in stock only, so a phone that was
-- sold can come back later (a trade-in) as a new row.
CREATE TABLE phones (
    id          INTEGER PRIMARY KEY,
    product_id  INTEGER NOT NULL REFERENCES products(id),
    serial      TEXT NOT NULL CHECK (trim(serial) != ''),
    storage     TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT '',
    battery     INTEGER CHECK (battery BETWEEN 1 AND 100),
    price       INTEGER NOT NULL CHECK (price > 0),
    cost        INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
    status      TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold', 'removed')),
    purchase_id INTEGER REFERENCES purchases(id),
    created_at  TEXT NOT NULL
);

CREATE TABLE sales (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    total      INTEGER NOT NULL,
    cost_total INTEGER NOT NULL,
    -- Everything the customer handed over, cash change included.
    paid       INTEGER NOT NULL,
    change_due INTEGER NOT NULL
);

-- A sale can be paid with several methods. Each amount is what that method covered, with cash change
-- already taken off, so the amounts of a sale always add up to its total.
CREATE TABLE sale_payments (
    id      INTEGER PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method  TEXT NOT NULL CHECK (method IN ('cash', 'card', 'wallet')),
    amount  INTEGER NOT NULL CHECK (amount > 0)
);

-- One line per phone sold. Its details are snapshotted so editing a model never rewrites history.
CREATE TABLE sale_items (
    id           INTEGER PRIMARY KEY,
    sale_id      INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    phone_id     INTEGER NOT NULL REFERENCES phones(id),
    product_id   INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    serial       TEXT NOT NULL,
    storage      TEXT NOT NULL,
    color        TEXT NOT NULL,
    battery      INTEGER,
    price        INTEGER NOT NULL,
    cost         INTEGER NOT NULL
);

-- Every phone coming in or going out: +1 when added or bought, -1 when sold or removed.
CREATE TABLE stock_movements (
    id          INTEGER PRIMARY KEY,
    phone_id    INTEGER NOT NULL REFERENCES phones(id),
    product_id  INTEGER NOT NULL REFERENCES products(id),
    change_qty  INTEGER NOT NULL CHECK (change_qty IN (-1, 1)),
    reason      TEXT NOT NULL CHECK (reason IN ('added', 'purchase', 'sale', 'removed')),
    cost_total  INTEGER,
    note        TEXT,
    sale_id     INTEGER REFERENCES sales(id),
    purchase_id INTEGER REFERENCES purchases(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL
);

-- Money taken out of the shop for running costs (rent, electricity). `user_id` is who recorded it.
CREATE TABLE expenses (
    id         INTEGER PRIMARY KEY,
    amount     INTEGER NOT NULL CHECK (amount > 0),
    reason     TEXT NOT NULL CHECK (trim(reason) != ''),
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
    ('currency', 'ج.م');

CREATE UNIQUE INDEX idx_phones_serial_in_stock ON phones(serial COLLATE NOCASE) WHERE status = 'in_stock';
CREATE INDEX idx_phones_product ON phones(product_id, status);
CREATE INDEX idx_phones_purchase ON phones(purchase_id);
CREATE INDEX idx_sales_created ON sales(created_at);
CREATE INDEX idx_sale_payments_sale ON sale_payments(sale_id);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);
CREATE INDEX idx_movements_created ON stock_movements(created_at);
CREATE INDEX idx_movements_purchase ON stock_movements(purchase_id);
CREATE INDEX idx_purchases_created ON purchases(created_at);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX idx_payments_supplier ON supplier_payments(supplier_id);
CREATE INDEX idx_expenses_created ON expenses(created_at);
"#,
    // 2. Accessories (covers, screen protectors…), sold by the piece on the same sale.
    crate::commands::extras::MIGRATION,
    // 3. A discount on the whole sale.
    crate::commands::sales::DISCOUNT_MIGRATION,
    // 4. Selling on credit: customers, and payments after the day of sale.
    crate::commands::credit::MIGRATION,
];
