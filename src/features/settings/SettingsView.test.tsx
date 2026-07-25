import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "../../test/render";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { SettingsView } from "./SettingsView";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

const preferences = {
  closeBehavior: "minimize",
  launchAtLogin: false,
  defaultServerDir: "C:/MCServers",
  defaultBackupDir: "C:/MCServers/backups",
  cacheDir: "C:/Users/Test/AppData/Roaming/mc-server-manager/cache",
  appDataDir: "C:/Users/Test/AppData/Roaming/mc-server-manager",
  logging: {
    retentionDays: 14,
    maxSizeMb: 25,
    level: "info",
  },
  serverDefaults: {
    javaStrategy: "auto",
    minMemoryMb: 1024,
    maxMemoryMb: 4096,
  },
  backupDefaults: {
    compression: "zip",
    retentionDays: 14,
    frequency: "daily",
  },
  marketplace: {
    defaultProvider: "modrinth",
    showIncompatible: false,
    autoInstallDependencies: true,
    cacheSizeMb: 1024,
  },
  appearance: {
    compactMode: false,
    motion: "full",
    fontSize: "medium",
  },
  providers: {
    modrinth: true,
    hangar: true,
    bbsmc: true,
    curseforge: true,
  },
};

describe("SettingsView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_app_preferences") {
        return preferences;
      }
      if (command === "show_open_dialog") {
        return { path: "D:/ManagedServers" };
      }
      if (command === "show_save_dialog") {
        return { path: "D:/diagnostics.json" };
      }
      if (command === "save_app_preferences") {
        return { ...preferences, ...(args?.input as object) };
      }
      if (command === "clear_app_cache") {
        return { cleared: true };
      }
      if (
        command === "open_app_logs_folder" ||
        command === "open_app_data_folder" ||
        command === "export_diagnostic_package" ||
        command === "export_app_settings"
      ) {
        return { path: "D:/diagnostics.json" };
      }
      if (
        command === "import_app_settings" ||
        command === "reset_app_preferences"
      ) {
        return preferences;
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the single settings tab layer scannable and scrollable", async () => {
    const { container } = render(<SettingsView />);

    expect(
      screen.getByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(
      container.querySelectorAll(".settings-nav-item[data-nav-group-start]")
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll(".settings-nav-item")).toHaveLength(8);
  });

  it("updates path settings through folder pickers and clears cache", async () => {
    render(<SettingsView />);

    await userEvent.click(
      screen.getByRole("button", { name: /storage & logs/i }),
    );
    expect(await screen.findByText("C:/MCServers")).toBeInTheDocument();

    const browseButtons = screen.getAllByRole("button", { name: /browse/i });
    await userEvent.click(browseButtons[0]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("show_open_dialog", {
        kind: "folder",
      });
      expect(invoke).toHaveBeenCalledWith("save_app_preferences", {
        input: { defaultServerDir: "D:/ManagedServers" },
      });
    });
    expect(await screen.findByText("D:/ManagedServers")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /clear cache/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("clear_app_cache", undefined);
    });
  });

  it("persists general and provider controls", async () => {
    render(<SettingsView />);

    await userEvent.click(
      await screen.findByRole("switch", { name: /launch at login/i }),
    );
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_app_preferences", {
        input: { launchAtLogin: true },
      });
    });

    await userEvent.click(
      await screen.findByRole("combobox", {
        name: /close button behavior/i,
      }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /quit app/i }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_app_preferences", {
        input: { closeBehavior: "quit" },
      });
    });

    await userEvent.click(
      screen.getByRole("button", { name: /marketplace & sources/i }),
    );
    expect(await screen.findByText(/manual import only/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/curseforge/i)).not.toBeInTheDocument();
    await userEvent.click(await screen.findByLabelText(/bbsmc/i));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_app_preferences", {
        input: { providers: { ...preferences.providers, bbsmc: false } },
      });
    });
  });

  it("keeps server runtime choices as new-server defaults", async () => {
    render(<SettingsView />);

    await userEvent.click(screen.getByRole("button", { name: /^defaults$/i }));
    expect(
      await screen.findByText(/used only when creating new servers/i),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getAllByRole("button", { name: /browse/i })[0],
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_app_preferences", {
        input: { defaultServerDir: "D:/ManagedServers" },
      });
    });

    await userEvent.click(
      screen.getByRole("combobox", { name: /java version strategy/i }),
    );
    await userEvent.click(screen.getByRole("option", { name: /latest lts/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_app_preferences", {
        input: {
          serverDefaults: {
            ...preferences.serverDefaults,
            javaStrategy: "latest-lts",
          },
        },
      });
    });
  });

  it("persists backup and marketplace defaults without touching server profiles", async () => {
    render(<SettingsView />);

    await userEvent.click(screen.getByRole("button", { name: /^defaults$/i }));
    await userEvent.click(
      screen.getByRole("combobox", { name: /compression format/i }),
    );
    await userEvent.click(screen.getByRole("option", { name: /tar.gz/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_app_preferences", {
        input: {
          backupDefaults: {
            ...preferences.backupDefaults,
            compression: "tar.gz",
          },
        },
      });
    });

    await userEvent.click(
      screen.getByRole("button", { name: /marketplace & sources/i }),
    );
    await userEvent.click(
      screen.getByRole("combobox", { name: /default provider/i }),
    );
    await userEvent.click(screen.getByRole("option", { name: /bbsmc/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_app_preferences", {
        input: {
          marketplace: {
            ...preferences.marketplace,
            defaultProvider: "bbsmc",
          },
        },
      });
    });

    expect(invoke).not.toHaveBeenCalledWith(
      "update_server_profile",
      expect.anything(),
    );
  });

  it("exposes diagnostics and data management actions", async () => {
    render(<SettingsView />);

    await userEvent.click(
      screen.getByRole("button", { name: /storage & logs/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /open log folder/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /export diagnostics/i }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("open_app_logs_folder");
      expect(invoke).toHaveBeenCalledWith("show_save_dialog", {
        defaultPath: "mc-server-manager-diagnostics.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      expect(invoke).toHaveBeenCalledWith("export_diagnostic_package", {
        input: { path: "D:/diagnostics.json" },
      });
    });

    await userEvent.click(
      screen.getByRole("button", { name: /open app data/i }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("open_app_data_folder");
    });
  });

  it("offers visual system, light, and dark theme choices", async () => {
    render(<SettingsView />);

    await userEvent.click(screen.getByRole("button", { name: /appearance/i }));

    const themeChoices = await screen.findByRole("radiogroup", {
      name: /^theme$/i,
    });
    expect(
      within(themeChoices).getByRole("radio", { name: /^system$/i }),
    ).toBeInTheDocument();
    expect(
      within(themeChoices).getByRole("radio", { name: /^light$/i }),
    ).toBeInTheDocument();
    expect(
      within(themeChoices).getByRole("radio", { name: /^dark$/i }),
    ).toBeInTheDocument();

    await userEvent.click(
      within(themeChoices).getByRole("radio", { name: /^light$/i }),
    );
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("does not expose default settings when loading fails and retries safely", async () => {
    let attempts = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_app_preferences") {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("settings unavailable");
        }
        return preferences;
      }
      return null;
    });

    render(<SettingsView />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "settings unavailable",
    );
    expect(
      screen.queryByRole("combobox", { name: /close button behavior/i }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("combobox", {
        name: /close button behavior/i,
      }),
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
  });
});
