mod commands;
mod db;
mod error;
mod state;

use commands::*;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("mobile-pos.db"))?;
            app.manage(state::AppState::new(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            categories::list_categories,
            categories::create_category,
            categories::update_category,
            categories::delete_category,
            products::list_products,
            products::create_product,
            products::update_product,
            products::delete_product,
            products::restore_product,
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
            stock::adjust_stock,
            sales::create_sale,
            sales::get_sale,
            sales::list_sales,
            settings::get_settings,
            settings::update_settings,
            settings::backup_database,
            pdf::export_pdf,
            reports::report_summary,
            reports::report_daily,
            reports::report_by_product,
            reports::report_by_category,
            reports::report_by_cashier,
            reports::report_movements,
            reports::report_by_supplier,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
