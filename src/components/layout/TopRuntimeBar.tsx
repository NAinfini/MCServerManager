import { AlertCircle, CircleDot } from "lucide-react";
import { useAppSettings } from "../../i18n";

interface TopRuntimeBarProps {
  runningCount?: number;
  crashedCount?: number;
  warningCount?: number;
}

export function TopRuntimeBar({
  runningCount = 0,
  crashedCount = 0,
  warningCount = 0,
}: TopRuntimeBarProps) {
  const { t } = useAppSettings();

  return (
    <header className="runtime-bar" aria-label={t("runtime.aria")}>
      <div className="runtime-bar-left">
        {/* Idle is the resting state, so it is reported by absence like the other
            two badges; the dashboard still carries the explicit zero. */}
        {runningCount > 0 && (
          <span className="runtime-bar-badge runtime-bar-badge-running">
            <CircleDot aria-hidden="true" size={12} />
            {t("runtime.running", { count: runningCount })}
          </span>
        )}
        {crashedCount > 0 && (
          <span className="runtime-bar-badge runtime-bar-badge-crashed">
            <CircleDot aria-hidden="true" size={12} />
            {t("runtime.crashed", { count: crashedCount })}
          </span>
        )}
        {warningCount > 0 && (
          <span className="runtime-bar-badge runtime-bar-badge-warning">
            <AlertCircle aria-hidden="true" size={12} />
            {t("runtime.warnings", { count: warningCount })}
          </span>
        )}
      </div>
    </header>
  );
}
