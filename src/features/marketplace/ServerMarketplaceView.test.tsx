import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../../test/render";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import type { ServerProfile } from "../../domain/server";
import { ServerMarketplaceView } from "./ServerMarketplaceView";

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

function renderMarketplace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServerMarketplaceView server={server} />
    </QueryClientProvider>,
  );
}

describe("ServerMarketplaceView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("offers retry without showing no results when search fails", async () => {
    const user = userEvent.setup();
    let searchAttempts = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_installed_content") return [];
      if (command === "search_modrinth_projects") {
        searchAttempts += 1;
        if (searchAttempts === 1) throw new Error("marketplace unavailable");
        return [];
      }
      return [];
    });

    renderMarketplace();

    await user.type(screen.getByRole("textbox"), "sodium");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByRole("alert", {
        name: /could not search marketplace/i,
      }),
    ).toHaveTextContent("marketplace unavailable");
    expect(screen.queryByText("No search results")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No search results")).toBeInTheDocument();
    expect(searchAttempts).toBe(2);
  });

  it("applies the target server filters and paginates provider results", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "list_installed_content") return [];
      if (command === "search_modrinth_projects") {
        const offset = (args as { input: { offset: number } }).input.offset;
        return Array.from({ length: 20 }, (_, index) => ({
          id: `project-${offset + index}`,
          slug: `project-${offset + index}`,
          title: `Project ${offset + index}`,
          description: "Compatible content",
          projectType: "mod",
          loaders: ["paper"],
          gameVersions: [server.minecraftVersion],
        }));
      }
      return [];
    });

    renderMarketplace();
    await user.type(screen.getByRole("textbox"), "server tools");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Project 0")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith(
      "search_modrinth_projects",
      expect.objectContaining({
        input: expect.objectContaining({
          loader: "paper",
          minecraftVersion: "1.21.4",
          offset: 0,
          limit: 20,
        }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Project 20")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith(
      "search_modrinth_projects",
      expect.objectContaining({
        input: expect.objectContaining({ offset: 20 }),
      }),
    );
  });

  it("does not treat an unidentified local file as the same remote project by name", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_installed_content") {
        return [
          {
            id: "local-file",
            serverId: server.id,
            name: "Sodium",
            version: "1.0.0",
            loader: "paper",
            sourcePath: "C:/downloads/sodium.jar",
            installedPath: "mods/sodium.jar",
            sha256: "local-hash",
            warnings: [],
            installedAt: "2026-09-07T00:00:00Z",
          },
        ];
      }
      if (command === "search_modrinth_projects") {
        return [
          {
            id: "AANobbMI",
            slug: "sodium",
            title: "Sodium",
            description: "Rendering optimization",
            projectType: "mod",
            loaders: ["fabric"],
            gameVersions: ["1.21.4"],
          },
        ];
      }
      return [];
    });

    renderMarketplace();
    await user.type(screen.getByRole("textbox"), "Sodium");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Sodium")).toBeInTheDocument();
    expect(screen.queryByText("Installed")).not.toBeInTheDocument();
  });

  it("installs a Hangar plugin through its real detail and version flow", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_installed_content") return [];
      if (command === "search_hangar_projects") {
        return [
          {
            id: "ViaVersion/ViaVersion",
            slug: "viaversion",
            title: "ViaVersion",
            description: "Protocol support",
            projectType: "plugin",
            loaders: ["paper"],
            gameVersions: ["1.21.4"],
          },
        ];
      }
      if (command === "get_hangar_project") {
        return {
          id: "ViaVersion/ViaVersion",
          slug: "viaversion",
          title: "ViaVersion",
          description: "Protocol support",
          projectType: "plugin",
          loaders: ["paper"],
          gameVersions: ["1.21.4"],
          body: "Keep clients compatible.",
        };
      }
      if (command === "list_hangar_versions") {
        return [
          {
            id: "5.2.0",
            projectId: "ViaVersion/ViaVersion",
            name: "5.2.0",
            versionNumber: "5.2.0",
            loaders: ["paper"],
            gameVersions: ["1.21.4"],
            files: [],
            dependencies: [],
            warnings: [],
          },
        ];
      }
      if (command === "install_hangar_version") {
        return {
          id: "content-1",
          serverId: server.id,
          contentId: "hangar:ViaVersion/ViaVersion:5.2.0",
          projectId: "ViaVersion/ViaVersion",
          versionId: "5.2.0",
          provider: "hangar",
          name: "ViaVersion",
          version: "5.2.0",
          loader: "paper",
          sourcePath: "hangar",
          installedPath: "plugins/ViaVersion.jar",
          sha256: "hash",
          warnings: [],
          installedAt: "2026-09-07T00:00:00Z",
        };
      }
      return [];
    });

    renderMarketplace();
    await user.click(screen.getByRole("button", { name: "Plugins" }));
    await user.click(screen.getByRole("combobox", { name: "Source" }));
    await user.click(await screen.findByRole("option", { name: "Hangar" }));
    await user.type(screen.getByRole("textbox"), "ViaVersion");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(
      await screen.findByRole("button", { name: /ViaVersion/i }),
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /^5\.2\.0/ }));
    await user.click(
      screen.getByRole("button", { name: "Install selected version" }),
    );
    await user.click(screen.getByRole("button", { name: /^Install$/ }));

    expect(
      await screen.findByText("Restart the server to load the installed file."),
    ).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("install_hangar_version", {
      input: {
        serverId: server.id,
        projectId: "ViaVersion/ViaVersion",
        versionName: "5.2.0",
        installAnyway: false,
      },
    });
  });
});
