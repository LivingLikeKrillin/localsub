import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Job } from "../types";
import { Progress } from "./Progress";

interface Props {
  job: Job;
  onCancel: (jobId: string) => void;
}

const borderColor: Record<string, string> = {
  QUEUED: "border-l-slate-600",
  RUNNING: "border-l-primary",
  DONE: "border-l-success",
  FAILED: "border-l-danger",
  CANCELED: "border-l-warning",
};

const badgeBg: Record<string, string> = {
  QUEUED: "bg-gray-500",
  RUNNING: "bg-primary",
  DONE: "bg-success",
  FAILED: "bg-danger",
  CANCELED: "bg-warning",
};

export function JobCard({ job, onCancel }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const stateLabel: Record<string, string> = {
    QUEUED: t("jobs.state.queued"),
    RUNNING: t("jobs.state.running"),
    DONE: t("jobs.state.done"),
    FAILED: t("jobs.state.failed"),
    CANCELED: t("jobs.state.canceled"),
  };

  const handleCopy = async () => {
    if (job.result) {
      await navigator.clipboard.writeText(job.result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className={`rounded-[10px] border-l-4 bg-surface p-4 ${borderColor[job.state] ?? "border-l-border"}`}
    >
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="font-mono text-xs text-slate-400" title={job.id}>
          {job.id.slice(0, 8)}...
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold text-white ${badgeBg[job.state] ?? "bg-gray-500"}`}
        >
          {stateLabel[job.state] ?? job.state}
        </span>
      </div>

      <div className="mb-2.5 break-words text-sm text-slate-400">
        <strong>{t("jobs.inputLabel")}</strong> {job.input_text}
      </div>

      {(job.state === "RUNNING" || job.state === "QUEUED") && (
        <Progress value={job.progress} />
      )}

      {job.message && job.state === "RUNNING" && (
        <div className="mb-1.5 text-xs text-slate-500">{job.message}</div>
      )}

      {job.state === "DONE" && job.result && (
        <div className="mt-2">
          <strong>{t("jobs.resultLabel")}</strong>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-surface-inset p-2.5 text-sm">
            {job.result}
          </pre>
          <button
            className="mt-1.5 cursor-pointer rounded-md bg-border px-2.5 py-1 text-xs text-slate-200 transition-opacity hover:opacity-85"
            onClick={handleCopy}
          >
            {copied ? t("jobs.copiedButton") : t("jobs.copyButton")}
          </button>
        </div>
      )}

      {job.state === "FAILED" && job.error && (
        <div className="mt-2 text-sm text-danger">
          <strong>{t("jobs.errorLabel")}</strong> {job.error}
        </div>
      )}

      {(job.state === "RUNNING" || job.state === "QUEUED") && (
        <button
          className="mt-2 cursor-pointer rounded-md bg-warning px-4 py-2 text-sm font-medium text-surface transition-opacity hover:opacity-85"
          onClick={() => onCancel(job.id)}
        >
          {t("jobs.cancelButton")}
        </button>
      )}
    </div>
  );
}
