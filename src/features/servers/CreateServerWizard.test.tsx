import { cleanup, fireEvent, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSettingsProvider } from "../../i18n";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import { getDefaultServerRoot, listLoaderMinecraftVersions, listLoaderVersions } from "./api";
import * as provisioningApi from "./provisioningApi";
import {
  CreateServerWizard,
  type CreateServerWizardProgress,
} from "./CreateServerWizard";

vi.mock("../../lib/desktop-runtime", () => ({ invokeDesktopCommand: vi.fn() }));
vi.mock("./api", () => ({
  getDefaultServerRoot: vi.fn(),
  listLoaderMinecraftVersions: vi.fn(),
  listLoaderVersions: vi.fn(),
}));
vi.mock("./provisioningApi", async () => {
  const actual = await vi.importActual<typeof import("./provisioningApi")>(
    "./provisioningApi",
  );
  return {
    ...actual,
    planServerProvisioning: vi.fn(),
    planJavaRuntime: vi.fn(),
    installJavaRuntime: vi.fn(),
    createProvisioningJob: vi.fn(),
    runProvisioningJob: vi.fn(),
    retryProvisioningJob: vi.fn(),
    cancelProvisioningJob: vi.fn(),
    listRecoverableProvisioningJobs: vi.fn(),
  };
});
vi.mock("./CreateServerMarketplaceBrowser", () => ({
  CreateServerMarketplaceBrowser: ({ onSelect }: { onSelect: (value: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          provider: "Modrinth",
          projectId: "project-1",
          versionId: "version-1",
          title: "Marketplace Pack",
          versionName: "1.0.0",
          loaderType: "fabric",
          minecraftVersion: "1.21.4",
        })
      }
    >
      Select marketplace fixture
    </button>
  ),
}));

const sourcePlan = {
  source: { kind: "localModpackFile" as const, path: "C:/Packs/server.mrpack" },
  pack: { format: "modrinth", name: "Server Pack", versionId: "v1" },
  minecraftVersion: "1.21.4",
  loaderType: "fabric" as const,
  loaderVersion: "0.16.10",
  requiredJavaMajor: 21,
  warnings: [
    {
      code: "PACK_UNVERIFIED",
      message: "This pack is not marked as a dedicated server pack.",
      requiresAcknowledgement: true,
    },
  ],
  launchSpec: {
    executable: { kind: "java" as const },
    jvmArgs: ["-jar", "server.jar"],
    serverArgs: ["nogui"],
    workingDirectory: ".",
  },
};

function job(stage: provisioningApi.ProvisioningStage): provisioningApi.ProvisioningJob {
  return {
    id: "job-1",
    serverId: stage === "ready" ? "server-1" : null,
    stage,
    plan: {},
    progress: { completedStages: [], resumeStage: stage },
    stagingDir: "C:/Servers/.server-stage",
    targetDir: "C:/Servers/Server Pack",
    error: null,
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:01.000Z",
  };
}

function renderWizard(props: Partial<React.ComponentProps<typeof CreateServerWizard>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppSettingsProvider>
        <CreateServerWizard showHeading={false} {...props} />
      </AppSettingsProvider>
    </QueryClientProvider>,
  );
}

describe("CreateServerWizard unified provisioning flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invokeDesktopCommand).mockReset();
    vi.mocked(getDefaultServerRoot).mockResolvedValue("C:/Servers/Server Pack");
    vi.mocked(listLoaderMinecraftVersions).mockResolvedValue([
      { value: "1.21.4", label: "1.21.4", stable: true },
    ]);
    vi.mocked(listLoaderVersions).mockResolvedValue([
      { value: "0.16.10", label: "0.16.10", stable: true },
    ]);
    vi.mocked(provisioningApi.planServerProvisioning).mockResolvedValue(sourcePlan);
    vi.mocked(provisioningApi.planJavaRuntime).mockResolvedValue({
      action: "reuse",
      majorVersion: 21,
      runtime: { path: "C:/Java/bin/java.exe", majorVersion: 21 },
    });
    vi.mocked(provisioningApi.createProvisioningJob).mockResolvedValue(job("planned"));
    vi.mocked(provisioningApi.runProvisioningJob).mockResolvedValue(job("ready"));
    vi.mocked(provisioningApi.listRecoverableProvisioningJobs).mockResolvedValue([]);
  });

  afterEach(cleanup);

  it("publishes the initial wizard progress to its host", async () => {
    const onProgressChange = vi.fn();

    const { unmount } = renderWizard({ onProgressChange });

    await waitFor(() => expect(onProgressChange).toHaveBeenCalled());
    const progress = onProgressChange.mock.calls.find(
      ([value]) => value !== null,
    )?.[0] as CreateServerWizardProgress;
    expect(progress).toEqual(
      expect.objectContaining({
        currentStep: 0,
        steps: expect.any(Array),
      }),
    );
    expect(progress.steps).toHaveLength(6);
    expect(progress.steps.every(({ label }) => label.trim().length > 0)).toBe(true);
    expect(progress.steps.map(({ label }) => label)).toEqual([
      "Source",
      "Compatibility",
      "Java",
      "Server configuration",
      "Review and EULA",
      "Install and start",
    ]);

    unmount();
    expect(onProgressChange).toHaveBeenLastCalledWith(null);
  });

  it("does not render the step indicator inside the wizard body", () => {
    const { container } = renderWizard({ onProgressChange: vi.fn() });

    expect(container.querySelector(".create-server-panel .wizard-steps")).not.toBeInTheDocument();
  });

  it("publishes the next step after the user advances from source selection", async () => {
    const onProgressChange = vi.fn();
    vi.mocked(invokeDesktopCommand).mockResolvedValue({
      path: "C:/Packs/server.mrpack",
    });

    renderWizard({ onProgressChange });

    await waitFor(() => {
      expect(
        onProgressChange.mock.calls.some(
          ([value]) => (value as CreateServerWizardProgress | null)?.currentStep === 0,
        ),
      ).toBe(true);
    });
    await userEvent.click(screen.getByRole("button", { name: /open modpack file/i }));

    await waitFor(() => {
      const progress = onProgressChange.mock.calls
        .map(([value]) => value as CreateServerWizardProgress | null)
        .filter((value): value is CreateServerWizardProgress => value !== null)
        .at(-1);
      expect(progress?.currentStep).toBe(1);
    });
  });

  it("plans a selected local pack, enforces approvals, and creates a persisted job", async () => {
    const onCreated = vi.fn();
    const onLifecycleChange = vi.fn();
    vi.mocked(invokeDesktopCommand).mockResolvedValue({
      path: "C:/Packs/server.mrpack",
    });
    renderWizard({ onCreated, onLifecycleChange });

    await waitFor(() => expect(onLifecycleChange).toHaveBeenCalledWith("draft"));

    await userEvent.click(screen.getByRole("button", { name: /open modpack file/i }));
    expect(provisioningApi.planServerProvisioning).toHaveBeenCalledWith({
      prepareInstall: true,
      source: { kind: "localModpackFile", path: "C:/Packs/server.mrpack" },
    });
    expect(await screen.findByText("This pack is not marked as a dedicated server pack.")).toBeInTheDocument();

    const compatibilityNext = screen.getByRole("button", { name: "Next" });
    expect(compatibilityNext).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /accept this compatibility warning/i }));
    await userEvent.click(compatibilityNext);

    expect(await screen.findByText(/Java 21/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    await userEvent.clear(screen.getByLabelText("Max memory MB"));
    await userEvent.type(screen.getByLabelText("Max memory MB"), "6144");
    await userEvent.clear(screen.getByLabelText("Message of the day"));
    await userEvent.type(screen.getByLabelText("Message of the day"), "Pack server");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    const eula = screen.getByRole("checkbox", { name: /I accept the Minecraft EULA/i });
    expect(eula).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Install and start" })).toBeDisabled();
    await userEvent.click(eula);
    await userEvent.click(screen.getByRole("button", { name: "Install and start" }));

    await waitFor(() => expect(provisioningApi.createProvisioningJob).toHaveBeenCalled());
    expect(provisioningApi.createProvisioningJob).toHaveBeenCalledWith(
      expect.objectContaining({
        targetDir: "C:/Servers/Server Pack",
        acknowledgedWarningCodes: ["PACK_UNVERIFIED"],
        eula: expect.objectContaining({ accepted: true }),
        configuration: expect.objectContaining({ maxMemoryMb: 6144, motd: "Pack server" }),
      }),
    );
    expect(provisioningApi.runProvisioningJob).toHaveBeenCalledWith("job-1");
    expect(await screen.findByText("Server is ready")).toBeInTheDocument();
    expect(onLifecycleChange.mock.calls.map(([value]) => value)).toEqual(
      expect.arrayContaining(["draft", "running", "complete"]),
    );
    expect(onLifecycleChange).toHaveBeenLastCalledWith("complete");
    expect(onCreated).toHaveBeenCalled();
  });

  it("uses the identical planning path for a dropped pack and rejects multiple files", async () => {
    renderWizard();
    const dropZone = screen.getByTestId("server-pack-drop-zone");
    const first = new File(["pack"], "server.mrpack");
    Object.defineProperty(first, "path", { value: "C:/Packs/server.mrpack" });
    fireEvent.drop(dropZone, { dataTransfer: { files: [first] } });
    await waitFor(() =>
      expect(provisioningApi.planServerProvisioning).toHaveBeenCalledWith({
        prepareInstall: true,
        source: { kind: "localModpackFile", path: "C:/Packs/server.mrpack" },
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    const second = new File(["pack"], "other.zip");
    Object.defineProperty(second, "path", { value: "C:/Packs/other.zip" });
    fireEvent.drop(screen.getByTestId("server-pack-drop-zone"), {
      dataTransfer: { files: [first, second] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Drop one server pack at a time.",
    );
  });

  it("passes the user-entered name through the blank-server planning path", async () => {
    renderWizard();
    await userEvent.click(screen.getByRole("button", { name: "New blank server" }));
    await userEvent.type(screen.getByLabelText("Name"), "Quilt Realm");
    await userEvent.selectOptions(screen.getByLabelText("Minecraft version"), "1.21.4");
    await waitFor(() => expect(listLoaderVersions).toHaveBeenCalledWith("paper", "1.21.4"));
    await userEvent.selectOptions(screen.getByLabelText("Loader version"), "0.16.10");
    await userEvent.click(screen.getByRole("button", { name: "Analyze source" }));

    expect(provisioningApi.planServerProvisioning).toHaveBeenCalledWith({
      source: { kind: "blank" },
      name: "Quilt Realm",
      loaderType: "paper",
      minecraftVersion: "1.21.4",
      loaderVersion: "0.16.10",
      prepareInstall: true,
    });
  });

  it("routes existing folders and marketplace packs through the same planner", async () => {
    vi.mocked(invokeDesktopCommand).mockResolvedValueOnce({ path: "C:/Servers/Existing" });
    renderWizard();
    await userEvent.click(screen.getByRole("button", { name: "Import existing folder" }));
    expect(provisioningApi.planServerProvisioning).toHaveBeenCalledWith({
      source: { kind: "existingFolder" },
      rootDir: "C:/Servers/Existing",
      prepareInstall: true,
    });

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByRole("button", { name: "Browse marketplace" }));
    await userEvent.click(screen.getByRole("button", { name: "Select marketplace fixture" }));
    expect(provisioningApi.planServerProvisioning).toHaveBeenLastCalledWith({
      source: {
        kind: "marketplaceModpack",
        provider: "Modrinth",
        projectId: "project-1",
        versionId: "version-1",
      },
      loaderType: "fabric",
      minecraftVersion: "1.21.4",
      loaderVersion: undefined,
      prepareInstall: true,
    });
  });

  it("warns for unverified archives but allows an explicit compatible runtime selection", async () => {
    const unverifiedPlan = {
      source: { kind: "localModpackFile" as const, path: "C:/Packs/unknown.zip" },
      pack: { format: "generic-zip", name: "Unknown Pack" },
      minecraftVersion: null,
      loaderType: null,
      loaderVersion: null,
      requiredJavaMajor: null,
      warnings: [
        {
          code: "PACK_UNVERIFIED",
          message: "This archive is not verified as a dedicated server pack.",
          requiresAcknowledgement: true,
        },
      ],
    };
    vi.mocked(invokeDesktopCommand).mockResolvedValue({ path: "C:/Packs/unknown.zip" });
    vi.mocked(provisioningApi.planServerProvisioning)
      .mockResolvedValueOnce(unverifiedPlan)
      .mockResolvedValueOnce(sourcePlan);
    renderWizard();

    await userEvent.click(screen.getByRole("button", { name: /open modpack file/i }));
    expect(await screen.findByText(/does not contain enough trusted server metadata/i)).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /accept this compatibility warning/i }));
    expect(next).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Minecraft version"), "1.21.4");
    await userEvent.click(screen.getByRole("button", { name: "Prepare server runtime" }));

    expect(provisioningApi.planServerProvisioning).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: { kind: "localModpackFile", path: "C:/Packs/unknown.zip" },
        loaderType: "paper",
        minecraftVersion: "1.21.4",
        prepareInstall: true,
      }),
    );
    expect(await screen.findByText("This pack is not marked as a dedicated server pack.")).toBeInTheDocument();
  });

  it("requires explicit consent before installing a managed Java runtime", async () => {
    vi.mocked(invokeDesktopCommand).mockResolvedValue({ path: "C:/Packs/server.mrpack" });
    vi.mocked(provisioningApi.planJavaRuntime).mockResolvedValue({
      action: "install",
      majorVersion: 21,
      vendor: "Eclipse Temurin",
      licenseUrl: "https://openjdk.org/legal/gplv2+ce.html",
    });
    vi.mocked(provisioningApi.installJavaRuntime).mockResolvedValue({
      path: "C:/ManagedJava/bin/java.exe",
      majorVersion: 21,
    });
    renderWizard();
    await userEvent.click(screen.getByRole("button", { name: /open modpack file/i }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /accept this compatibility warning/i }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    const install = await screen.findByRole("button", { name: "Install Java 21" });
    expect(install).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /allow the app to download/i }));
    await userEvent.click(install);
    expect(provisioningApi.installJavaRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ action: "install" }),
      true,
    );
  });

  it("recovers a persisted failed job and retries it without creating another job", async () => {
    const onLifecycleChange = vi.fn();
    const failed = {
      ...job("failed"),
      error: {
        code: "DOWNLOAD_FAILED",
        stage: "downloading",
        message: "Download interrupted",
        detail: null,
        retryable: true,
        cleanupRequired: true,
      },
    };
    vi.mocked(provisioningApi.listRecoverableProvisioningJobs).mockResolvedValue([failed]);
    vi.mocked(provisioningApi.retryProvisioningJob).mockResolvedValue(job("ready"));
    renderWizard({ onLifecycleChange });

    expect(await screen.findByRole("alert")).toHaveTextContent("Download interrupted");
    expect(onLifecycleChange).toHaveBeenCalledWith("running");
    await userEvent.click(screen.getByRole("button", { name: "Retry installation" }));
    expect(provisioningApi.retryProvisioningJob).toHaveBeenCalledWith("job-1");
    await waitFor(() =>
      expect(onLifecycleChange).toHaveBeenLastCalledWith("complete"),
    );
    expect(provisioningApi.createProvisioningJob).not.toHaveBeenCalled();
  });
});
