import { LoaderCircle } from "lucide-react";
import { useAppSettings } from "../../i18n";

interface LoadingStateProps {
  message?: string;
  variant?: "spinner" | "skeleton";
}

export function LoadingState({
  message,
  variant = "spinner",
}: LoadingStateProps) {
  const { t } = useAppSettings();
  const label = message ?? t("common.loading");

  return (
    <div
      className={
        variant === "skeleton"
          ? "list-state loading-state-skeleton"
          : "list-state"
      }
      role="status"
      aria-live="polite"
    >
      {variant === "skeleton" ? (
        <div className="loading-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="loading-spinner" aria-hidden="true">
          <LoaderCircle size={28} strokeWidth={2} />
        </div>
      )}
      <span>{label}</span>
    </div>
  );
}
