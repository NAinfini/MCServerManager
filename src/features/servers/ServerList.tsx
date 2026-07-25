import { ServerActions } from "./ServerActions";
import { StatusBadge } from "../../components/ui/status-badge";
import type { ManagedProcessStatus } from "../process/api";
import type { ServerProfile } from "./types";
import { LoaderPill } from "../loaders/LoaderIdentity";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { FolderOpen, Plus, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { DataTable, type DataTableColumn } from "../../components/data/DataTable";

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
  const columns: DataTableColumn<ServerProfile>[] = [
    { id: "name", header: t("servers.table.name"), rowHeader: true, sortValue: (server) => server.name, cell: (server) => <button className="table-link-button" type="button" onClick={() => onSelectServer?.(server.id)}>{server.name}</button> },
    { id: "status", header: t("servers.table.status"), cell: (server) => <StatusBadge status={serverStatuses[server.id] ?? "stopped"} /> },
    { id: "loader", header: t("servers.table.loader"), cell: (server) => <LoaderPill loaderType={server.loaderType} minecraftVersion={server.minecraftVersion} /> },
    { id: "port", header: t("servers.table.port"), cell: (server) => server.serverPort ?? t("server.meta.unset") },
    { id: "memory", header: t("servers.table.memory"), cell: (server) => formatMemory(server, t("server.meta.unset")) },
    { id: "lastBackup", header: t("servers.table.lastBackup"), cell: (server) => <ServerLastBackup createdAt={lastBackups[server.id]} /> },
    { id: "actions", header: t("servers.table.actions"), cell: (server) => <ServerActions compact processStatus={serverStatuses[server.id] ?? "stopped"} server={server} /> },
  ];

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
    <div className="server-table-scroll">
      <DataTable caption={t("servers.table.aria")} className="server-table" columns={columns} getRowClassName={(server) => server.id === selectedServerId ? "server-row-selected" : undefined} getRowKey={(server) => server.id} onRowActivate={(server) => onSelectServer?.(server.id)} rows={servers} />
    </div>
  );
}
