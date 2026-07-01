import { AlertTriangle } from "lucide-react";
import { useAppSettings } from "../../i18n";
import { cn } from "../../lib/cn";

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

interface StatusBadgeProps {
  status: ServerStatus;
  compact?: boolean;
}

export function StatusBadge({ status, compact = false }: StatusBadgeProps) {
  const { t } = useAppSettings();
  const statusClass =
    status === "externalRunning" ? "status-external" : `status-${status}`;

  return (
    <span
      className={cn("status-badge", statusClass, compact && "status-compact")}
    >
      {status === "crashed" ? (
        <AlertTriangle aria-hidden="true" size={13} />
      ) : null}
      {t(statusLabelKeys[status])}
    </span>
  );
}
