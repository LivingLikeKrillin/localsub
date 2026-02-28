import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Upload, X, FileVideo } from "lucide-react"
import { useTranslation } from "react-i18next"
import { pickFile } from "@/lib/tauriApi"
import type { Preset, Vocabulary } from "@/types"

interface NewJobDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  presets: Preset[]
  vocabularies: Vocabulary[]
  onSubmit: (files: SelectedFile[], presetId: string) => void
}

export interface SelectedFile {
  name: string
  path: string
  size: number
}

function formatSize(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${(bytes / 1e6).toFixed(0)} MB`
}

export function NewJobDialog({ open, onOpenChange, presets, vocabularies, onSubmit }: NewJobDialogProps) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<SelectedFile[]>([])
  const [selectedPreset, setSelectedPreset] = useState(presets[0]?.id ?? "")
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFiles = Array.from(e.dataTransfer.files)
      .filter((f) => f.type.startsWith("video/") || f.type.startsWith("audio/"))
      .map((f) => ({
        name: f.name,
        path: f.name, // Tauri will resolve actual path via dialog
        size: f.size,
      }))
    setFiles((prev) => [...prev, ...droppedFiles])
  }, [])

  const handleFileSelect = useCallback(async () => {
    const path = await pickFile([
      { name: "Media", extensions: ["mp4", "mkv", "avi", "mov", "mp3", "wav", "m4a", "flac"] },
    ])
    if (path) {
      const name = path.split(/[/\\]/).pop() ?? path
      setFiles((prev) => [...prev, { name, path, size: 0 }])
    }
  }, [])

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleSubmit = useCallback(() => {
    if (files.length === 0 || !selectedPreset) return
    onSubmit(files, selectedPreset)
    setFiles([])
    onOpenChange(false)
  }, [files, selectedPreset, onSubmit, onOpenChange])

  const selectedPresetData = presets.find((p) => p.id === selectedPreset)
  const linkedVocab = selectedPresetData
    ? vocabularies.find((v) => v.id === selectedPresetData.vocabulary_id)
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("dashboard.newJob.title", "New Job")}</DialogTitle>
          <DialogDescription>
            {t("dashboard.newJob.description", "Upload files and select a preset to start processing.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2">
          {/* File drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleFileSelect}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleFileSelect() }}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
          >
            <div className="rounded-xl bg-muted/60 p-3 ring-1 ring-border">
              <Upload className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("dashboard.newJob.dropzone", "Drag and drop files here, or click to browse")}
            </p>
            <p className="text-xs text-muted-foreground/60">
              MP4, MKV, AVI, MOV, MP3, WAV
            </p>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <ScrollArea className="max-h-36">
              <div className="flex flex-col gap-1.5">
                {files.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted">
                      <FileVideo className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <span className="flex-1 truncate">{file.name}</span>
                    {file.size > 0 && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatSize(file.size)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                      className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Preset selection */}
          {presets.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <Label className="text-sm font-medium">{t("dashboard.newJob.preset", "Preset")}</Label>
              <RadioGroup value={selectedPreset} onValueChange={setSelectedPreset}>
                <div className="flex flex-col gap-2">
                  {presets.map((preset) => (
                    <label
                      key={preset.id}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        selectedPreset === preset.id
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <RadioGroupItem value={preset.id} className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{preset.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {preset.whisper_model.toUpperCase()} / {preset.llm_model} / {preset.output_format.toUpperCase()}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </RadioGroup>
              {linkedVocab && (
                <p className="text-xs text-muted-foreground">
                  Linked vocabulary: <span className="font-medium text-foreground">{linkedVocab.name}</span> ({linkedVocab.entries.length} entries)
                </p>
              )}
            </div>
          )}

          {presets.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">
              {t("dashboard.newJob.noPresets", "No presets available. Create one in the Presets page.")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("shared.cancel", "Cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={files.length === 0 || !selectedPreset}>
            {files.length > 1
              ? t("dashboard.newJob.startMultiple", { count: files.length, defaultValue: `Start ${files.length} jobs` })
              : t("dashboard.newJob.start", "Start job")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
