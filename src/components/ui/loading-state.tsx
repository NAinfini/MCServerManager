import { Group, Loader, Skeleton, Stack, Text } from "@mantine/core";
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

  if (variant === "skeleton") {
    return (
      <Stack aria-live="polite" gap="sm" p="md" role="status">
        <Stack aria-hidden="true" className="loading-skeleton" gap="xs">
          <Skeleton h={14} />
          <Skeleton h={14} w="80%" />
          <Skeleton h={14} w="60%" />
        </Stack>
        <Text c="dimmed" size="sm">
          {label}
        </Text>
      </Stack>
    );
  }

  return (
    <Group aria-live="polite" gap="sm" justify="center" p="xl" role="status">
      <Loader aria-hidden="true" size="sm" />
      <Text c="dimmed" size="sm">
        {label}
      </Text>
    </Group>
  );
}
