import { useQuery } from "@tanstack/react-query";
import { Group, Paper, Stack, Text, Title } from "@mantine/core";
import { PlayerHead } from "../../components/ui/player-head";
import { useAppSettings } from "../../i18n";
import {
  getPerformanceHistory,
  performanceKeys,
} from "../performance/performanceApi";
import { listPlayers } from "../players/api";
import { playerKeys } from "../players/queries";
import type { ServerProfile } from "./types";

function formatMemory(memoryMb: number, maxMemoryMb?: number | null) {
  const used = (memoryMb / 1024).toFixed(1);
  return maxMemoryMb
    ? `${used} / ${Math.round(maxMemoryMb / 1024)} GB`
    : `${used} GB`;
}

/* The numbers worth glancing at beside the console. A missing value stays
   visibly missing, because a blank or a zero would read as a measurement. */
export function ServerLiveRail({ server }: { server: ServerProfile }) {
  const { t } = useAppSettings();
  const historyQuery = useQuery({
    queryKey: performanceKeys.history(server.id),
    queryFn: () => getPerformanceHistory(server.id),
  });
  const playersQuery = useQuery({
    queryKey: playerKeys.list(server.id),
    queryFn: () => listPlayers(server.id),
  });
  const latest = historyQuery.data?.samples?.[0];
  const online = (playersQuery.data?.players ?? []).filter(
    (player) => player.online,
  );

  const stats = [
    {
      label: t("performance.tps"),
      value: latest?.tps == null ? "—" : latest.tps.toFixed(1),
    },
    {
      label: t("performance.memory"),
      value:
        latest?.memoryMb == null
          ? "—"
          : formatMemory(latest.memoryMb, server.maxMemoryMb),
    },
    {
      label: t("performance.cpu"),
      value:
        latest?.cpuPercent == null ? "—" : `${Math.round(latest.cpuPercent)}%`,
    },
  ];

  return (
    <Stack component="aside" gap="sm" miw={0} w={216} style={{ flex: "none" }}>
      <Paper
        aria-label={t("server.context.telemetry")}
        component="dl"
        m={0}
        p="sm"
      >
        <Stack gap="xs">
          {stats.map((stat) => (
            <Group justify="space-between" key={stat.label} wrap="nowrap">
              <Text c="dimmed" component="dt" size="xs">
                {stat.label}
              </Text>
              <Text component="dd" ff="monospace" fw={600} m={0} size="sm">
                {stat.value}
              </Text>
            </Group>
          ))}
        </Stack>
      </Paper>
      <Paper
        aria-label={t("server.overview.online.title")}
        component="section"
        mih={0}
        p="sm"
        style={{ flex: 1, overflow: "auto" }}
      >
        <Title mb="xs" order={3} fz="sm">
          {t("server.rail.online", {
            count: playersQuery.data ? online.length : "—",
          })}
        </Title>
        {playersQuery.data?.unavailableReason ? (
          <Text c="dimmed" size="xs">
            {playersQuery.data.unavailableReason}
          </Text>
        ) : online.length === 0 ? (
          <Text c="dimmed" size="xs">
            {t("server.rail.onlineEmpty")}
          </Text>
        ) : (
          <Stack
            component="ul"
            gap={6}
            m={0}
            p={0}
            style={{ listStyle: "none" }}
          >
            {online.slice(0, 12).map((player) => (
              <Group
                component="li"
                gap="xs"
                key={player.uuid ?? player.username}
                wrap="nowrap"
              >
                <PlayerHead
                  size={18}
                  username={player.username}
                  uuid={player.uuid}
                />
                <Text size="sm" truncate>
                  {player.username}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
