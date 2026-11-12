import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Card,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { FolderOpen, Plus, RefreshCw } from "lucide-react";
import { ServerActions } from "./ServerActions";
import { StatusBadge } from "../../components/ui/status-badge";
import type { ManagedProcessStatus } from "../process/api";
import type { ServerProfile } from "./types";
import { LoaderPill } from "../loaders/LoaderIdentity";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { ServerCover } from "../../components/ui/server-cover";
import { Sparkline } from "../../components/data/Sparkline";
import { useAppSettings } from "../../i18n";
import {
  getPerformanceHistory,
  performanceKeys,
} from "../performance/performanceApi";

interface ServerListProps {
  servers: ServerProfile[];
  isLoading?: boolean;
  error?: Error | null;
  selectedServerId?: string;
  onSelectServer?: (serverId: string) => void;
  onCreateServer?: () => void;
  onImportServer?: () => void;
  onRetry?: () => void;
  lastBackups?: Record<string, string | null>;
  serverStatuses?: Record<string, ManagedProcessStatus>;
  /** True when a name filter hid every server, so the empty state must say so. */
  filtered?: boolean;
}

/** Statuses where the server is live enough to have metrics worth sampling. */
const liveStatuses = new Set<ManagedProcessStatus>([
  "running",
  "stopping",
  "externalRunning",
]);

function formatMemory(server: ServerProfile, unsetLabel: string) {
  if (!server.minMemoryMb && !server.maxMemoryMb) {
    return unsetLabel;
  }

  return `${server.minMemoryMb ?? "-"} / ${server.maxMemoryMb ?? "-"} MB`;
}

function ServerLastBackup({ createdAt }: { createdAt?: string | null }) {
  const { language, t } = useAppSettings();
  if (!createdAt) {
    return <>{t("backups.lastBackupNone")}</>;
  }

  return (
    <>
      {new Intl.DateTimeFormat(language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(createdAt))}
    </>
  );
}

function metricValue(input: number | null | undefined, suffix = "") {
  if (input === null || input === undefined) return "—";
  return `${Number.isInteger(input) ? input : input.toFixed(1)}${suffix}`;
}

/**
 * Every card carries the same CPU curve, so a two-server dashboard still reads
 * as a dashboard instead of two labels floating in an empty row. A stopped
 * server draws the history it actually recorded — never a placeholder shape.
 * With no samples at all the sparkline says so rather than inventing one.
 */
function ServerCardTrend({ serverId }: { serverId: string }) {
  const { t } = useAppSettings();
  const historyQuery = useQuery({
    queryKey: performanceKeys.history(serverId),
    queryFn: () => getPerformanceHistory(serverId),
  });
  const samples = historyQuery.data?.samples ?? [];
  const latest = samples[0];

  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text c="dimmed" size="xs">
          {t("servers.card.cpuTrend")}
        </Text>
        <Text ff="monospace" fw={600} size="xs">
          {metricValue(latest?.cpuPercent, "%")}
        </Text>
      </Group>
      <Progress
        aria-hidden="true"
        size="xs"
        value={Math.min(latest?.cpuPercent ?? 0, 100)}
      />
      <Sparkline
        formatValue={(value) => `${value}%`}
        label={t("servers.card.cpuTrend")}
        max={100}
        values={[...samples].reverse().map((sample) => sample.cpuPercent)}
      />
    </Stack>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <Text c="dimmed" size="xs">
        {label}
      </Text>
      <Text ff="monospace" fw={500} size="sm">
        {value}
      </Text>
    </div>
  );
}

/** The numbers an operator checks first, only meaningful while the server is up. */
function ServerCardTelemetry({ serverId }: { serverId: string }) {
  const { t } = useAppSettings();
  const historyQuery = useQuery({
    queryKey: performanceKeys.history(serverId),
    queryFn: () => getPerformanceHistory(serverId),
  });
  const latest = historyQuery.data?.samples?.[0];

  return (
    <>
      <Fact
        label={t("performance.cpu")}
        value={metricValue(latest?.cpuPercent, "%")}
      />
      <Fact
        label={t("performance.players")}
        value={metricValue(latest?.playerCount)}
      />
      <Fact label={t("performance.tps")} value={metricValue(latest?.tps)} />
    </>
  );
}

interface ServerCardProps {
  server: ServerProfile;
  status: ManagedProcessStatus;
  lastBackup?: string | null;
  selected: boolean;
  onSelect?: (serverId: string) => void;
}

function ServerCard({
  server,
  status,
  lastBackup,
  selected,
  onSelect,
}: ServerCardProps) {
  const { t } = useAppSettings();
  const isLive = liveStatuses.has(status);

  return (
    <Card
      component="li"
      style={{
        cursor: "pointer",
        borderColor: selected ? "var(--mantine-color-azure-6)" : undefined,
      }}
      withBorder
      /* The whole card opens the server; its own controls, and anything they
         portal out (a confirm dialog), keep their clicks. */
      onClick={(event) => {
        const target = event.target as Element;
        if (
          !event.currentTarget.contains(target) ||
          target.closest("button, a, input")
        ) {
          return;
        }
        onSelect?.(server.id);
      }}
    >
      <Stack gap="md">
        <Group align="flex-start" gap="sm" wrap="nowrap">
          <ServerCover loaderType={server.loaderType} size={40} />
          <Stack gap={4} miw={0} style={{ flex: 1 }}>
            <Title order={3} fz="md">
              <UnstyledButton
                fw="inherit"
                fz="inherit"
                maw="100%"
                style={{ overflowWrap: "anywhere" }}
                onClick={() => onSelect?.(server.id)}
              >
                {server.name}
              </UnstyledButton>
            </Title>
            <Group gap="xs">
              <LoaderPill
                loaderType={server.loaderType}
                minecraftVersion={server.minecraftVersion}
              />
              <Text c="dimmed" ff="monospace" size="xs">
                {t("server.meta.port", {
                  port: server.serverPort ?? t("server.meta.unset"),
                })}
              </Text>
            </Group>
          </Stack>
          <StatusBadge status={status} />
        </Group>

        <SimpleGrid cols={{ base: 2, xs: isLive ? 3 : 2 }} spacing="sm">
          {isLive ? <ServerCardTelemetry serverId={server.id} /> : null}
          <Fact
            label={t("servers.card.memory")}
            value={formatMemory(server, t("server.meta.unset"))}
          />
          <Fact
            label={t("servers.card.lastBackup")}
            value={<ServerLastBackup createdAt={lastBackup} />}
          />
        </SimpleGrid>

        <ServerCardTrend serverId={server.id} />

        <Group justify="flex-end">
          <ServerActions processStatus={status} server={server} />
        </Group>
      </Stack>
    </Card>
  );
}

export function ServerList({
  servers,
  isLoading = false,
  error = null,
  selectedServerId,
  onSelectServer,
  onCreateServer,
  onImportServer,
  onRetry,
  lastBackups = {},
  serverStatuses = {},
  filtered = false,
}: ServerListProps) {
  const { t } = useAppSettings();

  if (isLoading) {
    return <LoadingState message={t("servers.loadingProfiles")} />;
  }

  if (error) {
    return (
      <EmptyState
        role="alert"
        title={t("servers.loadProfilesError")}
        description={error.message}
      >
        {onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            <RefreshCw aria-hidden="true" size={16} />
            {t("common.retry")}
          </Button>
        ) : null}
      </EmptyState>
    );
  }

  if (servers.length === 0 && filtered) {
    return (
      <EmptyState
        title={t("servers.filter.emptyTitle")}
        description={t("servers.filter.emptyDescription")}
      />
    );
  }

  if (servers.length === 0) {
    return (
      <EmptyState
        title={t("servers.empty.title")}
        description={t("servers.empty.description")}
      >
        <Group gap="sm" justify="center">
          {onCreateServer ? (
            <Button variant="primary" onClick={onCreateServer}>
              <Plus aria-hidden="true" size={16} />
              {t("servers.create.button")}
            </Button>
          ) : null}
          {onImportServer ? (
            <Button variant="secondary" onClick={onImportServer}>
              <FolderOpen aria-hidden="true" size={16} />
              {t("servers.import.button")}
            </Button>
          ) : null}
        </Group>
      </EmptyState>
    );
  }

  return (
    <Box
      aria-label={t("servers.grid.aria")}
      component="ul"
      m={0}
      p={0}
      style={{
        display: "grid",
        gap: "var(--mantine-spacing-md)",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        listStyle: "none",
      }}
    >
      {servers.map((server) => (
        <ServerCard
          key={server.id}
          lastBackup={lastBackups[server.id]}
          selected={server.id === selectedServerId}
          server={server}
          status={serverStatuses[server.id] ?? "stopped"}
          onSelect={onSelectServer}
        />
      ))}
      {/* Hidden while filtering: a create tile next to "no matches" reads as a
          search result rather than an action. */}
      {onCreateServer && !filtered ? (
        <li>
          <UnstyledButton
            h="100%"
            mih={180}
            p="md"
            style={{
              border: "1px dashed var(--mantine-color-default-border)",
              borderRadius: "var(--mantine-radius-md)",
            }}
            w="100%"
            onClick={onCreateServer}
          >
            <Stack align="center" gap={6}>
              <ThemeIcon
                aria-hidden="true"
                radius="xl"
                size="lg"
                variant="light"
              >
                <Plus size={16} />
              </ThemeIcon>
              <Text fw={600} size="sm">
                {t("servers.card.createTitle")}
              </Text>
              <Text c="dimmed" size="xs" ta="center">
                {t("servers.card.createDescription")}
              </Text>
            </Stack>
          </UnstyledButton>
        </li>
      ) : null}
    </Box>
  );
}
