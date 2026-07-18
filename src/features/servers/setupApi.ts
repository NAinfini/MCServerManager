import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";

export type SetupCheckStatus = "ready" | "actionRequired" | "warning";
export type SetupCheckId =
  | "java"
  | "serverRuntime"
  | "serverJar"
  | "eula"
  | "backup";

export interface ServerSetupCheck {
  id: SetupCheckId;
  status: SetupCheckStatus;
  message: string;
}

export interface ServerSetupStatus {
  serverId: string;
  serverName: string;
  checks: ServerSetupCheck[];
}

export function getServerSetupStatus(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<ServerSetupStatus>(
    "get_server_setup_status",
    { serverId },
  );
}
