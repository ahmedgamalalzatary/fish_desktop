// Throwaway: tests that use tauri's mock runtime need the common-controls manifest too.
fn main() {
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).unwrap();
    let manifest = concat!(env!("CARGO_MANIFEST_DIR"), "/test.manifest");
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{manifest}");
}
