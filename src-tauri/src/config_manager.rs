use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::state::{AppConfig, GlossaryEntry, PartialConfig};

const CONFIG_FILENAME: &str = "config.json";

fn app_data_dir() -> Result<PathBuf, AppError> {
    let base = dirs::config_dir()
        .ok_or_else(|| AppError::Config("Cannot determine app data directory".into()))?;
    Ok(base.join("com.subtext.app"))
}

pub fn config_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join(CONFIG_FILENAME))
}

fn glossary_dir() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join("glossaries"))
}

pub fn load_config() -> Result<AppConfig, AppError> {
    let path = config_path()?;
    if path.exists() {
        let data = fs::read_to_string(&path)
            .map_err(|e| AppError::Config(format!("Failed to read config: {}", e)))?;
        let config: AppConfig = serde_json::from_str(&data)
            .map_err(|e| AppError::Config(format!("Failed to parse config: {}", e)))?;
        Ok(config)
    } else {
        let config = AppConfig::default();
        save_config(&config)?;
        Ok(config)
    }
}

pub fn save_config(config: &AppConfig) -> Result<(), AppError> {
    let path = config_path()?;
    atomic_write(&path, config)
}

pub fn update_config(partial: PartialConfig, current: &mut AppConfig) -> Result<(), AppError> {
    if let Some(v) = partial.wizard_completed {
        current.wizard_completed = v;
    }
    if let Some(v) = partial.wizard_step {
        current.wizard_step = v;
    }
    if let Some(v) = partial.profile {
        current.profile = v;
    }
    if let Some(v) = partial.output_dir {
        current.output_dir = v;
    }
    if let Some(v) = partial.subtitle_format {
        current.subtitle_format = v;
    }
    if let Some(v) = partial.source_language {
        current.source_language = v;
    }
    if let Some(v) = partial.target_language {
        current.target_language = v;
    }
    if let Some(v) = partial.translation_mode {
        current.translation_mode = v;
    }
    if let Some(v) = partial.context_window {
        current.context_window = v;
    }
    if let Some(v) = partial.style_preset {
        current.style_preset = v;
    }
    if let Some(v) = partial.active_glossary {
        current.active_glossary = v;
    }
    if let Some(v) = partial.external_api {
        current.external_api = v;
    }
    if let Some(v) = partial.model_dir {
        current.model_dir = v;
    }
    if let Some(v) = partial.ui_language {
        current.ui_language = v;
    }

    save_config(current)
}

pub fn load_glossary(name: &str) -> Result<Vec<GlossaryEntry>, AppError> {
    let dir = glossary_dir()?;
    let filename = sanitize_filename(name);
    let path = dir.join(format!("{}.json", filename));
    if path.exists() {
        let data = fs::read_to_string(&path)
            .map_err(|e| AppError::Config(format!("Failed to read glossary: {}", e)))?;
        let entries: Vec<GlossaryEntry> = serde_json::from_str(&data)
            .map_err(|e| AppError::Config(format!("Failed to parse glossary: {}", e)))?;
        Ok(entries)
    } else {
        Ok(Vec::new())
    }
}

pub fn save_glossary(name: &str, entries: &[GlossaryEntry]) -> Result<(), AppError> {
    let dir = glossary_dir()?;
    fs::create_dir_all(&dir)
        .map_err(|e| AppError::Config(format!("Failed to create glossary dir: {}", e)))?;

    let filename = sanitize_filename(name);
    let path = dir.join(format!("{}.json", filename));
    atomic_write(&path, entries)
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

fn atomic_write<T: serde::Serialize + ?Sized>(path: &Path, data: &T) -> Result<(), AppError> {
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
    use crate::state::{AppConfig, GlossaryEntry, PartialConfig, Profile};
    use std::fs;

    #[test]
    fn test_default_config_roundtrip() {
        let config = AppConfig::default();
        let json = serde_json::to_string_pretty(&config).unwrap();
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.version, 1);
        assert!(!parsed.wizard_completed);
        assert_eq!(parsed.profile, Profile::Lite);
    }

    #[test]
    fn test_partial_config_merge() {
        let mut config = AppConfig::default();
        let partial = PartialConfig {
            profile: Some(Profile::Power),
            wizard_step: Some(3),
            ..Default::default()
        };
        // We test the merge logic directly (without disk I/O)
        if let Some(v) = partial.profile {
            config.profile = v;
        }
        if let Some(v) = partial.wizard_step {
            config.wizard_step = v;
        }
        assert_eq!(config.profile, Profile::Power);
        assert_eq!(config.wizard_step, 3);
        assert_eq!(config.subtitle_format, "srt"); // unchanged
    }

    #[test]
    fn test_glossary_serialization() {
        let entries = vec![
            GlossaryEntry {
                source: "Transformer".into(),
                target: "트랜스포머".into(),
            },
            GlossaryEntry {
                source: "Neural Network".into(),
                target: "신경망".into(),
            },
        ];
        let json = serde_json::to_string_pretty(&entries).unwrap();
        let parsed: Vec<GlossaryEntry> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].source, "Transformer");
    }

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("my glossary!"), "my_glossary_");
        assert_eq!(sanitize_filename("test-name_01"), "test-name_01");
    }

    #[test]
    fn test_atomic_write_and_read() {
        let dir = std::env::temp_dir().join("tauri_ai_sse_test_config");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let path = dir.join("test_config.json");
        let config = AppConfig::default();
        atomic_write(&path, &config).unwrap();

        assert!(path.exists());
        assert!(!path.with_extension("tmp").exists());

        let data = fs::read_to_string(&path).unwrap();
        let parsed: AppConfig = serde_json::from_str(&data).unwrap();
        assert_eq!(parsed.version, 1);

        let _ = fs::remove_dir_all(&dir);
    }
}
