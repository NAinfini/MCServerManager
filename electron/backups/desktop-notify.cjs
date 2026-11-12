"use strict";
/*
 * Turns a backend "notification" server event into an operating-system
 * notification. The backend has already stored the in-app copy and decided,
 * from the user's notification preferences, whether `desktop` is true.
 */
function showDesktopNotification(NotificationClass, event, onClick) {
  if (event?.kind !== "notification" || !event.payload?.desktop) return false;
  if (!NotificationClass?.isSupported?.()) return false;
  const notification = new NotificationClass({
    title: String(event.payload.title || "MC Server Manager"),
    body: String(event.payload.message || ""),
    urgency: event.payload.severity === "error" ? "critical" : "normal",
  });
  if (onClick) notification.on?.("click", onClick);
  notification.show();
  return true;
}

module.exports = { showDesktopNotification };
