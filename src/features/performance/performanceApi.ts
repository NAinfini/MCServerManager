import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { queryKeys } from "../../lib/query-keys";

export interface ServerMetricSample {
  id: string;
  cpuPercent: number | null;
  memoryMb: number | null;
  diskFreeMb: number | null;
  uptimeSeconds: number | null;
  restartCount: number | null;
  playerCount: number | null;
  tps: number | null;
  unavailableReasons?: Record<string, string>;
  unavailableReason: string | null;
  sampledAt: string;
}

export interface MetricEventOverlay {
  level: string;
  message: string;
  createdAt: string;
}

export interface PerformanceHistory {
  serverId: string;
  samples: ServerMetricSample[];
  events: MetricEventOverlay[];
}

export const performanceKeys = queryKeys.performance;

export function getPerformanceHistory(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<PerformanceHistory>(
    "get_performance_history",
    { serverId },
  );
}

export function sampleServerMetrics(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<ServerMetricSample>(
    "sample_server_metrics",
    { serverId },
  );
}
