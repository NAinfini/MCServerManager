import { cleanup, render, screen } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSettingsProvider } from "../../i18n";
import { ProvisioningProgress } from "./ProvisioningProgress";
import type { ProvisioningJob } from "./provisioningApi";

const job: ProvisioningJob = {
  id: "job-1",
  serverId: null,
  stage: "installingLoader",
  plan: {},
  progress: {
    completedStages: ["downloading", "verifying", "extracting"],
    resumeStage: "installingLoader",
  },
  stagingDir: "C:/Servers/.test-stage",
  targetDir: "C:/Servers/Test",
  error: null,
  createdAt: "2026-07-18T12:00:00.000Z",
  updatedAt: "2026-07-18T12:01:00.000Z",
};

describe("ProvisioningProgress", () => {
  afterEach(cleanup);

  it("shows the persisted stage and allows safe cancellation before commit", async () => {
    const onCancel = vi.fn();
    render(
      <AppSettingsProvider>
        <ProvisioningProgress job={job} onCancel={onCancel} onRetry={vi.fn()} />
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "44");
    // The stage name appears twice: once as the heading subtitle, once in the
    // checklist that marks it as the running stage.
    expect(screen.getAllByText("Installing server loader")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Cancel installation" }));
    expect(onCancel).toHaveBeenCalledWith("job-1");
  });

  it("marks completed, running, and pending stages in the checklist", () => {
    render(
      <AppSettingsProvider>
        <ProvisioningProgress job={job} onCancel={vi.fn()} onRetry={vi.fn()} />
      </AppSettingsProvider>,
    );

    const states = Array.from(
      document.querySelectorAll(".provisioning-stage-item"),
    ).map((item) => item.getAttribute("data-state"));

    // downloading, verifying, extracting completed; installingRuntime precedes
    // the current stage so index ordering marks it done too.
    expect(states.slice(0, 4)).toEqual(["done", "done", "done", "done"]);
    expect(states[4]).toBe("current");
    expect(states.slice(5)).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("keeps failures visible and exposes retry only when retryable", async () => {
    const onRetry = vi.fn();
    render(
      <AppSettingsProvider>
        <ProvisioningProgress
          job={{
            ...job,
            stage: "failed",
            error: {
              code: "DOWNLOAD_FAILED",
              stage: "downloading",
              message: "Connection interrupted",
              detail: null,
              retryable: true,
              cleanupRequired: true,
            },
          }}
          onCancel={vi.fn()}
          onRetry={onRetry}
        />
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Connection interrupted");
    await userEvent.click(screen.getByRole("button", { name: "Retry installation" }));
    expect(onRetry).toHaveBeenCalledWith("job-1");
  });
});
