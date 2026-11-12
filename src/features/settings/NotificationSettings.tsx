import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { Alert, Box, Group, Stack, Switch, Text } from "@mantine/core";
import { Button } from "../../components/ui/button";
import { LoadingState } from "../../components/ui/loading-state";
import { SettingRow, SettingSection } from "../../components/ui/setting-row";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import { notificationKeys } from "../notifications/api";

interface NotificationPreferences {
  desktopEnabled: boolean;
  crashEnabled: boolean;
  restartFailedEnabled: boolean;
  backupFailedEnabled: boolean;
  taskFailedEnabled: boolean;
  updateAvailableEnabled: boolean;
  tunnelStoppedEnabled: boolean;
  informationalEnabled: boolean;
}

interface NotificationEvent {
  id: string;
  kind: string;
  severity: string;
  title: string;
  message: string;
  desktopDelivered: number;
  createdAt: string;
}

const notificationPreferenceRows: Array<{
  key: keyof NotificationPreferences;
  labelKey: string;
}> = [
  { key: "desktopEnabled", labelKey: "settings.notifications.desktop" },
  { key: "crashEnabled", labelKey: "settings.notifications.crash" },
  {
    key: "restartFailedEnabled",
    labelKey: "settings.notifications.restartFailed",
  },
  {
    key: "backupFailedEnabled",
    labelKey: "settings.notifications.backupFailed",
  },
  { key: "taskFailedEnabled", labelKey: "settings.notifications.taskFailed" },
  {
    key: "updateAvailableEnabled",
    labelKey: "settings.notifications.updateAvailable",
  },
  {
    key: "tunnelStoppedEnabled",
    labelKey: "settings.notifications.tunnelStopped",
  },
  {
    key: "informationalEnabled",
    labelKey: "settings.notifications.informational",
  },
];

export function NotificationSettings() {
  const { language, t } = useAppSettings();
  const queryClient = useQueryClient();
  const [draftPreferences, setDraftPreferences] =
    useState<NotificationPreferences | null>(null);
  const preferencesQuery = useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<NotificationPreferences>(
        "get_notification_preferences",
      ),
  });
  const eventsQuery = useQuery({
    queryKey: notificationKeys.events,
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<NotificationEvent[]>(
        "list_notification_events",
      ),
  });
  const saveMutation = useMutation({
    mutationFn: (preferences: NotificationPreferences) =>
      invokeDesktopCommandWithErrorHandling<NotificationPreferences>(
        "save_notification_preferences",
        { preferences },
      ),
    onSuccess: async (saved) => {
      setDraftPreferences(saved);
      await queryClient.invalidateQueries({
        queryKey: notificationKeys.preferences,
      });
    },
  });
  const preferences = draftPreferences;

  useEffect(() => {
    if (preferencesQuery.data) setDraftPreferences(preferencesQuery.data);
  }, [preferencesQuery.data]);

  function updatePreference(
    key: keyof NotificationPreferences,
    value: boolean,
  ) {
    if (!preferences) {
      return;
    }
    const next = {
      ...preferences,
      [key]: value,
    };
    setDraftPreferences(next);
    saveMutation.mutate(next);
  }

  return (
    <SettingSection
      title={t("settings.notifications.title")}
      aria-label={t("settings.notifications.title")}
      actions={
        <Text size="sm" c="dimmed" aria-live="polite">
          {saveMutation.isPending
            ? t("settings.save.saving")
            : saveMutation.isSuccess
              ? t("settings.save.saved")
              : ""}
        </Text>
      }
    >
      {preferencesQuery.error ? (
        <Alert
          aria-label={t("settings.notifications.preferencesLoadError")}
          color="red"
          my="sm"
          role="alert"
          title={t("settings.notifications.preferencesLoadError")}
        >
          <Group justify="space-between" gap="sm">
            <Text size="sm">{preferencesQuery.error.message}</Text>
            <Button
              disabled={preferencesQuery.isFetching}
              variant="secondary"
              onClick={() => preferencesQuery.refetch()}
            >
              {t("common.retry")}
            </Button>
          </Group>
        </Alert>
      ) : null}
      {saveMutation.error ? (
        <Alert color="red" my="sm" role="alert">
          {saveMutation.error.message}
        </Alert>
      ) : null}
      {preferencesQuery.isLoading ? (
        <LoadingState
          message={t("settings.notifications.preferencesLoading")}
        />
      ) : null}
      {preferences
        ? notificationPreferenceRows.map((row) => (
            <SettingRow key={row.key} label={t(row.labelKey)}>
              <Switch
                checked={preferences[row.key]}
                disabled={saveMutation.isPending}
                aria-label={t(row.labelKey)}
                onChange={(event) =>
                  updatePreference(row.key, event.currentTarget.checked)
                }
              />
            </SettingRow>
          ))
        : null}
      <Box py="sm">
        {eventsQuery.isLoading ? (
          <LoadingState message={t("settings.notifications.historyLoading")} />
        ) : eventsQuery.error ? (
          <Alert
            aria-label={t("settings.notifications.historyLoadError")}
            color="red"
            role="alert"
            title={t("settings.notifications.historyLoadError")}
          >
            <Group justify="space-between" gap="sm">
              <Text size="sm">{eventsQuery.error.message}</Text>
              <Button
                aria-label={t("settings.notifications.retryHistory")}
                disabled={eventsQuery.isFetching}
                variant="secondary"
                onClick={() => eventsQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </Group>
          </Alert>
        ) : eventsQuery.data?.length ? (
          <Stack gap="sm">
            {eventsQuery.data.map((event) => (
              <Box key={event.id}>
                <Text size="sm" fw={500}>
                  {event.title}
                </Text>
                <Text size="sm">{event.message}</Text>
                <Text size="xs" c="dimmed">
                  {event.desktopDelivered
                    ? t("settings.notifications.desktopSent")
                    : t("settings.notifications.inlineOnly")}
                  {" - "}
                  {formatDateTime(event.createdAt, language)}
                </Text>
              </Box>
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            {t("settings.notifications.historyEmpty")}
          </Text>
        )}
      </Box>
    </SettingSection>
  );
}
