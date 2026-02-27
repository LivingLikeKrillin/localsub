import { invoke } from "@tauri-apps/api/core";
import type {
  Job,
  ServerStatus,
  SetupStatus,
  HardwareInfo,
  ProfileRecommendation,
  DiskSpace,
  AppConfig,
  PartialConfig,
  GlossaryEntry,
  ModelCatalog,
} from "../types";

export async function startServer(): Promise<void> {
  await invoke("start_server");
}

export async function stopServer(): Promise<void> {
  await invoke("stop_server");
}

export async function getServerStatus(): Promise<ServerStatus> {
  return invoke<ServerStatus>("get_server_status");
}

export async function startInference(inputText: string): Promise<Job> {
  return invoke<Job>("start_inference", { inputText });
}

export async function cancelJob(jobId: string): Promise<void> {
  await invoke("cancel_job", { jobId });
}

export async function getJobs(): Promise<Job[]> {
  return invoke<Job[]>("get_jobs");
}

export async function checkSetup(): Promise<SetupStatus> {
  return invoke<SetupStatus>("check_setup");
}

export async function runSetup(): Promise<void> {
  await invoke("run_setup");
}

export async function resetSetup(): Promise<void> {
  await invoke("reset_setup");
}

// ── Wizard commands ──

export async function detectHardware(): Promise<HardwareInfo> {
  return invoke<HardwareInfo>("detect_hardware");
}

export async function recommendProfile(
  hw: HardwareInfo,
): Promise<ProfileRecommendation> {
  return invoke<ProfileRecommendation>("recommend_profile", { hw });
}

export async function getModelCatalog(): Promise<ModelCatalog> {
  return invoke<ModelCatalog>("get_model_catalog");
}

export async function checkDiskSpace(path: string): Promise<DiskSpace> {
  return invoke<DiskSpace>("check_disk_space", { path });
}

// ── Config commands ──

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_config");
}

export async function updateConfig(
  partial: PartialConfig,
): Promise<AppConfig> {
  return invoke<AppConfig>("update_config", { partial });
}

export async function saveGlossary(
  name: string,
  entries: GlossaryEntry[],
): Promise<void> {
  await invoke("save_glossary", { name, entries });
}
