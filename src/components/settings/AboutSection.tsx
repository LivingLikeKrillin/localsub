import { useTranslation } from "react-i18next"
import { ExternalLink } from "lucide-react"
import { SubTextLogo } from "@/components/subtext-logo"

export function AboutSection() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold">{t("settings.about.title")}</h3>
      </div>

      <div className="flex items-center gap-4 rounded-lg border p-4">
        <SubTextLogo size="md" />
        <div>
          <h4 className="text-sm font-semibold">SubText</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{t("settings.about.version")} 0.1.0</p>
          <p className="text-xs text-muted-foreground">{t("settings.about.tagline")}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <InfoRow label={t("settings.about.runtime")} value="Tauri 2.x + React" />
        <InfoRow label={t("settings.about.sttEngine")} value="faster-whisper (CTranslate2)" />
        <InfoRow label={t("settings.about.llmEngine")} value="llama-cpp-python (GGUF)" />
        <InfoRow label={t("settings.about.license")} value="MIT" />
      </div>

      <div className="flex flex-col gap-1.5">
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("settings.about.github")}
        </a>
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("settings.about.reportIssue")}
        </a>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md px-3 py-2 odd:bg-muted/30">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
