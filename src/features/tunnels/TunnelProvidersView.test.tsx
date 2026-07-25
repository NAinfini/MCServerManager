import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { TunnelProvidersView } from "./TunnelProvidersView";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

const provider = {
  id: "provider-1",
  name: "Playit",
  kind: "application",
  command: "C:/tools/playit.exe",
  enabled: true,
  createdAt: "2026-07-01T00:00:00Z",
};

function renderProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TunnelProvidersView servers={[]} />
    </QueryClientProvider>,
  );
}

describe("TunnelProvidersView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_tunnel_providers") {
        return [provider];
      }
      if (
        command === "list_tunnel_statuses" ||
        command === "list_tunnel_bindings"
      ) {
        return [];
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("confirms before disabling a tunnel provider", async () => {
    const user = userEvent.setup();
    renderProviders();

    await user.click(await screen.findByRole("button", { name: "Disable" }));
    expect(invoke).not.toHaveBeenCalledWith("update_tunnel_provider", {
      input: {
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        command: provider.command,
        enabled: false,
      },
    });

    await user.click(screen.getByRole("button", { name: "Disable provider" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("update_tunnel_provider", {
        input: {
          id: provider.id,
          name: provider.name,
          kind: provider.kind,
          command: provider.command,
          enabled: false,
        },
      });
    });
  });

  it("confirms before deleting a tunnel provider", async () => {
    const user = userEvent.setup();
    renderProviders();

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(invoke).not.toHaveBeenCalledWith("delete_tunnel_provider", {
      input: { providerId: provider.id },
    });

    await user.click(screen.getByRole("button", { name: "Delete provider" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_tunnel_provider", {
        input: { providerId: provider.id },
      });
    });
  });

  it("shows a retry action without a contradictory empty state when providers fail", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_tunnel_providers") {
        throw new Error("Tunnel providers unavailable");
      }
      if (
        command === "list_tunnel_statuses" ||
        command === "list_tunnel_bindings"
      ) {
        return [];
      }
      return {};
    });

    renderProviders();

    expect(
      await screen.findByText("Tunnel providers unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No tunnel providers configured"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("uses the compact network section and connects the current server without a nested page heading", async () => {
    const currentServer = {
      id: "server-1",
      name: "My server",
      rootDir: "C:/servers/my-server",
      minecraftVersion: "1.21.1",
      loaderType: "paper" as const,
      loaderVersion: "1",
      javaPath: null,
      serverPort: 25565,
      minMemoryMb: 1024,
      maxMemoryMb: 4096,
      autoStart: false,
      restartPolicy: { enabled: false, maxAttempts: 0, cooldownSeconds: 0 },
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    };
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <TunnelProvidersView embedded servers={[currentServer]} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Network and connections",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: "Connect this server" }),
    );
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("bind_tunnel_to_server", {
        input: { providerId: provider.id, serverId: currentServer.id },
      });
    });
  });
});
