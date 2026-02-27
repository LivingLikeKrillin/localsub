use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::AppConfig;

const MANIFEST_FILENAME: &str = "manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelManifest {
    pub version: u32,
    pub updated_at: String,
    pub models: Vec<ModelManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelManifestEntry {
    pub id: String,
    pub model_type: String,
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub status: String,
    pub installed_at: String,
}

impl Default for ModelManifest {
    fn default() -> Self {
        Self {
            version: 1,
            updated_at: chrono_now(),
            models: Vec::new(),
        }
    }
}

fn chrono_now() -> String {
    // ISO 8601 timestamp without external chrono dep
    let now = std::time::SystemTime::now();
    let secs = now
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Simple epoch-based timestamp; sufficient for ordering
    format!("{}", secs)
}

fn app_data_dir() -> Result<PathBuf, AppError> {
    let base = dirs::config_dir()
        .ok_or_else(|| AppError::Config("Cannot determine app data directory".into()))?;
    Ok(base.join("com.subtext.app"))
}

pub fn models_dir(config: &AppConfig) -> Result<PathBuf, AppError> {
    if let Some(ref custom) = config.model_dir {
        if !custom.is_empty() {
            return Ok(PathBuf::from(custom));
        }
    }
    Ok(app_data_dir()?.join("models"))
}

pub fn manifest_path(config: &AppConfig) -> Result<PathBuf, AppError> {
    Ok(models_dir(config)?.join(MANIFEST_FILENAME))
}

pub fn load_manifest(config: &AppConfig) -> Result<ModelManifest, AppError> {
    let path = manifest_path(config)?;
    if path.exists() {
        let data = fs::read_to_string(&path)
            .map_err(|e| AppError::Download(format!("Failed to read manifest: {}", e)))?;
        let manifest: ModelManifest = serde_json::from_str(&data)
            .map_err(|e| AppError::Download(format!("Failed to parse manifest: {}", e)))?;
        Ok(manifest)
    } else {
        Ok(ModelManifest::default())
    }
}

pub fn save_manifest(config: &AppConfig, manifest: &ModelManifest) -> Result<(), AppError> {
    let path = manifest_path(config)?;
    atomic_write(&path, manifest)
}

pub fn upsert_entry(manifest: &mut ModelManifest, entry: ModelManifestEntry) {
    if let Some(existing) = manifest.models.iter_mut().find(|m| m.id == entry.id) {
        *existing = entry;
    } else {
        manifest.models.push(entry);
    }
    manifest.updated_at = chrono_now();
}

pub fn remove_entry(manifest: &mut ModelManifest, model_id: &str) {
    manifest.models.retain(|m| m.id != model_id);
    manifest.updated_at = chrono_now();
}

pub fn check_integrity(config: &AppConfig) -> Result<ModelManifest, AppError> {
    let mut manifest = load_manifest(config)?;
    let base = models_dir(config)?;

    for entry in manifest.models.iter_mut() {
        if entry.status == "ready" || entry.status == "downloading" {
            let model_path = base.join(&entry.path);
            if !model_path.exists() {
                entry.status = "missing".to_string();
            }
        }
    }

    save_manifest(config, &manifest)?;
    Ok(manifest)
}

fn atomic_write<T: serde::Serialize + ?Sized>(path: &Path, data: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AppError::Download(format!("Failed to create directory: {}", e)))?;
    }

    let tmp_path = path.with_extension("tmp");
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| AppError::Download(format!("Failed to serialize manifest: {}", e)))?;

    fs::write(&tmp_path, &json)
        .map_err(|e| AppError::Download(format!("Failed to write tmp file: {}", e)))?;

    fs::rename(&tmp_path, path)
        .map_err(|e| AppError::Download(format!("Failed to rename tmp to final: {}", e)))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppConfig;

    fn test_config(dir: &Path) -> AppConfig {
        let mut config = AppConfig::default();
        config.model_dir = Some(dir.to_string_lossy().to_string());
        config
    }

    #[test]
    fn test_empty_manifest_roundtrip() {
        let dir = std::env::temp_dir().join("subtext_manifest_test_1");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let config = test_config(&dir);
        let manifest = load_manifest(&config).unwrap();
        assert_eq!(manifest.version, 1);
        assert!(manifest.models.is_empty());

        save_manifest(&config, &manifest).unwrap();
        let loaded = load_manifest(&config).unwrap();
        assert_eq!(loaded.version, 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_upsert_and_remove() {
        let mut manifest = ModelManifest::default();

        let entry = ModelManifestEntry {
            id: "whisper-tiny".to_string(),
            model_type: "whisper".to_string(),
            name: "Whisper Tiny".to_string(),
            path: "whisper-tiny".to_string(),
            size_bytes: 77_000_000,
            sha256: "abc123".to_string(),
            status: "ready".to_string(),
            installed_at: chrono_now(),
        };

        upsert_entry(&mut manifest, entry.clone());
        assert_eq!(manifest.models.len(), 1);
        assert_eq!(manifest.models[0].status, "ready");

        // Upsert same id → update
        let mut updated = entry;
        updated.status = "corrupt".to_string();
        upsert_entry(&mut manifest, updated);
        assert_eq!(manifest.models.len(), 1);
        assert_eq!(manifest.models[0].status, "corrupt");

        // Remove
        remove_entry(&mut manifest, "whisper-tiny");
        assert!(manifest.models.is_empty());
    }

    #[test]
    fn test_models_dir_default() {
        let config = AppConfig::default();
        let dir = models_dir(&config).unwrap();
        assert!(dir.to_string_lossy().contains("models"));
    }

    #[test]
    fn test_models_dir_custom() {
        let mut config = AppConfig::default();
        config.model_dir = Some("D:\\MyModels".to_string());
        let dir = models_dir(&config).unwrap();
        assert_eq!(dir, PathBuf::from("D:\\MyModels"));
    }
}
