import { useTranslation } from "react-i18next"
import { Clock, Type, ArrowRight } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { SubtitleLine } from "@/types"

interface EditPanelProps {
  line: SubtitleLine | null
  onUpdateLine: (id: string, updates: Partial<SubtitleLine>) => void
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
}

export function EditPanel({ line, onUpdateLine }: EditPanelProps) {
  const { t } = useTranslation()

  if (!line) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {t("editor.selectToEdit")}
        </p>
      </div>
    )
  }

  const duration = line.end_time - line.start_time
  const charCount = line.original_text.length
  const cps = duration > 0 ? Math.round(charCount / duration) : 0

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header: index + time range */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="tabular-nums">#{line.index}</Badge>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span className="tabular-nums">{formatTimestamp(line.start_time)}</span>
            <ArrowRight className="h-3 w-3" />
            <span className="tabular-nums">{formatTimestamp(line.end_time)}</span>
          </div>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {duration.toFixed(1)}s
        </Badge>
      </div>

      <Separator />

      {/* Original text */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">{t("editor.originalText")}</Label>
        <Textarea
          value={line.original_text}
          onChange={(e) => onUpdateLine(line.id, { original_text: e.target.value, status: "editing" })}
          rows={3}
          className="resize-none text-sm"
        />
      </div>

      {/* Translated text */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">{t("editor.translatedText")}</Label>
        <Textarea
          value={line.translated_text}
          onChange={(e) => onUpdateLine(line.id, { translated_text: e.target.value, status: "editing" })}
          rows={3}
          className="resize-none text-sm"
          placeholder={t("editor.translationPlaceholder")}
        />
      </div>

      <Separator />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<Type className="h-3 w-3" />} label={t("editor.stats.chars")} value={String(charCount)} />
        <StatCard icon={<Clock className="h-3 w-3" />} label={t("editor.stats.duration")} value={`${duration.toFixed(1)}s`} />
        <StatCard icon={<Type className="h-3 w-3" />} label={t("editor.stats.cps")} value={String(cps)} />
      </div>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  )
}
