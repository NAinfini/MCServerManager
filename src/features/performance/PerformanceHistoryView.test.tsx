import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { PerformanceHistoryView } from "./PerformanceHistoryView";
import type { ServerProfile } from "../servers/types";

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
          unavailableReason: "unavailable: cpu, disk",
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

    expect(await screen.findAllByText("Unavailable")).toHaveLength(3);
    expect(screen.getByText("unavailable: cpu, disk")).toBeInTheDocument();
    expect(screen.getByText("process crashed")).toBeInTheDocument();
    expect(screen.getByText("Restarts")).toBeInTheDocument();
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
});

