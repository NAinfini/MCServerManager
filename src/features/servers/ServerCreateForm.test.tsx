import { cleanup, screen, render } from "../../test/render";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerCreateForm } from "./ServerCreateForm";
import { AppSettingsProvider } from "../../i18n";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

vi.mock("../../lib/desktop-command-error", () => ({
  invokeDesktopCommandWithErrorHandling: vi.fn(),
}));

function renderWithSettings(ui: ReactElement) {
  return render(<AppSettingsProvider>{ui}</AppSettingsProvider>);
}

describe("ServerCreateForm", () => {
  beforeEach(() => {
    vi.mocked(invokeDesktopCommandWithErrorHandling).mockImplementation(
      async (command) => {
        if (command === "list_loader_minecraft_versions") {
          return [{ value: "1.21.10", label: "1.21.10", stable: true }];
        }
        if (command === "list_loader_versions") {
          return [{ value: "130", label: "Build 130", stable: true }];
        }
        return [];
      },
    );
  });

  afterEach(() => {
    vi.mocked(invokeDesktopCommand).mockReset();
    vi.mocked(invokeDesktopCommandWithErrorHandling).mockReset();
    cleanup();
  });

  it("submits entered server details when the user clicks create", async () => {
    const onSubmit = vi.fn();
    vi.mocked(invokeDesktopCommand).mockResolvedValueOnce({
      path: "C:/Temp/mcsm-user-sim",
    });
    vi.mocked(invokeDesktopCommandWithErrorHandling).mockImplementation(
      async (command) => {
        if (command === "list_loader_minecraft_versions") {
          return [{ value: "1.21.10", label: "1.21.10", stable: true }];
        }
        if (command === "list_loader_versions") {
          return [{ value: "130", label: "Build 130", stable: true }];
        }
        return [];
      },
    );
    renderWithSettings(<ServerCreateForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Name"), "User Sim Server");
    await userEvent.click(screen.getByRole("button", { name: /browse/i }));
    await userEvent.click(
      await screen.findByRole("combobox", { name: "Minecraft version" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "1.21.10" }),
    );
    await userEvent.click(
      await screen.findByRole("combobox", { name: "Loader version" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Build 130" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create profile" }),
    );

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "User Sim Server",
        rootDir: "C:/Temp/mcsm-user-sim",
        loaderType: "paper",
        minecraftVersion: "1.21.10",
        loaderVersion: "130",
        javaPath: null,
        serverPort: 25565,
      }),
    );
  });

  it("keeps source and advanced runtime choices out of the beginner form", async () => {
    renderWithSettings(
      <ServerCreateForm
        defaultMarketplaceProvider="Modrinth"
        defaultMarketplaceProjectId="project-1"
        defaultMarketplaceVersionId="version-1"
        defaultName="Performance Pack"
        defaultSourceKind="marketplaceModpack"
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByRole("combobox", { name: "Source" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Provider" })).toBeNull();
    expect(screen.queryByText("Blank server")).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Minecraft version" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Loader version" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Java path")).toBeNull();
    expect(screen.queryByLabelText("Port")).toBeNull();
    expect(screen.queryByText("Restart policy")).toBeNull();
    expect(screen.getByText("Performance Pack")).toBeInTheDocument();
  });

  it("requires Minecraft and loader versions before creating", async () => {
    const onSubmit = vi.fn();
    vi.mocked(invokeDesktopCommand).mockResolvedValueOnce({
      path: "C:/Temp/mcsm-user-sim",
    });
    vi.mocked(invokeDesktopCommandWithErrorHandling).mockResolvedValue([]);
    renderWithSettings(<ServerCreateForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Name"), "Needs Versions");
    await userEvent.click(screen.getByRole("button", { name: /browse/i }));
    await userEvent.click(
      screen.getByRole("button", { name: "Create profile" }),
    );

    expect(
      await screen.findByText("Choose a Minecraft version"),
    ).toBeInTheDocument();
    expect(screen.getByText("Choose a loader version")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

