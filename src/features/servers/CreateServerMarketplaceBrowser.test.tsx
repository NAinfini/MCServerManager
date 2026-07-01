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

function renderBrowser() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AppSettingsProvider>
        <CreateServerMarketplaceBrowser onSelect={() => {}} />
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
    vi.mocked(invokeDesktopCommand).mockImplementation(async (command) => {
      if (command === "search_modrinth_projects") {
        return [];
      }
      if (command === "search_bbsmc_projects") {
        return [
          {
            id: "bbsmc-pack-1",
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
      if (command === "get_bbsmc_project") {
        return {
          id: "bbsmc-pack-1",
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
          websiteUrl: "https://bbsmc.net/modpack/lazy-survival",
        };
      }
      if (command === "list_bbsmc_versions") {
        return [
          {
            id: "version-1",
            projectId: "bbsmc-pack-1",
            name: "Lazy Survival 1.21.8",
            versionNumber: "1.0.0",
            loaders: ["fabric"],
            gameVersions: ["1.21.8"],
            files: [],
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

  it("shows a BBSMC mod count after project details load", async () => {
    renderBrowser();

    await selectProvider(/bbsmc/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /lazy survival/i }),
    );

    expect(await screen.findAllByText(/2/)).not.toHaveLength(0);
  });

  it("uses distinct semantic badge colors for marketplace metadata", async () => {
    renderBrowser();

    await selectProvider(/bbsmc/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /lazy survival/i }),
    );

    expect(await screen.findByText("6.9K downloads")).toHaveClass(
      "meta-badge-downloads",
    );
    expect(screen.getByText("2 mods")).toHaveClass("meta-badge-mods");
    expect(screen.getByText("47 follows")).toHaveClass("meta-badge-follows");
    expect(screen.getByText("1.21.8")).toHaveClass("meta-badge-version");
    expect(screen.queryByText(/6WawJDbL/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open on bbsmc/i }),
    ).toHaveAttribute("href", "https://bbsmc.net/modpack/lazy-survival");
  });

  it("shows minecraft versions on installable version rows", async () => {
    renderBrowser();

    await selectProvider(/bbsmc/i);
    await userEvent.click(
      await screen.findByRole("button", { name: /lazy survival/i }),
    );

    expect(
      await screen.findByRole("button", { name: /minecraft 1\.21\.8/i }),
    ).toHaveTextContent("Minecraft 1.21.8");
  });

  it("uses a two-column detail layout with provider link beside the pack name", async () => {
    renderBrowser();

    await selectProvider(/bbsmc/i);
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
      screen.getByRole("link", { name: /open on bbsmc/i }),
    );
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

    await selectProvider(/bbsmc/i);
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
        return [];
      }
      if (command === "search_bbsmc_projects") {
        return [
          {
            id: "bbsmc-pack-1",
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
      if (command === "get_bbsmc_project") {
        return {
          id: "bbsmc-pack-1",
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
      if (command === "list_bbsmc_versions") {
        return [];
      }
      return [];
    });

    renderBrowser();

    await selectProvider(/bbsmc/i);
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
});

