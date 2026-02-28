import { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Download, Trash2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { ModelManifestEntry, PartialConfig } from "@/types"

interface ModelsSectionProps {
  manifest: ModelManifestEntry[]
  activeWhisperModel: string | null
  activeLlmModel: string | null
  onUpdate: (patch: PartialConfig) => void
  onDelete: (id: string) => void
  onDownload: (id: string) => void
}

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ready: "default",
  downloading: "secondary",
  verifying: "secondary",
  missing: "outline",
  corrupt: "destructive",
}

export function ModelsSection({
  manifest,
  activeWhisperModel,
  activeLlmModel,
  onUpdate,
  onDelete,
  onDownload,
}: ModelsSectionProps) {
  const { t } = useTranslation()
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const whisperModels = useMemo(() => manifest.filter((m) => m.model_type === "whisper"), [manifest])
  const llmModels = useMemo(() => manifest.filter((m) => m.model_type === "llm"), [manifest])

  function handleSelectActive(type: "whisper" | "llm", id: string) {
    if (type === "whisper") {
      onUpdate({ active_whisper_model: id })
    } else {
      onUpdate({ active_llm_model: id })
    }
  }

  function renderModelGroup(
    title: string,
    models: ModelManifestEntry[],
    activeId: string | null,
    type: "whisper" | "llm",
  ) {
    if (models.length === 0) return null

    return (
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-medium">{title}</h4>
        <RadioGroup
          value={activeId ?? ""}
          onValueChange={(id) => handleSelectActive(type, id)}
          className="flex flex-col gap-2"
        >
          {models.map((m) => {
            const canActivate = m.status === "ready"
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/30"
              >
                {canActivate && (
                  <RadioGroupItem value={m.id} id={`model-${m.id}`} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`model-${m.id}`} className="text-sm font-medium cursor-pointer">
                      {m.name}
                    </Label>
                    {m.id === activeId && (
                      <Badge variant="default" className="text-[10px] h-5 gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {t("settings.models.active")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{formatSize(m.size_bytes)}</span>
                    <Badge variant={STATUS_VARIANT[m.status] ?? "outline"} className="text-[10px] h-4">
                      {t(`settings.models.status.${m.status}` as const)}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {m.status === "ready" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(m.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {(m.status === "missing" || m.status === "corrupt") && (
                    <Button variant="outline" size="sm" onClick={() => onDownload(m.id)}>
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      {t("settings.models.download")}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </RadioGroup>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold">{t("settings.models.title")}</h3>
        <p className="text-sm text-muted-foreground mt-1">{t("settings.models.description")}</p>
      </div>

      {manifest.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("settings.models.empty")}</p>
      ) : (
        <>
          {renderModelGroup(t("settings.models.whisperSection"), whisperModels, activeWhisperModel, "whisper")}
          {renderModelGroup(t("settings.models.llmSection"), llmModels, activeLlmModel, "llm")}
        </>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.models.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.models.confirmDeleteMsg")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("shared.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteTarget) onDelete(deleteTarget); setDeleteTarget(null) }}
            >
              {t("settings.models.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
