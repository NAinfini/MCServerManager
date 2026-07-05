function validateUpdateRequest(args) {
  const channel = args?.input?.channel || "stable";
  if (channel !== "stable") {
    throw new Error("stable is the only supported update channel");
  }
  return channel;
}

function normalizeReleaseNotes(releaseNotes) {
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((item) => item.note || item.version || "")
      .filter(Boolean)
      .join("\n\n");
  }
  return releaseNotes || null;
}

function createApplicationUpdater({
  app,
  autoUpdater,
  setQuitting = () => undefined,
  getRunningServerCount = async () => 0,
}) {
  function appUpdateStatus(updateAvailable, info, message, runningServerCount = 0) {
    const installBlockedByRunningServers = runningServerCount > 0;
    return {
      currentVersion: app.getVersion(),
      channel: "stable",
      checkedAt: new Date().toISOString(),
      updateAvailable,
      installerEnabled: updateAvailable && !installBlockedByRunningServers,
      installBlockedByRunningServers,
      runningServerCount,
      latestVersion: info?.version || null,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      releaseDate: info?.releaseDate || null,
      message,
    };
  }

  function assertPackagedUpdaterAvailable() {
    if (app.isPackaged || process.env.ELECTRON_ENABLE_DEV_UPDATES === "1") {
      return;
    }

    throw new Error(
      "App update checks require a packaged Electron build with GitHub Releases update metadata.",
    );
  }

  function configureUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
  }

  async function checkForApplicationUpdate(args) {
    validateUpdateRequest(args);
    assertPackagedUpdaterAvailable();
    configureUpdater();
    const runningServerCount = Number(await getRunningServerCount()) || 0;

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        autoUpdater.removeListener("update-available", onAvailable);
        autoUpdater.removeListener("update-not-available", onNotAvailable);
        autoUpdater.removeListener("error", onError);
      };
      const finish = (callback) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        callback();
      };
      const onAvailable = (info) => {
        finish(() =>
          resolve(
            appUpdateStatus(
              true,
              info,
              `App update ${info.version} is available from GitHub Releases.`,
              runningServerCount,
            ),
          ),
        );
      };
      const onNotAvailable = (info) => {
        finish(() =>
          resolve(
            appUpdateStatus(
              false,
              info,
              "MC Server Manager is up to date.",
              runningServerCount,
            ),
          ),
        );
      };
      const onError = (error) => {
        finish(() =>
          reject(
            new Error(`app updater error: ${error?.message || String(error)}`),
          ),
        );
      };

      autoUpdater.once("update-available", onAvailable);
      autoUpdater.once("update-not-available", onNotAvailable);
      autoUpdater.once("error", onError);
      autoUpdater.checkForUpdates().catch(onError);
    });
  }

  async function installApplicationUpdate(args) {
    const status = await checkForApplicationUpdate(args);
    if (!status.updateAvailable) {
      throw new Error("no app update is available from GitHub Releases");
    }
    if (status.installBlockedByRunningServers) {
      throw new Error(
        `app update install is blocked while ${status.runningServerCount} running server(s) are active`,
      );
    }

    await autoUpdater.downloadUpdate();
    const runningServerCountAfterDownload =
      Number(await getRunningServerCount()) || 0;
    if (runningServerCountAfterDownload > 0) {
      throw new Error(
        `app update install is blocked while ${runningServerCountAfterDownload} running server(s) are active`,
      );
    }
    setQuitting(true);
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      setQuitting(false);
      throw error;
    }
    return null;
  }

  return {
    checkForApplicationUpdate,
    installApplicationUpdate,
  };
}

module.exports = {
  createApplicationUpdater,
};
