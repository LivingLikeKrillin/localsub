use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;

use crate::error::AppError;
use crate::utils::app_data_dir;

fn ffmpeg_dir() -> Result<PathBuf, AppError> {
    let dir = app_data_dir()?.join("bin");
    fs::create_dir_all(&dir)
        .map_err(|e| AppError::Config(format!("Failed to create bin dir: {}", e)))?;
    Ok(dir)
}

fn ffmpeg_path() -> Result<PathBuf, AppError> {
    Ok(ffmpeg_dir()?.join("ffmpeg.exe"))
}

/// Check if ffmpeg is available (either in app bin or system PATH)
#[tauri::command]
pub fn check_ffmpeg() -> Result<bool, AppError> {
    // Check app-local ffmpeg first
    let local = ffmpeg_path()?;
    if local.exists() {
        return Ok(true);
    }
    // Check system PATH
    let output = std::process::Command::new("where")
        .arg("ffmpeg")
        .output();
    match output {
        Ok(o) if o.status.success() => Ok(true),
        _ => Ok(false),
    }
}

/// Get the ffmpeg executable path (app-local or system)
#[tauri::command]
pub fn get_ffmpeg_path() -> Result<String, AppError> {
    let local = ffmpeg_path()?;
    if local.exists() {
        return Ok(local.to_string_lossy().to_string());
    }
    // Fallback to system ffmpeg
    Ok("ffmpeg".to_string())
}

/// Download ffmpeg essentials to app-local bin directory
#[tauri::command]
pub async fn download_ffmpeg(app: AppHandle) -> Result<String, AppError> {
    use tauri::Emitter;

    let dest_dir = ffmpeg_dir()?;
    let dest_path = dest_dir.join("ffmpeg.exe");

    if dest_path.exists() {
        return Ok(dest_path.to_string_lossy().to_string());
    }

    let zip_url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
    let zip_path = dest_dir.join("ffmpeg-download.zip");

    log::info!("Downloading ffmpeg from {}", zip_url);
    let _ = app.emit("ffmpeg-download-progress", "Downloading ffmpeg...");

    // Download zip
    let client = reqwest::Client::new();
    let resp = client.get(zip_url).send().await.map_err(|e| {
        AppError::Setup(format!("Failed to download ffmpeg: {}", e))
    })?;

    if !resp.status().is_success() {
        return Err(AppError::Setup(format!("ffmpeg download failed: HTTP {}", resp.status())));
    }

    let bytes = resp.bytes().await.map_err(|e| {
        AppError::Setup(format!("Failed to read ffmpeg download: {}", e))
    })?;

    fs::write(&zip_path, &bytes).map_err(|e| {
        AppError::Setup(format!("Failed to save ffmpeg zip: {}", e))
    })?;

    let _ = app.emit("ffmpeg-download-progress", "Extracting ffmpeg...");

    // Extract ffmpeg.exe from zip
    let file = fs::File::open(&zip_path).map_err(|e| {
        AppError::Setup(format!("Failed to open zip: {}", e))
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        AppError::Setup(format!("Failed to read zip: {}", e))
    })?;

    let mut found = false;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| {
            AppError::Setup(format!("Failed to read zip entry: {}", e))
        })?;
        let name = entry.name().to_string();
        if name.ends_with("bin/ffmpeg.exe") || name.ends_with("bin\\ffmpeg.exe") {
            let mut outfile = fs::File::create(&dest_path).map_err(|e| {
                AppError::Setup(format!("Failed to create ffmpeg.exe: {}", e))
            })?;
            std::io::copy(&mut entry, &mut outfile).map_err(|e| {
                AppError::Setup(format!("Failed to extract ffmpeg.exe: {}", e))
            })?;
            found = true;
            break;
        }
    }

    // Clean up zip
    let _ = fs::remove_file(&zip_path);

    if !found {
        return Err(AppError::Setup("ffmpeg.exe not found in downloaded archive".into()));
    }

    log::info!("ffmpeg installed to {:?}", dest_path);
    let _ = app.emit("ffmpeg-download-progress", "Complete");

    Ok(dest_path.to_string_lossy().to_string())
}
