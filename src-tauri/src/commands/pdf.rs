use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{State, WebviewWindow};

/// Saves the current page, as it looks with print styles applied, to a PDF file.
///
/// Uses WebView2's own PrintToPdf so Arabic text is shaped exactly as on screen.
/// The frontend fills `#print-root` with the document before calling this.
/// Sizes are in inches.
#[tauri::command]
pub async fn export_pdf(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
    width: f64,
    height: f64,
    margin: f64,
) -> AppResult<()> {
    state.user()?;
    let (tx, rx) = std::sync::mpsc::channel::<Result<bool, String>>();

    window
        .with_webview(move |webview| {
            if let Err(e) = start_print(webview, &path, width, height, margin, tx.clone()) {
                let _ = tx.send(Err(e.to_string()));
            }
        })
        .map_err(|e| AppError::Other(e.to_string()))?;

    let result = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
        .map_err(|_| AppError::Other("تعذّر إنشاء ملف PDF".into()))?;
    match result {
        Ok(true) => Ok(()),
        Ok(false) => Err(AppError::Other(
            "تعذّر حفظ ملف PDF، تأكد أن الملف غير مفتوح في برنامج آخر".into(),
        )),
        Err(e) => Err(AppError::Other(format!("تعذّر إنشاء ملف PDF: {e}"))),
    }
}

#[cfg(windows)]
fn start_print(
    webview: tauri::webview::PlatformWebview,
    path: &str,
    width: f64,
    height: f64,
    margin: f64,
    tx: std::sync::mpsc::Sender<Result<bool, String>>,
) -> windows::core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT, ICoreWebView2_7, ICoreWebView2Environment6,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{HSTRING, Interface};

    unsafe {
        let core: ICoreWebView2_7 = webview.controller().CoreWebView2()?.cast()?;
        let env: ICoreWebView2Environment6 = webview.environment().cast()?;
        let settings = env.CreatePrintSettings()?;
        settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
        settings.SetPageWidth(width)?;
        settings.SetPageHeight(height)?;
        settings.SetMarginTop(margin)?;
        settings.SetMarginBottom(margin)?;
        settings.SetMarginLeft(margin)?;
        settings.SetMarginRight(margin)?;
        settings.SetShouldPrintBackgrounds(true)?;
        settings.SetShouldPrintHeaderAndFooter(false)?;

        let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
            let _ = tx.send(result.map(|_| ok).map_err(|e| e.to_string()));
            Ok(())
        }));
        core.PrintToPdf(&HSTRING::from(path), &settings, &handler)
    }
}

#[cfg(not(windows))]
fn start_print(
    _webview: tauri::webview::PlatformWebview,
    _path: &str,
    _width: f64,
    _height: f64,
    _margin: f64,
    _tx: std::sync::mpsc::Sender<Result<bool, String>>,
) -> Result<(), String> {
    Err("تصدير PDF مدعوم على ويندوز فقط".into())
}
