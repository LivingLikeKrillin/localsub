import { Badge } from "@/components/ui/badge"
import type { JobStatus, JobStage } from "@/types"

const STATUS_CONFIG: Record<JobStatus, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className: "bg-muted text-muted-foreground",
  },
  processing: {
    label: "Processing",
    className: "bg-status-info/15 text-status-info border-status-info/25",
  },
  completed: {
    label: "Completed",
    className: "bg-status-success/15 text-status-success border-status-success/25",
  },
  failed: {
    label: "Failed",
    className: "bg-status-error/15 text-status-error border-status-error/25",
  },
}

const STAGE_LABELS: Record<JobStage, string> = {
  stt: "STT",
  translating: "Translating",
  done: "Done",
  error: "Error",
}

export function JobStatusBadge({ status, stage }: { status: JobStatus; stage: JobStage }) {
  const config = STATUS_CONFIG[status]
  const stageLabel = status === "processing" ? STAGE_LABELS[stage] : undefined

  return (
    <Badge variant="outline" className={`${config.className} text-xs font-medium`}>
      {status === "processing" && (
        <span className="relative mr-1.5 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-info opacity-50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-status-info" />
        </span>
      )}
      {config.label}
      {stageLabel && <span className="ml-1 opacity-70">({stageLabel})</span>}
    </Badge>
  )
}
