import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeDesktopCommand as invoke } from "../../lib/desktop-runtime";
import { ScheduledTasksView } from "./ScheduledTasksView";
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

/* The editor is a composer now: the list is what the panel shows first. */
async function openComposer() {
  fireEvent.click(await screen.findByRole("button", { name: "New task" }));
}

async function chooseAction(optionName: string) {
  await userEvent.click(
    await screen.findByRole("combobox", { name: /action/i }),
  );
  await userEvent.click(
    await screen.findByRole("option", { name: optionName }),
  );
}

describe("ScheduledTasksView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    localStorage.clear();
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
    await openComposer();
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
          scheduleKind: "interval",
          intervalMinutes: 1440,
          timeOfDay: null,
          weekdays: [],
          command: null,
          backupProfileId: null,
        },
      });
    });
  });

  it("creates a weekly backup task with the selected backup profile", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (
        command === "list_scheduled_tasks" ||
        command === "list_scheduled_task_runs"
      ) {
        return [];
      }
      if (command === "list_backup_profiles") {
        return [{ id: "profile-1", name: "Full server" }];
      }
      if (command === "create_scheduled_task") {
        return {};
      }
      return null;
    });

    renderTasks();
    await openComposer();
    fireEvent.change(await screen.findByLabelText(/task name/i), {
      target: { value: "Weekly full backup" },
    });
    await userEvent.click(screen.getByRole("combobox", { name: "Schedule" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "Weekly at a set time" }),
    );
    fireEvent.change(screen.getByLabelText("Local time"), {
      target: { value: "02:30" },
    });
    await userEvent.click(
      screen.getByRole("combobox", { name: "Backup profile" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Full server" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_scheduled_task", {
        input: {
          serverId: server.id,
          name: "Weekly full backup",
          kind: "world_backup",
          scheduleKind: "weekly",
          intervalMinutes: 1440,
          timeOfDay: "02:30",
          weekdays: [1, 2, 3, 4, 5],
          command: null,
          backupProfileId: "profile-1",
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
            scheduleKind: "interval",
            intervalMinutes: 1440,
            timeOfDay: null,
            weekdays: [],
            command: null,
            backupProfileId: null,
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
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Nightly restart" }),
    );
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

  it("shows retryable query errors without a contradictory empty state", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_scheduled_tasks") {
        throw new Error("Task list unavailable");
      }
      if (command === "list_scheduled_task_runs") {
        return [];
      }
      return null;
    });

    renderTasks();

    expect(
      await screen.findByText("Task list unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No scheduled tasks")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("reports recent-run failures and localizes their status", async () => {
    localStorage.setItem("mcsm.language", "zh-CN");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "list_scheduled_tasks") {
        return [];
      }
      if (command === "list_scheduled_task_runs") {
        return [
          {
            id: "run-1",
            taskId: "task-1",
            status: "failed",
            message: "Backup failed",
            scheduledFor: "2026-07-01T00:00:00Z",
            startedAt: "2026-07-01T00:00:00Z",
          },
        ];
      }
      return null;
    });

    renderTasks();

    expect(await screen.findByText("失败")).toBeInTheDocument();
    expect(screen.queryByText("failed")).not.toBeInTheDocument();
  });
});
