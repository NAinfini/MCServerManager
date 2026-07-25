import { useQuery } from "@tanstack/react-query";
import { Bell, RefreshCw, Settings, X } from "lucide-react";
import { Button } from "../ui/button";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import {
  listNotificationEvents,
  notificationKeys,
} from "../../features/notifications/api";
import { useNotificationStore } from "../../features/notifications/notificationStore";

export function NotificationCenter({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const { language, t } = useAppSettings();
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
    <details className="notification-center">
      <summary
        aria-label={t("notifications.open")}
        className="status-bar-action notification-center-trigger"
      >
        <Bell aria-hidden="true" size={13} />
        {items.length > 0 ? (
          <span className="notification-center-count">
            {Math.min(items.length, 99)}
          </span>
        ) : null}
      </summary>
      <section
        aria-label={t("notifications.title")}
        className="notification-center-panel"
      >
        <header>
          <div>
            <strong>{t("notifications.title")}</strong>
            <span>{t("notifications.description")}</span>
          </div>
          <Button
            aria-label={t("notifications.settings")}
            className="icon-button"
            variant="ghost"
            onClick={onOpenSettings}
          >
            <Settings aria-hidden="true" size={15} />
          </Button>
        </header>
        {eventsQuery.error ? (
          <div className="notification-center-error" role="alert">
            <span>{eventsQuery.error.message}</span>
            <Button
              aria-label={t("common.retry")}
              className="icon-button"
              variant="ghost"
              onClick={() => void eventsQuery.refetch()}
            >
              <RefreshCw aria-hidden="true" size={14} />
            </Button>
          </div>
        ) : null}
        <div className="notification-center-list">
          {items.map((item) => (
            <article
              className={`notification-center-item notification-center-item-${item.severity}`}
              key={item.id}
            >
              <div>
                <strong>{item.title}</strong>
                <span>{item.message}</span>
                <time dateTime={item.createdAt}>
                  {formatDateTime(item.createdAt, language)}
                </time>
              </div>
              <Button
                aria-label={t("notifications.dismiss")}
                className="icon-button"
                variant="ghost"
                onClick={() => dismiss(item.id)}
              >
                <X aria-hidden="true" size={13} />
              </Button>
            </article>
          ))}
          {persistentEvents.map((item) => (
            <article
              className={`notification-center-item notification-center-item-${item.severity}`}
              key={item.id}
            >
              <div>
                <strong>{item.title}</strong>
                <span>{item.message}</span>
                <time dateTime={item.createdAt}>
                  {formatDateTime(item.createdAt, language)}
                </time>
              </div>
            </article>
          ))}
          {!eventsQuery.isLoading && !hasNotifications ? (
            <p className="notification-center-empty">
              {t("notifications.empty")}
            </p>
          ) : null}
        </div>
        {items.length > 0 ? (
          <footer>
            <Button variant="ghost" onClick={clear}>
              {t("notifications.clear")}
            </Button>
          </footer>
        ) : null}
      </section>
    </details>
  );
}
