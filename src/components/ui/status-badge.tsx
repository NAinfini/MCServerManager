import { Badge } from "@mantine/core";
import { useAppSettings } from "../../i18n";

export type ServerStatus =
  | "running"
  | "starting"
  | "stopping"
  | "stopped"
  | "crashed"
  | "externalRunning";

const statusLabelKeys: Record<ServerStatus, string> = {
  running: "servers.status.running",
  starting: "servers.status.starting",
  stopping: "servers.status.stopping",
  stopped: "servers.status.stopped",
  crashed: "servers.status.crashed",
  externalRunning: "servers.status.externalRunning",
};

const statusColors: Record<ServerStatus, string> = {
  running: "green",
  starting: "yellow",
  stopping: "yellow",
  stopped: "gray",
  crashed: "red",
  externalRunning: "azure",
};

interface StatusBadgeProps {
  status: ServerStatus;
  compact?: boolean;
}

export function StatusBadge({ status, compact = false }: StatusBadgeProps) {
  const { t } = useAppSettings();
  return (
    <Badge
      className="status-badge"
      color={statusColors[status]}
      data-status={status}
      leftSection={<span aria-hidden="true" className="status-dot" />}
      size={compact ? "sm" : "md"}
      tt="none"
    >
      {t(statusLabelKeys[status])}
    </Badge>
  );
}
