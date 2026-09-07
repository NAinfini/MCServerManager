import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Clock, HardDrive, RefreshCw, RotateCcw, Users } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Sparkline } from "../../components/data/Sparkline";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import { formatDuration, formatMegabytes } from "../../lib/format-units";
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

function displayMetric(
  value: number | null,
  unavailableLabel: string,
  suffix = "",
) {
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

/* A curve on its own says "it moved", not "how far". The peak and floor of the
   window it actually drew are the two numbers that make it readable, and the
   limit is only shown for the metrics that have one. */
function SeriesRange({
  limit,
  suffix = "",
  t,
  values,
}: {
  limit?: string;
  suffix?: string;
  t: (key: string) => string;
  values: Array<number | null | undefined>;
}) {
  const samples = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  /* One sample, or a flat run, has no spread to report: printing the same
     number twice as "peak" and "low" would dress a single reading up as a
     trend. */
  const spread =
    samples.length > 1 && Math.min(...samples) !== Math.max(...samples);
  if (!spread && !limit) return null;
  return (
    <p className="performance-series-range">
      {spread ? (
        <>
          <span>
            {t("performance.range.peak")}{" "}
            <strong>
              {Math.max(...samples)}
              {suffix}
            </strong>
          </span>
          <span>
            {t("performance.range.low")}{" "}
            <strong>
              {Math.min(...samples)}
              {suffix}
            </strong>
          </span>
        </>
      ) : null}
      {limit ? (
        <span>
          {t("performance.range.limit")} <strong>{limit}</strong>
        </span>
      ) : null}
    </p>
  );
}

/* The four metrics with no curve behind them. They are readouts, not charts, so
   they sit in one compact strip instead of borrowing the card shape used by the
   series above — four tall boxes for four single numbers was what left the
   panel with a block of empty canvas under them. */
function Stat({
  icon,
  label,
  reason,
  value,
}: {
  icon: ReactNode;
  label: string;
  reason?: string | null;
  value: string;
}) {
  return (
    <div className="performance-stat">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      {reason ? <small>{reason}</small> : null}
    </div>
  );
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
  /* The backend returns newest first; the charts read left to right. */
  const chronological = [...(history?.samples ?? [])].reverse();
  const cpuSeries = chronological.map((sample) => sample.cpuPercent);
  const memorySeries = chronological.map((sample) => sample.memoryMb);
  const tpsSeries = chronological.map((sample) => sample.tps);

  return (
    <section
      className="settings-panel performance-panel"
      aria-label={t("performance.aria")}
    >
      <div className="section-heading">
        <div className="section-heading-copy">
          <h2>{t("performance.title")}</h2>
          {/* Every number below is one reading taken at one moment. Without its
              timestamp a stale sample reads exactly like a live one. */}
          {latest ? (
            <span>
              {t("performance.lastSample", {
                time: formatDateTime(latest.sampledAt, language),
              })}
            </span>
          ) : null}
        </div>
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
        <div className="performance-body">
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
                formatValue={(value) => `${value}%`}
                label={t("performance.history.cpu")}
                max={100}
                values={cpuSeries}
              />
              <SeriesRange limit="100%" suffix="%" t={t} values={cpuSeries} />
              {latest.cpuPercent === null ? (
                <small>{unavailableReason(latest, "cpuPercent", t)}</small>
              ) : null}
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
                formatValue={(value) => `${value} MB`}
                label={t("performance.history.memory")}
                max={server.maxMemoryMb ?? undefined}
                values={memorySeries}
              />
              <SeriesRange
                limit={
                  server.maxMemoryMb ? `${server.maxMemoryMb} MB` : undefined
                }
                suffix=" MB"
                t={t}
                values={memorySeries}
              />
              {latest.memoryMb === null ? (
                <small>{unavailableReason(latest, "memoryMb", t)}</small>
              ) : null}
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
                max={20}
                threshold={15}
                values={tpsSeries}
              />
              {/* 20 is the tick rate a healthy Minecraft server holds, so it is
                  the ceiling this curve is read against. */}
              <SeriesRange limit="20" t={t} values={tpsSeries} />
              {latest.tps === null ? (
                <small>{unavailableReason(latest, "tps", t)}</small>
              ) : null}
            </article>
          </div>
          {/* CPU, memory and TPS already have a card each above, with the
              history the tiles never had. Only the metrics with no curve are
              left here. */}
          <div className="performance-stat-grid">
            <Stat
              icon={<HardDrive aria-hidden="true" size={15} />}
              label={t("performance.diskFree")}
              reason={
                latest.diskFreeMb === null
                  ? unavailableReason(latest, "diskFreeMb", t)
                  : null
              }
              value={
                latest.diskFreeMb === null
                  ? t("performance.unavailable")
                  : formatMegabytes(latest.diskFreeMb)
              }
            />
            <Stat
              icon={<Users aria-hidden="true" size={15} />}
              label={t("performance.players")}
              reason={
                latest.playerCount === null
                  ? unavailableReason(latest, "playerCount", t)
                  : null
              }
              value={displayMetric(
                latest.playerCount,
                t("performance.unavailable"),
              )}
            />
            <Stat
              icon={<Clock aria-hidden="true" size={15} />}
              label={t("performance.uptime")}
              reason={
                latest.uptimeSeconds === null
                  ? unavailableReason(latest, "uptimeSeconds", t)
                  : null
              }
              value={
                latest.uptimeSeconds === null
                  ? t("performance.unavailable")
                  : formatDuration(latest.uptimeSeconds, t)
              }
            />
            <Stat
              icon={<RotateCcw aria-hidden="true" size={15} />}
              label={t("performance.restarts")}
              reason={
                latest.restartCount === null
                  ? unavailableReason(latest, "restartCount", t)
                  : null
              }
              value={displayMetric(
                latest.restartCount,
                t("performance.unavailable"),
              )}
            />
          </div>
          {/* The recent-event list that used to sit here duplicated the Events
              panel beside it on the overview — the same crash printed twice,
              and a stack trace was long enough to push this card past its
              cell and clip its own heading. */}
        </div>
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
