import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Job, PipelinePhase, SttSegment, TranslateSegment } from "../types";
import {
  startTranslate as apiStartTranslate,
  cancelTranslate as apiCancelTranslate,
} from "../lib/tauriApi";

interface TranslateSegmentEvent {
  job_id: string;
  index: number;
  original: string;
  translated: string;
}

export function useTranslate() {
  const [phase, setPhase] = useState<PipelinePhase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranslateSegment[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [eta, setEta] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const jobIdRef = useRef<string | null>(null);

  // Keep jobIdRef in sync
  useEffect(() => {
    jobIdRef.current = jobId;
  }, [jobId]);

  // Elapsed timer
  useEffect(() => {
    if (phase === "translating") {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase]);

  // ETA calculation
  useEffect(() => {
    if (phase === "translating" && progress > 0 && elapsed > 0) {
      const remaining = (elapsed / progress) * (100 - progress);
      setEta(Math.round(remaining));
    } else {
      setEta(null);
    }
  }, [phase, progress, elapsed]);

  // Listen for job-updated events (filter by own jobId)
  useEffect(() => {
    const unlisten = listen<Job>("job-updated", (event) => {
      const job = event.payload;
      // Only process events for our translate job
      if (!jobIdRef.current || job.id !== jobIdRef.current) return;

      if (job.state === "RUNNING") {
        setPhase("translating");
        setProgress(job.progress);
        if (job.message) setMessage(job.message);
      } else if (job.state === "DONE") {
        setPhase("done");
        setProgress(100);
        setMessage(job.message ?? "Translation complete");
      } else if (job.state === "FAILED") {
        setPhase("error");
        setError(job.error ?? "Unknown error");
        setMessage(job.error ?? "Translation failed");
      } else if (job.state === "CANCELED") {
        setPhase("cancelled");
        setMessage("Translation cancelled");
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for translate-segment events
  useEffect(() => {
    const unlisten = listen<TranslateSegmentEvent>("translate-segment", (event) => {
      const seg = event.payload;
      if (jobIdRef.current && seg.job_id !== jobIdRef.current) return;

      const translateSeg: TranslateSegment = {
        index: seg.index,
        original: seg.original,
        translated: seg.translated,
      };

      setSegments((prev) => [...prev, translateSeg]);
      setActiveIndex(seg.index);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const startTranslation = useCallback(
    async (sttSegments: SttSegment[]) => {
      // Reset state
      setPhase("translating");
      setProgress(0);
      setMessage("Starting translation...");
      setSegments([]);
      setActiveIndex(null);
      setError(null);
      setElapsed(0);
      setEta(null);

      try {
        const job = await apiStartTranslate(sttSegments);
        setJobId(job.id);
      } catch (e) {
        setPhase("error");
        setError(e instanceof Error ? e.message : String(e));
        setMessage("Failed to start translation");
      }
    },
    [],
  );

  const cancel = useCallback(async () => {
    if (jobId) {
      try {
        await apiCancelTranslate(jobId);
      } catch (e) {
        console.error("Failed to cancel translation:", e);
      }
    }
  }, [jobId]);

  const reset = useCallback(() => {
    setPhase("idle");
    setProgress(0);
    setMessage(null);
    setSegments([]);
    setActiveIndex(null);
    setJobId(null);
    setError(null);
    setElapsed(0);
    setEta(null);
  }, []);

  return {
    phase,
    progress,
    message,
    segments,
    activeIndex,
    jobId,
    error,
    elapsed,
    eta,
    startTranslation,
    cancel,
    reset,
  };
}
