import { useState, useEffect, useCallback } from "react";
import { getConfig, updateConfig } from "../lib/tauriApi";
import type { AppConfig, PartialConfig } from "../types";

export function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await getConfig();
      setConfig(cfg);
    } catch (e) {
      console.error("Failed to load config:", e);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const update = useCallback(
    async (partial: PartialConfig) => {
      try {
        const updated = await updateConfig(partial);
        setConfig(updated);
        return updated;
      } catch (e) {
        console.error("Failed to update config:", e);
        setError(String(e));
        throw e;
      }
    },
    [],
  );

  return { config, loading, error, update, reload: load };
}
