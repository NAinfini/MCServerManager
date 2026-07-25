import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { queryKeys } from "../../lib/query-keys";

export interface NotificationEvent {
  id: string;
  kind: string;
  severity: string;
  title: string;
  message: string;
  desktopDelivered: number;
  createdAt: string;
}

export const notificationKeys = queryKeys.notifications;

export function listNotificationEvents() {
  return invokeDesktopCommandWithErrorHandling<NotificationEvent[]>(
    "list_notification_events",
  );
}
