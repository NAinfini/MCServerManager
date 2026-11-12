import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Clock, HardDrive, RefreshCw, RotateCcw, Users } from "lucide-react";
import {
  Alert,
  Box,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
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
    <Group c="dimmed" fz="xs" gap="sm">
      {spread ? (
        <>
          <span>
            {t("performance.range.peak")}{" "}
            <Text c="bright" ff="monospace" fw={600} inherit span>
              {Math.max(...samples)}
              {suffix}
            </Text>
          </span>
          <span>
            {t("performance.range.low")}{" "}
            <Text c="bright" ff="monospace" fw={600} inherit span>
              {Math.min(...samples)}
              {suffix}
            </Text>
          </span>
        </>
      ) : null}
      {limit ? (
        <span>
          {t("performance.range.limit")}{" "}
          <Text c="bright" ff="monospace" fw={600} inherit span>
            {limit}
          </Text>
        </span>
      ) : null}
    </Group>
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
    <Group align="flex-start" gap="xs" wrap="nowrap">
      <Box c="dimmed" mt={2}>
        {icon}
      </Box>
      <Stack gap={0} miw={0}>
        <Text c="dimmed" size="xs">
          {label}
        </Text>
        <Text ff="monospace" fw={600} size="sm">
          {value}
        </Text>
        {reason ? (
          <Text c="dimmed" size="xs">
            {reason}
          </Text>
        ) : null}
      </Stack>
    </Group>
  );
}

function SeriesTile({
  label,
  value,
  reason,
  children,
}: {
  label: string;
  value: string;
  reason?: string | null;
  children: ReactNode;
}) {
  return (
    <Stack
      bg="var(--mantine-color-default-hover)"
      component="article"
      gap={6}
      p="sm"
      style={{ borderRadius: "var(--mantine-radius-md)" }}
    >
      <Group align="baseline" justify="space-between" wrap="nowrap">
        <Text c="dimmed" size="xs">
          {label}
        </Text>
        <Text ff="monospace" fw={650} size="lg">
          {value}
        </Text>
      </Group>
      {children}
      {reason ? (
        <Text c="dimmed" size="xs">
          {reason}
        </Text>
      ) : null}
    </Stack>
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
    <Paper aria-label={t("performance.aria")} component="section" p="md">
      <Group align="flex-start" justify="space-between" mb="sm" wrap="nowrap">
        <Stack gap={2}>
          <Title order={2} size="h4">
            {t("performance.title")}
          </Title>
          {/* Every number below is one reading taken at one moment. Without its
              timestamp a stale sample reads exactly like a live one. */}
          {latest ? (
            <Text c="dimmed" size="xs">
              {t("performance.lastSample", {
                time: formatDateTime(latest.sampledAt, language),
              })}
            </Text>
          ) : null}
        </Stack>
        <Button
          disabled={sampleMutation.isPending}
          variant="secondary"
          onClick={() => sampleMutation.mutate()}
        >
          <RefreshCw aria-hidden="true" size={16} />
          {t("performance.sample")}
        </Button>
      </Group>
      {sampleMutation.error ? (
        <Text c="red" mb="sm" role="alert" size="sm">
          {sampleMutation.error.message}
        </Text>
      ) : null}
      {historyQuery.isLoading ? (
        <LoadingState message={t("performance.loading")} />
      ) : historyQuery.error ? (
        <Alert
          aria-label={t("performance.loadError")}
          color="red"
          role="alert"
          title={t("performance.loadError")}
          variant="light"
        >
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{historyQuery.error.message}</Text>
            <Button
              disabled={historyQuery.isFetching}
              variant="secondary"
              onClick={() => historyQuery.refetch()}
            >
              <RefreshCw aria-hidden="true" size={16} />
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : latest ? (
        <Stack gap="md">
          <SimpleGrid
            aria-label={t("performance.history.title")}
            cols={{ base: 1, sm: 3 }}
            spacing="sm"
          >
            <SeriesTile
              label={t("performance.cpu")}
              reason={
                latest.cpuPercent === null
                  ? unavailableReason(latest, "cpuPercent", t)
                  : null
              }
              value={displayMetric(
                latest.cpuPercent,
                t("performance.unavailable"),
                "%",
              )}
            >
              <Sparkline
                formatValue={(value) => `${value}%`}
                label={t("performance.history.cpu")}
                max={100}
                values={cpuSeries}
              />
              <SeriesRange limit="100%" suffix="%" t={t} values={cpuSeries} />
            </SeriesTile>
            <SeriesTile
              label={t("performance.memory")}
              reason={
                latest.memoryMb === null
                  ? unavailableReason(latest, "memoryMb", t)
                  : null
              }
              value={displayMetric(
                latest.memoryMb,
                t("performance.unavailable"),
                " MB",
              )}
            >
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
            </SeriesTile>
            <SeriesTile
              label={t("performance.tps")}
              reason={
                latest.tps === null ? unavailableReason(latest, "tps", t) : null
              }
              value={displayMetric(latest.tps, t("performance.unavailable"))}
            >
              <Sparkline
                label={t("performance.history.tps")}
                max={20}
                threshold={15}
                values={tpsSeries}
              />
              {/* 20 is the tick rate a healthy Minecraft server holds, so it is
                  the ceiling this curve is read against. */}
              <SeriesRange limit="20" t={t} values={tpsSeries} />
            </SeriesTile>
          </SimpleGrid>
          {/* CPU, memory and TPS already have a tile each above, with the
              history the stats never had. Only the metrics with no curve are
              left here. */}
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
            <Stat
              icon={<HardDrive aria-hidden="true" size={16} />}
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
              icon={<Users aria-hidden="true" size={16} />}
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
              icon={<Clock aria-hidden="true" size={16} />}
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
              icon={<RotateCcw aria-hidden="true" size={16} />}
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
          </SimpleGrid>
          {/* The recent-event list that used to sit here duplicated the Events
              panel beside it on the overview — the same crash printed twice,
              and a stack trace was long enough to push this card past its
              cell and clip its own heading. */}
        </Stack>
      ) : (
        <EmptyState
          title={t("performance.empty.title")}
          description={t("performance.empty.description")}
        />
      )}
    </Paper>
  );
}
