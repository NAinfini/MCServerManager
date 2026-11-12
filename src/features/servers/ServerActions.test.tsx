import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "../../test/render";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forceStopServer,
  getServerProcessStatus,
  restartServer,
  restartServerWithCountdown,
  startServer,
  stopServer,
} from "../process/api";
import { ServerActions } from "./ServerActions";
import { ServerRuntimeProvider } from "./ServerRuntimeContext";
import type { ManagedProcessStatus } from "../process/api";
import type { ServerProfile } from "./types";

vi.mock("../process/api", () => ({
  forceStopServer: vi.fn(),
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

function mockStatus(status: ManagedProcessStatus) {
  vi.mocked(getServerProcessStatus).mockResolvedValue({
    id: "process-1",
    serverId: "server-1",
    command: "java -jar server.jar",
    status,
    pid: status === "running" || status === "stopping" ? 123 : null,
    startedAt: "2026-07-02T00:00:00Z",
    exitCode: status === "crashed" ? 1 : null,
  });
}

/* Accessible names of the lifecycle buttons, in order, once they have settled. */
function lifecycleButtons() {
  return screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));
}

function renderActions() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServerRuntimeProvider serverId={server.id}>
        <ServerActions server={server} />
      </ServerRuntimeProvider>
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
    vi.mocked(forceStopServer).mockResolvedValue(undefined);
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

  it("enables stop for a crashed server so a pending auto-restart can be cancelled", async () => {
    vi.mocked(getServerProcessStatus).mockResolvedValue({
      id: "process-1",
      serverId: "server-1",
      command: "java -jar server.jar",
      status: "crashed",
      pid: null,
      startedAt: "2026-07-02T00:00:00Z",
      exitCode: 1,
    });

    renderActions();

    const stopButton = await screen.findByRole("button", {
      name: /stop survival/i,
    });
    await waitFor(() => expect(stopButton).toBeEnabled());
  });

  it("offers only Start for a stopped server", async () => {
    mockStatus("stopped");

    renderActions();

    const startButton = await screen.findByRole("button", {
      name: /^start survival$/i,
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    expect(lifecycleButtons()).toEqual(["Start Survival"]);
  });

  it("offers Restart and Stop but not Start while running", async () => {
    mockStatus("running");

    renderActions();

    await screen.findByRole("button", { name: /^stop survival$/i });
    expect(lifecycleButtons()).toEqual(["Restart Survival", "Stop Survival"]);
  });

  it("offers Start next to a Stop that cancels the auto-restart when crashed", async () => {
    mockStatus("crashed");

    renderActions();

    await screen.findByRole("button", { name: /^stop survival$/i });
    expect(lifecycleButtons()).toEqual(["Start Survival", "Stop Survival"]);
  });

  it("offers only Force stop while stopping, and asks before it kills", async () => {
    mockStatus("stopping");

    renderActions();

    const forceStop = await screen.findByRole("button", {
      name: /^force stop survival$/i,
    });
    expect(lifecycleButtons()).toEqual(["Force stop Survival"]);

    await userEvent.click(forceStop);
    expect(forceStopServer).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog", {
      name: "Force stop the server?",
    });
    expect(dialog).toHaveTextContent(/survival may still be saving the world/i);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(forceStopServer).not.toHaveBeenCalled();

    await userEvent.click(forceStop);
    await userEvent.click(
      within(
        await screen.findByRole("alertdialog", {
          name: "Force stop the server?",
        }),
      ).getByRole("button", { name: "Force stop" }),
    );
    expect(forceStopServer).toHaveBeenCalledWith("server-1");
    expect(stopServer).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("shows a disabled Stop for a server this app did not start", async () => {
    mockStatus("externalRunning");

    renderActions();

    const stop = await screen.findByRole("button", {
      name: /^stop survival$/i,
    });
    await waitFor(() => expect(stop).toBeDisabled());
    expect(lifecycleButtons()).toEqual(["Stop Survival"]);
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
