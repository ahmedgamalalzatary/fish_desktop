mod commands;
mod db;
mod error;
mod state;
#[cfg(test)]
mod test_support;

/// Every command the app exposes: the shared ones below, then the shop's own, which the shop's
/// `shop_commands!` passes in.
macro_rules! invoke_handler {
    ($($shop_commands:tt)*) => {
        tauri::generate_handler![
            auth::needs_setup,
            auth::setup_admin,
            auth::login,
            auth::logout,
            auth::current_user,
            auth::change_password,
            users::list_users,
            users::create_user,
            users::update_user,
            users::delete_user,
            suppliers::list_suppliers,
            suppliers::create_supplier,
            suppliers::update_supplier,
            suppliers::delete_supplier,
            suppliers::add_supplier_payment,
            suppliers::delete_supplier_payment,
            suppliers::supplier_statement,
            purchases::create_purchase,
            purchases::list_purchases,
            purchases::get_purchase,
            purchases::delete_purchase,
            sales::create_sale,
            sales::get_sale,
            sales::list_sales,
            expenses::create_expense,
            expenses::list_expenses,
            expenses::delete_expense,
            settings::get_settings,
            settings::update_settings,
            settings::backup_database,
            pdf::export_pdf,
            reports::report_summary,
            reports::report_daily,
            reports::report_by_cashier,
            reports::report_by_supplier,
            reports::report_periods,
            reports::report_purchased_items,
            $($shop_commands)*
        ]
    };
}

// The shop this build is for, picked by a Cargo feature (`--features fish`, `--features mobile`).
// build.rs stops a build with no shop feature or more than one.
#[cfg(feature = "fish")]
#[path = "shops/fish/mod.rs"]
#[macro_use]
mod shop;
#[cfg(feature = "mobile")]
#[path = "shops/mobile/mod.rs"]
#[macro_use]
mod shop;

use commands::*;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join(shop::DB_FILE))?;
            app.manage(state::AppState::new(conn));
            Ok(())
        })
        .invoke_handler(shop_commands!(invoke_handler))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
