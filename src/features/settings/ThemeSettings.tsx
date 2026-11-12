import { Group, Radio, SimpleGrid, Stack, Text } from "@mantine/core";
import { Monitor, Moon, Sun } from "lucide-react";
import { SettingSection } from "../../components/ui/setting-row";
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
    <SettingSection
      title={t("settings.theme.title")}
      aria-label={t("settings.theme.title")}
    >
      <SimpleGrid
        cols={3}
        spacing="sm"
        py="sm"
        role="radiogroup"
        aria-label={t("settings.theme.label")}
      >
        {choices.map(({ icon: Icon, label, value }) => (
          <Radio.Card
            key={value}
            name="theme"
            value={value}
            checked={theme === value}
            aria-label={label}
            p="xs"
            onClick={() => setTheme(value)}
          >
            {/* The swatch depicts a theme other than the active one, so it is
                drawn from fixed colours rather than Mantine tokens. */}
            <Stack gap="xs">
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
              <Group gap={6} wrap="nowrap">
                <Radio.Indicator size="xs" />
                <Icon aria-hidden="true" size={14} />
                <Text size="sm" fw={500} truncate>
                  {label}
                </Text>
              </Group>
            </Stack>
          </Radio.Card>
        ))}
      </SimpleGrid>
    </SettingSection>
  );
}
