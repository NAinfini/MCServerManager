import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { ServerOverviewSummary } from "./ServerOverviewSummary";
import type { ServerProfile } from "../../domain/server";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

const server: ServerProfile = {
  id: "server-1",
  name: "Survival",
  rootDir: "C:/servers/survival",
  minecraftVersion: "1.21.4",
  loaderType: "paper",
  loaderVersion: null,
  javaPath: null,
  serverPort: 25565,
  minMemoryMb: 1024,
  maxMemoryMb: 4096,
  autoStart: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  restartPolicy: {
    enabled: true,
    maxAttempts: 3,
    cooldownSeconds: 30,
  },
};

describe("ServerOverviewSummary", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "list_process_events") {
        return [];
      }
      if (command === "list_server_logs") {
        return { serverId: server.id, logs: [] };
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("routes the recent activity shortcut through the single top-level tab bar", async () => {
    const onNavigate = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ServerOverviewSummary
          server={server}
          onViewAllActivity={() => onNavigate("logs")}
        />
      </QueryClientProvider>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /view all/i }),
    );

    expect(onNavigate).toHaveBeenCalledWith("logs");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("shows a retry action instead of no events when recent activity fails", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "list_process_events") {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("activity unavailable");
        }
        return [];
      }
      return null;
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ServerOverviewSummary server={server} onViewAllActivity={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("alert", {
        name: /could not load recent activity/i,
      }),
    ).toHaveTextContent("activity unavailable");
    expect(screen.queryByText("No recent events")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No recent events")).toBeInTheDocument();
    expect(attempts).toBe(2);
  });
});
