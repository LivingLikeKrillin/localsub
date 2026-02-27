import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useServerStatus } from "./hooks/useServerStatus";
import { useJobs } from "./hooks/useJobs";
import { useSetup } from "./hooks/useSetup";
import { useConfig } from "./hooks/useConfig";
import { useRuntime } from "./hooks/useRuntime";
import { useModels } from "./hooks/useModels";
import { SetupScreen } from "./components/SetupScreen";
import { WizardScreen } from "./components/wizard/WizardScreen";
import { AppShell } from "./components/layout/AppShell";
import { WorkspaceScreen } from "./components/workspace/WorkspaceScreen";
import { SettingsPage } from "./components/settings/SettingsPage";
import { ModelsPage } from "./components/models/ModelsPage";
import { saveGlossary } from "./lib/tauriApi";
import type { AppScreen, MainPage, GlossaryEntry } from "./types";

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

function App() {
  const { t } = useTranslation();
  const { config, loading: configLoading, update: updateConfig, reload: reloadConfig } = useConfig();
  const { status: setupStatus, progress, error: setupError, startSetup, retry } = useSetup();
  const { status: serverStatus, error: serverError, start: startServer, stop: stopServer } = useServerStatus();
  useJobs(); // keep listener active for future workspace integration
  const runtime = useRuntime();
  const models = useModels();

  const [activePage, setActivePage] = useState<MainPage>("workspace");
  const [glossaryEntries, setGlossaryEntries] = useState<GlossaryEntry[]>([]);

  const screen = determineScreen(configLoading, config, setupStatus);

  const handleWizardComplete = useCallback(() => {
    reloadConfig();
  }, [reloadConfig]);

  const handleSaveGlossary = useCallback(
    async (entries: GlossaryEntry[]) => {
      if (!config) return;
      await saveGlossary(config.active_glossary || "default", entries);
      setGlossaryEntries(entries);
    },
    [config],
  );

  // ── BOOT: Loading spinner ──
  if (screen === "BOOT") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2.5 text-slate-400">
          <span className="spinner" />
          <span>{t("app.loading")}</span>
        </div>
      </div>
    );
  }

  // ── WIZARD ──
  if (screen === "WIZARD") {
    return (
      <WizardScreen
        config={config!}
        onUpdateConfig={updateConfig}
        onComplete={handleWizardComplete}
      />
    );
  }

  // ── SETUP (fallback for pip install) ──
  if (screen === "SETUP") {
    return (
      <SetupScreen
        status={setupStatus}
        progress={progress}
        error={setupError}
        onStart={startSetup}
        onRetry={retry}
      />
    );
  }

  // ── MAIN: Sidebar + page content ──
  return (
    <AppShell
      activePage={activePage}
      runtime={runtime.status}
      onNavigate={setActivePage}
    >
      {activePage === "workspace" && (
        <WorkspaceScreen
          serverStatus={serverStatus}
          serverError={serverError}
          onStartServer={startServer}
          onStopServer={stopServer}
          resources={runtime.resources}
          runtimeStatus={runtime.status}
          onUnloadModel={runtime.unloadModel}
        />
      )}

      {activePage === "models" && (
        <ModelsPage
          manifest={models.manifest}
          onDelete={models.deleteModel}
          onDownload={models.startDownload}
        />
      )}

      {activePage === "settings" && config && (
        <SettingsPage
          config={config}
          manifest={models.manifest}
          glossaryEntries={glossaryEntries}
          onUpdateConfig={(patch) => updateConfig(patch)}
          onSaveGlossary={handleSaveGlossary}
          onDeleteModel={models.deleteModel}
          onDownloadModel={models.startDownload}
        />
      )}
    </AppShell>
  );
}

export default App;
