import { useRef, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { SubtitleLine } from "@/types"

interface SubtitleListProps {
  lines: SubtitleLine[]
  selectedId: string | null
  currentTime: number
  onSelect: (id: string) => void
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  translated: "default",
  untranslated: "outline",
  spell_error: "destructive",
  editing: "secondary",
}

export function SubtitleList({ lines, selectedId, currentTime, onSelect }: SubtitleListProps) {
  const { t } = useTranslation()
  const selectedRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to selected
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
  }, [selectedId])

  if (lines.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {t("editor.noSubtitles")}
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-0.5 p-2">
        {lines.map((line) => {
          const isSelected = line.id === selectedId
          const isActive = currentTime >= line.start_time && currentTime <= line.end_time

          return (
            <div
              key={line.id}
              ref={isSelected ? selectedRef : undefined}
              className={`flex gap-3 rounded-md px-3 py-2 cursor-pointer transition-colors ${
                isSelected
                  ? "bg-primary/10 ring-1 ring-primary/30"
                  : isActive
                    ? "bg-muted/60"
                    : "hover:bg-muted/30"
              }`}
              onClick={() => onSelect(line.id)}
            >
              {/* Index + time */}
              <div className="flex flex-col items-end gap-0.5 w-16 shrink-0">
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  #{line.index}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {formatTimestamp(line.start_time)}
                </span>
              </div>

              {/* Text content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug">{line.original_text}</p>
                {line.translated_text && (
                  <p className="text-sm leading-snug text-primary/80 mt-0.5">{line.translated_text}</p>
                )}
              </div>

              {/* Status badge */}
              <Badge
                variant={STATUS_VARIANT[line.status] ?? "outline"}
                className="text-[10px] h-4 shrink-0 self-start mt-0.5"
              >
                {t(`editor.status.${line.status}` as never)}
              </Badge>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}
