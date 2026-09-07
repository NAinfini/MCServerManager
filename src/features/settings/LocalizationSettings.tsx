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
      {/* A settings row rather than a one-cell form grid: the control then sits
          on the same rail as every other setting in this pane, and the Select
          stops being wrapped in a label that carries no text. The row carries no
          label of its own — the section heading above already names the setting,
          and repeating it printed "Language" twice on consecutive lines. */}
      <div className="settings-row">
        <Select
          ariaLabel={t("settings.language.label")}
          value={language}
          options={[
            { value: "en", label: t("settings.language.en") },
            { value: "zh-CN", label: t("settings.language.zhCN") },
          ]}
          onValueChange={(value) => setLanguage(value as Language)}
        />
      </div>
    </section>
  );
}
