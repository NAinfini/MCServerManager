const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");
const { createBackend } = require("./backend.cjs");
const { createApplicationUpdater } = require("./app-updater.cjs");
const { codedError } = require("./provisioning/contracts.cjs");

let mainWindow = null;
let isQuitting = false;
let backend = null;
let applicationUpdater = null;
let scheduledTaskTimer = null;
let rendererGone = false;
let pendingCloseTimer = null;
let reportedFatalError = false;

// The renderer decides whether the close button hides the window or quits the
// app. A crashed or wedged renderer must never leave a window the user cannot
// close, so the request is bounded: if nothing answers in time, the close runs.
// Raise this value to give a slow renderer longer, or set it to 0 to disable
// the fallback and always wait for the renderer.
const CLOSE_RESPONSE_TIMEOUT_MS = 5_000;
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

// IPC drops custom Error properties, so a coded backend error would reach the
// renderer as bare English text with no way to translate it. Carry the code in
// the message; src/lib/desktop-command-error.ts strips and resolves it.
function taggedForRenderer(error) {
  if (
    !(error instanceof Error) ||
    typeof error.mcsmCode !== "string" ||
    !/^[A-Z][A-Z0-9_]*$/.test(error.mcsmCode) ||
    error.message.startsWith("[MCSM:")
  ) {
    return error;
  }
  return new Error(`[MCSM:${error.mcsmCode}] ${error.message}`);
}

function clearPendingCloseTimer() {
  if (pendingCloseTimer) {
    clearTimeout(pendingCloseTimer);
    pendingCloseTimer = null;
  }
}

function reportFatalMainError(scope, error) {
  const details =
    error instanceof Error ? error.stack || error.message : String(error);
  originalConsole.error(`[${scope}]`, details);
  writeMainLog("error", scope, "Unhandled main-process failure.", details);
  // Surfaced once per session so a background failure cannot leave the app
  // silently half-working. Every later occurrence still reaches the app log.
  if (reportedFatalError) {
    return;
  }
  reportedFatalError = true;
  try {
    dialog.showErrorBox(
      "MC Server Manager hit an unexpected error",
      `${details}\n\nThe app may be in an unreliable state. Open Settings > Logs for details and restart if anything misbehaves.`,
    );
  } catch {
    // The dialog module is unavailable before the app is ready; the log above
    // is the record that matters.
  }
}

function applyLaunchAtLoginPreference(
  preferences,
  { reportFailure = false } = {},
) {
  if (isDev) {
    return;
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: preferences?.launchAtLogin === true,
    });
  } catch (error) {
    writeMainLog(
      "error",
      "main.login",
      "Failed to update launch-at-login preference.",
      error instanceof Error ? error.stack || error.message : String(error),
    );
    if (reportFailure) {
      throw error;
    }
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
    throw codedError(
      "EXTERNAL_LINK_SCHEME_BLOCKED",
      "Only http, https, and mailto links can be opened externally.",
    );
  }

  await shell.openExternal(String(url));
}

function appUpdater() {
  if (!applicationUpdater) {
    applicationUpdater = createApplicationUpdater({
      app,
      autoUpdater,
      getRunningServerCount: async () => {
        const summary = await backend?.handle("get_process_summary");
        return Number(summary?.runningCount || 0);
      },
      setQuitting: (value) => {
        isQuitting = value;
      },
    });
  }
  return applicationUpdater;
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
    backgroundColor: "#1e1f22",
    ...windowIconOption(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  // A fresh window means a fresh renderer, so any earlier crash no longer applies.
  rendererGone = false;
  clearPendingCloseTimer();

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    rendererGone = true;
    clearPendingCloseTimer();
    originalConsole.error("renderer process gone", details);
    writeMainLog(
      "error",
      "main.renderer",
      "Renderer process gone.",
      `reason=${details?.reason} exitCode=${details?.exitCode}`,
    );
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    if (rendererGone || mainWindow?.webContents.isCrashed()) {
      // There is nobody left to ask about hide-versus-quit, so let the close
      // through rather than trapping the user with an unclosable window.
      writeMainLog(
        "warning",
        "main.window",
        "Closing without a renderer answer: the renderer process is gone.",
      );
      return;
    }
    event.preventDefault();
    mainWindow?.webContents.send("close-behavior-requested");
    clearPendingCloseTimer();
    if (CLOSE_RESPONSE_TIMEOUT_MS > 0) {
      pendingCloseTimer = setTimeout(() => {
        pendingCloseTimer = null;
        if (isQuitting || !mainWindow || mainWindow.isDestroyed()) {
          return;
        }
        writeMainLog(
          "error",
          "main.window",
          `Renderer did not answer close-behavior-requested within ${CLOSE_RESPONSE_TIMEOUT_MS}ms; closing anyway.`,
        );
        isQuitting = true;
        mainWindow.close();
      }, CLOSE_RESPONSE_TIMEOUT_MS);
    }
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

  const parentWindow =
    BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const options = {
    properties:
      kind === "folder" ? ["openDirectory", "createDirectory"] : ["openFile"],
  };
  const filters =
    kind === "file" ? normalizeDialogFilters(args?.filters) : undefined;
  if (filters && filters.length > 0) {
    options.filters = filters;
  }

  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);

  return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
}

async function showSaveDialogForRenderer(event, args) {
  const parentWindow =
    BrowserWindow.fromWebContents(event.sender) || mainWindow;
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
    throw codedError("FOLDER_PATH_UNAVAILABLE", "folder path is unavailable");
  }
  const failure = await shell.openPath(result.path);
  if (failure) {
    throw codedError("OPEN_FOLDER_FAILED", `failed to open folder: ${failure}`);
  }
  return result;
}

async function openServerFolder(args) {
  const serverId = args?.serverId;
  if (typeof serverId !== "string" || serverId.trim().length === 0) {
    throw codedError("SERVER_ID_REQUIRED", "server id is required");
  }
  // Resolve the folder in the main process so the renderer can only ever open
  // a managed server's root directory, never an arbitrary path.
  const profiles = backend?.handle("list_server_profiles");
  const profile = Array.isArray(profiles)
    ? profiles.find((item) => item?.id === serverId)
    : null;
  if (!profile?.rootDir) {
    throw codedError(
      "SERVER_PROFILE_NOT_FOUND",
      `server profile not found: ${serverId}`,
    );
  }
  const failure = await shell.openPath(profile.rootDir);
  if (failure) {
    throw codedError("OPEN_FOLDER_FAILED", `failed to open folder: ${failure}`);
  }
  return null;
}

async function openTunnelApplication(args) {
  const provider = backend?.handle("get_tunnel_provider", {
    input: { providerId: args?.input?.providerId || args?.providerId },
  });
  if (!provider) {
    throw codedError("TUNNEL_PROVIDER_NOT_FOUND", "tunnel provider not found");
  }
  if (provider.kind !== "application") {
    throw codedError(
      "TUNNEL_PROVIDER_NOT_LAUNCHER",
      "selected tunnel provider is not an application launcher",
    );
  }
  if (!provider.command) {
    throw codedError(
      "TUNNEL_APPLICATION_PATH_MISSING",
      "tunnel application path is missing",
    );
  }
  const failure = await shell.openPath(provider.command);
  if (failure) {
    throw codedError(
      "OPEN_TUNNEL_APPLICATION_FAILED",
      `failed to open tunnel application: ${failure}`,
    );
  }
  return null;
}

function startScheduledTaskRunner() {
  if (scheduledTaskTimer) {
    return;
  }
  scheduledTaskTimer = setInterval(() => {
    Promise.resolve(backend?.handle("run_due_scheduled_tasks")).catch(
      (error) => {
        console.error("scheduled task runner failed", error);
      },
    );
  }, 60_000);
}

function stopScheduledTaskRunner() {
  if (scheduledTaskTimer) {
    clearInterval(scheduledTaskTimer);
    scheduledTaskTimer = null;
  }
}

ipcMain.handle("window-action", async (event, action) => {
  // The renderer is alive and acting on the close request, so the deadlock
  // fallback is no longer needed.
  clearPendingCloseTimer();
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
      clearPendingCloseTimer();
      isQuitting = true;
      app.quit();
      return null;
    }

    if (command === "check_app_update") {
      return appUpdater().checkForApplicationUpdate(args);
    }

    if (command === "install_app_update") {
      return appUpdater().installApplicationUpdate(args);
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

    if (command === "open_server_folder") {
      return openServerFolder(args);
    }

    if (command === "open_tunnel_application") {
      return openTunnelApplication(args);
    }

    if (!backend?.supports(command)) {
      throw new Error(`Unsupported Electron backend command: ${command}.`);
    }

    const resolvedResult = await backend.handle(command, args);
    if (
      command === "save_app_preferences" ||
      command === "reset_app_preferences" ||
      command === "import_app_settings"
    ) {
      applyLaunchAtLoginPreference(resolvedResult, { reportFailure: true });
    }
    return resolvedResult;
  } catch (error) {
    if (command !== "write_app_log") {
      writeMainLog(
        "error",
        "main.ipc",
        `Command failed: ${command}`,
        error instanceof Error ? error.stack || error.message : String(error),
      );
    }
    throw taggedForRenderer(error);
  }
});

process.on("uncaughtException", (error) => {
  reportFatalMainError("main.uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  reportFatalMainError("main.unhandledRejection", reason);
});

app.on("child-process-gone", (_event, details) => {
  writeMainLog(
    "error",
    "main.childProcess",
    `Electron child process gone: ${details?.type}`,
    `reason=${details?.reason} exitCode=${details?.exitCode}`,
  );
});

// A second launch would open its own connection to the same SQLite file while
// running a second scheduled-task loop and a second process table, duplicating
// backups and auto-starts and overwriting each other's server state.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    backend = createBackend(app);
    backend.onServerEvent((event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("server-event", event);
      }
    });
    applyLaunchAtLoginPreference(backend.handle("get_app_preferences"));
    installMainConsoleLogger();
    startScheduledTaskRunner();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  clearPendingCloseTimer();
  stopScheduledTaskRunner();
  backend?.close();
  backend = null;
});
