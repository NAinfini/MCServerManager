import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

interface StickyActionBarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function StickyActionBar({
  children,
  className,
  ...props
}: StickyActionBarProps) {
  return (
    <div className={cn("sticky-action-bar", className)} {...props}>
      {children}
    </div>
  );
}
