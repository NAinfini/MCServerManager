import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { InstalledContentView } from "./InstalledContentView";
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

const content = {
  id: "content-1",
  serverId: server.id,
  contentId: "fabric-api",
  name: "Fabric API",
  version: "1.0.0",
  loader: "fabric",
  environment: "server",
  sourcePath: "C:/downloads/fabric-api.jar",
  installedPath: "C:/servers/survival/mods/fabric-api.jar",
  sha256: "hash",
  warnings: [],
  installedAt: "2026-07-01T00:00:00Z",
};

function renderContent() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <InstalledContentView server={server} />
    </QueryClientProvider>,
  );
}

describe("InstalledContentView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_installed_content") {
        return [content];
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("confirms before disabling installed content", async () => {
    const user = userEvent.setup();
    renderContent();

    await user.click(await screen.findByRole("button", { name: "Disable" }));
    expect(invoke).not.toHaveBeenCalledWith("disable_installed_content", {
      input: { serverId: server.id, contentId: content.id },
    });

    await user.click(screen.getByRole("button", { name: "Disable content" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("disable_installed_content", {
        input: { serverId: server.id, contentId: content.id },
      });
    });
  });

  it("confirms before uninstalling installed content", async () => {
    const user = userEvent.setup();
    renderContent();

    await user.click(await screen.findByRole("button", { name: "Uninstall" }));
    expect(invoke).not.toHaveBeenCalledWith("uninstall_installed_content", {
      input: { serverId: server.id, contentId: content.id },
    });

    await user.click(screen.getByRole("button", { name: "Uninstall content" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("uninstall_installed_content", {
        input: { serverId: server.id, contentId: content.id },
      });
    });
  });

  it("checks content updates and lets users update one item or all items manually", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_installed_content") {
        return [content];
      }
      if (command === "check_content_updates") {
        return {
          serverId: server.id,
          checkedAt: "2026-07-03T00:00:00Z",
          updates: [
            {
              installedContentId: content.id,
              provider: "modrinth",
              name: "Fabric API",
              currentVersion: "1.0.0",
              latestVersion: "2.0.0",
              warnings: [],
            },
          ],
          warnings: [],
        };
      }
      if (command === "install_content_update") {
        return { content: { ...content, version: "2.0.0" } };
      }
      if (command === "install_all_content_updates") {
        return { serverId: server.id, installed: [], warnings: [] };
      }
      return {};
    });
    renderContent();

    await user.click(await screen.findByRole("button", { name: "Check updates" }));

    expect(await screen.findByText("2.0.0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Update Fabric API" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("install_content_update", {
        input: {
          serverId: server.id,
          installedContentId: content.id,
        },
      });
    });

    await user.click(screen.getByRole("button", { name: "Update all" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("install_all_content_updates", {
        input: { serverId: server.id },
      });
    });
  });
});
