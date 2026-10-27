//! Extras: what a shop sells by the piece next to its own goods — the fish shop's add-ons (salad, juice,
//! water), the mobile shop's accessories (covers, screen protectors). Every shop has them the same way:
//! a main category with sub categories under it, items with a price and a cost, and a piece count that
//! each item keeps or not (`track_stock`: water bottles are counted, a salad made in the shop is not).
//! They go on the same sale and the same supplier invoice as the shop's own lines.

use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

/// The tables, appended once to each shop's migrations. Never edit it once released.
pub const MIGRATION: &str = r#"
-- A main category (parent_id NULL) or a sub category directly under one.
CREATE TABLE extra_categories (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL CHECK (trim(name) != ''),
    parent_id  INTEGER REFERENCES extra_categories(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL
);

-- Money is integer cents, stock whole pieces. Stock moves only when `track_stock` is 1.
CREATE TABLE extras (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL CHECK (trim(name) != ''),
    category_id   INTEGER NOT NULL REFERENCES extra_categories(id) ON DELETE RESTRICT,
    price         INTEGER NOT NULL CHECK (price > 0),
    cost          INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
    track_stock   INTEGER NOT NULL DEFAULT 1,
    stock_qty     INTEGER NOT NULL DEFAULT 0,
    low_stock_qty INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

-- Extras on a sale, copied at the time of sale so editing an item never rewrites history.
CREATE TABLE sale_extras (
    id         INTEGER PRIMARY KEY,
    sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    extra_id   INTEGER NOT NULL REFERENCES extras(id),
    name       TEXT NOT NULL,
    quantity   INTEGER NOT NULL CHECK (quantity > 0),
    unit_price INTEGER NOT NULL,
    line_total INTEGER NOT NULL,
    line_cost  INTEGER NOT NULL
);

-- Every piece of a counted item coming in or going out. A purchase line is its 'purchase' movement.
CREATE TABLE extra_movements (
    id          INTEGER PRIMARY KEY,
    extra_id    INTEGER NOT NULL REFERENCES extras(id),
    change_qty  INTEGER NOT NULL CHECK (change_qty != 0),
    reason      TEXT NOT NULL CHECK (reason IN ('opening', 'sale', 'purchase', 'adjustment')),
    cost_total  INTEGER,
    note        TEXT,
    sale_id     INTEGER REFERENCES sales(id),
    purchase_id INTEGER REFERENCES purchases(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL
);

CREATE INDEX idx_extras_category ON extras(category_id);
CREATE INDEX idx_sale_extras_sale ON sale_extras(sale_id);
CREATE INDEX idx_sale_extras_extra ON sale_extras(extra_id);
CREATE INDEX idx_extra_movements_extra ON extra_movements(extra_id);
CREATE INDEX idx_extra_movements_purchase ON extra_movements(purchase_id);
"#;

// ---------- Categories ----------

#[derive(Serialize)]
pub struct Category {
    id: i64,
    name: String,
    parent_id: Option<i64>,
    /// Active items directly in this category.
    extra_count: i64,
}

/// Only two levels: a main category, and sub categories directly under it.
fn validate_category(
    db: &Connection,
    id: Option<i64>,
    name: &str,
    parent_id: Option<i64>,
) -> AppResult<()> {
    if name.trim().is_empty() {
        return invalid("اسم التصنيف مطلوب");
    }
    let Some(parent) = parent_id else {
        return Ok(());
    };
    if Some(parent) == id {
        return invalid("لا يمكن أن يكون التصنيف تابعاً لنفسه");
    }
    let grandparent: Option<Option<i64>> = db
        .query_row(
            "SELECT parent_id FROM extra_categories WHERE id = ?1",
            [parent],
            |r| r.get(0),
        )
        .optional()?;
    match grandparent {
        None => invalid("التصنيف الرئيسي غير موجود"),
        Some(Some(_)) => invalid("لا يمكن إضافة تصنيف فرعي داخل تصنيف فرعي"),
        Some(None) => {
            let children: i64 = match id {
                Some(id) => db.query_row(
                    "SELECT COUNT(*) FROM extra_categories WHERE parent_id = ?1",
                    [id],
                    |r| r.get(0),
                )?,
                None => 0,
            };
            if children > 0 {
                return invalid("هذا التصنيف يحتوي على تصنيفات فرعية ولا يمكن نقله تحت تصنيف آخر");
            }
            Ok(())
        }
    }
}

pub fn insert_category(db: &Connection, name: &str, parent_id: Option<i64>) -> AppResult<i64> {
    validate_category(db, None, name, parent_id)?;
    db.execute(
        "INSERT INTO extra_categories (name, parent_id, created_at) VALUES (?1, ?2, ?3)",
        params![name.trim(), parent_id, now()],
    )?;
    Ok(db.last_insert_rowid())
}

fn update_category_row(
    db: &Connection,
    id: i64,
    name: &str,
    parent_id: Option<i64>,
) -> AppResult<()> {
    validate_category(db, Some(id), name, parent_id)?;
    db.execute(
        "UPDATE extra_categories SET name = ?1, parent_id = ?2 WHERE id = ?3",
        params![name.trim(), parent_id, id],
    )?;
    Ok(())
}

fn delete_category_row(db: &Connection, id: i64) -> AppResult<()> {
    let (children, items): (i64, i64) = db.query_row(
        "SELECT (SELECT COUNT(*) FROM extra_categories WHERE parent_id = ?1),
                (SELECT COUNT(*) FROM extras WHERE category_id = ?1)",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if children > 0 {
        return invalid("احذف التصنيفات الفرعية أولاً");
    }
    if items > 0 {
        return invalid("لا يمكن حذف تصنيف مرتبط بأصناف، انقل الأصناف أولاً");
    }
    db.execute("DELETE FROM extra_categories WHERE id = ?1", [id])?;
    Ok(())
}

#[tauri::command]
pub fn list_extra_categories(state: State<AppState>) -> AppResult<Vec<Category>> {
    state.user()?;
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT c.id, c.name, c.parent_id,
                (SELECT COUNT(*) FROM extras e WHERE e.category_id = c.id AND e.active = 1)
         FROM extra_categories c ORDER BY c.name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Category {
            id: r.get(0)?,
            name: r.get(1)?,
            parent_id: r.get(2)?,
            extra_count: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[tauri::command]
pub fn create_extra_category(
    state: State<AppState>,
    name: String,
    parent_id: Option<i64>,
) -> AppResult<i64> {
    state.admin()?;
    insert_category(&state.db.lock().unwrap(), &name, parent_id)
}

#[tauri::command]
pub fn update_extra_category(
    state: State<AppState>,
    id: i64,
    name: String,
    parent_id: Option<i64>,
) -> AppResult<()> {
    state.admin()?;
    update_category_row(&state.db.lock().unwrap(), id, &name, parent_id)
}

#[tauri::command]
pub fn delete_extra_category(state: State<AppState>, id: i64) -> AppResult<()> {
    state.admin()?;
    delete_category_row(&state.db.lock().unwrap(), id)
}

// ---------- Items ----------

#[derive(Serialize)]
pub struct Extra {
    id: i64,
    name: String,
    category_id: i64,
    category_name: String,
    parent_category_id: Option<i64>,
    parent_category_name: Option<String>,
    price: i64,
    /// 0 for a cashier, who does not see costs.
    cost: i64,
    track_stock: bool,
    stock_qty: i64,
    low_stock_qty: i64,
    active: bool,
}

#[derive(Deserialize)]
pub struct ExtraInput {
    pub name: String,
    pub category_id: i64,
    pub price: i64,
    pub cost: i64,
    pub track_stock: bool,
    pub low_stock_qty: i64,
}

impl ExtraInput {
    fn validate(&self, db: &Connection) -> AppResult<()> {
        if self.name.trim().is_empty() {
            return invalid("اسم الصنف مطلوب");
        }
        if self.price <= 0 {
            return invalid("سعر البيع مطلوب");
        }
        if self.cost < 0 || self.low_stock_qty < 0 {
            return invalid("القيم لا يمكن أن تكون سالبة");
        }
        let category: Option<i64> = db
            .query_row(
                "SELECT id FROM extra_categories WHERE id = ?1",
                [self.category_id],
                |r| r.get(0),
            )
            .optional()?;
        if category.is_none() {
            return invalid("اختر التصنيف");
        }
        Ok(())
    }
}

pub fn insert_extra(
    db: &Connection,
    user_id: i64,
    input: &ExtraInput,
    opening_qty: i64,
) -> AppResult<i64> {
    input.validate(db)?;
    if opening_qty < 0 || (!input.track_stock && opening_qty != 0) {
        return invalid("المخزون الافتتاحي غير صحيح");
    }
    let ts = now();
    db.execute(
        "INSERT INTO extras (name, category_id, price, cost, track_stock, stock_qty, low_stock_qty, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            input.name.trim(),
            input.category_id,
            input.price,
            input.cost,
            input.track_stock,
            opening_qty,
            input.low_stock_qty,
            ts
        ],
    )?;
    let id = db.last_insert_rowid();
    if opening_qty > 0 {
        db.execute(
            "INSERT INTO extra_movements (extra_id, change_qty, reason, user_id, created_at)
             VALUES (?1, ?2, 'opening', ?3, ?4)",
            params![id, opening_qty, user_id, ts],
        )?;
    }
    Ok(id)
}

/// An item with history is archived instead, so its sales and invoices keep their lines.
fn delete_row(db: &Connection, id: i64) -> AppResult<&'static str> {
    let history: i64 = db.query_row(
        "SELECT (SELECT COUNT(*) FROM sale_extras WHERE extra_id = ?1)
              + (SELECT COUNT(*) FROM extra_movements WHERE extra_id = ?1)",
        [id],
        |r| r.get(0),
    )?;
    if history > 0 {
        db.execute("UPDATE extras SET active = 0 WHERE id = ?1", [id])?;
        Ok("archived")
    } else {
        db.execute("DELETE FROM extras WHERE id = ?1", [id])?;
        Ok("deleted")
    }
}

/// Sets a counted item's stock to what was counted, recording the difference.
fn set_stock(
    db: &mut Connection,
    user_id: i64,
    id: i64,
    qty: i64,
    note: Option<String>,
) -> AppResult<()> {
    if qty < 0 {
        return invalid("الكمية لا يمكن أن تكون سالبة");
    }
    let tx = db.transaction()?;
    let (current, track): (i64, bool) = tx
        .query_row(
            "SELECT stock_qty, track_stock FROM extras WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or(AppError::NotFound("الصنف"))?;
    if !track {
        return invalid("هذا الصنف لا يُعدّ مخزونه");
    }
    if qty == current {
        return Ok(());
    }
    tx.execute(
        "INSERT INTO extra_movements (extra_id, change_qty, reason, note, user_id, created_at)
         VALUES (?1, ?2, 'adjustment', ?3, ?4, ?5)",
        params![
            id,
            qty - current,
            note.filter(|n| !n.trim().is_empty()),
            user_id,
            now()
        ],
    )?;
    tx.execute(
        "UPDATE extras SET stock_qty = ?1 WHERE id = ?2",
        params![qty, id],
    )?;
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn list_extras(state: State<AppState>, include_archived: bool) -> AppResult<Vec<Extra>> {
    let user = state.user()?;
    let hide_cost = !user.is_admin();
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT e.id, e.name, e.category_id, c.name, pc.id, pc.name, e.price, e.cost, e.track_stock,
                e.stock_qty, e.low_stock_qty, e.active
         FROM extras e
         JOIN extra_categories c ON c.id = e.category_id
         LEFT JOIN extra_categories pc ON pc.id = c.parent_id
         WHERE ?1 OR e.active = 1
         ORDER BY e.name",
    )?;
    let rows = stmt.query_map([include_archived && !hide_cost], |r| {
        Ok(Extra {
            id: r.get(0)?,
            name: r.get(1)?,
            category_id: r.get(2)?,
            category_name: r.get(3)?,
            parent_category_id: r.get(4)?,
            parent_category_name: r.get(5)?,
            price: r.get(6)?,
            cost: if hide_cost { 0 } else { r.get(7)? },
            track_stock: r.get(8)?,
            stock_qty: r.get(9)?,
            low_stock_qty: r.get(10)?,
            active: r.get(11)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[tauri::command]
pub fn create_extra(state: State<AppState>, input: ExtraInput, opening_qty: i64) -> AppResult<i64> {
    let user = state.admin()?;
    insert_extra(&state.db.lock().unwrap(), user.id, &input, opening_qty)
}

/// Stock changes only by selling, buying and counting; turning counting off keeps the last count.
#[tauri::command]
pub fn update_extra(state: State<AppState>, id: i64, input: ExtraInput) -> AppResult<()> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    input.validate(&db)?;
    let changed = db.execute(
        "UPDATE extras SET name = ?1, category_id = ?2, price = ?3, cost = ?4, track_stock = ?5,
                low_stock_qty = ?6, updated_at = ?7
         WHERE id = ?8",
        params![
            input.name.trim(),
            input.category_id,
            input.price,
            input.cost,
            input.track_stock,
            input.low_stock_qty,
            now(),
            id
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("الصنف"));
    }
    Ok(())
}

#[tauri::command]
pub fn delete_extra(state: State<AppState>, id: i64) -> AppResult<&'static str> {
    state.admin()?;
    delete_row(&state.db.lock().unwrap(), id)
}

#[tauri::command]
pub fn restore_extra(state: State<AppState>, id: i64) -> AppResult<()> {
    state.admin()?;
    state
        .db
        .lock()
        .unwrap()
        .execute("UPDATE extras SET active = 1 WHERE id = ?1", [id])?;
    Ok(())
}

#[tauri::command]
pub fn adjust_extra_stock(
    state: State<AppState>,
    id: i64,
    qty: i64,
    note: Option<String>,
) -> AppResult<()> {
    let user = state.admin()?;
    set_stock(&mut state.db.lock().unwrap(), user.id, id, qty, note)
}

// ---------- Sales ----------

/// Pieces of an item in the cart.
#[derive(Deserialize)]
pub struct ExtraLine {
    pub extra_id: i64,
    pub quantity: i64,
}

/// An extra as sold, copied at the time of sale.
#[derive(Serialize)]
pub struct SaleExtra {
    name: String,
    pub(crate) quantity: i64,
    unit_price: i64,
    pub(crate) line_total: i64,
}

struct PricedLine {
    extra_id: i64,
    name: String,
    quantity: i64,
    unit_price: i64,
    line_total: i64,
    line_cost: i64,
}

/// The extras checked and priced from the database, never from the client.
pub struct Priced {
    pub total: i64,
    pub cost: i64,
    lines: Vec<PricedLine>,
    /// Pieces taken out of each counted item.
    needed: HashMap<i64, i64>,
}

/// Refuses to sell more counted pieces than are in stock, unless the shop allows going below zero
/// (`allow_negative_stock`, a fish shop setting).
pub fn price(tx: &Connection, lines: &[ExtraLine]) -> AppResult<Priced> {
    let mut priced = Vec::with_capacity(lines.len());
    let mut needed: HashMap<i64, i64> = HashMap::new();
    for l in lines {
        if l.quantity <= 0 {
            return invalid("الكمية يجب أن تكون أكبر من صفر");
        }
        let (name, price, cost, track): (String, i64, i64, bool) = tx
            .query_row(
                "SELECT name, price, cost, track_stock FROM extras WHERE id = ?1 AND active = 1",
                [l.extra_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?
            .ok_or(AppError::NotFound("الصنف"))?;
        if track {
            *needed.entry(l.extra_id).or_default() += l.quantity;
        }
        priced.push(PricedLine {
            extra_id: l.extra_id,
            name,
            quantity: l.quantity,
            unit_price: price,
            line_total: price * l.quantity,
            line_cost: cost * l.quantity,
        });
    }
    let allow_negative = tx
        .query_row(
            "SELECT value FROM settings WHERE key = 'allow_negative_stock'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .is_some_and(|v| v == "1");
    if !allow_negative {
        for (id, qty) in &needed {
            let (name, stock): (String, i64) = tx.query_row(
                "SELECT name, stock_qty FROM extras WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            if stock < *qty {
                return invalid(format!(
                    "المخزون غير كافٍ من «{name}»: المتوفر {stock} والمطلوب {qty}"
                ));
            }
        }
    }
    Ok(Priced {
        total: priced.iter().map(|l| l.line_total).sum(),
        cost: priced.iter().map(|l| l.line_cost).sum(),
        lines: priced,
        needed,
    })
}

/// Writes the sale's extras and takes counted pieces out of stock, one movement per item.
pub fn record(
    tx: &Connection,
    sale_id: i64,
    user_id: i64,
    ts: &str,
    priced: &Priced,
) -> AppResult<()> {
    for l in &priced.lines {
        tx.execute(
            "INSERT INTO sale_extras (sale_id, extra_id, name, quantity, unit_price, line_total, line_cost)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![sale_id, l.extra_id, l.name, l.quantity, l.unit_price, l.line_total, l.line_cost],
        )?;
    }
    for (id, qty) in &priced.needed {
        tx.execute(
            "UPDATE extras SET stock_qty = stock_qty - ?1 WHERE id = ?2",
            params![qty, id],
        )?;
        tx.execute(
            "INSERT INTO extra_movements (extra_id, change_qty, reason, sale_id, user_id, created_at)
             VALUES (?1, ?2, 'sale', ?3, ?4, ?5)",
            params![id, -qty, sale_id, user_id, ts],
        )?;
    }
    Ok(())
}

pub fn load_sale_extras(db: &Connection, sale_id: i64) -> AppResult<Vec<SaleExtra>> {
    let mut stmt = db.prepare(
        "SELECT name, quantity, unit_price, line_total FROM sale_extras WHERE sale_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map([sale_id], |r| {
        Ok(SaleExtra {
            name: r.get(0)?,
            quantity: r.get(1)?,
            unit_price: r.get(2)?,
            line_total: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

// ---------- Purchases ----------

/// Pieces of a counted item on a supplier invoice, and what they cost in all.
#[derive(Deserialize)]
pub struct ExtraPurchaseLine {
    pub extra_id: i64,
    pub quantity: i64,
    pub cost_total: i64,
}

#[derive(Serialize)]
pub struct PurchaseExtra {
    name: String,
    pub(crate) quantity: i64,
    cost_total: i64,
}

/// Lines with extras on an invoice, for the purchases list (`p` is the purchase).
pub const ITEMS_COUNT_SQL: &str =
    "(SELECT COUNT(*) FROM extra_movements em WHERE em.purchase_id = p.id)";

pub fn purchase_total(lines: &[ExtraPurchaseLine]) -> AppResult<i64> {
    if lines.iter().any(|l| l.quantity <= 0 || l.cost_total < 0) {
        return invalid("أدخل عدداً وتكلفة صحيحين لكل صنف");
    }
    Ok(lines.iter().map(|l| l.cost_total).sum())
}

/// Adds the pieces to stock. The item's cost becomes this invoice's price per piece, so profit
/// follows what the shop pays now.
pub fn record_purchase(
    tx: &Connection,
    purchase_id: i64,
    user_id: i64,
    ts: &str,
    lines: &[ExtraPurchaseLine],
) -> AppResult<()> {
    for l in lines {
        let track: bool = tx
            .query_row(
                "SELECT track_stock FROM extras WHERE id = ?1",
                [l.extra_id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(AppError::NotFound("الصنف"))?;
        if !track {
            return invalid("لا يمكن شراء صنف لا يُعدّ مخزونه؛ فعّل عدّ المخزون له أولاً");
        }
        tx.execute(
            "INSERT INTO extra_movements (extra_id, change_qty, reason, cost_total, purchase_id, user_id, created_at)
             VALUES (?1, ?2, 'purchase', ?3, ?4, ?5, ?6)",
            params![l.extra_id, l.quantity, l.cost_total, purchase_id, user_id, ts],
        )?;
        tx.execute(
            "UPDATE extras SET stock_qty = stock_qty + ?1, cost = ?2 WHERE id = ?3",
            params![
                l.quantity,
                (l.cost_total + l.quantity / 2) / l.quantity,
                l.extra_id
            ],
        )?;
    }
    Ok(())
}

pub fn load_purchase_extras(db: &Connection, purchase_id: i64) -> AppResult<Vec<PurchaseExtra>> {
    let mut stmt = db.prepare(
        "SELECT e.name, m.change_qty, COALESCE(m.cost_total, 0)
         FROM extra_movements m JOIN extras e ON e.id = m.extra_id
         WHERE m.purchase_id = ?1 ORDER BY m.id",
    )?;
    let rows = stmt.query_map([purchase_id], |r| {
        Ok(PurchaseExtra {
            name: r.get(0)?,
            quantity: r.get(1)?,
            cost_total: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Takes an invoice's pieces back out of stock, refusing when some were sold since (the count would
/// go below zero). Costs the invoice set are left as they are.
pub fn remove_purchase(tx: &Connection, purchase_id: i64) -> AppResult<()> {
    let short: Option<String> = tx
        .query_row(
            "SELECT e.name FROM extra_movements m JOIN extras e ON e.id = m.extra_id
             WHERE m.purchase_id = ?1 GROUP BY e.id HAVING e.stock_qty < SUM(m.change_qty) LIMIT 1",
            [purchase_id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(name) = short {
        return invalid(format!(
            "لا يمكن حذف الفاتورة: بِيعت قطع من «{name}» بعد استلامها، صحّح المخزون بالجرد بدلاً من ذلك"
        ));
    }
    tx.execute(
        "UPDATE extras SET stock_qty = stock_qty - (
             SELECT SUM(m.change_qty) FROM extra_movements m WHERE m.purchase_id = ?1 AND m.extra_id = extras.id)
         WHERE id IN (SELECT extra_id FROM extra_movements WHERE purchase_id = ?1)",
        [purchase_id],
    )?;
    tx.execute(
        "DELETE FROM extra_movements WHERE purchase_id = ?1",
        [purchase_id],
    )?;
    Ok(())
}

// ---------- Report ----------

#[derive(Serialize)]
pub struct ReportRow {
    extra_id: i64,
    name: String,
    category_name: String,
    parent_name: Option<String>,
    sold: i64,
    revenue: i64,
    cost: i64,
    profit: i64,
    bought: i64,
    bought_cost: i64,
}

/// Per item over the period: what sold, and what came in on invoices.
fn report(db: &Connection, from: &str, to: &str) -> AppResult<Vec<ReportRow>> {
    let mut stmt = db.prepare(
        "SELECT e.id, e.name, c.name, pc.name,
                COALESCE(s.sold, 0), COALESCE(s.revenue, 0), COALESCE(s.cost, 0),
                COALESCE(b.bought, 0), COALESCE(b.bought_cost, 0)
         FROM extras e
         JOIN extra_categories c ON c.id = e.category_id
         LEFT JOIN extra_categories pc ON pc.id = c.parent_id
         LEFT JOIN (
             SELECT i.extra_id, SUM(i.quantity) sold, SUM(i.line_total) revenue, SUM(i.line_cost) cost
             FROM sale_extras i JOIN sales sa ON sa.id = i.sale_id
             WHERE date(sa.created_at) BETWEEN ?1 AND ?2 GROUP BY i.extra_id
         ) s ON s.extra_id = e.id
         LEFT JOIN (
             SELECT m.extra_id, SUM(m.change_qty) bought, SUM(m.cost_total) bought_cost
             FROM extra_movements m
             WHERE m.reason = 'purchase' AND date(m.created_at) BETWEEN ?1 AND ?2 GROUP BY m.extra_id
         ) b ON b.extra_id = e.id
         WHERE s.extra_id IS NOT NULL OR b.extra_id IS NOT NULL
         ORDER BY COALESCE(s.revenue, 0) DESC, e.name",
    )?;
    let rows = stmt.query_map([from, to], |r| {
        let (revenue, cost): (i64, i64) = (r.get(5)?, r.get(6)?);
        Ok(ReportRow {
            extra_id: r.get(0)?,
            name: r.get(1)?,
            category_name: r.get(2)?,
            parent_name: r.get(3)?,
            sold: r.get(4)?,
            revenue,
            cost,
            profit: revenue - cost,
            bought: r.get(7)?,
            bought_cost: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[tauri::command]
pub fn report_extras(
    state: State<AppState>,
    from: String,
    to: String,
) -> AppResult<Vec<ReportRow>> {
    state.admin()?;
    report(&state.db.lock().unwrap(), &from, &to)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::purchases::{PurchaseInput, insert_purchase, remove_purchase};
    use crate::commands::sales::{PaymentInput, insert_sale};
    use crate::shop::testing;
    use crate::test_support::{int, temp_db};

    fn cash(amount: i64) -> Vec<PaymentInput> {
        serde_json::from_value(serde_json::json!([{ "method": "cash", "amount": amount }])).unwrap()
    }

    fn item(category_id: i64, price: i64, cost: i64, track_stock: bool) -> ExtraInput {
        ExtraInput {
            name: "عصير".into(),
            category_id,
            price,
            cost,
            track_stock,
            low_stock_qty: 0,
        }
    }

    fn line(extra_id: i64, quantity: i64) -> ExtraLine {
        ExtraLine { extra_id, quantity }
    }

    fn invoice(db: &Connection, extras: Vec<ExtraPurchaseLine>) -> PurchaseInput {
        db.execute(
            "INSERT OR IGNORE INTO suppliers (id, name, created_at) VALUES (1, 'مورد', '2026-01-01 00:00:00')",
            [],
        )
        .unwrap();
        PurchaseInput {
            supplier_id: 1,
            invoice_no: String::new(),
            note: String::new(),
            paid: 0,
            items: testing::lines_costing(db, &[]),
            extras,
        }
    }

    fn buy(extra_id: i64, quantity: i64, cost_total: i64) -> ExtraPurchaseLine {
        ExtraPurchaseLine {
            extra_id,
            quantity,
            cost_total,
        }
    }

    fn stock(db: &Connection, id: i64) -> i64 {
        int(db, &format!("SELECT stock_qty FROM extras WHERE id = {id}"))
    }

    #[test]
    fn classification_is_a_main_category_and_sub_categories_under_it() {
        let (db, path) = temp_db("extras-categories");
        let drinks = insert_category(&db, "مشروبات", None).unwrap();
        let juice = insert_category(&db, "عصير", Some(drinks)).unwrap();
        assert!(
            insert_category(&db, "برتقال", Some(juice)).is_err(),
            "no third level"
        );
        assert!(insert_category(&db, " ", None).is_err());
        assert!(update_category_row(&db, drinks, "مشروبات", Some(juice)).is_err());

        insert_extra(&db, 1, &item(juice, 1_500, 900, true), 0).unwrap();
        assert!(
            delete_category_row(&db, drinks).is_err(),
            "has a sub category"
        );
        assert!(delete_category_row(&db, juice).is_err(), "has an item");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_sale_mixes_the_shop_s_lines_with_extras_on_one_receipt() {
        let (mut db, path) = temp_db("extras-sale");
        let main = insert_category(&db, "إضافات", None).unwrap();
        let counted = insert_extra(&db, 1, &item(main, 1_500, 900, true), 10).unwrap();
        let made_here = insert_extra(&db, 1, &item(main, 2_000, 500, false), 0).unwrap();
        let cart = testing::cart_worth(&db, &[(10_000, 7_000)]);

        let extras = [line(counted, 2), line(made_here, 1)];
        let id = insert_sale(&mut db, 1, &cart, &extras, &cash(15_000)).unwrap();
        assert_eq!(
            int(
                &db,
                &format!("SELECT total * 1000000 + cost_total FROM sales WHERE id = {id}")
            ),
            (10_000 + 3_000 + 2_000) * 1_000_000 + 7_000 + 1_800 + 500
        );
        assert_eq!((stock(&db, counted), stock(&db, made_here)), (8, 0));
        assert_eq!(
            int(
                &db,
                "SELECT SUM(change_qty) FROM extra_movements WHERE reason = 'sale'"
            ),
            -2
        );
        let lines = load_sale_extras(&db, id).unwrap();
        assert_eq!(
            lines
                .iter()
                .map(|l| (l.quantity, l.line_total))
                .collect::<Vec<_>>(),
            [(2, 3_000), (1, 2_000)]
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn extras_alone_are_a_sale_but_nothing_at_all_is_not() {
        let (mut db, path) = temp_db("extras-only");
        let main = insert_category(&db, "إضافات", None).unwrap();
        let salad = insert_extra(&db, 1, &item(main, 2_000, 500, false), 0).unwrap();
        insert_sale(&mut db, 1, &Vec::new(), &[line(salad, 3)], &cash(6_000)).unwrap();
        assert!(insert_sale(&mut db, 1, &Vec::new(), &[], &cash(0)).is_err());
        assert!(insert_sale(&mut db, 1, &Vec::new(), &[line(salad, 0)], &cash(0)).is_err());
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn counted_pieces_cannot_be_oversold_and_a_refused_sale_saves_nothing() {
        let (mut db, path) = temp_db("extras-oversold");
        let main = insert_category(&db, "إضافات", None).unwrap();
        let water = insert_extra(&db, 1, &item(main, 500, 300, true), 2).unwrap();
        let cart = testing::cart_worth(&db, &[(10_000, 7_000)]);
        let units = testing::stock_units(&db);
        assert!(
            insert_sale(
                &mut db,
                1,
                &cart,
                &[line(water, 1), line(water, 2)],
                &cash(20_000)
            )
            .is_err()
        );
        assert_eq!(int(&db, "SELECT COUNT(*) FROM sales"), 0);
        assert_eq!((stock(&db, water), testing::stock_units(&db)), (2, units));
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_purchase_adds_counted_pieces_at_their_new_cost_and_can_be_undone_until_they_sell() {
        let (mut db, path) = temp_db("extras-purchase");
        let main = insert_category(&db, "جرابات", None).unwrap();
        let cover = insert_extra(&db, 1, &item(main, 5_000, 2_000, true), 1).unwrap();
        let made_here = insert_extra(&db, 1, &item(main, 2_000, 500, false), 0).unwrap();
        let input = invoice(&db, vec![buy(cover, 4, 10_000)]);
        let id = insert_purchase(&mut db, 1, &input).unwrap();
        assert_eq!(stock(&db, cover), 5);
        assert_eq!(
            int(&db, &format!("SELECT cost FROM extras WHERE id = {cover}")),
            2_500
        );
        assert_eq!(
            int(&db, &format!("SELECT total FROM purchases WHERE id = {id}")),
            10_000
        );
        assert_eq!(load_purchase_extras(&db, id).unwrap()[0].quantity, 4);

        remove_purchase(&mut db, id).unwrap();
        assert_eq!(stock(&db, cover), 1);

        let input = invoice(&db, vec![buy(cover, 4, 10_000)]);
        let id = insert_purchase(&mut db, 1, &input).unwrap();
        insert_sale(&mut db, 1, &Vec::new(), &[line(cover, 5)], &cash(25_000)).unwrap();
        assert!(
            remove_purchase(&mut db, id).is_err(),
            "its pieces were sold"
        );
        assert_eq!(stock(&db, cover), 0);

        let input = invoice(&db, vec![buy(made_here, 1, 100)]);
        assert!(insert_purchase(&mut db, 1, &input).is_err());
        let input = invoice(&db, vec![]);
        assert!(
            insert_purchase(&mut db, 1, &input).is_err(),
            "an empty invoice"
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn counting_stock_records_the_difference_and_history_archives_instead_of_deleting() {
        let (mut db, path) = temp_db("extras-count");
        let main = insert_category(&db, "إضافات", None).unwrap();
        let water = insert_extra(&db, 1, &item(main, 500, 300, true), 10).unwrap();
        let unused = insert_extra(&db, 1, &item(main, 500, 300, true), 0).unwrap();
        set_stock(&mut db, 1, water, 7, Some("تالف".into())).unwrap();
        assert_eq!(stock(&db, water), 7);
        assert_eq!(
            int(
                &db,
                "SELECT change_qty FROM extra_movements WHERE reason = 'adjustment'"
            ),
            -3
        );
        assert!(set_stock(&mut db, 1, water, -1, None).is_err());

        assert_eq!(delete_row(&db, water).unwrap(), "archived");
        assert_eq!(delete_row(&db, unused).unwrap(), "deleted");
        assert_eq!(int(&db, "SELECT COUNT(*) FROM extras"), 1);
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn the_report_shows_what_each_item_sold_and_what_was_bought() {
        let (mut db, path) = temp_db("extras-report");
        let drinks = insert_category(&db, "مشروبات", None).unwrap();
        let juice = insert_category(&db, "عصير", Some(drinks)).unwrap();
        let orange = insert_extra(&db, 1, &item(juice, 1_500, 900, true), 0).unwrap();
        let input = invoice(&db, vec![buy(orange, 10, 8_000)]);
        insert_purchase(&mut db, 1, &input).unwrap();
        insert_sale(&mut db, 1, &Vec::new(), &[line(orange, 3)], &cash(4_500)).unwrap();

        let rows = report(&db, "2000-01-01", "2999-12-31").unwrap();
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(
            (r.category_name.as_str(), r.parent_name.as_deref()),
            ("عصير", Some("مشروبات"))
        );
        // Sold at the cost the invoice set: 80.00 / 10 = 8.00 a piece.
        assert_eq!(
            (r.sold, r.revenue, r.cost, r.profit, r.bought, r.bought_cost),
            (3, 4_500, 2_400, 2_100, 10, 8_000)
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
