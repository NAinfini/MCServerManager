import type { ReactNode } from "react";

interface EmptyStateProps {
  illustration?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}

export function EmptyState({
  illustration,
  title,
  description,
  children,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      {illustration ? (
        <img
          alt=""
          aria-hidden="true"
          className="empty-state-illustration"
          src={illustration}
        />
      ) : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {children}
    </div>
  );
}
