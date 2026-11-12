import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Checkbox,
  Divider,
  Group,
  List,
  Paper,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { Download, History, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { LoadingState } from "../../components/ui/loading-state";
import type { ServerProfile } from "../../domain/server";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import { ContentUpdatePolicyView } from "./ContentUpdatePolicyView";
import {
  checkContentUpdates,
  installAllContentUpdates,
  installContentUpdate,
  listContentUpdateHistory,
  rollbackContentUpdate,
  type ContentUpdateHistoryEntry,
  type InstalledContentUpdateResult,
} from "./contentApi";
import { contentKeys } from "./queries";

interface ContentUpdatesViewProps {
  server: ServerProfile;
}

interface UpdateOutcome {
  count: number;
  backupPaths: string[];
  warnings: string[];
}

export function ContentUpdatesView({ server }: ContentUpdatesViewProps) {
  return (
    <Stack gap="md">
      <AvailableUpdatesPanel server={server} />
      <ContentUpdatePolicyView server={server} />
    </Stack>
  );
}

function AvailableUpdatesPanel({ server }: ContentUpdatesViewProps) {
  const { language, t } = useAppSettings();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);
  const [confirmSelectedUpdates, setConfirmSelectedUpdates] = useState(false);
  const [historyToRollback, setHistoryToRollback] =
    useState<ContentUpdateHistoryEntry | null>(null);

  const checkQuery = useQuery({
    queryKey: contentKeys.updateCheck(server.id),
    queryFn: () => checkContentUpdates(server.id),
  });
  const historyQuery = useQuery({
    queryKey: ["contentUpdateHistory", server.id],
    queryFn: () => listContentUpdateHistory(server.id),
  });

  const updates = checkQuery.data?.updates ?? [];
  useEffect(() => {
    const available = new Set(
      updates.map((update) => update.installedContentId),
    );
    setSelectedIds(
      (current) => new Set([...current].filter((id) => available.has(id))),
    );
  }, [checkQuery.data]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: contentKeys.updateCheck(server.id),
      }),
      queryClient.invalidateQueries({
        queryKey: contentKeys.installed(server.id),
      }),
      queryClient.invalidateQueries({
        queryKey: ["contentUpdateHistory", server.id],
      }),
    ]);
  };
  const recordOutcome = (
    results: InstalledContentUpdateResult[],
    warnings: string[] = [],
  ) => {
    setOutcome({
      count: results.length,
      backupPaths: results.flatMap((result) =>
        result.backupPath ? [result.backupPath] : [],
      ),
      warnings,
    });
  };
  const installOne = useMutation({
    mutationFn: (installedContentId: string) =>
      installContentUpdate(server.id, installedContentId),
    onSuccess: async (result) => {
      recordOutcome([result]);
      await refresh();
    },
  });
  const installSelected = useMutation({
    mutationFn: (installedContentIds: string[]) =>
      installAllContentUpdates(server.id, installedContentIds),
    onSuccess: async (result) => {
      setConfirmSelectedUpdates(false);
      recordOutcome(result.installed, result.warnings);
      setSelectedIds(new Set());
      await refresh();
    },
  });
  const rollback = useMutation({
    mutationFn: (historyId: string) =>
      rollbackContentUpdate(server.id, historyId),
    onSuccess: async () => {
      setHistoryToRollback(null);
      setOutcome({ count: 0, backupPaths: [], warnings: [] });
      await refresh();
    },
  });
  const busy =
    installOne.isPending || installSelected.isPending || rollback.isPending;
  const actionError =
    installOne.error ?? installSelected.error ?? rollback.error;
  const allSelected = updates.length > 0 && selectedIds.size === updates.length;

  if (checkQuery.isLoading) {
    return (
      <Paper
        aria-label={t("server.workspace.content.updates")}
        component="section"
        p="md"
      >
        <LoadingState message={t("content.updates.checking")} />
      </Paper>
    );
  }

  if (checkQuery.error) {
    return (
      <Paper
        aria-label={t("server.workspace.content.updates")}
        component="section"
        p="md"
      >
        <Alert color="red" title={t("content.updates.checkFailed")}>
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{checkQuery.error.message}</Text>
            <Button variant="secondary" onClick={() => checkQuery.refetch()}>
              <RefreshCw aria-hidden="true" size={16} />
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      </Paper>
    );
  }

  const warnings = checkQuery.data?.warnings ?? [];
  const history = historyQuery.data ?? [];

  return (
    <Paper
      aria-label={t("server.workspace.content.updates")}
      component="section"
      p="md"
    >
      <Stack gap="md">
        <Group align="flex-start" justify="space-between">
          <Stack gap={2}>
            <Title order={3}>{t("content.updates.title")}</Title>
            <Text c="dimmed" size="sm">
              {t("content.updates.description")}
            </Text>
          </Stack>
          <Group gap="xs">
            <Button
              disabled={busy || checkQuery.isFetching}
              variant="secondary"
              onClick={() => checkQuery.refetch()}
            >
              <RefreshCw aria-hidden="true" size={16} />
              {t("content.installed.checkUpdates")}
            </Button>
            <Button
              disabled={busy || selectedIds.size === 0}
              variant="primary"
              onClick={() => setConfirmSelectedUpdates(true)}
            >
              <Download aria-hidden="true" size={16} />
              {t("content.updates.updateSelected", { count: selectedIds.size })}
            </Button>
          </Group>
        </Group>

        {actionError ? (
          <Alert color="red" title={t("content.updates.actionFailed")}>
            <Text size="sm">{actionError.message}</Text>
            <Text size="sm">{t("content.updates.recovery")}</Text>
          </Alert>
        ) : null}
        {outcome ? (
          <Alert
            aria-live="polite"
            role="status"
            title={
              outcome.count === 0
                ? t("content.history.rollbackComplete")
                : t("content.updates.updated", { count: outcome.count })
            }
          >
            {outcome.count > 0 ? (
              <Text size="sm">{t("content.updates.restartRequired")}</Text>
            ) : null}
            {outcome.backupPaths.length > 0 ? (
              <Text size="sm">
                {t("content.updates.backupsCreated", {
                  count: outcome.backupPaths.length,
                })}
              </Text>
            ) : null}
            {outcome.warnings.map((warning) => (
              <Text key={warning} size="sm">
                {warning}
              </Text>
            ))}
          </Alert>
        ) : null}

        {updates.length === 0 ? (
          <Stack gap={2}>
            <Text fw={600} size="sm">
              {t("content.updates.emptyTitle")}
            </Text>
            <Text c="dimmed" size="sm">
              {t("content.updates.emptyDescription")}
            </Text>
          </Stack>
        ) : (
          <Table.ScrollContainer minWidth={520}>
            <Table highlightOnHover verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th colSpan={3}>
                    <Checkbox
                      checked={allSelected}
                      indeterminate={!allSelected && selectedIds.size > 0}
                      label={t("content.selection.all", {
                        count: updates.length,
                      })}
                      onChange={(event) =>
                        setSelectedIds(
                          event.currentTarget.checked
                            ? new Set(
                                updates.map(
                                  (update) => update.installedContentId,
                                ),
                              )
                            : new Set(),
                        )
                      }
                    />
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {updates.map((update) => (
                  <Table.Tr key={update.installedContentId}>
                    <Table.Td w={36}>
                      <Checkbox
                        aria-label={t("content.selection.item", {
                          name: update.name,
                        })}
                        checked={selectedIds.has(update.installedContentId)}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (checked) next.add(update.installedContentId);
                            else next.delete(update.installedContentId);
                            return next;
                          });
                        }}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Text fw={500} size="sm">
                        {update.name}
                      </Text>
                      <Text c="dimmed" ff="monospace" size="xs">
                        {update.currentVersion ?? t("common.unknown")} {" -> "}
                        {update.latestVersion} / {update.provider}
                      </Text>
                      {update.warnings.length > 0 ? (
                        <Text c="red" size="xs">
                          {update.warnings.join(" ")}
                        </Text>
                      ) : null}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Button
                        aria-label={t("content.installed.updateOneAria", {
                          content: update.name,
                        })}
                        disabled={busy}
                        variant="secondary"
                        onClick={() =>
                          installOne.mutate(update.installedContentId)
                        }
                      >
                        {t("content.installed.update")}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        {warnings.length > 0 ? (
          <Alert
            color="yellow"
            role="status"
            title={t("content.updates.unresolved")}
          >
            <List size="sm">
              {warnings.map((warning) => (
                <List.Item key={warning}>{warning}</List.Item>
              ))}
            </List>
          </Alert>
        ) : null}

        <Divider />
        <Stack gap="xs">
          <Group gap={6}>
            <History aria-hidden="true" size={16} />
            <Title order={4}>{t("content.history.title")}</Title>
          </Group>
          <Text c="dimmed" size="xs">
            {t("content.history.description")}
          </Text>
          {historyQuery.isLoading ? (
            <LoadingState message={t("content.history.loading")} />
          ) : historyQuery.error ? (
            <Alert color="red">
              <Stack align="flex-start" gap="xs">
                <Text size="sm">{historyQuery.error.message}</Text>
                <Button
                  variant="secondary"
                  onClick={() => historyQuery.refetch()}
                >
                  {t("common.retry")}
                </Button>
              </Stack>
            </Alert>
          ) : history.length === 0 ? (
            <Text c="dimmed" size="sm">
              {t("content.history.empty")}
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={520}>
              <Table highlightOnHover verticalSpacing="xs">
                <Table.Tbody>
                  {history.map((entry) => (
                    <Table.Tr key={entry.id}>
                      <Table.Td>
                        <Text fw={500} size="sm">
                          {entry.name}
                        </Text>
                        <Text c="dimmed" ff="monospace" size="xs">
                          {entry.fromVersion ?? t("common.unknown")} {" -> "}{" "}
                          {entry.toVersion} /{" "}
                          {formatDateTime(entry.createdAt, language)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge color="gray" size="sm" tt="none" variant="light">
                          {t(`content.history.status.${entry.status}`)}
                        </Badge>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Button
                          disabled={busy || !entry.rollbackAvailable}
                          variant="secondary"
                          onClick={() => setHistoryToRollback(entry)}
                        >
                          <RotateCcw aria-hidden="true" size={14} />
                          {t("content.history.rollback")}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      </Stack>

      <ConfirmDangerDialog
        confirmLabel={t("content.updates.updateSelected", {
          count: selectedIds.size,
        })}
        consequences={[
          t("content.updates.consequenceReplace"),
          t("danger.content.updateAll.consequenceBackup"),
          t("danger.content.updateAll.consequenceRestart"),
        ]}
        description={t("danger.content.updateAll.description", {
          count: selectedIds.size,
          server: server.name,
        })}
        error={installSelected.error?.message ?? null}
        isConfirming={installSelected.isPending}
        isOpen={confirmSelectedUpdates}
        title={t("danger.content.updateAll.title")}
        onCancel={() => setConfirmSelectedUpdates(false)}
        onConfirm={() => installSelected.mutate([...selectedIds])}
      />

      <ConfirmDangerDialog
        confirmLabel={t("content.history.confirmRollback")}
        description={t("content.history.rollbackDescription", {
          name: historyToRollback?.name ?? "",
          version: historyToRollback?.fromVersion ?? t("common.unknown"),
        })}
        error={rollback.error?.message ?? null}
        isConfirming={rollback.isPending}
        isOpen={historyToRollback !== null}
        title={t("content.history.rollbackTitle")}
        onCancel={() => setHistoryToRollback(null)}
        onConfirm={() => {
          if (historyToRollback) rollback.mutate(historyToRollback.id);
        }}
      />
    </Paper>
  );
}
