import { Box } from "@mantine/core";
import { Select } from "../../components/ui/select";
import { SettingSection } from "../../components/ui/setting-row";
import { useAppSettings, type Language } from "../../i18n";

export function LocalizationSettings() {
  const { language, setLanguage, t } = useAppSettings();

  return (
    <SettingSection
      title={t("settings.language.title")}
      aria-label={t("settings.language.title")}
    >
      {/* No row label: the section heading already names the setting, and
          repeating it printed "Language" twice on consecutive lines. */}
      <Box py="sm" maw={280}>
        <Select
          ariaLabel={t("settings.language.label")}
          value={language}
          options={[
            { value: "en", label: t("settings.language.en") },
            { value: "zh-CN", label: t("settings.language.zhCN") },
          ]}
          onValueChange={(value) => setLanguage(value as Language)}
        />
      </Box>
    </SettingSection>
  );
}
