import { cn } from "@/lib/utils"

interface SubTextLogoProps {
  size?: "sm" | "md" | "lg"
  className?: string
}

export function SubTextLogo({ size = "md", className }: SubTextLogoProps) {
  const sizeMap = {
    sm: "h-8 w-8 rounded-lg",
    md: "h-9 w-9 rounded-[10px]",
    lg: "h-12 w-12 rounded-xl",
  }

  return (
    <div
      className={cn(
        "shrink-0 bg-primary",
        sizeMap[size],
        className
      )}
    >
      <svg
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full"
        aria-hidden="true"
      >
        {/* Monitor frame */}
        <rect
          x="7" y="8" width="34" height="24" rx="2.5"
          stroke="white" strokeWidth="3" fill="none"
        />

        {/* SUB text - bold, centered in screen */}
        <text
          x="24" y="22"
          textAnchor="middle"
          dominantBaseline="central"
          fill="white"
          fontFamily="system-ui, -apple-system, sans-serif"
          fontWeight="800"
          fontSize="11"
          letterSpacing="0.5"
        >SUB</text>

        {/* Subtitle lines below screen */}
        <rect x="12" y="36" width="20" height="2.5" rx="1.25" fill="white" />
        <rect x="15" y="40.5" width="14" height="2" rx="1" fill="white" opacity="0.5" />
      </svg>
    </div>
  )
}
