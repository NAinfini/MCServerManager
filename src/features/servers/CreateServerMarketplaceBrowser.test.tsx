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
    renderBrowser(onSelect);
    await user.click(
      await screen.findByRole("button", { name: /server pack/i }),
    );
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
