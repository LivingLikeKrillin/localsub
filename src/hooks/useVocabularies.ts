import { useState, useEffect, useCallback } from "react";
import { getVocabularies, addVocabulary, updateVocabulary, removeVocabulary } from "../lib/tauriApi";
import type { Vocabulary } from "../types";

export function useVocabularies() {
  const [vocabularies, setVocabularies] = useState<Vocabulary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getVocabularies();
      setVocabularies(data);
    } catch (e) {
      console.error("Failed to load vocabularies:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(async (vocabulary: Vocabulary) => {
    const updated = await addVocabulary(vocabulary);
    setVocabularies(updated);
    return updated;
  }, []);

  const update = useCallback(async (vocabulary: Vocabulary) => {
    const updated = await updateVocabulary(vocabulary);
    setVocabularies(updated);
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    const updated = await removeVocabulary(id);
    setVocabularies(updated);
    return updated;
  }, []);

  return { vocabularies, loading, reload: load, add, update, remove };
}
