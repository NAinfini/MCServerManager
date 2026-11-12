import { useQuery } from "@tanstack/react-query";
import {
  Accordion,
  Badge,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { PlayerHead } from "../../components/ui/player-head";
import { useAppSettings } from "../../i18n";
import { ServerEventsView } from "../activity/ServerEventsView";
import { DiagnosticsView } from "../diagnostics/DiagnosticsView";
import { PerformanceHistoryView } from "../performance/PerformanceHistoryView";
import { listPlayers } from "../players/api";
import { playerKeys } from "../players/queries";
import { formatDate } from "../../lib/date-format";
import { ServerSetupChecklist } from "./ServerSetupChecklist";
import type { ServerProfile } from "./types";

/**
 * Who is actually on the server right now. The roster is read from the live
 * player state, so an unreachable server says why instead of showing an empty
 * list that reads like "nobody is playing".
 */
function OverviewPlayers({ serverId }: { serverId: string }) {
  const { t } = useAppSettings();
  const playersQuery = useQuery({
    queryKey: playerKeys.list(serverId),
    queryFn: () => listPlayers(serverId),
  });
  const online = (playersQuery.data?.players ?? []).filter(
    (player) => player.online,
  );

  return (
    <Paper
      aria-label={t("server.overview.online.title")}
      component="section"
      p="md"
    >
      <Group justify="space-between" mb="sm">
        <Title order={3} fz="sm">
          {t("server.overview.online.title")}
        </Title>
        <Text ff="monospace" fw={600} size="sm">
          {playersQuery.data ? online.length : "—"}
        </Text>
      </Group>
      {playersQuery.error ? (
        <Text c="yellow" role="alert" size="sm">
          {playersQuery.error.message}
        </Text>
      ) : playersQuery.data?.unavailableReason ? (
        <Text c="yellow" size="sm">
          {playersQuery.data.unavailableReason}
        </Text>
      ) : online.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t("server.overview.online.empty")}
        </Text>
      ) : (
        <Stack component="ul" gap={6} m={0} p={0} style={{ listStyle: "none" }}>
          {online.slice(0, 8).map((player) => (
            <Group component="li" gap="xs" key={player.uuid ?? player.username}>
              <PlayerHead
                size={18}
                username={player.username}
                uuid={player.uuid}
              />
              <Text size="sm">{player.username}</Text>
              {player.operator ? (
                <Badge size="xs" variant="light">
                  {t("players.state.operator")}
                </Badge>
              ) : null}
            </Group>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

export function ServerOverviewWorkspace({
  server,
  onOpenJava,
}: {
  server: ServerProfile;
  onOpenJava?: () => void;
}) {
  const { language, t } = useAppSettings();

  const facts = [
    {
      label: t("server.overview.rootFolder"),
      value: server.rootDir,
      mono: true,
    },
    {
      label: t("server.overview.restartPolicy"),
      value: server.restartPolicy.enabled
        ? t("server.overview.restartOnCrash", {
            attempts: server.restartPolicy.maxAttempts,
          })
        : t("server.overview.restartDisabled"),
    },
    {
      label: t("server.overview.autoStart"),
      value: server.autoStart
        ? t("server.overview.enabled")
        : t("server.overview.disabled"),
    },
    {
      label: t("server.overview.lastUpdated"),
      value: formatDate(server.updatedAt, language),
    },
  ];

  return (
    <Stack gap="md">
      <ServerSetupChecklist server={server} onOpenJava={onOpenJava} />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <PerformanceHistoryView server={server} />
        <DiagnosticsView server={server} />
        <ServerEventsView serverId={server.id} />
        <OverviewPlayers serverId={server.id} />
      </SimpleGrid>
      <Accordion variant="contained">
        <Accordion.Item value="config">
          <Accordion.Control>
            {t("server.overview.configTitle")}
          </Accordion.Control>
          <Accordion.Panel>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <Text c="dimmed" size="xs">
                    {fact.label}
                  </Text>
                  <Text
                    ff={fact.mono ? "monospace" : undefined}
                    size="sm"
                    style={{ overflowWrap: "anywhere" }}
                  >
                    {fact.value}
                  </Text>
                </div>
              ))}
            </SimpleGrid>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
