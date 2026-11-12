import { ActionIcon, Group, Image, Text } from "@mantine/core";
import { Minus, Square, X } from "lucide-react";
import { useAppSettings } from "../../i18n";
import { runDesktopWindowAction } from "../../lib/desktop-runtime";

const controls = [
  { action: "minimize", key: "minimize", icon: Minus, size: 16 },
  { action: "toggleMaximize", key: "maximize", icon: Square, size: 13 },
  { action: "close", key: "close", icon: X, size: 16 },
] as const;

/* The titlebar is the window's drag region; its controls opt out of it. */
export function WindowTitlebar() {
  const { t } = useAppSettings();

  return (
    <Group className="window-titlebar" gap={0} justify="space-between">
      <Group gap="xs" px="sm">
        <Image
          alt=""
          aria-hidden="true"
          h={16}
          radius="xs"
          src="./app-icon.png"
          w={16}
        />
        <Text c="dimmed" fw={500} size="xs">
          MC Server Manager
        </Text>
      </Group>
      <Group className="window-titlebar-controls" gap={0} h="100%">
        {controls.map(({ action, key, icon: Icon, size }) => (
          <ActionIcon
            aria-label={t(`window.${key}.aria`)}
            h="100%"
            key={key}
            radius={0}
            title={t(`window.${key}.title`)}
            w={46}
            onClick={() => void runDesktopWindowAction(action)}
          >
            <Icon aria-hidden="true" size={size} />
          </ActionIcon>
        ))}
      </Group>
    </Group>
  );
}
