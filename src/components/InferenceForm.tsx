import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  disabled: boolean;
  onSubmit: (inputText: string) => void;
}

export function InferenceForm({ disabled, onSubmit }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim() && !disabled) {
      onSubmit(text.trim());
      setText("");
    }
  };

  return (
    <form
      className="mb-5 flex flex-col gap-3 rounded-[10px] bg-surface p-4"
      onSubmit={handleSubmit}
    >
      <textarea
        className="w-full resize-y rounded-md border border-border bg-surface-inset p-2.5 font-[inherit] text-[0.9rem] text-slate-200 focus:border-primary focus:outline-none disabled:opacity-50"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("inference.placeholder")}
        rows={3}
        disabled={disabled}
      />
      <button
        className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
        type="submit"
        disabled={disabled || !text.trim()}
      >
        {t("inference.submitButton")}
      </button>
    </form>
  );
}
