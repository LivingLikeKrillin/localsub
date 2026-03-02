import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Save, Download, FileText, Undo2, Redo2, Search, Video, VideoOff } from "lucide-react"
import { toastSuccess, toastError } from "@/lib/toast"
import { convertFileSrc } from "@tauri-apps/api/core"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Waveform } from "./Waveform"
import { SubtitleList } from "./SubtitleList"
import { EditPanel } from "./EditPanel"
import { PlaybackControls } from "./PlaybackControls"
import { FindReplaceBar } from "./FindReplaceBar"
import { WaveformMinimap } from "./WaveformMinimap"
import { VideoPreview } from "./VideoPreview"
import { loadJobSubtitles, saveJobSubtitles, exportSubtitles } from "@/lib/tauriApi"
import { splitLine, mergeLines, reindex, getSplitTime, canSplit, canMerge } from "@/lib/subtitleOps"
import { useHistory } from "@/hooks/useHistory"
import type { SubtitleLine, Vocabulary } from "@/types"

export interface SearchMatch {
  lineId: string
  field: "original" | "translated"
  startIdx: number
  length: number
}

interface EditorPageProps {
  jobId: string | null
  filePath: string | null
  outputDir: string
  subtitleFormat: string
  vocabularies?: Vocabulary[]
  onUpdateVocabulary?: (v: Vocabulary) => Promise<Vocabulary[]>
}

export function EditorPage({ jobId, filePath, outputDir, subtitleFormat, vocabularies, onUpdateVocabulary }: EditorPageProps) {
  const { t } = useTranslation()
  const { present: lines, push: pushLines, undo, redo, reset: resetLines, canUndo, canRedo } = useHistory<SubtitleLine[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)

  // Media state (audio or video)
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const [mediaReady, setMediaReady] = useState(false)
  const [mediaDuration, setMediaDuration] = useState<number | null>(null)
  const [peaks, setPeaks] = useState<number[]>([])
  const [volume, setVolume] = useState(1)
  const [showVideo, setShowVideo] = useState(true)
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)

  // Zoom & Pan state
  const [zoomLevel, setZoomLevel] = useState(1)

  // Find & Replace state
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState("")
  const [replaceQuery, setReplaceQuery] = useState("")
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [searchOriginal, setSearchOriginal] = useState(false)
  const [matchIndex, setMatchIndex] = useState(0)

  // Load subtitles when jobId changes
  useEffect(() => {
    if (!jobId) {
      resetLines([])
      setSelectedId(null)
      setCurrentTime(0)
      setDirty(false)
      return
    }

    loadJobSubtitles(jobId)
      .then((data) => {
        resetLines(data)
        setSelectedId(null)
        setCurrentTime(0)
        setDirty(false)
      })
      .catch((e) => {
        console.error("Failed to load subtitles:", e)
        toastError(t("toast.subtitleLoadFailed"))
      })
  }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Detect video file by extension
  const isVideo = useMemo(() => {
    if (!filePath) return false
    const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
    return ["mp4", "mkv", "avi", "mov", "webm"].includes(ext)
  }, [filePath])

  // Media lifecycle: create HTMLAudioElement or HTMLVideoElement when filePath changes
  useEffect(() => {
    // Reset media state
    setMediaReady(false)
    setMediaDuration(null)
    setPeaks([])
    setVideoElement(null)

    if (mediaRef.current) {
      mediaRef.current.pause()
      mediaRef.current.src = ""
      mediaRef.current = null
    }

    if (!filePath) return

    const assetUrl = convertFileSrc(filePath)
    const media = isVideo ? document.createElement("video") : new Audio()
    mediaRef.current = media
    media.volume = volume
    media.playbackRate = playbackRate

    if (isVideo) {
      setVideoElement(media as HTMLVideoElement)
    }

    const onLoadedMetadata = () => {
      setMediaDuration(media.duration)
      setMediaReady(true)
    }
    const onTimeUpdate = () => {
      setCurrentTime(media.currentTime)
    }
    const onEnded = () => {
      setIsPlaying(false)
    }
    const onError = () => {
      console.warn("Media load failed, falling back to timer simulation")
      setMediaReady(false)
    }

    media.addEventListener("loadedmetadata", onLoadedMetadata)
    media.addEventListener("timeupdate", onTimeUpdate)
    media.addEventListener("ended", onEnded)
    media.addEventListener("error", onError)
    media.src = assetUrl

    return () => {
      media.removeEventListener("loadedmetadata", onLoadedMetadata)
      media.removeEventListener("timeupdate", onTimeUpdate)
      media.removeEventListener("ended", onEnded)
      media.removeEventListener("error", onError)
      media.pause()
      media.src = ""
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, isVideo])

  // Peaks extraction after audio is ready
  useEffect(() => {
    if (!mediaReady || !filePath) return

    const assetUrl = convertFileSrc(filePath)
    let cancelled = false

    async function extractPeaks() {
      try {
        const response = await fetch(assetUrl)
        const arrayBuffer = await response.arrayBuffer()
        const audioCtx = new AudioContext()
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

        if (cancelled) { audioCtx.close(); return }

        // Mono mixdown
        const numChannels = audioBuffer.numberOfChannels
        const length = audioBuffer.length
        const mono = new Float32Array(length)
        for (let ch = 0; ch < numChannels; ch++) {
          const channelData = audioBuffer.getChannelData(ch)
          for (let i = 0; i < length; i++) {
            mono[i] += channelData[i] / numChannels
          }
        }

        // Bucket into 2000 max-amplitude peaks
        const bucketCount = Math.min(2000, length)
        const bucketSize = Math.floor(length / bucketCount)
        const result: number[] = []
        for (let b = 0; b < bucketCount; b++) {
          let max = 0
          const start = b * bucketSize
          const end = Math.min(start + bucketSize, length)
          for (let i = start; i < end; i++) {
            const abs = Math.abs(mono[i])
            if (abs > max) max = abs
          }
          result.push(max)
        }

        if (!cancelled) setPeaks(result)
        audioCtx.close()
      } catch (e) {
        console.warn("Peak extraction failed:", e)
        if (!cancelled) setPeaks([])
      }
    }

    extractPeaks()
    return () => { cancelled = true }
  }, [mediaReady, filePath])

  // Sync volume to audio element
  useEffect(() => {
    if (mediaRef.current) mediaRef.current.volume = volume
  }, [volume])

  // Sync playback rate to audio element
  useEffect(() => {
    if (mediaRef.current) mediaRef.current.playbackRate = playbackRate
  }, [playbackRate])

  const subtitleDuration = useMemo(() => {
    if (lines.length === 0) return 0
    return Math.max(...lines.map((l) => l.end_time))
  }, [lines])

  const duration = mediaDuration ?? subtitleDuration

  // Zoom & Pan
  const visibleDuration = useMemo(() => duration / zoomLevel, [duration, zoomLevel])
  const [viewStart, setViewStart] = useState(0)

  const handleZoomIn = useCallback(() => {
    setZoomLevel((z) => Math.min(z * 2, 16))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoomLevel((z) => {
      const next = Math.max(z / 2, 1)
      if (next === 1) setViewStart(0)
      return next
    })
  }, [])

  const handleViewStartChange = useCallback(
    (vs: number) => {
      setViewStart(Math.max(0, Math.min(vs, Math.max(duration - visibleDuration, 0))))
    },
    [duration, visibleDuration],
  )

  // Auto-follow playhead during playback
  useEffect(() => {
    if (!isPlaying || zoomLevel <= 1) return
    if (currentTime < viewStart || currentTime > viewStart + visibleDuration) {
      setViewStart(Math.max(0, currentTime - visibleDuration * 0.25))
    }
  }, [currentTime, isPlaying, zoomLevel, viewStart, visibleDuration])

  // Reset zoom when job changes
  useEffect(() => {
    setZoomLevel(1)
    setViewStart(0)
  }, [jobId])

  const selectedLine = useMemo(
    () => lines.find((l) => l.id === selectedId) ?? null,
    [lines, selectedId],
  )

  // Timer simulation fallback (only when audio is NOT ready)
  useEffect(() => {
    if (mediaReady) return // real audio handles timeupdate
    if (!isPlaying) return
    const intervalMs = 100
    const interval = setInterval(() => {
      setCurrentTime((t) => {
        if (t >= duration) {
          setIsPlaying(false)
          return 0
        }
        return t + (intervalMs / 1000) * playbackRate
      })
    }, intervalMs)
    return () => clearInterval(interval)
  }, [mediaReady, isPlaying, duration, playbackRate])

  // Auto-select subtitle during playback (Sprint 4)
  useEffect(() => {
    if (!isPlaying) return
    const active = lines.find((l) => currentTime >= l.start_time && currentTime <= l.end_time)
    if (active && active.id !== selectedId) {
      setSelectedId(active.id)
    }
  }, [currentTime, isPlaying, lines, selectedId])

  const handleUpdateLine = useCallback((id: string, updates: Partial<SubtitleLine>) => {
    const updated = lines.map((l) => (l.id === id ? { ...l, ...updates } : l))
    pushLines(updated)
    setDirty(true)
  }, [lines, pushLines])

  const handleSave = useCallback(async () => {
    if (!jobId) return
    try {
      await saveJobSubtitles(jobId, lines)
      setDirty(false)
      toastSuccess(t("toast.subtitleSaved"))
    } catch (e) {
      console.error("Failed to save subtitles:", e)
      toastError(t("toast.subtitleSaveFailed"))
    }
  }, [jobId, lines, t])

  const handleExport = useCallback(async () => {
    if (!jobId || lines.length === 0) return
    try {
      const segments = lines.map((l) => ({
        index: l.index,
        start: l.start_time,
        end: l.end_time,
        text: l.original_text,
        translated: l.translated_text || undefined,
      }))
      await exportSubtitles(segments, subtitleFormat, outputDir, jobId)
      toastSuccess(t("toast.exportSuccess"))
    } catch (e) {
      console.error("Failed to export:", e)
      toastError(t("toast.exportFailed"))
    }
  }, [jobId, lines, subtitleFormat, outputDir, t])

  const handleSplitLine = useCallback((id: string) => {
    const idx = lines.findIndex((l) => l.id === id)
    if (idx < 0) return
    const line = lines[idx]
    if (!canSplit(line)) return
    const time = getSplitTime(line, currentTime)
    const [first, second] = splitLine(line, time)
    const next = [...lines]
    next.splice(idx, 1, first, second)
    pushLines(reindex(next))
    setSelectedId(first.id)
    setDirty(true)
  }, [lines, currentTime, pushLines])

  const handleMergeWithNext = useCallback((id: string) => {
    const idx = lines.findIndex((l) => l.id === id)
    if (idx < 0 || idx >= lines.length - 1) return
    const merged = mergeLines(lines[idx], lines[idx + 1])
    const next = [...lines]
    next.splice(idx, 2, merged)
    pushLines(reindex(next))
    setSelectedId(merged.id)
    setDirty(true)
  }, [lines, pushLines])

  const handleDeleteLine = useCallback((id: string) => {
    const next = reindex(lines.filter((l) => l.id !== id))
    pushLines(next)
    if (selectedId === id) setSelectedId(null)
    setDirty(true)
  }, [lines, pushLines, selectedId])

  const handleTogglePlay = useCallback(() => {
    if (mediaReady && mediaRef.current) {
      if (isPlaying) {
        mediaRef.current.pause()
      } else {
        mediaRef.current.play()
      }
    }
    setIsPlaying((p) => !p)
  }, [mediaReady, isPlaying])

  // Find & Replace: compute matches
  const searchMatches = useMemo<SearchMatch[]>(() => {
    if (!findQuery) return []
    const matches: SearchMatch[] = []
    const query = caseSensitive ? findQuery : findQuery.toLowerCase()
    for (const line of lines) {
      if (searchOriginal) {
        const text = caseSensitive ? line.original_text : line.original_text.toLowerCase()
        let idx = 0
        while ((idx = text.indexOf(query, idx)) !== -1) {
          matches.push({ lineId: line.id, field: "original", startIdx: idx, length: findQuery.length })
          idx += findQuery.length
        }
      } else {
        const text = caseSensitive ? line.translated_text : line.translated_text.toLowerCase()
        let idx = 0
        while ((idx = text.indexOf(query, idx)) !== -1) {
          matches.push({ lineId: line.id, field: "translated", startIdx: idx, length: findQuery.length })
          idx += findQuery.length
        }
      }
    }
    return matches
  }, [lines, findQuery, caseSensitive, searchOriginal])

  // Reset matchIndex when matches change
  useEffect(() => {
    if (matchIndex >= searchMatches.length) {
      setMatchIndex(0)
    }
  }, [searchMatches.length, matchIndex])

  // Navigate to current match
  useEffect(() => {
    if (searchMatches.length > 0 && matchIndex < searchMatches.length) {
      setSelectedId(searchMatches[matchIndex].lineId)
    }
  }, [matchIndex, searchMatches])

  const handlePrevMatch = useCallback(() => {
    if (searchMatches.length === 0) return
    setMatchIndex((i) => (i - 1 + searchMatches.length) % searchMatches.length)
  }, [searchMatches.length])

  const handleNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return
    setMatchIndex((i) => (i + 1) % searchMatches.length)
  }, [searchMatches.length])

  const handleReplace = useCallback(() => {
    if (searchMatches.length === 0) return
    const match = searchMatches[matchIndex]
    const line = lines.find((l) => l.id === match.lineId)
    if (!line) return
    const field = match.field === "original" ? "original_text" : "translated_text"
    const text = line[field]
    const newText = text.slice(0, match.startIdx) + replaceQuery + text.slice(match.startIdx + match.length)
    handleUpdateLine(match.lineId, { [field]: newText })
  }, [searchMatches, matchIndex, replaceQuery, lines, handleUpdateLine])

  const handleReplaceAll = useCallback(() => {
    if (searchMatches.length === 0 || !findQuery) return
    const updated = lines.map((line) => {
      const field = searchOriginal ? "original_text" : "translated_text"
      const text = line[field]
      if (caseSensitive) {
        const newText = text.split(findQuery).join(replaceQuery)
        return newText !== text ? { ...line, [field]: newText } : line
      } else {
        const regex = new RegExp(findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
        const newText = text.replace(regex, replaceQuery)
        return newText !== text ? { ...line, [field]: newText } : line
      }
    })
    pushLines(updated)
    setDirty(true)
  }, [searchMatches.length, findQuery, replaceQuery, caseSensitive, searchOriginal, lines, pushLines])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const isEditing = tag === "INPUT" || tag === "TEXTAREA"

      // Ctrl+F — Find & Replace
      if (e.ctrlKey && !e.shiftKey && e.key === "f") {
        e.preventDefault()
        setFindOpen(true)
        return
      }
      // Escape — Close Find & Replace
      if (e.key === "Escape" && findOpen) {
        e.preventDefault()
        setFindOpen(false)
        return
      }
      // Ctrl+Z — Undo (always)
      if (e.ctrlKey && !e.shiftKey && e.key === "z") {
        e.preventDefault()
        undo()
        setDirty(true)
        return
      }
      // Ctrl+Y or Ctrl+Shift+Z — Redo (always)
      if ((e.ctrlKey && e.key === "y") || (e.ctrlKey && e.shiftKey && e.key === "Z")) {
        e.preventDefault()
        redo()
        setDirty(true)
        return
      }
      // Ctrl+S — Save (always)
      if (e.ctrlKey && !e.shiftKey && e.key === "s") {
        e.preventDefault()
        handleSave()
        return
      }
      // Space — Play/Pause (not in text fields)
      if (e.key === " " && !isEditing) {
        e.preventDefault()
        handleTogglePlay()
        return
      }
      // Delete — Delete subtitle (not in text fields)
      if (e.key === "Delete" && !isEditing && selectedId) {
        e.preventDefault()
        handleDeleteLine(selectedId)
        return
      }
      // Ctrl+Shift+S — Split
      if (e.ctrlKey && e.shiftKey && e.key === "S" && selectedId) {
        e.preventDefault()
        handleSplitLine(selectedId)
        return
      }
      // Ctrl+Shift+M — Merge
      if (e.ctrlKey && e.shiftKey && e.key === "M" && selectedId) {
        e.preventDefault()
        handleMergeWithNext(selectedId)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [selectedId, handleSplitLine, handleMergeWithNext, handleDeleteLine, handleSave, handleTogglePlay, undo, redo, findOpen])

  const canSplitLine = useMemo(() => {
    return selectedLine ? canSplit(selectedLine) : false
  }, [selectedLine])

  const canMergeLine = useMemo(() => {
    return selectedLine ? canMerge(selectedLine, lines) : false
  }, [selectedLine, lines])

  const handleSeek = useCallback((time: number) => {
    setCurrentTime(time)
    if (mediaRef.current) {
      mediaRef.current.currentTime = time
    }
  }, [])

  const handleSkipPrev = useCallback(() => {
    const prev = [...lines].reverse().find((l) => l.start_time < currentTime - 0.5)
    if (prev) {
      setCurrentTime(prev.start_time)
      setSelectedId(prev.id)
      if (mediaRef.current) mediaRef.current.currentTime = prev.start_time
    } else {
      setCurrentTime(0)
      if (mediaRef.current) mediaRef.current.currentTime = 0
    }
  }, [lines, currentTime])

  const handleSkipNext = useCallback(() => {
    const next = lines.find((l) => l.start_time > currentTime + 0.1)
    if (next) {
      setCurrentTime(next.start_time)
      setSelectedId(next.id)
      if (mediaRef.current) mediaRef.current.currentTime = next.start_time
    }
  }, [lines, currentTime])

  // Empty state
  if (!jobId) {
    return (
      <div className="flex flex-1 items-center justify-center text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl bg-muted/60 p-4 ring-1 ring-border">
            <FileText className="h-8 w-8 text-muted-foreground/70" />
          </div>
          <div>
            <p className="font-medium">{t("editor.empty.title")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("editor.empty.description")}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1 pb-3 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {lines.length} {t("editor.subtitlesCount")}
          </span>
          {dirty && (
            <span className="text-xs text-yellow-500">{t("editor.unsaved")}</span>
          )}
        </div>
        <TooltipProvider>
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={undo} disabled={!canUndo}>
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{t("editor.undo")} <kbd className="ml-1 text-[10px] opacity-60">Ctrl+Z</kbd></p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={redo} disabled={!canRedo}>
                  <Redo2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{t("editor.redo")} <kbd className="ml-1 text-[10px] opacity-60">Ctrl+Y</kbd></p></TooltipContent>
            </Tooltip>
            <div className="w-px h-4 bg-border mx-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={handleSave} disabled={!dirty}>
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  {t("editor.save")}
                </Button>
              </TooltipTrigger>
              <TooltipContent><p><kbd className="text-[10px] opacity-60">Ctrl+S</kbd></p></TooltipContent>
            </Tooltip>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={lines.length === 0}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t("editor.export")}
            </Button>
            <div className="w-px h-4 bg-border mx-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={findOpen ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setFindOpen((o) => !o)}
                >
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{t("editor.findReplace.title")} <kbd className="ml-1 text-[10px] opacity-60">Ctrl+F</kbd></p></TooltipContent>
            </Tooltip>
            {isVideo && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showVideo ? "secondary" : "ghost"}
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setShowVideo((v) => !v)}
                  >
                    {showVideo ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>{showVideo ? t("editor.video.hide") : t("editor.video.show")}</p></TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
      </div>

      {/* Find & Replace bar */}
      {findOpen && (
        <FindReplaceBar
          findQuery={findQuery}
          replaceQuery={replaceQuery}
          caseSensitive={caseSensitive}
          searchOriginal={searchOriginal}
          matchCount={searchMatches.length}
          matchIndex={matchIndex}
          onFindQueryChange={setFindQuery}
          onReplaceQueryChange={setReplaceQuery}
          onCaseSensitiveChange={setCaseSensitive}
          onSearchOriginalChange={setSearchOriginal}
          onPrevMatch={handlePrevMatch}
          onNextMatch={handleNextMatch}
          onReplace={handleReplace}
          onReplaceAll={handleReplaceAll}
          onClose={() => setFindOpen(false)}
        />
      )}

      {/* Main content: waveform + panels */}
      <div className="flex flex-1 flex-col min-h-0">
        {/* Video preview (visible when video file + toggled on) */}
        {isVideo && showVideo && videoElement && (
          <VideoPreview videoElement={videoElement} />
        )}

        {/* Minimap (visible only when zoomed) */}
        {zoomLevel > 1 && (
          <WaveformMinimap
            peaks={peaks}
            duration={duration}
            viewStart={viewStart}
            visibleDuration={visibleDuration}
            onViewStartChange={handleViewStartChange}
          />
        )}

        {/* Waveform */}
        <div className="h-[100px] border-b shrink-0">
          <Waveform
            lines={lines}
            currentTime={currentTime}
            selectedId={selectedId}
            duration={duration}
            peaks={peaks}
            viewStart={viewStart}
            visibleDuration={visibleDuration}
            onSeek={handleSeek}
            onSelect={setSelectedId}
            onViewStartChange={handleViewStartChange}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
          />
        </div>

        {/* Playback controls */}
        <PlaybackControls
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          volume={volume}
          playbackRate={playbackRate}
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
          onSkipPrev={handleSkipPrev}
          onSkipNext={handleSkipNext}
          onVolumeChange={setVolume}
          onPlaybackRateChange={setPlaybackRate}
        />

        {/* Subtitle list + Edit panel */}
        <ResizablePanelGroup className="flex-1 min-h-0">
          <ResizablePanel defaultSize={55} minSize={30}>
            <SubtitleList
              lines={lines}
              selectedId={selectedId}
              currentTime={currentTime}
              onSelect={setSelectedId}
              onSplit={handleSplitLine}
              onMergeWithNext={handleMergeWithNext}
              onDelete={handleDeleteLine}
              highlightMatches={findOpen ? searchMatches : undefined}
              currentMatchIndex={findOpen ? matchIndex : undefined}
              vocabularies={vocabularies}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={45} minSize={25}>
            <EditPanel
              line={selectedLine}
              onUpdateLine={handleUpdateLine}
              onSplit={handleSplitLine}
              onMergeWithNext={handleMergeWithNext}
              onDelete={handleDeleteLine}
              canSplitLine={canSplitLine}
              canMergeLine={canMergeLine}
              vocabularies={vocabularies}
              onUpdateVocabulary={onUpdateVocabulary}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
