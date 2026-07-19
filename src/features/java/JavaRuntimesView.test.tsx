import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "../../test/render";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  });

  it("renders runtimes, compatibility warnings, and scan failures", async () => {
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
          status: "compatible",
          message: "Java 21 satisfies required Java 21",
        },
        {
          serverId: "server-2",
          serverName: "Legacy",
          minecraftVersion: "1.20.5",
          configuredJavaPath: null,
          requiredMajorVersion: 21,
          status: "unknown",
          message: "Configure Java 21 or newer for this server",
        },
      ],
    });

    renderJavaView();

    expect(await screen.findAllByText("Java 21")).not.toHaveLength(0);
    expect(screen.getByText("OpenJDK")).toBeInTheDocument();
    expect(
      screen.getByText("Java 21 satisfies required Java 21"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Configure Java 21 or newer for this server"),
    ).toBeInTheDocument();
    expect(screen.getByText("Managed Eclipse Temurin")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Oracle Java downloads" }),
    ).toHaveAttribute("href", "https://www.java.com/download/");
    expect(
      screen.getByRole("button", { name: "Prepare Java 21" }),
    ).toBeEnabled();
    const recommendedJavaLinks = screen.getAllByRole("link", {
      name: "Java 21",
    });
    expect(recommendedJavaLinks).toHaveLength(2);
    expect(recommendedJavaLinks[0]).toHaveAttribute(
      "href",
      "https://adoptium.net/temurin/releases/?version=21",
    );
    expect(
      screen.getByText("could not parse Java version output"),
    ).toBeInTheDocument();
  });

  it("requires consent before installing a managed Temurin runtime", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "list_java_runtimes") {
        return { runtimes: [], failures: [], compatibility: [] };
      }
      if (command === "plan_java_runtime") {
        return {
          action: "install",
          majorVersion: 21,
          vendor: "Eclipse Temurin",
          version: "21.0.8+9",
          licenseUrl: "https://openjdk.org/legal/gplv2+ce.html",
          managed: true,
        };
      }
      if (command === "install_java_runtime") {
        const input = (args as { input?: { consent?: boolean } })?.input;
        expect(input?.consent).toBe(true);
        return { path: "C:/managed/java.exe", majorVersion: 21, managed: true };
      }
      return null;
    });

    renderJavaView();
    await userEvent.click(
      await screen.findByRole("button", { name: "Prepare Java 21" }),
    );

    const install = await screen.findByRole("button", {
      name: "Install managed Java",
    });
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
  });

  it("groups managed runtime controls inside a padded panel body", async () => {
    vi.mocked(invoke).mockResolvedValue({
      runtimes: [],
      failures: [],
      compatibility: [],
    });

    renderJavaView();

    const headings = await screen.findAllByRole("heading", {
      name: "Managed Eclipse Temurin",
    });
    const heading = headings.at(-1)!;
    const panel = heading.closest("section");
    const body = panel?.querySelector(".java-panel-body");

    expect(body).not.toBeNull();
    if (!body) throw new Error("Expected managed runtime panel body");
    expect(
      within(body as HTMLElement).getByText(
        /install Temurin inside its own data folder/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(body as HTMLElement).getByRole("button", {
        name: "Prepare Java 21",
      }),
    ).toBeInTheDocument();
  });
});
