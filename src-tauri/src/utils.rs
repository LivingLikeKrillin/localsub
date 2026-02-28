use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppError;

pub const APP_ID: &str = "com.subtext.app";

pub fn app_data_dir() -> Result<PathBuf, AppError> {
    let base = dirs::config_dir()
        .ok_or_else(|| AppError::Config("Cannot determine app data directory".into()))?;
    Ok(base.join(APP_ID))
}

pub fn atomic_write<T: Serialize + ?Sized>(path: &Path, data: &T) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AppError::Config(format!("Failed to create directory: {}", e)))?;
    }

    let tmp_path = path.with_extension("tmp");
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| AppError::Config(format!("Failed to serialize: {}", e)))?;

    fs::write(&tmp_path, &json)
        .map_err(|e| AppError::Config(format!("Failed to write tmp file: {}", e)))?;

    fs::rename(&tmp_path, path)
        .map_err(|e| AppError::Config(format!("Failed to rename tmp to final: {}", e)))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_id_value() {
        assert_eq!(APP_ID, "com.subtext.app");
    }

    #[test]
    fn test_atomic_write_roundtrip() {
        let dir = std::env::temp_dir().join("subtext_utils_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let path = dir.join("test_data.json");
        let data = serde_json::json!({"key": "value", "num": 42});
        atomic_write(&path, &data).unwrap();

        assert!(path.exists());
        assert!(!path.with_extension("tmp").exists());

        let content = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["key"], "value");
        assert_eq!(parsed["num"], 42);

        let _ = fs::remove_dir_all(&dir);
    }
}
