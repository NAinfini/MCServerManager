import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { JavaRuntimesView } from "./JavaRuntimesView";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

function renderJavaView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <JavaRuntimesView />
    </QueryClientProvider>,
  );
}

describe("JavaRuntimesView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("names each server's actual state instead of restating the requirement", async () => {
    vi.mocked(invoke).mockResolvedValue({
      runtimes: [
        {
          path: "C:/Java/bin/java.exe",
          source: "JAVA_HOME",
          version: "21.0.2",
          majorVersion: 21,
          vendor: "OpenJDK",
          architecture: "64-bit",
        },
      ],
      failures: [
        {
          path: "C:/bad/java.exe",
          source: "Configured for Broken",
          error: "could not parse Java version output",
        },
      ],
      compatibility: [
        {
          serverId: "server-1",
          serverName: "Survival",
          minecraftVersion: "1.21.4",
          configuredJavaPath: "C:/Java/bin/java.exe",
          requiredMajorVersion: 21,
          configuredMajorVersion: 21,
          recommendedJavaPath: "C:/Java/bin/java.exe",
          status: "compatible",
          message: "Java 21 satisfies required Java 21",
        },
        {
          serverId: "server-2",
          serverName: "Unset",
          minecraftVersion: "1.20.5",
          configuredJavaPath: null,
          requiredMajorVersion: 21,
          recommendedJavaPath: "C:/Java/bin/java.exe",
          status: "unknown",
          message: "Configure Java 21 or newer for this server",
        },
      ],
    });

    renderJavaView();

    expect(await screen.findAllByText("Java 21")).not.toHaveLength(0);
    expect(screen.getByText("OpenJDK")).toBeInTheDocument();
    // The healthy server states what it runs on; the broken one states what is
    // wrong with it. Neither repeats the version floor back at the reader.
    expect(screen.getByText("Runs on Java 21.")).toBeInTheDocument();
    expect(
      screen.getByText("No Java is set for this server. It needs Java 21."),
    ).toBeInTheDocument();
    // The runtime is already on this machine, so the fix is to point at it.
    expect(screen.getByRole("button", { name: "Use Java 21" })).toBeEnabled();
    expect(
      screen.getByRole("link", { name: "Oracle Java downloads" }),
    ).toHaveAttribute("href", "https://www.java.com/download/");
    expect(
      screen.getByText("could not parse Java version output"),
    ).toBeInTheDocument();
  });

  it("names the servers each installed runtime is in use by", async () => {
    vi.mocked(invoke).mockResolvedValue({
      runtimes: [
        {
          path: "C:/Java/bin/java.exe",
          source: "JAVA_HOME",
          version: "21.0.2",
          majorVersion: 21,
          vendor: "OpenJDK",
          architecture: "64-bit",
        },
        {
          path: "C:/Program Files (x86)/Java/jre-1.8/bin/java.exe",
          source: "Installed on this machine",
          version: "1.8.0_401",
          majorVersion: 8,
          vendor: "Oracle",
          architecture: "32-bit",
        },
      ],
      failures: [],
      compatibility: [
        {
          serverId: "server-1",
          serverName: "Survival",
          minecraftVersion: "1.21.4",
          // Stored with the separator and casing Windows hands back, which is
          // not how the scan spells it.
          configuredJavaPath: "c:\\Java\\bin\\java.exe",
          requiredMajorVersion: 21,
          configuredMajorVersion: 21,
          status: "compatible",
          message: "Java 21 satisfies required Java 21",
        },
      ],
    });

    renderJavaView();

    const rows = await screen.findAllByRole("row");
    const inUse = rows.find((row) => within(row).queryByText("Survival"));
    expect(inUse).toBeDefined();
    expect(screen.getByText("Not in use")).toBeInTheDocument();
  });

  it("points a legacy server at the Java 8 it already has", async () => {
    // The reported contradiction: the page said a compatible Java 8 was
    // detected and, in the same breath, that the server "requires Java 8 or
    // newer" — while the server ran on Java 11, which is what crashed it.
    // Newer is the failure, not the fix, and the runtime that works is already
    // in the table above.
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_java_runtimes") {
        return {
          runtimes: [
            {
              path: "C:/Program Files/Java/jdk-11/bin/java.exe",
              source: "Installed on this machine",
              version: "11.0.12",
              majorVersion: 11,
              vendor: "Oracle",
              architecture: "64-bit",
            },
            {
              path: "C:/Program Files (x86)/Java/jre-1.8/bin/java.exe",
              source: "Installed on this machine",
              version: "1.8.0_401",
              majorVersion: 8,
              vendor: "Oracle",
              architecture: "64-bit",
            },
          ],
          failures: [],
          compatibility: [
            {
              serverId: "server-legacy",
              serverName: "HeroPack",
              minecraftVersion: "1.7.10",
              configuredJavaPath: "C:/Program Files/Java/jdk-11/bin/java.exe",
              requiredMajorVersion: 8,
              maxMajorVersion: 8,
              configuredMajorVersion: 11,
              configuredArchitecture: "64-bit",
              recommendedJavaPath:
                "C:/Program Files (x86)/Java/jre-1.8/bin/java.exe",
              reason: "tooNew",
              status: "warning",
              message: "Java 11 is too new for Minecraft 1.7.10",
            },
          ],
        };
      }
      return null;
    });

    renderJavaView();

    expect(
      await screen.findByText(
        "Set to Java 11, but Minecraft 1.7.10 only starts on Java 8.",
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Use Java 8" }));

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_server_profile", {
      input: {
        id: "server-legacy",
        javaPath: "C:/Program Files (x86)/Java/jre-1.8/bin/java.exe",
      },
    });
  });

  it("installs and applies a runtime in one action when none is on the machine", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "list_java_runtimes") {
        return {
          runtimes: [],
          failures: [],
          compatibility: [
            {
              serverId: "server-legacy",
              serverName: "HeroPack",
              minecraftVersion: "1.7.10",
              configuredJavaPath: null,
              requiredMajorVersion: 8,
              maxMajorVersion: 8,
              recommendedJavaPath: null,
              status: "unknown",
              message: "Configure Java 8 for this server",
            },
          ],
        };
      }
      if (command === "plan_java_runtime") {
        expect(args).toEqual({
          input: { majorVersion: 8, maxMajorVersion: 8 },
        });
        return {
          action: "install",
          majorVersion: 8,
          vendor: "Eclipse Temurin",
          version: "8u442+6",
          licenseUrl: "https://openjdk.org/legal/gplv2+ce.html",
          managed: true,
        };
      }
      if (command === "install_java_runtime") {
        return {
          path: "C:/managed/jdk8/bin/java.exe",
          majorVersion: 8,
          managed: true,
        };
      }
      return null;
    });

    const { container } = renderJavaView();
    // From the server's own row, not the general acquire panel — that is the
    // path a user actually takes, and the one that has to end with the server
    // pointed at what it downloaded.
    const servers = await within(container).findByText("HeroPack");
    await userEvent.click(
      within(servers.closest(".java-panel") as HTMLElement).getByRole(
        "button",
        {
          name: "Get Java 8",
        },
      ),
    );

    const install = await screen.findByRole("button", {
      name: "Install managed Java",
    });
    // The dialog names the server the download is for, because acquiring a
    // runtime and pointing the server at it are now one action.
    const summary = install.closest("[role='dialog']") as HTMLElement;
    expect(within(summary).getByText("Applies to")).toBeInTheDocument();
    expect(within(summary).getByText("HeroPack")).toBeInTheDocument();
    expect(install).toBeDisabled();
    await userEvent.click(
      screen.getByRole("checkbox", { name: /I agree to download/i }),
    );
    expect(install).toBeEnabled();
    await userEvent.click(install);

    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      "install_java_runtime",
      expect.objectContaining({
        input: expect.objectContaining({ consent: true }),
      }),
    );
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_server_profile", {
      input: {
        id: "server-legacy",
        javaPath: "C:/managed/jdk8/bin/java.exe",
      },
    });
  });

  it("localizes managed runtime sources with compact badge copy", async () => {
    localStorage.setItem("mcsm.language", "zh-CN");
    vi.mocked(invoke).mockResolvedValue({
      runtimes: [
        {
          path: "C:/managed/java.exe",
          source: "Managed by MC Server Manager",
          version: "25.0.1",
          majorVersion: 25,
          vendor: "Eclipse Temurin",
          architecture: "64-bit",
        },
      ],
      failures: [],
      compatibility: [],
    });

    renderJavaView();

    expect(await screen.findByText("托管")).toHaveClass("java-source-chip");
    expect(
      screen.queryByText("Managed by MC Server Manager"),
    ).not.toBeInTheDocument();
  });

  it("offers removal only for the runtimes this app installed", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_java_runtimes") {
        return {
          runtimes: [
            {
              path: "C:/Program Files/Java/jdk-11/bin/java.exe",
              source: "Installed on this machine",
              version: "11.0.12",
              majorVersion: 11,
              vendor: "Oracle",
              architecture: "64-bit",
              managed: false,
            },
            {
              path: "C:/AppData/mc-server-manager/runtimes/temurin/25/windows-x64/jdk-25/bin/java.exe",
              source: "Managed by MC Server Manager",
              version: "25.0.3",
              majorVersion: 25,
              vendor: "Eclipse Temurin",
              architecture: "64-bit",
              managed: true,
            },
          ],
          failures: [],
          compatibility: [],
        };
      }
      return null;
    });

    renderJavaView();

    // One button, not two: a Java the user installed themselves is not this
    // app's to delete, so the row does not pretend otherwise.
    const remove = await screen.findAllByRole("button", { name: "Delete" });
    expect(remove).toHaveLength(1);

    await userEvent.click(remove[0]!);
    await userEvent.click(
      within(
        screen.getByRole("dialog", { name: "Delete this Java 25?" }),
      ).getByRole("button", { name: "Delete" }),
    );

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("remove_java_runtime", {
      input: {
        path: "C:/AppData/mc-server-manager/runtimes/temurin/25/windows-x64/jdk-25/bin/java.exe",
      },
    });
  });

  it("groups the acquire controls inside a padded panel body", async () => {
    vi.mocked(invoke).mockResolvedValue({
      runtimes: [],
      failures: [],
      compatibility: [],
    });

    const { container } = renderJavaView();
    await screen.findAllByRole("heading", { name: "Get Java" });
    const body = container.querySelector(
      ".java-panel-acquire .java-panel-body",
    );

    expect(body).not.toBeNull();
    if (!body) throw new Error("Expected acquire panel body");
    expect(
      within(body as HTMLElement).getByText(
        /install Temurin inside its own data folder/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(body as HTMLElement).getByRole("button", { name: "Get Java 21" }),
    ).toBeInTheDocument();
  });

  it("marks Java panels by role instead of relying on render order", async () => {
    vi.mocked(invoke).mockResolvedValue({
      runtimes: [],
      failures: [
        {
          path: "C:/broken/java.exe",
          source: "Configured runtime",
          error: "invalid runtime",
        },
      ],
      compatibility: [],
    });

    const { container } = renderJavaView();
    await within(container).findByText("Get Java");

    expect(container.querySelector(".java-panel-servers")).not.toBeNull();
    expect(container.querySelector(".java-panel-installed")).not.toBeNull();
    expect(container.querySelector(".java-panel-acquire")).not.toBeNull();
    expect(container.querySelector(".java-panel-failures")).not.toBeNull();
    // Servers first: the page answers "can my server start?" before it lists
    // what happens to be installed.
    const panels = [...container.querySelectorAll(".java-panel")];
    expect(panels[0]).toBe(container.querySelector(".java-panel-servers"));
  });

  it("offers an explicit retry when runtime discovery fails", async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error("Java scan unavailable"))
      .mockResolvedValueOnce({
        runtimes: [],
        failures: [],
        compatibility: [],
      });

    renderJavaView();

    expect(
      await screen.findByText("Java scan unavailable"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findAllByText("No Java runtimes detected"),
    ).not.toHaveLength(0);
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2);
  });
});
