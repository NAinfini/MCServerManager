import { useQuery } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";

/* "running" means the playit process is alive and has stayed up. It is never
   "connected": the agent gives this app no way to prove the internet can
   reach it. */
export type PlayitState =
  | "not_installed"
  | "needs_setup"
  | "stopped"
  | "starting"
  | "running"
  | "disconnected";

export interface PlayitStatus {
  state: PlayitState;
  exePath: string | null;
  pid: number | null;
  activeServerIds: string[];
  restartAttempt: number;
  gaveUp: boolean;
  lastError: string | null;
  exitCode: number | null;
  stopWhenIdle: boolean;
  downloadUrl: string;
}

export interface ServerShareSettings {
  serverId: string;
  publicAddress: string | null;
  startTunnelWithServer: boolean;
}

export const playitKeys = {
  status: ["playitStatus"] as const,
  share: (serverId: string) => ["serverShare", serverId] as const,
};

export function getPlayitStatus() {
  return invokeDesktopCommandWithErrorHandling<PlayitStatus>(
    "get_playit_status",
  );
}

export function savePlayitSettings(input: { stopWhenIdle: boolean }) {
  return invokeDesktopCommandWithErrorHandling<PlayitStatus>(
    "save_playit_settings",
    { input },
  );
}

export function openPlayitSetup() {
  return invokeDesktopCommandWithErrorHandling<void>("open_playit_setup");
}

export function getServerShareSettings(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<ServerShareSettings>(
    "get_server_share_settings",
    { serverId },
  );
}

export function saveServerShareSettings(input: {
  serverId: string;
  publicAddress?: string | null;
  startTunnelWithServer?: boolean;
}) {
  return invokeDesktopCommandWithErrorHandling<ServerShareSettings>(
    "save_server_share_settings",
    { input },
  );
}

export function usePlayitStatus() {
  return useQuery({
    queryKey: playitKeys.status,
    queryFn: getPlayitStatus,
    refetchInterval: 5_000,
  });
}

export function useServerShareSettings(serverId: string) {
  return useQuery({
    queryKey: playitKeys.share(serverId),
    queryFn: () => getServerShareSettings(serverId),
  });
}
