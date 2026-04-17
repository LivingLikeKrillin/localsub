import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, RefreshCw } from "lucide-react";
import { toastError } from "./lib/toast";
import { useServerStatus } from "./hooks/useServerStatus";
import { useJobs } from "./hooks/useJobs";
import { useSetup } from "./hooks/useSetup";
import { useConfig } from "./hooks/useConfig";
import { useRuntime } from "./hooks/useRuntime";
import { useModels } from "./hooks/useModels";
import { useHardware } from "./hooks/useHardware";
import { usePresets } from "./hooks/usePresets";
import { useVocabularies } from "./hooks/useVocabularies";
import { usePipeline } from "./hooks/usePipeline";
import { SetupScreen } from "./components/SetupScreen";
import { WizardScreen } from "./components/wizard/WizardScreen";
import { ThemeProvider } from "./components/theme-provider";
import { AppSidebar } from "./components/app-sidebar";
import { PageHeader } from "./components/page-header";
import { SidebarProvider, SidebarInset } from "./components/ui/sidebar";
import { DashboardPage } from "./components/dashboard/DashboardPage";
import { EditorPage } from "./components/editor/EditorPage";
import { PresetsPage } from "./components/presets/PresetsPage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { Toaster } from "./components/ui/sonner";
import { Button } from "./components/ui/button";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { AppScreen, MainPage, DashboardJob, SubtitleLine } from "./types";
import { loadDashboardJobs, saveDashboardJobs, loadJobSubtitles } from "./lib/tauriApi";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

function determineScreen(
  configLoading: boolean,
  config: { wizard_completed: boolean } | null,
  setupStatus: string,
): AppScreen {
  if (configLoading || setupStatus === "CHECKING") return "BOOT";
  if (!config || !config.wizard_completed) return "WIZARD";
  if (setupStatus !== "COMPLETE") return "SETUP";
  return "MAIN";
}

const PAGE_TITLES = {
  dashboard: { titleKey: "nav.dashboard" as const, descKey: "dashboard.description" as const },
  editor: { titleKey: "nav.editor" as const, descKey: "editor.description" as const },
  presets: { titleKey: "nav.presets" as const, descKey: "presets.description" as const },
  settings: { titleKey: "nav.settings" as const, descKey: "settings.description" as const },
} satisfies Record<MainPage, { titleKey: string; descKey?: string }>;

interface QueueEntry {
  jobId: string;
  filePath: string;
  sourceLanguage?: string;
  enableDiarization: boolean;
  skipTranslation: boolean;
  presetId?: string;
}

function App() {
  const { t } = useTranslation();
  const { config, loading: configLoading, error: configError, update: updateConfig, reload: reloadConfig } = useConfig();
  const { status: setupStatus, progress, error: setupError, startSetup, retry } = useSetup();
  const serverHook = useServerStatus();

  // Auto-start Python server when app loads
  useEffect(() => {
    if (serverHook.status === "STOPPED") {
      serverHook.start();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useJobs(); // keep listener active
  useRuntime(); // keep polling active
  const models = useModels();
  const { hardware, detect: detectHw } = useHardware();
  const presetsHook = usePresets();
  const vocabulariesHook = useVocabularies();

  const [activePage, setActivePage] = useState<MainPage>("dashboard");
  const [dashboardJobs, setDashboardJobs] = useState<DashboardJob[]>([]);
  const [editorJobId, setEditorJobId] = useState<string | null>(null);
  const [editorFilePath, setEditorFilePath] = useState<string | null>(null);
  const [liveLines, setLiveLines] = useState<Map<string, SubtitleLine[]>>(new Map());

  // ── Job queue ──
  const queueRef = useRef<QueueEntry[]>([]);
  const activeCountRef = useRef(0);
  const drainQueueRef = useRef(() => {});

  const handleJobUpdate = useCallback(
    (jobId: string, update: { status?: DashboardJob["status"]; stage?: DashboardJob["stage"]; progress?: number; error?: string; duration?: number }) => {
      setDashboardJobs((prev) =>
        prev.map((j) => {
          if (j.id !== jobId) return j;
          const patched = { ...j, ...update };
          // Set completed_at when job finishes or fails
          if ((update.status === "completed" || update.status === "failed") && !j.completed_at) {
            patched.completed_at = new Date().toISOString();
          }
          return patched;
        }),
      );
      // Send desktop notification when pipeline finishes
      if (update.status === "completed" || update.status === "failed") {
        const finishedJob = dashboardJobs.find((j) => j.id === jobId);
        const fileName = finishedJob?.file_name ?? jobId;
        isPermissionGranted().then(async (granted) => {
          if (!granted) {
            const result = await requestPermission();
            granted = result === "granted";
          }
          if (granted) {
            sendNotification({
              title: update.status === "completed"
                ? t("notification.completed", { name: fileName })
                : t("notification.failed", { name: fileName }),
              body: update.status === "completed"
                ? t("notification.completedBody")
                : (update.error ?? t("notification.failedBody")),
            });
          }
        }).catch(() => { /* notification not critical */ });
      }
      // Clear liveLines and drain queue when pipeline finishes
      if (update.status === "completed" || update.status === "failed") {
        setLiveLines((prev) => {
          if (!prev.has(jobId)) return prev;
          const next = new Map(prev);
          next.delete(jobId);
          return next;
        });
        activeCountRef.current = Math.max(0, activeCountRef.current - 1);
        // Use setTimeout to ensure drainQueue runs after state updates
        setTimeout(() => drainQueueRef.current(), 0);
      }
    },
    [],
  );

  const handleLiveSegments = useCallback((jobId: string, lines: SubtitleLine[]) => {
    setLiveLines((prev) => {
      const next = new Map(prev);
      next.set(jobId, lines);
      return next;
    });
  }, []);

  const { processJob, retryTranslation } = usePipeline(handleJobUpdate, handleLiveSegments);

  const drainQueue = useCallback(() => {
    // GPU pipeline must run one at a time (VRAM shared between STT and LLM)
    while (queueRef.current.length > 0 && activeCountRef.current < 1) {
      const entry = queueRef.current.shift()!;
      activeCountRef.current++;
      processJob(entry.jobId, entry.filePath, entry.sourceLanguage, entry.enableDiarization, entry.skipTranslation, entry.presetId);
    }
  }, [processJob]);
  drainQueueRef.current = drainQueue;

  const screen = determineScreen(configLoading, config, setupStatus);

  // Auto-detect hardware when entering main screen
  useEffect(() => {
    if (screen === "MAIN" && !hardware) {
      detectHw();
    }
  }, [screen, hardware, detectHw]);

  // Lazy-load model catalog when entering settings
  useEffect(() => {
    if (activePage === "settings" && !models.catalog) {
      models.loadCatalog();
    }
  }, [activePage, models.catalog, models.loadCatalog]);

  // Load persisted jobs when entering main screen
  const [jobsLoaded, setJobsLoaded] = useState(false);
  useEffect(() => {
    if (screen === "MAIN" && !jobsLoaded) {
      loadDashboardJobs()
        .then((saved) => {
          if (saved.length > 0) {
            // Recover stuck jobs: processing → failed (no active pipeline after restart)
            const recovered = saved.map((j) =>
              j.status === "processing"
                ? { ...j, status: "failed" as const, error: "Interrupted by app restart" }
                : j,
            );
            setDashboardJobs(recovered);
          }
          setJobsLoaded(true);
        })
        .catch((e) => {
          console.error("Failed to load dashboard jobs:", e);
          toastError(t("toast.jobsLoadFailed"));
          setJobsLoaded(true);
        });
    }
  }, [screen, jobsLoaded]);

  // Persist jobs to disk whenever they change (after initial load)
  useEffect(() => {
    if (!jobsLoaded) return;
    saveDashboardJobs(dashboardJobs).catch((e) => {
      console.error("Failed to save dashboard jobs:", e);
      toastError(t("toast.jobsSaveFailed"));
    });
  }, [dashboardJobs, jobsLoaded]);

  const handleWizardComplete = useCallback(() => {
    reloadConfig();
  }, [reloadConfig]);

  const handleNewJob = useCallback(
    (files: { name: string; path: string; size: number }[], presetId: string, enableDiarization: boolean = false, skipTranslation: boolean = false) => {
      const newJobs: DashboardJob[] = files.map((f) => ({
        id: crypto.randomUUID(),
        file_name: f.name,
        file_path: f.path,
        file_size: f.size,
        duration: 0,
        preset_id: presetId,
        status: "pending" as const,
        stage: "stt" as const,
        progress: 0,
        created_at: new Date().toISOString(),
      }));
      setDashboardJobs((prev) => [...newJobs, ...prev]);

      // Auto-navigate to editor for the first job
      const first = newJobs[0];
      if (first) {
        setEditorJobId(first.id);
        setEditorFilePath(first.file_path);
        setActivePage("editor");
      }

      // Enqueue jobs and drain up to concurrency limit
      const sourceLanguage = config?.source_language;
      for (const job of newJobs) {
        queueRef.current.push({
          jobId: job.id,
          filePath: job.file_path,
          sourceLanguage: sourceLanguage === "auto" ? undefined : sourceLanguage,
          enableDiarization,
          skipTranslation,
          presetId,
        });
      }
      drainQueue();
    },
    [drainQueue, config?.source_language],
  );

  const handleRemoveJob = useCallback((id: string) => {
    queueRef.current = queueRef.current.filter((e) => e.jobId !== id);
    setDashboardJobs((prev) => {
      const job = prev.find((j) => j.id === id);
      if (job && job.status === "processing") {
        activeCountRef.current = Math.max(0, activeCountRef.current - 1);
        setTimeout(() => drainQueueRef.current(), 0);
      }
      return prev.filter((j) => j.id !== id);
    });
  }, []);

  const handleRetryJob = useCallback(
    async (jobId: string) => {
      const job = dashboardJobs.find((j) => j.id === jobId);
      if (!job) return;

      // Try to load existing subtitles — if they have original_text, skip STT
      try {
        const existing = await loadJobSubtitles(jobId);
        if (existing.length > 0 && existing[0].original_text) {
          // Has STT results — retry translation only
          activeCountRef.current++;
          setDashboardJobs((prev) =>
            prev.map((j) =>
              j.id === jobId
                ? { ...j, status: "processing" as const, stage: "translating" as const, progress: 50, error: undefined, completed_at: undefined }
                : j,
            ),
          );
          const segments = existing.map((l) => ({
            index: l.index,
            start: l.start_time,
            end: l.end_time,
            text: l.original_text,
          }));
          // Pass the job's preset_id so the retry picks up the current
          // preset on disk — lets users change translation_mode
          // (e.g. direct → pivot_2pass) and re-run translation without
          // redoing STT.
          retryTranslation(jobId, segments, job.preset_id);
          return;
        }
      } catch {
        // No existing subtitles — full retry
      }

      setDashboardJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, status: "pending" as const, stage: "stt" as const, progress: 0, error: undefined, completed_at: undefined }
            : j,
        ),
      );
      const sourceLanguage = config?.source_language;
      queueRef.current.push({
        jobId: job.id,
        filePath: job.file_path,
        sourceLanguage: sourceLanguage === "auto" ? undefined : sourceLanguage,
        enableDiarization: false,
        skipTranslation: false,
      });
      drainQueue();
    },
    [dashboardJobs, drainQueue, retryTranslation, config?.source_language],
  );

  // ── Config error screen ──
  if (configError && !configLoading && !config) {
    return (
      <ThemeProvider defaultTheme="dark">
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center max-w-sm">
            <div className="rounded-2xl bg-destructive/10 p-4 ring-1 ring-destructive/30">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <div>
              <p className="font-semibold text-lg">{t("configError.title")}</p>
              <p className="text-sm text-muted-foreground mt-1">{t("configError.description")}</p>
              <p className="text-xs text-destructive mt-2 font-mono break-all">{configError}</p>
            </div>
            <Button onClick={reloadConfig} variant="outline" size="sm">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("configError.retry")}
            </Button>
          </div>
        </div>
        <Toaster />
      </ThemeProvider>
    );
  }

  // ── BOOT: Loading spinner ──
  if (screen === "BOOT") {
    return (
      <ThemeProvider defaultTheme="dark">
        <div className="flex h-full items-center justify-center">
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <span className="spinner" />
            <span>{t("app.loading")}</span>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  // ── WIZARD ──
  if (screen === "WIZARD") {
    return (
      <ThemeProvider defaultTheme="dark">
        <WizardScreen
          config={config!}
          onUpdateConfig={updateConfig}
          onComplete={handleWizardComplete}
        />
      </ThemeProvider>
    );
  }

  // ── SETUP (fallback for pip install) ──
  if (screen === "SETUP") {
    return (
      <ThemeProvider defaultTheme="dark">
        <SetupScreen
          status={setupStatus}
          progress={progress}
          error={setupError}
          onStart={startSetup}
          onRetry={retry}
        />
      </ThemeProvider>
    );
  }

  // ── MAIN: Sidebar + page content ──
  const pageInfo = PAGE_TITLES[activePage];

  return (
    <ThemeProvider defaultTheme="dark">
      <ErrorBoundary>
        <SidebarProvider>
          <AppSidebar
            activePage={activePage}
            onNavigate={setActivePage}
            hardwareInfo={hardware}
            serverStatus={serverHook.status}
            onRestartServer={serverHook.start}
          />
          <SidebarInset>
            <PageHeader
              title={t(pageInfo.titleKey)}
              description={pageInfo.descKey ? t(pageInfo.descKey) : undefined}
            />
            <div className="flex flex-1 flex-col overflow-auto p-4">
              {activePage === "dashboard" && (
                <DashboardPage
                  jobs={dashboardJobs}
                  presets={presetsHook.presets}
                  vocabularies={vocabulariesHook.vocabularies}
                  onNewJob={handleNewJob}
                  onRemoveJob={handleRemoveJob}
                  onRetryJob={handleRetryJob}
                  onUpdateVocabulary={vocabulariesHook.update}
                  onAddVocabulary={vocabulariesHook.add}
                  onUpdatePreset={presetsHook.update}
                  onOpenEditor={(jobId, filePath) => {
                    setEditorJobId(jobId);
                    setEditorFilePath(filePath);
                    setActivePage("editor");
                  }}
                />
              )}

              {activePage === "editor" && config && (
                <EditorPage
                  jobId={editorJobId}
                  filePath={editorFilePath}
                  outputDir={config.output_dir}
                  subtitleFormat={config.subtitle_format}
                  vocabularies={vocabulariesHook.vocabularies}
                  onUpdateVocabulary={vocabulariesHook.update}
                  liveLines={editorJobId ? liveLines.get(editorJobId) : undefined}
                />
              )}

              {activePage === "presets" && (
                <PresetsPage
                  presets={presetsHook.presets}
                  vocabularies={vocabulariesHook.vocabularies}
                  manifest={models.manifest}
                  onAddPreset={presetsHook.add}
                  onUpdatePreset={presetsHook.update}
                  onRemovePreset={presetsHook.remove}
                  onAddVocabulary={vocabulariesHook.add}
                  onUpdateVocabulary={vocabulariesHook.update}
                  onRemoveVocabulary={vocabulariesHook.remove}
                />
              )}

              {activePage === "settings" && config && (
                <SettingsPage
                  config={config}
                  manifest={models.manifest}
                  catalog={models.catalog}
                  hardware={hardware}
                  downloads={models.downloads}
                  onUpdateConfig={(patch) => updateConfig(patch)}
                  onDeleteModel={models.deleteModel}
                  onDownloadModel={models.startDownload}
                  onCancelDownload={models.cancelDownload}
                />
              )}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </ErrorBoundary>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
