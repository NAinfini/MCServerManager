import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../../test/render";
import type { ServerProfile } from "./types";
import { listJavaRuntimes } from "../java/javaApi";
import { updateServerProfile } from "./api";
import { getServerSetupStatus } from "./setupApi";
import { ServerSetupChecklist } from "./ServerSetupChecklist";

vi.mock("./setupApi", () => ({
  getServerSetupStatus: vi.fn(),
}));

vi.mock("../java/javaApi", () => ({
  installJavaRuntime: vi.fn(),
  listJavaRuntimes: vi.fn(),
  planJavaRuntime: vi.fn(),
}));

vi.mock("./api", () => ({
  deleteServerProfile: vi.fn(),
  updateServerProfile: vi.fn(),
}));

const emptyScan = { runtimes: [], failures: [], compatibility: [] };

const server: ServerProfile = {
  id: "server-1",
  name: "Survival",
  rootDir: "C:/servers/survival",
  minecraftVersion: "1.21.4",
  loaderType: "paper",
  loaderVersion: "1",
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

function renderChecklist() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServerSetupChecklist server={server} />
    </QueryClientProvider>,
  );
}

describe("ServerSetupChecklist", () => {
  beforeEach(() => {
    vi.mocked(getServerSetupStatus).mockReset();
    vi.mocked(listJavaRuntimes).mockReset();
    vi.mocked(listJavaRuntimes).mockResolvedValue(emptyScan);
    vi.mocked(updateServerProfile).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("offers a direct retry when setup checks fail", async () => {
    const user = userEvent.setup();
    vi.mocked(getServerSetupStatus)
      .mockRejectedValueOnce(new Error("check unavailable"))
      .mockResolvedValueOnce({
        serverId: server.id,
        serverName: server.name,
        checks: [
          {
            id: "java",
            status: "ready",
            message: "Java is ready.",
          },
        ],
      });

    renderChecklist();

    expect(
      await screen.findByRole("alert", {
        name: /could not check setup status/i,
      }),
    ).toHaveTextContent("check unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Java")).toBeInTheDocument();
    expect(getServerSetupStatus).toHaveBeenCalledTimes(2);
  });

  // The generic "select a compatible Java runtime" is where the flow lost
  // people: it named neither the runtime nor a way to select it.
  it("names the Java problem and points the server at a fitting runtime", async () => {
    const user = userEvent.setup();
    vi.mocked(getServerSetupStatus).mockResolvedValue({
      serverId: server.id,
      serverName: server.name,
      checks: [
        {
          id: "java",
          status: "actionRequired",
          message: "Java is not configured.",
        },
      ],
    });
    vi.mocked(listJavaRuntimes).mockResolvedValue({
      runtimes: [],
      failures: [],
      compatibility: [
        {
          serverId: server.id,
          serverName: server.name,
          minecraftVersion: "1.21.4",
          configuredJavaPath: null,
          requiredMajorVersion: 21,
          maxMajorVersion: null,
          recommendedJavaPath: "C:/java21/bin/java.exe",
          status: "warning",
          message: "",
        },
      ],
    });
    vi.mocked(updateServerProfile).mockResolvedValue({
      ...server,
      javaPath: "C:/java21/bin/java.exe",
    });

    renderChecklist();

    expect(
      await screen.findByText(
        "No Java is set for this server. It needs Java 21.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use Java 21" }));

    expect(updateServerProfile).toHaveBeenCalledWith({
      id: server.id,
      javaPath: "C:/java21/bin/java.exe",
    });
  });
});
