//! The fish shop: sold by weight or in fixed-weight packs, stock counted in grams.
//!
//! Shared code uses only what this module exposes; see the shop contract in `docs/template-plan.md`.

pub mod categories;
#[cfg(test)]
mod fixture_tests;
mod migrations;
pub mod products;
pub mod purchases;
pub mod reports;
pub mod sales;
pub mod stock;
#[cfg(test)]
pub mod testing;

pub use migrations::MIGRATIONS;

/// Kept from release 0.2.0, so installed shops keep their data.
pub const DB_FILE: &str = "fish-pos.db";

/// Settings this shop adds to the shared ones.
pub const SETTINGS_KEYS: &[&str] = &["allow_negative_stock"];

/// The shop's own commands; lib.rs adds them to the shared ones.
macro_rules! shop_commands {
    ($handler:ident) => {
        $handler![
            shop::categories::list_categories,
            shop::categories::create_category,
            shop::categories::update_category,
            shop::categories::delete_category,
            shop::products::list_products,
            shop::products::create_product,
            shop::products::update_product,
            shop::products::delete_product,
            shop::products::restore_product,
            shop::stock::adjust_stock,
            shop::reports::report_by_product,
            shop::reports::report_by_category,
            shop::reports::report_movements,
        ]
    };
}
