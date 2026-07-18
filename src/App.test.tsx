import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const appState = vi.hoisted(() => ({ shellShouldThrow: false }));

vi.mock("./components/layout/AppShell", () => ({
  AppShell: () => {
    if (appState.shellShouldThrow) throw new Error("shell render failed");
    return <main>Application shell</main>;
  },
}));

const invokeDesktopCommand = vi.hoisted(() => vi.fn());
vi.mock("./lib/desktop-runtime", () => ({
  invokeDesktopCommand,
  isDesktopRuntimeAvailable: vi.fn(() => false),
  onDesktopCloseRequested: vi.fn(),
  runDesktopWindowAction: vi.fn(),
}));

describe("App", () => {
  beforeEach(() => {
    appState.shellShouldThrow = false;
    invokeDesktopCommand.mockReset();
    invokeDesktopCommand.mockImplementation(async (command: string) => {
      if (command === "get_process_summary") {
        return { runningCount: 0, crashedCount: 0 };
      }
      if (command === "list_recoverable_provisioning_jobs") return [];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a visible failure state instead of a white screen", async () => {
    appState.shellShouldThrow = true;
    render(<App />);

    expect(screen.getByRole("alert")).toHaveTextContent("shell render failed");
    expect(
      screen.getByRole("heading", {
        name: "MC Server Manager could not render this view",
      }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByText("shell render failed")).toBeInTheDocument();
  });

  it("offers resume and cleanup for a persisted unfinished provisioning job", async () => {
    const unfinished = {
      id: "job-recovery",
      serverId: null,
      stage: "downloading",
      plan: {},
      progress: { completedStages: [], committed: false },
      stagingDir: "C:/Servers/.recovery-stage",
      targetDir: "C:/Servers/Recovery",
      error: null,
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T12:01:00.000Z",
    };
    invokeDesktopCommand.mockImplementation(async (command: string) => {
      if (command === "get_process_summary") {
        return { runningCount: 0, crashedCount: 0 };
      }
      if (command === "list_recoverable_provisioning_jobs") return [unfinished];
      if (command === "run_provisioning_job") {
        return { ...unfinished, stage: "ready", serverId: "server-1" };
      }
      if (command === "cancel_provisioning_job") {
        return { ...unfinished, stage: "failed" };
      }
      return null;
    });

    render(<App />);

    expect(await screen.findByRole("status")).toHaveTextContent("unfinished server installation");
    expect(screen.getByRole("button", { name: "Resume installation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clean up files" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clean up files" }));
    expect(invokeDesktopCommand).toHaveBeenCalledWith("cancel_provisioning_job", {
      input: { jobId: "job-recovery" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Resume installation" }));

    expect(invokeDesktopCommand).toHaveBeenCalledWith("run_provisioning_job", {
      input: { jobId: "job-recovery" },
    });
  });
});
