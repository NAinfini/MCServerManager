import { useQuery } from "@tanstack/react-query";
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
    <aside className="server-live-rail">
      <dl
        aria-label={t("server.context.telemetry")}
        className="server-live-stats"
      >
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>
      <section
        aria-label={t("server.overview.online.title")}
        className="server-live-players"
      >
        <h3>
          {t("server.rail.online", {
            count: playersQuery.data ? online.length : "—",
          })}
        </h3>
        {playersQuery.data?.unavailableReason ? (
          <p>{playersQuery.data.unavailableReason}</p>
        ) : online.length === 0 ? (
          <p>{t("server.rail.onlineEmpty")}</p>
        ) : (
          <ul>
            {online.slice(0, 12).map((player) => (
              <li key={player.uuid ?? player.username}>
                <PlayerHead username={player.username} size={18} />
                <span>{player.username}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
