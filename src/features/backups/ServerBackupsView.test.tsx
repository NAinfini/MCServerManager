import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { ServerBackupsView } from "./ServerBackupsView";
import { ServerRuntimeProvider } from "../servers/ServerRuntimeContext";
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

const settings = {
  serverId: server.id,
  configured: true,
  enabled: true,
  intervalMinutes: 360,
  beforeRestart: true,
  beforeUpdate: true,
  keepRecent: 8,
  keepDaily: 5,
  keepWeekly: 2,
  maxTotalMb: null,
  location: null,
  nextRunAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  lastSuccessAt: null,
};

const status = {
  serverId: server.id,
  settings,
  restorePointCount: 1,
  lastBackupAt: backup.createdAt,
  lastSuccessAt: backup.createdAt,
  nextRunAt: settings.nextRunAt,
  usedBytes: 4096,
  freeBytes: 50 * 1024 ** 3,
  location: "C:/servers/survival/backups",
};

function renderBackups(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ServerRuntimeProvider serverId={server.id}>
        <ServerBackupsView server={server} />
      </ServerRuntimeProvider>
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
      if (command === "get_backup_status") {
        return status;
      }
      if (command === "preview_backup_restore") {
        return {
          backupId: backup.id,
          serverId: server.id,
          mode: "worldOnly",
          relativePaths: ["world/level.dat"],
          fileCount: 1,
          sizeBytes: backup.sizeBytes,
          warnings: [],
        };
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("answers whether you are safe: last backup, next run and space used", async () => {
    renderBackups();

    const strip = await screen.findByTestId("backups-status");
    // The fixture backup is from 2026-07-01, long past the expected interval.
    await waitFor(() =>
      expect(strip).toHaveTextContent(/longer ago than expected/),
    );
    expect(strip).toHaveAttribute("data-tone", "warning");
    expect(strip).toHaveTextContent(/Next automatic backup/);
    expect(strip).toHaveTextContent(/4\.0 KB/);
    expect(strip).toHaveTextContent(/50\.0 GB free/);
    expect(
      within(strip).getByRole("button", { name: "Backup Now" }),
    ).toBeEnabled();
  });

  it("shows a fresh backup as covered", async () => {
    const fresh = { ...backup, createdAt: new Date().toISOString() };
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_backups") return [fresh];
      if (command === "get_backup_status")
        return { ...status, lastSuccessAt: fresh.createdAt };
      return [];
    });
    renderBackups();

    const strip = await screen.findByTestId("backups-status");
    await waitFor(() => expect(strip).toHaveAttribute("data-tone", "ok"));
    expect(strip).toHaveTextContent(/Last backup/);
  });

  it("says so plainly when there is no backup to go back to", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_backups") return [];
      if (command === "get_backup_status")
        return {
          ...status,
          restorePointCount: 0,
          lastBackupAt: null,
          lastSuccessAt: null,
        };
      return [];
    });
    renderBackups();

    expect(await screen.findByTestId("backups-status")).toHaveTextContent(
      "No backup yet, so there is nothing to go back to",
    );
  });

  it("lists restore points with what triggered them and how much each added", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_backups")
        return [
          {
            ...backup,
            id: "auto-1",
            archivePath: "C:/servers/survival/backups/auto-1",
            trigger: "pre_restart",
            format: "incremental",
            logicalBytes: 8 * 1024 ** 2,
            newBytes: 2 * 1024 ** 2,
          },
          { ...backup, id: "old-1" },
        ];
      if (command === "get_backup_status") return status;
      return [];
    });
    renderBackups();

    const rows = await screen.findAllByTestId("backup-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Before restart");
    expect(rows[0]).toHaveTextContent("8.0 MB");
    expect(rows[0]).toHaveTextContent("+2.0 MB new");
    // A row from before incremental snapshots (here a zip-shaped one) still
    // lists, with the same actions.
    expect(rows[1]).toHaveTextContent("Full copy");
    expect(rows[1]).toHaveTextContent("world.zip");
    expect(
      within(rows[1]).getByRole("button", { name: "Restore backup" }),
    ).toBeEnabled();
    expect(
      within(rows[1]).getByRole("button", { name: "Export backup" }),
    ).toBeEnabled();
  });

  it("exports a restore point as a zip into the chosen folder", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_backups") return [backup];
      if (command === "get_backup_status") return status;
      if (command === "show_open_dialog")
        return { canceled: false, paths: ["D:/exports"] };
      if (command === "export_server_backup")
        return { exportedPath: "D:/exports/world.zip" };
      return [];
    });
    renderBackups();

    await user.click(
      await screen.findByRole("button", { name: "Export backup" }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("export_server_backup", {
        input: { backupId: backup.id, targetDir: "D:/exports", format: "zip" },
      });
    });
    expect(
      await screen.findByText("Exported to D:/exports/world.zip"),
    ).toBeInTheDocument();
  });

  it("keeps schedule, retention and location behind one collapsed settings section", async () => {
    const user = userEvent.setup();
    renderBackups();

    const section = await screen.findByTestId("backups-settings");
    const toggle = within(section).getByRole("button", {
      name: /Backup settings/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await waitFor(() =>
      expect(section).toHaveTextContent(
        "Every 6 h · keeps 8 recent, 5 daily, 2 weekly",
      ),
    );

    await user.click(within(section).getByText("Backup settings"));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_backup_settings", {
        input: {
          serverId: server.id,
          enabled: true,
          intervalMinutes: 360,
          beforeRestart: true,
          beforeUpdate: true,
          keepRecent: 8,
          keepDaily: 5,
          keepWeekly: 2,
          maxTotalMb: null,
          location: null,
        },
      });
    });
    expect(await screen.findByText("Settings saved")).toBeInTheDocument();
  });

  it("lets the user pick a backup location on another disk", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_backups") return [backup];
      if (command === "get_backup_status") return status;
      if (command === "show_open_dialog")
        return { canceled: false, paths: ["E:/mc-backups"] };
      if (command === "save_backup_settings")
        return { ...settings, location: "E:/mc-backups" };
      return [];
    });
    renderBackups();

    const section = await screen.findByTestId("backups-settings");
    await user.click(within(section).getByText("Backup settings"));
    await user.click(
      await screen.findByRole("button", { name: "Choose folder" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Backup location" }),
    ).toHaveValue("E:/mc-backups");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "save_backup_settings",
        expect.objectContaining({
          input: expect.objectContaining({ location: "E:/mc-backups" }),
        }),
      );
    });
  });

  it("surfaces a failed backup instead of hiding it", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_backups") return [backup];
      if (command === "get_backup_status") return status;
      if (command === "create_world_backup")
        throw new Error("There is not enough free space on the backup drive.");
      return [];
    });
    renderBackups();

    await user.click(await screen.findByRole("button", { name: "Backup Now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "not enough free space",
    );
  });

  it("confirms before deleting a backup", async () => {
    const user = userEvent.setup();
    renderBackups();

    const deleteButton = await screen.findByRole("button", {
      name: "Delete backup",
    });
    await user.click(deleteButton);
    expect(invoke).not.toHaveBeenCalledWith("delete_server_backup", {
      backupId: backup.id,
    });

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete backup",
      }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_server_backup", {
        backupId: backup.id,
      });
    });
  });

  it("confirms after restore details before restoring a backup", async () => {
    const user = userEvent.setup();
    renderBackups();

    await user.click(
      await screen.findByRole("button", { name: "Restore backup" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview restore" }));
    expect(invoke).not.toHaveBeenCalledWith("restore_world_backup", {
      input: {
        backupId: backup.id,
        targetWorldDir: "world",
        confirm: true,
      },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("preview_backup_restore", {
        input: {
          serverId: server.id,
          backupId: backup.id,
          targetWorldDir: "world",
        },
      });
    });

    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Restore backup",
      }),
    );

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

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Restore backup" }),
      ).toBeDisabled(),
    );
  });

  it("previews and restores a full backup without a world target", async () => {
    const user = userEvent.setup();
    const fullBackup = { ...backup, kind: "fullServer", worldName: "server" };
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_backups") return [fullBackup];
      if (command === "list_backup_profiles") return [];
      if (command === "preview_backup_restore") {
        return {
          backupId: backup.id,
          serverId: server.id,
          mode: "fullServer",
          relativePaths: ["server.properties", "world/level.dat"],
          fileCount: 2,
          sizeBytes: backup.sizeBytes,
          warnings: ["Existing files will be replaced."],
        };
      }
      return {};
    });

    renderBackups();
    await user.click(
      await screen.findByRole("button", { name: "Restore backup" }),
    );

    expect(screen.queryByLabelText("Target directory")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview restore" }));
    expect(await screen.findByText("Full server restore")).toBeInTheDocument();
    expect(screen.getByText("server.properties")).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Restore backup",
      }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("restore_world_backup", {
        input: { backupId: backup.id, confirm: true },
      });
    });
  });

  it("shares the live server process status cache with server actions", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });
    queryClient.setQueryData(["serverProcessStatus", server.id], {
      id: "process-1",
      serverId: server.id,
      status: "running",
    });

    renderBackups(queryClient);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Restore backup" }),
      ).toBeDisabled(),
    );
    expect(invoke).not.toHaveBeenCalledWith("get_server_process_status", {
      serverId: server.id,
    });
  });

  it("lets users retry a failed backup list", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_server_backups") {
        throw new Error("backup store unavailable");
      }
      if (command === "list_backup_profiles") {
        return [];
      }
      return {};
    });

    renderBackups();

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(([command]) => command === "list_server_backups"),
      ).toHaveLength(2);
    });
  });
});
