import { invokeDesktopCommand } from "./desktop-runtime";

const runtimeUnavailableMessage =
  "Desktop runtime is unavailable. Open MC Server Manager from the desktop app instead of a web browser.";
const staleRuntimeMessage =
  "Desktop runtime is out of date. Restart MC Server Manager so the Electron backend reloads the latest commands.";

export function normalizeDesktopCommandError(error: unknown): Error {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (isDesktopRuntimeUnavailable(message)) {
    return new Error(runtimeUnavailableMessage);
  }
  if (isStaleDesktopRuntime(message)) {
    return new Error(staleRuntimeMessage);
  }
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }

  return new Error("Unknown desktop command failure");
}

function isDesktopRuntimeUnavailable(message: string) {
  return (
    message.includes("reading 'invoke'") ||
    message.includes("Electron desktop bridge is unavailable") ||
    message.includes("mcServerManager")
  );
}

function isStaleDesktopRuntime(message: string) {
  return message.includes("Unsupported Electron backend command");
}

export async function invokeDesktopCommandWithErrorHandling<T>(
  command: string,
  args?: Record<string, unknown>,
) {
  try {
    return await invokeDesktopCommand<T>(command, args);
  } catch (error) {
    throw normalizeDesktopCommandError(error);
  }
}
