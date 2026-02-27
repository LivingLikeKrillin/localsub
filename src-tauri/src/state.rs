use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

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
}

// ── Glossary types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlossaryEntry {
    pub source: String,
    pub target: String,
}

// ── App State ──

pub struct AppState {
    pub server_status: ServerStatus,
    pub server_process: Option<std::process::Child>,
    pub python_port: u16,
    pub jobs: HashMap<String, Job>,
    pub setup_status: SetupStatus,
    pub app_config: Option<AppConfig>,
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
        }
    }
}

pub type SharedState = Mutex<AppState>;
