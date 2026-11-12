import type { HTMLAttributes, ReactNode } from "react";
import { Group } from "@mantine/core";
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
    <Group
      bg="var(--mantine-color-body)"
      bottom={0}
      className={cn("sticky-action-bar", className)}
      gap="sm"
      justify="flex-end"
      pos="sticky"
      py="sm"
      style={{ zIndex: 1 }}
      {...props}
    >
      {children}
    </Group>
  );
}
