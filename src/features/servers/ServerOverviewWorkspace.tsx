import { useQuery } from "@tanstack/react-query";
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
    <section
      aria-label={t("server.overview.online.title")}
      className="overview-cell-narrow overview-column"
    >
      <header className="overview-column-head">
        <h3>{t("server.overview.online.title")}</h3>
        <b>{playersQuery.data ? online.length : "—"}</b>
      </header>
      {playersQuery.error ? (
        <p
          className="overview-column-note overview-column-note-warn"
          role="alert"
        >
          {playersQuery.error.message}
        </p>
      ) : playersQuery.data?.unavailableReason ? (
        <p className="overview-column-note overview-column-note-warn">
          {playersQuery.data.unavailableReason}
        </p>
      ) : online.length === 0 ? (
        <p className="overview-column-note">
          {t("server.overview.online.empty")}
        </p>
      ) : (
        <ul className="overview-player-list">
          {online.slice(0, 8).map((player) => (
            <li key={player.uuid ?? player.username}>
              <span>{player.username}</span>
              {player.operator ? <em>{t("players.state.operator")}</em> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
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

  return (
    <div className="server-overview-workspace">
      <ServerSetupChecklist server={server} onOpenJava={onOpenJava} />
      <div className="server-overview-grid">
        <section className="overview-cell overview-performance">
          <PerformanceHistoryView server={server} />
        </section>
        <section className="overview-cell overview-diagnostics">
          <DiagnosticsView server={server} />
        </section>
        <section className="overview-cell overview-events">
          <ServerEventsView serverId={server.id} />
        </section>
        <OverviewPlayers serverId={server.id} />
      </div>
      <details className="server-overview-config">
        <summary>{t("server.overview.configTitle")}</summary>
        <dl className="overview-config-grid">
          <div>
            <dt>{t("server.overview.rootFolder")}</dt>
            <dd>{server.rootDir}</dd>
          </div>
          <div>
            <dt>{t("server.overview.restartPolicy")}</dt>
            <dd>
              {server.restartPolicy.enabled
                ? t("server.overview.restartOnCrash", {
                    attempts: server.restartPolicy.maxAttempts,
                  })
                : t("server.overview.restartDisabled")}
            </dd>
          </div>
          <div>
            <dt>{t("server.overview.autoStart")}</dt>
            <dd>
              {server.autoStart
                ? t("server.overview.enabled")
                : t("server.overview.disabled")}
            </dd>
          </div>
          <div>
            <dt>{t("server.overview.lastUpdated")}</dt>
            <dd>{formatDate(server.updatedAt, language)}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
