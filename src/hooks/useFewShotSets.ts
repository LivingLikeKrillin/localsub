import { useState, useEffect, useCallback } from "react";
import { getFewShotSets, addFewShotSet, updateFewShotSet, removeFewShotSet } from "../lib/tauriApi";
import { toastError } from "../lib/toast";
import type { FewShotSet } from "../types";

export function useFewShotSets() {
  const [sets, setSets] = useState<FewShotSet[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await getFewShotSets();
      setSets(data);
    } catch (e) {
      console.error("Failed to load few-shot sets:", e);
      toastError("Few-shot 세트를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(async (set: FewShotSet) => {
    try {
      const updated = await addFewShotSet(set);
      setSets(updated);
      return updated;
    } catch (e) {
      console.error("Failed to add few-shot set:", e);
      toastError("Few-shot 세트 저장에 실패했습니다");
      throw e;
    }
  }, []);

  const update = useCallback(async (set: FewShotSet) => {
    try {
      const updated = await updateFewShotSet(set);
      setSets(updated);
      return updated;
    } catch (e) {
      console.error("Failed to update few-shot set:", e);
      toastError("Few-shot 세트 수정에 실패했습니다");
      throw e;
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      const updated = await removeFewShotSet(id);
      setSets(updated);
      return updated;
    } catch (e) {
      console.error("Failed to remove few-shot set:", e);
      toastError("Few-shot 세트 삭제에 실패했습니다");
      throw e;
    }
  }, []);

  return { sets, loading, reload: load, add, update, remove };
}
