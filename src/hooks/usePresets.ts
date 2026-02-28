import { useState, useEffect, useCallback } from "react";
import { getPresets, addPreset, updatePreset, removePreset } from "../lib/tauriApi";
import type { Preset } from "../types";

export function usePresets() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getPresets();
      setPresets(data);
    } catch (e) {
      console.error("Failed to load presets:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(async (preset: Preset) => {
    const updated = await addPreset(preset);
    setPresets(updated);
    return updated;
  }, []);

  const update = useCallback(async (preset: Preset) => {
    const updated = await updatePreset(preset);
    setPresets(updated);
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    const updated = await removePreset(id);
    setPresets(updated);
    return updated;
  }, []);

  return { presets, loading, reload: load, add, update, remove };
}
