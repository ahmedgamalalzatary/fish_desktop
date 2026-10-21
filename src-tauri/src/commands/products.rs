use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Serialize, Deserialize, Clone)]
pub struct Variant {
    /// None for a variant created in this request.
    id: Option<i64>,
    label: String,
    weight_grams: i64,
    price: i64,
    cost: i64,
}

#[derive(Serialize)]
pub struct Product {
    id: i64,
    name: String,
    category_id: i64,
    category_name: String,
    parent_category_id: Option<i64>,
    parent_category_name: Option<String>,
    sell_by_weight: bool,
    price_per_kg: i64,
    cost_per_kg: i64,
    stock_grams: i64,
    low_stock_grams: i64,
    active: bool,
    variants: Vec<Variant>,
}

#[derive(Deserialize)]
pub struct ProductInput {
    name: String,
    category_id: i64,
    sell_by_weight: bool,
    price_per_kg: i64,
    cost_per_kg: i64,
    low_stock_grams: i64,
    variants: Vec<Variant>,
}

impl ProductInput {
    fn validate(&self) -> AppResult<()> {
        if self.name.trim().is_empty() {
            return invalid("اسم المنتج مطلوب");
        }
        if !self.sell_by_weight && self.variants.is_empty() {
            return invalid("أضف وزناً واحداً على الأقل أو فعّل البيع بالكيلو");
        }
        if self.sell_by_weight && self.price_per_kg <= 0 {
            return invalid("سعر بيع الكيلو مطلوب عند تفعيل البيع بالكيلو");
        }
        if self.price_per_kg < 0 || self.cost_per_kg < 0 || self.low_stock_grams < 0 {
            return invalid("القيم لا يمكن أن تكون سالبة");
        }
        for v in &self.variants {
            if v.label.trim().is_empty() || v.weight_grams <= 0 || v.price <= 0 || v.cost < 0 {
                return invalid("كل وزن يحتاج اسماً ووزناً وسعر بيع صحيحاً");
            }
        }
        Ok(())
    }
}

pub fn load_products(db: &Connection, include_inactive: bool, hide_cost: bool) -> AppResult<Vec<Product>> {
    let mut variants: HashMap<i64, Vec<Variant>> = HashMap::new();
    let mut stmt = db.prepare(
        "SELECT product_id, id, label, weight_grams, price, cost FROM product_variants
         WHERE active = 1 ORDER BY sort, weight_grams",
    )?;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        variants.entry(r.get(0)?).or_default().push(Variant {
            id: Some(r.get(1)?),
            label: r.get(2)?,
            weight_grams: r.get(3)?,
            price: r.get(4)?,
            cost: if hide_cost { 0 } else { r.get(5)? },
        });
    }

    let mut stmt = db.prepare(
        "SELECT p.id, p.name, p.category_id, c.name, c.parent_id, pc.name, p.sell_by_weight,
                p.price_per_kg, p.cost_per_kg, p.stock_grams, p.low_stock_grams, p.active
         FROM products p
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN categories pc ON pc.id = c.parent_id
         WHERE p.active = 1 OR ?1
         ORDER BY p.name",
    )?;
    let products = stmt.query_map([include_inactive], |r| {
        let id: i64 = r.get(0)?;
        Ok(Product {
            id,
            name: r.get(1)?,
            category_id: r.get(2)?,
            category_name: r.get(3)?,
            parent_category_id: r.get(4)?,
            parent_category_name: r.get(5)?,
            sell_by_weight: r.get(6)?,
            price_per_kg: r.get(7)?,
            cost_per_kg: if hide_cost { 0 } else { r.get(8)? },
            stock_grams: r.get(9)?,
            low_stock_grams: r.get(10)?,
            active: r.get(11)?,
            variants: variants.remove(&id).unwrap_or_default(),
        })
    })?;
    Ok(products.collect::<Result<_, _>>()?)
}

/// Cashiers can list products to sell them, but never see buy prices.
#[tauri::command]
pub fn list_products(state: State<AppState>, include_inactive: bool) -> AppResult<Vec<Product>> {
    let user = state.user()?;
    let db = state.db.lock().unwrap();
    load_products(&db, include_inactive && user.is_admin(), !user.is_admin())
}

fn save_variants(tx: &Connection, product_id: i64, variants: &[Variant]) -> AppResult<()> {
    // Variants that disappeared from the form are deactivated, not deleted: past sales reference them.
    let keep: Vec<i64> = variants.iter().filter_map(|v| v.id).collect();
    let mut stmt = tx.prepare("SELECT id FROM product_variants WHERE product_id = ?1 AND active = 1")?;
    let existing: Vec<i64> = stmt.query_map([product_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    for id in existing.iter().filter(|id| !keep.contains(id)) {
        tx.execute("UPDATE product_variants SET active = 0 WHERE id = ?1", [id])?;
    }
    for (sort, v) in variants.iter().enumerate() {
        match v.id {
            Some(id) if existing.contains(&id) => {
                tx.execute(
                    "UPDATE product_variants SET label = ?1, weight_grams = ?2, price = ?3, cost = ?4, sort = ?5
                     WHERE id = ?6",
                    params![v.label.trim(), v.weight_grams, v.price, v.cost, sort as i64, id],
                )?;
            }
            _ => {
                tx.execute(
                    "INSERT INTO product_variants (product_id, label, weight_grams, price, cost, sort)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![product_id, v.label.trim(), v.weight_grams, v.price, v.cost, sort as i64],
                )?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn create_product(state: State<AppState>, input: ProductInput) -> AppResult<i64> {
    state.admin()?;
    input.validate()?;
    let mut db = state.db.lock().unwrap();
    let tx = db.transaction()?;
    let ts = now();
    tx.execute(
        "INSERT INTO products (name, category_id, sell_by_weight, price_per_kg, cost_per_kg, low_stock_grams, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![input.name.trim(), input.category_id, input.sell_by_weight, input.price_per_kg, input.cost_per_kg, input.low_stock_grams, ts],
    )?;
    let id = tx.last_insert_rowid();
    save_variants(&tx, id, &input.variants)?;
    tx.commit()?;
    Ok(id)
}

#[tauri::command]
pub fn update_product(state: State<AppState>, id: i64, input: ProductInput) -> AppResult<()> {
    state.admin()?;
    input.validate()?;
    let mut db = state.db.lock().unwrap();
    let tx = db.transaction()?;
    let changed = tx.execute(
        "UPDATE products SET name = ?1, category_id = ?2, sell_by_weight = ?3, price_per_kg = ?4, cost_per_kg = ?5,
                low_stock_grams = ?6, updated_at = ?7 WHERE id = ?8",
        params![input.name.trim(), input.category_id, input.sell_by_weight, input.price_per_kg, input.cost_per_kg, input.low_stock_grams, now(), id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("المنتج"));
    }
    save_variants(&tx, id, &input.variants)?;
    tx.commit()?;
    Ok(())
}

/// Products with sales or stock history are archived; untouched ones are deleted.
#[tauri::command]
pub fn delete_product(state: State<AppState>, id: i64) -> AppResult<&'static str> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    let history: i64 = db.query_row(
        "SELECT (SELECT COUNT(*) FROM sale_items WHERE product_id = ?1) + (SELECT COUNT(*) FROM stock_movements WHERE product_id = ?1)",
        [id],
        |r| r.get(0),
    )?;
    if history > 0 {
        db.execute("UPDATE products SET active = 0 WHERE id = ?1", [id])?;
        Ok("archived")
    } else {
        db.execute("DELETE FROM products WHERE id = ?1", [id])?;
        Ok("deleted")
    }
}

#[tauri::command]
pub fn restore_product(state: State<AppState>, id: i64) -> AppResult<()> {
    state.admin()?;
    state.db.lock().unwrap().execute("UPDATE products SET active = 1 WHERE id = ?1", [id])?;
    Ok(())
}
