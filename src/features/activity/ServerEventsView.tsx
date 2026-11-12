import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import {
  Alert,
  Box,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  VisuallyHidden,
} from "@mantine/core";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import { listProcessEvents } from "../process/api";
import { formatProcessEventMessage } from "../process/eventMessage";
import { processKeys } from "../process/queries";

const knownLevels = ["debug", "info", "warning", "error"];
const levelColor: Record<string, string> = {
  debug: "var(--mantine-color-dimmed)",
  info: "var(--mantine-color-azure-5)",
  warning: "var(--mantine-color-yellow-5)",
  error: "var(--mantine-color-red-6)",
};

// The dot is decorative, so severity has to reach a screen reader as words.
function severityLabel(level: string) {
  return `logger.severity.${knownLevels.includes(level) ? level : "info"}`;
}

export function ServerEventsView({ serverId }: { serverId: string }) {
  const { language, t } = useAppSettings();
  const eventsQuery = useQuery({
    queryKey: processKeys.events(serverId),
    queryFn: () => listProcessEvents(serverId),
  });

  const events = eventsQuery.data ?? [];

  /* Loading, failing and empty used to replace the whole panel, so on a quiet
     server the timeline vanished heading and all. Now only the body swaps and
     the panel keeps its identity beside the other overview cards. */
  return (
    <Paper aria-label={t("server.events.title")} component="section" p="md">
      <Group align="flex-start" justify="space-between" mb="sm" wrap="nowrap">
        <Stack gap={2}>
          <Title order={2} size="h4">
            {t("server.events.title")}
          </Title>
          <Text c="dimmed" size="sm">
            {t("server.events.description")}
          </Text>
        </Stack>
        <Button
          disabled={eventsQuery.isFetching}
          variant="secondary"
          onClick={() => void eventsQuery.refetch()}
        >
          <RefreshCw aria-hidden="true" size={16} />
          {t("common.refresh")}
        </Button>
      </Group>
      {eventsQuery.isLoading ? (
        <LoadingState message={t("common.loadingPanel")} />
      ) : eventsQuery.error ? (
        <Alert
          color="red"
          role="alert"
          title={t("activity.loadError")}
          variant="light"
        >
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{eventsQuery.error.message}</Text>
            <Button
              disabled={eventsQuery.isFetching}
              variant="secondary"
              onClick={() => void eventsQuery.refetch()}
            >
              <RefreshCw aria-hidden="true" size={16} />
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : events.length === 0 ? (
        <EmptyState
          description={t("activity.noEventsDescription")}
          title={t("activity.noEvents")}
        />
      ) : (
        <ScrollArea.Autosize mah={420} type="auto">
          <Stack gap={4}>
            {events.map((event) => (
              <Group
                align="baseline"
                component="article"
                gap="sm"
                key={event.id}
                wrap="nowrap"
              >
                <Box
                  aria-hidden="true"
                  bg={levelColor[event.level] ?? levelColor.info}
                  h={8}
                  style={{ borderRadius: "50%", flexShrink: 0 }}
                  w={8}
                />
                <VisuallyHidden>{t(severityLabel(event.level))}</VisuallyHidden>
                <Text
                  c="dimmed"
                  component="time"
                  dateTime={event.createdAt}
                  ff="monospace"
                  size="xs"
                  style={{ whiteSpace: "nowrap" }}
                >
                  {formatDateTime(event.createdAt, language)}
                </Text>
                <Text size="sm" style={{ wordBreak: "break-word" }}>
                  {formatProcessEventMessage(event.message, t)}
                </Text>
              </Group>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </Paper>
  );
}
