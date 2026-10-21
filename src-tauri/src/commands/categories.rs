use crate::db::now;
use crate::error::{AppResult, invalid};
use crate::state::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct Category {
    id: i64,
    name: String,
    parent_id: Option<i64>,
    product_count: i64,
}

#[tauri::command]
pub fn list_categories(state: State<AppState>) -> AppResult<Vec<Category>> {
    state.user()?;
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT c.id, c.name, c.parent_id,
                (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1)
         FROM categories c ORDER BY c.name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Category { id: r.get(0)?, name: r.get(1)?, parent_id: r.get(2)?, product_count: r.get(3)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Only two levels are allowed: a category, and sub-categories directly under it.
fn validate(db: &Connection, id: Option<i64>, name: &str, parent_id: Option<i64>) -> AppResult<()> {
    if name.trim().is_empty() {
        return invalid("اسم التصنيف مطلوب");
    }
    let Some(parent) = parent_id else { return Ok(()) };
    if Some(parent) == id {
        return invalid("لا يمكن أن يكون التصنيف تابعاً لنفسه");
    }
    let grandparent: Option<Option<i64>> =
        db.query_row("SELECT parent_id FROM categories WHERE id = ?1", [parent], |r| r.get(0)).optional()?;
    match grandparent {
        None => invalid("التصنيف الرئيسي غير موجود"),
        Some(Some(_)) => invalid("لا يمكن إضافة تصنيف فرعي داخل تصنيف فرعي"),
        Some(None) => {
            if let Some(id) = id {
                let children: i64 =
                    db.query_row("SELECT COUNT(*) FROM categories WHERE parent_id = ?1", [id], |r| r.get(0))?;
                if children > 0 {
                    return invalid("هذا التصنيف يحتوي على تصنيفات فرعية ولا يمكن نقله تحت تصنيف آخر");
                }
            }
            Ok(())
        }
    }
}

#[tauri::command]
pub fn create_category(state: State<AppState>, name: String, parent_id: Option<i64>) -> AppResult<i64> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    validate(&db, None, &name, parent_id)?;
    db.execute(
        "INSERT INTO categories (name, parent_id, created_at) VALUES (?1, ?2, ?3)",
        params![name.trim(), parent_id, now()],
    )?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_category(state: State<AppState>, id: i64, name: String, parent_id: Option<i64>) -> AppResult<()> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    validate(&db, Some(id), &name, parent_id)?;
    db.execute("UPDATE categories SET name = ?1, parent_id = ?2 WHERE id = ?3", params![name.trim(), parent_id, id])?;
    Ok(())
}

#[tauri::command]
pub fn delete_category(state: State<AppState>, id: i64) -> AppResult<()> {
    state.admin()?;
    let db = state.db.lock().unwrap();
    let (children, products): (i64, i64) = db.query_row(
        "SELECT (SELECT COUNT(*) FROM categories WHERE parent_id = ?1),
                (SELECT COUNT(*) FROM products WHERE category_id = ?1)",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if children > 0 {
        return invalid("احذف التصنيفات الفرعية أولاً");
    }
    if products > 0 {
        return invalid("لا يمكن حذف تصنيف مرتبط بمنتجات، انقل المنتجات أولاً");
    }
    db.execute("DELETE FROM categories WHERE id = ?1", [id])?;
    Ok(())
}
