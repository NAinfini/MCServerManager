import { cleanup, render, screen } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getServerProcessStatus,
  restartServer,
  restartServerWithCountdown,
  startServer,
  stopServer,
} from "../process/api";
import { ServerActions } from "./ServerActions";
import type { ServerProfile } from "./types";

vi.mock("../process/api", () => ({
  getServerProcessStatus: vi.fn(),
  restartServer: vi.fn(),
  restartServerWithCountdown: vi.fn(),
  startServer: vi.fn(),
  stopServer: vi.fn(),
}));

const server: ServerProfile = {
  id: "server-1",
  name: "Survival",
  rootDir: "C:/servers/survival",
  loaderType: "paper",
  autoStart: false,
  createdAt: "2026-07-02T00:00:00Z",
  updatedAt: "2026-07-02T00:00:00Z",
  restartPolicy: {
    enabled: true,
    maxAttempts: 3,
    cooldownSeconds: 30,
  },
};

function renderActions() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServerActions server={server} />
    </QueryClientProvider>,
  );
}

describe("ServerActions", () => {
  beforeEach(() => {
    vi.mocked(getServerProcessStatus).mockResolvedValue({
      id: "process-1",
      serverId: "server-1",
      command: "java -jar server.jar",
      status: "running",
      pid: 123,
      startedAt: "2026-07-02T00:00:00Z",
      exitCode: null,
    });
    vi.mocked(startServer).mockResolvedValue({
      id: "process-1",
      serverId: "server-1",
      command: "java -jar server.jar",
      status: "running",
    });
    vi.mocked(stopServer).mockResolvedValue(undefined);
    vi.mocked(restartServer).mockResolvedValue({
      id: "process-1",
      serverId: "server-1",
      command: "java -jar server.jar",
      status: "running",
    });
    vi.mocked(restartServerWithCountdown).mockResolvedValue({
      serverId: "server-1",
      stepsSeconds: [300, 60, 10],
      scheduledFor: "2026-07-02T00:05:00Z",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("confirms before stopping a running server", async () => {
    renderActions();

    await userEvent.click(
      await screen.findByRole("button", { name: /stop survival/i }),
    );

    expect(stopServer).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stopServer).toHaveBeenCalledWith("server-1");
  });

  it("confirms before restarting a server", async () => {
    renderActions();

    await userEvent.click(
      await screen.findByRole("button", { name: /restart survival/i }),
    );

    expect(restartServerWithCountdown).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(restartServerWithCountdown).toHaveBeenCalledWith("server-1");
    expect(restartServer).not.toHaveBeenCalled();
  });

  it("explains the next step when start fails because server.jar is missing", async () => {
    vi.mocked(getServerProcessStatus).mockResolvedValue({
      id: "process-1",
      serverId: "server-1",
      command: "java -jar server.jar",
      status: "stopped",
      pid: null,
      startedAt: null,
      exitCode: null,
    });
    vi.mocked(startServer).mockRejectedValue(
      new Error(
        "server.jar does not exist: C:/servers/survival/server.jar. Install a server jar from Settings > Server updates before starting this profile.",
      ),
    );

    renderActions();

    await userEvent.click(
      await screen.findByRole("button", { name: /^start survival$/i }),
    );

    expect(
      await screen.findByText("Install a server jar before starting"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Open Settings, then Server updates/i),
    ).toBeInTheDocument();
  });
});
