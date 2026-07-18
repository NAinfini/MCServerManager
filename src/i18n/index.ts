import {
  createContext,
  createElement,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export type Language = "en" | "zh-CN";
export type ThemeSetting = "system" | "light" | "dark";

interface AppSettingsContextValue {
  formatCompactNumber: (value?: number) => string;
  language: Language;
  setLanguage: (language: Language) => void;
  setTheme: (theme: ThemeSetting) => void;
  t: (key: string, values?: Record<string, string | number | null | undefined>) => string;
  theme: ThemeSetting;
}

const LANGUAGE_KEY = "mcsm.language";
const THEME_KEY = "mcsm.theme";
const dictionaries: Record<Language, Record<string, string>> = {
  en,
  "zh-CN": zhCN,
};

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

function readStoredLanguage(): Language {
  return localStorage.getItem(LANGUAGE_KEY) === "zh-CN" ? "zh-CN" : "en";
}

function readStoredTheme(): ThemeSetting {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

function systemPrefersDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function applyTheme(theme: ThemeSetting) {
  const resolvedTheme =
    theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);
  const [theme, setThemeState] = useState<ThemeSetting>(readStoredTheme);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    if (theme !== "system" || !window.matchMedia) {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      formatCompactNumber: (value?: number) => {
        if (!value) {
          return "0";
        }
        return new Intl.NumberFormat(language, { notation: "compact" }).format(
          value,
        );
      },
      language,
      setLanguage: setLanguageState,
      setTheme: setThemeState,
      t: (
        key: string,
        values?: Record<string, string | number | null | undefined>,
      ) => {
        const template = dictionaries[language][key] ?? `[[${key}]]`;
        if (!values) {
          return template;
        }
        return template.replace(/\{(\w+)\}/g, (match, name) =>
          values[name] === undefined || values[name] === null
            ? match
            : String(values[name]),
        );
      },
      theme,
    }),
    [language, theme],
  );

  return createElement(AppSettingsContext.Provider, { value }, children);
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error("useAppSettings must be used inside AppSettingsProvider");
  }

  return context;
}
