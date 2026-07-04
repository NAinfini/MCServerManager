import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { UpdateStatus } from "./UpdateStatus";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

function renderUpdateStatus() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <UpdateStatus />
    </QueryClientProvider>,
  );
}

describe("UpdateStatus", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "check_app_update") {
        return {
          currentVersion: "1.0.0",
          channel: "stable",
          checkedAt: "2026-07-01T00:00:00Z",
          updateAvailable: true,
          installerEnabled: true,
          installBlockedByRunningServers: false,
          latestVersion: "1.1.0",
          releaseNotes: null,
          releaseDate: "2026-07-01T00:00:00Z",
          message: "Update available",
        };
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("confirms before installing an app update", async () => {
    const user = userEvent.setup();
    renderUpdateStatus();

    await user.click(await screen.findByRole("button", { name: /install update/i }));
    expect(invoke).not.toHaveBeenCalledWith("install_app_update", {
      input: { channel: "stable" },
    });

    await user.click(screen.getByRole("button", { name: "Install app update" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("install_app_update", {
        input: { channel: "stable" },
      });
    });
  });

  it("blocks app update installation while managed servers are running", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "check_app_update") {
        return {
          currentVersion: "1.0.0",
          channel: "stable",
          checkedAt: "2026-07-01T00:00:00Z",
          updateAvailable: true,
          installerEnabled: false,
          installBlockedByRunningServers: true,
          runningServerCount: 2,
          latestVersion: "1.1.0",
          releaseNotes: null,
          releaseDate: "2026-07-01T00:00:00Z",
          message: "Update available",
        };
      }
      return {};
    });
    renderUpdateStatus();

    expect(
      await screen.findByText(/2 managed servers are running/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /install update/i }),
    ).toBeDisabled();
  });
});
