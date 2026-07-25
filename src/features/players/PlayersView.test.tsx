import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { PlayersView } from "./PlayersView";
import type { ServerProfile } from "../../domain/server";
import { ServerRuntimeProvider } from "../servers/ServerRuntimeContext";

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

function renderPlayers() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ServerRuntimeProvider serverId={server.id}>
        <PlayersView server={server} />
      </ServerRuntimeProvider>
    </QueryClientProvider>,
  );
}

describe("PlayersView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders known players and disables actions while stopped", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_players") {
        return {
          serverId: server.id,
          actionsAvailable: false,
          unavailableReason: "player actions require a managed running server",
          players: [
            {
              username: "Alex",
              uuid: "uuid-alex",
              online: false,
              operator: true,
              whitelisted: false,
              banned: false,
            },
          ],
        };
      }
      if (command === "get_server_process_status") {
        return { status: "stopped" };
      }
      if (command === "read_player_lists") {
        return {
          serverId: server.id,
          lists: [],
        };
      }
      return null;
    });

    renderPlayers();

    expect(await screen.findByText("Alex")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deop Alex" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deop Alex" })).toHaveClass(
      "icon-button",
    );
    expect(screen.queryByPlaceholderText(/command/i)).not.toBeInTheDocument();
  });

  it("confirms and sends fixed player actions", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_players") {
        return {
          serverId: server.id,
          actionsAvailable: true,
          unavailableReason: null,
          players: [
            {
              username: "Alex",
              uuid: "uuid-alex",
              online: false,
              operator: false,
              whitelisted: false,
              banned: false,
            },
          ],
        };
      }
      if (command === "get_server_process_status") {
        return { status: "running" };
      }
      if (command === "apply_player_change") {
        return { method: "command", commandSent: "op Alex" };
      }
      if (command === "read_player_lists") {
        return {
          serverId: server.id,
          lists: [],
        };
      }
      return null;
    });

    renderPlayers();

    fireEvent.click(await screen.findByRole("button", { name: "OP Alex" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Grant operator privileges to Alex on Survival?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Grant operator" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("apply_player_change", {
        input: {
          serverId: server.id,
          player: "Alex",
          action: "op",
          uuid: "uuid-alex",
        },
      });
    });
  });

  it("confirms and sends fixed whitelist player actions", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_players") {
        return {
          serverId: server.id,
          actionsAvailable: true,
          unavailableReason: null,
          players: [
            {
              username: "Alex",
              uuid: "uuid-alex",
              online: false,
              operator: false,
              whitelisted: false,
              banned: false,
            },
          ],
        };
      }
      if (command === "get_server_process_status") {
        return { status: "running" };
      }
      if (command === "apply_player_change") {
        return { method: "command", commandSent: "whitelist add Alex" };
      }
      if (command === "read_player_lists") {
        return {
          serverId: server.id,
          lists: [],
        };
      }
      return null;
    });

    renderPlayers();

    fireEvent.click(
      await screen.findByRole("button", { name: "Whitelist Alex" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Add Alex to the whitelist on Survival?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to whitelist" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("apply_player_change", {
        input: {
          serverId: server.id,
          player: "Alex",
          action: "whitelistAdd",
          uuid: "uuid-alex",
        },
      });
    });
  });

  it("keeps the player summary failure isolated to the players page", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_players") {
        throw new Error("could not parse player list");
      }
      if (command === "get_server_process_status") {
        return { status: "stopped" };
      }
      return null;
    });

    renderPlayers();

    expect(
      await screen.findByText("Could not load players"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(
        vi.mocked(invoke).mock.calls.filter(([command]) => command === "list_players"),
      ).toHaveLength(2);
    });
    expect(invoke).not.toHaveBeenCalledWith("read_player_lists", {
      serverId: server.id,
    });
  });

  it("explains that an unenforced whitelist lets everyone join", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_players") {
        return {
          serverId: server.id,
          actionsAvailable: true,
          unavailableReason: null,
          whitelistEnabled: false,
          players: [
            {
              username: "Alex",
              uuid: "uuid-alex",
              online: false,
              operator: false,
              whitelisted: true,
              banned: false,
            },
          ],
        };
      }
      if (command === "get_server_process_status") {
        return { status: "running" };
      }
      return null;
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ServerRuntimeProvider serverId={server.id}>
          <PlayersView server={server} view="whitelist" />
        </ServerRuntimeProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Whitelist is off")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Turn on in properties" }),
    ).toBeInTheDocument();
  });

  it("hides the whitelist notice when the whitelist is enforced", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_players") {
        return {
          serverId: server.id,
          actionsAvailable: true,
          unavailableReason: null,
          whitelistEnabled: true,
          players: [
            {
              username: "Alex",
              uuid: "uuid-alex",
              online: false,
              operator: false,
              whitelisted: true,
              banned: false,
            },
          ],
        };
      }
      if (command === "get_server_process_status") {
        return { status: "running" };
      }
      return null;
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ServerRuntimeProvider serverId={server.id}>
          <PlayersView server={server} view="whitelist" />
        </ServerRuntimeProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Alex")).toBeInTheDocument();
    expect(screen.queryByText("Whitelist is off")).not.toBeInTheDocument();
  });
});

