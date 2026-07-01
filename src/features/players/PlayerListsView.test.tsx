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
import { PlayerListsView } from "./PlayerListsView";
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

function renderLists() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlayerListsView server={server} />
    </QueryClientProvider>,
  );
}

describe("PlayerListsView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows invalid JSON errors", async () => {
    vi.mocked(invoke).mockResolvedValue({
      serverId: server.id,
      lists: [
        {
          listType: "ops",
          fileName: "ops.json",
          entries: [],
          error: "could not parse ops.json",
        },
      ],
    });

    renderLists();

    expect(
      await screen.findByText("could not parse ops.json"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save ops/i })).toBeDisabled();
  });

  it("saves structured list edits", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "read_player_lists") {
        return {
          serverId: server.id,
          lists: [
            {
              listType: "ops",
              fileName: "ops.json",
              entries: [{ name: "Alex" }],
              error: null,
            },
          ],
        };
      }
      return {};
    });

    renderLists();
    fireEvent.change(await screen.findByLabelText(/ops entries/i), {
      target: { value: "Alex\nSteve" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save ops/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save player list" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_player_list", {
        input: {
          serverId: server.id,
          listType: "ops",
          entries: [{ name: "Alex" }, { name: "Steve" }],
        },
      });
    });
  });

  it("confirms before overwriting a player list", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "read_player_lists") {
        return {
          serverId: server.id,
          lists: [
            {
              listType: "whitelist",
              fileName: "whitelist.json",
              entries: [{ name: "Alex" }],
              error: null,
            },
          ],
        };
      }
      return {};
    });

    renderLists();
    fireEvent.change(await screen.findByLabelText(/whitelist entries/i), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save whitelist/i }));

    expect(invoke).not.toHaveBeenCalledWith("save_player_list", {
      input: {
        serverId: server.id,
        listType: "whitelist",
        entries: [],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save player list" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_player_list", {
        input: {
          serverId: server.id,
          listType: "whitelist",
          entries: [],
        },
      });
    });
  });
});

