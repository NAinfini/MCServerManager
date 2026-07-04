import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, waitFor } from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { ServerActivityView } from "./ServerActivityView";
import type { ServerProfile } from "../servers/types";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

const server: ServerProfile = {
  id: "server-1",
  name: "Survival",
  rootDir: "C:/servers/survival",
  minecraftVersion: "1.21.4",
  loaderType: "paper",
  loaderVersion: null,
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

function renderActivity() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ServerActivityView server={server} />
    </QueryClientProvider>,
  );
}

describe("ServerActivityView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "list_process_events") {
        return [];
      }
      if (command === "list_server_logs") {
        return { serverId: server.id, logs: [] };
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the full logs tab from the recent activity shortcut", async () => {
    renderActivity();

    await userEvent.click(
      await screen.findByRole("button", { name: /view all/i }),
    );

    expect(screen.getByRole("tab", { name: /logs/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_server_logs", {
        serverId: server.id,
      });
    });
  });
});
