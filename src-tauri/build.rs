use std::{env, fs};

/// Exactly one shop per build: a folder in src/shops/ whose Cargo feature is on (`--features fish`).
fn check_one_shop() {
    println!("cargo:rerun-if-changed=src/shops");
    let shops: Vec<String> = fs::read_dir("src/shops")
        .expect("src/shops lists the shops")
        .filter_map(|entry| {
            let entry = entry.ok()?;
            entry
                .file_type()
                .ok()?
                .is_dir()
                .then(|| entry.file_name().to_string_lossy().into_owned())
        })
        .collect();
    let on: Vec<&String> = shops
        .iter()
        .filter(|shop| {
            env::var_os(format!(
                "CARGO_FEATURE_{}",
                shop.to_uppercase().replace('-', "_")
            ))
            .is_some()
        })
        .collect();
    match on.len() {
        1 => {}
        0 => panic!(
            "Pick the shop to build with a feature, one of: --features {}",
            shops.join(", --features ")
        ),
        _ => panic!("Build one shop at a time; these are all on: {:?}", on),
    }
}

fn main() {
    check_one_shop();
    tauri_build::build()
}
