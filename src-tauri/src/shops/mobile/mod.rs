//! The mobile phone shop: one row per phone, tracked by its serial.
//!
//! Shared code uses only what this module exposes; see the shop contract in `docs/project-contract.md`.

#[cfg(test)]
mod fixture_tests;
mod migrations;
pub mod phones;
pub mod products;
pub mod purchases;
pub mod reports;
pub mod sales;
#[cfg(test)]
pub mod testing;

pub use migrations::MIGRATIONS;

/// Kept from release 0.4.0, so installed shops keep their data.
pub const DB_FILE: &str = "phones.db";

/// Settings this shop adds to the shared ones.
pub const SETTINGS_KEYS: &[&str] = &[];

/// The shop's own commands; lib.rs adds them to the shared ones.
macro_rules! shop_commands {
    ($handler:ident) => {
        $handler![
            shop::products::list_products,
            shop::products::create_product,
            shop::products::update_product,
            shop::products::delete_product,
            shop::products::restore_product,
            shop::phones::add_phones,
            shop::phones::update_phone,
            shop::phones::remove_phone,
            shop::reports::report_by_product,
            shop::reports::report_movements,
        ]
    };
}
