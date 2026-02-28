import { useCallback, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Job, SttSegment, SubtitleLine, JobStatus, JobStage } from "../types";
import {
  startStt,
  cancelStt,
  startTranslate,
  cancelTranslate,
  saveJobSubtitles,
} from "../lib/tauriApi";

interface SttSegmentEvent {
  job_id: string;
  index: number;
  start: number;
  end: number;
  text: string;
}

interface TranslateSegmentEvent {
  job_id: string;
  index: number;
  original: string;
  translated: string;
}

export interface JobUpdate {
  status?: JobStatus;
  stage?: JobStage;
  progress?: number;
  error?: string;
}

interface ActivePipeline {
  dashboardJobId: string;
  sttJobId: string | null;
  translateJobId: string | null;
  segments: SttSegment[];
  translations: Map<number, string>;
  phase: "stt" | "translating" | "done" | "error";
}

export function usePipeline(
  onJobUpdate: (dashboardJobId: string, update: JobUpdate) => void,
) {
  const pipelinesRef = useRef<Map<string, ActivePipeline>>(new Map());
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  // Listen for job-updated events
  useEffect(() => {
    const p1 = listen<Job>("job-updated", (event) => {
      const job = event.payload;

      for (const [, pipeline] of pipelinesRef.current) {
        // Match STT job
        if (pipeline.sttJobId === job.id) {
          if (job.state === "RUNNING") {
            onJobUpdate(pipeline.dashboardJobId, {
              status: "processing",
              stage: "stt",
              progress: Math.round(job.progress * 0.5), // STT is 0-50%
            });
          } else if (job.state === "DONE") {
            pipeline.phase = "translating";
            // Chain to translation
            chainTranslation(pipeline);
          } else if (job.state === "FAILED") {
            pipeline.phase = "error";
            onJobUpdate(pipeline.dashboardJobId, {
              status: "failed",
              stage: "error",
              error: job.error ?? "STT failed",
            });
            pipelinesRef.current.delete(pipeline.dashboardJobId);
          } else if (job.state === "CANCELED") {
            pipelinesRef.current.delete(pipeline.dashboardJobId);
            onJobUpdate(pipeline.dashboardJobId, {
              status: "pending",
              stage: "stt",
              progress: 0,
            });
          }
          return;
        }

        // Match translate job
        if (pipeline.translateJobId === job.id) {
          if (job.state === "RUNNING") {
            onJobUpdate(pipeline.dashboardJobId, {
              status: "processing",
              stage: "translating",
              progress: 50 + Math.round(job.progress * 0.5), // Translate is 50-100%
            });
          } else if (job.state === "DONE") {
            pipeline.phase = "done";
            finalizePipeline(pipeline);
          } else if (job.state === "FAILED") {
            // Translation failed — still save STT results
            pipeline.phase = "done";
            finalizePipeline(pipeline);
          } else if (job.state === "CANCELED") {
            pipeline.phase = "done";
            finalizePipeline(pipeline);
          }
          return;
        }
      }
    });

    const p2 = listen<SttSegmentEvent>("stt-segment", (event) => {
      const seg = event.payload;
      for (const [, pipeline] of pipelinesRef.current) {
        if (pipeline.sttJobId === seg.job_id) {
          pipeline.segments.push({
            index: seg.index,
            start: seg.start,
            end: seg.end,
            text: seg.text,
          });
          return;
        }
      }
    });

    const p3 = listen<TranslateSegmentEvent>("translate-segment", (event) => {
      const seg = event.payload;
      for (const [, pipeline] of pipelinesRef.current) {
        if (pipeline.translateJobId === seg.job_id) {
          pipeline.translations.set(seg.index, seg.translated);
          return;
        }
      }
    });

    Promise.all([p1, p2, p3]).then((fns) => {
      unlistenersRef.current = fns;
    });

    return () => {
      unlistenersRef.current.forEach((fn) => fn());
      unlistenersRef.current = [];
    };
  }, [onJobUpdate]);

  async function chainTranslation(pipeline: ActivePipeline) {
    if (pipeline.segments.length === 0) {
      // No segments — skip translation
      pipeline.phase = "done";
      finalizePipeline(pipeline);
      return;
    }

    onJobUpdate(pipeline.dashboardJobId, {
      status: "processing",
      stage: "translating",
      progress: 50,
    });

    try {
      const job = await startTranslate(pipeline.segments);
      pipeline.translateJobId = job.id;
    } catch {
      // Translation start failed — save STT results anyway
      pipeline.phase = "done";
      finalizePipeline(pipeline);
    }
  }

  async function finalizePipeline(pipeline: ActivePipeline) {
    // Merge STT segments + translations into SubtitleLine[]
    const lines: SubtitleLine[] = pipeline.segments.map((seg) => ({
      id: crypto.randomUUID(),
      index: seg.index,
      start_time: seg.start,
      end_time: seg.end,
      original_text: seg.text,
      translated_text: pipeline.translations.get(seg.index) ?? "",
      status: pipeline.translations.has(seg.index)
        ? ("translated" as const)
        : ("untranslated" as const),
    }));

    // Save to disk
    try {
      await saveJobSubtitles(pipeline.dashboardJobId, lines);
    } catch (e) {
      console.error("Failed to save subtitles:", e);
    }

    onJobUpdate(pipeline.dashboardJobId, {
      status: "completed",
      stage: "done",
      progress: 100,
    });

    pipelinesRef.current.delete(pipeline.dashboardJobId);
  }

  const processJob = useCallback(
    async (dashboardJobId: string, filePath: string, sourceLanguage?: string) => {
      const pipeline: ActivePipeline = {
        dashboardJobId,
        sttJobId: null,
        translateJobId: null,
        segments: [],
        translations: new Map(),
        phase: "stt",
      };

      pipelinesRef.current.set(dashboardJobId, pipeline);

      onJobUpdate(dashboardJobId, {
        status: "processing",
        stage: "stt",
        progress: 0,
      });

      try {
        const job = await startStt(filePath, sourceLanguage);
        pipeline.sttJobId = job.id;
      } catch (e) {
        pipeline.phase = "error";
        onJobUpdate(dashboardJobId, {
          status: "failed",
          stage: "error",
          error: e instanceof Error ? e.message : String(e),
        });
        pipelinesRef.current.delete(dashboardJobId);
      }
    },
    [onJobUpdate],
  );

  const cancelJob = useCallback(async (dashboardJobId: string) => {
    const pipeline = pipelinesRef.current.get(dashboardJobId);
    if (!pipeline) return;

    try {
      if (pipeline.phase === "stt" && pipeline.sttJobId) {
        await cancelStt(pipeline.sttJobId);
      } else if (pipeline.phase === "translating" && pipeline.translateJobId) {
        await cancelTranslate(pipeline.translateJobId);
      }
    } catch (e) {
      console.error("Failed to cancel pipeline:", e);
    }
  }, []);

  return { processJob, cancelJob };
}
