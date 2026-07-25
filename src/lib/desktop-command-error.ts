import { invokeDesktopCommand } from "./desktop-runtime";
import { readStoredLanguage, translate } from "../i18n";

export function normalizeDesktopCommandError(error: unknown): Error {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (isDesktopRuntimeUnavailable(message)) {
    return new Error(
      translate(readStoredLanguage(), "desktop.error.runtimeUnavailable"),
    );
  }
  if (isStaleDesktopRuntime(message)) {
    return new Error(translate(readStoredLanguage(), "desktop.error.staleRuntime"));
  }
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }

  return new Error(translate(readStoredLanguage(), "desktop.error.unknown"));
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
