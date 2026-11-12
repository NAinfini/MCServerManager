import type { HTMLAttributes, ReactNode } from "react";
import { Group, Paper } from "@mantine/core";

interface AttentionBarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: "info" | "warning" | "danger";
}

const toneColors = { info: "azure", warning: "yellow", danger: "red" };

export function AttentionBar({
  children,
  tone = "info",
  ...props
}: AttentionBarProps) {
  return (
    <Paper
      bg={`var(--mantine-color-${toneColors[tone]}-light)`}
      px="md"
      py="sm"
      role={tone === "danger" ? "alert" : "status"}
      {...props}
    >
      <Group gap="sm" wrap="nowrap">
        {children}
      </Group>
    </Paper>
  );
}
