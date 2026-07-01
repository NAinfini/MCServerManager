import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";

export type AppLogLevel = "debug" | "info" | "warning" | "error";
export type AppLogLevelFilter = "all" | AppLogLevel;

export interface AppLogEntry {
  id: string;
  level: AppLogLevel | string;
  source: string;
  message: string;
  details?: string;
  createdAt: string;
}

export function listAppLogs(level: AppLogLevelFilter = "all") {
  return invokeDesktopCommandWithErrorHandling<AppLogEntry[]>("list_app_logs", {
    input: { level, limit: 500 },
  });
}

export function clearAppLogs() {
  return invokeDesktopCommandWithErrorHandling<{ cleared: boolean }>(
    "clear_app_logs",
  );
}
