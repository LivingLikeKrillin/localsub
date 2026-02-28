import { useRef, useEffect, useCallback } from "react"
import type { SubtitleLine } from "@/types"

interface WaveformProps {
  lines: SubtitleLine[]
  currentTime: number
  selectedId: string | null
  duration: number
  onSeek: (time: number) => void
  onSelect: (id: string) => void
}

export function Waveform({
  lines,
  currentTime,
  selectedId,
  duration,
  onSeek,
  onSelect,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = rect.height
    const dur = Math.max(duration, 1)

    // Background
    const isDark = document.documentElement.classList.contains("dark")
    ctx.fillStyle = isDark ? "hsl(220, 16%, 8%)" : "hsl(0, 0%, 97%)"
    ctx.fillRect(0, 0, w, h)

    // Grid lines
    const gridInterval = dur > 300 ? 60 : dur > 60 ? 10 : 5
    ctx.strokeStyle = isDark ? "hsla(220, 10%, 20%, 0.5)" : "hsla(220, 10%, 85%, 0.5)"
    ctx.lineWidth = 0.5
    for (let t = 0; t <= dur; t += gridInterval) {
      const x = (t / dur) * w
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()

      // Time label
      ctx.fillStyle = isDark ? "hsl(220, 10%, 40%)" : "hsl(220, 10%, 60%)"
      ctx.font = "10px Inter, sans-serif"
      const min = Math.floor(t / 60)
      const sec = Math.floor(t % 60)
      ctx.fillText(`${min}:${String(sec).padStart(2, "0")}`, x + 2, h - 4)
    }

    // Subtitle blocks
    const trackH = 24
    const trackY = (h - trackH) / 2 - 6

    for (const line of lines) {
      const x1 = (line.start_time / dur) * w
      const x2 = (line.end_time / dur) * w
      const bw = Math.max(x2 - x1, 2)

      const isSelected = line.id === selectedId
      const hasTranslation = line.translated_text.length > 0

      if (isSelected) {
        ctx.fillStyle = isDark ? "hsla(245, 70%, 55%, 0.6)" : "hsla(245, 70%, 55%, 0.4)"
      } else if (hasTranslation) {
        ctx.fillStyle = isDark ? "hsla(245, 50%, 45%, 0.35)" : "hsla(245, 50%, 55%, 0.25)"
      } else {
        ctx.fillStyle = isDark ? "hsla(220, 15%, 35%, 0.3)" : "hsla(220, 15%, 65%, 0.25)"
      }

      ctx.beginPath()
      ctx.roundRect(x1, trackY, bw, trackH, 3)
      ctx.fill()

      // Border for selected
      if (isSelected) {
        ctx.strokeStyle = isDark ? "hsl(245, 70%, 60%)" : "hsl(245, 70%, 50%)"
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // Text label (if wide enough)
      if (bw > 30) {
        ctx.fillStyle = isDark ? "hsl(0, 0%, 85%)" : "hsl(0, 0%, 25%)"
        ctx.font = "10px Inter, sans-serif"
        ctx.save()
        ctx.beginPath()
        ctx.rect(x1 + 3, trackY, bw - 6, trackH)
        ctx.clip()
        ctx.fillText(line.original_text, x1 + 4, trackY + 15)
        ctx.restore()
      }
    }

    // Playhead
    const phX = (currentTime / dur) * w
    ctx.strokeStyle = isDark ? "hsl(0, 80%, 60%)" : "hsl(0, 80%, 50%)"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(phX, 0)
    ctx.lineTo(phX, h)
    ctx.stroke()

    // Playhead triangle
    ctx.fillStyle = isDark ? "hsl(0, 80%, 60%)" : "hsl(0, 80%, 50%)"
    ctx.beginPath()
    ctx.moveTo(phX - 5, 0)
    ctx.lineTo(phX + 5, 0)
    ctx.lineTo(phX, 6)
    ctx.closePath()
    ctx.fill()
  }, [lines, currentTime, selectedId, duration])

  useEffect(() => {
    draw()
  }, [draw])

  // Resize observer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => draw())
    observer.observe(container)
    return () => observer.disconnect()
  }, [draw])

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const t = (x / rect.width) * Math.max(duration, 1)

    // Check if clicked on a subtitle block
    const clicked = lines.find((l) => t >= l.start_time && t <= l.end_time)
    if (clicked) {
      onSelect(clicked.id)
    }
    onSeek(Math.max(0, Math.min(t, duration)))
  }

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[80px]">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onClick={handleClick}
      />
    </div>
  )
}
