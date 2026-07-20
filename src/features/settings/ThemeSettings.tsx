import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useAppSettings, type ThemeSetting } from "../../i18n";

export function ThemeSettings() {
  const { setTheme, t, theme } = useAppSettings();
  const choices: Array<{
    icon: typeof Monitor;
    label: string;
    value: ThemeSetting;
  }> = [
    { icon: Monitor, label: t("settings.theme.system"), value: "system" },
    { icon: Sun, label: t("settings.theme.light"), value: "light" },
    { icon: Moon, label: t("settings.theme.dark"), value: "dark" },
  ];

  return (
    <section
      className="settings-plain-section"
      aria-label={t("settings.theme.title")}
    >
      <div className="section-heading">
        <h2>{t("settings.theme.title")}</h2>
        <Palette aria-hidden="true" size={18} />
      </div>
      <div
        aria-label={t("settings.theme.label")}
        className="theme-choice-grid"
        role="radiogroup"
      >
        {choices.map(({ icon: Icon, label, value }) => (
          <button
            aria-checked={theme === value}
            aria-label={label}
            className={`theme-choice${
              theme === value ? " theme-choice-active" : ""
            }`}
            key={value}
            role="radio"
            type="button"
            onClick={() => setTheme(value)}
          >
            <span
              aria-hidden="true"
              className={`theme-preview theme-preview-${value}`}
            >
              <span className="theme-preview-sidebar" />
              <span className="theme-preview-content">
                <span />
                <span />
              </span>
            </span>
            <span className="theme-choice-label">
              <Icon aria-hidden="true" size={14} />
              {label}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
