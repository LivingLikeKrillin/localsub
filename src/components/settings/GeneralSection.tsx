import { useTranslation } from "react-i18next"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import type { AppConfig, PartialConfig, ExternalApiConfig } from "@/types"

interface GeneralSectionProps {
  config: AppConfig
  onUpdate: (patch: PartialConfig) => void
}

const LANGUAGES = [
  { value: "en", labelKey: "settings.language.en" },
  { value: "ko", labelKey: "settings.language.ko" },
]

const FORMATS = [
  { value: "srt", label: "SRT" },
  { value: "vtt", label: "VTT" },
  { value: "ass", label: "ASS" },
  { value: "txt", label: "TXT" },
]

const SOURCE_LANG_KEYS = ["auto", "en", "ko", "ja", "zh", "es", "fr", "de"]
const TARGET_LANG_KEYS = ["en", "ko", "ja", "zh", "es", "fr", "de"]

const TRANSLATION_MODES = [
  { value: "off", labelKey: "settings.translation.modeOff" as const },
  { value: "local", labelKey: "settings.translation.modeLocal" as const },
  { value: "external", labelKey: "settings.translation.modeExternal" as const },
]

const STYLE_PRESETS = [
  { value: "literal", labelKey: "settings.translation.style.literal" as const },
  { value: "natural", labelKey: "settings.translation.style.natural" as const },
  { value: "casual", labelKey: "settings.translation.style.casual" as const },
  { value: "formal", labelKey: "settings.translation.style.formal" as const },
]

const QUALITY_TIERS = [
  { value: "fast", labelKey: "settings.translation.quality.fast" as const, descKey: "settings.translation.quality.fastDesc" as const },
  { value: "balanced", labelKey: "settings.translation.quality.balanced" as const, descKey: "settings.translation.quality.balancedDesc" as const },
  { value: "best", labelKey: "settings.translation.quality.best" as const, descKey: "settings.translation.quality.bestDesc" as const },
]

export function GeneralSection({ config, onUpdate }: GeneralSectionProps) {
  const { t, i18n } = useTranslation()

  function handleLanguageChange(lang: string) {
    i18n.changeLanguage(lang)
    localStorage.setItem("ui-language", lang)
    onUpdate({ ui_language: lang })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold">{t("settings.general.title")}</h3>
        <p className="text-sm text-muted-foreground mt-1">{t("settings.general.description")}</p>
      </div>

      {/* UI Language */}
      <div className="flex flex-col gap-2">
        <Label>{t("settings.language.title")}</Label>
        <RadioGroup
          value={config.ui_language ?? "en"}
          onValueChange={handleLanguageChange}
          className="flex gap-4"
        >
          {LANGUAGES.map((lang) => (
            <div key={lang.value} className="flex items-center gap-2">
              <RadioGroupItem value={lang.value} id={`lang-${lang.value}`} />
              <Label htmlFor={`lang-${lang.value}`} className="font-normal cursor-pointer">{t(lang.labelKey as never)}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <Separator />

      {/* Output Format */}
      <div className="flex flex-col gap-2">
        <Label>{t("settings.general.outputFormat")}</Label>
        <Select value={config.subtitle_format} onValueChange={(v) => onUpdate({ subtitle_format: v })}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Source / Target Languages */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label>{t("settings.general.sourceLanguage")}</Label>
          <Select value={config.source_language} onValueChange={(v) => onUpdate({ source_language: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SOURCE_LANG_KEYS.map((k) => <SelectItem key={k} value={k}>{t(`settings.general.sourceLangs.${k}` as never)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t("settings.general.targetLanguage")}</Label>
          <Select value={config.target_language} onValueChange={(v) => onUpdate({ target_language: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TARGET_LANG_KEYS.map((k) => <SelectItem key={k} value={k}>{t(`settings.general.targetLangs.${k}` as never)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      {/* Translation Mode */}
      <div className="flex flex-col gap-2">
        <Label>{t("settings.translation.mode")}</Label>
        <div className="flex gap-2">
          {TRANSLATION_MODES.map((m) => (
            <Button
              key={m.value}
              variant={config.translation_mode === m.value ? "default" : "outline"}
              size="sm"
              onClick={() => onUpdate({ translation_mode: m.value })}
            >
              {t(m.labelKey)}
            </Button>
          ))}
        </div>
      </div>

      {/* Context Window — only for local mode */}
      {config.translation_mode === "local" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>{t("settings.translation.contextWindow")}</Label>
            <span className="text-sm tabular-nums text-muted-foreground">{config.context_window}</span>
          </div>
          <Slider
            value={[config.context_window]}
            onValueChange={([v]) => onUpdate({ context_window: v })}
            min={1}
            max={10}
            step={1}
            className="w-full"
          />
        </div>
      )}

      {/* Translation Quality — only for local mode */}
      {config.translation_mode === "local" && (
        <div className="flex flex-col gap-2">
          <Label>{t("settings.translation.quality.title")}</Label>
          <div className="flex gap-2">
            {QUALITY_TIERS.map((tier) => (
              <Button
                key={tier.value}
                variant={(config.translation_quality ?? "balanced") === tier.value ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => onUpdate({ translation_quality: tier.value })}
              >
                {t(tier.labelKey)}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(QUALITY_TIERS.find((tier) => tier.value === (config.translation_quality ?? "balanced"))?.descKey ?? "settings.translation.quality.balancedDesc")}
          </p>
        </div>
      )}

      {/* 2-Pass Refinement — only for local mode */}
      {config.translation_mode === "local" && (
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <Label>{t("settings.translation.twoPass")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.translation.twoPassDesc")}</p>
          </div>
          <Switch
            checked={config.two_pass_translation ?? (config.translation_quality ?? "balanced") === "best"}
            onCheckedChange={(v) => onUpdate({ two_pass_translation: v })}
          />
        </div>
      )}

      {/* Custom Translation Prompt — only for local mode */}
      {config.translation_mode === "local" && (
        <div className="flex flex-col gap-2">
          <Label>{t("settings.translation.customPrompt")}</Label>
          <Textarea
            value={config.custom_translation_prompt ?? ""}
            onChange={(e) => onUpdate({ custom_translation_prompt: e.target.value || null })}
            placeholder={t("settings.translation.customPromptPlaceholder")}
            className="min-h-[80px] resize-none"
          />
        </div>
      )}

      {/* Style Preset — when translation is active */}
      {config.translation_mode !== "off" && (
        <div className="flex flex-col gap-2">
          <Label>{t("settings.translation.stylePreset")}</Label>
          <Select value={config.style_preset} onValueChange={(v) => onUpdate({ style_preset: v })}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STYLE_PRESETS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{t(s.labelKey)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* External API — when mode is external */}
      {config.translation_mode === "external" && (
        <>
          <Separator />
          <div className="flex flex-col gap-3">
            <Label className="text-sm font-semibold">{t("settings.api.title")}</Label>
            <div className="flex flex-col gap-2">
              <Label className="text-xs">{t("settings.api.provider")}</Label>
              <Select
                value={config.external_api.provider ?? "openai"}
                onValueChange={(v) => onUpdate({ external_api: { ...config.external_api, provider: v } as ExternalApiConfig })}
              >
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs">{t("settings.api.model")}</Label>
              <Input
                value={config.external_api.model ?? ""}
                onChange={(e) => onUpdate({ external_api: { ...config.external_api, model: e.target.value || null } as ExternalApiConfig })}
                placeholder="gpt-4o-mini"
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
