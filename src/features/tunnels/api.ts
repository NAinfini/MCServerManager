import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { queryKeys } from "../../lib/query-keys";

export interface LocalNetworkAddress {
  address: string;
  interfaceName: string;
}

export interface TunnelProvider {
  id: string;
  name: string;
  kind: "custom" | "application";
  command: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface TunnelStatus {
  providerId: string;
  status: string;
  pid: number | null;
  refCount: number;
  lastError: string | null;
  updatedAt: string;
}

export interface TunnelBinding {
  id: string;
  providerId: string;
  serverId: string;
  providerName: string;
  serverName: string;
  createdAt: string;
}

export const tunnelKeys = queryKeys.tunnels;

export function listLocalNetworkAddresses() {
  return invokeDesktopCommandWithErrorHandling<LocalNetworkAddress[]>(
    "get_local_network_addresses",
  );
}

export function listTunnelProviders() {
  return invokeDesktopCommandWithErrorHandling<TunnelProvider[]>(
    "list_tunnel_providers",
  );
}

export function listTunnelStatuses() {
  return invokeDesktopCommandWithErrorHandling<TunnelStatus[]>(
    "list_tunnel_statuses",
  );
}

export function listTunnelBindings() {
  return invokeDesktopCommandWithErrorHandling<TunnelBinding[]>(
    "list_tunnel_bindings",
  );
}

export function openTunnelApplication(providerId: string) {
  return invokeDesktopCommandWithErrorHandling<void>(
    "open_tunnel_application",
    { input: { providerId } },
  );
}
