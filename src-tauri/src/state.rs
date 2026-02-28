use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

use crate::job::Job;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ServerStatus {
    STOPPED,
    STARTING,
    RUNNING,
    ERROR,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[allow(non_camel_case_types)]
pub enum SetupStatus {
    CHECKING,
    NEEDED,
    IN_PROGRESS,
    COMPLETE,
    ERROR,
}

// ── Hardware types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub name: String,
    pub vram_mb: u64,
    pub cuda_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub cpu_name: String,
    pub cpu_cores: usize,
    pub avx_support: bool,
    pub avx2_support: bool,
    pub total_ram_gb: f64,
    pub available_ram_gb: f64,
    pub gpu: Option<GpuInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskSpace {
    pub path: String,
    pub total_gb: f64,
    pub free_gb: f64,
}

// ── Profile types ──

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    Lite,
    Balanced,
    Power,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileRecommendation {
    pub recommended: Profile,
    pub reason: String,
    pub gpu_detected: bool,
    pub gpu_vram_mb: Option<u64>,
}

// ── Config types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalApiConfig {
    pub provider: Option<String>,
    pub model: Option<String>,
}

impl Default for ExternalApiConfig {
    fn default() -> Self {
        Self {
            provider: None,
            model: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub version: u32,
    pub wizard_completed: bool,
    pub wizard_step: u32,
    pub profile: Profile,
    pub output_dir: String,
    pub subtitle_format: String,
    pub source_language: String,
    pub target_language: String,
    pub translation_mode: String,
    pub context_window: u32,
    pub style_preset: String,
    pub active_glossary: String,
    pub external_api: ExternalApiConfig,
    pub model_dir: Option<String>,
    pub ui_language: Option<String>,
    pub active_whisper_model: Option<String>,
    pub active_llm_model: Option<String>,
    #[serde(default)]
    pub max_concurrent_jobs: Option<u32>,
    #[serde(default)]
    pub gpu_acceleration: Option<bool>,
    #[serde(default)]
    pub max_memory_mb: Option<u32>,
}

impl Default for AppConfig {
    fn default() -> Self {
        let output_dir = dirs_default_output();
        Self {
            version: 1,
            wizard_completed: false,
            wizard_step: 0,
            profile: Profile::Lite,
            output_dir,
            subtitle_format: "srt".to_string(),
            source_language: "auto".to_string(),
            target_language: "ko".to_string(),
            translation_mode: "local".to_string(),
            context_window: 2,
            style_preset: "natural".to_string(),
            active_glossary: "default".to_string(),
            external_api: ExternalApiConfig::default(),
            model_dir: None,
            ui_language: None,
            active_whisper_model: None,
            active_llm_model: None,
            max_concurrent_jobs: None,
            gpu_acceleration: None,
            max_memory_mb: None,
        }
    }
}

fn dirs_default_output() -> String {
    if let Some(docs) = dirs::document_dir() {
        docs.join("Subtitles").to_string_lossy().to_string()
    } else {
        "Subtitles".to_string()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PartialConfig {
    pub wizard_completed: Option<bool>,
    pub wizard_step: Option<u32>,
    pub profile: Option<Profile>,
    pub output_dir: Option<String>,
    pub subtitle_format: Option<String>,
    pub source_language: Option<String>,
    pub target_language: Option<String>,
    pub translation_mode: Option<String>,
    pub context_window: Option<u32>,
    pub style_preset: Option<String>,
    pub active_glossary: Option<String>,
    pub external_api: Option<ExternalApiConfig>,
    pub model_dir: Option<Option<String>>,
    pub ui_language: Option<Option<String>>,
    pub active_whisper_model: Option<Option<String>>,
    pub active_llm_model: Option<Option<String>>,
    pub max_concurrent_jobs: Option<Option<u32>>,
    pub gpu_acceleration: Option<Option<bool>>,
    pub max_memory_mb: Option<Option<u32>>,
}

// ── Glossary types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlossaryEntry {
    pub source: String,
    pub target: String,
}

// ── Model Catalog types (parsed from model_catalog.json) ──

#[derive(Debug, Clone, Deserialize)]
pub struct ModelCatalog {
    pub version: u32,
    pub whisper_models: Vec<WhisperCatalogEntry>,
    pub llm_models: Vec<LlmCatalogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WhisperCatalogEntry {
    pub id: String,
    pub name: String,
    pub repo: String,
    pub files: Vec<String>,
    pub total_size_bytes: u64,
    pub sha256: HashMap<String, String>,
    pub profiles: Vec<Profile>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LlmCatalogEntry {
    pub id: String,
    pub name: String,
    pub repo: String,
    pub filename: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub quant: String,
    pub profiles: Vec<Profile>,
    pub n_gpu_layers_default: i32,
}

// ── Runtime types ──

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RuntimeModelStatus {
    UNLOADED,
    LOADING,
    READY,
    ERROR,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeStatus {
    pub whisper: RuntimeModelStatus,
    pub llm: RuntimeModelStatus,
}

impl Default for RuntimeStatus {
    fn default() -> Self {
        Self {
            whisper: RuntimeModelStatus::UNLOADED,
            llm: RuntimeModelStatus::UNLOADED,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUsage {
    pub ram_used_mb: f64,
    pub ram_total_mb: f64,
    pub vram_used_mb: Option<f64>,
    pub vram_total_mb: Option<f64>,
}

// ── Preset types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranslationStyle {
    Formal,
    Casual,
    Honorific,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VocabularyEntry {
    pub id: String,
    pub source: String,
    pub target: String,
    pub context: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vocabulary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source_lang: String,
    pub target_lang: String,
    pub entries: Vec<VocabularyEntry>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub whisper_model: String,
    pub source_lang: String,
    pub target_lang: String,
    pub output_format: String,
    pub translation_style: String,
    pub llm_model: String,
    pub vocabulary_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ── App State ──

pub struct AppState {
    pub server_status: ServerStatus,
    pub server_process: Option<std::process::Child>,
    pub python_port: u16,
    pub jobs: HashMap<String, Job>,
    pub setup_status: SetupStatus,
    pub app_config: Option<AppConfig>,
    pub http_client: reqwest::Client,
    pub active_downloads: HashMap<String, CancellationToken>,
    pub runtime_status: RuntimeStatus,
    pub poll_cancel: Option<CancellationToken>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            server_status: ServerStatus::STOPPED,
            server_process: None,
            python_port: 9111,
            jobs: HashMap::new(),
            setup_status: SetupStatus::CHECKING,
            app_config: None,
            http_client: reqwest::Client::new(),
            active_downloads: HashMap::new(),
            runtime_status: RuntimeStatus::default(),
            poll_cancel: None,
        }
    }
}

pub type SharedState = Mutex<AppState>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_config_default_values() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.version, 1);
        assert!(!cfg.wizard_completed);
        assert_eq!(cfg.wizard_step, 0);
        assert_eq!(cfg.profile, Profile::Lite);
        assert_eq!(cfg.subtitle_format, "srt");
        assert_eq!(cfg.source_language, "auto");
        assert_eq!(cfg.target_language, "ko");
        assert_eq!(cfg.translation_mode, "local");
        assert_eq!(cfg.context_window, 2);
        assert_eq!(cfg.style_preset, "natural");
        assert_eq!(cfg.active_glossary, "default");
        assert!(cfg.model_dir.is_none());
        assert!(cfg.ui_language.is_none());
        assert!(cfg.active_whisper_model.is_none());
        assert!(cfg.active_llm_model.is_none());
    }

    #[test]
    fn test_app_config_serialization_roundtrip() {
        let cfg = AppConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let restored: AppConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(restored.version, cfg.version);
        assert_eq!(restored.wizard_completed, cfg.wizard_completed);
        assert_eq!(restored.profile, cfg.profile);
        assert_eq!(restored.subtitle_format, cfg.subtitle_format);
        assert_eq!(restored.source_language, cfg.source_language);
        assert_eq!(restored.target_language, cfg.target_language);
        assert_eq!(restored.context_window, cfg.context_window);
    }

    #[test]
    fn test_profile_serde_lowercase() {
        let json = serde_json::to_string(&Profile::Lite).unwrap();
        assert_eq!(json, r#""lite""#);

        let json = serde_json::to_string(&Profile::Balanced).unwrap();
        assert_eq!(json, r#""balanced""#);

        let json = serde_json::to_string(&Profile::Power).unwrap();
        assert_eq!(json, r#""power""#);

        // Deserialize back
        let p: Profile = serde_json::from_str(r#""lite""#).unwrap();
        assert_eq!(p, Profile::Lite);
    }

    #[test]
    fn test_runtime_status_default() {
        let rs = RuntimeStatus::default();
        assert_eq!(rs.whisper, RuntimeModelStatus::UNLOADED);
        assert_eq!(rs.llm, RuntimeModelStatus::UNLOADED);
    }

    #[test]
    fn test_partial_config_all_none() {
        let pc = PartialConfig::default();
        assert!(pc.wizard_completed.is_none());
        assert!(pc.wizard_step.is_none());
        assert!(pc.profile.is_none());
        assert!(pc.output_dir.is_none());
        assert!(pc.subtitle_format.is_none());
        assert!(pc.source_language.is_none());
        assert!(pc.target_language.is_none());
        assert!(pc.translation_mode.is_none());
        assert!(pc.context_window.is_none());
        assert!(pc.style_preset.is_none());
        assert!(pc.active_glossary.is_none());
        assert!(pc.external_api.is_none());
        assert!(pc.model_dir.is_none());
        assert!(pc.ui_language.is_none());
        assert!(pc.active_whisper_model.is_none());
        assert!(pc.active_llm_model.is_none());
    }
}
