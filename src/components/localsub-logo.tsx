import { cn } from "@/lib/utils"

interface LocalSubLogoProps {
  size?: "sm" | "md" | "lg"
  className?: string
}

export function LocalSubLogo({ size = "md", className }: LocalSubLogoProps) {
  const sizeMap = {
    sm: "h-8 w-8",
    md: "h-9 w-9",
    lg: "h-12 w-12",
  }

  return (
    <svg
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="LocalSub"
      className={cn("shrink-0 text-primary", sizeMap[size], className)}
    >
      <path
        fill="currentColor"
        d="M44,6H4A2,2,0,0,0,2,8V40a2,2,0,0,0,2,2H44a2,2,0,0,0,2-2V8A2,2,0,0,0,44,6ZM12,26h4a2,2,0,0,1,0,4H12a2,2,0,0,1,0-4ZM26,36H12a2,2,0,0,1,0-4H26a2,2,0,0,1,0,4Zm10,0H32a2,2,0,0,1,0-4h4a2,2,0,0,1,0,4Zm0-6H22a2,2,0,0,1,0-4H36a2,2,0,0,1,0,4Z"
      />
    </svg>
  )
}
