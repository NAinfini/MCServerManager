import { createContext, useContext, type ReactNode } from "react";
import { useServerProcessStatusPolling } from "../../lib/polling";
import type { ManagedProcessStatus } from "../process/api";

interface ServerRuntimeState {
  status: ManagedProcessStatus;
  isLoading: boolean;
  error: Error | null;
}

const ServerRuntimeContext = createContext<ServerRuntimeState>({
  status: "stopped",
  isLoading: false,
  error: null,
});

export function ServerRuntimeProvider({
  children,
  serverId,
}: {
  children: ReactNode;
  serverId: string;
}) {
  const query = useServerProcessStatusPolling(serverId);
  return (
    <ServerRuntimeContext.Provider
      value={{
        status: query.data?.status ?? "stopped",
        isLoading: query.isLoading,
        error: query.error,
      }}
    >
      {children}
    </ServerRuntimeContext.Provider>
  );
}

export function useServerRuntime() {
  return useContext(ServerRuntimeContext);
}
