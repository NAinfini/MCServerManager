import { Palette } from "lucide-react";
import { Select } from "../../components/ui/select";
import { useAppSettings, type ThemeSetting } from "../../i18n";

export function ThemeSettings() {
  const { setTheme, t, theme } = useAppSettings();

  return (
    <section
      className="settings-plain-section"
      aria-label={t("settings.theme.title")}
    >
      <div className="section-heading">
        <h2>{t("settings.theme.title")}</h2>
        <Palette aria-hidden="true" size={18} />
      </div>
      <div className="settings-grid">
        <label>
          <Select
            ariaLabel={t("settings.theme.label")}
            value={theme}
            options={[
              { value: "system", label: t("settings.theme.system") },
              { value: "light", label: t("settings.theme.light") },
              { value: "dark", label: t("settings.theme.dark") },
            ]}
            onValueChange={(value) => setTheme(value as ThemeSetting)}
          />
        </label>
      </div>
    </section>
  );
}
