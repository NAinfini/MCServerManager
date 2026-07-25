import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../../test/render";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import { listNotificationEvents } from "../../features/notifications/api";
import { NotificationCenter } from "./NotificationCenter";

vi.mock("../../features/notifications/api", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/notifications/api")
  >("../../features/notifications/api");
  return {
    ...actual,
    listNotificationEvents: vi.fn(async () => []),
  };
});

describe("NotificationCenter", () => {
  afterEach(() => {
    useNotificationStore.getState().clear();
    vi.mocked(listNotificationEvents).mockReset();
    vi.mocked(listNotificationEvents).mockResolvedValue([]);
    cleanup();
  });

  it("collects transient action failures in one dismissible panel", async () => {
    const user = userEvent.setup();
    useNotificationStore.getState().push({
      severity: "error",
      title: "Action failed",
      message: "Could not update the mod.",
    });

    render(<NotificationCenter onOpenSettings={vi.fn()} />);

    expect(screen.getByText("Could not update the mod.")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );

    expect(
      screen.queryByText("Could not update the mod."),
    ).not.toBeInTheDocument();
  });

  it("shows persisted backend notification history", async () => {
    vi.mocked(listNotificationEvents).mockResolvedValue([
      {
        id: "event-1",
        kind: "crash",
        severity: "error",
        title: "Server crashed",
        message: "Exit code 1",
        desktopDelivered: 0,
        createdAt: "2026-07-24T20:00:00.000Z",
      },
    ]);

    render(<NotificationCenter onOpenSettings={vi.fn()} />);

    expect(await screen.findByText("Server crashed")).toBeInTheDocument();
    expect(screen.getByText("Exit code 1")).toBeInTheDocument();
  });
});
