use std::process::Command;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands_runtime;
use crate::error::AppError;
use crate::job::Job;
use crate::python_manager;
use crate::setup_manager;
use crate::sse_client;
use crate::state::{RuntimeModelStatus, RuntimeStatus, ServerStatus, SetupStatus, SharedState};

/// Query free VRAM in MB via nvidia-smi. Returns None if unavailable.
fn get_vram_free_mb() -> Option<u64> {
    let output = Command::new("nvidia-smi")
        .args(["--query-gpu=memory.free", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim().parse::<u64>().ok()
}

#[tauri::command]
pub async fn check_setup(
    app: AppHandle,
    state: State<'_, SharedState>,
) -> Result<SetupStatus, AppError> {
    let complete = setup_manager::is_setup_complete(&app);
    let status = if complete {
        SetupStatus::COMPLETE
    } else {
        SetupStatus::NEEDED
    };

    {
        let mut s = state.lock().expect("Failed to lock state");
        s.setup_status = status.clone();
    }

    Ok(status)
}

#[tauri::command]
pub async fn run_setup(
    app: AppHandle,
    state: State<'_, SharedState>,
) -> Result<(), AppError> {
    {
        let mut s = state.lock().expect("Failed to lock state");
        s.setup_status = SetupStatus::IN_PROGRESS;
    }

    let app_clone = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        setup_manager::run_setup_sync(&app_clone)
    })
    .await
    .map_err(|e| AppError::Setup(format!("Setup task panicked: {}", e)))?;

    match result {
        Ok(()) => {
            let mut s = state.lock().expect("Failed to lock state");
            s.setup_status = SetupStatus::COMPLETE;
            Ok(())
        }
        Err(e) => {
            let mut s = state.lock().expect("Failed to lock state");
            s.setup_status = SetupStatus::ERROR;
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn reset_setup(
    state: State<'_, SharedState>,
) -> Result<(), AppError> {
    setup_manager::reset_setup()?;
    let mut s = state.lock().expect("Failed to lock state");
    s.setup_status = SetupStatus::NEEDED;
    Ok(())
}

#[tauri::command]
pub async fn start_server(
    app: AppHandle,
    state: State<'_, SharedState>,
) -> Result<(), AppError> {
    // Gate: check setup in production
    if !cfg!(debug_assertions) {
        let s = state.lock().expect("Failed to lock state");
        if s.setup_status != SetupStatus::COMPLETE {
            return Err(AppError::InvalidState(
                "Setup must be completed before starting the server".into(),
            ));
        }
    }

    {
        let mut s = state.lock().expect("Failed to lock state");
        if s.server_status == ServerStatus::RUNNING || s.server_status == ServerStatus::STARTING {
            return Err(AppError::InvalidState("Server is already running or starting".into()));
        }
        s.server_status = ServerStatus::STARTING;
        let _ = app.emit("server-status", &s.server_status);
    }

    let port;
    {
        let mut s = state.lock().expect("Failed to lock state");
        port = s.python_port;

        match python_manager::spawn_python_server(&app, port) {
            Ok(child) => {
                s.server_process = Some(child);
            }
            Err(e) => {
                s.server_status = ServerStatus::ERROR;
                let _ = app.emit("server-status", &s.server_status);
                return Err(e);
            }
        }
    }

    // Wait for healthy in background
    let app_clone = app.clone();
    tokio::spawn(async move {
        let state = app_clone.state::<SharedState>();
        match python_manager::wait_for_healthy(port).await {
            Ok(()) => {
                // Start resource polling
                let token = commands_runtime::start_resource_polling(app_clone.clone(), port);
                match state.lock() {
                    Ok(mut s) => {
                        s.poll_cancel = Some(token);
                        s.server_status = ServerStatus::RUNNING;
                        let _ = app_clone.emit("server-status", &s.server_status);
                    }
                    Err(e) => {
                        log::error!("Failed to lock state after health check success: {}", e);
                    }
                }
            }
            Err(e) => {
                log::error!("Server health check failed: {}", e);
                match state.lock() {
                    Ok(mut s) => {
                        s.server_status = ServerStatus::ERROR;
                        let _ = app_clone.emit("server-status", &s.server_status);
                        // Kill the process if health check fails
                        if let Some(ref mut child) = s.server_process {
                            let _ = python_manager::kill_server(child);
                        }
                        s.server_process = None;
                    }
                    Err(e2) => {
                        log::error!("Failed to lock state after health check failure: {}", e2);
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn restart_server(
    app: AppHandle,
    state: State<'_, SharedState>,
) -> Result<(), AppError> {
    log::info!("Restarting Python server (VRAM cleanup)");
    let port;
    {
        let mut s = state.lock().expect("Failed to lock state");
        // Cancel existing polling
        if let Some(token) = s.poll_cancel.take() {
            token.cancel();
        }
        // Kill old server
        if let Some(ref mut child) = s.server_process {
            let _ = python_manager::kill_server(child);
        }
        s.server_process = None;
        s.server_status = ServerStatus::STARTING;
        s.model_loading = true;
        let _ = app.emit("server-status", &s.server_status);
        port = s.python_port;
    }

    // Wait for CUDA VRAM to be released after process kill
    for attempt in 0..20 {
        let vram_free = get_vram_free_mb();
        if let Some(free) = vram_free {
            log::info!("VRAM free: {} MB (attempt {})", free, attempt + 1);
            // Need at least 6000 MB free for LLM (9B Q4 model)
            if free > 6000 {
                break;
            }
        } else {
            // nvidia-smi not available, just wait a fixed time
            if attempt >= 3 {
                break;
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    {
        let mut s = state.lock().expect("Failed to lock state");
        // Spawn new server
        match python_manager::spawn_python_server(&app, port) {
            Ok(child) => { s.server_process = Some(child); }
            Err(e) => {
                s.server_status = ServerStatus::ERROR;
                let _ = app.emit("server-status", &s.server_status);
                return Err(e);
            }
        }
    }

    // Wait for healthy (blocking — caller awaits)
    python_manager::wait_for_healthy(port).await.map_err(|e| {
        AppError::PythonServer(format!("Server restart failed: {}", e))
    })?;

    {
        let mut s = state.lock().expect("Failed to lock state");
        s.server_status = ServerStatus::RUNNING;
        s.model_loading = false;
        let _ = app.emit("server-status", &s.server_status);
        // Don't start polling yet — LLM loading will block GIL and cause false health failures.
        // Polling will be started by the translate SSE handler after the first event arrives.
    }

    log::info!("Python server restarted successfully (polling deferred)");
    Ok(())
}

#[tauri::command]
pub async fn stop_server(
    app: AppHandle,
    state: State<'_, SharedState>,
) -> Result<(), AppError> {
    let mut s = state.lock().expect("Failed to lock state");

    // Cancel resource polling
    if let Some(token) = s.poll_cancel.take() {
        token.cancel();
    }

    if let Some(ref mut child) = s.server_process {
        python_manager::kill_server(child)?;
    }
    s.server_process = None;
    s.server_status = ServerStatus::STOPPED;
    let _ = app.emit("server-status", &s.server_status);

    // Reset runtime status
    s.runtime_status = RuntimeStatus {
        whisper: RuntimeModelStatus::UNLOADED,
        llm: RuntimeModelStatus::UNLOADED,
    };
    let _ = app.emit("runtime-status", &s.runtime_status);

    Ok(())
}

#[tauri::command]
pub async fn get_server_status(
    state: State<'_, SharedState>,
) -> Result<ServerStatus, AppError> {
    let s = state.lock().expect("Failed to lock state");
    Ok(s.server_status.clone())
}

#[tauri::command]
pub async fn start_inference(
    app: AppHandle,
    state: State<'_, SharedState>,
    input_text: String,
) -> Result<Job, AppError> {
    let port;
    {
        let s = state.lock().expect("Failed to lock state");
        if s.server_status != ServerStatus::RUNNING {
            return Err(AppError::InvalidState("Server is not running".into()));
        }
        port = s.python_port;
    }

    // Call Python server to create job
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{}/inference/start", port))
        .json(&serde_json::json!({ "input_text": input_text }))
        .send()
        .await?;

    let body: serde_json::Value = resp.json().await?;
    let job_id = body["job_id"]
        .as_str()
        .ok_or_else(|| AppError::PythonServer("Invalid response from server".into()))?
        .to_string();

    let job = Job::new(job_id.clone(), input_text);

    // Store job
    {
        let mut s = state.lock().expect("Failed to lock state");
        s.jobs.insert(job_id.clone(), job.clone());
    }

    // Emit initial job state
    let _ = app.emit("job-updated", &job);

    // Spawn SSE listener
    let app_clone = app.clone();
    tokio::spawn(async move {
        sse_client::subscribe_to_job_stream(app_clone, job_id, port).await;
    });

    Ok(job)
}

#[tauri::command]
pub async fn cancel_job(
    app: AppHandle,
    state: State<'_, SharedState>,
    job_id: String,
) -> Result<(), AppError> {
    let port;
    {
        let s = state.lock().expect("Failed to lock state");
        if !s.jobs.contains_key(&job_id) {
            return Err(AppError::JobNotFound(job_id));
        }
        port = s.python_port;
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{}/inference/cancel/{}", port, job_id))
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AppError::InvalidState("Failed to cancel job".into()));
    }

    // The SSE stream will handle the state update when it receives the cancelled event.
    // But also update immediately for responsiveness.
    {
        let mut s = state.lock().expect("Failed to lock state");
        if let Some(job) = s.jobs.get_mut(&job_id) {
            job.state = crate::job::JobState::CANCELED;
            job.message = Some("Job cancelled".to_string());
            let _ = app.emit("job-updated", job.clone());
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_jobs(
    state: State<'_, SharedState>,
) -> Result<Vec<Job>, AppError> {
    let s = state.lock().expect("Failed to lock state");
    let mut jobs: Vec<Job> = s.jobs.values().cloned().collect();
    jobs.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(jobs)
}
