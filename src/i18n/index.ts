import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ko from "./locales/ko.json";

function detectLanguage(): string {
  const stored = localStorage.getItem("ui_language");
  if (stored && ["en", "ko"].includes(stored)) return stored;
  const lang = navigator.language.split("-")[0];
  return ["en", "ko"].includes(lang) ? lang : "en";
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ko: { translation: ko } },
  lng: detectLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
