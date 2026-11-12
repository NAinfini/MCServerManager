import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, RefreshCw } from "lucide-react";
import {
  Alert,
  Code,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import { formatBytes } from "../../lib/format-bytes";
import { queryKeys } from "../../lib/query-keys";
import type { ServerProfile } from "../../domain/server";
import { listServerLogs, readServerLog } from "./logApi";

export function ServerLogsView({ server }: { server: ServerProfile }) {
  const { language, t } = useAppSettings();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const logsQuery = useQuery({
    queryKey: queryKeys.logs.server(server.id),
    queryFn: () => listServerLogs(server.id),
  });
  const logs = logsQuery.data?.logs ?? [];
  const selectedLog = logs.find((log) => log.relativePath === selectedPath);
  const contentQuery = useQuery({
    queryKey: queryKeys.logs.content(server.id, selectedPath),
    queryFn: () => readServerLog(server.id, selectedPath ?? ""),
    enabled: Boolean(selectedPath),
  });

  useEffect(() => {
    if (!selectedPath && logs.length > 0) {
      setSelectedPath(logs[0].relativePath);
    }
  }, [logs, selectedPath]);

  return (
    <Stack aria-label={t("logs.aria")} component="section" gap="md" h="100%">
      <Group align="flex-start" justify="space-between" wrap="nowrap">
        <Stack gap={2}>
          <Title order={2} size="h4">
            {t("logs.title")}
          </Title>
          <Text c="dimmed" size="sm">
            {t("logs.description")}
          </Text>
        </Stack>
        <Button
          disabled={logsQuery.isFetching}
          variant="secondary"
          onClick={() => logsQuery.refetch()}
        >
          <RefreshCw aria-hidden="true" size={16} />
          {t("common.refresh")}
        </Button>
      </Group>

      {logsQuery.isLoading ? (
        <LoadingState message={t("logs.loading")} />
      ) : null}

      {logsQuery.error ? (
        <Alert
          color="red"
          role="alert"
          title={t("logs.loadError.title")}
          variant="light"
        >
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{logsQuery.error.message}</Text>
            <Button
              disabled={logsQuery.isFetching}
              variant="secondary"
              onClick={() => void logsQuery.refetch()}
            >
              <RefreshCw aria-hidden="true" size={16} />
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : null}

      {!logsQuery.isLoading && !logsQuery.error && logs.length === 0 ? (
        <EmptyState
          title={t("logs.empty.title")}
          description={t("logs.empty.description")}
        />
      ) : null}

      {logs.length > 0 ? (
        <Group align="stretch" flex={1} gap="md" mih={0} wrap="nowrap">
          <Paper p={4} style={{ flexShrink: 0 }} w={260}>
            <ScrollArea h="100%" type="auto">
              <Stack aria-label={t("logs.filesAria")} gap={2}>
                {logs.map((log) => {
                  const selected = selectedPath === log.relativePath;
                  return (
                    <UnstyledButton
                      aria-pressed={selected}
                      bg={
                        selected
                          ? "var(--mantine-primary-color-light)"
                          : undefined
                      }
                      key={log.relativePath}
                      p="xs"
                      style={{ borderRadius: "var(--mantine-radius-sm)" }}
                      onClick={() => setSelectedPath(log.relativePath)}
                    >
                      <Group align="flex-start" gap="xs" wrap="nowrap">
                        <FileText aria-hidden="true" size={16} />
                        <Stack gap={0} miw={0}>
                          <Text ff="monospace" fw={500} size="sm" truncate>
                            {log.fileName}
                          </Text>
                          <Text c="dimmed" size="xs">
                            {formatBytes(log.sizeBytes)} -{" "}
                            {formatDateTime(log.modifiedAt, language)}
                          </Text>
                        </Stack>
                      </Group>
                    </UnstyledButton>
                  );
                })}
              </Stack>
            </ScrollArea>
          </Paper>
          <Paper flex={1} miw={0} p="sm">
            {contentQuery.isLoading ? (
              <LoadingState message={t("logs.opening")} />
            ) : null}
            {contentQuery.error ? (
              <Alert
                color="red"
                role="alert"
                title={t("logs.openError.title")}
                variant="light"
              >
                <Stack align="flex-start" gap="xs">
                  <Text size="sm">{contentQuery.error.message}</Text>
                  <Button
                    disabled={contentQuery.isFetching}
                    variant="secondary"
                    onClick={() => void contentQuery.refetch()}
                  >
                    <RefreshCw aria-hidden="true" size={16} />
                    {t("common.retry")}
                  </Button>
                </Stack>
              </Alert>
            ) : null}
            {!contentQuery.isLoading && !contentQuery.error ? (
              <ScrollArea h="100%" type="auto">
                <Code
                  block
                  bg="transparent"
                  style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                >
                  {contentQuery.data?.content ||
                    (selectedLog ? t("logs.emptyFile") : "")}
                </Code>
              </ScrollArea>
            ) : null}
          </Paper>
        </Group>
      ) : null}
    </Stack>
  );
}
