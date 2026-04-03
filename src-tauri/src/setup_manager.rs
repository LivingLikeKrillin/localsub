use std::path::PathBuf;
use std::process::Command;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::AppError;

#[derive(Clone, serde::Serialize)]
pub struct SetupProgress {
    pub stage: String,
    pub message: String,
    pub progress: f64,
}

/// Returns the path to the Python executable.
/// In dev mode, uses system Python. In production, uses the bundled python-embed.
pub fn get_python_executable(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from("python")
    } else {
        let resource_dir = app
            .path()
            .resource_dir()
            .expect("Failed to get resource dir");
        resource_dir.join("python-embed").join("python.exe")
    }
}

/// Returns the path to the python-server directory.
/// In dev mode, uses the project-local python-server/. In production, uses bundled resources.
pub fn get_python_server_dir(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        manifest_dir.parent().expect("Failed to get project root").join("python-server")
    } else {
        let resource_dir = app
            .path()
            .resource_dir()
            .expect("Failed to get resource dir");
        resource_dir.join("python-server")
    }
}

/// Returns the directory for installed pip packages (%APPDATA%/com.localsub.app/python-env/).
fn get_python_env_dir() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(app_data)
        .join("com.localsub.app")
        .join("python-env")
}

/// Returns the path to the setup completion marker file.
fn get_marker_path() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(app_data)
        .join("com.localsub.app")
        .join("setup-complete.marker")
}

/// Returns the default models directory (%APPDATA%/com.localsub.app/models/).
fn get_models_dir() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(app_data)
        .join("com.localsub.app")
        .join("models")
}

/// Builds environment variables for running Python with bundled packages.
pub fn build_python_env(app: &AppHandle) -> Vec<(String, String)> {
    let models_dir = get_models_dir().to_string_lossy().to_string();

    if cfg!(debug_assertions) {
        return vec![
            ("MODEL_DIR".to_string(), models_dir),
            ("LOCALSUB_DEBUG".to_string(), "1".to_string()),
        ];
    }

    let env_dir = get_python_env_dir();
    let env_dir_str = env_dir.to_string_lossy().to_string();
    let scripts_dir = env_dir.join("bin").to_string_lossy().to_string();

    let resource_dir = app
        .path()
        .resource_dir()
        .expect("Failed to get resource dir");
    let python_embed_dir = resource_dir
        .join("python-embed")
        .to_string_lossy()
        .to_string();

    vec![
        ("PYTHONPATH".to_string(), env_dir_str.clone()),
        ("PIP_TARGET".to_string(), env_dir_str.clone()),
        ("PIP_NO_USER".to_string(), "1".to_string()),
        ("MODEL_DIR".to_string(), models_dir),
        (
            "PATH".to_string(),
            format!(
                "{};{};{}",
                python_embed_dir,
                scripts_dir,
                std::env::var("PATH").unwrap_or_default()
            ),
        ),
    ]
}

/// Computes a SHA-256 hash of the requirements.txt content.
fn hash_requirements(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Checks if setup has been completed by comparing the stored marker hash
/// with the current requirements.txt hash.
pub fn is_setup_complete(app: &AppHandle) -> bool {
    if cfg!(debug_assertions) {
        return true;
    }

    let marker_path = get_marker_path();
    if !marker_path.exists() {
        return false;
    }

    let server_dir = get_python_server_dir(app);
    let req_path = server_dir.join("requirements.txt");
    let req_content = match std::fs::read_to_string(&req_path) {
        Ok(c) => c,
        Err(_) => return false,
    };

    let current_hash = hash_requirements(&req_content);
    let stored_hash = match std::fs::read_to_string(&marker_path) {
        Ok(h) => h.trim().to_string(),
        Err(_) => return false,
    };

    current_hash == stored_hash
}

/// Patches the python312._pth file to include the pip packages directory.
/// Windows embeddable Python ignores PYTHONPATH when a ._pth file exists,
/// so we must add the path directly to the ._pth file.
fn patch_pth_file(app: &AppHandle, env_dir: &std::path::Path) -> Result<(), AppError> {
    let resource_dir = app
        .path()
        .resource_dir()
        .expect("Failed to get resource dir");
    let pth_path = resource_dir.join("python-embed").join("python312._pth");

    let content = std::fs::read_to_string(&pth_path).map_err(|e| {
        AppError::Setup(format!("Failed to read python312._pth: {}", e))
    })?;

    let env_dir_str = env_dir.to_string_lossy();
    if content.contains(env_dir_str.as_ref()) {
        return Ok(());
    }

    // Add env_dir path before "import site" line
    let patched = content.replace(
        "import site",
        &format!("{}\nimport site", env_dir_str),
    );

    std::fs::write(&pth_path, &patched).map_err(|e| {
        AppError::Setup(format!("Failed to write python312._pth: {}", e))
    })?;

    Ok(())
}

/// Runs the full setup process: bootstrap pip, install requirements, save marker.
/// Emits "setup-progress" events throughout the process.
pub fn run_setup_sync(app: &AppHandle) -> Result<(), AppError> {
    let python = get_python_executable(app);
    let server_dir = get_python_server_dir(app);
    let env_dir = get_python_env_dir();
    let env_vars = build_python_env(app);

    // Ensure env directory exists
    std::fs::create_dir_all(&env_dir).map_err(|e| {
        AppError::Setup(format!("Failed to create python-env directory: {}", e))
    })?;

    // Patch ._pth file so embedded Python can find packages in env_dir
    patch_pth_file(app, &env_dir)?;

    emit_progress(app, "pip", "Installing pip...", 0.1);

    // Step 1: Bootstrap pip using get-pip.py
    let resource_dir = app
        .path()
        .resource_dir()
        .expect("Failed to get resource dir");
    let get_pip_path = resource_dir.join("get-pip.py");

    let mut cmd = Command::new(&python);
    cmd.arg(&get_pip_path)
        .arg("--no-user")
        .arg("--target")
        .arg(&env_dir);
    for (k, v) in &env_vars {
        cmd.env(k, v);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd.output().map_err(|e| {
        AppError::Setup(format!("Failed to run get-pip.py: {}", e))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Setup(format!(
            "get-pip.py failed: {}",
            stderr
        )));
    }

    emit_progress(app, "pip", "pip installed successfully", 0.3);

    // Step 2: Install requirements
    emit_progress(app, "requirements", "Installing Python packages...", 0.4);

    let req_path = server_dir.join("requirements.txt");
    let pip_exe = env_dir.join("bin").join("pip.exe");

    // Try using pip from the env bin dir, fallback to python -m pip
    let mut cmd = if pip_exe.exists() {
        let mut c = Command::new(&pip_exe);
        c.arg("install")
            .arg("--no-user")
            .arg("-r")
            .arg(&req_path)
            .arg("--target")
            .arg(&env_dir);
        c
    } else {
        let mut c = Command::new(&python);
        c.arg("-m")
            .arg("pip")
            .arg("install")
            .arg("--no-user")
            .arg("-r")
            .arg(&req_path)
            .arg("--target")
            .arg(&env_dir);
        c
    };

    for (k, v) in &env_vars {
        cmd.env(k, v);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd.output().map_err(|e| {
        AppError::Setup(format!("Failed to run pip install: {}", e))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Setup(format!(
            "pip install failed: {}",
            stderr
        )));
    }

    emit_progress(app, "requirements", "Packages installed successfully", 0.9);

    // Step 3: Save completion marker with requirements hash
    let req_content = std::fs::read_to_string(&req_path).map_err(|e| {
        AppError::Setup(format!("Failed to read requirements.txt: {}", e))
    })?;
    let hash = hash_requirements(&req_content);

    let marker_path = get_marker_path();
    if let Some(parent) = marker_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            AppError::Setup(format!("Failed to create marker directory: {}", e))
        })?;
    }
    std::fs::write(&marker_path, &hash).map_err(|e| {
        AppError::Setup(format!("Failed to write setup marker: {}", e))
    })?;

    // Step 4: Install llama-cpp-python (GPU/CPU)
    emit_progress(app, "llm", "Installing LLM package...", 0.92);
    let llm_backend = install_llm_package(app)?;
    emit_progress(
        app,
        "llm",
        &format!("LLM package installed ({})", llm_backend),
        0.98,
    );

    emit_progress(app, "complete", "Setup complete!", 1.0);

    Ok(())
}

/// Installs llama-cpp-python with GPU (CUDA) or CPU wheel.
/// Returns `"cuda"` or `"cpu"` depending on which was installed.
pub fn install_llm_package(app: &AppHandle) -> Result<String, AppError> {
    let python = get_python_executable(app);
    let env_dir = get_python_env_dir();
    let env_vars = build_python_env(app);

    // Detect NVIDIA GPU
    let has_gpu = detect_nvidia_gpu();

    let pip_exe = env_dir.join("bin").join("pip.exe");

    if has_gpu {
        // Try CUDA wheel first
        let mut cmd = if pip_exe.exists() {
            let mut c = Command::new(&pip_exe);
            c.arg("install")
                .arg("--no-user")
                .arg("llama-cpp-python>=0.3.0")
                .arg("--extra-index-url")
                .arg("https://abetlen.github.io/llama-cpp-python/whl/cu121")
                .arg("--target")
                .arg(&env_dir);
            c
        } else {
            let mut c = Command::new(&python);
            c.arg("-m")
                .arg("pip")
                .arg("install")
                .arg("--no-user")
                .arg("llama-cpp-python>=0.3.0")
                .arg("--extra-index-url")
                .arg("https://abetlen.github.io/llama-cpp-python/whl/cu121")
                .arg("--target")
                .arg(&env_dir);
            c
        };

        for (k, v) in &env_vars {
            cmd.env(k, v);
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        let output = cmd.output().map_err(|e| {
            AppError::Setup(format!("Failed to run pip install (CUDA): {}", e))
        })?;

        if output.status.success() {
            return Ok("cuda".to_string());
        }

        log::warn!(
            "CUDA wheel install failed, falling back to CPU: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    // CPU fallback (or no GPU)
    let mut cmd = if pip_exe.exists() {
        let mut c = Command::new(&pip_exe);
        c.arg("install")
            .arg("--no-user")
            .arg("llama-cpp-python>=0.3.0")
            .arg("--target")
            .arg(&env_dir);
        c
    } else {
        let mut c = Command::new(&python);
        c.arg("-m")
            .arg("pip")
            .arg("install")
            .arg("--no-user")
            .arg("llama-cpp-python>=0.3.0")
            .arg("--target")
            .arg(&env_dir);
        c
    };

    for (k, v) in &env_vars {
        cmd.env(k, v);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd.output().map_err(|e| {
        AppError::Setup(format!("Failed to run pip install (CPU): {}", e))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Setup(format!(
            "llama-cpp-python install failed: {}",
            stderr
        )));
    }

    Ok("cpu".to_string())
}

fn detect_nvidia_gpu() -> bool {
    let mut cmd = Command::new("nvidia-smi");

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    match cmd.output() {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

/// Removes the setup marker so setup will run again on next check.
pub fn reset_setup() -> Result<(), AppError> {
    let marker_path = get_marker_path();
    if marker_path.exists() {
        std::fs::remove_file(&marker_path).map_err(|e| {
            AppError::Setup(format!("Failed to remove setup marker: {}", e))
        })?;
    }

    let env_dir = get_python_env_dir();
    if env_dir.exists() {
        std::fs::remove_dir_all(&env_dir).map_err(|e| {
            AppError::Setup(format!("Failed to remove python-env: {}", e))
        })?;
    }

    Ok(())
}

fn emit_progress(app: &AppHandle, stage: &str, message: &str, progress: f64) {
    let _ = app.emit(
        "setup-progress",
        SetupProgress {
            stage: stage.to_string(),
            message: message.to_string(),
            progress,
        },
    );
}
