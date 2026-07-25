import type { ReactNode } from "react";
import { publicAssetUrl } from "../../lib/public-asset";

interface EmptyStateProps {
  illustration?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  role?: "alert" | "status";
}

export function EmptyState({
  illustration,
  title,
  description,
  children,
  role,
}: EmptyStateProps) {
  return (
    <div className="empty-state" role={role}>
      {illustration ? (
        <img
          alt=""
          aria-hidden="true"
          className="empty-state-illustration"
          height="96"
          src={publicAssetUrl(illustration)}
          width="96"
        />
      ) : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {children}
    </div>
  );
}
