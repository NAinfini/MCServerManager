import { invokeDesktopCommand } from "./desktop-runtime";
import { readStoredLanguage, translate } from "../i18n";

// main.cjs tags coded backend errors as "[MCSM:CODE] English detail", because
// IPC drops custom Error properties. Anything without a tag is an error the
// backend has not been given a code yet, and is shown as-is rather than hidden.
const BACKEND_ERROR_CODE = /\[MCSM:([A-Z][A-Z0-9_]*)\]\s*/;

function translateBackendError(message: string): Error | null {
  const match = BACKEND_ERROR_CODE.exec(message);
  if (!match) {
    return null;
  }
  const detail = message.replace(BACKEND_ERROR_CODE, "").trim();
  const key = `desktop.error.${match[1]}`;
  const translated = translate(readStoredLanguage(), key, { detail });
  // translate() returns "[[key]]" for keys it does not know.
  return new Error(translated === `[[${key}]]` ? detail : translated);
}

export function normalizeDesktopCommandError(error: unknown): Error {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const translatedBackendError = translateBackendError(message);
  if (translatedBackendError) {
    return translatedBackendError;
  }
  if (isDesktopRuntimeUnavailable(message)) {
    return new Error(
      translate(readStoredLanguage(), "desktop.error.runtimeUnavailable"),
    );
  }
  if (isStaleDesktopRuntime(message)) {
    return new Error(
      translate(readStoredLanguage(), "desktop.error.staleRuntime"),
    );
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
