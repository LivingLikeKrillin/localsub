use tauri::{AppHandle, Emitter, State};

use crate::commands_model;
use crate::config_manager;
use crate::contracts::SubtitleSegment;
use crate::error::AppError;
use crate::job::Job;
use crate::manifest_manager;
use crate::sse_client;
use crate::state::{GlossaryEntry, ServerStatus, SharedState};

#[tauri::command]
pub async fn start_translate(
    app: AppHandle,
    state: State<'_, SharedState>,
    segments: Vec<SubtitleSegment>,
) -> Result<Job, AppError> {
    let (port, config) = {
        let s = state.lock().map_err(|e| {
            AppError::InvalidState(format!("Lock error: {}", e))
        })?;
        if s.server_status != ServerStatus::RUNNING {
            return Err(AppError::InvalidState("Server is not running".into()));
        }
        let config = s
            .app_config
            .clone()
            .unwrap_or_else(|| config_manager::load_config().unwrap_or_default());
        (s.python_port, config)
    };

    // Check translation mode
    if config.translation_mode == "off" {
        return Err(AppError::InvalidState("Translation mode is off".into()));
    }

    // Unload Whisper to free VRAM before loading LLM
    let unload_client = reqwest::Client::new();
    let _ = unload_client
        .post(format!("http://127.0.0.1:{}/runtime/unload", port))
        .json(&serde_json::json!({"model_type": "whisper"}))
        .send()
        .await;
    log::info!("Unloaded Whisper model to free VRAM for LLM");

    // Load glossary
    let glossary: Vec<GlossaryEntry> =
        match config_manager::load_glossary(&config.active_glossary) {
            Ok(g) => g,
            Err(e) => {
                log::warn!("Failed to load glossary '{}': {}", config.active_glossary, e);
                vec![]
            }
        };

    // Find a ready LLM model: prefer active_llm_model from config, fallback to first ready
    let manifest = manifest_manager::load_manifest(&config)?;
    let llm_model_id = config
        .active_llm_model
        .as_deref()
        .and_then(|id| {
            manifest
                .models
                .iter()
                .find(|m| m.id == id && m.model_type == "llm" && m.status == "ready")
                .map(|m| m.id.clone())
        })
        .or_else(|| {
            manifest
                .models
                .iter()
                .find(|m| m.model_type == "llm" && m.status == "ready")
                .map(|m| m.id.clone())
        });

    // Look up n_gpu_layers_default and model_category from catalog for the selected model
    let catalog_opt = commands_model::load_catalog(&app).ok();
    let catalog_entry = llm_model_id.as_ref().and_then(|model_id| {
        catalog_opt.as_ref().and_then(|catalog| {
            catalog
                .llm_models
                .iter()
                .find(|m| m.id == *model_id)
        })
    });
    let n_gpu_layers: Option<i32> = catalog_entry.map(|m| m.n_gpu_layers_default);
    let model_category = catalog_entry
        .and_then(|m| m.model_category.clone())
        .unwrap_or_else(|| "general".to_string());

    // Build segment payload for Python
    let segment_payload: Vec<serde_json::Value> = segments
        .iter()
        .map(|s| {
            serde_json::json!({
                "index": s.index,
                "start": s.start,
                "end": s.end,
                "text": s.text,
            })
        })
        .collect();

    // Build glossary payload
    let glossary_payload: Vec<serde_json::Value> = glossary
        .iter()
        .map(|g| {
            serde_json::json!({
                "source": g.source,
                "target": g.target,
            })
        })
        .collect();

    // Build request body
    let mut body = serde_json::json!({
        "segments": segment_payload,
        "source_lang": config.source_language,
        "target_lang": config.target_language,
        "context_window": config.context_window,
        "style_preset": config.style_preset,
        "glossary": glossary_payload,
    });
    if let Some(ref model_id) = llm_model_id {
        body["model_id"] = serde_json::Value::String(model_id.clone());
    }
    if let Some(layers) = n_gpu_layers {
        body["n_gpu_layers"] = serde_json::json!(layers);
    }

    // Translation quality settings
    body["translation_quality"] = serde_json::json!(
        config.translation_quality.as_deref().unwrap_or("balanced")
    );
    if let Some(ref prompt) = config.custom_translation_prompt {
        body["custom_prompt"] = serde_json::json!(prompt);
    }
    let two_pass = config.two_pass_translation
        .unwrap_or_else(|| config.translation_quality.as_deref() == Some("best"));
    body["two_pass"] = serde_json::json!(two_pass);
    body["model_category"] = serde_json::json!(model_category);

    // Pass media filename for context-aware translation
    // Extract from any active job that has a file path
    {
        let s = state.lock().map_err(|e| {
            AppError::InvalidState(format!("Lock error: {}", e))
        })?;
        // Find any job with a file path to extract filename
        if let Some(job) = s.jobs.values().next() {
            if let Some(ref msg) = job.message {
                // message sometimes contains file info; use config fallback
            }
        }
    }
    // Use source_language as a hint; the actual filename will be passed from frontend in future
    // For now, leave media_filename out — the system prompt improvement alone helps

    // POST /translate/start
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{}/translate/start", port))
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::PythonServer(format!(
            "Translate start failed: {}",
            text
        )));
    }

    let resp_body: serde_json::Value = resp.json().await?;
    let job_id = resp_body["job_id"]
        .as_str()
        .ok_or_else(|| AppError::PythonServer("Invalid response: missing job_id".into()))?
        .to_string();

    let job = Job::new(job_id.clone(), "translate".to_string());

    // Store job
    {
        let mut s = state.lock().map_err(|e| {
            AppError::InvalidState(format!("Lock error: {}", e))
        })?;
        s.jobs.insert(job_id.clone(), job.clone());
    }

    // Emit initial job state
    let _ = app.emit("job-updated", &job);

    // Spawn SSE listener for translate stream
    let app_clone = app.clone();
    tokio::spawn(async move {
        sse_client::subscribe_to_translate_stream(app_clone, job_id, port).await;
    });

    Ok(job)
}

#[tauri::command]
pub async fn cancel_translate(
    app: AppHandle,
    state: State<'_, SharedState>,
    job_id: String,
) -> Result<(), AppError> {
    let port = {
        let s = state.lock().map_err(|e| {
            AppError::InvalidState(format!("Lock error: {}", e))
        })?;
        if !s.jobs.contains_key(&job_id) {
            return Err(AppError::JobNotFound(job_id));
        }
        s.python_port
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "http://127.0.0.1:{}/translate/cancel/{}",
            port, job_id
        ))
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AppError::InvalidState(
            "Failed to cancel translate job".into(),
        ));
    }

    // Immediately update for responsiveness
    {
        let mut s = state.lock().map_err(|e| {
            AppError::InvalidState(format!("Lock error: {}", e))
        })?;
        if let Some(job) = s.jobs.get_mut(&job_id) {
            job.state = crate::job::JobState::CANCELED;
            job.message = Some("Translation cancelled".to_string());
            let _ = app.emit("job-updated", job.clone());
        }
    }

    Ok(())
}
