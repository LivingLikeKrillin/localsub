mod commands;
mod commands_config;
mod commands_export;
mod commands_model;
mod commands_preset;
mod commands_runtime;
mod commands_stt;
mod commands_subtitle;
mod commands_translate;
mod commands_vocabulary;
mod commands_wizard;
mod config_manager;
mod contracts;
mod error;
mod hw_detector;
mod job;
mod manifest_manager;
mod model_downloader;
mod preset_manager;
mod python_manager;
mod setup_manager;
mod sse_client;
mod state;
mod subtitle_manager;
mod subtitle_writer;
mod utils;
mod vocabulary_manager;

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
            // Runtime commands
            commands_runtime::get_runtime_status,
            commands_runtime::load_runtime_model,
            commands_runtime::unload_runtime_model,
            // Export commands
            commands_export::export_subtitles,
            commands_export::open_folder,
            // Subtitle commands
            commands_subtitle::load_job_subtitles,
            commands_subtitle::save_job_subtitles,
            // Preset commands
            commands_preset::get_presets,
            commands_preset::add_preset,
            commands_preset::update_preset,
            commands_preset::remove_preset,
            // Vocabulary commands
            commands_vocabulary::get_vocabularies,
            commands_vocabulary::add_vocabulary,
            commands_vocabulary::update_vocabulary,
            commands_vocabulary::remove_vocabulary,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<SharedState>();
                let mut s = state.lock().expect("Failed to lock state");
                // Cancel resource polling
                if let Some(token) = s.poll_cancel.take() {
                    token.cancel();
                }
                if let Some(ref mut child) = s.server_process {
                    log::info!("Cleaning up Python server process on exit");
                    let _ = python_manager::kill_server(child);
                }
                s.server_process = None;
            }
        });
}
