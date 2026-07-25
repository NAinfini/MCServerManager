import { useQuery } from "@tanstack/react-query";
import {
  getProcessSummary,
  getServerProcessStatus,
} from "../features/process/api";
import { processKeys } from "../features/process/queries";

export const PROCESS_SUMMARY_INTERVAL_MS = 2_000;
export const SERVER_STATUS_INTERVAL_MS = 2_000;

export function useProcessSummaryPolling() {
  return useQuery({
    queryKey: processKeys.summary,
    queryFn: getProcessSummary,
    refetchInterval: PROCESS_SUMMARY_INTERVAL_MS,
  });
}

export function serverStatusPollingOptions(serverId: string) {
  return {
    queryKey: processKeys.status(serverId),
    queryFn: () => getServerProcessStatus(serverId),
    refetchInterval: SERVER_STATUS_INTERVAL_MS,
  } as const;
}

export function useServerProcessStatusPolling(serverId: string) {
  return useQuery(serverStatusPollingOptions(serverId));
}
