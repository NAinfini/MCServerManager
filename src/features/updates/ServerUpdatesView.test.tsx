import { cleanup, fireEvent, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { ServerUpdatesView } from "./ServerUpdatesView";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

const server = {
  id: "server-1",
  name: "Test server",
  rootDir: "C:/servers/test",
  minecraftVersion: "1.21.1",
  loaderType: "paper" as const,
  loaderVersion: "123",
  javaPath: null,
  serverPort: 25565,
  minMemoryMb: 1024,
  maxMemoryMb: 4096,
  autoStart: false,
  restartPolicy: { enabled: false, maxAttempts: 0, cooldownSeconds: 0 },
  createdAt: "2026-07-24T00:00:00Z",
  updatedAt: "2026-07-24T00:00:00Z",
};

describe("ServerUpdatesView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "check_server_update") {
        return {
          serverId: server.id,
          loaderType: server.loaderType,
          currentVersion: server.minecraftVersion,
          targetVersion: server.minecraftVersion,
          updateAvailable: false,
          installSupported: true,
          message: "server is current",
        };
      }
      if (command === "list_server_update_history") return [];
      if (command === "create_world_backup") return { id: "backup-1" };
      if (command === "install_server_update") return { id: "update-1" };
      return {};
    });
  });

  afterEach(cleanup);

  it("checks automatically, requires a backup acknowledgement, then backs up before installing", async () => {
    const user = userEvent.setup();
    render(<ServerUpdatesView server={server} />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("check_server_update", {
        input: { serverId: server.id },
      });
    });
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByPlaceholderText("C:/path/to/server.jar"), {
      target: { value: "C:/downloads/server.jar" },
    });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const installButton = screen.getByRole("button", {
      name: "Back up and install",
    });
    expect(installButton).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(installButton);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_world_backup", {
        input: { serverId: server.id },
      });
      expect(invoke).toHaveBeenCalledWith("install_server_update", {
        input: expect.objectContaining({
          serverId: server.id,
          serverJarPath: "C:/downloads/server.jar",
          confirm: true,
        }),
      });
    });
    const backupCall =
      vi.mocked(invoke).mock.invocationCallOrder[
        vi
          .mocked(invoke)
          .mock.calls.findIndex(
            ([command]) => command === "create_world_backup",
          )
      ];
    const installCall =
      vi.mocked(invoke).mock.invocationCallOrder[
        vi
          .mocked(invoke)
          .mock.calls.findIndex(
            ([command]) => command === "install_server_update",
          )
      ];
    expect(backupCall).toBeLessThan(installCall);
  });

  it("does not install the jar when the mandatory backup fails", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "check_server_update") {
        return {
          serverId: server.id,
          loaderType: server.loaderType,
          currentVersion: server.minecraftVersion,
          targetVersion: server.minecraftVersion,
          updateAvailable: false,
          installSupported: true,
          message: "server is current",
        };
      }
      if (command === "list_server_update_history") return [];
      if (command === "create_world_backup") throw new Error("Backup failed");
      return {};
    });
    render(<ServerUpdatesView server={server} />);

    await user.click(await screen.findByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByPlaceholderText("C:/path/to/server.jar"), {
      target: { value: "C:/downloads/server.jar" },
    });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Back up and install" }),
    );

    expect(
      await screen.findByText(/The previous server runtime was left unchanged/),
    ).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith(
      "install_server_update",
      expect.anything(),
    );
  });

  it("uses discovered versions, enforces warnings, and installs without a local jar", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "check_server_update") {
        return {
          serverId: server.id,
          loaderType: server.loaderType,
          currentVersion: server.minecraftVersion,
          targetVersion: "1.21.5",
          targetLoaderVersion: "456",
          updateAvailable: true,
          installSupported: true,
          message: "update available",
          checks: [
            { id: "java", status: "ready", message: "Java is compatible." },
            {
              id: "content",
              status: "warning",
              message: "Review installed plugins.",
            },
          ],
        };
      }
      if (command === "list_server_update_history") return [];
      if (command === "create_world_backup") return { id: "backup-1" };
      if (command === "install_server_update") return { id: "update-1" };
      return {};
    });
    render(<ServerUpdatesView server={server} />);

    expect(
      await screen.findByText("Review installed plugins."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Target Minecraft version")).toHaveValue(
      "1.21.5",
    );
    expect(screen.getByLabelText("Target loader build/version")).toHaveValue(
      "456",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const confirmations = screen.getAllByRole("checkbox");
    await user.click(confirmations[0]);
    await user.click(confirmations[1]);
    await user.click(
      screen.getByRole("button", { name: "Back up and install" }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("install_server_update", {
        input: expect.objectContaining({
          serverId: server.id,
          targetMinecraftVersion: "1.21.5",
          targetLoaderVersion: "456",
          serverJarPath: undefined,
          acknowledgeWarnings: true,
          confirm: true,
        }),
      });
    });
  });

  it("confirms and runs a rollback from update history", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "check_server_update") {
        return {
          serverId: server.id,
          loaderType: server.loaderType,
          currentVersion: "1.21.1",
          targetVersion: "1.21.1",
          targetLoaderVersion: "123",
          updateAvailable: false,
          installSupported: true,
          message: "current",
          checks: [],
        };
      }
      if (command === "list_server_update_history") {
        return [
          {
            id: "history-1",
            serverId: server.id,
            loaderType: "paper",
            fromVersion: "1.21.1",
            toVersion: "1.21.5",
            status: "installed",
            message: "installed",
            rollbackPath: "C:/servers/test/backups/server-jars/old.jar",
            rollbackAvailable: true,
            createdAt: "2026-09-07T00:00:00Z",
          },
        ];
      }
      if (command === "rollback_server_update") return { id: "rollback-1" };
      return {};
    });
    render(<ServerUpdatesView server={server} />);

    await user.click(await screen.findByRole("button", { name: "Roll back" }));
    expect(invoke).not.toHaveBeenCalledWith(
      "rollback_server_update",
      expect.anything(),
    );
    await user.click(screen.getByRole("button", { name: "Roll back update" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("rollback_server_update", {
        input: { serverId: server.id, historyId: "history-1", confirm: true },
      });
    });
  });
});
