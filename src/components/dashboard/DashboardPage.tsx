import { useState, useMemo } from "react"
import { Plus, Trash2, FileVideo, Clock, Filter, MoreHorizontal } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { JobStatusBadge } from "./JobStatusBadge"
import { NewJobDialog, type SelectedFile } from "./NewJobDialog"
import type { JobStatus, JobStage, Preset, Vocabulary } from "@/types"

// Dashboard-specific job representation (extends the basic Job)
export interface DashboardJob {
  id: string
  file_name: string
  file_path: string
  file_size: number
  duration: number
  preset_id: string
  status: JobStatus
  stage: JobStage
  progress: number
  error?: string
  created_at: string
  completed_at?: string
}

interface DashboardPageProps {
  jobs: DashboardJob[]
  presets: Preset[]
  vocabularies: Vocabulary[]
  onNewJob: (files: SelectedFile[], presetId: string) => void
  onRemoveJob: (id: string) => void
  onOpenEditor?: (jobId: string) => void
}

type FilterStatus = "all" | JobStatus

function formatSize(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes > 0) return `${(bytes / 1e6).toFixed(0)} MB`
  return "--"
}

function formatDuration(sec: number) {
  if (sec <= 0) return "--"
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })
}

export function DashboardPage({
  jobs,
  presets,
  vocabularies,
  onNewJob,
  onRemoveJob,
  onOpenEditor,
}: DashboardPageProps) {
  const { t } = useTranslation()
  const [newJobOpen, setNewJobOpen] = useState(false)
  const [filter, setFilter] = useState<FilterStatus>("all")

  const filteredJobs = useMemo(() => {
    if (filter === "all") return jobs
    return jobs.filter((j) => j.status === filter)
  }, [jobs, filter])

  const counts = useMemo(() => {
    const c = { all: jobs.length, pending: 0, processing: 0, completed: 0, failed: 0 }
    for (const j of jobs) c[j.status]++
    return c
  }, [jobs])

  function getPresetName(presetId: string) {
    return presets.find((p) => p.id === presetId)?.name ?? "Unknown"
  }

  const FILTER_OPTIONS: { value: FilterStatus; label: string }[] = [
    { value: "all", label: `${t("dashboard.filter.all", "All")} (${counts.all})` },
    { value: "processing", label: `${t("dashboard.filter.processing", "Processing")} (${counts.processing})` },
    { value: "pending", label: `${t("dashboard.filter.pending", "Pending")} (${counts.pending})` },
    { value: "completed", label: `${t("dashboard.filter.completed", "Completed")} (${counts.completed})` },
    { value: "failed", label: `${t("dashboard.filter.failed", "Failed")} (${counts.failed})` },
  ]

  return (
    <>
      {/* Filter bar */}
      <div className="flex items-center gap-2 border-b px-0 pb-3 mb-4">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted">
          <Filter className="h-3 w-3 text-muted-foreground" />
        </div>
        {FILTER_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={filter === opt.value ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilter(opt.value)}
            className="h-7 text-xs"
          >
            {opt.label}
          </Button>
        ))}
        <div className="flex-1" />
        <Button size="sm" onClick={() => setNewJobOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t("dashboard.newJob.button", "New Job")}
        </Button>
      </div>

      {/* Job table */}
      {filteredJobs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="rounded-2xl bg-muted/60 p-4 ring-1 ring-border">
            <FileVideo className="h-8 w-8 text-muted-foreground/70" />
          </div>
          <div>
            <p className="font-medium">{t("dashboard.empty.title", "No jobs yet")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("dashboard.empty.description", "Create a new job to start processing subtitles.")}
            </p>
          </div>
          <Button size="sm" onClick={() => setNewJobOpen(true)} className="mt-2">
            <Plus className="mr-1.5 h-4 w-4" />
            {t("dashboard.newJob.button", "New Job")}
          </Button>
        </div>
      ) : (
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px]">{t("dashboard.table.file", "File")}</TableHead>
                <TableHead>{t("dashboard.table.preset", "Preset")}</TableHead>
                <TableHead>{t("dashboard.table.status", "Status")}</TableHead>
                <TableHead>{t("dashboard.table.progress", "Progress")}</TableHead>
                <TableHead className="text-right">{t("dashboard.table.created", "Created")}</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredJobs.map((job) => (
                <TableRow
                  key={job.id}
                  className="group cursor-pointer"
                  onClick={() => job.status === "completed" && onOpenEditor?.(job.id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
                        <FileVideo className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{job.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatSize(job.file_size)} / {formatDuration(job.duration)}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {getPresetName(job.preset_id)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <JobStatusBadge status={job.status} stage={job.stage} />
                  </TableCell>
                  <TableCell>
                    {job.status === "processing" ? (
                      <div className="flex items-center gap-2.5 min-w-[120px]">
                        <Progress value={job.progress} className="h-1.5 flex-1" />
                        <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">
                          {job.progress}%
                        </span>
                      </div>
                    ) : job.status === "completed" ? (
                      <span className="text-xs text-muted-foreground">100%</span>
                    ) : job.status === "failed" ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs text-status-error cursor-help">
                            Error
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs">{job.error}</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-muted-foreground">--</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDate(job.created_at)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Job actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); onRemoveJob(job.id) }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          {t("dashboard.actions.remove", "Remove")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TooltipProvider>
      )}

      <NewJobDialog
        open={newJobOpen}
        onOpenChange={setNewJobOpen}
        presets={presets}
        vocabularies={vocabularies}
        onSubmit={onNewJob}
      />
    </>
  )
}
