import { useQuery } from "@tanstack/react-query";
import { Cpu, Gauge, Users } from "lucide-react";
import { useAppSettings } from "../../i18n";
import { getPerformanceHistory } from "../performance/performanceApi";
import { performanceKeys } from "../performance/performanceApi";

function value(input: number | null | undefined, suffix = "") {
  if (input === null || input === undefined) return "—";
  return `${Number.isInteger(input) ? input : input.toFixed(1)}${suffix}`;
}

export function ServerHeaderTelemetry({ serverId }: { serverId: string }) {
  const { t } = useAppSettings();
  const historyQuery = useQuery({
    queryKey: performanceKeys.history(serverId),
    queryFn: () => getPerformanceHistory(serverId),
  });
  const latest = historyQuery.data?.samples?.[0];

  return (
    <div
      aria-label={t("server.context.telemetry")}
      className="server-header-telemetry"
    >
      <span title={t("performance.cpu")}>
        <Cpu aria-hidden="true" size={13} />
        {value(latest?.cpuPercent, "%")}
      </span>
      <span title={t("performance.players")}>
        <Users aria-hidden="true" size={13} />
        {value(latest?.playerCount)}
      </span>
      <span title={t("performance.tps")}>
        <Gauge aria-hidden="true" size={13} />
        {value(latest?.tps)}
      </span>
    </div>
  );
}
