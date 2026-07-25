import { useQuery } from "@tanstack/react-query";
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
import { cn } from "../../lib/cn";
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
 * Live cards carry the numbers an operator checks first. The history is only
 * requested for servers that are actually up, so an idle dashboard stays quiet.
 */
function ServerCardTelemetry({ serverId }: { serverId: string }) {
  const { t } = useAppSettings();
  const historyQuery = useQuery({
    queryKey: performanceKeys.history(serverId),
    queryFn: () => getPerformanceHistory(serverId),
  });
  const samples = historyQuery.data?.samples ?? [];
  const latest = samples[0];
  const cpuTrend = [...samples]
    .reverse()
    .map((sample) => sample.cpuPercent)
    .filter((value): value is number => typeof value === "number");

  return (
    <div className="server-card-telemetry">
      <span>
        {t("performance.cpu")}
        <b>{metricValue(latest?.cpuPercent, "%")}</b>
      </span>
      <span>
        {t("performance.players")}
        <b>{metricValue(latest?.playerCount)}</b>
      </span>
      <span>
        {t("performance.tps")}
        <b>{metricValue(latest?.tps)}</b>
      </span>
      {/* One sample is a reading, not a trend, and would draw an empty box. */}
      {cpuTrend.length > 1 ? (
        <Sparkline label={t("servers.card.cpuTrend")} values={cpuTrend} />
      ) : null}
    </div>
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
    <li
      className={cn(
        "server-card",
        isLive && "server-card-live",
        selected && "server-card-selected",
      )}
    >
      <div className="server-card-top">
        <ServerCover loaderType={server.loaderType} size={40} />
        <div className="server-card-identity">
          <h3 className="server-card-name">
            {/* The button covers the whole card through ::after, so the card is
                clickable without nesting the action buttons inside a control. */}
            <button
              className="server-card-open"
              type="button"
              onClick={() => onSelect?.(server.id)}
            >
              {server.name}
            </button>
          </h3>
          <p className="server-card-meta">
            <LoaderPill
              loaderType={server.loaderType}
              minecraftVersion={server.minecraftVersion}
            />
            <span>
              {t("server.meta.port", {
                port: server.serverPort ?? t("server.meta.unset"),
              })}
            </span>
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {isLive ? (
        <ServerCardTelemetry serverId={server.id} />
      ) : (
        <dl className="server-card-facts">
          <div>
            <dt>{t("servers.card.memory")}</dt>
            <dd>{formatMemory(server, t("server.meta.unset"))}</dd>
          </div>
          <div>
            <dt>{t("servers.card.lastBackup")}</dt>
            <dd>
              <ServerLastBackup createdAt={lastBackup} />
            </dd>
          </div>
        </dl>
      )}

      <div className="server-card-actions">
        <ServerActions processStatus={status} server={server} />
      </div>
    </li>
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
          <div className="empty-state-actions">
            <Button variant="secondary" onClick={onRetry}>
              <RefreshCw aria-hidden="true" size={15} />
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
      </EmptyState>
    );
  }

  if (servers.length === 0 && filtered) {
    return (
      <EmptyState
        illustration="/illustrations/no-results.png"
        title={t("servers.filter.emptyTitle")}
        description={t("servers.filter.emptyDescription")}
      />
    );
  }

  if (servers.length === 0) {
    return (
      <EmptyState
        illustration="/illustrations/no-servers.png"
        title={t("servers.empty.title")}
        description={t("servers.empty.description")}
      >
        <div className="empty-state-actions">
          {onCreateServer ? (
            <Button variant="primary" onClick={onCreateServer}>
              <Plus aria-hidden="true" size={15} />
              {t("servers.create.button")}
            </Button>
          ) : null}
          {onImportServer ? (
            <Button variant="secondary" onClick={onImportServer}>
              <FolderOpen aria-hidden="true" size={15} />
              {t("servers.import.button")}
            </Button>
          ) : null}
        </div>
      </EmptyState>
    );
  }

  return (
    <ul aria-label={t("servers.grid.aria")} className="server-card-grid">
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
        <li className="server-card-create-item">
          <button
            className="server-card-create"
            type="button"
            onClick={onCreateServer}
          >
            <span aria-hidden="true" className="server-card-create-mark">
              <Plus size={18} />
            </span>
            <strong>{t("servers.card.createTitle")}</strong>
            <span>{t("servers.card.createDescription")}</span>
          </button>
        </li>
      ) : null}
    </ul>
  );
}
