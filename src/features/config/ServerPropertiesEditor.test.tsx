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
import {
  filterPropertyGroups,
  serverPropertiesDefaultValues,
  ServerPropertiesEditor,
} from "./ServerPropertiesEditor";
import type { ServerProfile } from "../../domain/server";

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
    ...render(
      <QueryClientProvider client={queryClient}>
        <ServerPropertiesEditor server={server} />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

describe("ServerPropertiesEditor", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lets users retry when properties fail to load", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("properties unavailable"));

    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(
            ([command]) => command === "read_server_properties",
          ),
      ).toHaveLength(2);
    });
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
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "gamemode" }),
      ).toHaveTextContent("survival");
      expect(
        screen.getByRole("combobox", { name: "difficulty" }),
      ).toHaveTextContent("hard");
    });
    expect(screen.getByDisplayValue("20")).toBeInTheDocument();
    expect(screen.getByDisplayValue("12")).toBeInTheDocument();
    expect(screen.getByDisplayValue("8")).toBeInTheDocument();
    expect(screen.getByText("Basic gameplay")).toBeInTheDocument();
    expect(screen.getByText("Network & remote access")).toBeInTheDocument();
  });

  it("filters property groups by a property key", () => {
    expect(filterPropertyGroups("rcon")).toEqual([
      expect.objectContaining({
        group: "network",
        definitions: expect.arrayContaining([
          expect.objectContaining({ key: "enable-rcon" }),
          expect.objectContaining({ key: "rcon.port" }),
        ]),
      }),
    ]);
  });

  it("maps known document entries into typed form values", () => {
    expect(
      serverPropertiesDefaultValues([
        { key: "gamemode", value: "survival", known: true },
        { key: "difficulty", value: "hard", known: true },
      ]),
    ).toMatchObject({ gamemode: "survival", difficulty: "hard" });
  });

  it("does not treat a missing properties file as an error", async () => {
    vi.mocked(invoke).mockResolvedValue({
      serverId: server.id,
      raw: "",
      entries: [],
    });

    renderEditor();

    expect(
      await screen.findByText("No server.properties file yet"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

  it("validates ports before saving", async () => {
    vi.mocked(invoke).mockResolvedValue({
      serverId: server.id,
      raw: "server-port=25565",
      entries: [{ key: "server-port", value: "25565", known: true }],
    });

    renderEditor();
    fireEvent.change(await screen.findByDisplayValue("25565"), {
      target: { value: "70000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save properties/i }));

    expect(
      await screen.findByText("Enter a port from 1 to 65535"),
    ).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith(
      "save_server_properties",
      expect.anything(),
    );
  });
});
