import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerProcessStatus, stopServer } from "../process/api";
import { BatchActions } from "./BatchActions";
import type { ServerProfile } from "./types";

vi.mock("../process/api", () => ({
  getServerProcessStatus: vi.fn(),
  startServer: vi.fn(),
  stopServer: vi.fn(),
}));

vi.mock("../backups/backupApi", () => ({
  createWorldBackup: vi.fn(),
}));

const servers: ServerProfile[] = [
  {
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
  },
];

function renderBatchActions() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BatchActions servers={servers} />
    </QueryClientProvider>,
  );
}

describe("BatchActions", () => {
  beforeEach(() => {
    vi.mocked(getServerProcessStatus).mockReset();
    vi.mocked(stopServer).mockReset();
    vi.mocked(getServerProcessStatus).mockResolvedValue({
      id: "process-1",
      serverId: "server-1",
      command: "java -jar server.jar",
      status: "running",
    });
    vi.mocked(stopServer).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("confirms before stopping all running servers", async () => {
    const user = userEvent.setup();
    renderBatchActions();

    await user.click(await screen.findByRole("button", { name: /stop all/i }));
    expect(stopServer).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Stop all servers" }));

    await waitFor(() => {
      expect(stopServer).toHaveBeenCalledWith("server-1");
    });
  });
});
