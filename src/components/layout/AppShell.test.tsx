import { cleanup, fireEvent, render, screen, within } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSettingsProvider } from "../../i18n";
import { AppShell } from "./AppShell";

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
  });

  it("renders the main navigation regions", async () => {
    renderShell();

    expect(
      screen.getByRole("navigation", { name: /primary/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getAllByText("MC Server Manager").length).toBeGreaterThan(0);
    expect(await screen.findByText(/1 running/i)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Servers" })).toBeInTheDocument();
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

  it("keeps Servers navigation on the global overview and opens detail from a server row", async () => {
    renderShell();

    expect(await screen.findByRole("heading", { name: "Servers" })).toBeInTheDocument();

    const serverButtons = await screen.findAllByRole("button", {
      name: /^survival smp$/i,
    });
    await userEvent.click(serverButtons[serverButtons.length - 1]);

    expect(
      await screen.findByRole("heading", { name: "Survival SMP" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Console" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^servers$/i }));

    expect(await screen.findByRole("heading", { name: "Servers" })).toBeInTheDocument();
  });

  it("opens Java runtimes as a modal without replacing the servers page", async () => {
    renderShell();

    fireEvent.click(screen.getByRole("button", { name: /java runtimes/i }));

    const dialog = await screen.findByRole("dialog", { name: "Java Runtimes" });
    expect(dialog).toHaveAccessibleDescription("Runtime compatibility");
    expect(
      within(dialog).getByRole("heading", { name: "Java Runtimes" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getAllByRole("heading", { name: "Java Runtimes" }),
    ).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: /scan/i })).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /download java/i }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("link", {
        name: /eclipse temurin download/i,
      }),
    ).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
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

    expect(
      await screen.findByRole("dialog", { name: "Create server" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new blank server/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /open modpack file/i }).length,
    ).toBeGreaterThan(0);
  });

  it("keeps the create server modal open when dismissing a dropdown inside it", async () => {
    renderShell();

    await userEvent.click(
      screen.getByRole("button", { name: /create server/i }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Create server" });

    await userEvent.click(
      within(dialog).getByRole("button", { name: /browse marketplace/i }),
    );
    const providerSelect = await within(dialog).findByRole("combobox", {
      name: /providers/i,
    });

    await userEvent.click(providerSelect);
    expect(screen.getByRole("option", { name: "Modrinth" })).toBeInTheDocument();

    const backdrop = document.querySelector(".dialog-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.pointerDown(backdrop!);
    fireEvent.click(backdrop!);

    expect(
      screen.getByRole("dialog", { name: "Create server" }),
    ).toBeInTheDocument();
  });

  it("renders modal content outside the backdrop hit target", async () => {
    renderShell();

    await userEvent.click(
      screen.getByRole("button", { name: /create server/i }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Create server" });
    const backdrop = document.querySelector(".dialog-backdrop");

    expect(backdrop).not.toBeNull();
    expect(backdrop).not.toContainElement(dialog);
    expect(dialog).toHaveClass("modal-dialog");
    expect(dialog).toHaveClass("create-server-dialog");
  });

  it("opens settings as a modal with section navigation", async () => {
    renderShell();

    fireEvent.click(screen.getByRole("button", { name: /^settings$/i }));

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveAccessibleDescription("Application preferences");
    expect(
      within(dialog).getByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getAllByRole("heading", { name: "Settings" }),
    ).toHaveLength(1);
    // Default section is General
    expect(
      within(dialog).getByRole("button", { name: /general/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /appearance/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /updates/i }),
    ).toBeInTheDocument();

    // Navigate to Appearance section
    await userEvent.click(within(dialog).getByRole("button", { name: /appearance/i }));
    expect(
      await within(dialog).findByRole("heading", { name: "Theme" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: "Language" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: "Theme" }).closest("section"),
    ).not.toHaveClass("settings-panel");
    expect(
      within(dialog).getByRole("heading", { name: "Language" }).closest("section"),
    ).not.toHaveClass("settings-panel");
    const themeSelect = within(dialog).getByRole("combobox", { name: /theme/i });
    const languageSelect = within(dialog).getByRole("combobox", { name: /language/i });
    expect(themeSelect).toHaveTextContent("System");
    expect(languageSelect).toHaveTextContent("English");
    await userEvent.click(themeSelect);
    expect(screen.getByRole("option", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Dark" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "System" }));
    await userEvent.click(languageSelect);
    expect(
      screen.getByRole("option", { name: "Chinese (Simplified)" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "English" }));

    // Navigate to Updates section
    await userEvent.click(within(dialog).getByRole("button", { name: /^updates$/i }));
    expect(within(dialog).getByText("0.1.0")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(
      await screen.findByRole("heading", { name: "Servers" }),
    ).toBeInTheDocument();
  });

  it("localizes primary navigation and top-level server pages", async () => {
    localStorage.setItem("mcsm.language", "zh-CN");

    renderShell();

    expect(await screen.findByRole("button", { name: "Java 运行时" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "服务器" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建服务器" })).toBeInTheDocument();
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
