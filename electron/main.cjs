const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");
const { createBackend } = require("./backend.cjs");

let mainWindow = null;
let isQuitting = false;
let backend = null;
let scheduledTaskTimer = null;
const originalConsole = {
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

const isDev = !app.isPackaged;

function stringifyLogArgs(args) {
  return args
    .map((item) => {
      if (item instanceof Error) {
        return item.stack || item.message;
      }
      if (typeof item === "string") {
        return item;
      }
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    })
    .join(" ");
}

function writeMainLog(level, source, message, details) {
  try {
    backend?.handle("write_app_log", {
      input: {
        level,
        source,
        message,
        details,
      },
    });
  } catch {
    // Logging must not break the app or recurse into console logging.
  }
}

function installMainConsoleLogger() {
  console.info = (...args) => {
    originalConsole.info(...args);
    writeMainLog("info", "main.console", stringifyLogArgs(args));
  };
  console.warn = (...args) => {
    originalConsole.warn(...args);
    writeMainLog("warning", "main.console", stringifyLogArgs(args));
  };
  console.error = (...args) => {
    originalConsole.error(...args);
    writeMainLog("error", "main.console", stringifyLogArgs(args));
  };
}

function rendererUrl() {
  return process.env.ELECTRON_RENDERER_URL || "http://localhost:1420";
}

function windowIconOption() {
  const iconPath = path.join(__dirname, "..", "public", "app-icon.ico");
  return fs.existsSync(iconPath) ? { icon: iconPath } : {};
}

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

function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(String(url));
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function isRendererNavigation(url) {
  if (!isDev) {
    return false;
  }

  try {
    return new URL(url).origin === new URL(rendererUrl()).origin;
  } catch {
    return false;
  }
}

async function openExternalUrl(url) {
  if (!isSafeExternalUrl(url)) {
    throw new Error("Only http, https, and mailto links can be opened externally.");
  }

  await shell.openExternal(String(url));
}

function appUpdateStatus(updateAvailable, info, message) {
  return {
    currentVersion: app.getVersion(),
    channel: "stable",
    checkedAt: new Date().toISOString(),
    updateAvailable,
    installerEnabled: updateAvailable,
    installBlockedByRunningServers: false,
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

function checkForApplicationUpdate(args) {
  validateUpdateRequest(args);
  assertPackagedUpdaterAvailable();
  configureUpdater();

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
          ),
        ),
      );
    };
    const onNotAvailable = (info) => {
      finish(() =>
        resolve(
          appUpdateStatus(false, info, "MC Server Manager is up to date."),
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

  await autoUpdater.downloadUpdate();
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
  return null;
}

function createWindow() {
  backend = backend || createBackend(app);
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 960,
    minHeight: 640,
    title: "MC Server Manager",
    frame: false,
    show: false,
    backgroundColor: "#10171a",
    ...windowIconOption(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    mainWindow?.webContents.send("close-behavior-requested");
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url).catch((error) => {
      console.error("failed to open external window URL", error);
    });
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isSafeExternalUrl(url) || isRendererNavigation(url)) {
      return;
    }

    event.preventDefault();
    void openExternalUrl(url).catch((error) => {
      console.error("failed to open external navigation URL", error);
    });
  });

  if (isDev) {
    void mainWindow.loadURL(rendererUrl());
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function normalizeDialogFilters(filters) {
  if (!Array.isArray(filters)) {
    return undefined;
  }

  return filters
    .map((filter) => ({
      name: String(filter?.name || "Files"),
      extensions: Array.isArray(filter?.extensions)
        ? filter.extensions
            .map((extension) => String(extension).replace(/^\./, ""))
            .filter(Boolean)
        : [],
    }))
    .filter((filter) => filter.extensions.length > 0);
}

async function showOpenDialogForRenderer(event, args) {
  const kind = args?.kind;
  if (kind !== "file" && kind !== "folder") {
    throw new Error("show_open_dialog requires kind 'file' or 'folder'.");
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const options = {
    properties:
      kind === "folder" ? ["openDirectory", "createDirectory"] : ["openFile"],
  };
  const filters = kind === "file" ? normalizeDialogFilters(args?.filters) : undefined;
  if (filters && filters.length > 0) {
    options.filters = filters;
  }

  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);

  return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
}

async function showSaveDialogForRenderer(event, args) {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const options = {
    defaultPath:
      typeof args?.defaultPath === "string" ? args.defaultPath : undefined,
  };
  const filters = normalizeDialogFilters(args?.filters);
  if (filters && filters.length > 0) {
    options.filters = filters;
  }

  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, options)
    : await dialog.showSaveDialog(options);

  return { path: result.canceled ? null : (result.filePath ?? null) };
}

async function openBackendFolder(command) {
  const result = backend?.handle(command);
  if (!result?.path) {
    throw new Error("folder path is unavailable");
  }
  const failure = await shell.openPath(result.path);
  if (failure) {
    throw new Error(`failed to open folder: ${failure}`);
  }
  return result;
}

async function openTunnelApplication(args) {
  const provider = backend?.handle("get_tunnel_provider", {
    input: { providerId: args?.input?.providerId || args?.providerId },
  });
  if (!provider) {
    throw new Error("tunnel provider not found");
  }
  if (provider.kind !== "application") {
    throw new Error("selected tunnel provider is not an application launcher");
  }
  if (!provider.command) {
    throw new Error("tunnel application path is missing");
  }
  const failure = await shell.openPath(provider.command);
  if (failure) {
    throw new Error(`failed to open tunnel application: ${failure}`);
  }
  return null;
}

function startScheduledTaskRunner() {
  if (scheduledTaskTimer) {
    return;
  }
  scheduledTaskTimer = setInterval(() => {
    Promise.resolve(backend?.handle("run_due_scheduled_tasks")).catch((error) => {
      console.error("scheduled task runner failed", error);
    });
  }, 60_000);
}

function stopScheduledTaskRunner() {
  if (scheduledTaskTimer) {
    clearInterval(scheduledTaskTimer);
    scheduledTaskTimer = null;
  }
}

ipcMain.handle("window-action", async (event, action) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    throw new Error("Electron window is unavailable.");
  }

  switch (action) {
    case "minimize":
      window.minimize();
      return;
    case "toggleMaximize":
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
      return;
    case "hide":
      window.hide();
      return;
    case "close":
      window.close();
      return;
    default:
      throw new Error(`Unsupported window action: ${action}`);
  }
});

ipcMain.handle("open-external-url", async (_event, url) => {
  await openExternalUrl(url);
  return null;
});

ipcMain.handle("app-command", async (_event, command, args) => {
  try {
    if (command === "request_app_quit") {
      isQuitting = true;
      app.quit();
      return null;
    }

    if (command === "check_app_update") {
      return checkForApplicationUpdate(args);
    }

    if (command === "install_app_update") {
      return installApplicationUpdate(args);
    }

    if (command === "show_open_dialog") {
      return showOpenDialogForRenderer(_event, args);
    }

    if (command === "show_save_dialog") {
      return showSaveDialogForRenderer(_event, args);
    }

    if (command === "open_app_logs_folder") {
      return openBackendFolder("get_app_logs_folder");
    }

    if (command === "open_app_data_folder") {
      return openBackendFolder("get_app_data_folder");
    }

    if (command === "open_tunnel_application") {
      return openTunnelApplication(args);
    }

    const backendResult = backend?.handle(command, args);
    if (backendResult !== undefined) {
      return await backendResult;
    }

    throw new Error(`Unsupported Electron backend command: ${command}.`);
  } catch (error) {
    if (command !== "write_app_log") {
      writeMainLog(
        "error",
        "main.ipc",
        `Command failed: ${command}`,
        error instanceof Error ? error.stack || error.message : String(error),
      );
    }
    throw error;
  }
});

app.whenReady().then(() => {
  backend = createBackend(app);
  installMainConsoleLogger();
  startScheduledTaskRunner();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopScheduledTaskRunner();
  backend?.close();
  backend = null;
});
