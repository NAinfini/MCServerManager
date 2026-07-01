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
});
