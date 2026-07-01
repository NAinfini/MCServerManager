import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { ConsoleView } from "./ConsoleView";

vi.mock("../../lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class Terminal {
    open() {}
    clear() {}
    dispose() {}
    writeln() {}
  },
}));

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
      <ConsoleView serverId="server-1" />
    </QueryClientProvider>,
  );
}

describe("ConsoleView", () => {
  beforeEach(() => {
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

    await userEvent.type(
      await screen.findByLabelText(/command/i),
      "say hello",
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    });
    expect(
      screen.getByText(/start the server before sending console commands/i),
    ).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("send_server_command", expect.anything());
  });

  it("fills the command input from a template before sending", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_process_events") return [];
      if (command === "get_server_process_status") return { status: "running" };
      return null;
    });

    renderConsole();

    await userEvent.click(await screen.findByRole("button", { name: /save world/i }));
    expect(screen.getByLabelText(/command/i)).toHaveValue("save-all flush");

    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("send_server_command", {
        serverId: "server-1",
        command: "save-all flush",
      });
    });
  });
});

