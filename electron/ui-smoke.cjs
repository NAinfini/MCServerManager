const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, ipcMain } = require("electron");

const rootDir = path.resolve(__dirname, "..");
const rendererPath = path.join(rootDir, "dist", "index.html");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-ui-smoke-"));
const smokeTimeoutMs = 30_000;
const wizardHeaderViewports = [
  { width: 960, height: 720 },
  { width: 1280, height: 900 },
];

app.setPath("userData", userDataDir);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(webContents, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(50);
  }
  const bodyText = await webContents.executeJavaScript(
    "document.body?.innerText?.slice(0, 800) || '<empty body>'",
  );
  throw new Error(`Timed out waiting for ${label}. Renderer text: ${bodyText}`);
}

async function buttonCenter(webContents, label) {
  const point = await webContents.executeJavaScript(`(() => {
    const matches = [...document.querySelectorAll("button")].filter(
      (button) => button.textContent.includes(${JSON.stringify(label)}),
    );
    if (matches.length !== 1) return { count: matches.length };
    matches[0].scrollIntoView({ block: "center", inline: "center" });
    const rect = matches[0].getBoundingClientRect();
    return { count: 1, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (point.count !== 1) {
    throw new Error(`Expected one ${label} button, found ${point.count}.`);
  }
  return point;
}

async function clickAt(webContents, point) {
  webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
  webContents.sendInputEvent({
    type: "mouseDown",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  webContents.sendInputEvent({
    type: "mouseUp",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

async function setRendererViewport(window, viewport) {
  let requestedWidth = viewport.width;
  let requestedHeight = viewport.height;
  let actualViewport = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    window.setContentSize(requestedWidth, requestedHeight);
    await window.webContents.executeJavaScript(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    actualViewport = await window.webContents.executeJavaScript(
      "({ width: window.innerWidth, height: window.innerHeight })",
    );
    if (
      actualViewport.width === viewport.width &&
      actualViewport.height === viewport.height
    ) {
      return;
    }
    requestedWidth += viewport.width - actualViewport.width;
    requestedHeight += viewport.height - actualViewport.height;
  }

  throw new Error(
    `Could not set the renderer viewport to ${viewport.width}x${viewport.height}; received ${actualViewport?.width}x${actualViewport?.height}.`,
  );
}

async function verifyWizardHeaderGeometry(window, viewport) {
  await setRendererViewport(window, viewport);

  const geometry = await window.webContents.executeJavaScript(`(() => {
    const header = document.querySelector(".create-server-wizard-header");
    const title = header?.querySelector(".create-server-page-title-row");
    const closeButton = header?.querySelector(":scope > .icon-button");
    const wrappers = [...(header?.querySelectorAll(".wizard-step-item-wrapper") ?? [])];
    if (!header || !title || !closeButton || wrappers.length !== 6) return null;

    const titleRect = title.getBoundingClientRect();
    const closeRect = closeButton.getBoundingClientRect();
    const firstRect = wrappers[0].getBoundingClientRect();
    const lastRect = wrappers[wrappers.length - 1].getBoundingClientRect();
    const connectors = [...header.querySelectorAll(".wizard-step-connector")];
    if (connectors.length !== 5) {
      throw new Error("Expected five wizard step connectors, found " + connectors.length + ".");
    }
    const connectorCenterOffsets = connectors.map(
      (connector) => {
        const circle = connector.parentElement?.querySelector(".wizard-step-circle");
        if (!circle) return Number.POSITIVE_INFINITY;
        const connectorRect = connector.getBoundingClientRect();
        const circleRect = circle.getBoundingClientRect();
        return Math.abs(
          connectorRect.top + connectorRect.height / 2 -
            (circleRect.top + circleRect.height / 2),
        );
      },
    );
    const overlaps = (left, right) =>
      left.left < right.right - 0.5 &&
      left.right > right.left + 0.5 &&
      left.top < right.bottom - 0.5 &&
      left.bottom > right.top + 0.5;

    return {
      titleOverlapsFirstStep: overlaps(titleRect, firstRect),
      lastStepOverlapsClose: overlaps(lastRect, closeRect),
      maxConnectorCenterOffset: Math.max(...connectorCenterOffsets),
    };
  })()`);
  if (!geometry) {
    throw new Error("Could not measure the wizard header geometry.");
  }
  const failures = [];
  if (geometry.titleOverlapsFirstStep) {
    failures.push("the first step overlaps the title column");
  }
  if (geometry.lastStepOverlapsClose) {
    failures.push("the last step overlaps the close button column");
  }
  if (geometry.maxConnectorCenterOffset > 1) {
    failures.push("a connector is not vertically centered on its step circle");
  }
  if (failures.length > 0) {
    throw new Error(
      `Wizard header geometry failed at ${viewport.width}x${viewport.height}: ${failures.join("; ")}. ${JSON.stringify(geometry)}`,
    );
  }
}

function registerSmokeIpc() {
  ipcMain.handle("app-command", (_event, command) => {
    switch (command) {
      case "get_process_summary":
        return { runningCount: 0, crashedCount: 0 };
      case "list_recoverable_provisioning_jobs":
      case "list_server_profiles":
        return [];
      case "show_open_dialog":
        return { path: null };
      case "write_app_log":
        return null;
      default:
        throw new Error(`Unexpected UI smoke IPC command: ${command}`);
    }
  });
  ipcMain.handle("open-external-url", () => null);
  ipcMain.handle("window-action", () => null);
}

function cleanupAndExit(code) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.destroy();
  }
  const resolvedTempRoot = path.resolve(os.tmpdir());
  const resolvedUserDataDir = path.resolve(userDataDir);
  if (
    path.dirname(resolvedUserDataDir) !== resolvedTempRoot ||
    !path.basename(resolvedUserDataDir).startsWith("mcsm-ui-smoke-")
  ) {
    throw new Error(`Refusing to clean unexpected smoke path: ${resolvedUserDataDir}`);
  }
  const cleanup = spawn(
    process.execPath,
    [
      "-e",
      "setTimeout(() => require('node:fs').rmSync(process.env.MCSM_SMOKE_USER_DATA, { recursive: true, force: true }), 1000)",
    ],
    {
      detached: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        MCSM_SMOKE_USER_DATA: resolvedUserDataDir,
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );
  cleanup.unref();
  process.exit(code);
}

async function run() {
  if (!fs.existsSync(rendererPath)) {
    throw new Error("Production renderer is missing. Run the build before this smoke test.");
  }
  registerSmokeIpc();
  process.stdout.write("Electron UI smoke: loading production renderer.\n");

  const window = new BrowserWindow({
    width: 960,
    height: 720,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });
  const rendererErrors = [];
  window.webContents.on("console-message", (details) => {
    if (details.level === "error") rendererErrors.push(details.message);
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    rendererErrors.push(`Load failed ${code}: ${description}`);
  });

  await window.loadFile(rendererPath);
  await waitFor(
    window.webContents,
    'document.readyState === "complete" && typeof window.mcServerManager?.invoke === "function"',
    "the sandboxed preload bridge",
  );
  const consoleProbe = "__MCSM_SMOKE_CONSOLE_CAPTURE_PROBE__";
  await window.webContents.executeJavaScript(
    `console.error(${JSON.stringify(consoleProbe)})`,
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (rendererErrors.some((message) => message.includes(consoleProbe))) {
      break;
    }
    await delay(25);
  }
  const probeIndex = rendererErrors.findIndex((message) =>
    message.includes(consoleProbe),
  );
  if (probeIndex === -1) {
    throw new Error(
      "Electron UI smoke could not capture renderer console errors.",
    );
  }
  rendererErrors.splice(probeIndex, 1);
  process.stdout.write("Electron UI smoke: preload bridge ready.\n");
  await waitFor(
    window.webContents,
    '[...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Create Server")',
    "the Create server action",
  );

  await clickAt(window.webContents, await buttonCenter(window.webContents, "Create Server"));
  await waitFor(
    window.webContents,
    'document.querySelector(".page-create-server .create-server-page")',
    "the inline Create server page",
  );
  process.stdout.write("Electron UI smoke: inline Create server page opened.\n");

  await waitFor(
    window.webContents,
    'document.querySelectorAll(".create-server-page .wizard-step-item").length === 6',
    "the six Create server wizard steps",
  );

  const stepCount = await window.webContents.executeJavaScript(
    'document.querySelectorAll(".create-server-page .wizard-step-item").length',
  );
  if (stepCount !== 6) {
    throw new Error(`Expected six provisioning steps, found ${stepCount}.`);
  }
  const inlineShellState = await window.webContents.executeJavaScript(`({
    hasSidebar: Boolean(document.querySelector(".sidebar")),
    hasStatusBar: Boolean(document.querySelector(".status-bar")),
    hasTitlebar: Boolean(document.querySelector(".window-titlebar")),
    hasLoadedBrandImages: [...document.querySelectorAll(
      ".window-titlebar-mark img, .app-mark img",
    )].every((image) => image.complete && image.naturalWidth > 0),
    hasCreateDialog: Boolean(document.querySelector(".create-server-dialog")),
    hasBackdrop: Boolean(document.querySelector(".dialog-backdrop")),
  })`);
  if (
    !inlineShellState.hasSidebar ||
    !inlineShellState.hasStatusBar ||
    !inlineShellState.hasTitlebar ||
    !inlineShellState.hasLoadedBrandImages ||
    inlineShellState.hasCreateDialog ||
    inlineShellState.hasBackdrop
  ) {
    throw new Error(
      `Create server did not remain inline with the app shell: ${JSON.stringify(inlineShellState)}`,
    );
  }

  let wizardHeaderScreenshotPath = null;
  for (const viewport of wizardHeaderViewports) {
    await verifyWizardHeaderGeometry(window, viewport);
    if (viewport.width === 1280 && viewport.height === 900) {
      wizardHeaderScreenshotPath = path.join(
        os.tmpdir(),
        `mcsm-wizard-header-1280x900-${process.pid}.png`,
      );
      const screenshot = await window.webContents.capturePage();
      fs.writeFileSync(wizardHeaderScreenshotPath, screenshot.toPNG());
    }
  }
  process.stdout.write(`Electron UI smoke screenshot: ${wizardHeaderScreenshotPath}\n`);

  const fileButton = await buttonCenter(window.webContents, "Open modpack file");
  await clickAt(window.webContents, fileButton);
  await delay(100);
  const pointerFocusVisible = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.textContent.includes("Open modpack file"),
    );
    button.focus();
    return button.matches(":focus-visible");
  })()`);
  if (pointerFocusVisible) {
    throw new Error("Pointer focus unexpectedly matched :focus-visible.");
  }

  await window.webContents.executeJavaScript("document.activeElement?.blur()");
  window.webContents.focus();
  let keyboardFocus = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "TAB" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "TAB" });
    await delay(50);
    keyboardFocus = await window.webContents.executeJavaScript(`(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const style = getComputedStyle(element);
      return {
        focusVisible: element.matches(":focus-visible"),
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
        tagName: element.tagName,
      };
    })()`);
    if (
      keyboardFocus?.focusVisible &&
      (keyboardFocus.outlineWidth !== "0px" || keyboardFocus.boxShadow !== "none")
    ) {
      break;
    }
  }
  if (
    !keyboardFocus?.focusVisible ||
    (keyboardFocus.outlineWidth === "0px" && keyboardFocus.boxShadow === "none")
  ) {
    throw new Error(`Keyboard focus was not visibly rendered: ${JSON.stringify(keyboardFocus)}`);
  }
  if (rendererErrors.length > 0) {
    throw new Error(`Renderer errors: ${rendererErrors.join(" | ")}`);
  }

  window.destroy();
  process.stdout.write("Electron UI smoke passed: bridge, wizard, and focus behavior verified.\n");
}

const hardTimeout = setTimeout(() => {
  process.stderr.write(`Electron UI smoke exceeded ${smokeTimeoutMs}ms.\n`);
  cleanupAndExit(1);
}, smokeTimeoutMs);

app
  .whenReady()
  .then(run)
  .then(() => {
    clearTimeout(hardTimeout);
    cleanupAndExit(0);
  })
  .catch((error) => {
    clearTimeout(hardTimeout);
    process.stderr.write(`Electron UI smoke failed: ${error.stack || error.message}\n`);
    cleanupAndExit(1);
  });
