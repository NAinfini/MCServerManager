import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../test/render";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerProfile } from "../servers/types";
import { DiagnosticsView } from "./DiagnosticsView";

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

function renderDiagnostics() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DiagnosticsView server={server} />
    </QueryClientProvider>,
  );
}

describe("DiagnosticsView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("runs diagnostics and shows visible explanations", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_diagnostic_runs") {
        return [];
      }
      return {
        id: "run-1",
        serverId: server.id,
        status: "fail",
        createdAt: "2026-07-01T00:00:00Z",
        results: [
          {
            key: "serverJar",
            status: "fail",
            message: "server.jar is missing",
          },
        ],
      };
    });

    renderDiagnostics();
    fireEvent.click(
      await screen.findByRole("button", { name: /run diagnostics/i }),
    );

    expect(
      await screen.findByText("server.jar is missing"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("run_server_diagnostics", {
        input: {
          serverId: server.id,
        },
      });
    });
  });
});

