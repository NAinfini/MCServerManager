import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSettingsProvider } from "../../i18n";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import { CreateServerMarketplaceBrowser } from "./CreateServerMarketplaceBrowser";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

function renderBrowser(onSelect = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AppSettingsProvider>
        <CreateServerMarketplaceBrowser onSelect={onSelect} />
      </AppSettingsProvider>
    </QueryClientProvider>,
  );
}

async function selectProvider(name: RegExp) {
  await userEvent.click(screen.getByRole("combobox", { name: /providers/i }));
  await userEvent.click(await screen.findByRole("option", { name }));
}

describe("CreateServerMarketplaceBrowser", () => {
  beforeEach(() => {
    vi.mocked(invokeDesktopCommand).mockImplementation(async (command, args) => {
      if (command === "search_modrinth_projects") {
        return [
          {
            id: "modrinth-pack-1",
            slug: "lazy-survival",
            title: "Lazy Survival",
            description: "Automation-focused pack",
            projectType: "modpack",
            loaders: ["fabric"],
            gameVersions: ["1.21.8"],
            downloads: 6900,
          },
        ];
      }
      if (command === "get_modrinth_project") {
        return {
          id: "modrinth-pack-1",
          slug: "lazy-survival",
          title: "Lazy Survival",
          description: "Automation-focused pack",
          body: '<p>Full <strong>HTML</strong> description.</p><script>alert("x")</script><p><a href="javascript:alert(1)">unsafe</a> <a href="https://example.com/pack">safe link</a></p>',
          projectType: "modpack",
          loaders: ["fabric"],
          gameVersions: ["6WawJDbL", "ufr7N45P"],
          downloads: 6900,
          follows: 47,
          modCount: 2,
          gallery: [
            "https://cdn.example.com/screenshot-1.png",
            "https://cdn.example.com/screenshot-2.png",
          ],
          websiteUrl: "https://modrinth.com/modpack/lazy-survival",
        };
      }
      if (command === "list_modrinth_versions") {
        return [
          {
            id: "version-1",
            projectId: "modrinth-pack-1",
            name: "Lazy Survival 1.21.8",
            versionNumber: "1.0.0",
            loaders: ["fabric"],
            gameVersions: ["1.21.8"],
            files: [],
            dependencies: [],
            warnings: [],
            isServerPack: true,
            serverCompatibility: "serverPack",
          },
        ];
      }
      if (command === "search_bbsmc_projects") {
        return [
          {
            id: "bbsmc-pack-1",
            slug: "public-pack",
            title: "Public Pack",
            description: "Public BBSMC server pack",
            projectType: "modpack",
            loaders: ["quilt"],
            gameVersions: ["1.21.4"],
            downloads: 1200,
          },
          {
            id: "bbsmc-pack-2",
            slug: "disk-pack",
            title: "Disk Pack",
            description: "External disk only pack",
            projectType: "modpack",
            loaders: ["fabric"],
            gameVersions: ["1.20.1"],
            downloads: 500,
          },
        ];
      }
      if (command === "get_bbsmc_project") {
        const projectId = (args as { input?: { projectId?: string } })?.input
          ?.projectId;
        return projectId === "bbsmc-pack-2"
          ? {
              id: "bbsmc-pack-2",
              slug: "disk-pack",
              title: "Disk Pack",
              description: "External disk only pack",
              projectType: "modpack",
              loaders: ["fabric"],
              gameVersions: ["1.20.1"],
              websiteUrl: "https://bbsmc.net/modpack/disk-pack",
            }
          : {
              id: "bbsmc-pack-1",
              slug: "public-pack",
              title: "Public Pack",
              description: "Public BBSMC server pack",
              projectType: "modpack",
              loaders: ["quilt"],
              gameVersions: ["1.21.4"],
              websiteUrl: "https://bbsmc.net/modpack/public-pack",
            };
      }
      if (command === "list_bbsmc_versions") {
        const projectId = (args as { input?: { projectId?: string } })?.input
          ?.projectId;
        return projectId === "bbsmc-pack-2"
          ? [
              {
                id: "bbsmc-version-2",
                projectId: "bbsmc-pack-2",
                name: "Disk Pack 1.0.0",
                versionNumber: "1.0.0",
                loaders: ["fabric"],
                gameVersions: ["1.20.1"],
                files: [],
                dependencies: [],
                diskUrls: [
                  { platform: "baidu", url: "https://pan.baidu.com/s/1" },
                ],
                diskOnly: true,
                warnings: [],
              },
            ]
          : [
              {
                id: "bbsmc-version-1",
                projectId: "bbsmc-pack-1",
                name: "Public Pack 1.0.0",
                versionNumber: "1.0.0",
                loaders: ["quilt"],
                gameVersions: ["1.21.4"],
                files: [
                  {
                    filename: "public-pack.mrpack",
                    size: 2048,
                    primary: true,
                    url: "https://cdn.bbsmc.net/files/public-pack.mrpack",
                  },
                ],
                dependencies: [],
                warnings: [],
              },
            ];
      }
      return [];
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a Modrinth mod count after project details load", async () => {
    renderBrowser();

    await selectProvider(/modrinth/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /lazy survival/i }),
    );

    expect(await screen.findAllByText(/2/)).not.toHaveLength(0);
  });

  it("uses distinct semantic badge colors for marketplace metadata", async () => {
    renderBrowser();

    await selectProvider(/modrinth/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /lazy survival/i }),
    );

    const statistics = await screen.findByRole("group", {
      name: /project statistics/i,
    });
    expect(statistics.querySelector(".meta-badge-downloads")).toHaveTextContent(
      "6.9K",
    );
    expect(statistics.querySelector(".meta-badge-mods")).toHaveTextContent("2");
    expect(statistics.querySelector(".meta-badge-follows")).toHaveTextContent(
      "47",
    );
    expect(statistics.querySelector(".meta-badge-version")).toHaveTextContent(
      "1.21.8",
    );
    expect(screen.queryByText(/6WawJDbL/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open on modrinth/i }),
    ).toHaveAttribute("href", "https://modrinth.com/modpack/lazy-survival");
  });

  it("shows minecraft versions on installable version rows", async () => {
    renderBrowser();

    await selectProvider(/modrinth/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /lazy survival/i }),
    );

    expect(
      await screen.findByRole("button", { name: /minecraft 1\.21\.8/i }),
    ).toHaveTextContent("Minecraft 1.21.8");
  });

  it("uses a two-column detail layout with provider link beside the pack name", async () => {
    renderBrowser();

    await selectProvider(/modrinth/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /lazy survival/i }),
    );

    const details = await screen.findByRole("article", {
      name: /lazy survival/i,
    });
    const layout = details.querySelector(".marketplace-pack-detail-grid");
    const titleRow = details.querySelector(".marketplace-pack-detail-title");

    expect(layout?.children.item(0)).toHaveClass(
      "marketplace-pack-detail-main",
    );
    expect(layout?.children.item(1)).toHaveClass(
      "marketplace-pack-version-sidebar",
    );
    expect(titleRow).toContainElement(
      screen.getByRole("link", { name: /open on modrinth/i }),
    );
  });

  it("renders discovery results as wide single-column cards with a clear action", async () => {
    renderBrowser();

    const result = await screen.findByRole("button", { name: /lazy survival/i });
    const grid = result.closest(".marketplace-results-list");

    expect(grid).toHaveClass("marketplace-card-grid");
    expect(result).toHaveClass("marketplace-pack-card");
    expect(result.querySelector(".marketplace-pack-card-action")).not.toBeNull();
  });

  it("renders an editorial project header with separately labelled statistics", async () => {
    renderBrowser();

    await selectProvider(/modrinth/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /lazy survival/i }),
    );

    const details = await screen.findByRole("article", {
      name: /lazy survival/i,
    });
    const hero = details.querySelector("header.marketplace-project-hero");
    const statistics = screen.getByRole("group", {
      name: /project statistics/i,
    });

    expect(hero).toContainElement(
      screen.getByRole("heading", { name: "Lazy Survival", level: 2 }),
    );
    expect(hero).toContainElement(
      screen.getByRole("img", { name: "Lazy Survival" }),
    );
    expect(hero).toHaveTextContent("Modrinth");
    expect(statistics.querySelectorAll("dt")).toHaveLength(4);
    expect(statistics).toHaveTextContent("Downloads");
    expect(statistics).toHaveTextContent("6.9K");
    expect(statistics).toHaveTextContent("Follows");
    expect(statistics).toHaveTextContent("47");
    expect(statistics).toHaveTextContent("Mods");
    expect(statistics).toHaveTextContent("2");
    expect(statistics).toHaveTextContent("Minecraft");
    expect(statistics).toHaveTextContent("1.21.8");
  });

  it("groups screenshots and project copy into editorial sections", async () => {
    renderBrowser();

    await selectProvider(/modrinth/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /lazy survival/i }),
    );

    const details = await screen.findByRole("article", {
      name: /lazy survival/i,
    });
    const screenshots = screen.getByRole("region", { name: /screenshots/i });
    const about = screen.getByRole("region", {
      name: /about this project/i,
    });

    expect(details).toContainElement(screenshots);
    expect(details).toContainElement(about);
    expect(
      screen.getAllByRole("img", { name: /lazy survival project screenshot/i }),
    ).toHaveLength(2);
    expect(about).toHaveTextContent("Full HTML description.");
  });

  it("keeps installable versions in a dedicated version rail", async () => {
    renderBrowser();

    await selectProvider(/modrinth/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /lazy survival/i }),
    );

    const versionRail = await screen.findByRole("complementary", {
      name: /versions/i,
    });
    const versionButton = screen.getByRole("button", { name: /1\.0\.0/i });

    expect(versionRail).toHaveClass("marketplace-version-rail");
    expect(versionRail).toContainElement(
      screen.getByRole("heading", { name: "Versions", level: 3 }),
    );
    expect(versionRail).toHaveTextContent("1");
    expect(versionButton).toHaveClass("marketplace-install-version");
  });

  it("does not invent unavailable project statistics", async () => {
    renderBrowser();

    await selectProvider(/bbsmc/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /public pack/i }),
    );

    const statistics = await screen.findByRole("group", {
      name: /project statistics/i,
    });

    expect(statistics.querySelectorAll("dt")).toHaveLength(1);
    expect(statistics).toHaveTextContent("Minecraft");
    expect(statistics).toHaveTextContent("1.21.4");
    expect(statistics).not.toHaveTextContent("Downloads");
    expect(statistics).not.toHaveTextContent("Follows");
    expect(statistics).not.toHaveTextContent("Mods");
    expect(statistics).not.toHaveTextContent("—");
  });

  it("shows provider choices as a dropdown to the right of the search box", async () => {
    renderBrowser();

    const searchForm = screen.getByRole("search", {
      name: /marketplace filters/i,
    });
    const controls = Array.from(searchForm.children);

    expect(controls[0]).toContainElement(
      screen.getByRole("textbox", { name: /search server packs/i }),
    );
    expect(controls[1]).toContainElement(
      screen.getByRole("combobox", { name: /providers/i }),
    );
    expect(screen.queryByRole("tab", { name: /modrinth/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Server packs")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Choose a complete modpack to install while creating this server.",
      ),
    ).not.toBeInTheDocument();
  });

  it("opens a selected pack as a full-width detail view with sanitized rich text", async () => {
    renderBrowser();

    await selectProvider(/modrinth/i);
    expect(
      screen.getByRole("search", { name: /marketplace filters/i }),
    ).toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole("button", { name: /lazy survival/i }),
    );

    const details = await screen.findByRole("article", {
      name: /lazy survival/i,
    });

    expect(
      screen.queryByRole("search", { name: /marketplace filters/i }),
    ).not.toBeInTheDocument();
    expect(details).toHaveTextContent("Full HTML description.");
    expect(details).not.toHaveTextContent("<p>");
    expect(details).not.toHaveTextContent("alert");
    expect(details.querySelector("strong")).toHaveTextContent("HTML");
    expect(
      details.querySelector('a[href="https://example.com/pack"]'),
    ).toHaveTextContent("safe link");
    expect(details.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("renders project body markdown with preserved line breaks", async () => {
    vi.mocked(invokeDesktopCommand).mockImplementation(async (command) => {
      if (command === "search_modrinth_projects") {
        return [
          {
            id: "modrinth-pack-1",
            slug: "lazy-survival",
            title: "Lazy Survival",
            description: "Automation-focused pack",
            projectType: "modpack",
            loaders: ["fabric"],
            gameVersions: ["1.21.8"],
            downloads: 6900,
          },
        ];
      }
      if (command === "get_modrinth_project") {
        return {
          id: "modrinth-pack-1",
          slug: "lazy-survival",
          title: "Lazy Survival",
          description: "Automation-focused pack",
          body: [
            "# Setup notes",
            "First line",
            "Second line",
            "",
            "- Install Fabric",
            "- Start the server",
            "",
            "[Project page](https://example.com/pack)",
          ].join("\n"),
          projectType: "modpack",
          loaders: ["fabric"],
          gameVersions: ["1.21.8"],
          downloads: 6900,
          follows: 47,
          modCount: 2,
        };
      }
      if (command === "list_modrinth_versions") {
        return [];
      }
      return [];
    });

    renderBrowser();

    await selectProvider(/modrinth/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /lazy survival/i }),
    );

    const details = await screen.findByRole("article", {
      name: /lazy survival/i,
    });
    const body = details.querySelector(".marketplace-markdown");

    expect(body?.querySelector("h1")).toHaveTextContent("Setup notes");
    expect(body?.querySelector("br")).toBeInTheDocument();
    expect(body?.querySelectorAll("li")).toHaveLength(2);
    expect(
      body?.querySelector('a[href="https://example.com/pack"]'),
    ).toHaveTextContent("Project page");
    expect(details).not.toHaveTextContent("# Setup notes");
  });

  it("offers Modrinth and BBSMC discovery without CurseForge credentials", async () => {
    renderBrowser();

    await userEvent.click(screen.getByRole("combobox", { name: /providers/i }));

    expect(screen.getByRole("option", { name: /modrinth/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /bbsmc/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /curseforge/i })).not.toBeInTheDocument();
  });

  it("routes BBSMC search, details, and versions through BBSMC commands", async () => {
    renderBrowser();

    await selectProvider(/bbsmc/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /public pack/i }),
    );

    expect(invokeDesktopCommand).toHaveBeenCalledWith(
      "search_bbsmc_projects",
      expect.objectContaining({
        input: expect.objectContaining({ query: "", projectType: "modpack" }),
      }),
    );
    expect(invokeDesktopCommand).toHaveBeenCalledWith(
      "get_bbsmc_project",
      { input: { projectId: "bbsmc-pack-1" } },
    );
    expect(invokeDesktopCommand).toHaveBeenCalledWith(
      "list_bbsmc_versions",
      { input: { projectId: "bbsmc-pack-1" } },
    );
  });

  it("requires acknowledgement before selecting a public BBSMC file", async () => {
    const onSelect = vi.fn();
    renderBrowser(onSelect);

    await selectProvider(/bbsmc/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /public pack/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /public pack 1\.0\.0/i }),
    );

    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: /use unverified archive/i }),
    );
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "BBSMC",
        versionId: "bbsmc-version-1",
      }),
    );
  });

  it("disables BBSMC versions that only expose external disk links", async () => {
    renderBrowser();

    await selectProvider(/bbsmc/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /disk pack/i }),
    );

    expect(
      await screen.findByRole("button", {
        name: /external download required/i,
      }),
    ).toBeDisabled();
  });

  it("labels and sorts dedicated server packs before unverified archives", async () => {
    vi.mocked(invokeDesktopCommand).mockImplementation(async (command) => {
      if (command === "search_modrinth_projects") {
        return [
          {
            id: "pack-1",
            slug: "pack-1",
            title: "Pack One",
            description: "Test pack",
            projectType: "modpack",
            loaders: ["quilt"],
            gameVersions: ["1.21.4"],
          },
        ];
      }
      if (command === "get_modrinth_project") {
        return {
          id: "pack-1",
          slug: "pack-1",
          title: "Pack One",
          description: "Test pack",
          projectType: "modpack",
          loaders: ["quilt"],
          gameVersions: ["1.21.4"],
        };
      }
      if (command === "list_modrinth_versions") {
        return [
          {
            id: "client-version",
            projectId: "pack-1",
            name: "Client archive",
            versionNumber: "2.0.0",
            loaders: ["quilt"],
            gameVersions: ["1.21.4"],
            files: [{ filename: "client.zip", size: 10, primary: true }],
            dependencies: [],
            warnings: [],
            isServerPack: false,
            serverCompatibility: "unverified",
          },
          {
            id: "server-version",
            projectId: "pack-1",
            name: "Dedicated server pack",
            versionNumber: "1.0.0",
            loaders: ["quilt"],
            gameVersions: ["1.21.4"],
            files: [{ filename: "server.mrpack", size: 10, primary: true }],
            dependencies: [],
            warnings: [],
            isServerPack: true,
            serverCompatibility: "serverPack",
          },
        ];
      }
      return [];
    });

    renderBrowser();
    await userEvent.click(screen.getByRole("combobox", { name: /loader/i }));
    expect(screen.getByRole("option", { name: /quilt/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /any loader/i }));
    await userEvent.click(await screen.findByRole("button", { name: /pack one/i }));

    const versionButtons = await screen.findAllByRole("button", {
      name: /archive|dedicated server pack/i,
    });
    expect(versionButtons[0]).toHaveTextContent("Dedicated server pack");
    expect(versionButtons[0]).toHaveTextContent("Server pack");
    expect(versionButtons[1]).toHaveTextContent("Unverified archive");
  });

  it("requires explicit acknowledgement before selecting an unverified archive", async () => {
    const onSelect = vi.fn();
    vi.mocked(invokeDesktopCommand).mockImplementation(async (command) => {
      if (command === "search_modrinth_projects") {
        return [
          {
            id: "pack-2",
            slug: "pack-2",
            title: "Unverified Pack",
            description: "No dedicated archive",
            projectType: "modpack",
            loaders: ["fabric"],
            gameVersions: ["1.20.1"],
          },
        ];
      }
      if (command === "get_modrinth_project") {
        return {
          id: "pack-2",
          slug: "pack-2",
          title: "Unverified Pack",
          description: "No dedicated archive",
          projectType: "modpack",
          loaders: ["fabric"],
          gameVersions: ["1.20.1"],
        };
      }
      if (command === "list_modrinth_versions") {
        return [
          {
            id: "client-only",
            projectId: "pack-2",
            name: "Client only",
            versionNumber: "1.0.0",
            loaders: ["fabric"],
            gameVersions: ["1.20.1"],
            files: [{ filename: "client.zip", size: 10, primary: true }],
            dependencies: [],
            warnings: [],
            isServerPack: false,
            serverCompatibility: "unverified",
          },
        ];
      }
      return [];
    });

    renderBrowser(onSelect);
    await userEvent.click(
      await screen.findByRole("button", { name: /unverified pack/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /client only/i }),
    );

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /unverified server archive/i })).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /use unverified archive/i }),
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

