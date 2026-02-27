use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::state::{
    ResourceUsage, RuntimeModelStatus, RuntimeStatus, SharedState,
};

// ── Python API response types ────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
struct PythonModelStatus {
    whisper_status: String,
    llm_status: String,
}

#[derive(Debug, serde::Deserialize)]
struct PythonResourceResponse {
    ram_used_mb: f64,
    ram_total_mb: f64,
    vram_used_mb: Option<f64>,
    vram_total_mb: Option<f64>,
}

// ── Helper ───────────────────────────────────────────────────────

fn parse_model_status(s: &str) -> RuntimeModelStatus {
    match s {
        "READY" => RuntimeModelStatus::READY,
        "LOADING" => RuntimeModelStatus::LOADING,
        "ERROR" => RuntimeModelStatus::ERROR,
        _ => RuntimeModelStatus::UNLOADED,
    }
}

// ── Commands ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_runtime_status(
    app: AppHandle,
    state: State<'_, SharedState>,
) -> Result<RuntimeStatus, AppError> {
    let (client, port) = {
        let s = state.lock().expect("Failed to lock state");
        (s.http_client.clone(), s.python_port)
    };

    let resp = client
        .get(format!("http://127.0.0.1:{}/runtime/status", port))
        .send()
        .await?;

    let body: PythonModelStatus = resp.json().await?;

    let status = RuntimeStatus {
        whisper: parse_model_status(&body.whisper_status),
        llm: parse_model_status(&body.llm_status),
    };

    {
        let mut s = state.lock().expect("Failed to lock state");
        s.runtime_status = status.clone();
    }
    let _ = app.emit("runtime-status", &status);

    Ok(status)
}

#[tauri::command]
pub async fn load_runtime_model(
    app: AppHandle,
    state: State<'_, SharedState>,
    model_type: String,
    model_id: String,
) -> Result<(), AppError> {
    // Immediately set LOADING
    {
        let mut s = state.lock().expect("Failed to lock state");
        match model_type.as_str() {
            "whisper" => s.runtime_status.whisper = RuntimeModelStatus::LOADING,
            "llm" => s.runtime_status.llm = RuntimeModelStatus::LOADING,
            _ => return Err(AppError::InvalidState(format!("Unknown model_type: {}", model_type))),
        }
        let _ = app.emit("runtime-status", &s.runtime_status);
    }

    let (client, port) = {
        let s = state.lock().expect("Failed to lock state");
        (s.http_client.clone(), s.python_port)
    };

    let resp = client
        .post(format!("http://127.0.0.1:{}/runtime/load", port))
        .json(&serde_json::json!({
            "model_type": model_type,
            "model_id": model_id,
        }))
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => {
            let mut s = state.lock().expect("Failed to lock state");
            match model_type.as_str() {
                "whisper" => s.runtime_status.whisper = RuntimeModelStatus::READY,
                "llm" => s.runtime_status.llm = RuntimeModelStatus::READY,
                _ => {}
            }
            let _ = app.emit("runtime-status", &s.runtime_status);
        }
        _ => {
            let mut s = state.lock().expect("Failed to lock state");
            match model_type.as_str() {
                "whisper" => s.runtime_status.whisper = RuntimeModelStatus::ERROR,
                "llm" => s.runtime_status.llm = RuntimeModelStatus::ERROR,
                _ => {}
            }
            let _ = app.emit("runtime-status", &s.runtime_status);
            return Err(AppError::PythonServer(format!(
                "Failed to load {} model",
                model_type
            )));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn unload_runtime_model(
    app: AppHandle,
    state: State<'_, SharedState>,
    model_type: String,
) -> Result<(), AppError> {
    let (client, port) = {
        let s = state.lock().expect("Failed to lock state");
        (s.http_client.clone(), s.python_port)
    };

    let resp = client
        .post(format!("http://127.0.0.1:{}/runtime/unload", port))
        .json(&serde_json::json!({ "model_type": model_type }))
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AppError::PythonServer(format!(
            "Failed to unload {} model",
            model_type
        )));
    }

    {
        let mut s = state.lock().expect("Failed to lock state");
        match model_type.as_str() {
            "whisper" => s.runtime_status.whisper = RuntimeModelStatus::UNLOADED,
            "llm" => s.runtime_status.llm = RuntimeModelStatus::UNLOADED,
            _ => {}
        }
        let _ = app.emit("runtime-status", &s.runtime_status);
    }

    Ok(())
}

// ── Polling loop ─────────────────────────────────────────────────

pub fn start_resource_polling(app: AppHandle, port: u16) -> CancellationToken {
    let token = CancellationToken::new();
    let cancel = token.clone();

    tokio::spawn(async move {
        let client = reqwest::Client::new();

        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    log::info!("Resource polling cancelled");
                    return;
                }
                _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => {}
            }

            // Fetch resources
            if let Ok(resp) = client
                .get(format!("http://127.0.0.1:{}/runtime/resources", port))
                .send()
                .await
            {
                if let Ok(body) = resp.json::<PythonResourceResponse>().await {
                    let usage = ResourceUsage {
                        ram_used_mb: body.ram_used_mb,
                        ram_total_mb: body.ram_total_mb,
                        vram_used_mb: body.vram_used_mb,
                        vram_total_mb: body.vram_total_mb,
                    };
                    let _ = app.emit("resource-usage", &usage);
                }
            }

            // Fetch runtime status
            if let Ok(resp) = client
                .get(format!("http://127.0.0.1:{}/runtime/status", port))
                .send()
                .await
            {
                if let Ok(body) = resp.json::<PythonModelStatus>().await {
                    let status = RuntimeStatus {
                        whisper: parse_model_status(&body.whisper_status),
                        llm: parse_model_status(&body.llm_status),
                    };

                    let state = app.state::<SharedState>();
                    if let Ok(mut s) = state.lock() {
                        s.runtime_status = status.clone();
                    }
                    let _ = app.emit("runtime-status", &status);
                }
            }
        }
    });

    token
}
