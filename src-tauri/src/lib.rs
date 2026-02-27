mod commands;
mod commands_config;
mod commands_model;
mod commands_stt;
mod commands_translate;
mod commands_wizard;
mod config_manager;
mod error;
mod hw_detector;
mod job;
mod manifest_manager;
mod model_downloader;
mod python_manager;
mod setup_manager;
mod sse_client;
mod state;

use tauri::Manager;

use state::{AppState, SharedState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SharedState::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            // Existing commands
            commands::check_setup,
            commands::run_setup,
            commands::reset_setup,
            commands::start_server,
            commands::stop_server,
            commands::get_server_status,
            commands::start_inference,
            commands::cancel_job,
            commands::get_jobs,
            // Wizard commands
            commands_wizard::detect_hardware,
            commands_wizard::recommend_profile,
            commands_wizard::get_model_catalog,
            commands_wizard::check_disk_space,
            // Config commands
            commands_config::get_config,
            commands_config::update_config,
            commands_config::save_glossary,
            // Model commands
            commands_model::download_model,
            commands_model::cancel_download,
            commands_model::delete_model,
            commands_model::get_model_manifest,
            commands_model::verify_model,
            // STT commands
            commands_stt::start_stt,
            commands_stt::cancel_stt,
            // Translate commands
            commands_translate::start_translate,
            commands_translate::cancel_translate,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<SharedState>();
                let mut s = state.lock().expect("Failed to lock state");
                if let Some(ref mut child) = s.server_process {
                    log::info!("Cleaning up Python server process on exit");
                    let _ = python_manager::kill_server(child);
                }
                s.server_process = None;
            }
        });
}
