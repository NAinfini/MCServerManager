import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerProfile } from "../../domain/server";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { cleanup, render, screen, waitFor, within } from "../../test/render";
import { ContentUpdatesView } from "./ContentUpdatesView";

vi.mock("../../lib/desktop-runtime", () => ({ invokeDesktopCommand: vi.fn() }));

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
  restartPolicy: { enabled: true, maxAttempts: 3, cooldownSeconds: 30 },
};

function renderUpdates() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ContentUpdatesView server={server} />
    </QueryClientProvider>,
  );
}

describe("ContentUpdatesView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "check_content_updates") {
        return {
          serverId: server.id,
          checkedAt: "2026-09-07T00:00:00Z",
          warnings: [],
          updates: [
            {
              installedContentId: "content-1",
              provider: "modrinth",
              projectId: "sodium",
              versionId: "version-2",
              name: "Sodium",
              currentVersion: "1.0.0",
              latestVersion: "2.0.0",
              warnings: [],
            },
          ],
        };
      }
      if (command === "list_content_update_history") {
        return [
          {
            id: "history-1",
            serverId: server.id,
            installedContentId: "content-1",
            name: "Sodium",
            fromVersion: "0.9.0",
            toVersion: "1.0.0",
            status: "installed",
            backupPath: "mods/.updates/sodium.jar",
            createdAt: "2026-09-06T00:00:00Z",
            rollbackAvailable: true,
          },
        ];
      }
      if (command === "get_content_update_policy") {
        return {
          id: "policy",
          serverId: server.id,
          contentId: null,
          policy: "manual_only",
          pinnedVersion: null,
          ignoredUpdate: null,
          updatedAt: "2026-09-07T00:00:00Z",
        };
      }
      if (command === "list_installed_content") return [];
      if (command === "install_all_content_updates") {
        return { serverId: server.id, installed: [], warnings: [] };
      }
      if (command === "rollback_content_update") {
        return {
          content: {
            id: "content-1",
            serverId: server.id,
            name: "Sodium",
            version: "0.9.0",
            loader: "paper",
            sourcePath: "modrinth",
            installedPath: "mods/sodium.jar",
            sha256: "hash",
            warnings: [],
            installedAt: "2026-09-07T00:00:00Z",
          },
          backupPath: null,
        };
      }
      return {};
    });
  });

  afterEach(cleanup);

  it("updates selected items and exposes a confirmed history rollback", async () => {
    const user = userEvent.setup();
    renderUpdates();

    await user.click(
      await screen.findByRole("checkbox", { name: "Select Sodium" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Update selected (1)" }),
    );
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Update selected (1)",
      }),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("install_all_content_updates", {
        input: {
          serverId: server.id,
          installedContentIds: ["content-1"],
        },
      }),
    );

    await user.click(await screen.findByRole("button", { name: "Roll back" }));
    await user.click(screen.getByRole("button", { name: "Roll back update" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("rollback_content_update", {
        input: { serverId: server.id, historyId: "history-1", confirm: true },
      }),
    );
  });
});
