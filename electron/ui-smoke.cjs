const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, ipcMain } = require("electron");

const rootDir = path.resolve(__dirname, "..");
const rendererPath = path.join(rootDir, "dist", "index.html");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-ui-smoke-"));
// Mounting the bundled Monaco chunk for the first time costs several seconds on
// a cold renderer, so the run needs more headroom than the UI checks alone.
const smokeTimeoutMs = 120_000;
const wizardHeaderViewports = [
  { width: 960, height: 720 },
  { width: 1280, height: 900 },
];
const smokeServer = {
  id: "smoke-server",
  name: "Command Studio",
  rootDir: "C:\\Servers\\command-studio",
  minecraftVersion: "1.21.1",
  loaderType: "fabric",
  loaderVersion: "0.16.10",
  javaPath: "C:\\Java\\bin\\java.exe",
  serverPort: 25565,
  minMemoryMb: 2048,
  maxMemoryMb: 6144,
  autoStart: true,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z",
  restartPolicy: {
    enabled: true,
    maxAttempts: 3,
    cooldownSeconds: 30,
  },
};

app.setPath("userData", userDataDir);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Each poll runs on the renderer's main thread, so a tight interval starves
// heavy work such as parsing the Monaco chunk. Slow waits pass a larger one.
async function waitFor(
  webContents,
  expression,
  label,
  timeoutMs = 10_000,
  pollIntervalMs = 50,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(pollIntervalMs);
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

// "Files" is also a substring of "Files & backups", so some labels can only be
// resolved by an exact match.
async function exactButtonCenter(webContents, label) {
  const point = await webContents.executeJavaScript(`(() => {
    const matches = [...document.querySelectorAll("button")].filter(
      (button) => button.textContent.trim() === ${JSON.stringify(label)},
    );
    if (matches.length !== 1) return { count: matches.length };
    matches[0].scrollIntoView({ block: "center", inline: "center" });
    const rect = matches[0].getBoundingClientRect();
    return { count: 1, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (point.count !== 1) {
    throw new Error(
      `Expected one exact "${label}" button, found ${point.count}.`,
    );
  }
  return point;
}

async function elementCenter(webContents, selector, label) {
  const point = await webContents.executeJavaScript(`(() => {
    const matches = [...document.querySelectorAll(${JSON.stringify(selector)})];
    if (matches.length !== 1) return { count: matches.length };
    matches[0].scrollIntoView({ block: "center", inline: "center" });
    const rect = matches[0].getBoundingClientRect();
    return { count: 1, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (point.count !== 1) {
    throw new Error(`Expected one ${label}, found ${point.count}.`);
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

const nextFrame =
  "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))";

async function setRendererViewport(window, viewport) {
  let requestedWidth = viewport.width;
  let requestedHeight = viewport.height;
  let actualViewport = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    window.setContentSize(requestedWidth, requestedHeight);
    await window.webContents.executeJavaScript(nextFrame);
    actualViewport = await window.webContents.executeJavaScript(
      "({ width: window.innerWidth, height: window.innerHeight })",
    );
    if (
      actualViewport.width === viewport.width &&
      actualViewport.height === viewport.height
    ) {
      // innerWidth reporting the target is not the same as the renderer having
      // laid out at it. macOS resizes the window asynchronously, so a caller
      // that measured immediately here read the pre-resize layout and saw the
      // wide navigation at a width whose media query calls for the compact one.
      // Take another frame and confirm the size held before handing back.
      await window.webContents.executeJavaScript(nextFrame);
      const settled = await window.webContents.executeJavaScript(
        "({ width: window.innerWidth, height: window.innerHeight })",
      );
      if (
        settled.width === viewport.width &&
        settled.height === viewport.height
      ) {
        return;
      }
      actualViewport = settled;
    }
    requestedWidth += viewport.width - actualViewport.width;
    requestedHeight += viewport.height - actualViewport.height;
  }

  throw new Error(
    `Could not set the renderer viewport to ${viewport.width}x${viewport.height}; received ${actualViewport?.width}x${actualViewport?.height}.`,
  );
}

async function verifyPageWidth(window, selector, label) {
  for (const viewport of [
    { width: 960, height: 720 },
    { width: 760, height: 720 },
  ]) {
    await setRendererViewport(window, viewport);
    const geometry = await window.webContents.executeJavaScript(`(() => {
      const page = document.querySelector(${JSON.stringify(selector)});
      if (!page) return null;
      const rect = page.getBoundingClientRect();
      return {
        documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        pageOverflow: page.scrollWidth > page.clientWidth + 1,
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
      };
    })()`);
    if (
      !geometry ||
      geometry.documentOverflow ||
      geometry.pageOverflow ||
      geometry.left < -1 ||
      geometry.right > geometry.viewportWidth + 1
    ) {
      throw new Error(
        `${label} width failed at ${viewport.width}x${viewport.height}: ${JSON.stringify(geometry)}`,
      );
    }
  }
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

// Collected at module scope so a failure anywhere in the run can report what
// the renderer actually complained about, not just which wait timed out.
const rendererErrors = [];

function registerSmokeIpc() {
  ipcMain.handle("app-command", (_event, command) => {
    switch (command) {
      case "get_process_summary":
        return { runningCount: 1, crashedCount: 0 };
      case "list_recoverable_provisioning_jobs":
        return [];
      case "list_server_profiles":
        return [smokeServer];
      case "get_server_process_status":
        return {
          id: "smoke-process",
          serverId: smokeServer.id,
          pid: 4242,
          command: "java -jar server.jar nogui",
          status: "running",
          startedAt: "2026-07-23T14:00:00.000Z",
          exitedAt: null,
          exitCode: null,
        };
      case "get_server_setup_status":
        return {
          serverId: smokeServer.id,
          serverName: smokeServer.name,
          checks: [
            { id: "java", status: "ready", message: "Java is ready." },
            {
              id: "serverRuntime",
              status: "ready",
              message: "Server runtime is ready.",
            },
            { id: "eula", status: "ready", message: "EULA is accepted." },
            {
              id: "backup",
              status: "warning",
              count: 0,
              message: "Create a first backup.",
            },
          ],
        };
      case "get_performance_history":
        return {
          samples: [
            {
              id: "metric-1",
              sampledAt: "2026-07-23T15:00:00.000Z",
              cpuPercent: 18.4,
              memoryMb: 2560,
              diskFreeMb: 102_400,
              uptimeSeconds: 3600,
              restartCount: 0,
              playerCount: 7,
              tps: 19.9,
              unavailableReason: null,
            },
          ],
          events: [],
        };
      case "list_process_events":
        return [
          {
            id: "event-1",
            serverId: smokeServer.id,
            level: "info",
            message: "Server started successfully.",
            createdAt: "2026-07-23T15:00:00.000Z",
          },
          {
            id: "event-2",
            serverId: smokeServer.id,
            level: "warning",
            message: "Backup recommended before content changes.",
            createdAt: "2026-07-23T14:58:00.000Z",
          },
        ];
      // JSON on purpose: it is the one editable file type that starts a Monaco
      // language worker, which is what the packaged file:// renderer has to
      // prove it can do.
      case "list_server_files":
        return [
          {
            name: "smoke-config.json",
            relativePath: "smoke-config.json",
            kind: "file",
            sizeBytes: 48,
            modifiedAt: "2026-07-23T15:00:00.000Z",
            editable: true,
          },
        ];
      case "read_server_text_file":
        return {
          relativePath: "smoke-config.json",
          // The trailing comma is deliberate: only the JSON language worker can
          // flag it, so an error squiggle proves the worker really started.
          content: '{\n  "motd": "never from a CDN",\n}\n',
          sizeBytes: 48,
          readOnly: false,
          warning: null,
        };
      case "list_java_runtimes":
        return {
          runtimes: [
            {
              path: "C:\\Java\\bin\\java.exe",
              source: "Managed by MC Server Manager",
              version: "21.0.8",
              majorVersion: 21,
              vendor: "Eclipse Temurin",
              architecture: "x64",
            },
          ],
          failures: [],
          compatibility: [],
        };
      case "list_app_logs":
        return [
          {
            id: "log-1",
            level: "info",
            source: "ui-smoke",
            message: "Application logger smoke entry",
            details: "No renderer errors.",
            createdAt: "2026-07-23T15:00:00.000Z",
          },
        ];
      case "list_tunnel_providers":
      case "list_tunnel_statuses":
      case "list_tunnel_bindings":
      case "list_scheduled_tasks":
      case "list_scheduled_task_runs":
      case "list_diagnostic_runs":
      case "list_server_backups":
      case "list_notification_events":
      case "get_attention_items":
        return [];
      case "suggest_server_port":
        return { port: 25565, taken: [] };
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
    throw new Error(
      `Refusing to clean unexpected smoke path: ${resolvedUserDataDir}`,
    );
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
    throw new Error(
      "Production renderer is missing. Run the build before this smoke test.",
    );
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
  await window.webContents.executeJavaScript(
    'localStorage.setItem("mcsm.theme", "dark"); document.documentElement.dataset.theme = "dark";',
  );
  await waitFor(
    window.webContents,
    '[...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Create Server")',
    "the Create server action",
  );

  await setRendererViewport(window, { width: 1280, height: 900 });
  await clickAt(
    window.webContents,
    await elementCenter(
      window.webContents,
      ".server-card-grid .server-card-open",
      "server card link",
    ),
  );
  await waitFor(
    window.webContents,
    'document.querySelector(".server-workspace-shell .server-workspace-main")',
    "the server workbench",
  );
  await waitFor(
    window.webContents,
    'document.querySelector(".server-header-telemetry")?.textContent.includes("18.4%") && document.querySelector(".server-header-telemetry")?.textContent.includes("7") && document.querySelector(".server-header-telemetry")?.textContent.includes("19.9")',
    "live CPU, player, and TPS telemetry",
  );
  await waitFor(
    window.webContents,
    `(() => {
      const overview = document.querySelector(".activity-overview");
      const body = overview?.closest(".server-workspace-content");
      if (!overview || !body) return false;
      const rect = overview.getBoundingClientRect();
      return (
        overview.textContent.includes("Root folder") &&
        rect.width > 0 &&
        rect.height > 0 &&
        Number.parseFloat(getComputedStyle(body).opacity) >= 0.99
      );
    })()`,
    "the visible overview workspace",
  );
  const desktopWorkbench = await window.webContents.executeJavaScript(`(() => {
    const workbench = document.querySelector(".server-workspace-shell");
    const navigation = document.querySelector(".server-workspace-nav");
    const content = document.querySelector(".server-workspace-main");
    if (!workbench || !navigation || !content) return null;
    const navigationRect = navigation.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    return {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      navigationVisible: navigationRect.width >= 150,
      contentDominates: contentRect.width > navigationRect.width * 3,
      brokenVisibleImages: [...document.images].filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (!image.complete || image.naturalWidth === 0);
      }).map((image) => image.src),
      telemetryText: document.querySelector(".server-header-telemetry")?.textContent ?? "",
    };
  })()`);
  if (
    !desktopWorkbench ||
    desktopWorkbench.horizontalOverflow ||
    !desktopWorkbench.navigationVisible ||
    !desktopWorkbench.contentDominates ||
    desktopWorkbench.brokenVisibleImages.length > 0 ||
    !desktopWorkbench.telemetryText.includes("18.4%") ||
    !desktopWorkbench.telemetryText.includes("7")
  ) {
    throw new Error(
      `Desktop workbench geometry failed: ${JSON.stringify(desktopWorkbench)}`,
    );
  }
  const workbenchScreenshotPath = path.join(
    os.tmpdir(),
    `mcsm-command-studio-1280x900-${process.pid}.png`,
  );
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  fs.writeFileSync(
    workbenchScreenshotPath,
    (await window.webContents.capturePage()).toPNG(),
  );
  process.stdout.write(
    `Electron command studio screenshot: ${workbenchScreenshotPath}\n`,
  );

  await setRendererViewport(window, { width: 960, height: 720 });
  const compactWorkbench = await window.webContents.executeJavaScript(`(() => {
    const workbench = document.querySelector(".server-workspace-shell");
    const navigation = document.querySelector(".server-workspace-nav");
    const navigationItem = document.querySelector(".server-workspace-nav-item");
    if (!workbench || !navigation || !navigationItem) return null;
    const navigationRect = navigation.getBoundingClientRect();
    const itemRect = navigationItem.getBoundingClientRect();
    return {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      compactNavigation: navigationRect.width <= 60 && itemRect.width <= 44,
      // Reported so a failure says whether the layout is wrong or the viewport
      // never reached the breakpoint, instead of leaving both open.
      viewportWidth: window.innerWidth,
      compactBreakpointMatches: window.matchMedia("(max-width: 1100px)").matches,
      navigationWidth: navigationRect.width,
      itemWidth: itemRect.width,
    };
  })()`);
  if (
    !compactWorkbench ||
    compactWorkbench.horizontalOverflow ||
    !compactWorkbench.compactNavigation
  ) {
    throw new Error(
      `Compact workbench geometry failed: ${JSON.stringify(compactWorkbench)}`,
    );
  }
  process.stdout.write("Electron UI smoke: compact workbench verified.\n");

  for (const route of [
    {
      primary: "Automation",
      view: null,
      text: "Scheduled tasks",
    },
    {
      primary: "Operations",
      view: "Diagnostics",
      text: "Diagnostics",
    },
    {
      primary: "Server settings",
      view: "Network & access",
      text: "Network and connections",
    },
    {
      primary: "Server settings",
      view: "Import & export",
      text: "Profile import/export",
    },
  ]) {
    const label = route.view ?? route.primary;
    process.stdout.write(
      `Electron UI smoke: checking ${label} server route.\n`,
    );
    await setRendererViewport(window, { width: 960, height: 720 });
    await clickAt(
      window.webContents,
      await buttonCenter(window.webContents, route.primary),
    );
    if (route.view) {
      await waitFor(
        window.webContents,
        `[...document.querySelectorAll("button")].some((button) => button.textContent.trim() === ${JSON.stringify(route.view)})`,
        `the ${route.view} workspace view`,
      );
      await clickAt(
        window.webContents,
        await buttonCenter(window.webContents, route.view),
      );
    }
    await waitFor(
      window.webContents,
      `document.querySelector(".server-workspace-content")?.textContent.includes(${JSON.stringify(route.text)})`,
      `the ${label} server route`,
    );
    await verifyPageWidth(
      window,
      ".server-workspace-main",
      `${label} server route`,
    );
    process.stdout.write(
      `Electron UI smoke: ${label} server route verified.\n`,
    );
  }

  // Monaco is bundled rather than fetched from a CDN, and its workers have to
  // start from the file:// origin the packaged app runs on. Neither survives a
  // config mistake, and neither shows up anywhere except a real editor mount.
  process.stdout.write(
    "Electron UI smoke: checking the bundled file editor.\n",
  );
  await setRendererViewport(window, { width: 1280, height: 900 });
  await clickAt(
    window.webContents,
    await buttonCenter(window.webContents, "Files & backups"),
  );
  await waitFor(
    window.webContents,
    '[...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Files")',
    "the Files workspace view",
  );
  await clickAt(
    window.webContents,
    await exactButtonCenter(window.webContents, "Files"),
  );
  await waitFor(
    window.webContents,
    '[...document.querySelectorAll("button")].some((button) => button.textContent.trim().includes("smoke-config.json"))',
    "the server file list",
  );
  await clickAt(
    window.webContents,
    await buttonCenter(window.webContents, "smoke-config.json"),
  );
  // Monaco's first mount parses a multi-megabyte chunk. Polling through it only
  // starves the renderer, so let it settle before asserting.
  await delay(8_000);
  await waitFor(
    window.webContents,
    `(() => {
      const editor = document.querySelector(".files-editor .monaco-editor");
      if (!editor) return false;
      const rect = editor.getBoundingClientRect();
      // Monaco renders spaces as non-breaking, so compare without whitespace.
      return rect.width > 0 && rect.height > 0 &&
        editor.textContent.replace(/\\s/g, "").includes("neverfromaCDN");
    })()`,
    "the bundled Monaco editor",
    45_000,
    500,
  );
  // Monaco runs JSON validation in a web worker. The packaged renderer loads
  // from file://, where worker startup is the part most likely to break, so
  // assert the squiggle rather than trusting that the editor merely rendered.
  await waitFor(
    window.webContents,
    'Boolean(document.querySelector(".files-editor .monaco-editor .squiggly-error"))',
    "a JSON diagnostic from the Monaco language worker",
    20_000,
    500,
  );
  process.stdout.write("Electron UI smoke: bundled file editor verified.\n");

  await setRendererViewport(window, { width: 960, height: 720 });
  await window.webContents.executeJavaScript(
    'document.querySelector(".page-header-back")?.click()',
  );
  await waitFor(
    window.webContents,
    '[...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Create Server")',
    "the dashboard after leaving the server workbench",
  );

  for (const page of [
    {
      label: "Java Runtimes",
      selector: ".java-page",
    },
    {
      label: "Logger",
      selector: ".logger-page",
    },
  ]) {
    process.stdout.write(`Electron UI smoke: checking ${page.label} page.\n`);
    await setRendererViewport(window, { width: 960, height: 720 });
    await clickAt(
      window.webContents,
      await buttonCenter(window.webContents, page.label),
    );
    await waitFor(
      window.webContents,
      `document.querySelector(${JSON.stringify(page.selector)})`,
      `the ${page.label} page`,
    );
    await verifyPageWidth(window, page.selector, page.label);
    process.stdout.write(`Electron UI smoke: ${page.label} page verified.\n`);
  }
  await setRendererViewport(window, { width: 960, height: 720 });
  await clickAt(
    window.webContents,
    await buttonCenter(window.webContents, "Dashboard"),
  );
  await waitFor(
    window.webContents,
    '[...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Create Server")',
    "the dashboard after secondary-page checks",
  );

  await clickAt(
    window.webContents,
    await buttonCenter(window.webContents, "Create Server"),
  );
  await waitFor(
    window.webContents,
    'document.querySelector(".page-create-server .create-server-page")',
    "the inline Create server page",
  );
  process.stdout.write(
    "Electron UI smoke: inline Create server page opened.\n",
  );

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
  process.stdout.write(
    `Electron UI smoke screenshot: ${wizardHeaderScreenshotPath}\n`,
  );

  const fileButton = await buttonCenter(
    window.webContents,
    "Open modpack file",
  );
  await clickAt(window.webContents, fileButton);
  await delay(100);
  const pointerFocusVisible = await window.webContents
    .executeJavaScript(`(() => {
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
      (keyboardFocus.outlineWidth !== "0px" ||
        keyboardFocus.boxShadow !== "none")
    ) {
      break;
    }
  }
  if (
    !keyboardFocus?.focusVisible ||
    (keyboardFocus.outlineWidth === "0px" && keyboardFocus.boxShadow === "none")
  ) {
    throw new Error(
      `Keyboard focus was not visibly rendered: ${JSON.stringify(keyboardFocus)}`,
    );
  }
  if (rendererErrors.length > 0) {
    throw new Error(`Renderer errors: ${rendererErrors.join(" | ")}`);
  }

  window.destroy();
  process.stdout.write(
    "Electron UI smoke passed: bridge, wizard, and focus behavior verified.\n",
  );
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
    process.stderr.write(
      `Electron UI smoke failed: ${error.stack || error.message}\n`,
    );
    if (rendererErrors.length > 0) {
      process.stderr.write(
        `Renderer errors during the run:\n  ${rendererErrors.join("\n  ")}\n`,
      );
    }
    cleanupAndExit(1);
  });
