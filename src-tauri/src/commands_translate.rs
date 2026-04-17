use tauri::{AppHandle, Emitter, State};

use crate::commands_model;
use crate::config_manager;
use crate::contracts::SubtitleSegment;
use crate::error::AppError;
use crate::job::Job;
use crate::manifest_manager;
use crate::preset_manager;
use crate::sse_client;
use crate::state::{GlossaryEntry, ServerStatus, SharedState};
use crate::vocabulary_manager;

#[tauri::command]
pub async fn start_translate(
    app: AppHandle,
    state: State<'_, SharedState>,
    segments: Vec<SubtitleSegment>,
    preset_id: Option<String>,
) -> Result<Job, AppError> {
    let (port, config) = {
        let s = state.lock().map_err(|e| {
            AppError::InvalidState(format!("Lock error: {}", e))
        })?;
        if s.server_status == ServerStatus::STOPPED || s.server_status == ServerStatus::ERROR {
            return Err(AppError::InvalidState("Server is not running".into()));
        }
        let config = s
            .app_config
            .clone()
            .unwrap_or_else(|| config_manager::load_config().unwrap_or_default());
        (s.python_port, config)
    };

    // Load preset if specified — override config with preset values
    let preset = preset_id.as_deref().and_then(|pid| {
        preset_manager::load_presets()
            .ok()
            .and_then(|presets| presets.into_iter().find(|p| p.id == pid))
    });

    // Check translation mode
    if config.translation_mode == "off" {
        return Err(AppError::InvalidState("Translation mode is off".into()));
    }

    // Wait for server to be healthy before proceeding
    let health_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    for attempt in 0..30 {
        match health_client.get(format!("http://127.0.0.1:{}/health", port)).send().await {
            Ok(resp) if resp.status().is_success() => break,
            _ => {
                if attempt == 29 {
                    return Err(AppError::PythonServer("Server not available after 30 attempts".into()));
                }
                log::info!("Waiting for server... (attempt {})", attempt + 1);
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }

    // Note: Server restart for VRAM cleanup is handled by frontend (usePipeline)
    // Frontend stops server, starts fresh, then calls startTranslate

    // Load glossary: prefer preset.vocabulary_id (new system), fall back to legacy active_glossary.
    let glossary: Vec<GlossaryEntry> = if let Some(ref p) = preset {
        if let Some(ref vocab_id) = p.vocabulary_id {
            match vocabulary_manager::load_vocabularies() {
                Ok(vocabs) => {
                    if let Some(vocab) = vocabs.into_iter().find(|v| v.id == *vocab_id) {
                        log::info!(
                            "Loaded vocabulary '{}' ({} entries) from preset '{}'",
                            vocab.name,
                            vocab.entries.len(),
                            p.name
                        );
                        vocab
                            .entries
                            .into_iter()
                            .map(|e| GlossaryEntry {
                                source: e.source,
                                target: e.target,
                            })
                            .collect()
                    } else {
                        log::warn!("Vocabulary id '{}' not found (preset '{}')", vocab_id, p.name);
                        vec![]
                    }
                }
                Err(e) => {
                    log::warn!("Failed to list vocabularies: {}", e);
                    vec![]
                }
            }
        } else {
            // Preset selected but no vocabulary attached — nothing to inject.
            vec![]
        }
    } else {
        // No preset — fall back to legacy single-glossary config.
        match config_manager::load_glossary(&config.active_glossary) {
            Ok(g) => {
                log::info!(
                    "Loaded legacy glossary '{}' ({} entries)",
                    config.active_glossary,
                    g.len()
                );
                g
            }
            Err(e) => {
                log::warn!(
                    "Failed to load legacy glossary '{}': {}",
                    config.active_glossary,
                    e
                );
                vec![]
            }
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

    // Pass media_type from preset
    if let Some(ref p) = preset {
        if let Some(ref mt) = p.media_type {
            body["media_type"] = serde_json::json!(mt);
        }
    }


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
