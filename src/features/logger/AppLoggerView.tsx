import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Box,
  Code,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
  VisuallyHidden,
} from "@mantine/core";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { EmptyState } from "../../components/ui/empty-state";
import { useAppSettings } from "../../i18n";
import { queryKeys } from "../../lib/query-keys";
import { formatDateTime } from "../../lib/date-format";
import {
  clearAppLogs,
  listAppLogs,
  type AppLogEntry,
  type AppLogLevelFilter,
} from "./api";

function LogLevelIcon({ level }: { level: string }) {
  if (level === "error") {
    return <AlertCircle aria-hidden="true" size={14} />;
  }
  if (level === "warning") {
    return <AlertTriangle aria-hidden="true" size={14} />;
  }
  return <Info aria-hidden="true" size={14} />;
}

const levelColor: Record<string, string> = {
  debug: "gray",
  info: "azure",
  warning: "yellow",
  error: "red",
};

function levelLabel(entry: AppLogEntry) {
  return ["debug", "info", "warning", "error"].includes(entry.level)
    ? entry.level
    : "info";
}

interface GroupedLogEntry {
  count: number;
  entry: AppLogEntry;
  key: string;
}

function groupLogs(logs: AppLogEntry[]): GroupedLogEntry[] {
  const groups = new Map<string, GroupedLogEntry>();
  for (const entry of logs) {
    const key = JSON.stringify([
      entry.level,
      entry.source,
      entry.message,
      entry.details ?? "",
    ]);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { count: 1, entry, key });
    }
  }
  return [...groups.values()];
}

export function AppLoggerView() {
  const { language, t } = useAppSettings();
  const queryClient = useQueryClient();
  const [level, setLevel] = useState<AppLogLevelFilter>("all");
  const [selectedLogKey, setSelectedLogKey] = useState<string | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const logsQuery = useQuery({
    queryKey: queryKeys.logs.app(level),
    queryFn: () => listAppLogs(level),
  });
  const clearMutation = useMutation({
    mutationFn: clearAppLogs,
    onSuccess: () => {
      setIsClearConfirmOpen(false);
      queryClient.setQueryData(queryKeys.logs.app(level), []);
      void queryClient.invalidateQueries({ queryKey: queryKeys.logs.appAll });
    },
  });
  const logs = logsQuery.data ?? [];
  const groupedLogs = useMemo(() => groupLogs(logs), [logs]);
  const selectedGroup =
    groupedLogs.find((group) => group.key === selectedLogKey) ??
    groupedLogs[0] ??
    null;

  return (
    <Stack aria-labelledby="logger-title" component="section" gap="md" h="100%">
      <Group justify="space-between">
        <Title id="logger-title" order={1}>
          {t("logger.title")}
        </Title>
        <Group gap="xs">
          <Button
            disabled={logsQuery.isFetching}
            variant="secondary"
            onClick={() => logsQuery.refetch()}
          >
            <RefreshCw aria-hidden="true" size={16} />
            {t("common.refresh")}
          </Button>
          <Button
            disabled={clearMutation.isPending}
            variant="danger"
            onClick={() => {
              clearMutation.reset();
              setIsClearConfirmOpen(true);
            }}
          >
            <Trash2 aria-hidden="true" size={16} />
            {t("logger.clear")}
          </Button>
        </Group>
      </Group>
      <ConfirmDangerDialog
        confirmLabel={t("danger.labels.clearLogs")}
        description={t("danger.logger.clear.description")}
        error={clearMutation.error?.message ?? null}
        isConfirming={clearMutation.isPending}
        isOpen={isClearConfirmOpen}
        title={t("danger.logger.clear.title")}
        onCancel={() => setIsClearConfirmOpen(false)}
        onConfirm={() => clearMutation.mutate()}
      />

      {logsQuery.error ? (
        <Alert
          color="red"
          role="alert"
          title={t("logger.loadError")}
          variant="light"
        >
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{logsQuery.error.message}</Text>
            <Button variant="secondary" onClick={() => logsQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : null}

      {!logsQuery.error && logsQuery.data ? (
        <Group align="stretch" flex={1} gap="md" mih={0} wrap="nowrap">
          <Stack component="aside" gap="xs" w={180} style={{ flexShrink: 0 }}>
            <SegmentedControl
              aria-label={t("logger.filterLevel")}
              data={[
                {
                  value: "all",
                  label: (
                    <Group gap={6} wrap="nowrap">
                      {t("logger.level.all")}
                    </Group>
                  ),
                },
                {
                  value: "info",
                  label: (
                    <Group gap={6} wrap="nowrap">
                      <Info aria-hidden="true" size={14} />
                      {t("logger.level.info")}
                    </Group>
                  ),
                },
                {
                  value: "debug",
                  label: (
                    <Group gap={6} wrap="nowrap">
                      <Info aria-hidden="true" size={14} />
                      {t("logger.level.debug")}
                    </Group>
                  ),
                },
                {
                  value: "warning",
                  label: (
                    <Group gap={6} wrap="nowrap">
                      <AlertTriangle aria-hidden="true" size={14} />
                      {t("logger.level.warning")}
                    </Group>
                  ),
                },
                {
                  value: "error",
                  label: (
                    <Group gap={6} wrap="nowrap">
                      <AlertCircle aria-hidden="true" size={14} />
                      {t("logger.level.error")}
                    </Group>
                  ),
                },
              ]}
              fullWidth
              orientation="vertical"
              value={level}
              onChange={(value) => setLevel(value as AppLogLevelFilter)}
            />
            <Text c="dimmed" px={4} size="xs">
              {t("logger.count", { count: logs.length })}
            </Text>
          </Stack>
          <Paper flex={1} miw={0} p={4}>
            <ScrollArea h="100%" type="auto">
              <Stack aria-label={t("logger.list")} gap={2} role="list">
                {groupedLogs.length === 0 ? (
                  <EmptyState
                    title={t("logger.empty.title")}
                    description={t("logger.empty.description")}
                  />
                ) : null}
                {groupedLogs.map((group) => {
                  const { entry } = group;
                  const normalizedLevel = levelLabel(group.entry);
                  const isSelected = group.key === selectedGroup?.key;
                  return (
                    <div key={group.key} role="listitem">
                      <UnstyledButton
                        aria-pressed={isSelected}
                        bg={
                          isSelected
                            ? "var(--mantine-primary-color-light)"
                            : undefined
                        }
                        p="xs"
                        style={{ borderRadius: "var(--mantine-radius-sm)" }}
                        w="100%"
                        onClick={() => setSelectedLogKey(group.key)}
                      >
                        <Group align="flex-start" gap="sm" wrap="nowrap">
                          <ThemeIcon
                            color={levelColor[normalizedLevel]}
                            size="sm"
                            variant="light"
                          >
                            <LogLevelIcon level={normalizedLevel} />
                          </ThemeIcon>
                          {/* The icon is decorative, so the level has to be
                              spelled out for a screen reader. */}
                          <VisuallyHidden>
                            {t(`logger.severity.${normalizedLevel}`)}
                          </VisuallyHidden>
                          <Stack flex={1} gap={2} miw={0}>
                            <Group gap="xs" wrap="nowrap">
                              <Text fw={500} size="sm" truncate>
                                {entry.message || t("logger.untitled")}
                              </Text>
                              {group.count > 1 ? (
                                <Badge
                                  color="gray"
                                  size="xs"
                                  style={{ flexShrink: 0 }}
                                  variant="light"
                                >
                                  ×{group.count}
                                </Badge>
                              ) : null}
                            </Group>
                            <Group c="dimmed" fz="xs" gap="sm" wrap="nowrap">
                              <Text ff="monospace" inherit truncate>
                                {entry.source}
                              </Text>
                              <Text inherit style={{ whiteSpace: "nowrap" }}>
                                {formatDateTime(entry.createdAt, language)}
                              </Text>
                            </Group>
                          </Stack>
                        </Group>
                      </UnstyledButton>
                    </div>
                  );
                })}
              </Stack>
            </ScrollArea>
          </Paper>
          {selectedGroup ? (
            <Paper
              aria-label={t("logger.details")}
              component="aside"
              miw={0}
              p="md"
              w="40%"
            >
              <Stack gap="sm" h="100%">
                <Group justify="space-between">
                  <Text fw={600} size="sm">
                    {t("logger.details")}
                  </Text>
                  <Badge
                    color={levelColor[levelLabel(selectedGroup.entry)]}
                    variant="light"
                  >
                    {t(`logger.level.${levelLabel(selectedGroup.entry)}`)}
                  </Badge>
                </Group>
                <SimpleGrid cols={2} spacing="sm">
                  <Box>
                    <Text c="dimmed" size="xs">
                      {t("logger.source")}
                    </Text>
                    <Text ff="monospace" size="sm">
                      {selectedGroup.entry.source}
                    </Text>
                  </Box>
                  <Box>
                    <Text c="dimmed" size="xs">
                      {t("logger.time")}
                    </Text>
                    <Text size="sm">
                      {formatDateTime(selectedGroup.entry.createdAt, language)}
                    </Text>
                  </Box>
                </SimpleGrid>
                {selectedGroup.count > 1 ? (
                  <Text c="dimmed" size="xs">
                    {t("logger.repeated", { count: selectedGroup.count })}
                  </Text>
                ) : null}
                <ScrollArea flex={1} type="auto">
                  <Code block style={{ whiteSpace: "pre-wrap" }}>
                    {selectedGroup.entry.details || t("logger.noDetails")}
                  </Code>
                </ScrollArea>
              </Stack>
            </Paper>
          ) : null}
        </Group>
      ) : null}
    </Stack>
  );
}
