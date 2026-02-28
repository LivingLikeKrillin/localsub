import { Play, Pause, SkipBack, SkipForward, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

interface PlaybackControlsProps {
  currentTime: number
  duration: number
  isPlaying: boolean
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onSkipPrev: () => void
  onSkipNext: () => void
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`
}

export function PlaybackControls({
  currentTime,
  duration,
  isPlaying,
  onTogglePlay,
  onSeek,
  onSkipPrev,
  onSkipNext,
}: PlaybackControlsProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t bg-muted/20">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onSkipPrev}>
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onTogglePlay}>
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onSkipNext}>
          <SkipForward className="h-3.5 w-3.5" />
        </Button>
      </div>

      <span className="text-xs tabular-nums text-muted-foreground w-20">
        {formatTime(currentTime)}
      </span>

      <Slider
        value={[currentTime]}
        onValueChange={([v]) => onSeek(v)}
        min={0}
        max={Math.max(duration, 1)}
        step={0.1}
        className="flex-1"
      />

      <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">
        {formatTime(duration)}
      </span>

      <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  )
}
