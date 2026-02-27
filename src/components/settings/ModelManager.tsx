import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelManifestEntry } from "../../types";
import { ConfirmDialog } from "../shared/ConfirmDialog";

interface ModelManagerProps {
  manifest: ModelManifestEntry[];
  onDelete: (id: string) => void;
  onDownload: (id: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

const statusColor: Record<string, string> = {
  ready: "text-success",
  downloading: "text-primary",
  verifying: "text-warning",
  missing: "text-slate-500",
  corrupt: "text-danger",
};

export function ModelManager({
  manifest,
  onDelete,
  onDownload,
}: ModelManagerProps) {
  const { t } = useTranslation();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  return (
    <div>
      <h3 className="mb-4 text-base font-semibold text-slate-50">
        {t("settings.models.title")}
      </h3>

      {manifest.length === 0 ? (
        <p className="text-sm text-slate-500">{t("settings.models.empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {manifest.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-lg border border-border p-3"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">
                    {m.name}
                  </span>
                  <span className="rounded bg-surface-inset px-1.5 py-0.5 text-xs text-slate-500">
                    {m.model_type}
                  </span>
                </div>
                <div className="mt-1 flex gap-3 text-xs text-slate-500">
                  <span>{formatSize(m.size_bytes)}</span>
                  <span className={statusColor[m.status] ?? "text-slate-500"}>
                    {t(`settings.models.status.${m.status}`)}
                  </span>
                </div>
              </div>

              {m.status === "ready" && (
                <button
                  className="cursor-pointer rounded px-3 py-1 text-xs text-danger transition-colors hover:bg-danger/10"
                  onClick={() => setDeleteTarget(m.id)}
                >
                  {t("settings.models.delete")}
                </button>
              )}
              {(m.status === "missing" || m.status === "corrupt") && (
                <button
                  className="cursor-pointer rounded bg-primary px-3 py-1 text-xs text-white transition-opacity hover:opacity-85"
                  onClick={() => onDownload(m.id)}
                >
                  {t("settings.models.download")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("settings.models.confirmDelete")}
        message={t("settings.models.confirmDeleteMsg")}
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
