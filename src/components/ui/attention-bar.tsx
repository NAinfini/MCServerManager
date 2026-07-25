import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

interface AttentionBarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: "info" | "warning" | "danger";
}

export function AttentionBar({
  children,
  className,
  tone = "info",
  ...props
}: AttentionBarProps) {
  return (
    <div
      className={cn("attention-bar", `attention-bar-${tone}`, className)}
      role={tone === "danger" ? "alert" : "status"}
      {...props}
    >
      {children}
    </div>
  );
}
