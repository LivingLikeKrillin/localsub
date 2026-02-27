import { useTranslation } from "react-i18next";
import { FolderOutput } from "lucide-react";
import { pickDirectory } from "../../lib/tauriApi";

const FORMATS = ["srt", "vtt", "ass", "txt"];
const LANGUAGES = [
  "en", "ko", "ja", "zh", "es", "fr", "de", "pt", "ru", "ar",
];

interface StepOutputProps {
  outputDir: string;
  subtitleFormat: string;
  sourceLanguage: string;
  targetLanguage: string;
  onUpdate: (patch: {
    outputDir?: string;
    subtitleFormat?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
  }) => void;
}

export function StepOutput({
  outputDir,
  subtitleFormat,
  sourceLanguage,
  targetLanguage,
  onUpdate,
}: StepOutputProps) {
  const { t } = useTranslation();

  const handleBrowse = async () => {
    const selected = await pickDirectory();
    if (selected) {
      onUpdate({ outputDir: selected });
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <FolderOutput className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-slate-50">
          {t("wizard.output.title")}
        </h2>
      </div>

      {/* Output folder */}
      <div className="mb-5">
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          {t("wizard.output.folderLabel")}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={outputDir}
            className="flex-1 rounded-md border border-border bg-surface-inset px-3 py-2 text-sm text-slate-300"
          />
          <button
            className="cursor-pointer rounded-md bg-surface px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-surface-hover"
            onClick={handleBrowse}
          >
            {t("wizard.output.browse")}
          </button>
        </div>
      </div>

      {/* Subtitle format */}
      <div className="mb-5">
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          {t("wizard.output.formatLabel")}
        </label>
        <select
          value={subtitleFormat}
          onChange={(e) => onUpdate({ subtitleFormat: e.target.value })}
          className="w-full rounded-md border border-border bg-surface-inset px-3 py-2 text-sm text-slate-300"
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              .{f}
            </option>
          ))}
        </select>
      </div>

      {/* Source language */}
      <div className="mb-5">
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          {t("wizard.output.sourceLanguage")}
        </label>
        <select
          value={sourceLanguage}
          onChange={(e) => onUpdate({ sourceLanguage: e.target.value })}
          className="w-full rounded-md border border-border bg-surface-inset px-3 py-2 text-sm text-slate-300"
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {/* Target language */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          {t("wizard.output.targetLanguage")}
        </label>
        <select
          value={targetLanguage}
          onChange={(e) => onUpdate({ targetLanguage: e.target.value })}
          className="w-full rounded-md border border-border bg-surface-inset px-3 py-2 text-sm text-slate-300"
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
