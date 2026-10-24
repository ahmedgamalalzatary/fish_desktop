use super::phones::{Phone, load_phones};
use crate::db::now;
use crate::error::{AppError, AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, ErrorCode, params};
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

/// A phone model and the phones of it that are in stock.
#[derive(Serialize)]
pub struct Product {
    id: i64,
    name: String,
    active: bool,
    phones: Vec<Phone>,
}

/// Cashiers can list products to sell them, but never see buy prices.
#[tauri::command]
pub fn list_products(state: State<AppState>, include_inactive: bool) -> AppResult<Vec<Product>> {
    let user = state.user()?;
    let db = state.db.lock().unwrap();
    load_products(&db, include_inactive && user.is_admin(), !user.is_admin())
}

pub fn load_products(
    db: &Connection,
    include_inactive: bool,
    hide_cost: bool,
) -> AppResult<Vec<Product>> {
    let mut phones: HashMap<i64, Vec<Phone>> = HashMap::new();
    for phone in load_phones(db, hide_cost)? {
        phones.entry(phone.product_id).or_default().push(phone);
    }
    let mut stmt = db.prepare(
        "SELECT id, name, active FROM products WHERE active = 1 OR ?1 ORDER BY name COLLATE NOCASE",
    )?;
    let products = stmt.query_map([include_inactive], |r| {
        let id: i64 = r.get(0)?;
        Ok(Product {
            id,
            name: r.get(1)?,
            active: r.get(2)?,
            phones: phones.remove(&id).unwrap_or_default(),
        })
    })?;
    Ok(products.collect::<Result<_, _>>()?)
}

fn clean_name(name: &str) -> AppResult<&str> {
    let name = name.trim();
    if name.is_empty() {
        return invalid("اسم الموديل مطلوب");
    }
    Ok(name)
}

/// Turns the unique-name violation into a message the shop can act on.
fn name_taken(e: rusqlite::Error, name: &str) -> AppError {
    match e.sqlite_error_code() {
        Some(ErrorCode::ConstraintViolation) => {
            AppError::Invalid(format!("الموديل «{name}» موجود بالفعل"))
        }
        _ => e.into(),
    }
}

#[tauri::command]
pub fn create_product(state: State<AppState>, name: String) -> AppResult<i64> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    insert_product(&db, &name)
}

pub fn insert_product(db: &Connection, name: &str) -> AppResult<i64> {
    let name = clean_name(name)?;
    db.execute(
        "INSERT INTO products (name, created_at, updated_at) VALUES (?1, ?2, ?2)",
        params![name, now()],
    )
    .map_err(|e| name_taken(e, name))?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_product(state: State<AppState>, id: i64, name: String) -> AppResult<()> {
    state.admin()?;
    let name = clean_name(&name)?;
    let db = state.db.lock().unwrap();
    let changed = db
        .execute(
            "UPDATE products SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now(), id],
        )
        .map_err(|e| name_taken(e, name))?;
    if changed == 0 {
        return Err(AppError::NotFound("الموديل"));
    }
    Ok(())
}

/// Models that never had a phone are deleted; the rest are archived so their history stays in reports.
/// A model with phones still in stock can be neither.
#[tauri::command]
pub fn delete_product(state: State<AppState>, id: i64) -> AppResult<&'static str> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    remove_product(&db, id)
}

pub fn remove_product(db: &Connection, id: i64) -> AppResult<&'static str> {
    let (in_stock, ever): (i64, i64) = db.query_row(
        "SELECT COUNT(*) FILTER (WHERE status = 'in_stock'), COUNT(*) FROM phones WHERE product_id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if in_stock > 0 {
        return invalid(format!(
            "في المخزون {in_stock} جهاز من هذا الموديل. بِعها أو أخرجها من المخزون أولاً"
        ));
    }
    if ever > 0 {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_names_are_unique_and_models_with_stock_stay() {
        let path =
            std::env::temp_dir().join(format!("mobile-pos-product-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = crate::db::open(&path).unwrap();
        let id = insert_product(&db, " Samsung Galaxy S24 ").unwrap();
        assert!(insert_product(&db, "samsung galaxy s24").is_err());
        assert!(insert_product(&db, "  ").is_err());

        db.execute(
            "INSERT INTO phones (product_id, serial, price, created_at) VALUES (?1, 'SN1', 100, '2026-01-01 00:00:00')",
            [id],
        )
        .unwrap();
        assert!(remove_product(&db, id).is_err());
        db.execute("UPDATE phones SET status = 'sold'", []).unwrap();
        assert_eq!(remove_product(&db, id).unwrap(), "archived");

        let empty = insert_product(&db, "iPhone 15").unwrap();
        assert_eq!(remove_product(&db, empty).unwrap(), "deleted");
        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
