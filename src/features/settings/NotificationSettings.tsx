import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { Bell } from "lucide-react";
import { Button } from "../../components/ui/button";
import { LoadingState } from "../../components/ui/loading-state";
import { Switch } from "../../components/ui/switch";
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
    <section
      className="settings-panel"
      aria-label={t("settings.notifications.title")}
    >
      <div className="section-heading">
        <h2>{t("settings.notifications.title")}</h2>
        <Bell aria-hidden="true" size={18} />
      </div>
      {preferencesQuery.error ? (
        <div
          aria-label={t("settings.notifications.preferencesLoadError")}
          className="list-state list-state-error"
          role="alert"
        >
          <strong>{t("settings.notifications.preferencesLoadError")}</strong>
          <span>{preferencesQuery.error.message}</span>
          <Button
            disabled={preferencesQuery.isFetching}
            variant="secondary"
            onClick={() => preferencesQuery.refetch()}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      {saveMutation.error ? (
        <p className="danger-text" role="alert">
          {saveMutation.error.message}
        </p>
      ) : null}
      <span className="settings-save-state" aria-live="polite">
        {saveMutation.isPending
          ? t("settings.save.saving")
          : saveMutation.isSuccess
            ? t("settings.save.saved")
            : ""}
      </span>
      {preferencesQuery.isLoading ? (
        <LoadingState
          message={t("settings.notifications.preferencesLoading")}
        />
      ) : preferences ? (
        <div className="settings-grid">
          {notificationPreferenceRows.map((row) => (
            <label className="switch-row" key={row.key}>
              <Switch
                checked={preferences[row.key]}
                disabled={saveMutation.isPending}
                aria-label={t(row.labelKey)}
                onCheckedChange={(checked) =>
                  updatePreference(row.key, checked)
                }
              />
              {t(row.labelKey)}
            </label>
          ))}
        </div>
      ) : null}
      {eventsQuery.isLoading ? (
        <LoadingState message={t("settings.notifications.historyLoading")} />
      ) : eventsQuery.error ? (
        <div
          aria-label={t("settings.notifications.historyLoadError")}
          className="list-state list-state-error"
          role="alert"
        >
          <strong>{t("settings.notifications.historyLoadError")}</strong>
          <span>{eventsQuery.error.message}</span>
          <Button
            aria-label={t("settings.notifications.retryHistory")}
            disabled={eventsQuery.isFetching}
            variant="secondary"
            onClick={() => eventsQuery.refetch()}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : eventsQuery.data?.length ? (
        <div className="compatibility-list">
          {eventsQuery.data.map((event) => (
            <div key={event.id}>
              <strong>{event.title}</strong>
              <span>{event.message}</span>
              <span>
                {event.desktopDelivered
                  ? t("settings.notifications.desktopSent")
                  : t("settings.notifications.inlineOnly")}
                {" - "}
                {formatDateTime(event.createdAt, language)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="list-state">
          {t("settings.notifications.historyEmpty")}
        </div>
      )}
    </section>
  );
}
