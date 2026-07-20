import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "../../test/render";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import { AppLoggerView } from "./AppLoggerView";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

function renderLogger() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AppLoggerView />
    </QueryClientProvider>,
  );
}

describe("AppLoggerView", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows application logs and filters by level", async () => {
    vi.mocked(invokeDesktopCommand).mockResolvedValue([
      {
        id: "log-2",
        level: "error",
        source: "main.ipc",
        message: "IPC failed",
        details: "Unsupported command",
        createdAt: "2026-07-03T10:00:00.000Z",
      },
      {
        id: "log-1",
        level: "warning",
        source: "renderer.console",
        message: "Renderer warning",
        createdAt: "2026-07-03T09:00:00.000Z",
      },
    ]);

    renderLogger();

    expect(await screen.findByText("IPC failed")).toBeInTheDocument();
    expect(screen.getByText("Renderer warning")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: /^errors$/i }));

    expect(invokeDesktopCommand).toHaveBeenLastCalledWith("list_app_logs", {
      input: { level: "error", limit: 500 },
    });
  });

  it("confirms before clearing logs with the toolbar action", async () => {
    vi.mocked(invokeDesktopCommand).mockImplementation(async (command) => {
      if (command === "clear_app_logs") {
        return { cleared: true };
      }
      return [];
    });

    renderLogger();

    await userEvent.click(
      await screen.findByRole("button", { name: /clear logs/i }),
    );
    expect(invokeDesktopCommand).not.toHaveBeenCalledWith(
      "clear_app_logs",
      undefined,
    );

    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /clear logs/i }),
    );

    expect(invokeDesktopCommand).toHaveBeenCalledWith(
      "clear_app_logs",
      undefined,
    );
    expect(
      await screen.findByRole("heading", { name: "No app logs yet" }),
    ).toBeInTheDocument();
  });

  it("keeps long details readable in a dedicated detail pane", async () => {
    vi.mocked(invokeDesktopCommand).mockResolvedValue([
      {
        id: "log-1",
        level: "error",
        source: "renderer.unhandledrejection",
        message: "Unhandled failure",
        details: "Error: failed\n    at runTask (task.ts:10:3)",
        createdAt: "2026-07-03T10:00:00.000Z",
      },
    ]);

    renderLogger();

    await screen.findByText("Unhandled failure");
    const detailPane = screen.getByLabelText("Log details");
    expect(within(detailPane).getByText(/runTask/)).toBeInTheDocument();
  });

  it("uses separate filter, list, and detail panes", async () => {
    vi.mocked(invokeDesktopCommand).mockResolvedValue([
      {
        id: "log-1",
        level: "error",
        source: "renderer.error",
        message: "Layout failure",
        createdAt: "2026-07-03T10:00:00.000Z",
      },
    ]);

    const { container } = renderLogger();
    await screen.findByText("Layout failure");

    expect(container.querySelector(".logger-filter-rail")).not.toBeNull();
    expect(container.querySelector(".app-log-list")).not.toBeNull();
    expect(container.querySelector(".app-log-detail-pane")).not.toBeNull();
  });

  it("keeps filters and the list pane visible when there are no logs", async () => {
    vi.mocked(invokeDesktopCommand).mockResolvedValue([]);

    const { container } = renderLogger();

    expect(
      await screen.findByRole("heading", { name: "No app logs yet" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".logger-filter-rail")).not.toBeNull();
    expect(container.querySelector(".app-log-list")).not.toBeNull();
    expect(container.querySelector(".app-log-workspace-empty")).not.toBeNull();
    expect(container.querySelector(".app-log-detail-pane")).toBeNull();
  });

  it("groups repeated entries without hiding their occurrence count", async () => {
    vi.mocked(invokeDesktopCommand).mockResolvedValue([
      {
        id: "log-2",
        level: "error",
        source: "renderer.error",
        message: "ResizeObserver loop completed",
        details: "same stack",
        createdAt: "2026-07-03T10:01:00.000Z",
      },
      {
        id: "log-1",
        level: "error",
        source: "renderer.error",
        message: "ResizeObserver loop completed",
        details: "same stack",
        createdAt: "2026-07-03T10:00:00.000Z",
      },
    ]);

    renderLogger();

    const list = await screen.findByRole("list", { name: "Application logs" });
    expect(
      within(list).getAllByText("ResizeObserver loop completed"),
    ).toHaveLength(1);
    expect(screen.getByText("Repeated 2 times")).toBeInTheDocument();
  });
});
