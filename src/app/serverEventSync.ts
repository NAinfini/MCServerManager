import type { QueryClient } from "@tanstack/react-query";
import type { ProcessEvent } from "../features/process/api";
import { processKeys } from "../features/process/queries";
import { playerKeys } from "../features/players/queries";
import {
  notificationKeys,
  type NotificationEvent,
} from "../features/notifications/api";
import { useNotificationStore } from "../features/notifications/notificationStore";
import {
  performanceKeys,
  type PerformanceHistory,
  type ServerMetricSample,
} from "../features/performance/performanceApi";
import {
  isDesktopRuntimeAvailable,
  onDesktopServerEvent,
  type DesktopServerEvent,
} from "../lib/desktop-runtime";

function isProcessEvent(value: unknown): value is ProcessEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<ProcessEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.serverId === "string" &&
    typeof event.level === "string" &&
    typeof event.message === "string" &&
    typeof event.createdAt === "string"
  );
}

function isMetricSample(value: unknown): value is ServerMetricSample {
  if (!value || typeof value !== "object") return false;
  const sample = value as Partial<ServerMetricSample>;
  return typeof sample.id === "string" && typeof sample.sampledAt === "string";
}

export function applyDesktopServerEvent(
  queryClient: QueryClient,
  event: DesktopServerEvent,
) {
  if (event.kind === "metrics" && isMetricSample(event.payload)) {
    queryClient.setQueryData<PerformanceHistory>(
      performanceKeys.history(event.serverId),
      (current) => ({
        serverId: event.serverId,
        events: current?.events ?? [],
        samples: [
          event.payload as ServerMetricSample,
          ...(current?.samples ?? []).filter(
            (sample) => sample.id !== (event.payload as ServerMetricSample).id,
          ),
        ].slice(0, 120),
      }),
    );
    return;
  }

  // A backend-raised notification (for example a failed backup): refresh the
  // stored list and show it now. The system notification is main.cjs's job.
  if (event.kind === "notification") {
    const item = event.payload as Partial<NotificationEvent> | null;
    void queryClient.invalidateQueries({ queryKey: notificationKeys.events });
    if (item?.title) {
      useNotificationStore.getState().push({
        severity: item.severity === "error" ? "error" : "warning",
        title: item.title,
        message: item.message ?? "",
      });
    }
    return;
  }

  if (!isProcessEvent(event.payload)) return;
  const payload = event.payload;
  queryClient.setQueryData<ProcessEvent[]>(
    processKeys.events(event.serverId),
    (current) =>
      [
        ...(current ?? []).filter((item) => item.id !== payload.id),
        payload,
      ].slice(-1_000),
  );

  if (event.kind === "lifecycle") {
    void queryClient.invalidateQueries({
      queryKey: processKeys.status(event.serverId),
    });
    void queryClient.invalidateQueries({ queryKey: processKeys.summary });
  }
  if (event.kind === "players") {
    void queryClient.invalidateQueries({
      queryKey: playerKeys.list(event.serverId),
    });
  }
}

export function installDesktopServerEventSync(queryClient: QueryClient) {
  if (!isDesktopRuntimeAvailable()) return () => undefined;
  return onDesktopServerEvent((event) =>
    applyDesktopServerEvent(queryClient, event),
  );
}
