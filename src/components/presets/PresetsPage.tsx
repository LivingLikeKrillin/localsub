import { useState } from "react"
import {
  Plus,
  Pencil,
  Copy,
  Trash2,
  BookOpen,
  SlidersHorizontal,
  ChevronRight,
  ArrowRight,
  MoreHorizontal,
  Star,
  FileUp,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toastSuccess, toastError } from "@/lib/toast"
import { pickFile, readCsvFile } from "@/lib/tauriApi"
import type { Preset, Vocabulary, VocabularyEntry } from "@/types"

const LANG_KEYS = ["ko", "en", "ja", "zh"] as const
const STYLE_KEYS = ["formal", "casual", "honorific"] as const

// ─── Preset Card ─────────────────────────────────────────────────

function PresetCard({
  preset,
  vocabName,
  isDefault,
  onEdit,
  onDuplicate,
  onDelete,
  onSetDefault,
}: {
  preset: Preset
  vocabName: string | null
  isDefault?: boolean
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onSetDefault?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="group rounded-lg border p-4 transition-colors hover:bg-muted/30">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate">{preset.name}</h3>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {preset.output_format.toUpperCase()}
            </Badge>
            {isDefault && (
              <Badge variant="secondary" className="text-[10px] shrink-0">
                <Star className="mr-0.5 h-2.5 w-2.5" />
                {t("presets.default")}
              </Badge>
            )}
          </div>
          {preset.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{preset.description}</p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> {t("presets.actions.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="mr-2 h-3.5 w-3.5" /> {t("presets.actions.duplicate")}
            </DropdownMenuItem>
            {onSetDefault && !isDefault && (
              <DropdownMenuItem onClick={onSetDefault}>
                <Star className="mr-2 h-3.5 w-3.5" /> {t("presets.actions.setDefault")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" /> {t("presets.actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>STT: <span className="text-foreground font-medium">{preset.whisper_model}</span></span>
        <span>LLM: <span className="text-foreground font-medium">{preset.llm_model}</span></span>
        <span className="flex items-center gap-1">
          {t(`presets.lang.${preset.source_lang}`, preset.source_lang)}
          <ArrowRight className="h-3 w-3" />
          {t(`presets.lang.${preset.target_lang}`, preset.target_lang)}
        </span>
        <span>Style: <span className="text-foreground font-medium">{t(`presets.style.${preset.translation_style}`, preset.translation_style)}</span></span>
        {vocabName && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5">
            <BookOpen className="h-3 w-3 text-primary" />
            <span className="text-foreground font-medium">{vocabName}</span>
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Vocabulary Card ─────────────────────────────────────────────

function VocabCard({ vocab, onEdit, onDelete }: { vocab: Vocabulary; onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <BookOpen className="h-3.5 w-3.5 text-primary" />
            </div>
            <h3 className="text-sm font-semibold truncate">{vocab.name}</h3>
            <Badge variant="secondary" className="text-[10px]">{vocab.entries.length} entries</Badge>
          </div>
          {vocab.description && <p className="text-xs text-muted-foreground mt-1 ml-6">{vocab.description}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">
            {t(`presets.lang.${vocab.source_lang}`, vocab.source_lang)} &rarr; {t(`presets.lang.${vocab.target_lang}`, vocab.target_lang)}
          </span>
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>
      </button>

      {expanded && (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Source</TableHead>
                <TableHead className="w-[200px]">Target</TableHead>
                <TableHead>Context</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vocab.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium text-sm">{entry.source}</TableCell>
                  <TableCell className="text-sm">{entry.target}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{entry.context || "--"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{entry.note || "--"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-end gap-2 p-3 border-t">
            <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="mr-1.5 h-3.5 w-3.5" /> {t("presets.actions.edit")}</Button>
            <Button variant="outline" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> {t("presets.actions.delete")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Preset Dialog ───────────────────────────────────────────────

function PresetDialog({
  open, onOpenChange, initial, vocabularies, onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: Preset
  vocabularies: Vocabulary[]
  onSave: (data: Omit<Preset, "id" | "created_at" | "updated_at">) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [whisperModel, setWhisperModel] = useState(initial?.whisper_model ?? "large-v3")
  const [sourceLang, setSourceLang] = useState(initial?.source_lang ?? "ko")
  const [targetLang, setTargetLang] = useState(initial?.target_lang ?? "en")
  const [outputFormat, setOutputFormat] = useState(initial?.output_format ?? "srt")
  const [translationStyle, setTranslationStyle] = useState(initial?.translation_style ?? "formal")
  const [llmModel, setLlmModel] = useState(initial?.llm_model ?? "qwen3-7b")
  const [vocabularyId, setVocabularyId] = useState(initial?.vocabulary_id ?? "none")

  function handleSave() {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      description: description.trim(),
      whisper_model: whisperModel,
      source_lang: sourceLang,
      target_lang: targetLang,
      output_format: outputFormat,
      translation_style: translationStyle,
      llm_model: llmModel,
      vocabulary_id: vocabularyId === "none" ? null : vocabularyId,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Preset" : "New Preset"}</DialogTitle>
          <DialogDescription>Configure subtitle generation and translation settings.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-4 py-2 px-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="preset-name">Name</Label>
              <Input id="preset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Korean to English (Formal)" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="preset-desc">Description</Label>
              <Textarea id="preset-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional description" className="resize-none" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Whisper Model</Label>
                <Select value={whisperModel} onValueChange={setWhisperModel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["tiny", "base", "small", "medium", "large-v2", "large-v3"].map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>LLM Model</Label>
                <Select value={llmModel} onValueChange={setLlmModel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="qwen3-7b">Qwen3 7B</SelectItem>
                    <SelectItem value="qwen3-14b">Qwen3 14B</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Source Language</Label>
                <Select value={sourceLang} onValueChange={setSourceLang}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANG_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>{t(`presets.lang.${k}`, k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Target Language</Label>
                <Select value={targetLang} onValueChange={setTargetLang}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANG_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>{t(`presets.lang.${k}`, k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Output Format</Label>
                <Select value={outputFormat} onValueChange={setOutputFormat}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="srt">SRT</SelectItem>
                    <SelectItem value="ass">ASS</SelectItem>
                    <SelectItem value="vtt">VTT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Translation Style</Label>
                <Select value={translationStyle} onValueChange={setTranslationStyle}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STYLE_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>{t(`presets.style.${k}`, k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Vocabulary Dictionary</Label>
              <Select value={vocabularyId ?? "none"} onValueChange={setVocabularyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {vocabularies.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name} ({v.entries.length} entries)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {initial ? "Save Changes" : "Create Preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Vocabulary Dialog ───────────────────────────────────────────

function VocabDialog({
  open, onOpenChange, initial, onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: Vocabulary
  onSave: (data: Omit<Vocabulary, "id" | "created_at" | "updated_at">) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [sourceLang, setSourceLang] = useState(initial?.source_lang ?? "ko")
  const [targetLang, setTargetLang] = useState(initial?.target_lang ?? "en")
  const [entries, setEntries] = useState<VocabularyEntry[]>(
    initial?.entries ?? [{ id: "new-1", source: "", target: "" }]
  )

  function addEntry() {
    setEntries((prev) => [...prev, { id: `new-${Date.now()}`, source: "", target: "" }])
  }

  async function handleImportCsv() {
    try {
      const path = await pickFile([{ name: "CSV", extensions: ["csv"] }])
      if (!path) return
      const rows = await readCsvFile(path)
      if (rows.length === 0) {
        toastError(t("presets.vocab.importFailed"))
        return
      }
      const mapped: VocabularyEntry[] = rows.map((row) => ({
        id: `csv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        source: row.source,
        target: row.target,
        context: row.context ?? undefined,
        note: row.note ?? undefined,
      }))
      setEntries((prev) => [...prev, ...mapped])
      toastSuccess(t("presets.vocab.imported", { count: rows.length }))
    } catch {
      toastError(t("presets.vocab.importFailed"))
    }
  }

  function updateEntry(id: string, field: keyof VocabularyEntry, value: string) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)))
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  function handleSave() {
    if (!name.trim()) return
    const validEntries = entries.filter((e) => e.source.trim() && e.target.trim())
    onSave({
      name: name.trim(),
      description: description.trim(),
      source_lang: sourceLang,
      target_lang: targetLang,
      entries: validEntries,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Vocabulary" : "New Vocabulary"}</DialogTitle>
          <DialogDescription>Define how specific words and phrases should be translated.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-4 py-2 px-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="vocab-name">Name</Label>
                <Input id="vocab-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. IT/Tech Terms" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="vocab-desc">Description</Label>
                <Input id="vocab-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Source Language</Label>
                <Select value={sourceLang} onValueChange={setSourceLang}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANG_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>{t(`presets.lang.${k}`, k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Target Language</Label>
                <Select value={targetLang} onValueChange={setTargetLang}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANG_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>{t(`presets.lang.${k}`, k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Entries</Label>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Context</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="w-[40px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="p-1">
                          <Input value={entry.source} onChange={(e) => updateEntry(entry.id, "source", e.target.value)} placeholder="Source" className="h-8 text-sm" />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input value={entry.target} onChange={(e) => updateEntry(entry.id, "target", e.target.value)} placeholder="Translation" className="h-8 text-sm" />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input value={entry.context ?? ""} onChange={(e) => updateEntry(entry.id, "context", e.target.value)} placeholder="Optional" className="h-8 text-sm" />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input value={entry.note ?? ""} onChange={(e) => updateEntry(entry.id, "note", e.target.value)} placeholder="Optional" className="h-8 text-sm" />
                        </TableCell>
                        <TableCell className="p-1">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeEntry(entry.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={addEntry}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Entry
                </Button>
                <Button variant="outline" size="sm" onClick={handleImportCsv}>
                  <FileUp className="mr-1.5 h-3.5 w-3.5" /> {t("presets.vocab.importCsv")}
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {initial ? "Save Changes" : "Create Vocabulary"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ────────────────────────────────────────────────────────

interface PresetsPageProps {
  presets: Preset[]
  vocabularies: Vocabulary[]
  onAddPreset: (preset: Preset) => Promise<unknown>
  onUpdatePreset: (preset: Preset) => Promise<unknown>
  onRemovePreset: (id: string) => Promise<unknown>
  onAddVocabulary: (vocab: Vocabulary) => Promise<unknown>
  onUpdateVocabulary: (vocab: Vocabulary) => Promise<unknown>
  onRemoveVocabulary: (id: string) => Promise<unknown>
}

export function PresetsPage({
  presets, vocabularies,
  onAddPreset, onUpdatePreset, onRemovePreset,
  onAddVocabulary, onUpdateVocabulary, onRemoveVocabulary,
}: PresetsPageProps) {
  const { t } = useTranslation()
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
  const [editingPreset, setEditingPreset] = useState<Preset | undefined>()
  const [vocabDialogOpen, setVocabDialogOpen] = useState(false)
  const [editingVocab, setEditingVocab] = useState<Vocabulary | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<{ type: "preset" | "vocab"; id: string; name: string } | null>(null)

  function openNewPreset() { setEditingPreset(undefined); setPresetDialogOpen(true) }
  function openEditPreset(p: Preset) { setEditingPreset(p); setPresetDialogOpen(true) }

  function handleDuplicatePreset(p: Preset) {
    const now = new Date().toISOString()
    onAddPreset({ ...p, id: crypto.randomUUID(), name: `${p.name} (Copy)`, is_default: false, created_at: now, updated_at: now })
  }

  function handleSetDefault(presetId: string) {
    const now = new Date().toISOString()
    for (const p of presets) {
      if (p.is_default && p.id !== presetId) {
        onUpdatePreset({ ...p, is_default: false, updated_at: now })
      }
    }
    const target = presets.find((p) => p.id === presetId)
    if (target) {
      onUpdatePreset({ ...target, is_default: true, updated_at: now })
    }
  }

  function handleSavePreset(data: Omit<Preset, "id" | "created_at" | "updated_at">) {
    const now = new Date().toISOString()
    if (editingPreset) {
      onUpdatePreset({ ...editingPreset, ...data, updated_at: now })
    } else {
      onAddPreset({ ...data, id: crypto.randomUUID(), created_at: now, updated_at: now })
    }
  }

  function openNewVocab() { setEditingVocab(undefined); setVocabDialogOpen(true) }
  function openEditVocab(v: Vocabulary) { setEditingVocab(v); setVocabDialogOpen(true) }

  function handleSaveVocab(data: Omit<Vocabulary, "id" | "created_at" | "updated_at">) {
    const now = new Date().toISOString()
    if (editingVocab) {
      onUpdateVocabulary({ ...editingVocab, ...data, updated_at: now })
    } else {
      onAddVocabulary({ ...data, id: crypto.randomUUID(), created_at: now, updated_at: now })
    }
  }

  function getVocabName(id: string | null) {
    if (!id) return null
    return vocabularies.find((v) => v.id === id)?.name ?? null
  }

  return (
    <>
      <Tabs defaultValue="presets" className="flex flex-col flex-1">
        <div className="border-b">
          <TabsList className="h-10 bg-transparent p-0 gap-4">
            <TabsTrigger value="presets" className="relative h-10 rounded-none border-b-2 border-transparent px-0 pb-3 pt-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
              {t("presets.tabs.presets", "Job Presets")}
              <Badge variant="secondary" className="ml-1.5 text-[10px] h-5">{presets.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="vocabularies" className="relative h-10 rounded-none border-b-2 border-transparent px-0 pb-3 pt-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              <BookOpen className="mr-1.5 h-3.5 w-3.5" />
              {t("presets.tabs.vocabularies", "Vocabularies")}
              <Badge variant="secondary" className="ml-1.5 text-[10px] h-5">{vocabularies.length}</Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="presets" className="flex flex-col flex-1 mt-0 pt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {t("presets.presetsDesc", "Presets combine STT, translation, and vocabulary settings into reusable configurations.")}
            </p>
            <Button size="sm" onClick={openNewPreset}><Plus className="mr-1.5 h-4 w-4" /> {t("presets.newPreset", "New Preset")}</Button>
          </div>
          <div className="flex flex-1 flex-col gap-2">
            {presets.map((p) => (
              <PresetCard
                key={p.id} preset={p}
                vocabName={getVocabName(p.vocabulary_id)}
                isDefault={!!p.is_default}
                onEdit={() => openEditPreset(p)}
                onDuplicate={() => handleDuplicatePreset(p)}
                onDelete={() => setDeleteTarget({ type: "preset", id: p.id, name: p.name })}
                onSetDefault={() => handleSetDefault(p.id)}
              />
            ))}
            {presets.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="rounded-2xl bg-muted/60 p-4 ring-1 ring-border">
                  <SlidersHorizontal className="h-8 w-8 text-muted-foreground/70" />
                </div>
                <div>
                  <p className="font-medium">{t("presets.emptyPresets.title", "No presets yet")}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t("presets.emptyPresets.description", "Create your first preset to get started.")}</p>
                </div>
                <Button size="sm" className="mt-2" onClick={openNewPreset}><Plus className="mr-1.5 h-4 w-4" /> {t("presets.newPreset", "New Preset")}</Button>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="vocabularies" className="flex flex-col flex-1 mt-0 pt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {t("presets.vocabDesc", "Define how specific terms should be translated for consistency across jobs.")}
            </p>
            <Button size="sm" onClick={openNewVocab}><Plus className="mr-1.5 h-4 w-4" /> {t("presets.newVocab", "New Vocabulary")}</Button>
          </div>
          <div className="flex flex-1 flex-col gap-2">
            {vocabularies.map((v) => (
              <VocabCard key={v.id} vocab={v} onEdit={() => openEditVocab(v)} onDelete={() => setDeleteTarget({ type: "vocab", id: v.id, name: v.name })} />
            ))}
            {vocabularies.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="rounded-2xl bg-muted/60 p-4 ring-1 ring-border">
                  <BookOpen className="h-8 w-8 text-muted-foreground/70" />
                </div>
                <div>
                  <p className="font-medium">{t("presets.emptyVocab.title", "No vocabularies yet")}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t("presets.emptyVocab.description", "Create a vocabulary dictionary to ensure consistent translations.")}</p>
                </div>
                <Button size="sm" className="mt-2" onClick={openNewVocab}><Plus className="mr-1.5 h-4 w-4" /> {t("presets.newVocab", "New Vocabulary")}</Button>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <PresetDialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen} initial={editingPreset} vocabularies={vocabularies} onSave={handleSavePreset} />
      <VocabDialog open={vocabDialogOpen} onOpenChange={setVocabDialogOpen} initial={editingVocab} onSave={handleSaveVocab} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.type === "preset" ? t("confirm.deletePreset") : t("confirm.deleteVocab")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "preset" ? t("confirm.deletePresetMsg") : t("confirm.deleteVocabMsg")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("shared.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!deleteTarget) return
                if (deleteTarget.type === "preset") {
                  onRemovePreset(deleteTarget.id)
                } else {
                  onRemoveVocabulary(deleteTarget.id)
                }
                setDeleteTarget(null)
              }}
            >
              {t("presets.actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
