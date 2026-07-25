import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../../test/render";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import type { ServerProfile } from "../../domain/server";
import { ServerMarketplaceView } from "./ServerMarketplaceView";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

const server: ServerProfile = {
  id: "server-1",
  name: "Survival",
  rootDir: "C:/servers/survival",
  minecraftVersion: "1.21.4",
  loaderType: "paper",
  loaderVersion: "1",
  javaPath: null,
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
};

function renderMarketplace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServerMarketplaceView server={server} />
    </QueryClientProvider>,
  );
}

describe("ServerMarketplaceView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("offers retry without showing no results when search fails", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error("marketplace unavailable"))
      .mockResolvedValueOnce([]);

    renderMarketplace();

    await user.type(screen.getByRole("textbox"), "sodium");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByRole("alert", {
        name: /could not search marketplace/i,
      }),
    ).toHaveTextContent("marketplace unavailable");
    expect(screen.queryByText("No search results")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No search results")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
