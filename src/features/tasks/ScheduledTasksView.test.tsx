import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { ScheduledTasksView } from "./ScheduledTasksView";
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

function renderTasks() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ScheduledTasksView server={server} />
    </QueryClientProvider>,
  );
}

async function chooseAction(optionName: string) {
  await userEvent.click(await screen.findByLabelText(/action/i));
  await userEvent.click(
    await screen.findByRole("option", { name: optionName }),
  );
}

describe("ScheduledTasksView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the empty task state", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (
        command === "list_scheduled_tasks" ||
        command === "list_scheduled_task_runs"
      ) {
        return [];
      }
      return null;
    });

    renderTasks();

    expect(await screen.findByText("No scheduled tasks")).toBeInTheDocument();
    expect(screen.getByLabelText("Scheduled tasks")).toHaveTextContent(
      "Tray-owned server automation",
    );
  });

  it("creates a scheduled task for the selected server", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (
        command === "list_scheduled_tasks" ||
        command === "list_scheduled_task_runs"
      ) {
        return [];
      }
      if (command === "create_scheduled_task") {
        return {};
      }
      return null;
    });

    renderTasks();
    fireEvent.change(await screen.findByLabelText(/task name/i), {
      target: { value: "Nightly restart" },
    });
    await chooseAction("Restart server");
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_scheduled_task", {
        input: {
          serverId: server.id,
          name: "Nightly restart",
          kind: "restart",
          intervalMinutes: 1440,
          command: null,
        },
      });
    });
  });

  it("passes stable target versions for scheduled server update checks", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (
        command === "list_scheduled_tasks" ||
        command === "list_scheduled_task_runs"
      ) {
        return [];
      }
      if (command === "create_scheduled_task") {
        return {};
      }
      return null;
    });

    renderTasks();
    fireEvent.change(await screen.findByLabelText(/task name/i), {
      target: { value: "Check stable update" },
    });
    await chooseAction("Server update check");
    fireEvent.change(screen.getByLabelText(/target minecraft version/i), {
      target: { value: "1.21.5" },
    });
    fireEvent.change(screen.getByLabelText(/target loader build/i), {
      target: { value: "125" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_scheduled_task", {
        input: {
          serverId: server.id,
          name: "Check stable update",
          kind: "server_update_check",
          intervalMinutes: 1440,
          command: "1.21.5 125",
        },
      });
    });
  });

  it("confirms before deleting a scheduled task", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_scheduled_tasks") {
        return [
          {
            id: "task-1",
            name: "Nightly restart",
            kind: "restart",
            intervalMinutes: 1440,
            command: null,
            enabled: 1,
            nextRunAt: "2026-07-02T00:00:00Z",
            lastRunAt: null,
          },
        ];
      }
      if (command === "list_scheduled_task_runs") {
        return [];
      }
      return {};
    });

    renderTasks();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(invoke).not.toHaveBeenCalledWith("delete_scheduled_task", {
      taskId: "task-1",
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete task" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_scheduled_task", {
        taskId: "task-1",
      });
    });
  });
});

