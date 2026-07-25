import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { PerformanceHistoryView } from "./PerformanceHistoryView";
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

function renderPerformance() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PerformanceHistoryView server={server} />
    </QueryClientProvider>,
  );
}

describe("PerformanceHistoryView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows unavailable metrics explicitly", async () => {
    vi.mocked(invoke).mockResolvedValue({
      serverId: server.id,
      samples: [
        {
          id: "sample-1",
          cpuPercent: null,
          memoryMb: 512,
          diskFreeMb: null,
          uptimeSeconds: null,
          restartCount: 0,
          playerCount: 2,
          tps: null,
          unavailableReasons: {
            cpuPercent: "PROCESS_METRICS_UNAVAILABLE",
            diskFreeMb: "DISK_METRICS_UNAVAILABLE",
            uptimeSeconds: "PROCESS_NOT_RUNNING",
            tps: "TPS_PROVIDER_UNAVAILABLE",
          },
          unavailableReason: null,
          sampledAt: "2026-07-01T00:00:00Z",
        },
      ],
      events: [
        {
          level: "error",
          message: "process crashed",
          createdAt: "2026-07-01T00:01:00Z",
        },
      ],
    });

    renderPerformance();

    expect(await screen.findAllByText("Unavailable")).toHaveLength(6);
    expect(
      screen.getByText("Process metrics are unavailable."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No real TPS provider is configured."),
    ).toBeInTheDocument();
    expect(screen.getByText("process crashed")).toBeInTheDocument();
    expect(screen.getByText("Restarts")).toBeInTheDocument();
    expect(screen.getAllByText("TPS")).toHaveLength(2);
  });

  it("shows every measured runtime value without synthesizing TPS", async () => {
    vi.mocked(invoke).mockResolvedValue({
      serverId: server.id,
      samples: [
        {
          id: "sample-measured",
          cpuPercent: 12.5,
          memoryMb: 768,
          diskFreeMb: 20480,
          uptimeSeconds: 90,
          restartCount: 1,
          playerCount: 3,
          tps: null,
          unavailableReasons: { tps: "TPS_PROVIDER_UNAVAILABLE" },
          unavailableReason: null,
          sampledAt: "2026-07-01T00:00:00Z",
        },
      ],
      events: [],
    });

    renderPerformance();

    expect(await screen.findAllByText("12.5%")).toHaveLength(2);
    expect(screen.getAllByText("768 MB")).toHaveLength(2);
    expect(screen.getByText("20480 MB")).toBeInTheDocument();
    expect(screen.getByText("90 s")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(
      screen.getByText("No real TPS provider is configured."),
    ).toBeInTheDocument();
  });

  it("requests a new local sample", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_performance_history") {
        return { serverId: server.id, samples: [], events: [] };
      }
      return {};
    });

    renderPerformance();
    fireEvent.click(await screen.findByRole("button", { name: /sample/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("sample_server_metrics", {
        serverId: server.id,
      });
    });
  });

  it("offers retry without showing an empty state when history fails", async () => {
    const user = userEvent.setup();
    let historyAttempts = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_performance_history") {
        historyAttempts += 1;
        if (historyAttempts === 1) {
          throw new Error("metrics unavailable");
        }
        return { serverId: server.id, samples: [], events: [] };
      }
      return {};
    });

    renderPerformance();

    expect(
      await screen.findByRole("alert", {
        name: /could not load performance history/i,
      }),
    ).toHaveTextContent("metrics unavailable");
    expect(screen.queryByText("No metric samples")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No metric samples")).toBeInTheDocument();
    expect(historyAttempts).toBe(2);
  });
});
