import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getRuntimeStatus, loadRuntimeModel, unloadRuntimeModel } from "../lib/tauriApi";
import type { RuntimeStatus, ResourceUsage } from "../types";

export function useRuntime() {
  const [status, setStatus] = useState<RuntimeStatus>({
    whisper: "UNLOADED",
    llm: "UNLOADED",
  });
  const [resources, setResources] = useState<ResourceUsage>({
    ram_used_mb: 0,
    ram_total_mb: 0,
    vram_used_mb: null,
    vram_total_mb: null,
  });

  // Fetch initial status on mount
  useEffect(() => {
    getRuntimeStatus().catch(() => {});
  }, []);

  useEffect(() => {
    const unlistenStatus = listen<RuntimeStatus>("runtime-status", (event) => {
      setStatus(event.payload);
    });
    return () => {
      unlistenStatus.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlistenResources = listen<ResourceUsage>("resource-usage", (event) => {
      setResources(event.payload);
    });
    return () => {
      unlistenResources.then((fn) => fn());
    };
  }, []);

  const loadModel = useCallback(async (modelType: string, modelId: string) => {
    await loadRuntimeModel(modelType, modelId);
  }, []);

  const unloadModel = useCallback(async (modelType: string) => {
    await unloadRuntimeModel(modelType);
  }, []);

  return { status, resources, loadModel, unloadModel };
}
