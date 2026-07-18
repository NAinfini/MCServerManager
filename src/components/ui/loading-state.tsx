interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "Loading…" }: LoadingStateProps) {
  return (
    <div className="list-state" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true">
        <svg viewBox="0 0 40 40" width="40" height="40">
          <rect className="spinner-block spinner-block-1" x="4" y="4" width="12" height="12" rx="2" />
          <rect className="spinner-block spinner-block-2" x="24" y="4" width="12" height="12" rx="2" />
          <rect className="spinner-block spinner-block-3" x="24" y="24" width="12" height="12" rx="2" />
          <rect className="spinner-block spinner-block-4" x="4" y="24" width="12" height="12" rx="2" />
        </svg>
      </div>
      <span>{message}</span>
    </div>
  );
}
