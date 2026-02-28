import {
  LayoutDashboard,
  Subtitles,
  SlidersHorizontal,
  Settings,
  Cpu,
  Sun,
  Moon,
  Monitor,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { SubTextLogo } from "@/components/subtext-logo"
import { useTheme } from "@/components/theme-provider"
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import type { MainPage, HardwareInfo } from "@/types"

const NAV_ITEMS = [
  { page: "dashboard" as MainPage, icon: LayoutDashboard, i18nKey: "nav.dashboard" as const },
  { page: "editor" as MainPage, icon: Subtitles, i18nKey: "nav.editor" as const },
  { page: "presets" as MainPage, icon: SlidersHorizontal, i18nKey: "nav.presets" as const },
  { page: "settings" as MainPage, icon: Settings, i18nKey: "nav.settings" as const },
]

interface AppSidebarProps {
  activePage: MainPage
  onNavigate: (page: MainPage) => void
  processingCount?: number
  hardwareInfo?: HardwareInfo | null
}

export function AppSidebar({
  activePage,
  onNavigate,
  processingCount = 0,
  hardwareInfo,
}: AppSidebarProps) {
  const { t } = useTranslation()
  const { setTheme, theme } = useTheme()

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="p-4">
        <button
          onClick={() => onNavigate("dashboard")}
          className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center"
        >
          <SubTextLogo size="sm" />
          <span className="text-lg font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            SubText
          </span>
        </button>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent className="p-2">
        <SidebarMenu>
          {NAV_ITEMS.map((item) => (
            <SidebarMenuItem key={item.page}>
              <SidebarMenuButton
                isActive={activePage === item.page}
                tooltip={t(item.i18nKey)}
                onClick={() => onNavigate(item.page)}
              >
                <item.icon className="h-4 w-4" />
                <span>{t(item.i18nKey)}</span>
                {item.page === "dashboard" && processingCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-auto bg-status-info text-status-info-foreground h-5 min-w-5 justify-center text-xs"
                  >
                    {processingCount}
                  </Badge>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarSeparator />

        {/* System status chip */}
        <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted">
            <Cpu className="h-3 w-3 text-muted-foreground" />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            {hardwareInfo?.gpu ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
                <span>CUDA {hardwareInfo.gpu.cuda_version ?? "N/A"}</span>
                <span className="text-muted-foreground/60">|</span>
                <span>{(hardwareInfo.gpu.vram_mb / 1024).toFixed(0)}GB VRAM</span>
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-status-warning" />
                <span>CPU Only</span>
              </>
            )}
          </div>
        </div>

        {/* Theme toggle */}
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton tooltip={t("nav.theme" as const)}>
                  {theme === "dark" ? (
                    <Moon className="h-4 w-4" />
                  ) : theme === "light" ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Monitor className="h-4 w-4" />
                  )}
                  <span>
                    {theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System"}
                  </span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                <DropdownMenuItem onClick={() => setTheme("light")}>
                  <Sun className="mr-2 h-4 w-4" />
                  Light
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")}>
                  <Moon className="mr-2 h-4 w-4" />
                  Dark
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("system")}>
                  <Monitor className="mr-2 h-4 w-4" />
                  System
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
