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
}

export interface ModelCatalog {
  version: number;
  whisper_models: WhisperModelEntry[];
  llm_models: LlmModelEntry[];
}

// ── Screen navigation ──

export type AppScreen = "BOOT" | "WIZARD" | "SETUP" | "MAIN";
export type MainPage = "workspace" | "models" | "settings";
export type WizardStep = 1 | 2 | 3 | 4 | 5;
export type SettingsTab =
  | "profile"
  | "output"
  | "translation"
  | "models"
  | "glossary"
  | "api"
  | "language";

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
