import { ServerActions, ServerProcessStatusBadge } from "./ServerActions";
import type { ServerProfile } from "./types";
import { LoaderPill } from "../loaders/LoaderIdentity";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";

interface ServerListProps {
  servers: ServerProfile[];
  isLoading?: boolean;
  error?: Error | null;
  selectedServerId?: string;
  onSelectServer?: (serverId: string) => void;
}

function formatMemory(server: ServerProfile, unsetLabel: string) {
  if (!server.minMemoryMb && !server.maxMemoryMb) {
    return unsetLabel;
  }

  return `${server.minMemoryMb ?? "-"} / ${server.maxMemoryMb ?? "-"} MB`;
}

export function ServerList({
  servers,
  isLoading = false,
  error = null,
  selectedServerId,
  onSelectServer,
}: ServerListProps) {
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
    <div className="server-table-scroll">
      <table className="server-table" aria-label={t("servers.table.aria")}>
        <thead>
          <tr>
            <th scope="col">{t("servers.table.status")}</th>
            <th scope="col">{t("servers.table.name")}</th>
            <th scope="col">{t("servers.table.loader")}</th>
            <th scope="col">{t("servers.table.port")}</th>
            <th scope="col">{t("servers.table.memory")}</th>
            <th scope="col">{t("servers.table.tunnel")}</th>
            <th scope="col">{t("servers.table.lastBackup")}</th>
            <th scope="col">{t("servers.table.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => (
            <tr
              className={
                server.id === selectedServerId
                  ? "server-row-selected"
                  : undefined
              }
              key={server.id}
            >
              <td>
                <ServerProcessStatusBadge serverId={server.id} />
              </td>
              <th scope="row">
                <button
                  className="table-link-button"
                  type="button"
                  onClick={() => onSelectServer?.(server.id)}
                >
                  {server.name}
                </button>
              </th>
              <td>
                <LoaderPill
                  loaderType={server.loaderType}
                  minecraftVersion={server.minecraftVersion}
                />
              </td>
              <td>{server.serverPort ?? t("server.meta.unset")}</td>
              <td>{formatMemory(server, t("server.meta.unset"))}</td>
              <td>{t("servers.table.unavailable")}</td>
              <td>{t("servers.table.notConfigured")}</td>
              <td>
                <ServerActions compact server={server} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
