type AppLogLevel = "info" | "warning" | "error";

let installed = false;
let removeErrorListener: (() => void) | null = null;
let removeRejectionListener: (() => void) | null = null;

const originalConsole = {
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function stringifyLogArgs(args: unknown[]) {
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

function writeRendererLog(
  level: AppLogLevel,
  source: string,
  message: string,
  details?: string,
) {
  const bridge = window.mcServerManager;
  if (!bridge) {
    return;
  }

  void bridge
    .invoke("write_app_log", {
      input: {
        level,
        source,
        message,
        details,
      },
    })
    .catch(() => undefined);
}

export function installRendererLogger() {
  if (installed) {
    return;
  }
  installed = true;

  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    writeRendererLog("info", "renderer.console", stringifyLogArgs(args));
  };
  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    writeRendererLog("warning", "renderer.console", stringifyLogArgs(args));
  };
  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    writeRendererLog("error", "renderer.console", stringifyLogArgs(args));
  };

  const errorListener = (event: ErrorEvent) => {
    writeRendererLog(
      "error",
      "renderer.error",
      event.message || "Renderer error",
      event.error instanceof Error
        ? event.error.stack || event.error.message
        : undefined,
    );
  };
  const rejectionListener = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    writeRendererLog(
      "error",
      "renderer.unhandledrejection",
      reason instanceof Error ? reason.message : "Unhandled promise rejection",
      reason instanceof Error ? reason.stack || reason.message : String(reason),
    );
  };

  window.addEventListener("error", errorListener);
  window.addEventListener("unhandledrejection", rejectionListener);
  removeErrorListener = () => window.removeEventListener("error", errorListener);
  removeRejectionListener = () =>
    window.removeEventListener("unhandledrejection", rejectionListener);
}

export function uninstallRendererLoggerForTests() {
  if (!installed) {
    return;
  }

  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  removeErrorListener?.();
  removeRejectionListener?.();
  removeErrorListener = null;
  removeRejectionListener = null;
  installed = false;
}
