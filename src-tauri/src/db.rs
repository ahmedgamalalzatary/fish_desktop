use rusqlite::Connection;
use std::path::Path;

/// Opens the shop's database and brings it up to date with the shop's migrations (`shop::MIGRATIONS`),
/// copying it to `backups/` first when an update is about to change it.
/// Whatever the shop, the result holds the shared tables the shared commands use; see
/// `has_the_shared_tables` below.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    open_with(path, crate::shop::MIGRATIONS)
}

fn open_with(path: &Path, migrations: &[&str]) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    // A database with data that this version is about to change: keep a copy of it as it was.
    if version > 0 && version < migrations.len() {
        crate::backup::before_update(&conn, path)?;
    }
    migrate(&mut conn, migrations)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

/// Foreign keys are off while migrating, so a migration can rebuild a table other tables point at
/// (with them on, dropping the old table would cascade-delete its children). Each migration is
/// checked for broken references before it commits instead.
fn migrate(conn: &mut Connection, migrations: &[&str]) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in migrations.iter().enumerate().skip(version) {
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
    fn copies_the_database_before_an_update_but_not_when_new_or_current() {
        let dir = std::env::temp_dir().join(format!("pos-db-update-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("shop.db");
        let backups = crate::backup::backups_dir(&path);
        let first: &[&str] = &["CREATE TABLE a (x); INSERT INTO a VALUES (1);"];
        let second: &[&str] = &[first[0], "CREATE TABLE b (y);"];

        drop(open_with(&path, first).unwrap());
        drop(open_with(&path, first).unwrap());
        assert!(!backups.exists(), "a new or current database is not copied");

        drop(open_with(&path, second).unwrap());
        let copies: Vec<_> = std::fs::read_dir(&backups).unwrap().collect();
        assert_eq!(copies.len(), 1);
        let copy = Connection::open(copies[0].as_ref().unwrap().path()).unwrap();
        let version: usize = copy
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            version, 1,
            "the copy is the database as it was before the update"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn migrates_a_fresh_database_and_is_idempotent() {
        let path = std::env::temp_dir().join(format!("pos-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        drop(open(&path).unwrap());
        let conn = open(&path).unwrap();
        let version: usize = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, crate::shop::MIGRATIONS.len());
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

    /// The tables and columns the shared commands read and write. Every shop's migrations must
    /// produce them; the shop adds whatever else it needs.
    const SHARED_SCHEMA: &[(&str, &[&str])] = &[
        (
            "users",
            &[
                "id",
                "name",
                "username",
                "password_hash",
                "role",
                "active",
                "created_at",
            ],
        ),
        ("settings", &["key", "value"]),
        (
            "suppliers",
            &[
                "id",
                "name",
                "phone",
                "note",
                "opening_balance",
                "active",
                "created_at",
            ],
        ),
        (
            "purchases",
            &[
                "id",
                "supplier_id",
                "invoice_no",
                "total",
                "note",
                "user_id",
                "created_at",
            ],
        ),
        (
            "supplier_payments",
            &[
                "id",
                "supplier_id",
                "purchase_id",
                "amount",
                "note",
                "user_id",
                "created_at",
            ],
        ),
        (
            "sales",
            &[
                "id",
                "user_id",
                "created_at",
                "total",
                "cost_total",
                "paid",
                "change_due",
                "discount",
                "discount_type",
                "discount_value",
            ],
        ),
        ("sale_payments", &["id", "sale_id", "method", "amount"]),
        ("sale_items", &["id", "sale_id", "product_id"]),
        ("products", &["id", "name"]),
        (
            "stock_movements",
            &[
                "id",
                "product_id",
                "reason",
                "cost_total",
                "purchase_id",
                "user_id",
                "created_at",
            ],
        ),
        (
            "expenses",
            &["id", "amount", "reason", "user_id", "created_at"],
        ),
    ];

    #[test]
    fn has_the_shared_tables() {
        let path = std::env::temp_dir().join(format!("pos-schema-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = open(&path).unwrap();
        for (table, columns) in SHARED_SCHEMA {
            let mut stmt = conn
                .prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
                .unwrap();
            let have: Vec<String> = stmt
                .query_map([], |r| r.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            for column in *columns {
                assert!(
                    have.iter().any(|c| c == column),
                    "{table}.{column} is missing"
                );
            }
        }
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }
}
