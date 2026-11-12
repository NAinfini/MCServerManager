import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";

export type ManagedProcessStatus =
  "running" | "stopping" | "stopped" | "crashed" | "externalRunning";

export interface ManagedProcess {
  id: string;
  serverId: string;
  pid?: number | null;
  command: string;
  status: ManagedProcessStatus;
  /** True once the server logged its "Done" line; the status stays "running". */
  ready?: boolean;
  readyAt?: string | null;
  startedAt?: string | null;
  exitedAt?: string | null;
  exitCode?: number | null;
}

export interface ProcessEvent {
  id: string;
  serverId: string;
  level: "info" | "error" | string;
  message: string;
  createdAt: string;
}

export interface ProcessSummary {
  runningCount: number;
  crashedCount: number;
  statuses?: Record<string, ManagedProcessStatus>;
  lastBackups?: Record<string, string | null>;
}

export interface RestartCountdownResult {
  serverId: string;
  stepsSeconds: number[];
  scheduledFor: string;
}

export function startServer(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<ManagedProcess>("start_server", {
    serverId,
  });
}

export function stopServer(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<void>("stop_server", {
    serverId,
  });
}

export function forceStopServer(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<void>("force_stop_server", {
    serverId,
  });
}

export type CrashKind =
  | "clientOnlyMod"
  | "javaVersion"
  | "modIncompatible"
  | "outOfMemory"
  | "portInUse"
  | "eula"
  | "unknown";

export interface CrashExplanation {
  kind: CrashKind;
  deterministic: boolean;
  reportFile: string | null;
  detail: string;
  modFile?: string | null;
  modName?: string | null;
}

export function getCrashExplanation(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<CrashExplanation | null>(
    "get_crash_explanation",
    { serverId },
  );
}

export function disableCrashedMod(serverId: string, modFile: string) {
  return invokeDesktopCommandWithErrorHandling<void>("disable_crashed_mod", {
    input: { serverId, modFile },
  });
}

export function sendServerCommand(serverId: string, command: string) {
  return invokeDesktopCommandWithErrorHandling<void>("send_server_command", {
    serverId,
    command,
  });
}

export function restartServer(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<ManagedProcess>(
    "restart_server",
    { serverId },
  );
}

export function restartServerWithCountdown(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<RestartCountdownResult>(
    "restart_server_with_countdown",
    {
      input: { serverId },
    },
  );
}

export function getServerProcessStatus(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<ManagedProcess | null>(
    "get_server_process_status",
    { serverId },
  );
}

export function listProcessEvents(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<ProcessEvent[]>(
    "list_process_events",
    {
      serverId,
    },
  );
}

export function getProcessSummary() {
  return invokeDesktopCommandWithErrorHandling<ProcessSummary>(
    "get_process_summary",
  );
}
