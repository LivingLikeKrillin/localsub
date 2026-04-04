import { useCallback, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Job, SttSegment, SubtitleLine, JobStatus, JobStage } from "../types";
import {
  startStt,
  cancelStt,
  startDiarization,
  cancelDiarization,
  startTranslate,
  cancelTranslate,
  saveJobSubtitles,
  restartServer,
} from "../lib/tauriApi";
import { toastError } from "../lib/toast";
import { cleanSttSegments } from "../lib/sttCleaner";
import i18n from "../i18n";

interface SttSegmentEvent {
  job_id: string;
  index: number;
  start: number;
  end: number;
  text: string;
}

interface DiarizationSegmentEvent {
  job_id: string;
  index: number;
  speaker: string;
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
  diarizationJobId: string | null;
  translateJobId: string | null;
  segments: SttSegment[];
  translations: Map<number, string>;
  speakerMap: Map<number, string>;
  enableDiarization: boolean;
  skipTranslation: boolean;
  presetId?: string;
  filePath: string;
  phase: "stt" | "diarizing" | "translating" | "done" | "error";
}

function buildSubtitleLines(pipeline: ActivePipeline): SubtitleLine[] {
  return pipeline.segments.map((seg) => ({
    id: crypto.randomUUID(),
    index: seg.index,
    start_time: seg.start,
    end_time: seg.end,
    original_text: seg.text,
    translated_text: pipeline.translations.get(seg.index) ?? "",
    speaker: pipeline.speakerMap.get(seg.index),
    status: pipeline.translations.has(seg.index)
      ? ("translated" as const)
      : ("untranslated" as const),
  }));
}

export function usePipeline(
  onJobUpdate: (dashboardJobId: string, update: JobUpdate) => void,
  onLiveSegments?: (jobId: string, lines: SubtitleLine[]) => void,
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
              progress: Math.round(job.progress),
            });
          } else if (job.state === "DONE") {
            // Clean STT output before passing to next stage
            pipeline.segments = cleanSttSegments(pipeline.segments);

            if (pipeline.enableDiarization) {
              pipeline.phase = "diarizing";
              chainDiarization(pipeline);
            } else if (pipeline.skipTranslation) {
              pipeline.phase = "done";
              finalizePipeline(pipeline);
            } else {
              pipeline.phase = "translating";
              chainTranslation(pipeline);
            }
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

        // Match diarization job
        if (pipeline.diarizationJobId === job.id) {
          if (job.state === "RUNNING") {
            onJobUpdate(pipeline.dashboardJobId, {
              status: "processing",
              stage: "diarizing",
              progress: Math.round(job.progress),
            });
          } else if (job.state === "DONE") {
            if (pipeline.skipTranslation) {
              pipeline.phase = "done";
              finalizePipeline(pipeline);
            } else {
              pipeline.phase = "translating";
              chainTranslation(pipeline);
            }
          } else if (job.state === "FAILED") {
            if (pipeline.skipTranslation) {
              // Diarization failed, no translation — finalize with STT results
              console.warn("Diarization failed, finalizing with STT only");
              pipeline.phase = "done";
              finalizePipeline(pipeline);
            } else {
              // Diarization failed — skip and continue to translation (graceful fallback)
              console.warn("Diarization failed, skipping to translation");
              pipeline.phase = "translating";
              chainTranslation(pipeline);
            }
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
              progress: Math.round(job.progress),
            });
          } else if (job.state === "DONE") {
            pipeline.phase = "done";
            finalizePipeline(pipeline);
          } else if (job.state === "FAILED") {
            // Translation failed — save STT results but mark as failed
            pipeline.phase = "error";
            const lines = buildSubtitleLines(pipeline);
            saveJobSubtitles(pipeline.dashboardJobId, lines).catch(() => {});
            onJobUpdate(pipeline.dashboardJobId, {
              status: "failed",
              stage: "translating",
              progress: 0,
              error: job.message ?? "Translation failed",
            });
            pipelinesRef.current.delete(pipeline.dashboardJobId);
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
          onLiveSegments?.(pipeline.dashboardJobId, buildSubtitleLines(pipeline));
          return;
        }
      }
    });

    const p2b = listen<DiarizationSegmentEvent>("diar-segment", (event) => {
      const seg = event.payload;
      for (const [, pipeline] of pipelinesRef.current) {
        if (pipeline.diarizationJobId === seg.job_id) {
          pipeline.speakerMap.set(seg.index, seg.speaker);
          onLiveSegments?.(pipeline.dashboardJobId, buildSubtitleLines(pipeline));
          return;
        }
      }
    });

    const p3 = listen<TranslateSegmentEvent>("translate-segment", (event) => {
      const seg = event.payload;
      for (const [, pipeline] of pipelinesRef.current) {
        if (pipeline.translateJobId === seg.job_id) {
          pipeline.translations.set(seg.index, seg.translated);
          onLiveSegments?.(pipeline.dashboardJobId, buildSubtitleLines(pipeline));
          return;
        }
      }
    });

    const p4 = listen("server-crashed", () => {
      // Fail all active pipelines
      for (const [, pipeline] of pipelinesRef.current) {
        pipeline.phase = "error";
        onJobUpdate(pipeline.dashboardJobId, {
          status: "failed",
          stage: "error",
          error: i18n.t("toast.serverCrashed"),
        });
      }
      pipelinesRef.current.clear();
    });

    Promise.all([p1, p2, p2b, p3, p4]).then((fns) => {
      unlistenersRef.current = fns;
    });

    return () => {
      unlistenersRef.current.forEach((fn) => fn());
      unlistenersRef.current = [];
    };
  }, [onJobUpdate, onLiveSegments]);

  async function chainDiarization(pipeline: ActivePipeline) {
    if (pipeline.segments.length === 0) {
      if (pipeline.skipTranslation) {
        pipeline.phase = "done";
        finalizePipeline(pipeline);
      } else {
        pipeline.phase = "translating";
        chainTranslation(pipeline);
      }
      return;
    }

    onJobUpdate(pipeline.dashboardJobId, {
      status: "processing",
      stage: "diarizing",
      progress: 40,
    });

    try {
      const diarSegments = pipeline.segments.map((s) => ({
        index: s.index,
        start: s.start,
        end: s.end,
        text: s.text,
      }));
      const job = await startDiarization(pipeline.filePath, diarSegments);
      pipeline.diarizationJobId = job.id;
    } catch {
      // Diarization start failed — graceful fallback
      console.warn("Diarization start failed, skipping to next phase");
      if (pipeline.skipTranslation) {
        pipeline.phase = "done";
        finalizePipeline(pipeline);
      } else {
        pipeline.phase = "translating";
        chainTranslation(pipeline);
      }
    }
  }

  const translationStartingRef = useRef(new Set<string>());

  async function chainTranslation(pipeline: ActivePipeline) {
    // Guard: prevent duplicate translation starts
    if (pipeline.translateJobId) return;
    if (translationStartingRef.current.has(pipeline.dashboardJobId)) return;
    translationStartingRef.current.add(pipeline.dashboardJobId);

    if (pipeline.segments.length === 0) {
      // No segments — skip translation
      pipeline.phase = "done";
      finalizePipeline(pipeline);
      return;
    }

    // Save intermediate STT results before starting translation
    try {
      const sttLines = buildSubtitleLines(pipeline);
      await saveJobSubtitles(pipeline.dashboardJobId, sttLines);
    } catch (e) {
      console.error("Failed to save intermediate STT results:", e);
    }

    onJobUpdate(pipeline.dashboardJobId, {
      status: "processing",
      stage: "translating",
      progress: 0,
    });

    try {
      // Restart server to cleanly free VRAM
      // (ctranslate2 Whisper unload segfaults on Windows — known CTranslate2 bug)
      await restartServer();

      const job = await startTranslate(pipeline.segments, pipeline.presetId);
      pipeline.translateJobId = job.id;
    } catch (e) {
      // Translation start failed — save STT results but mark as failed
      pipeline.phase = "error";
      const errorMsg = e instanceof Error ? e.message : String(e);
      toastError(i18n.t("toast.pipelineFailed"), errorMsg);
      onJobUpdate(pipeline.dashboardJobId, {
        status: "failed",
        stage: "translating",
        progress: 0,
        error: errorMsg,
      });
      pipelinesRef.current.delete(pipeline.dashboardJobId);
    } finally {
      translationStartingRef.current.delete(pipeline.dashboardJobId);
    }
  }

  async function finalizePipeline(pipeline: ActivePipeline) {
    const lines = buildSubtitleLines(pipeline);

    // Save to disk
    try {
      await saveJobSubtitles(pipeline.dashboardJobId, lines);
    } catch (e) {
      console.error("Failed to save subtitles:", e);
      toastError(i18n.t("toast.subtitleSaveFailed"));
    }

    onJobUpdate(pipeline.dashboardJobId, {
      status: "completed",
      stage: "done",
      progress: 100,
    });

    pipelinesRef.current.delete(pipeline.dashboardJobId);
  }

  const processJob = useCallback(
    async (dashboardJobId: string, filePath: string, sourceLanguage?: string, enableDiarization?: boolean, skipTranslation?: boolean, presetId?: string) => {
      const pipeline: ActivePipeline = {
        dashboardJobId,
        sttJobId: null,
        diarizationJobId: null,
        translateJobId: null,
        segments: [],
        translations: new Map(),
        speakerMap: new Map(),
        enableDiarization: enableDiarization ?? false,
        skipTranslation: skipTranslation ?? false,
        presetId,
        filePath,
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
        const errorMsg = e instanceof Error ? e.message : String(e);
        toastError(i18n.t("toast.pipelineFailed"), errorMsg);
        onJobUpdate(dashboardJobId, {
          status: "failed",
          stage: "error",
          error: errorMsg,
        });
        pipelinesRef.current.delete(dashboardJobId);
      }
    },
    [onJobUpdate],
  );

  const retryTranslation = useCallback(
    async (dashboardJobId: string, segments: SttSegment[], presetId?: string) => {
      const pipeline: ActivePipeline = {
        dashboardJobId,
        sttJobId: null,
        diarizationJobId: null,
        translateJobId: null,
        segments,
        translations: new Map(),
        speakerMap: new Map(),
        enableDiarization: false,
        skipTranslation: false,
        presetId,
        filePath: "",
        phase: "translating",
      };

      pipelinesRef.current.set(dashboardJobId, pipeline);
      chainTranslation(pipeline);
    },
    [],
  );

  const cancelJob = useCallback(async (dashboardJobId: string) => {
    const pipeline = pipelinesRef.current.get(dashboardJobId);
    if (!pipeline) return;

    try {
      if (pipeline.phase === "stt" && pipeline.sttJobId) {
        await cancelStt(pipeline.sttJobId);
      } else if (pipeline.phase === "diarizing" && pipeline.diarizationJobId) {
        await cancelDiarization(pipeline.diarizationJobId);
      } else if (pipeline.phase === "translating" && pipeline.translateJobId) {
        await cancelTranslate(pipeline.translateJobId);
      }
    } catch (e) {
      console.error("Failed to cancel pipeline:", e);
      toastError(i18n.t("toast.pipelineCancelFailed"));
    }
  }, []);

  return { processJob, retryTranslation, cancelJob };
}
