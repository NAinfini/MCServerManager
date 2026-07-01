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
      raw: "motd=Hello",
      entries: [
        { key: "motd", value: "Hello", known: true },
        { key: "server-port", value: "25565", known: true },
      ],
    });

    renderEditor();

    expect(await screen.findByDisplayValue("Hello")).toBeInTheDocument();
    expect(screen.getByDisplayValue("25565")).toBeInTheDocument();
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
      return {};
    });

    renderEditor();
    fireEvent.change(await screen.findByDisplayValue("Hello"), {
      target: { value: "Updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save properties/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_server_properties", {
        input: expect.objectContaining({
          serverId: server.id,
          updates: expect.arrayContaining([
            expect.objectContaining({ key: "motd", value: "Updated" }),
          ]),
        }),
      });
    });
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

