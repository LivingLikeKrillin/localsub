export type ServerStatus = "STOPPED" | "STARTING" | "RUNNING" | "ERROR";

export type SetupStatus = "CHECKING" | "NEEDED" | "IN_PROGRESS" | "COMPLETE" | "ERROR";

export type SetupStage = "pip" | "requirements" | "llm" | "complete";

export interface SetupProgress {
  stage: SetupStage;
  message: string;
  progress: number;
}

export type JobState = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELED";

export interface Job {
  id: string;
  input_text: string;
  state: JobState;
  progress: number;
  message: string | null;
  result: string | null;
  error: string | null;
}

// ── Hardware types ──

export interface GpuInfo {
  name: string;
  vram_mb: number;
  cuda_version: string | null;
}

export interface HardwareInfo {
  cpu_name: string;
  cpu_cores: number;
  avx_support: boolean;
  avx2_support: boolean;
  total_ram_gb: number;
  available_ram_gb: number;
  gpu: GpuInfo | null;
}

export interface DiskSpace {
  path: string;
  total_gb: number;
  free_gb: number;
}

// ── Profile types ──

export type Profile = "lite" | "balanced" | "power";

export interface ProfileRecommendation {
  recommended: Profile;
  reason: string;
  gpu_detected: boolean;
  gpu_vram_mb: number | null;
}

// ── Config types ──

export interface ExternalApiConfig {
  provider: string | null;
  api_key: string | null;
  model: string | null;
}

export interface AppConfig {
  version: number;
  wizard_completed: boolean;
  wizard_step: number;
  profile: Profile;
  output_dir: string;
  subtitle_format: string;
  source_language: string;
  target_language: string;
  translation_mode: string;
  context_window: number;
  style_preset: string;
  active_glossary: string;
  external_api: ExternalApiConfig;
  model_dir: string | null;
  ui_language: string | null;
  active_whisper_model: string | null;
  active_llm_model: string | null;
  max_concurrent_jobs: number | null;
  gpu_acceleration: boolean | null;
  max_memory_mb: number | null;
  translation_quality: string | null;
  custom_translation_prompt: string | null;
  two_pass_translation: boolean | null;
}

export interface PartialConfig {
  wizard_completed?: boolean;
  wizard_step?: number;
  profile?: Profile;
  output_dir?: string;
  subtitle_format?: string;
  source_language?: string;
  target_language?: string;
  translation_mode?: string;
  context_window?: number;
  style_preset?: string;
  active_glossary?: string;
  external_api?: ExternalApiConfig;
  model_dir?: string | null;
  ui_language?: string | null;
  active_whisper_model?: string | null;
  active_llm_model?: string | null;
  max_concurrent_jobs?: number | null;
  gpu_acceleration?: boolean | null;
  max_memory_mb?: number | null;
  translation_quality?: string | null;
  custom_translation_prompt?: string | null;
  two_pass_translation?: boolean | null;
}

// ── Glossary types ──

export interface GlossaryEntry {
  source: string;
  target: string;
}

// ── Model Catalog types ──

export interface WhisperModelEntry {
  id: string;
  name: string;
  repo: string;
  files: string[];
  total_size_bytes: number;
  sha256: Record<string, string>;
  profiles: Profile[];
}

export interface LlmSplitFile {
  filename: string;
  sha256: string;
}

export interface LlmModelEntry {
  id: string;
  name: string;
  repo: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  quant: string;
  profiles: Profile[];
  n_gpu_layers_default: number;
  model_category?: string;
  split_files?: LlmSplitFile[];
}

export interface ModelCatalog {
  version: number;
  whisper_models: WhisperModelEntry[];
  llm_models: LlmModelEntry[];
}

// ── New Job types ──

export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type JobStage = "stt" | "diarizing" | "translating" | "done" | "error";
export type TranslationStyle = "formal" | "casual" | "honorific";
export type Language = "ko" | "en" | "ja" | "zh";

export interface VocabularyEntry {
  id: string;
  source: string;
  target: string;
  context?: string;
  note?: string;
}

export interface Vocabulary {
  id: string;
  name: string;
  description: string;
  source_lang: string;
  target_lang: string;
  entries: VocabularyEntry[];
  created_at: string;
  updated_at: string;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  whisper_model: string;
  source_lang: string;
  target_lang: string;
  output_format: string;
  translation_style: string;
  llm_model: string;
  vocabulary_id: string | null;
  is_default?: boolean;
  translation_quality?: string;
  custom_translation_prompt?: string;
  two_pass_translation?: boolean;
  enable_diarization?: boolean;
  media_type?: string;
  few_shot_set_id?: string | null;
  created_at: string;
  updated_at: string;
}

// ── Few-shot types ──

export interface FewShotEntry {
  source: string;
  target: string;
}

export interface FewShotSet {
  id: string;
  name: string;
  description: string;
  entries: FewShotEntry[];
  created_at: string;
  updated_at: string;
}

export interface SubtitleLine {
  id: string;
  index: number;
  start_time: number;
  end_time: number;
  original_text: string;
  translated_text: string;
  speaker?: string;
  status: "translated" | "untranslated" | "spell_error" | "editing";
}

export interface DiarizationSegment {
  index: number;
  speaker: string;
}

// ── Dashboard job ──

export interface DashboardJob {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  duration: number;
  preset_id: string;
  status: JobStatus;
  stage: JobStage;
  progress: number;
  error?: string;
  created_at: string;
  completed_at?: string;
}

// ── Screen navigation ──

export type AppScreen = "BOOT" | "WIZARD" | "SETUP" | "MAIN";
export type MainPage = "dashboard" | "editor" | "presets" | "settings";
export type WizardStep = 1 | 2 | 3 | 4 | 5;
export type SettingsTab =
  | "general"
  | "paths"
  | "models"
  | "performance"
  | "system"
  | "about";

// ── Download tracking ──

export interface DownloadProgress {
  model_id: string;
  file_name: string;
  file_index: number;
  total_files: number;
  downloaded: number;
  total: number;
  speed_bps: number;
  eta_secs: number;
}

// ── Model manifest ──

export interface ModelManifestEntry {
  id: string;
  model_type: "whisper" | "llm";
  name: string;
  path: string;
  size_bytes: number;
  sha256: string;
  status: "downloading" | "verifying" | "ready" | "missing" | "corrupt";
  installed_at: string;
}

export interface ModelManifest {
  version: number;
  updated_at: string;
  models: ModelManifestEntry[];
}

// ── Runtime ──

export type RuntimeModelStatus = "UNLOADED" | "LOADING" | "READY" | "ERROR";

export interface RuntimeStatus {
  whisper: RuntimeModelStatus;
  llm: RuntimeModelStatus;
}

export interface ResourceUsage {
  ram_used_mb: number;
  ram_total_mb: number;
  vram_used_mb: number | null;
  vram_total_mb: number | null;
}

// ── Pipeline ──

export type PipelinePhase =
  | "idle"
  | "stt"
  | "translating"
  | "done"
  | "error"
  | "cancelled";

export interface SttSegment {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface TranslateSegment {
  index: number;
  original: string;
  translated: string;
}
