import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
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
import { DashboardPage, type DashboardJob } from "./components/dashboard/DashboardPage";
import { EditorPage } from "./components/editor/EditorPage";
import { PresetsPage } from "./components/presets/PresetsPage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { Toaster } from "./components/ui/sonner";
import type { AppScreen, MainPage } from "./types";

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

function App() {
  const { t } = useTranslation();
  const { config, loading: configLoading, update: updateConfig, reload: reloadConfig } = useConfig();
  const { status: setupStatus, progress, error: setupError, startSetup, retry } = useSetup();
  useServerStatus(); // keep active for pipeline
  useJobs(); // keep listener active
  useRuntime(); // keep polling active
  const models = useModels();
  const { hardware, detect: detectHw } = useHardware();
  const presetsHook = usePresets();
  const vocabulariesHook = useVocabularies();

  const [activePage, setActivePage] = useState<MainPage>("dashboard");
  const [dashboardJobs, setDashboardJobs] = useState<DashboardJob[]>([]);
  const [editorJobId, setEditorJobId] = useState<string | null>(null);

  const handleJobUpdate = useCallback(
    (jobId: string, update: { status?: DashboardJob["status"]; stage?: DashboardJob["stage"]; progress?: number; error?: string }) => {
      setDashboardJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, ...update } : j)),
      );
    },
    [],
  );

  const { processJob } = usePipeline(handleJobUpdate);

  const screen = determineScreen(configLoading, config, setupStatus);

  // Auto-detect hardware when entering main screen
  useEffect(() => {
    if (screen === "MAIN" && !hardware) {
      detectHw();
    }
  }, [screen, hardware, detectHw]);

  const handleWizardComplete = useCallback(() => {
    reloadConfig();
  }, [reloadConfig]);

  const handleNewJob = useCallback(
    (files: { name: string; path: string; size: number }[], presetId: string) => {
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

      // Trigger pipeline for each job
      const sourceLanguage = config?.source_language;
      for (const job of newJobs) {
        processJob(job.id, job.file_path, sourceLanguage === "auto" ? undefined : sourceLanguage);
      }
    },
    [processJob, config?.source_language],
  );

  const handleRemoveJob = useCallback((id: string) => {
    setDashboardJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  // ── BOOT: Loading spinner ──
  if (screen === "BOOT") {
    return (
      <ThemeProvider defaultTheme="dark">
        <div className="flex min-h-screen items-center justify-center">
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
      <SidebarProvider>
        <AppSidebar
          activePage={activePage}
          onNavigate={setActivePage}
          hardwareInfo={hardware}
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
                onOpenEditor={(jobId) => {
                  setEditorJobId(jobId);
                  setActivePage("editor");
                }}
              />
            )}

            {activePage === "editor" && config && (
              <EditorPage
                jobId={editorJobId}
                outputDir={config.output_dir}
                subtitleFormat={config.subtitle_format}
              />
            )}

            {activePage === "presets" && (
              <PresetsPage
                presets={presetsHook.presets}
                vocabularies={vocabulariesHook.vocabularies}
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
                onUpdateConfig={(patch) => updateConfig(patch)}
                onDeleteModel={models.deleteModel}
                onDownloadModel={models.startDownload}
              />
            )}
          </div>
        </SidebarInset>
      </SidebarProvider>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
