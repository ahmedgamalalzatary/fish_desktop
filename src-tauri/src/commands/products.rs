use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Serialize)]
pub struct Variant {
    id: i64,
    /// Empty for a product sold without options.
    label: String,
    price: i64,
    cost: i64,
    stock: i64,
    low_stock: i64,
}

#[derive(Serialize)]
pub struct Product {
    id: i64,
    name: String,
    category_id: i64,
    category_name: String,
    parent_category_id: Option<i64>,
    parent_category_name: Option<String>,
    active: bool,
    variants: Vec<Variant>,
}

#[derive(Deserialize)]
pub struct VariantInput {
    /// None for a variant created in this request.
    id: Option<i64>,
    label: String,
    price: i64,
    cost: i64,
    low_stock: i64,
    /// Pieces on hand when the variant is created. Ignored for existing variants.
    #[serde(default)]
    opening_stock: i64,
}

#[derive(Deserialize)]
pub struct ProductInput {
    name: String,
    category_id: i64,
    variants: Vec<VariantInput>,
}

impl ProductInput {
    fn validate(&self) -> AppResult<()> {
        if self.name.trim().is_empty() {
            return invalid("اسم المنتج مطلوب");
        }
        if self.variants.is_empty() {
            return invalid("أضف سعر البيع");
        }
        let many = self.variants.len() > 1;
        let mut labels = Vec::new();
        for v in &self.variants {
            let label = v.label.trim();
            if many && label.is_empty() {
                return invalid("كل نوع يحتاج اسماً (مثل 128GB أسود)");
            }
            if labels.contains(&label) {
                return invalid(format!("النوع «{label}» مكرر"));
            }
            labels.push(label);
            if v.price <= 0 {
                return invalid("سعر البيع مطلوب لكل نوع");
            }
            if v.cost < 0 || v.low_stock < 0 || v.opening_stock < 0 {
                return invalid("القيم لا يمكن أن تكون سالبة");
            }
        }
        Ok(())
    }
}

pub fn load_products(
    db: &Connection,
    include_inactive: bool,
    hide_cost: bool,
) -> AppResult<Vec<Product>> {
    let mut variants: HashMap<i64, Vec<Variant>> = HashMap::new();
    let mut stmt = db.prepare(
        "SELECT product_id, id, label, price, cost, stock, low_stock FROM product_variants
         WHERE active = 1 ORDER BY sort, id",
    )?;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        variants.entry(r.get(0)?).or_default().push(Variant {
            id: r.get(1)?,
            label: r.get(2)?,
            price: r.get(3)?,
            cost: if hide_cost { 0 } else { r.get(4)? },
            stock: r.get(5)?,
            low_stock: r.get(6)?,
        });
    }

    let mut stmt = db.prepare(
        "SELECT p.id, p.name, p.category_id, c.name, c.parent_id, pc.name, p.active
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
            active: r.get(6)?,
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

fn save_variants(
    tx: &Connection,
    product_id: i64,
    variants: &[VariantInput],
    user_id: i64,
) -> AppResult<()> {
    // Variants that disappeared from the form are deactivated, not deleted: past sales reference them.
    let keep: Vec<i64> = variants.iter().filter_map(|v| v.id).collect();
    let mut stmt = tx.prepare(
        "SELECT id, label, stock FROM product_variants WHERE product_id = ?1 AND active = 1",
    )?;
    let existing: Vec<(i64, String, i64)> = stmt
        .query_map([product_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    for (id, label, stock) in existing.iter().filter(|(id, ..)| !keep.contains(id)) {
        if *stock != 0 {
            let name = if label.is_empty() {
                "المنتج"
            } else {
                label
            };
            return invalid(format!(
                "لا يمكن حذف «{name}» وعليه مخزون {stock} قطعة. صفّر مخزونه بالجرد أولاً"
            ));
        }
        tx.execute("UPDATE product_variants SET active = 0 WHERE id = ?1", [id])?;
    }
    let ts = now();
    for (sort, v) in variants.iter().enumerate() {
        match v.id {
            Some(id) if existing.iter().any(|(e, ..)| *e == id) => {
                tx.execute(
                    "UPDATE product_variants SET label = ?1, price = ?2, cost = ?3, low_stock = ?4, sort = ?5
                     WHERE id = ?6",
                    params![v.label.trim(), v.price, v.cost, v.low_stock, sort as i64, id],
                )?;
            }
            _ => {
                tx.execute(
                    "INSERT INTO product_variants (product_id, label, price, cost, stock, low_stock, sort)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![product_id, v.label.trim(), v.price, v.cost, v.opening_stock, v.low_stock, sort as i64],
                )?;
                if v.opening_stock > 0 {
                    tx.execute(
                        "INSERT INTO stock_movements (product_id, variant_id, change_qty, reason, note, user_id, created_at)
                         VALUES (?1, ?2, ?3, 'adjustment', 'مخزون افتتاحي', ?4, ?5)",
                        params![product_id, tx.last_insert_rowid(), v.opening_stock, user_id, ts],
                    )?;
                }
            }
        }
    }
    Ok(())
}

/// Saves the product and its opening stock together, so a failure never leaves one without the other.
#[tauri::command]
pub fn create_product(state: State<AppState>, input: ProductInput) -> AppResult<i64> {
    let user = state.admin()?;
    let mut db = state.db.lock().unwrap();
    insert_product(&mut db, user.id, &input)
}

pub fn insert_product(db: &mut Connection, user_id: i64, input: &ProductInput) -> AppResult<i64> {
    input.validate()?;
    let tx = db.transaction()?;
    let ts = now();
    tx.execute(
        "INSERT INTO products (name, category_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![input.name.trim(), input.category_id, ts],
    )?;
    let id = tx.last_insert_rowid();
    save_variants(&tx, id, &input.variants, user_id)?;
    tx.commit()?;
    Ok(id)
}

#[tauri::command]
pub fn update_product(state: State<AppState>, id: i64, input: ProductInput) -> AppResult<()> {
    let user = state.admin()?;
    let mut db = state.db.lock().unwrap();
    edit_product(&mut db, user.id, id, &input)
}

pub fn edit_product(
    db: &mut Connection,
    user_id: i64,
    id: i64,
    input: &ProductInput,
) -> AppResult<()> {
    input.validate()?;
    let tx = db.transaction()?;
    let changed = tx.execute(
        "UPDATE products SET name = ?1, category_id = ?2, updated_at = ?3 WHERE id = ?4",
        params![input.name.trim(), input.category_id, now(), id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("المنتج"));
    }
    save_variants(&tx, id, &input.variants, user_id)?;
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
    state
        .db
        .lock()
        .unwrap()
        .execute("UPDATE products SET active = 1 WHERE id = ?1", [id])?;
    Ok(())
}

/// The product a variant belongs to, and its display name ("iPhone 15 — 128GB").
pub fn variant_owner(db: &Connection, variant_id: i64) -> AppResult<(i64, String)> {
    db.query_row(
        "SELECT p.id, p.name || CASE WHEN v.label = '' THEN '' ELSE ' — ' || v.label END
         FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?1",
        [variant_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or(AppError::NotFound("المنتج"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn variant(label: &str, opening_stock: i64) -> VariantInput {
        VariantInput {
            id: None,
            label: label.into(),
            price: 2500000,
            cost: 2200000,
            low_stock: 1,
            opening_stock,
        }
    }

    fn input(category_id: i64, variants: Vec<VariantInput>) -> ProductInput {
        ProductInput {
            name: "iPhone 15".into(),
            category_id,
            variants,
        }
    }

    fn count(db: &Connection, sql: &str) -> i64 {
        db.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn setup(name: &str) -> (Connection, std::path::PathBuf) {
        let path =
            std::env::temp_dir().join(format!("mobile-pos-{name}-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = crate::db::open(&path).unwrap();
        db.execute_batch(
            "INSERT INTO users (id, name, username, password_hash, role, created_at) VALUES (1, 'a', 'a', 'x', 'admin', '2026-01-01 00:00:00');
             INSERT INTO categories (id, name, created_at) VALUES (1, 'c', '2026-01-01 00:00:00');",
        )
        .unwrap();
        (db, path)
    }

    #[test]
    fn opening_stock_is_saved_with_the_product_or_not_at_all() {
        let (mut db, path) = setup("product");
        let variants = vec![variant("128GB", 3), variant("256GB", 2)];
        insert_product(&mut db, 1, &input(1, variants)).unwrap();
        assert_eq!(count(&db, "SELECT SUM(stock) FROM product_variants"), 5);
        assert_eq!(
            count(
                &db,
                "SELECT SUM(change_qty) FROM stock_movements WHERE note = 'مخزون افتتاحي'"
            ),
            5
        );

        // An unknown category fails the insert; nothing from that attempt may remain.
        assert!(insert_product(&mut db, 1, &input(99, vec![variant("", 4)])).is_err());
        assert_eq!(count(&db, "SELECT COUNT(*) FROM products"), 1);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM stock_movements"), 2);

        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_unnamed_or_duplicate_variants() {
        let (mut db, path) = setup("product-labels");
        assert!(
            insert_product(&mut db, 1, &input(1, vec![variant("", 0), variant("x", 0)])).is_err()
        );
        assert!(
            insert_product(
                &mut db,
                1,
                &input(1, vec![variant("x", 0), variant("x", 0)])
            )
            .is_err()
        );
        assert!(insert_product(&mut db, 1, &input(1, vec![variant("", 0)])).is_ok());
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_variant_with_stock_cannot_be_removed() {
        let (mut db, path) = setup("product-remove");
        let id = insert_product(
            &mut db,
            1,
            &input(1, vec![variant("a", 2), variant("b", 0)]),
        )
        .unwrap();
        let ids: Vec<i64> = db
            .prepare("SELECT id FROM product_variants ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let keep = |vid: i64, label: &str| VariantInput {
            id: Some(vid),
            ..variant(label, 0)
        };
        // Dropping "a" (2 in stock) is refused, dropping "b" (empty) is fine.
        assert!(edit_product(&mut db, 1, id, &input(1, vec![keep(ids[1], "b")])).is_err());
        edit_product(&mut db, 1, id, &input(1, vec![keep(ids[0], "a")])).unwrap();
        assert_eq!(
            count(
                &db,
                "SELECT COUNT(*) FROM product_variants WHERE active = 1"
            ),
            1
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
