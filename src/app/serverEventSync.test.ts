import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { notificationKeys } from "../features/notifications/api";
import { useNotificationStore } from "../features/notifications/notificationStore";
import { performanceKeys } from "../features/performance/performanceApi";
import { processKeys } from "../features/process/queries";
import { applyDesktopServerEvent } from "./serverEventSync";

describe("server event query synchronization", () => {
  it("shows a backend notification and refreshes the stored list", () => {
    const queryClient = new QueryClient();
    useNotificationStore.getState().clear();
    queryClient.setQueryData(notificationKeys.events, []);

    applyDesktopServerEvent(queryClient, {
      serverId: "server-1",
      kind: "notification",
      payload: {
        id: "n1",
        kind: "backup_failed",
        severity: "error",
        title: "Backup failed",
        message: "Survival: disk full",
        createdAt: "2026-07-24T20:00:00.000Z",
      },
    });

    expect(useNotificationStore.getState().items[0]).toMatchObject({
      severity: "error",
      title: "Backup failed",
      message: "Survival: disk full",
    });
    expect(
      queryClient.getQueryState(notificationKeys.events)?.isInvalidated,
    ).toBe(true);
    useNotificationStore.getState().clear();
  });

  it("appends console events without duplicates", () => {
    const queryClient = new QueryClient();
    const payload = {
      id: "event-1",
      serverId: "server-1",
      level: "info",
      message: "Ready",
      createdAt: "2026-07-24T20:00:00.000Z",
    };

    applyDesktopServerEvent(queryClient, {
      serverId: "server-1",
      kind: "console",
      payload,
    });
    applyDesktopServerEvent(queryClient, {
      serverId: "server-1",
      kind: "console",
      payload,
    });

    expect(queryClient.getQueryData(processKeys.events("server-1"))).toEqual([
      payload,
    ]);
  });

  it("prepends metric samples to the shared history cache", () => {
    const queryClient = new QueryClient();
    const payload = {
      id: "sample-1",
      cpuPercent: 12,
      memoryMb: 512,
      diskFreeMb: 1024,
      uptimeSeconds: 30,
      restartCount: 0,
      playerCount: 2,
      tps: 20,
      unavailableReason: null,
      sampledAt: "2026-07-24T20:00:00.000Z",
    };

    applyDesktopServerEvent(queryClient, {
      serverId: "server-1",
      kind: "metrics",
      payload,
    });

    expect(
      queryClient.getQueryData(performanceKeys.history("server-1")),
    ).toMatchObject({ serverId: "server-1", samples: [payload] });
  });
});
