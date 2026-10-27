//! Helpers shared by the tests of every module.

use rusqlite::Connection;
use std::path::PathBuf;

/// A fresh database with the shop's schema and an admin with id 1.
pub fn temp_db(name: &str) -> (Connection, PathBuf) {
    let path = std::env::temp_dir().join(format!(
        "pos-{name}-{}-{:?}.db",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_file(&path);
    let db = crate::db::open(&path).unwrap();
    db.execute(
        "INSERT INTO users (id, name, username, password_hash, role, created_at) VALUES (1, 'a', 'a', 'x', 'admin', '2026-01-01 00:00:00')",
        [],
    )
    .unwrap();
    (db, path)
}

/// Opens a copy of a fixture from `tests/fixtures/`, so the committed file is never migrated in place.
// For a shop's upgrade tests; a new shop has no old release to test yet.
#[allow(dead_code)]
pub fn open_fixture(name: &str) -> (Connection, PathBuf) {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures")
        .join(name);
    let copy = std::env::temp_dir().join(format!("pos-fixture-{}-{name}", std::process::id()));
    std::fs::copy(&fixture, &copy).unwrap_or_else(|e| panic!("missing fixture {fixture:?}: {e}"));
    (crate::db::open(&copy).unwrap(), copy)
}

/// The single number a query returns.
#[allow(dead_code)]
pub fn int(db: &Connection, sql: &str) -> i64 {
    db.query_row(sql, [], |r| r.get(0)).unwrap()
}
