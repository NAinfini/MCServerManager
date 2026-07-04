import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

describe("Electron application updater", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ELECTRON_ENABLE_DEV_UPDATES;
  });

  it("checks GitHub Releases and reports available updates", async () => {
    const { createApplicationUpdater } = require("./app-updater.cjs");
    const autoUpdater = new EventEmitter();
    autoUpdater.checkForUpdates = vi.fn(async () => {
      autoUpdater.emit("update-available", {
        version: "0.1.1",
        releaseDate: "2026-07-03T00:00:00.000Z",
        releaseNotes: "Fixes",
      });
    });
    autoUpdater.removeListener = autoUpdater.off.bind(autoUpdater);
    const updater = createApplicationUpdater({
      app: {
        getVersion: () => "0.1.0",
        isPackaged: true,
      },
      autoUpdater,
    });

    const status = await updater.checkForApplicationUpdate({
      input: { channel: "stable" },
    });

    expect(autoUpdater.autoDownload).toBe(false);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({
      currentVersion: "0.1.0",
      latestVersion: "0.1.1",
      updateAvailable: true,
      installerEnabled: true,
    });
  });

  it("downloads and installs an available GitHub Release update", async () => {
    const { createApplicationUpdater } = require("./app-updater.cjs");
    const autoUpdater = new EventEmitter();
    autoUpdater.checkForUpdates = vi.fn(async () => {
      autoUpdater.emit("update-available", { version: "0.1.1" });
    });
    autoUpdater.downloadUpdate = vi.fn(async () => ["installer.exe"]);
    autoUpdater.quitAndInstall = vi.fn();
    autoUpdater.removeListener = autoUpdater.off.bind(autoUpdater);
    const updater = createApplicationUpdater({
      app: {
        getVersion: () => "0.1.0",
        isPackaged: true,
      },
      autoUpdater,
      setQuitting: vi.fn(),
    });

    await updater.installApplicationUpdate({ input: { channel: "stable" } });

    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("blocks installing an app update while servers are running", async () => {
    const { createApplicationUpdater } = require("./app-updater.cjs");
    const autoUpdater = new EventEmitter();
    autoUpdater.checkForUpdates = vi.fn(async () => {
      autoUpdater.emit("update-available", { version: "0.1.1" });
    });
    autoUpdater.downloadUpdate = vi.fn(async () => ["installer.exe"]);
    autoUpdater.quitAndInstall = vi.fn();
    autoUpdater.removeListener = autoUpdater.off.bind(autoUpdater);
    const updater = createApplicationUpdater({
      app: {
        getVersion: () => "0.1.0",
        isPackaged: true,
      },
      autoUpdater,
      getRunningServerCount: async () => 2,
    });

    const status = await updater.checkForApplicationUpdate({
      input: { channel: "stable" },
    });

    expect(status).toMatchObject({
      updateAvailable: true,
      installerEnabled: false,
      installBlockedByRunningServers: true,
      runningServerCount: 2,
    });
    await expect(
      updater.installApplicationUpdate({ input: { channel: "stable" } }),
    ).rejects.toThrow("2 running server");
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("rechecks running servers after download before installing", async () => {
    const { createApplicationUpdater } = require("./app-updater.cjs");
    const autoUpdater = new EventEmitter();
    const getRunningServerCount = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    autoUpdater.checkForUpdates = vi.fn(async () => {
      autoUpdater.emit("update-available", { version: "0.1.1" });
    });
    autoUpdater.downloadUpdate = vi.fn(async () => ["installer.exe"]);
    autoUpdater.quitAndInstall = vi.fn();
    autoUpdater.removeListener = autoUpdater.off.bind(autoUpdater);
    const updater = createApplicationUpdater({
      app: {
        getVersion: () => "0.1.0",
        isPackaged: true,
      },
      autoUpdater,
      getRunningServerCount,
    });

    await expect(
      updater.installApplicationUpdate({ input: { channel: "stable" } }),
    ).rejects.toThrow("1 running server");

    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("blocks update checks in unpackaged dev builds unless explicitly enabled", async () => {
    const { createApplicationUpdater } = require("./app-updater.cjs");
    const updater = createApplicationUpdater({
      app: {
        getVersion: () => "0.1.0",
        isPackaged: false,
      },
      autoUpdater: new EventEmitter(),
    });

    await expect(updater.checkForApplicationUpdate()).rejects.toThrow(
      "packaged Electron build",
    );
  });
});
