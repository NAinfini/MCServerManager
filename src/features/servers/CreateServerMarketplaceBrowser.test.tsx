import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSettingsProvider } from "../../i18n";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import { cleanup, render, screen } from "../../test/render";
import { CreateServerMarketplaceBrowser } from "./CreateServerMarketplaceBrowser";

vi.mock("../../lib/desktop-runtime", () => ({ invokeDesktopCommand: vi.fn() }));

function renderBrowser(onSelect = vi.fn()) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AppSettingsProvider>
        <CreateServerMarketplaceBrowser onSelect={onSelect} />
      </AppSettingsProvider>
    </QueryClientProvider>,
  );
}

describe("CreateServerMarketplaceBrowser", () => {
  beforeEach(() => {
    vi.mocked(invokeDesktopCommand).mockImplementation(async (command) => {
      if (command === "search_modrinth_projects")
        return [
          {
            id: "pack-1",
            slug: "pack-1",
            title: "Server Pack",
            description: "A server pack",
            projectType: "modpack",
            loaders: ["fabric"],
            gameVersions: ["1.21.4"],
            downloads: 12,
          },
        ];
      if (command === "get_modrinth_project")
        return {
          id: "pack-1",
          slug: "pack-1",
          title: "Server Pack",
          description: "A server pack",
          projectType: "modpack",
          loaders: ["fabric"],
          gameVersions: ["1.21.4"],
        };
      if (command === "list_modrinth_versions")
        return [
          {
            id: "version-1",
            projectId: "pack-1",
            name: "Dedicated pack",
            versionNumber: "1.0.0",
            loaders: ["fabric"],
            gameVersions: ["1.21.4"],
            files: [],
            dependencies: [],
            warnings: [],
            isServerPack: true,
            serverCompatibility: "serverPack",
          },
        ];
      return [];
    });
  });
  afterEach(cleanup);

  it("uses the shared browser to discover and select a verified server pack", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = renderBrowser(onSelect);
    await user.click(
      await screen.findByRole("button", { name: /server pack/i }),
    );
    expect(container.querySelector(".marketplace-layout")).toHaveClass(
      "marketplace-layout-detail-mode",
    );
    expect(container.querySelector(".marketplace-detail-pane")).toBeTruthy();
    await user.click(
      await screen.findByRole("button", { name: /dedicated pack/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /use selected version/i }),
    );
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "Modrinth",
        projectId: "pack-1",
        versionId: "version-1",
        loaderType: "fabric",
        minecraftVersion: "1.21.4",
      }),
    );
  });

  it("uses an unfiltered discovery query when switching to BBSMC", async () => {
    const user = userEvent.setup();
    renderBrowser();

    await user.click(screen.getByRole("combobox", { name: /^source$/i }));
    await user.click(await screen.findByRole("option", { name: "BBSMC" }));

    await vi.waitFor(() =>
      expect(invokeDesktopCommand).toHaveBeenCalledWith(
        "search_bbsmc_projects",
        expect.objectContaining({
          input: expect.objectContaining({ query: "" }),
        }),
      ),
    );
  });

  it("fetches the BBSMC project so its description has a body to render", async () => {
    vi.mocked(invokeDesktopCommand).mockImplementation(async (command) => {
      // BBSMC's search endpoint, like Modrinth's, omits the body. Opening a
      // pack without asking for the project left the panel blank.
      if (command === "search_bbsmc_projects")
        return [
          {
            id: "XMUypeti",
            slug: "the-fool",
            title: "The Fool",
            description: "Trickery and disguise.",
            projectType: "modpack",
            loaders: ["forge"],
            gameVersions: ["1.20.1"],
            downloads: 1_520_000,
          },
        ];
      if (command === "get_bbsmc_project")
        return {
          id: "XMUypeti",
          slug: "the-fool",
          title: "The Fool",
          description: "Trickery and disguise.",
          projectType: "modpack",
          loaders: ["forge"],
          gameVersions: ["1.20.1"],
          body: "Core loop: shapeshifting, trading and relics.",
        };
      return [];
    });
    const user = userEvent.setup();
    renderBrowser();

    await user.click(screen.getByRole("combobox", { name: /^source$/i }));
    await user.click(await screen.findByRole("option", { name: "BBSMC" }));
    await user.click(await screen.findByRole("button", { name: /the fool/i }));

    expect(invokeDesktopCommand).toHaveBeenCalledWith("get_bbsmc_project", {
      input: { projectId: "XMUypeti" },
    });
    expect(
      await screen.findByText(/shapeshifting, trading and relics/i),
    ).toBeInTheDocument();
  });

  it("keeps an explicit confirmation for unverified archives", async () => {
    vi.mocked(invokeDesktopCommand).mockImplementation(async (command) => {
      if (command === "search_modrinth_projects")
        return [
          {
            id: "pack-1",
            slug: "pack-1",
            title: "Server Pack",
            description: "A server pack",
            projectType: "modpack",
            loaders: ["fabric"],
            gameVersions: ["1.21.4"],
          },
        ];
      if (command === "get_modrinth_project")
        return {
          id: "pack-1",
          slug: "pack-1",
          title: "Server Pack",
          description: "A server pack",
          projectType: "modpack",
          loaders: ["fabric"],
          gameVersions: ["1.21.4"],
        };
      if (command === "list_modrinth_versions")
        return [
          {
            id: "version-1",
            projectId: "pack-1",
            name: "Client archive",
            versionNumber: "1.0.0",
            loaders: ["fabric"],
            gameVersions: ["1.21.4"],
            files: [],
            dependencies: [],
            warnings: [],
            serverCompatibility: "unverified",
          },
        ];
      return [];
    });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderBrowser(onSelect);
    await user.click(
      await screen.findByRole("button", { name: /server pack/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /client archive/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /use selected version/i }),
    );
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: /use unverified archive/i }),
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
