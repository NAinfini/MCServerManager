import { useAppSettings } from "../../i18n";

interface LoadingStateProps {
  message?: string;
  variant?: "spinner" | "skeleton";
}

export function LoadingState({ message, variant = "spinner" }: LoadingStateProps) {
  const { t } = useAppSettings();
  const label = message ?? t("common.loading");

  return (
    <div
      className={variant === "skeleton" ? "list-state loading-state-skeleton" : "list-state"}
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
          <svg viewBox="0 0 40 40" width="40" height="40">
            <rect className="spinner-block spinner-block-1" x="4" y="4" width="12" height="12" rx="2" />
            <rect className="spinner-block spinner-block-2" x="24" y="4" width="12" height="12" rx="2" />
            <rect className="spinner-block spinner-block-3" x="24" y="24" width="12" height="12" rx="2" />
            <rect className="spinner-block spinner-block-4" x="4" y="24" width="12" height="12" rx="2" />
          </svg>
        </div>
      )}
      <span>{label}</span>
    </div>
  );
}
