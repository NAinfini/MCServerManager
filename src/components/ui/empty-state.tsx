import type { ReactNode } from "react";
import { Stack, Text, Title } from "@mantine/core";

interface EmptyStateProps {
  title: string;
  description?: string;
  children?: ReactNode;
  role?: "alert" | "status";
}

export function EmptyState({
  title,
  description,
  children,
  role,
}: EmptyStateProps) {
  return (
    <Stack align="center" gap={6} px="md" py="xl" role={role} ta="center">
      <Title fw={600} fz="md" order={2}>
        {title}
      </Title>
      {description ? (
        <Text c="dimmed" maw={480} size="sm">
          {description}
        </Text>
      ) : null}
      {children}
    </Stack>
  );
}
