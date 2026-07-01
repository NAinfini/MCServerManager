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
      <PlayersView server={server} />
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
    expect(screen.getByRole("button", { name: "OP Alex" })).toBeDisabled();
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
      if (command === "apply_player_action") {
        return { commandSent: "op Alex" };
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
      expect(invoke).toHaveBeenCalledWith("apply_player_action", {
        input: {
          serverId: server.id,
          player: "Alex",
          action: "op",
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
      if (command === "apply_player_action") {
        return { commandSent: "whitelist add Alex" };
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
      expect(invoke).toHaveBeenCalledWith("apply_player_action", {
        input: {
          serverId: server.id,
          player: "Alex",
          action: "whitelistAdd",
        },
      });
    });
  });

  it("keeps structured list errors visible when player summary fails", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_players") {
        throw new Error("could not parse player list");
      }
      if (command === "get_server_process_status") {
        return { status: "stopped" };
      }
      if (command === "read_player_lists") {
        return {
          serverId: server.id,
          lists: [
            {
              listType: "ops",
              fileName: "ops.json",
              entries: [],
              error: "could not parse ops.json",
            },
          ],
        };
      }
      return null;
    });

    renderPlayers();

    expect(
      await screen.findByText("Could not load players"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("could not parse ops.json"),
    ).toBeInTheDocument();
  });
});

