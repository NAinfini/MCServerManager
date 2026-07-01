import { Languages } from "lucide-react";
import { Select } from "../../components/ui/select";
import { useAppSettings, type Language } from "../../i18n";

export function LocalizationSettings() {
  const { language, setLanguage, t } = useAppSettings();

  return (
    <section
      className="settings-plain-section"
      aria-label={t("settings.language.title")}
    >
      <div className="section-heading">
        <h2>{t("settings.language.title")}</h2>
        <Languages aria-hidden="true" size={18} />
      </div>
      <div className="settings-grid">
        <label>
          <Select
            ariaLabel={t("settings.language.label")}
            value={language}
            options={[
              { value: "en", label: t("settings.language.en") },
              { value: "zh-CN", label: t("settings.language.zhCN") },
            ]}
            onValueChange={(value) => setLanguage(value as Language)}
          />
        </label>
      </div>
    </section>
  );
}
