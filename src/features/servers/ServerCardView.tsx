import { useQuery } from "@tanstack/react-query";
import { ServerActions } from "./ServerActions";
import type { ServerProfile } from "./types";
import { LoaderPill } from "../loaders/LoaderIdentity";
import { StatusBadge } from "../../components/ui/status-badge";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { getServerProcessStatus } from "../process/api";
import type { ManagedProcessStatus } from "../process/api";

interface ServerCardViewProps {
  servers: ServerProfile[];
  isLoading?: boolean;
  error?: Error | null;
  selectedServerId?: string;
  onSelectServer?: (serverId: string) => void;
}

const borderColorClass: Record<ManagedProcessStatus, string> = {
  running: "server-card-border-running",
  stopped: "server-card-border-stopped",
  crashed: "server-card-border-crashed",
  externalRunning: "server-card-border-running",
};

function ServerCard({
  server,
  selected,
  onSelect,
}: {
  server: ServerProfile;
  selected: boolean;
  onSelect?: () => void;
}) {
  const { t } = useAppSettings();
  const processQuery = useQuery({
    queryKey: ["serverProcessStatus", server.id],
    queryFn: () => getServerProcessStatus(server.id),
    refetchInterval: 1500,
  });

  const status: ManagedProcessStatus = processQuery.data?.status ?? "stopped";
  const borderClass = borderColorClass[status] ?? "server-card-border-stopped";

  return (
    <div
      className={`server-card ${borderClass}${selected ? " server-card-selected" : ""}`}
    >
      <button
        aria-label={server.name}
        className="server-card-open"
        type="button"
        onClick={onSelect}
      >
        <div className="server-card-header">
          <span className="server-card-name" title={server.name}>
            {server.name}
          </span>
          <StatusBadge status={status} compact />
        </div>

        <div className="server-card-meta">
          <LoaderPill
            loaderType={server.loaderType}
            minecraftVersion={server.minecraftVersion}
          />
          <span className="server-card-port">
            {server.serverPort ?? t("server.meta.unset")}
          </span>
        </div>

        <div className="server-card-memory">
          <div className="server-card-memory-bar">
            <div
              className="server-card-memory-fill"
              style={{
                width: server.maxMemoryMb
                  ? `${Math.min(100, ((server.minMemoryMb ?? 0) / server.maxMemoryMb) * 100)}%`
                  : "0%",
              }}
            />
          </div>
          <span className="server-card-memory-label">
            {server.maxMemoryMb
              ? `${server.minMemoryMb ?? 0} / ${server.maxMemoryMb} MB`
              : t("server.meta.unset")}
          </span>
        </div>
      </button>

      <div className="server-card-actions">
        <ServerActions compact server={server} />
      </div>
    </div>
  );
}

export function ServerCardView({
  servers,
  isLoading = false,
  error = null,
  selectedServerId,
  onSelectServer,
}: ServerCardViewProps) {
  const { t } = useAppSettings();

  if (isLoading) {
    return <LoadingState message={t("servers.loadingProfiles")} />;
  }

  if (error) {
    return (
      <div className="list-state list-state-error">
        <strong>{t("servers.loadProfilesError")}</strong>
        <span>{error.message}</span>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <EmptyState
        illustration="/illustrations/no-servers.png"
        title={t("servers.empty.title")}
        description={t("servers.empty.description")}
      />
    );
  }

  return (
    <div className="server-card-grid">
      {servers.map((server) => (
        <ServerCard
          key={server.id}
          server={server}
          selected={server.id === selectedServerId}
          onSelect={() => onSelectServer?.(server.id)}
        />
      ))}
    </div>
  );
}
