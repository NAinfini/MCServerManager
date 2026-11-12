import { useQuery } from "@tanstack/react-query";
import {
  ActionIcon,
  Box,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Bell, RefreshCw, Settings, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui/button";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import {
  listNotificationEvents,
  notificationKeys,
} from "../../features/notifications/api";
import { useNotificationStore } from "../../features/notifications/notificationStore";

const severityColors: Record<string, string> = {
  error: "red",
  warning: "yellow",
  success: "green",
};

function NotificationItem({
  item,
  action,
}: {
  item: {
    title: string;
    message?: string;
    createdAt: string;
    severity: string;
  };
  action?: ReactNode;
}) {
  const { language } = useAppSettings();
  return (
    <Group align="flex-start" gap="sm" wrap="nowrap">
      <Box
        aria-hidden="true"
        bg={`${severityColors[item.severity] ?? "azure"}.6`}
        h={8}
        mt={5}
        style={{ borderRadius: "50%", flex: "none" }}
        w={8}
      />
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm">
          {item.title}
        </Text>
        {item.message ? (
          <Text c="dimmed" size="xs" style={{ overflowWrap: "anywhere" }}>
            {item.message}
          </Text>
        ) : null}
        <Text c="dimmed" component="time" dateTime={item.createdAt} size="xs">
          {formatDateTime(item.createdAt, language)}
        </Text>
      </Stack>
      {action}
    </Group>
  );
}

export function NotificationCenter({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const { t } = useAppSettings();
  const [opened, { close, toggle }] = useDisclosure(false);
  const items = useNotificationStore((state) => state.items);
  const dismiss = useNotificationStore((state) => state.dismiss);
  const clear = useNotificationStore((state) => state.clear);
  const eventsQuery = useQuery({
    queryKey: notificationKeys.events,
    queryFn: listNotificationEvents,
  });
  const persistentEvents = eventsQuery.data ?? [];
  const hasNotifications = items.length > 0 || persistentEvents.length > 0;

  return (
    /* The count sits on the bell, outside the popover's trigger, so the
       trigger stays a plain button. */
    <Indicator
      disabled={items.length === 0}
      label={Math.min(items.length, 99)}
      offset={4}
      size={16}
    >
      <Popover
        opened={opened}
        position="right-end"
        shadow="md"
        width={340}
        onClose={close}
      >
        <Popover.Target>
          <ActionIcon
            aria-label={t("notifications.open")}
            size="lg"
            onClick={toggle}
          >
            <Bell aria-hidden="true" size={16} />
          </ActionIcon>
        </Popover.Target>
        <Popover.Dropdown p={0}>
          <Stack
            aria-label={t("notifications.title")}
            component="section"
            gap={0}
          >
            <Group justify="space-between" p="sm" wrap="nowrap">
              <div>
                <Text fw={600} size="sm">
                  {t("notifications.title")}
                </Text>
                <Text c="dimmed" size="xs">
                  {t("notifications.description")}
                </Text>
              </div>
              <Tooltip label={t("notifications.settings")}>
                <ActionIcon
                  aria-label={t("notifications.settings")}
                  onClick={() => {
                    close();
                    onOpenSettings();
                  }}
                >
                  <Settings aria-hidden="true" size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
            {eventsQuery.error ? (
              <Group gap="xs" px="sm" pb="sm" role="alert" wrap="nowrap">
                <Text c="red" size="xs" style={{ flex: 1 }}>
                  {eventsQuery.error.message}
                </Text>
                <ActionIcon
                  aria-label={t("common.retry")}
                  onClick={() => void eventsQuery.refetch()}
                >
                  <RefreshCw aria-hidden="true" size={14} />
                </ActionIcon>
              </Group>
            ) : null}
            <ScrollArea.Autosize mah={380}>
              <Stack gap="md" px="sm" pb="sm">
                {items.map((item) => (
                  <NotificationItem
                    action={
                      <ActionIcon
                        aria-label={t("notifications.dismiss")}
                        size="sm"
                        onClick={() => dismiss(item.id)}
                      >
                        <X aria-hidden="true" size={14} />
                      </ActionIcon>
                    }
                    item={item}
                    key={item.id}
                  />
                ))}
                {persistentEvents.map((item) => (
                  <NotificationItem item={item} key={item.id} />
                ))}
                {!eventsQuery.isLoading && !hasNotifications ? (
                  <Text c="dimmed" py="md" size="sm" ta="center">
                    {t("notifications.empty")}
                  </Text>
                ) : null}
              </Stack>
            </ScrollArea.Autosize>
            {items.length > 0 ? (
              <Group justify="flex-end" p="xs">
                <Button variant="ghost" onClick={clear}>
                  {t("notifications.clear")}
                </Button>
              </Group>
            ) : null}
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </Indicator>
  );
}
