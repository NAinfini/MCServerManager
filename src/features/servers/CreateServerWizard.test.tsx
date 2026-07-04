import { cleanup, render, screen } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSettingsProvider } from "../../i18n";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import {
  createServerProfile,
  getDefaultServerRoot,
  listLoaderMinecraftVersions,
  listLoaderVersions,
} from "./api";
import { CreateServerWizard } from "./CreateServerWizard";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

vi.mock("./api", () => ({
  createServerProfile: vi.fn(),
  getDefaultServerRoot: vi.fn(),
  listLoaderMinecraftVersions: vi.fn(),
  listLoaderVersions: vi.fn(),
}));

function renderWizard(
  props: Partial<React.ComponentProps<typeof CreateServerWizard>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AppSettingsProvider>
        <CreateServerWizard showHeading={false} {...props} />
      </AppSettingsProvider>
    </QueryClientProvider>,
  );
}

describe("CreateServerWizard", () => {
  beforeEach(() => {
    vi.mocked(invokeDesktopCommand).mockReset();
    vi.mocked(createServerProfile).mockReset();
    vi.mocked(getDefaultServerRoot).mockReset();
    vi.mocked(listLoaderMinecraftVersions).mockReset();
    vi.mocked(listLoaderVersions).mockReset();
    vi.mocked(getDefaultServerRoot).mockImplementation(async (name) => {
      const safeName = (name || "server").replace(":", "-");
      return `C:/Users/Test/AppData/Roaming/MC Server Manager/servers/${safeName}`;
    });
    vi.mocked(listLoaderMinecraftVersions).mockResolvedValue([
      { value: "1.21.10", label: "1.21.10", stable: true },
    ]);
    vi.mocked(listLoaderVersions).mockResolvedValue([
      { value: "130", label: "Build 130", stable: true },
    ]);
    vi.mocked(createServerProfile).mockResolvedValue({
      id: "server-1",
      name: "Performance Pack",
      rootDir: "C:/Servers/Performance",
      loaderType: "paper",
      autoStart: false,
      createdAt: "2026-07-02T00:00:00Z",
      updatedAt: "2026-07-02T00:00:00Z",
      restartPolicy: {
        enabled: true,
        maxAttempts: 3,
        cooldownSeconds: 30,
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens a file picker when the drop zone is clicked", async () => {
    vi.mocked(invokeDesktopCommand).mockResolvedValueOnce({
      path: "C:/Packs/automation.mrpack",
    });
    renderWizard();

    await userEvent.click(
      screen.getAllByRole("button", { name: /open modpack file/i })[0],
    );

    expect(invokeDesktopCommand).toHaveBeenCalledWith("show_open_dialog", {
      kind: "file",
      filters: [
        {
          name: "Modpack or server jar",
          extensions: ["zip", "mrpack", "jar"],
        },
      ],
    });
    expect(
      await screen.findByText("C:/Packs/automation.mrpack"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Local modpack file")).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Source" }),
    ).not.toBeInTheDocument();
  });

  it("opens a folder picker and pre-fills the server folder", async () => {
    vi.mocked(invokeDesktopCommand).mockResolvedValueOnce({
      path: "C:/Servers/Existing",
    });
    renderWizard();

    await userEvent.click(
      screen.getByRole("button", { name: /import existing folder/i }),
    );

    expect(invokeDesktopCommand).toHaveBeenCalledWith("show_open_dialog", {
      kind: "folder",
    });
    expect(
      await screen.findByDisplayValue("C:/Servers/Existing"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Import existing folder")).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Source" }),
    ).not.toBeInTheDocument();
  });

  it("opens the blank path and browses marketplace packs", async () => {
    renderWizard();

    await userEvent.click(
      screen.getByRole("button", { name: /new blank server/i }),
    );
    expect(screen.queryByText("Blank server")).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Source" }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    vi.mocked(invokeDesktopCommand).mockImplementation(async (command) => {
      if (command === "search_modrinth_projects") {
        return [
          {
            id: "project-1",
            slug: "performance-pack",
            title: "Performance Pack",
            description: "Server performance mods",
            projectType: "modpack",
            loaders: ["fabric"],
            gameVersions: ["1.21.4"],
          },
        ];
      }
      if (command === "list_modrinth_versions") {
        return [
          {
            id: "version-1",
            projectId: "project-1",
            name: "Performance Pack 1.0",
            versionNumber: "1.0.0",
            loaders: ["fabric"],
            gameVersions: ["1.21.4"],
            files: [],
            dependencies: [],
            warnings: [],
          },
        ];
      }
      if (command === "install_modrinth_version") {
        return { id: "content-1" };
      }
      if (command === "show_open_dialog") {
        return { path: "C:/Servers/Performance" };
      }
      return null;
    });
    await userEvent.click(
      screen.getByRole("button", { name: /browse marketplace/i }),
    );
    expect(
      await screen.findByRole("combobox", { name: /providers/i }),
    ).toHaveTextContent("Modrinth");
    expect(
      screen.queryByRole("combobox", { name: /hangar/i }),
    ).not.toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("Search server packs"),
      "performance",
    );
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /performance pack/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /1\.0\.0/i }),
    );

    // After marketplace selection, we land on step 1 (Configure)
    expect(screen.queryByText("Marketplace modpack")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Provider" })).toBeNull();
    expect(screen.getByDisplayValue("Performance Pack")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Loader" })).toHaveTextContent(
      "Fabric",
    );
    expect(
      screen.getByRole("combobox", { name: "Minecraft version" }),
    ).toHaveTextContent("1.21.4");
    expect(
      screen.getByRole("combobox", { name: "Minecraft version" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Loader version" }),
    ).toHaveTextContent("1.0.0");
    expect(
      screen.getByRole("combobox", { name: "Loader version" }),
    ).toBeDisabled();

    // Fill the only remaining required step 1 field.
    await userEvent.click(screen.getByRole("button", { name: /browse/i }));

    // Navigate to step 2 (Java & Memory)
    await userEvent.click(
      screen.getByRole("button", { name: /next/i }),
    );

    // Navigate to step 3 (Review)
    await userEvent.click(
      screen.getByRole("button", { name: /next/i }),
    );

    // Submit on step 3
    await userEvent.click(
      screen.getByRole("button", { name: /create server/i }),
    );

    expect(createServerProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        source: {
          kind: "marketplaceModpack",
          provider: "Modrinth",
          projectId: "project-1",
          versionId: "version-1",
        },
        loaderType: "fabric",
        minecraftVersion: "1.21.4",
        loaderVersion: "1.0.0",
      }),
    );
    expect(invokeDesktopCommand).toHaveBeenCalledWith(
      "search_modrinth_projects",
      {
        input: {
          serverId: "create-server",
          query: "performance",
          projectType: "modpack",
          loader: "any",
          sort: "relevance",
        },
      },
    );
    expect(invokeDesktopCommand).toHaveBeenCalledWith(
      "install_modrinth_version",
      {
        input: {
          serverId: "server-1",
          projectId: "project-1",
          versionId: "version-1",
          installAnyway: false,
        },
      },
    );
  });

  it("pre-fills a managed server folder for new blank servers", async () => {
    renderWizard();

    await userEvent.click(
      screen.getByRole("button", { name: /new blank server/i }),
    );
    await userEvent.type(screen.getByLabelText("Name"), "My First Server");

    expect(
      await screen.findByDisplayValue(
        "C:/Users/Test/AppData/Roaming/MC Server Manager/servers/My First Server",
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Minecraft version" }));
    await userEvent.click(await screen.findByRole("option", { name: "1.21.10" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Loader version" }));
    await userEvent.click(await screen.findByRole("option", { name: "Build 130" }));

    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await userEvent.click(screen.getByRole("button", { name: /create server/i }));

    expect(createServerProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My First Server",
        rootDir:
          "C:/Users/Test/AppData/Roaming/MC Server Manager/servers/My First Server",
      }),
    );
  });

  it("explains the remaining setup steps before a new user creates the server", async () => {
    renderWizard();

    await userEvent.click(
      screen.getByRole("button", { name: /new blank server/i }),
    );
    await userEvent.type(screen.getByLabelText("Name"), "First Server");
    await userEvent.click(screen.getByRole("combobox", { name: "Minecraft version" }));
    await userEvent.click(await screen.findByRole("option", { name: "1.21.10" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Loader version" }));
    await userEvent.click(await screen.findByRole("option", { name: "Build 130" }));

    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText("Before first start")).toBeInTheDocument();
    expect(
      screen.getByText(/Install Java that matches this Minecraft version/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Install or import a server.jar in Server updates/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Review and accept the Minecraft EULA/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Create a backup before changing files/i),
    ).toBeInTheDocument();
  });

  it("keeps the outer create-server header visible while viewing marketplace details", async () => {
    const onHeaderHiddenChange = vi.fn();
    vi.mocked(invokeDesktopCommand).mockImplementation(async (command) => {
      if (command === "search_modrinth_projects") {
        return [
          {
            id: "project-1",
            slug: "performance-pack",
            title: "Performance Pack",
            description: "Server performance mods",
            projectType: "modpack",
            loaders: ["fabric"],
            gameVersions: ["1.21.4"],
          },
        ];
      }
      if (command === "get_modrinth_project") {
        return {
          id: "project-1",
          slug: "performance-pack",
          title: "Performance Pack",
          description: "Server performance mods",
          body: "<p>Details</p>",
          projectType: "modpack",
          loaders: ["fabric"],
          gameVersions: ["1.21.4"],
        };
      }
      if (command === "list_modrinth_versions") {
        return [];
      }
      return null;
    });

    renderWizard({ onHeaderHiddenChange });

    await userEvent.click(
      screen.getByRole("button", { name: /browse marketplace/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /performance pack/i }),
    );

    expect(onHeaderHiddenChange).toHaveBeenLastCalledWith(false);

    await userEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(onHeaderHiddenChange).toHaveBeenLastCalledWith(false);
  });

  it("shows picker errors instead of silently ignoring failures", async () => {
    vi.mocked(invokeDesktopCommand).mockRejectedValueOnce(
      new Error("Native file picker failed"),
    );
    renderWizard();

    await userEvent.click(
      screen.getAllByRole("button", { name: /open modpack file/i })[0],
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Native file picker failed",
    );
  });
});
