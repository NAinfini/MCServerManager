import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Sparkline } from "../../components/data/Sparkline";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import type { ServerProfile } from "../../domain/server";
import {
  getPerformanceHistory,
  performanceKeys,
  sampleServerMetrics,
  type ServerMetricSample,
} from "./performanceApi";

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

function severityLabel(level: string, t: (key: string) => string) {
  const normalized = level.toLowerCase();
  if (["critical", "error", "warning", "warn", "info"].includes(normalized)) {
    return t(
      `performance.level.${normalized === "warn" ? "warning" : normalized}`,
    );
  }
  return level;
}

export function PerformanceHistoryView({
  server,
}: PerformanceHistoryViewProps) {
  const { language, t } = useAppSettings();
  const queryClient = useQueryClient();
  const historyQuery = useQuery({
    queryKey: performanceKeys.history(server.id),
    queryFn: () => getPerformanceHistory(server.id),
  });
  const sampleMutation = useMutation({
    mutationFn: () => sampleServerMetrics(server.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: performanceKeys.history(server.id),
      });
    },
  });
  const history = historyQuery.data;
  const latest = history?.samples?.[0] ?? null;
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
      {sampleMutation.error ? (
        <p className="danger-text" role="alert">
          {sampleMutation.error.message}
        </p>
      ) : null}
      {historyQuery.isLoading ? (
        <LoadingState message={t("performance.loading")} />
      ) : historyQuery.error ? (
        <div
          aria-label={t("performance.loadError")}
          className="list-state list-state-error"
          role="alert"
        >
          <strong>{t("performance.loadError")}</strong>
          <span>{historyQuery.error.message}</span>
          <Button
            disabled={historyQuery.isFetching}
            variant="secondary"
            onClick={() => historyQuery.refetch()}
          >
            <RefreshCw aria-hidden="true" size={15} />
            {t("common.retry")}
          </Button>
        </div>
      ) : latest ? (
        <>
          <div
            aria-label={t("performance.history.title")}
            className="performance-history-grid"
          >
            <article>
              <div>
                <span>{t("performance.cpu")}</span>
                <strong>
                  {displayMetric(
                    latest.cpuPercent,
                    t("performance.unavailable"),
                    "%",
                  )}
                </strong>
              </div>
              <Sparkline
                label={t("performance.history.cpu")}
                values={[...(history?.samples ?? [])]
                  .reverse()
                  .map((sample) => sample.cpuPercent)}
              />
            </article>
            <article>
              <div>
                <span>{t("performance.memory")}</span>
                <strong>
                  {displayMetric(
                    latest.memoryMb,
                    t("performance.unavailable"),
                    " MB",
                  )}
                </strong>
              </div>
              <Sparkline
                label={t("performance.history.memory")}
                values={[...(history?.samples ?? [])]
                  .reverse()
                  .map((sample) => sample.memoryMb)}
              />
            </article>
            <article>
              <div>
                <span>{t("performance.tps")}</span>
                <strong>
                  {displayMetric(latest.tps, t("performance.unavailable"))}
                </strong>
              </div>
              <Sparkline
                label={t("performance.history.tps")}
                threshold={15}
                values={[...(history?.samples ?? [])]
                  .reverse()
                  .map((sample) => sample.tps)}
              />
            </article>
          </div>
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
                    style={{
                      transform: `scaleX(${latest.cpuPercent / 100})`,
                    }}
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
                    style={{
                      transform: `scaleX(${Math.min(
                        latest.memoryMb / memoryCapacityMb,
                        1,
                      )})`,
                    }}
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
                    <strong>{severityLabel(event.level, t)}</strong>
                    <span>{event.message}</span>
                    <span>{formatDateTime(event.createdAt, language)}</span>
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
