import { useTranslation } from "react-i18next";
import { useServerStatus } from "./hooks/useServerStatus";
import { useJobs } from "./hooks/useJobs";
import { useSetup } from "./hooks/useSetup";
import { ServerControl } from "./components/ServerControl";
import { InferenceForm } from "./components/InferenceForm";
import { JobList } from "./components/JobList";
import { SetupScreen } from "./components/SetupScreen";
import { startInference, cancelJob } from "./lib/tauriApi";

function App() {
  const { t } = useTranslation();
  const { status: setupStatus, progress, error: setupError, startSetup, retry } = useSetup();
  const { status, error, start, stop } = useServerStatus();
  const { jobs } = useJobs();

  const handleInference = async (inputText: string) => {
    try {
      await startInference(inputText);
    } catch (e) {
      console.error("Failed to start inference:", e);
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      await cancelJob(jobId);
    } catch (e) {
      console.error("Failed to cancel job:", e);
    }
  };

  if (setupStatus !== "COMPLETE" && setupStatus !== "CHECKING") {
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

  if (setupStatus === "CHECKING") {
    return (
      <div className="mx-auto max-w-[800px] p-6">
        <div className="flex items-center justify-center gap-2.5 p-4 text-slate-400">
          <span className="spinner" />
          <span>{t("app.loading")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[800px] p-6">
      <h1 className="mb-6 text-[1.75rem] font-bold text-slate-50">{t("app.title")}</h1>
      <ServerControl status={status} error={error} onStart={start} onStop={stop} />
      <InferenceForm disabled={status !== "RUNNING"} onSubmit={handleInference} />
      <JobList jobs={jobs} onCancel={handleCancel} />
    </div>
  );
}

export default App;
