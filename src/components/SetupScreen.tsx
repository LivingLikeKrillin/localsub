import { useTranslation } from "react-i18next";
import type { SetupStatus, SetupProgress } from "../types";
import { Progress } from "./Progress";

interface SetupScreenProps {
  status: SetupStatus;
  progress: SetupProgress | null;
  error: string | null;
  onStart: () => void;
  onRetry: () => void;
}

export function SetupScreen({ status, progress, error, onStart, onRetry }: SetupScreenProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-[500px] rounded-2xl bg-surface p-10 text-center">
        <h1 className="mb-4 text-[1.75rem] font-bold text-slate-50">{t("app.title")}</h1>
        <p className="mb-6 text-[0.9rem] leading-relaxed text-slate-400">
          {t("setup.description")}
        </p>

        {status === "CHECKING" && (
          <div className="flex items-center justify-center gap-2.5 p-4 text-slate-400">
            <span className="spinner" />
            <span>{t("setup.checking")}</span>
          </div>
        )}

        {status === "NEEDED" && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-slate-500">
              {t("setup.needed")}
            </p>
            <button
              className="cursor-pointer rounded-md bg-primary px-8 py-3 text-base font-medium text-white transition-opacity hover:opacity-85"
              onClick={onStart}
            >
              {t("setup.startButton")}
            </button>
          </div>
        )}

        {status === "IN_PROGRESS" && (
          <div className="flex flex-col gap-3">
            <Progress value={(progress?.progress ?? 0) * 100} />
            <p className="text-sm text-slate-400">
              {progress?.message ?? t("setup.startingFallback")}
            </p>
          </div>
        )}

        {status === "ERROR" && (
          <div className="flex flex-col items-center gap-4">
            <p className="w-full max-h-[120px] overflow-y-auto break-words rounded-md bg-surface-inset p-2.5 text-left text-xs text-danger">
              {error ?? t("setup.unknownError")}
            </p>
            <button
              className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
              onClick={onRetry}
            >
              {t("setup.retryButton")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
