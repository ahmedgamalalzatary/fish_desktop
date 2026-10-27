//! Automatic copies of the database, in a `backups` folder next to it: one a day (the newest
//! `KEEP_DAILY` are kept) and one before every update of the database (the newest
//! `KEEP_BEFORE_UPDATE` are kept).

use chrono::NaiveDate;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

const KEEP_DAILY: usize = 7;
const KEEP_BEFORE_UPDATE: usize = 3;
const BEFORE_UPDATE: &str = "before-update-";

pub fn backups_dir(db_path: &Path) -> PathBuf {
    db_path.with_file_name("backups")
}

fn stem(db_path: &Path) -> String {
    db_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Takes today's copy unless there is one already, then removes the daily copies past the newest
/// seven. Returns whether a copy was taken.
pub fn daily(db: &Connection, db_path: &Path, today: NaiveDate) -> rusqlite::Result<bool> {
    let dir = backups_dir(db_path);
    let prefix = format!("{}-", stem(db_path));
    let target = dir.join(format!("{prefix}{}.db", today.format("%Y-%m-%d")));
    let taken = !target.exists();
    if taken {
        copy(db, &target)?;
    }
    // `<stem>-YYYY-MM-DD.db`: the date sorts the names oldest first.
    prune(&dir, KEEP_DAILY, |name| {
        name.strip_prefix(&prefix)
            .and_then(|rest| rest.strip_suffix(".db"))
            .is_some_and(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok())
    });
    Ok(taken)
}

/// Copies the database as it is before an update changes it, keeping the newest three such copies.
pub fn before_update(db: &Connection, db_path: &Path) -> rusqlite::Result<()> {
    let dir = backups_dir(db_path);
    let prefix = format!("{}-{BEFORE_UPDATE}", stem(db_path));
    let now = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
    copy(db, &dir.join(format!("{prefix}{now}.db")))?;
    prune(&dir, KEEP_BEFORE_UPDATE, |name| {
        name.starts_with(&prefix) && name.ends_with(".db")
    });
    Ok(())
}

fn copy(db: &Connection, target: &Path) -> rusqlite::Result<()> {
    if let Some(dir) = target.parent() {
        fs::create_dir_all(dir).map_err(|_| rusqlite::Error::InvalidPath(dir.to_path_buf()))?;
    }
    db.execute("VACUUM INTO ?1", [target.to_string_lossy()])?;
    Ok(())
}

/// Removes the oldest files whose names match, keeping `keep`. Names sort oldest first.
fn prune(dir: &Path, keep: usize, matches: impl Fn(&str) -> bool) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| matches(name))
        .collect();
    names.sort();
    let excess = names.len().saturating_sub(keep);
    for name in &names[..excess] {
        let _ = fs::remove_file(dir.join(name));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// A database `shop.db` in a fresh folder, holding one row.
    fn shop_db(name: &str) -> (Connection, PathBuf) {
        let dir = std::env::temp_dir().join(format!("pos-backup-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("shop.db");
        let db = Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE t (x); INSERT INTO t VALUES (42);")
            .unwrap();
        (db, path)
    }

    fn files(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn day(d: u32) -> chrono::NaiveDate {
        chrono::NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
    }

    #[test]
    fn takes_one_copy_a_day_that_holds_the_data() {
        let (db, path) = shop_db("daily");
        assert!(daily(&db, &path, day(27)).unwrap());
        assert!(!daily(&db, &path, day(27)).unwrap());
        let dir = backups_dir(&path);
        assert_eq!(files(&dir), ["shop-2026-10-27.db"]);
        let copy = Connection::open(dir.join("shop-2026-10-27.db")).unwrap();
        let x: i64 = copy.query_row("SELECT x FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(x, 42);
    }

    #[test]
    fn keeps_the_newest_seven_daily_copies_and_nothing_else_is_touched() {
        let (db, path) = shop_db("prune");
        let dir = backups_dir(&path);
        fs::create_dir_all(&dir).unwrap();
        for d in 10..=18 {
            fs::write(dir.join(format!("shop-2026-10-{d}.db")), "").unwrap();
        }
        fs::write(dir.join("shop-before-update-2026-10-01-120000.db"), "").unwrap();
        fs::write(dir.join("notes.txt"), "").unwrap();
        daily(&db, &path, day(27)).unwrap();
        assert_eq!(
            files(&dir),
            [
                "notes.txt",
                "shop-2026-10-13.db",
                "shop-2026-10-14.db",
                "shop-2026-10-15.db",
                "shop-2026-10-16.db",
                "shop-2026-10-17.db",
                "shop-2026-10-18.db",
                "shop-2026-10-27.db",
                "shop-before-update-2026-10-01-120000.db",
            ]
        );
    }

    #[test]
    fn a_copy_before_an_update_keeps_the_newest_three() {
        let (db, path) = shop_db("update");
        let dir = backups_dir(&path);
        fs::create_dir_all(&dir).unwrap();
        for h in 10..=13 {
            fs::write(
                dir.join(format!("shop-before-update-2026-10-01-{h}0000.db")),
                "",
            )
            .unwrap();
        }
        before_update(&db, &path).unwrap();
        let names = files(&dir);
        assert_eq!(names.len(), 3, "{names:?}");
        assert!(
            names[0].ends_with("-120000.db") && names[1].ends_with("-130000.db"),
            "{names:?}"
        );
        let copy = Connection::open(dir.join(&names[2])).unwrap();
        let x: i64 = copy.query_row("SELECT x FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(x, 42);
    }
}
