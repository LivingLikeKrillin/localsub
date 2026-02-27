use tauri::State;

use crate::config_manager;
use crate::error::AppError;
use crate::state::{AppConfig, GlossaryEntry, PartialConfig, SharedState};

#[tauri::command]
pub fn get_config(state: State<'_, SharedState>) -> Result<AppConfig, AppError> {
    let mut s = state.lock().expect("Failed to lock state");

    if let Some(ref config) = s.app_config {
        return Ok(config.clone());
    }

    let config = config_manager::load_config()?;
    s.app_config = Some(config.clone());
    Ok(config)
}

#[tauri::command]
pub fn update_config(
    partial: PartialConfig,
    state: State<'_, SharedState>,
) -> Result<AppConfig, AppError> {
    let mut s = state.lock().expect("Failed to lock state");

    if s.app_config.is_none() {
        s.app_config = Some(config_manager::load_config()?);
    }

    let config = s.app_config.as_mut().unwrap();
    config_manager::update_config(partial, config)?;

    Ok(config.clone())
}

#[tauri::command]
pub fn save_glossary(name: String, entries: Vec<GlossaryEntry>) -> Result<(), AppError> {
    config_manager::save_glossary(&name, &entries)
}
