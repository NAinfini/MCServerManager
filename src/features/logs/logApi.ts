import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";

export interface ServerLogFile {
  fileName: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
  current: boolean;
  compressed: boolean;
}

export interface ServerLogsDocument {
  serverId: string;
  logs: ServerLogFile[];
}

export interface ServerLogDocument {
  relativePath: string;
  content: string;
  sizeBytes: number;
  modifiedAt: string;
  compressed: boolean;
}

export function listServerLogs(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<ServerLogsDocument>(
    "list_server_logs",
    { serverId },
  );
}

export function readServerLog(serverId: string, relativePath: string) {
  return invokeDesktopCommandWithErrorHandling<ServerLogDocument>(
    "read_server_log",
    { serverId, relativePath },
  );
}
