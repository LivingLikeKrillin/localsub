import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, MemoryStick, Monitor, Microchip } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { HardwareInfo, Profile, ProfileRecommendation } from "../../types";

const PROFILES: Profile[] = ["lite", "balanced", "power"];

interface StepEnvironmentProps {
  hardware: HardwareInfo | null;
  recommendation: ProfileRecommendation | null;
  loading: boolean;
  profile: Profile;
  onProfileChange: (p: Profile) => void;
  onDetect: () => void;
}

export function StepEnvironment({
  hardware,
  recommendation,
  loading,
  profile,
  onProfileChange,
  onDetect,
}: StepEnvironmentProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!hardware && !loading) {
      onDetect();
    }
  }, [hardware, loading, onDetect]);

  useEffect(() => {
    if (recommendation) {
      onProfileChange(recommendation.recommended);
    }
  }, [recommendation, onProfileChange]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2.5 py-12 text-slate-400">
        <span className="spinner" />
        <span>{t("wizard.environment.detecting")}</span>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-6 text-lg font-semibold text-slate-50">
        {t("wizard.environment.title")}
      </h2>

      {/* Hardware cards - 2x2 grid */}
      {hardware && (
        <div className="mb-8 grid grid-cols-2 gap-3">
          <HwCard
            icon={Cpu}
            label={t("wizard.environment.cpuCard")}
            value={hardware.cpu_name}
            sub={`${hardware.cpu_cores} cores`}
          />
          <HwCard
            icon={MemoryStick}
            label={t("wizard.environment.ramCard")}
            value={`${hardware.total_ram_gb.toFixed(1)} GB`}
            sub={`${hardware.available_ram_gb.toFixed(1)} GB free`}
          />
          <HwCard
            icon={Monitor}
            label={t("wizard.environment.gpuCard")}
            value={hardware.gpu?.name ?? t("wizard.environment.noGpu")}
            sub={hardware.gpu ? `${hardware.gpu.vram_mb} MB VRAM` : undefined}
          />
          <HwCard
            icon={Microchip}
            label={t("wizard.environment.diskCard")}
            value={hardware.avx2_support ? "AVX2" : hardware.avx_support ? "AVX" : "SSE"}
            sub={t("wizard.environment.instructionSet")}
          />
        </div>
      )}

      {/* Profile selection */}
      <h3 className="mb-3 text-sm font-medium text-slate-300">
        {t("wizard.environment.profileTitle")}
      </h3>
      {recommendation && (
        <p className="mb-3 text-xs text-slate-500">{recommendation.reason}</p>
      )}
      <div className="flex flex-col gap-2">
        {PROFILES.map((p) => (
          <label
            key={p}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
              profile === p
                ? "border-primary bg-primary/10"
                : "border-border hover:border-slate-500"
            }`}
          >
            <input
              type="radio"
              name="profile"
              checked={profile === p}
              onChange={() => onProfileChange(p)}
              className="accent-primary"
            />
            <div>
              <span className="text-sm font-medium text-slate-200">
                {t(`wizard.environment.profile.${p}`)}
              </span>
              <p className="text-xs text-slate-500">
                {t(`wizard.environment.profileDesc.${p}`)}
              </p>
            </div>
            {recommendation?.recommended === p && (
              <span className="ml-auto rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary">
                {t("wizard.environment.recommended")}
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

function HwCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-surface-inset p-3">
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-slate-500" />
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {label}
        </p>
      </div>
      <p className="truncate text-sm font-medium text-slate-200">{value}</p>
      {sub && <p className="truncate text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
