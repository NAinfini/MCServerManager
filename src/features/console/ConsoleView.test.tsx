import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { ServerRuntimeProvider } from "../servers/ServerRuntimeContext";
import { colorizeConsoleLine, ConsoleView } from "./ConsoleView";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

const { terminalLines } = vi.hoisted(() => ({
  terminalLines: [] as string[],
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class Terminal {
    loadAddon() {}
    open() {}
    clear() {}
    dispose() {}
    writeln(line: string) {
      terminalLines.push(line);
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddon {
    fit() {}
  },
}));

// The label holds a decorative "/" that only the accessible name leaves out.
const commandInput = () => screen.findByRole("textbox", { name: "Command" });

function mockRunningServer() {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "list_process_events") return [];
    if (command === "get_server_process_status") return { status: "running" };
    return null;
  });
}

function openQuickCommands() {
  const menu = screen
    .getByText("Quick commands")
    .closest("details") as HTMLDetailsElement;
  menu.open = true;
  return menu;
}

function renderConsole() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServerRuntimeProvider serverId="server-1">
        <ConsoleView serverId="server-1" />
      </ServerRuntimeProvider>
    </QueryClientProvider>,
  );
}

describe("ConsoleView", () => {
  beforeEach(() => {
    terminalLines.length = 0;
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_process_events") return [];
      if (command === "get_server_process_status") return null;
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("disables command sending while the server is stopped", async () => {
    renderConsole();

    const input = await commandInput();
    // The hint moved from a line under the form into the placeholder.
    await waitFor(() =>
      expect(input).toHaveAttribute(
        "placeholder",
        expect.stringMatching(
          /start the server before sending console commands/i,
        ),
      ),
    );

    await userEvent.type(input, "say hello");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
    });
    expect(invoke).not.toHaveBeenCalledWith(
      "send_server_command",
      expect.anything(),
    );
  });

  it("fills the command input from the quick command menu before sending", async () => {
    mockRunningServer();
    renderConsole();

    const input = await commandInput();
    const menu = openQuickCommands();

    await userEvent.click(screen.getByRole("button", { name: /save world/i }));
    expect(input).toHaveValue("save-all flush");
    // It fills, and never runs: a command only goes out on a deliberate Send.
    expect(invoke).not.toHaveBeenCalledWith(
      "send_server_command",
      expect.anything(),
    );
    expect(menu.open).toBe(false);
    expect(input).toHaveFocus();

    const send = screen.getByRole("button", { name: /^send$/i });
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("send_server_command", {
        serverId: "server-1",
        command: "save-all flush",
      });
    });
  });

  it("leaves the cursor after a quick command that needs an argument", async () => {
    mockRunningServer();
    renderConsole();

    const input = await commandInput();
    openQuickCommands();
    await userEvent.click(screen.getByTitle("ban"));

    expect(input).toHaveValue("ban ");
    expect(input).toHaveFocus();
  });

  it("shows the built-in command source and accepts a suggestion with Tab", async () => {
    mockRunningServer();
    renderConsole();

    const input = await commandInput();
    await userEvent.type(input, "/wh");

    expect(screen.getByText(/built-in command catalog/i)).toBeInTheDocument();
    await userEvent.keyboard("{Tab}");
    expect(input).toHaveValue("/whitelist");
  });

  it("copies the visible events oldest first from the icon button", async () => {
    userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_process_events") {
        return [
          { id: "2", level: "error", message: "newest" },
          { id: "1", level: "info", message: "oldest" },
        ];
      }
      return null;
    });
    renderConsole();

    const copy = screen.getByRole("button", { name: "Copy" });
    await waitFor(() => expect(copy).toBeEnabled());
    await userEvent.click(copy);

    expect(writeText).toHaveBeenCalledWith("[info] oldest\n[error] newest");
    writeText.mockRestore();
  });

  it("disables copy with nothing to copy and keeps clear available", async () => {
    renderConsole();

    await commandInput();
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled();
  });

  it("writes colorized lines into the terminal", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_process_events") {
        return [
          {
            id: "1",
            level: "error",
            message: "Server process crashed.",
          },
        ];
      }
      return null;
    });
    renderConsole();

    await waitFor(() =>
      expect(terminalLines).toContain(
        colorizeConsoleLine("error", "Server process crashed."),
      ),
    );
  });
});

describe("colorizeConsoleLine", () => {
  const colorOf = (level: string, message: string) => {
    const line = colorizeConsoleLine(level, message);
    return line === message ? null : line.slice(0, line.indexOf("m") + 1);
  };

  it("colors by severity from the event level or the log prefix", () => {
    const error = colorOf("error", "boom");
    const warning = colorOf("warning", "careful");
    expect(error).not.toBeNull();
    expect(warning).not.toBeNull();
    expect(error).not.toBe(warning);
    expect(colorOf("info", "[12:00:00] [Server thread/ERROR]: boom")).toBe(
      error,
    );
    expect(colorOf("info", "[12:00:00] [Server thread/FATAL]: boom")).toBe(
      error,
    );
    expect(colorOf("info", "[12:00:00] [Server thread/WARN]: careful")).toBe(
      warning,
    );
  });

  it("gives joins, lifecycle lines and routine log lines their own colors", () => {
    const join = colorOf("info", "[Server thread/INFO]: Alex joined the game");
    expect(join).not.toBeNull();
    expect(colorOf("info", "[Server thread/INFO]: Alex left the game")).toBe(
      join,
    );
    const lifecycle = colorOf("info", "Stop requested.");
    expect(lifecycle).not.toBeNull();
    expect(colorOf("info", "> say hello")).toBe(lifecycle);
    const quiet = colorOf("info", "[Server thread/INFO]: Saving chunks");
    expect(quiet).not.toBeNull();
    expect(new Set([join, lifecycle, quiet]).size).toBe(3);
  });

  it("leaves chat and unknown lines uncolored so players can read them", () => {
    expect(
      colorizeConsoleLine(
        "info",
        "[Server thread/INFO]: <Alex> the ERROR/WARN joined the game",
      ),
    ).toBe("[Server thread/INFO]: <Alex> the ERROR/WARN joined the game");
    expect(
      colorizeConsoleLine("info", "[Server thread/INFO]: [Not Secure] <Alex> hi"),
    ).toBe("[Server thread/INFO]: [Not Secure] <Alex> hi");
    expect(colorizeConsoleLine("info", "plain text")).toBe("plain text");
  });

  it("resets the color at the end of a colored line", () => {
    expect(colorizeConsoleLine("error", "boom").endsWith("\u001b[0m")).toBe(
      true,
    );
  });
});
