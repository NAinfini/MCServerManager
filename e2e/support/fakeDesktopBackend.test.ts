import { describe, expect, it } from "vitest";
import {
  createFakeDesktopState,
  handleFakeDesktopCommand,
} from "./fakeDesktopBackend";

describe("fake desktop backend", () => {
  it("models process lifecycle mutations", async () => {
    const state = createFakeDesktopState();

    expect(
      await handleFakeDesktopCommand(state, "get_process_summary"),
    ).toMatchObject({ runningCount: 1, crashedCount: 0 });

    await handleFakeDesktopCommand(state, "stop_server", {
      serverId: "server-1",
    });
    expect(
      await handleFakeDesktopCommand(state, "get_process_summary"),
    ).toMatchObject({ runningCount: 0, crashedCount: 0 });

    await handleFakeDesktopCommand(state, "start_server", {
      serverId: "server-1",
    });
    expect(
      await handleFakeDesktopCommand(state, "get_server_process_status", {
        serverId: "server-1",
      }),
    ).toMatchObject({ status: "running", serverId: "server-1" });
  });

  it("persists file writes and backup creation", async () => {
    const state = createFakeDesktopState();

    await handleFakeDesktopCommand(state, "write_server_text_file", {
      serverId: "server-1",
      relativePath: "server.properties",
      content: "motd=Changed\n",
    });
    expect(
      await handleFakeDesktopCommand(state, "read_server_text_file", {
        serverId: "server-1",
        relativePath: "server.properties",
      }),
    ).toMatchObject({ content: "motd=Changed\n" });

    await handleFakeDesktopCommand(state, "create_world_backup", {
      input: { serverId: "server-1" },
    });
    expect(
      await handleFakeDesktopCommand(state, "list_server_backups", {
        serverId: "server-1",
      }),
    ).toHaveLength(2);
  });

  it("deep-merges preference patches and records every command", async () => {
    const state = createFakeDesktopState();

    const saved = await handleFakeDesktopCommand(
      state,
      "save_app_preferences",
      {
        input: {
          appearance: { compactMode: true },
          backupDefaults: { retentionDays: 30 },
        },
      },
    );

    expect(saved.appearance).toMatchObject({
      compactMode: true,
      motion: "off",
      fontSize: "medium",
    });
    expect(saved.backupDefaults).toMatchObject({
      compression: "zip",
      retentionDays: 30,
      frequency: "daily",
    });
    expect(state.calls.at(-1)?.command).toBe("save_app_preferences");
  });

  it("fails fast for unimplemented application commands", async () => {
    const state = createFakeDesktopState();

    await expect(
      handleFakeDesktopCommand(state, "unknown_command"),
    ).rejects.toThrow("Unhandled fake desktop command: unknown_command");
  });
});
