import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "../../test/render";
import type { ServerProfile } from "../../domain/server";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { ContentUpdatePolicyView } from "./ContentUpdatePolicyView";

vi.mock("../../lib/desktop-runtime", () => ({ invokeDesktopCommand: vi.fn() }));

const server: ServerProfile = {
  id: "server-1", name: "Survival", rootDir: "C:/servers/survival", minecraftVersion: "1.21.4", loaderType: "paper", loaderVersion: "1", javaPath: null, serverPort: 25565, minMemoryMb: 1024, maxMemoryMb: 4096, autoStart: false, createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z", restartPolicy: { enabled: true, maxAttempts: 3, cooldownSeconds: 30 },
};

function renderPolicy() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ContentUpdatePolicyView server={server} /></QueryClientProvider>);
}

describe("ContentUpdatePolicyView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_content_update_policy") return { id: "default", serverId: server.id, contentId: null, policy: "manual_only", pinnedVersion: null, ignoredUpdate: null, updatedAt: "2026-07-01T00:00:00Z" };
      if (command === "list_installed_content") return [{ id: "content-1", serverId: server.id, contentId: "modrinth:demo:1", name: "Demo mod", version: "1.0.0", loader: "paper", sourcePath: "source", installedPath: "installed", sha256: "hash", warnings: [], installedAt: "2026-07-01T00:00:00Z" }];
      if (command === "save_content_update_policy") {
        const input = (args as { input: Record<string, unknown> }).input;
        return { id: "saved", serverId: server.id, contentId: input.contentId, policy: input.policy, pinnedVersion: input.pinnedVersion, ignoredUpdate: input.ignoredUpdate, updatedAt: "2026-07-01T00:00:00Z" };
      }
      throw new Error(`unexpected ${command}`);
    });
  });
  afterEach(cleanup);

  it("offers three update preferences without candidate inputs", async () => {
    const user = userEvent.setup();
    renderPolicy();
    expect(await screen.findByRole("radiogroup", { name: /default behavior/i })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByLabelText(/candidate name/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /automatic/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_content_update_policy", { input: { serverId: server.id, contentId: null, policy: "batch_confirm", pinnedVersion: null, ignoredUpdate: null } }));
  });

  it("creates content exceptions from installed rows rather than typed IDs", async () => {
    const user = userEvent.setup();
    renderPolicy();
    expect(await screen.findByText("Demo mod")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /keep current/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_content_update_policy", { input: { serverId: server.id, contentId: "modrinth:demo:1", policy: "pin_current", pinnedVersion: "1.0.0", ignoredUpdate: null } }));
  });
});
