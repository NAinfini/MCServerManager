import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { ServerBackupsView } from "./ServerBackupsView";
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

const backup = {
  id: "backup-1",
  serverId: server.id,
  kind: "world",
  archivePath: "C:/backups/world.zip",
  worldName: "world",
  sizeBytes: 4096,
  status: "completed" as const,
  createdAt: "2026-07-01T00:00:00Z",
  error: null,
};

function renderBackups() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ServerBackupsView server={server} />
    </QueryClientProvider>,
  );
}

describe("ServerBackupsView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_backups") {
        return [backup];
      }
      if (command === "list_backup_profiles") {
        return [];
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("confirms before deleting a backup", async () => {
    const user = userEvent.setup();
    renderBackups();

    await user.click(await screen.findByTitle("Delete backup"));
    expect(invoke).not.toHaveBeenCalledWith("delete_server_backup", {
      backupId: backup.id,
    });

    await user.click(screen.getByRole("button", { name: "Delete backup" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_server_backup", {
        backupId: backup.id,
      });
    });
  });

  it("confirms after restore details before restoring a backup", async () => {
    const user = userEvent.setup();
    renderBackups();

    await user.click(await screen.findByTitle("Restore backup"));
    fireEvent.submit(screen.getByRole("button", { name: "Restore" }).closest("form")!);
    expect(invoke).not.toHaveBeenCalledWith("restore_world_backup", {
      input: {
        backupId: backup.id,
        targetWorldDir: "world",
        confirm: true,
      },
    });

    await user.click(screen.getByRole("button", { name: "Restore backup" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("restore_world_backup", {
        input: {
          backupId: backup.id,
          targetWorldDir: "world",
          confirm: true,
        },
      });
    });
  });

  it("disables restore while the server is running", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_backups") return [backup];
      if (command === "list_backup_profiles") return [];
      if (command === "get_server_process_status") {
        return { id: "process-1", serverId: server.id, status: "running" };
      }
      return {};
    });

    renderBackups();

    expect(
      await screen.findByTitle("Stop the server before restoring a backup"),
    ).toBeDisabled();
  });
});
