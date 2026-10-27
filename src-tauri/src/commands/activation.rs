use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct ActivationStatus {
    active: bool,
    device_code: String,
}

#[tauri::command]
pub fn activation_status(state: State<AppState>) -> ActivationStatus {
    ActivationStatus {
        active: state.activation.is_active(),
        device_code: state.activation.device_code.clone(),
    }
}

#[tauri::command]
pub fn activate(state: State<AppState>, code: String) -> AppResult<()> {
    state.activation.activate(&code)
}
