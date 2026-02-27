import { useTranslation } from "react-i18next";
import type { ResourceUsage, RuntimeStatus, RuntimeModelStatus } from "../../types";

interface ResourceMonitorProps {
  resources: ResourceUsage;
  runtimeStatus?: RuntimeStatus;
  onUnloadModel?: (modelType: string) => void;
}

function UsageBar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  const color =
    pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-success";

  return (
    <div className="flex items-center gap-3">
      <span className="w-12 text-xs font-medium text-slate-400">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-700">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="w-24 text-right text-xs text-slate-500">
        {(used / 1024).toFixed(1)} / {(total / 1024).toFixed(1)} GB
      </span>
    </div>
  );
}

function ModelStatusRow({
  label,
  status,
  onUnload,
}: {
  label: string;
  status: RuntimeModelStatus;
  onUnload?: () => void;
}) {
  const { t } = useTranslation();

  const dotColor =
    status === "READY"
      ? "bg-green-500"
      : status === "LOADING"
        ? "bg-yellow-500 animate-pulse"
        : status === "ERROR"
          ? "bg-red-500"
          : "bg-slate-500";

  const statusLabel =
    status === "READY"
      ? t("workspace.resource.statusReady")
      : status === "LOADING"
        ? t("workspace.resource.statusLoading")
        : status === "ERROR"
          ? t("workspace.resource.statusError")
          : t("workspace.resource.statusUnloaded");

  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      <span className="text-xs font-medium text-slate-400">{label}</span>
      <span className="text-xs text-slate-500">{statusLabel}</span>
      {status === "READY" && onUnload && (
        <button
          onClick={onUnload}
          className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          {t("workspace.resource.unload")}
        </button>
      )}
    </div>
  );
}

export function ResourceMonitor({ resources, runtimeStatus, onUnloadModel }: ResourceMonitorProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl bg-surface p-4">
      <div className="flex flex-col gap-2">
        {runtimeStatus && (
          <>
            <ModelStatusRow
              label={t("workspace.resource.whisper")}
              status={runtimeStatus.whisper}
              onUnload={onUnloadModel ? () => onUnloadModel("whisper") : undefined}
            />
            <ModelStatusRow
              label={t("workspace.resource.llm")}
              status={runtimeStatus.llm}
              onUnload={onUnloadModel ? () => onUnloadModel("llm") : undefined}
            />
            <div className="my-1 border-t border-slate-700" />
          </>
        )}
        <UsageBar
          label={t("workspace.resource.ram")}
          used={resources.ram_used_mb}
          total={resources.ram_total_mb}
        />
        {resources.vram_total_mb !== null && resources.vram_used_mb !== null && (
          <UsageBar
            label={t("workspace.resource.vram")}
            used={resources.vram_used_mb}
            total={resources.vram_total_mb}
          />
        )}
      </div>
    </div>
  );
}
