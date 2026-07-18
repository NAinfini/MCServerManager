import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "../../test/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { ServerPropertiesEditor } from "./ServerPropertiesEditor";
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

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ServerPropertiesEditor server={server} />
      </QueryClientProvider>,
    ),
  };
}

describe("ServerPropertiesEditor", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders common server properties", async () => {
    vi.mocked(invoke).mockResolvedValue({
      serverId: server.id,
      raw: "motd=Hello\ngamemode=survival\ndifficulty=hard\nmax-players=20\nonline-mode=true\npvp=true\nwhite-list=false\nview-distance=12\nsimulation-distance=8\ncustom-pack-setting=keep\n",
      entries: [
        { key: "motd", value: "Hello", known: true },
        { key: "server-port", value: "25565", known: true },
        { key: "gamemode", value: "survival", known: true },
        { key: "difficulty", value: "hard", known: true },
        { key: "max-players", value: "20", known: true },
        { key: "online-mode", value: "true", known: true },
        { key: "pvp", value: "true", known: true },
        { key: "white-list", value: "false", known: true },
        { key: "view-distance", value: "12", known: true },
        { key: "simulation-distance", value: "8", known: true },
        { key: "custom-pack-setting", value: "keep", known: false },
      ],
    });

    renderEditor();

    expect(await screen.findByDisplayValue("Hello")).toBeInTheDocument();
    expect(screen.getByDisplayValue("25565")).toBeInTheDocument();
    expect(screen.getByDisplayValue("survival")).toBeInTheDocument();
    expect(screen.getByDisplayValue("hard")).toBeInTheDocument();
    expect(screen.getByDisplayValue("20")).toBeInTheDocument();
    expect(screen.getByDisplayValue("12")).toBeInTheDocument();
    expect(screen.getByDisplayValue("8")).toBeInTheDocument();
  });

  it("saves edited properties for the selected server", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "read_server_properties") {
        return {
          serverId: server.id,
          raw: "motd=Hello",
          entries: [
            { key: "motd", value: "Hello", known: true },
            { key: "server-port", value: "25565", known: true },
          ],
        };
      }
      return {
        serverId: server.id,
        raw: "motd=Updated\nserver-port=25565\ncustom-pack-setting=keep\n",
        entries: [
          { key: "motd", value: "Updated", known: true },
          { key: "server-port", value: "25565", known: true },
          { key: "custom-pack-setting", value: "keep", known: false },
        ],
        restartRequired: true,
      };
    });

    renderEditor();
    fireEvent.change(await screen.findByDisplayValue("Hello"), {
      target: { value: "Updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save properties/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_server_properties", {
        input: {
          serverId: server.id,
          updates: [{ key: "motd", value: "Updated", known: true }],
        },
      });
    });
    expect(await screen.findByText(/restart.*required/i)).toBeInTheDocument();
  });

  it("keeps local edits when server properties refetch", async () => {
    vi.mocked(invoke).mockResolvedValue({
      serverId: server.id,
      raw: "motd=Hello",
      entries: [
        { key: "motd", value: "Hello", known: true },
        { key: "server-port", value: "25565", known: true },
      ],
    });

    const { queryClient } = renderEditor();
    fireEvent.change(await screen.findByDisplayValue("Hello"), {
      target: { value: "Unsaved" },
    });
    act(() => {
      queryClient.setQueryData(["serverProperties", server.id], {
        serverId: server.id,
        raw: "motd=Remote",
        entries: [
          { key: "motd", value: "Remote", known: true },
          { key: "server-port", value: "25565", known: true },
        ],
      });
    });

    expect(screen.getByDisplayValue("Unsaved")).toBeInTheDocument();
  });
});

