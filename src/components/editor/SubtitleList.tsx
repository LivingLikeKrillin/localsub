import { useRef, useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Scissors, Merge, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import type { SubtitleLine, Vocabulary } from "@/types"
import type { SearchMatch } from "./EditorPage"

interface SubtitleListProps {
  lines: SubtitleLine[]
  selectedId: string | null
  currentTime: number
  onSelect: (id: string) => void
  onSeek?: (time: number) => void
  onSplit: (id: string) => void
  onMergeWithNext: (id: string) => void
  onDelete?: (id: string) => void
  highlightMatches?: SearchMatch[]
  currentMatchIndex?: number
  vocabularies?: Vocabulary[]
  readOnly?: boolean
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`
}

function HighlightedText({
  text,
  matches,
  allMatches,
  currentMatchIndex,
}: {
  text: string
  matches: SearchMatch[]
  allMatches: SearchMatch[]
  currentMatchIndex: number
}) {
  if (matches.length === 0) return <>{text}</>

  const sorted = [...matches].sort((a, b) => a.startIdx - b.startIdx)
  const parts: React.ReactNode[] = []
  let cursor = 0

  for (const match of sorted) {
    if (match.startIdx > cursor) {
      parts.push(text.slice(cursor, match.startIdx))
    }
    const globalIdx = allMatches.indexOf(match)
    const isCurrent = globalIdx === currentMatchIndex
    parts.push(
      <mark
        key={`${match.startIdx}-${match.length}`}
        className={isCurrent ? "bg-orange-400/70 text-foreground rounded-sm px-0.5" : "bg-yellow-300/50 text-foreground rounded-sm px-0.5"}
      >
        {text.slice(match.startIdx, match.startIdx + match.length)}
      </mark>,
    )
    cursor = match.startIdx + match.length
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }
  return <>{parts}</>
}

interface VocabTerm {
  source: string
  target: string
}

function VocabHighlightedText({
  text,
  vocabTerms,
  vocabRegex,
}: {
  text: string
  vocabTerms: VocabTerm[]
  vocabRegex: RegExp | null
}) {
  if (!vocabRegex || vocabTerms.length === 0) return <>{text}</>

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  // Reset regex state
  vocabRegex.lastIndex = 0
  while ((match = vocabRegex.exec(text)) !== null) {
    const matchedText = match[0]
    const idx = match.index

    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx))
    }

    // Find matching vocab term (case-insensitive)
    const term = vocabTerms.find((t) => t.source.toLowerCase() === matchedText.toLowerCase())

    parts.push(
      <span
        key={idx}
        className="underline decoration-dotted decoration-primary/60 underline-offset-2 cursor-help"
        title={term ? `→ ${term.target}` : undefined}
      >
        {text.slice(idx, idx + matchedText.length)}
      </span>,
    )
    lastIndex = idx + matchedText.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <>{parts}</>
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  translated: "default",
  untranslated: "outline",
  spell_error: "destructive",
  editing: "secondary",
}

export function SubtitleList({ lines, selectedId, currentTime, onSelect, onSeek, onSplit, onMergeWithNext, onDelete, highlightMatches, currentMatchIndex, vocabularies, readOnly }: SubtitleListProps) {
  const { t } = useTranslation()
  const selectedRef = useRef<HTMLDivElement>(null)
  const lastLineRef = useRef<HTMLDivElement>(null)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-scroll to last line in readOnly/live mode
  useEffect(() => {
    if (readOnly && lastLineRef.current) {
      lastLineRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
  }, [readOnly, lines.length])

  // Pre-compile vocab terms and regex for highlighting
  const { vocabTerms, vocabRegex } = useMemo(() => {
    if (!vocabularies || vocabularies.length === 0) return { vocabTerms: [], vocabRegex: null }
    const terms: VocabTerm[] = []
    for (const vocab of vocabularies) {
      for (const entry of vocab.entries) {
        if (entry.source.trim()) {
          terms.push({ source: entry.source, target: entry.target })
        }
      }
    }
    if (terms.length === 0) return { vocabTerms: terms, vocabRegex: null }
    // Sort by length descending so longer terms match first
    terms.sort((a, b) => b.source.length - a.source.length)
    const escaped = terms.map((t) => t.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    const regex = new RegExp(`(${escaped.join("|")})`, "gi")
    return { vocabTerms: terms, vocabRegex: regex }
  }, [vocabularies])

  // Auto-scroll to selected (delayed to avoid interfering with double-click)
  useEffect(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      if (selectedRef.current) {
        selectedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" })
      }
    }, 300)
    return () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current) }
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
        {lines.map((line, lineIndex) => {
          const isSelected = line.id === selectedId
          const isActive = !isSelected && currentTime >= line.start_time && currentTime <= line.end_time
          const duration = line.end_time - line.start_time
          const splitDisabled = readOnly || duration < 0.5
          const mergeDisabled = readOnly || lineIndex >= lines.length - 1
          const isLast = lineIndex === lines.length - 1

          return (
            <ContextMenu key={line.id}>
              <ContextMenuTrigger asChild>
                <div
                  ref={isSelected ? selectedRef : isLast && readOnly ? lastLineRef : undefined}
                  className={`flex gap-3 rounded-md px-3 py-2 cursor-pointer transition-colors select-none ${
                    isSelected
                      ? "bg-primary/10 ring-1 ring-primary/30"
                      : isActive
                        ? "bg-muted/60"
                        : "hover:bg-muted/30"
                  }`}
                  onClick={() => onSelect(line.id)}
                  onDoubleClick={() => onSeek?.(line.start_time + 0.01)}
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
                    {line.speaker && (
                      <span className="text-[10px] font-medium text-primary/70 mb-0.5 block">
                        [{line.speaker}]
                      </span>
                    )}
                    <p className="text-sm leading-snug">
                      {highlightMatches ? (
                        <HighlightedText
                          text={line.original_text}
                          matches={highlightMatches.filter((m) => m.lineId === line.id && m.field === "original")}
                          allMatches={highlightMatches}
                          currentMatchIndex={currentMatchIndex ?? -1}
                        />
                      ) : (
                        <VocabHighlightedText
                          text={line.original_text}
                          vocabTerms={vocabTerms}
                          vocabRegex={vocabRegex}
                        />
                      )}
                    </p>
                    {line.translated_text && (
                      <p className="text-sm leading-snug text-primary/80 mt-0.5">
                        {highlightMatches ? (
                          <HighlightedText
                            text={line.translated_text}
                            matches={highlightMatches.filter((m) => m.lineId === line.id && m.field === "translated")}
                            allMatches={highlightMatches}
                            currentMatchIndex={currentMatchIndex ?? -1}
                          />
                        ) : (
                          line.translated_text
                        )}
                      </p>
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
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  disabled={splitDisabled}
                  onClick={() => onSplit(line.id)}
                >
                  <Scissors className="mr-2 h-4 w-4" />
                  {t("editor.actions.split")}
                  <ContextMenuShortcut>Ctrl+Shift+S</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={mergeDisabled}
                  onClick={() => onMergeWithNext(line.id)}
                >
                  <Merge className="mr-2 h-4 w-4" />
                  {t("editor.actions.mergeNext")}
                  <ContextMenuShortcut>Ctrl+Shift+M</ContextMenuShortcut>
                </ContextMenuItem>
                {onDelete && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() => onDelete(line.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t("editor.delete")}
                      <ContextMenuShortcut>Del</ContextMenuShortcut>
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
    </ScrollArea>
  )
}
