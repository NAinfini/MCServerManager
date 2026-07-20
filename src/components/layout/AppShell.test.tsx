import { cleanup, fireEvent, render, screen, within } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSettingsProvider } from "../../i18n";
import { AppShell } from "./AppShell";

const appShellTestState = vi.hoisted(() => ({
  recoverableProvisioningJobs: [] as unknown[],
}));

vi.mock("../../lib/desktop-runtime", () => ({
  isDesktopRuntimeAvailable: vi.fn(() => true),
  openExternalUrl: vi.fn(async () => undefined),
  invokeDesktopCommand: vi.fn(async (command: string) => {
    if (command === "list_server_profiles") {
      return [
        {
          id: "server-1",
          name: "Survival SMP",
          rootDir: "C:/servers/survival",
          minecraftVersion: "1.20.4",
          loaderType: "paper",
          loaderVersion: null,
          javaPath: "C:/java/bin/java.exe",
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
        },
      ];
    }
    if (command === "get_server_process_status") {
      return {
        id: "process-1",
        serverId: "server-1",
        command: "java -jar paper.jar",
        status: "running",
        pid: 18432,
      };
    }
    if (command === "get_process_summary") {
      return {
        runningCount: 1,
        crashedCount: 0,
      };
    }
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
        projectType: "modpack",
        loaders: ["fabric"],
        gameVersions: ["1.21.8"],
        downloads: 6900,
      };
    }
    if (command === "list_modrinth_versions") {
      return [];
    }
    if (command === "list_java_runtimes") {
      return {
        runtimes: [],
        failures: [],
        compatibility: [],
      };
    }
    if (command === "check_app_update") {
      return {
        currentVersion: "0.1.0",
        channel: "stable",
        checkedAt: "2026-07-01T00:00:00Z",
        updateAvailable: false,
        installerEnabled: false,
        installBlockedByRunningServers: false,
        message: "Update checks are configured.",
      };
    }
    if (command === "get_app_preferences") {
      return {
        closeBehavior: "minimize",
        defaultServerDir: "C:/MCServers",
        defaultBackupDir: "C:/MCServers/backups",
        cacheDir: "C:/Users/Test/AppData/Roaming/mc-server-manager/cache",
        appDataDir: "C:/Users/Test/AppData/Roaming/mc-server-manager",
        providers: {
          modrinth: true,
          hangar: true,
          bbsmc: true,
          curseforge: true,
        },
      };
    }
    if (command === "list_app_logs") {
      return [
        {
          id: "log-1",
          level: "info",
          source: "renderer.console",
          message: "Application started",
          createdAt: "2026-07-03T00:00:00Z",
        },
      ];
    }
    if (command === "list_recoverable_provisioning_jobs") {
      return appShellTestState.recoverableProvisioningJobs;
    }
    return null;
  }),
}));

function renderShell() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AppSettingsProvider>
        <AppShell />
      </AppSettingsProvider>
    </QueryClientProvider>,
  );
}

describe("AppShell", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    appShellTestState.recoverableProvisioningJobs = [];
  });

  it("renders the main navigation regions", async () => {
    renderShell();

    expect(
      screen.getByRole("navigation", { name: /primary/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getAllByText("MC Server Manager").length).toBeGreaterThan(0);
    expect(await screen.findByText(/1 running/i)).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Servers" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Survival SMP").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /^marketplace$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^backups$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^settings$/i }),
    ).toBeInTheDocument();
  });

  it("renders the overview as a structured dashboard workbench", async () => {
    const { container } = renderShell();

    expect(await screen.findByRole("heading", { name: "Servers" })).toBeInTheDocument();
    expect(container.querySelector(".dashboard-page-header")).not.toBeNull();
    expect(container.querySelector(".dashboard-workbench")).not.toBeNull();
    expect(container.querySelector(".dashboard-primary")).not.toBeNull();
    expect(container.querySelector(".dashboard-status-rail")).not.toBeNull();
  });

  it("keeps Servers navigation on the global overview and opens detail from a server row", async () => {
    renderShell();

    expect(
      await screen.findByRole("heading", { name: "Servers" }),
    ).toBeInTheDocument();

    const serverButtons = await screen.findAllByRole("button", {
      name: /^survival smp$/i,
    });
    await userEvent.click(serverButtons[serverButtons.length - 1]);

    expect(
      await screen.findByRole("heading", { name: "Survival SMP" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Console" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^servers$/i }));

    expect(
      await screen.findByRole("heading", { name: "Servers" }),
    ).toBeInTheDocument();
  });

  it("opens Java runtimes in the main content area", async () => {
    renderShell();

    fireEvent.click(screen.getByRole("button", { name: /java runtimes/i }));

    const main = screen.getByRole("main");
    expect(
      await within(main).findByRole("heading", { name: "Java Runtimes" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      within(main).getByRole("button", { name: /scan/i }),
    ).toBeInTheDocument();
    expect(
      within(main).queryByRole("button", { name: /download java/i }),
    ).not.toBeInTheDocument();
    expect(
      within(main).queryByRole("link", {
        name: /eclipse temurin download/i,
      }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^servers$/i }));
    expect(
      await screen.findByRole("heading", { name: "Servers" }),
    ).toBeInTheDocument();
  });

  it("opens create server options from the Create Server button", async () => {
    renderShell();

    expect(
      screen.queryByRole("heading", { name: "Create server" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /create server/i }),
    );

    const main = screen.getByRole("main");
    expect(
      await within(main).findByRole("heading", { name: "Create server" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Create server" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: /primary/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new blank server/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /open modpack file/i }).length,
    ).toBeGreaterThan(0);
  });

  it("names both server view controls", async () => {
    renderShell();

    await screen.findByRole("heading", { name: "Servers" });

    expect(screen.getByRole("button", { name: "Card view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Table view" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders the create wizard progress inside the main content header", async () => {
    renderShell();

    await userEvent.click(
      screen.getByRole("button", { name: /create server/i }),
    );

    const main = screen.getByRole("main");
    await within(main).findByRole("heading", { name: "Create server" });
    const header = main.querySelector<HTMLElement>(
      ".create-server-wizard-header",
    );
    const progress = within(main).getByRole("navigation", {
      name: "Wizard progress",
    });

    expect(header).not.toBeNull();
    expect(header).toContainElement(progress);
    expect(
      within(header!).getByRole("heading", { name: "Create server" }),
    ).toBeInTheDocument();
    expect(
      within(header!).getByRole("button", { name: "Close create server" }),
    ).toBeInTheDocument();
    expect(
      main.querySelector(".create-server-panel .wizard-steps"),
    ).not.toBeInTheDocument();
  });

  it("hides the wizard header in marketplace details and restores it on return", async () => {
    renderShell();

    await userEvent.click(
      screen.getByRole("button", { name: /create server/i }),
    );
    const main = screen.getByRole("main");
    await within(main).findByRole("heading", { name: "Create server" });

    await userEvent.click(
      within(main).getByRole("button", { name: /browse marketplace/i }),
    );
    await userEvent.click(
      await within(main).findByRole("button", { name: /lazy survival/i }),
    );

    const details = await within(main).findByRole("article", {
      name: /lazy survival/i,
    });
    expect(
      main.querySelector(".create-server-wizard-header"),
    ).not.toBeInTheDocument();
    expect(
      within(main).queryByRole("navigation", { name: "Wizard progress" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(details).getByRole("button", { name: "Back" }),
    );

    expect(
      main.querySelector(".create-server-wizard-header"),
    ).toBeInTheDocument();
    expect(
      within(main).getByRole("navigation", { name: "Wizard progress" }),
    ).toBeInTheDocument();
  });

  it("keeps the inline create page active when dismissing a dropdown", async () => {
    renderShell();

    await userEvent.click(
      screen.getByRole("button", { name: /create server/i }),
    );
    const main = screen.getByRole("main");
    await within(main).findByRole("heading", { name: "Create server" });

    await userEvent.click(
      within(main).getByRole("button", { name: /browse marketplace/i }),
    );
    const providerSelect = await within(main).findByRole("combobox", {
      name: /providers/i,
    });

    await userEvent.click(providerSelect);
    expect(
      screen.getByRole("option", { name: "Modrinth" }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(
      within(main).getByRole("heading", { name: "Create server" }),
    ).toBeInTheDocument();
  });

  it("confirms before abandoning a server creation draft", async () => {
    renderShell();

    await userEvent.click(
      screen.getByRole("button", { name: /create server/i }),
    );

    await screen.findByRole("heading", { name: "Create server" });
    await userEvent.click(screen.getByRole("button", { name: /^logger$/i }));

    const confirmation = await screen.findByRole("alertdialog", {
      name: "Discard server creation?",
    });
    await userEvent.click(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    );
    expect(
      screen.getByRole("heading", { name: "Create server" }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^logger$/i }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Discard creation",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Application Logger" }),
    ).toBeInTheDocument();
  });

  it("allows leaving after a recoverable provisioning job has started", async () => {
    appShellTestState.recoverableProvisioningJobs = [
      {
        id: "job-1",
        serverId: null,
        stage: "failed",
        plan: {},
        progress: { completedStages: ["downloading"] },
        stagingDir: "C:/Servers/.staging/job-1",
        targetDir: "C:/Servers/Test",
        error: {
          code: "DOWNLOAD_FAILED",
          stage: "downloading",
          message: "Download interrupted",
          detail: null,
          retryable: true,
          cleanupRequired: true,
        },
        createdAt: "2026-07-18T00:00:00Z",
        updatedAt: "2026-07-18T00:01:00Z",
      },
    ];
    renderShell();

    await userEvent.click(
      screen.getByRole("button", { name: /create server/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Download interrupted",
    );
    await userEvent.click(screen.getByRole("button", { name: /^logger$/i }));

    expect(
      await screen.findByRole("heading", { name: "Application Logger" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("alertdialog", { name: "Discard server creation?" }),
    ).not.toBeInTheDocument();
  });

  it("opens settings in the main content area with section navigation", async () => {
    renderShell();

    fireEvent.click(screen.getByRole("button", { name: /^settings$/i }));

    const main = screen.getByRole("main");
    expect(
      await within(main).findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Default section is General
    expect(
      within(main).getByRole("button", { name: /general/i }),
    ).toBeInTheDocument();
    expect(
      within(main).getByRole("button", { name: /appearance/i }),
    ).toBeInTheDocument();
    expect(
      within(main).getByRole("button", { name: /updates/i }),
    ).toBeInTheDocument();

    // Navigate to Appearance section
    await userEvent.click(
      within(main).getByRole("button", { name: /appearance/i }),
    );
    expect(
      await within(main).findByRole("heading", { name: "Theme" }),
    ).toBeInTheDocument();
    expect(
      within(main).getByRole("heading", { name: "Language" }),
    ).toBeInTheDocument();
    expect(
      within(main).getByRole("heading", { name: "Theme" }).closest("section"),
    ).not.toHaveClass("settings-panel");
    expect(
      within(main)
        .getByRole("heading", { name: "Language" })
        .closest("section"),
    ).not.toHaveClass("settings-panel");
    const themeChoices = within(main).getByRole("radiogroup", {
      name: /theme/i,
    });
    const languageSelect = within(main).getByRole("combobox", {
      name: /language/i,
    });
    expect(
      within(themeChoices).getByRole("radio", { name: "System" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(languageSelect).toHaveTextContent("English");
    expect(
      within(themeChoices).getByRole("radio", { name: "Light" }),
    ).toBeInTheDocument();
    expect(
      within(themeChoices).getByRole("radio", { name: "Dark" }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(themeChoices).getByRole("radio", { name: "System" }),
    );
    await userEvent.click(languageSelect);
    expect(
      screen.getByRole("option", { name: "Chinese (Simplified)" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "English" }));

    // Navigate to Updates section
    await userEvent.click(
      within(main).getByRole("button", { name: /^updates$/i }),
    );
    expect(within(main).getByText("0.1.0")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^servers$/i }));
    expect(
      await screen.findByRole("heading", { name: "Servers" }),
    ).toBeInTheDocument();
  });

  it("localizes primary navigation and top-level server pages", async () => {
    localStorage.setItem("mcsm.language", "zh-CN");

    renderShell();

    expect(
      await screen.findByRole("button", { name: "Java 运行时" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "服务器" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "创建服务器" }),
    ).toBeInTheDocument();
  });

  it("opens the logger page from the sidebar", async () => {
    renderShell();

    await userEvent.click(screen.getByRole("button", { name: /^logger$/i }));

    expect(
      await screen.findByRole("heading", { name: "Application Logger" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Application started")).toBeInTheDocument();
  });
});
