import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { Bell, Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";

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
  { key: "restartFailedEnabled", labelKey: "settings.notifications.restartFailed" },
  { key: "backupFailedEnabled", labelKey: "settings.notifications.backupFailed" },
  { key: "taskFailedEnabled", labelKey: "settings.notifications.taskFailed" },
  { key: "updateAvailableEnabled", labelKey: "settings.notifications.updateAvailable" },
  { key: "tunnelStoppedEnabled", labelKey: "settings.notifications.tunnelStopped" },
  { key: "informationalEnabled", labelKey: "settings.notifications.informational" },
];

function preferencesEqual(
  left: NotificationPreferences,
  right: NotificationPreferences,
) {
  return notificationPreferenceRows.every(
    (row) => left[row.key] === right[row.key],
  );
}

export function NotificationSettings() {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [draftPreferences, setDraftPreferences] =
    useState<NotificationPreferences | null>(null);
  const baselineRef = useRef<NotificationPreferences | null>(null);
  const preferencesQuery = useQuery({
    queryKey: ["notificationPreferences"],
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<NotificationPreferences>(
        "get_notification_preferences",
      ),
  });
  const eventsQuery = useQuery({
    queryKey: ["notificationEvents"],
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
      baselineRef.current = saved;
      setDraftPreferences(saved);
      await queryClient.invalidateQueries({
        queryKey: ["notificationPreferences"],
      });
    },
  });
  const preferences = draftPreferences;
  const hasChanges =
    preferences !== null &&
    baselineRef.current !== null &&
    !preferencesEqual(preferences, baselineRef.current);

  useEffect(() => {
    if (!preferencesQuery.data) {
      return;
    }
    if (
      baselineRef.current === null ||
      draftPreferences === null ||
      preferencesEqual(draftPreferences, baselineRef.current)
    ) {
      baselineRef.current = preferencesQuery.data;
      setDraftPreferences(preferencesQuery.data);
    }
  }, [draftPreferences, preferencesQuery.data]);

  function updatePreference(
    key: keyof NotificationPreferences,
    value: boolean,
  ) {
    if (!preferences) {
      return;
    }
    setDraftPreferences({
      ...preferences,
      [key]: value,
    });
  }

  return (
    <section className="settings-panel" aria-label={t("settings.notifications.title")}>
      <div className="section-heading">
        <h2>{t("settings.notifications.title")}</h2>
        <Bell aria-hidden="true" size={18} />
      </div>
      {preferencesQuery.error ? (
        <p className="danger-text">{preferencesQuery.error.message}</p>
      ) : null}
      {saveMutation.error ? (
        <p className="danger-text">{saveMutation.error.message}</p>
      ) : null}
      {preferences ? (
        <div className="settings-grid">
          {notificationPreferenceRows.map((row) => (
            <label className="switch-row" key={row.key}>
              <Switch
                checked={preferences[row.key]}
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
      <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <Button
          disabled={saveMutation.isPending || !preferences || !hasChanges}
          variant="secondary"
          onClick={() => preferences && saveMutation.mutate(preferences)}
        >
          <Save aria-hidden="true" size={15} />
          {t("settings.notifications.save")}
        </Button>
      </div>
      {eventsQuery.data?.length ? (
        <div className="compatibility-list">
          {eventsQuery.data.map((event) => (
            <div key={event.id}>
              <strong>{event.title}</strong>
              <span>{event.message}</span>
              <span>
                {event.desktopDelivered
                  ? t("settings.notifications.desktopSent")
                  : t("settings.notifications.inlineOnly")}{" - "}
                {formatDateTime(event.createdAt)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
