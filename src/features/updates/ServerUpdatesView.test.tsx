import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../test/render";
import userEvent from "@testing-library/user-event";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerProfile } from "../servers/types";
import { ServerUpdatesView } from "./ServerUpdatesView";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

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

function renderUpdates(profile = server) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServerUpdatesView server={profile} />
    </QueryClientProvider>,
  );
}

describe("ServerUpdatesView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("checks stable updates and enables supported installs", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_update_history") {
        return [];
      }
      if (command === "check_server_update") {
        return {
          serverId: server.id,
          loaderType: "paper",
          currentVersion: "1.21.4",
          currentLoaderVersion: "1",
          latestVersion: "1.21.5",
          latestLoaderVersion: "125",
          updateAvailable: true,
          installSupported: true,
          message: "stable Paper update is available for 1.21.5",
        };
      }
      return {
        id: "history-1",
        serverId: server.id,
        loaderType: "paper",
        fromVersion: "1.21.4",
        toVersion: "1.21.5",
        status: "installed",
        message: "installed Paper 1.21.5 build 125",
        rollbackPath: "C:/rollbacks/server.jar",
        createdAt: "2026-07-01T00:00:00Z",
      };
    });

    renderUpdates();
    await userEvent.type(
      await screen.findByLabelText(/target minecraft version/i),
      "1.21.5",
    );
    await userEvent.type(screen.getByLabelText(/target loader build/i), "125");
    await userEvent.type(
      screen.getByLabelText(/downloaded server jar/i),
      "C:/downloads/paper.jar",
    );
    await userEvent.type(screen.getByLabelText(/sha-256/i), "abc123");
    fireEvent.click(await screen.findByRole("button", { name: /check/i }));

    expect(await screen.findByText("Update available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /install server jar/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("install_server_update", {
        input: {
          serverId: server.id,
          targetVersion: "1.21.5",
          targetLoaderVersion: "125",
          serverJarPath: "C:/downloads/paper.jar",
          serverJarSha256: "abc123",
          confirm: true,
        },
      });
    });
  });

  it("installs a local server jar without requiring an available update", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_update_history") {
        return [];
      }
      return {
        id: "history-1",
        serverId: server.id,
        loaderType: "paper",
        fromVersion: "1.21.4",
        toVersion: "1.21.4",
        status: "installed",
        message: "installed paper server jar for 1.21.4",
        rollbackPath: null,
        createdAt: "2026-07-01T00:00:00Z",
      };
    });

    renderUpdates();
    await userEvent.type(
      await screen.findByLabelText(/downloaded server jar/i),
      "C:/downloads/server.jar",
    );
    fireEvent.click(screen.getByRole("button", { name: /install server jar/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("install_server_update", {
        input: {
          serverId: server.id,
          targetVersion: "1.21.4",
          targetLoaderVersion: "1",
          serverJarPath: "C:/downloads/server.jar",
          serverJarSha256: null,
          confirm: true,
        },
      });
    });
  });

  it("shows mod loader updates as manual only", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_update_history") {
        return [
          {
            id: "history-1",
            serverId: server.id,
            loaderType: "fabric",
            fromVersion: "1.21.4",
            toVersion: "1.21.5",
            status: "unsupported",
            message: "automatic replacement is unsafe for mod loaders",
            rollbackPath: null,
            createdAt: "2026-07-01T00:00:00Z",
          },
        ];
      }
      return {
        serverId: server.id,
        loaderType: "fabric",
        currentVersion: "1.21.4",
        currentLoaderVersion: "1",
        latestVersion: "1.21.5",
        latestLoaderVersion: "0.16.14",
        updateAvailable: true,
        installSupported: false,
        message:
          "stable Fabric update is available for 1.21.5; automatic replacement is unsafe for mod loaders",
      };
    });

    renderUpdates({ ...server, loaderType: "fabric" });
    await userEvent.type(
      await screen.findByLabelText(/target minecraft version/i),
      "1.21.5",
    );
    fireEvent.click(await screen.findByRole("button", { name: /check/i }));

    expect(await screen.findByText("Manual only")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /install server jar/i }),
    ).toBeDisabled();
    expect(
      screen.getByText("automatic replacement is unsafe for mod loaders"),
    ).toBeInTheDocument();
  });
});

