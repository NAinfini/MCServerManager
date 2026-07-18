import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import {
  Clock,
  Cpu,
  HardDrive,
  MemoryStick,
  Gauge,
  RefreshCw,
  RotateCcw,
  Users,
} from "lucide-react";
import * as Progress from "@radix-ui/react-progress";
import * as Separator from "@radix-ui/react-separator";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../servers/types";

interface ServerMetricSample {
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

interface MetricEventOverlay {
  level: string;
  message: string;
  createdAt: string;
}

interface PerformanceHistory {
  serverId: string;
  samples: ServerMetricSample[];
  events: MetricEventOverlay[];
}

interface PerformanceHistoryViewProps {
  server: ServerProfile;
}

function displayMetric(value: number | null, unavailableLabel: string, suffix = "") {
  return value === null ? unavailableLabel : `${value}${suffix}`;
}

function unavailableReason(
  sample: ServerMetricSample,
  key: string,
  translate: (key: string) => string,
) {
  const code = sample.unavailableReasons?.[key];
  return code
    ? translate(`performance.unavailableReason.${code}`)
    : sample.unavailableReason;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function severityBorderColor(level: string): string {
  switch (level.toLowerCase()) {
    case "error":
    case "critical":
      return "var(--color-danger)";
    case "warning":
    case "warn":
      return "var(--color-warning)";
    case "info":
      return "var(--color-accent)";
    default:
      return "var(--border-default)";
  }
}

export function PerformanceHistoryView({
  server,
}: PerformanceHistoryViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const historyQuery = useQuery({
    queryKey: ["performanceHistory", server.id],
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<PerformanceHistory>(
        "get_performance_history",
        {
          serverId: server.id,
        },
      ),
    refetchInterval: 5000,
  });
  const sampleMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<ServerMetricSample>(
        "sample_server_metrics",
        {
          serverId: server.id,
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["performanceHistory", server.id],
      });
    },
  });
  const history = historyQuery.data;
  const latest = history?.samples[0] ?? null;
  const memoryCapacityMb = Math.max(
    server.maxMemoryMb || 0,
    latest?.memoryMb || 0,
    1,
  );

  return (
    <section className="settings-panel" aria-label={t("performance.aria")}>
      <div className="section-heading">
        <h2>{t("performance.title")}</h2>
        <Button
          disabled={sampleMutation.isPending}
          variant="secondary"
          onClick={() => sampleMutation.mutate()}
        >
          <RefreshCw aria-hidden="true" size={15} />
          {t("performance.sample")}
        </Button>
      </div>
      {historyQuery.error ? (
        <p className="danger-text">{historyQuery.error.message}</p>
      ) : null}
      {sampleMutation.error ? (
        <p className="danger-text">{sampleMutation.error.message}</p>
      ) : null}
      {latest ? (
        <>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-card-icon">
                <Cpu aria-hidden="true" size={16} />
              </div>
              <span>{t("performance.cpu")}</span>
              <strong>{displayMetric(latest.cpuPercent, t("performance.unavailable"), "%")}</strong>
              {latest.cpuPercent === null ? <small>{unavailableReason(latest, "cpuPercent", t)}</small> : null}
              {latest.cpuPercent !== null && (
                <Progress.Root
                  className="metric-progress"
                  value={latest.cpuPercent}
                  max={100}
                >
                  <Progress.Indicator
                    className="metric-progress-indicator"
                    style={{ width: `${latest.cpuPercent}%` }}
                  />
                </Progress.Root>
              )}
            </div>
            <div className="metric-card">
              <div className="metric-card-icon">
                <MemoryStick aria-hidden="true" size={16} />
              </div>
              <span>{t("performance.memory")}</span>
              <strong>{displayMetric(latest.memoryMb, t("performance.unavailable"), " MB")}</strong>
              {latest.memoryMb === null ? <small>{unavailableReason(latest, "memoryMb", t)}</small> : null}
              {latest.memoryMb !== null && (
                <Progress.Root
                  className="metric-progress"
                  value={Math.min(latest.memoryMb, memoryCapacityMb)}
                  max={memoryCapacityMb}
                >
                  <Progress.Indicator
                    className="metric-progress-indicator"
                    style={{ width: `${Math.min((latest.memoryMb / memoryCapacityMb) * 100, 100)}%` }}
                  />
                </Progress.Root>
              )}
            </div>
            <div className="metric-card">
              <div className="metric-card-icon">
                <HardDrive aria-hidden="true" size={16} />
              </div>
              <span>{t("performance.diskFree")}</span>
              <strong>{displayMetric(latest.diskFreeMb, t("performance.unavailable"), " MB")}</strong>
              {latest.diskFreeMb === null ? <small>{unavailableReason(latest, "diskFreeMb", t)}</small> : null}
            </div>
            <div className="metric-card">
              <div className="metric-card-icon">
                <Users aria-hidden="true" size={16} />
              </div>
              <span>{t("performance.players")}</span>
              <strong>{displayMetric(latest.playerCount, t("performance.unavailable"))}</strong>
              {latest.playerCount === null ? <small>{unavailableReason(latest, "playerCount", t)}</small> : null}
            </div>
            <div className="metric-card">
              <div className="metric-card-icon">
                <Clock aria-hidden="true" size={16} />
              </div>
              <span>{t("performance.uptime")}</span>
              <strong>{displayMetric(latest.uptimeSeconds, t("performance.unavailable"), " s")}</strong>
              {latest.uptimeSeconds === null ? <small>{unavailableReason(latest, "uptimeSeconds", t)}</small> : null}
            </div>
            <div className="metric-card">
              <div className="metric-card-icon">
                <RotateCcw aria-hidden="true" size={16} />
              </div>
              <span>{t("performance.restarts")}</span>
              <strong>{displayMetric(latest.restartCount, t("performance.unavailable"))}</strong>
              {latest.restartCount === null ? <small>{unavailableReason(latest, "restartCount", t)}</small> : null}
            </div>
            <div className="metric-card">
              <div className="metric-card-icon">
                <Gauge aria-hidden="true" size={16} />
              </div>
              <span>{t("performance.tps")}</span>
              <strong>{displayMetric(latest.tps, t("performance.unavailable"))}</strong>
              {latest.tps === null ? <small>{unavailableReason(latest, "tps", t)}</small> : null}
            </div>
          </div>
          {history?.events.length ? (
            <>
              <Separator.Root className="perf-separator" decorative />
              <div className="perf-events">
                <h3>{t("performance.recentEvents")}</h3>
                {history.events.map((event) => (
                  <div
                    key={`${event.createdAt}-${event.message}`}
                    className="perf-event-item"
                    style={{
                      borderLeftColor: severityBorderColor(event.level),
                    }}
                  >
                    <strong>{event.level}</strong>
                    <span>{event.message}</span>
                    <span>{formatDate(event.createdAt)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <EmptyState
          illustration="/illustrations/no-metrics.png"
          title={t("performance.empty.title")}
          description={t("performance.empty.description")}
        />
      )}
    </section>
  );
}
