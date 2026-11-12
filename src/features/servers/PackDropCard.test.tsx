import { cleanup, render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSettingsProvider } from "../../i18n";
import { getDefaultServerRoot, suggestServerPort } from "./api";
import * as provisioningApi from "./provisioningApi";
import { PackDropCard } from "./PackDropCard";
import type { PackDetection } from "./packDetection";

vi.mock("./api", () => ({
  getDefaultServerRoot: vi.fn(),
  suggestServerPort: vi.fn(),
}));
vi.mock("./provisioningApi", async () => {
  const actual =
    await vi.importActual<typeof import("./provisioningApi")>(
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
    getProvisioningJob: vi.fn(),
  };
});

const detection: PackDetection = {
  kind: "serverPack",
  name: "Smooth Pack",
  root: "",
  loader: { type: "fabric", version: "0.18.0" },
  minecraftVersion: "26.2",
  modCount: 3,
  modCheck: { checked: 3, incompatible: 0 },
  memory: {
    maxMb: 4096,
    minMb: 1024,
    source: "recommended",
    statedSource: null,
    totalMb: 16384,
  },
  javaMajor: 25,
  port: null,
  clientOnlyMods: [
    { file: "mods/sodium.jar", name: "Sodium", declared: "fabric.mod.json" },
  ],
  disabledMods: ["mods/sodium.jar"],
  missing: [],
  unfetchable: [],
  warnings: [],
  evidence: [
    { field: "minecraftVersion", value: "26.2", source: "variables.txt" },
  ],
  sizeBytes: 3 * 1024 * 1024,
};

function sourcePlan(overrides: Record<string, unknown> = {}) {
  return {
    source: { kind: "localModpackFile" as const, path: "C:/Packs/pack.zip" },
    pack: { format: "generic", name: "Smooth Pack", versionId: null },
    minecraftVersion: "26.2",
    loaderType: "fabric" as const,
    loaderVersion: "0.18.0",
    requiredJavaMajor: 25,
    warnings: [
      {
        code: "PACK_VERSION_CONFLICT",
        message: "conflict",
        params: {
          chosen: "26.2",
          chosenSource: "variables.txt",
          others: [{ value: "1.17.1", source: "libraries/" }],
        },
        requiresAcknowledgement: true,
      },
      {
        code: "PACK_CLIENT_ONLY_MODS",
        message: "client",
        params: { count: 1, names: ["Sodium"] },
      },
    ],
    launchSpec: {
      executable: { kind: "java" as const },
      jvmArgs: ["-jar", "server.jar"],
      serverArgs: ["nogui"],
      workingDirectory: ".",
    },
    detection,
    ...overrides,
  };
}

function readyJob(): provisioningApi.ProvisioningJob {
  return {
    id: "job-1",
    serverId: "server-9",
    stage: "ready",
    plan: {},
    progress: { completedStages: [], resumeStage: null, committed: true },
    stagingDir: null,
    targetDir: "C:/Servers/Smooth Pack",
    error: null,
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:01.000Z",
  };
}

function renderCard(props: Partial<React.ComponentProps<typeof PackDropCard>> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onOpenWizard: vi.fn(),
    onCreated: vi.fn(),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AppSettingsProvider>
        <PackDropCard path="C:/Packs/pack.zip" {...handlers} {...props} />
      </AppSettingsProvider>
    </QueryClientProvider>,
  );
  return handlers;
}

describe("PackDropCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(suggestServerPort).mockResolvedValue({ port: 25566, taken: [25565] });
    vi.mocked(getDefaultServerRoot).mockResolvedValue("C:/Servers/Smooth Pack");
    vi.mocked(provisioningApi.planServerProvisioning).mockResolvedValue(
      sourcePlan() as never,
    );
    vi.mocked(provisioningApi.planJavaRuntime).mockResolvedValue({
      action: "reuse",
      majorVersion: 25,
      runtime: { path: "C:/Java/25/bin/java.exe", majorVersion: 25 },
    });
  });

  afterEach(() => cleanup());

  it("shows what was detected, its evidence and its warnings, and creates nothing yet", async () => {
    renderCard();

    expect(await screen.findByText("26.2")).toBeTruthy();
    expect(screen.getByText("Fabric 0.18.0")).toBeTruthy();
    expect(screen.getByText(/Recognised as a server pack/)).toBeTruthy();
    // The pack's own free port is not taken; the card moved to the suggested one.
    expect(screen.getByText("25566, free")).toBeTruthy();
    expect(screen.getByText("4 GB, recommended for 3 mods on this 16 GB machine")).toBeTruthy();
    expect(
      screen.getByText(/Using 26\.2 from variables\.txt; also found 1\.17\.1 \(libraries\/\)/),
    ).toBeTruthy();
    expect(screen.getByText(/1 mods only run on the client/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /End User License Agreement/ })).toBeTruthy();
    expect(provisioningApi.createProvisioningJob).not.toHaveBeenCalled();
  });

  it("writes the EULA acceptance only when Agree and start is pressed, then starts the server", async () => {
    vi.mocked(provisioningApi.createProvisioningJob).mockResolvedValue(
      readyJob(),
    );
    vi.mocked(provisioningApi.runProvisioningJob).mockResolvedValue(readyJob());
    const { onCreated } = renderCard();
    const user = userEvent.setup();

    await screen.findByText("26.2");
    expect(provisioningApi.createProvisioningJob).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Agree and start" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("server-9"));
    const sent = vi.mocked(provisioningApi.createProvisioningJob).mock
      .calls[0][0];
    expect(sent.eula.accepted).toBe(true);
    expect(sent.eula.termsUrl).toBe("https://aka.ms/MinecraftEULA");
    expect(sent.profile).toMatchObject({
      minecraftVersion: "26.2",
      loaderType: "fabric",
      startAfterInstall: true,
    });
    expect(sent.configuration).toMatchObject({
      serverPort: 25566,
      maxMemoryMb: 4096,
    });
    expect(sent.acknowledgedWarningCodes).toEqual(["PACK_VERSION_CONFLICT"]);
    expect(provisioningApi.runProvisioningJob).toHaveBeenCalledWith("job-1");
  });

  it("does not accept the EULA when closed without agreeing", async () => {
    const { onClose } = renderCard();
    const user = userEvent.setup();
    await screen.findByText("26.2");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(provisioningApi.createProvisioningJob).not.toHaveBeenCalled();
    expect(provisioningApi.installJavaRuntime).not.toHaveBeenCalled();
  });

  it("edits the port inline and rejects a value outside the range", async () => {
    vi.mocked(provisioningApi.createProvisioningJob).mockResolvedValue(
      readyJob(),
    );
    vi.mocked(provisioningApi.runProvisioningJob).mockResolvedValue(readyJob());
    renderCard();
    const user = userEvent.setup();
    await screen.findByText("26.2");

    await user.click(screen.getByRole("button", { name: "Change: Port" }));
    const input = screen.getByRole("textbox", { name: "Port" });
    await user.clear(input);
    await user.type(input, "80");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/1024 to 65535/);

    await user.clear(input);
    await user.type(input, "25570{Enter}");
    expect(await screen.findByText("25570, your choice")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Agree and start" }));
    await waitFor(() =>
      expect(provisioningApi.createProvisioningJob).toHaveBeenCalled(),
    );
    expect(
      vi.mocked(provisioningApi.createProvisioningJob).mock.calls[0][0]
        .configuration.serverPort,
    ).toBe(25570);
  });

  it("re-plans with the edited Minecraft version and clears the stale loader version", async () => {
    renderCard();
    const user = userEvent.setup();
    await screen.findByText("26.2");

    await user.click(screen.getByRole("button", { name: "Change: Minecraft" }));
    const input = screen.getByRole("textbox", { name: "Minecraft" });
    await user.clear(input);
    await user.type(input, "26.1{Enter}");

    await waitFor(() =>
      expect(provisioningApi.planServerProvisioning).toHaveBeenLastCalledWith(
        expect.objectContaining({
          minecraftVersion: "26.1",
          loaderType: "fabric",
          loaderVersion: undefined,
        }),
      ),
    );
  });

  it("blocks a client pack with unfetchable mods and says what to do", async () => {
    vi.mocked(provisioningApi.planServerProvisioning).mockResolvedValue(
      sourcePlan({
        detection: {
          ...detection,
          kind: "clientPack",
          missing: ["serverFiles"],
          unfetchable: [
            { provider: "curseforge", projectId: "111", fileId: "2", reason: "noApiKey" },
          ],
        },
        warnings: [],
      }) as never,
    );
    const { onOpenWizard } = renderCard();
    const user = userEvent.setup();

    expect(await screen.findByText(/CurseForge project 111, file 2/)).toBeTruthy();
    expect(screen.getByText(/Recognised as a client pack/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agree and start" })).toBeNull();
    expect(screen.queryByText(/End User License Agreement/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open guided setup" }));
    expect(onOpenWizard).toHaveBeenCalledWith("C:/Packs/pack.zip");
  });

  it("explains a read failure and offers the guided setup", async () => {
    vi.mocked(provisioningApi.planServerProvisioning).mockRejectedValue(
      new Error("Archive entry has an unsafe path: ../x"),
    );
    renderCard();
    expect(await screen.findByText(/unsafe path/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open guided setup" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agree and start" })).toBeNull();
  });
});
