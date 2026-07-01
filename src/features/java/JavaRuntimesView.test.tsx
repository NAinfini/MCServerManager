import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "../../test/render";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(screen.queryByText("Download options")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Eclipse Temurin Download"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download Java" }),
    ).not.toBeInTheDocument();
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
});

