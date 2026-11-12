import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Checkbox,
  Divider,
  Grid,
  Group,
  Menu,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  AlertTriangle,
  ChevronDown,
  Compass,
  Download,
  FolderOpen,
  Package,
  PackagePlus,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import { LoaderPill } from "../loaders/LoaderIdentity";
import type { ServerProfile } from "../../domain/server";
import { LocalImportDialog } from "./LocalImportDialog";
import {
  disableInstalledContent,
  enableInstalledContent,
  checkContentUpdates,
  installAllContentUpdates,
  installContentUpdate,
  importLocalContent,
  type InstalledContent,
  type InstalledContentUpdateCheck,
  listInstalledContent,
  uninstallInstalledContent,
} from "./contentApi";
import { contentKeys } from "./queries";
import { listServerFiles } from "../files/fileApi";
import { useNotificationStore } from "../notifications/notificationStore";

interface InstalledContentViewProps {
  server: ServerProfile;
  onBrowse?: () => void;
  /* Opens a server file or folder on the Files tab. */
  onOpenFile?: (relativePath: string) => void;
}

/* Where a mod keeps its settings. A mod's config has no declared link back to
   the mod, so the file or folder name is the only evidence available. */
const CONFIG_ROOTS = ["config", "world/serverconfig", "defaultconfigs"];

function comparable(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function configFilesFor(
  item: InstalledContent,
  entries: { name: string; relativePath: string }[],
) {
  const names = [item.modId, item.name]
    .map(comparable)
    .filter((name) => name.length >= 3);
  return entries.filter((entry) => {
    const file = comparable(entry.name);
    return names.some((name) => file.includes(name));
  });
}

export function InstalledContentView({
  server,
  onBrowse,
  onOpenFile,
}: InstalledContentViewProps) {
  const { language, t } = useAppSettings();
  const queryClient = useQueryClient();
  const pushNotification = useNotificationStore((state) => state.push);
  const notifyActionError = (error: Error) =>
    pushNotification({
      severity: "error",
      title: t("notifications.actionFailed"),
      message: error.message,
    });
  const [showImport, setShowImport] = useState(false);
  const [dangerAction, setDangerAction] = useState<{
    kind: "disable" | "uninstall";
    item: InstalledContent;
  } | null>(null);
  const [batchAction, setBatchAction] = useState<
    "disable" | "uninstall" | null
  >(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [operationResult, setOperationResult] = useState<{
    count: number;
    restartRequired: boolean;
    backups: number;
  } | null>(null);
  const [updateCheck, setUpdateCheck] =
    useState<InstalledContentUpdateCheck | null>(null);
  // Replacing every jar at once is the one action here that cannot be undone
  // and cannot be done item by item afterwards, so it gets its own gate.
  const [confirmUpdateAll, setConfirmUpdateAll] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [onlyUpdates, setOnlyUpdates] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const contentQuery = useQuery({
    queryKey: contentKeys.installed(server.id),
    queryFn: () => listInstalledContent(server.id),
  });
  const importMutation = useMutation({
    mutationFn: (sourcePath: string) =>
      importLocalContent(server.id, sourcePath),
    onSuccess: async () => {
      setShowImport(false);
      setOperationResult({ count: 1, restartRequired: true, backups: 0 });
      await queryClient.invalidateQueries({
        queryKey: contentKeys.installed(server.id),
      });
    },
    onError: notifyActionError,
  });
  const disableMutation = useMutation({
    mutationFn: (contentId: string) =>
      disableInstalledContent(server.id, contentId),
    onSuccess: async () => {
      setDangerAction(null);
      setOperationResult({ count: 1, restartRequired: true, backups: 0 });
      await queryClient.invalidateQueries({
        queryKey: contentKeys.installed(server.id),
      });
    },
    onError: notifyActionError,
  });
  const enableMutation = useMutation({
    mutationFn: (contentId: string) =>
      enableInstalledContent(server.id, contentId),
    onSuccess: async () => {
      setDangerAction(null);
      setOperationResult({ count: 1, restartRequired: true, backups: 0 });
      await queryClient.invalidateQueries({
        queryKey: contentKeys.installed(server.id),
      });
    },
    onError: notifyActionError,
  });
  const uninstallMutation = useMutation({
    mutationFn: (contentId: string) =>
      uninstallInstalledContent(server.id, contentId),
    onSuccess: async () => {
      setDangerAction(null);
      setOperationResult({ count: 1, restartRequired: true, backups: 0 });
      await queryClient.invalidateQueries({
        queryKey: contentKeys.installed(server.id),
      });
    },
    onError: notifyActionError,
  });
  const checkUpdatesMutation = useMutation({
    mutationFn: () => checkContentUpdates(server.id),
    onSuccess: (result) => setUpdateCheck(result),
    onError: notifyActionError,
  });
  const installUpdateMutation = useMutation({
    mutationFn: (contentId: string) =>
      installContentUpdate(server.id, contentId),
    onSuccess: async (result) => {
      setOperationResult({
        count: 1,
        restartRequired: true,
        backups: result.backupPath ? 1 : 0,
      });
      await queryClient.invalidateQueries({
        queryKey: contentKeys.installed(server.id),
      });
      checkUpdatesMutation.mutate();
    },
    onError: notifyActionError,
  });
  const installAllUpdatesMutation = useMutation({
    mutationFn: (installedContentIds: string[]) =>
      installAllContentUpdates(server.id, installedContentIds),
    onSuccess: async (result) => {
      setSelectedIds(new Set());
      setOperationResult({
        count: result.installed.length,
        restartRequired: result.installed.length > 0,
        backups: result.installed.filter((item) => item.backupPath).length,
      });
      await queryClient.invalidateQueries({
        queryKey: contentKeys.installed(server.id),
      });
      checkUpdatesMutation.mutate();
    },
    onError: notifyActionError,
  });
  const batchMutation = useMutation({
    mutationFn: async ({
      action,
      ids,
    }: {
      action: "enable" | "disable" | "uninstall";
      ids: string[];
    }) => {
      await Promise.all(
        ids.map((id) =>
          action === "enable"
            ? enableInstalledContent(server.id, id)
            : action === "disable"
              ? disableInstalledContent(server.id, id)
              : uninstallInstalledContent(server.id, id),
        ),
      );
      return ids.length;
    },
    onSuccess: async (count) => {
      setBatchAction(null);
      setSelectedIds(new Set());
      setOperationResult({ count, restartRequired: true, backups: 0 });
      await queryClient.invalidateQueries({
        queryKey: contentKeys.installed(server.id),
      });
    },
    onError: async (error) => {
      notifyActionError(error);
      await queryClient.invalidateQueries({
        queryKey: contentKeys.installed(server.id),
      });
    },
  });
  const configEntriesQuery = useQuery({
    queryKey: [...contentKeys.installed(server.id), "config-files"],
    queryFn: async () => {
      const lists = await Promise.all(
        CONFIG_ROOTS.map((root) =>
          listServerFiles(server.id, root).catch(() => []),
        ),
      );
      return lists.flat();
    },
  });
  const content = contentQuery.data ?? [];
  const updateByContentId = new Map(
    (updateCheck?.updates ?? []).map((update) => [
      update.installedContentId,
      update,
    ]),
  );
  const selectedContent = content.filter((item) => selectedIds.has(item.id));
  const selectedUpdateIds = selectedContent
    .filter((item) => updateByContentId.has(item.id))
    .map((item) => item.id);
  const searchNeedle = searchText.trim().toLowerCase();
  const visibleContent = content.filter(
    (item) =>
      (!onlyUpdates || updateByContentId.has(item.id)) &&
      (searchNeedle === "" ||
        [item.name, item.modId, item.contentId].some((value) =>
          value?.toLowerCase().includes(searchNeedle),
        )),
  );
  const allSelected =
    visibleContent.length > 0 &&
    visibleContent.every((item) => selectedIds.has(item.id));
  const someSelected = visibleContent.some((item) => selectedIds.has(item.id));
  const focused =
    visibleContent.find((item) => item.id === focusedId) ??
    visibleContent[0] ??
    null;
  const focusedUpdate = focused ? updateByContentId.get(focused.id) : undefined;
  const isDisabled = (item: InstalledContent) =>
    item.installedPath.endsWith(".disabled");
  const availableUpdates = updateCheck?.updates.length ?? 0;
  const rowStatus = (item: InstalledContent) => {
    if (isDisabled(item)) {
      return { key: "disabled", label: t("content.state.disabled") };
    }
    if (updateByContentId.has(item.id)) {
      return { key: "update", label: t("content.status.updateAvailable") };
    }
    if (item.warnings.length > 0) {
      return { key: "warning", label: t("content.status.warning") };
    }
    return updateCheck
      ? { key: "current", label: t("content.installed.current") }
      : { key: "enabled", label: t("content.state.enabled") };
  };

  const statusColor: Record<string, string> = {
    update: "azure",
    warning: "yellow",
  };
  const configFiles = focused
    ? configFilesFor(focused, configEntriesQuery.data ?? [])
    : [];

  return (
    <Stack component="section" gap="sm" aria-label={t("content.installed.aria")}>
      <Group gap="sm" wrap="nowrap">
        <TextInput
          aria-label={t("content.search.label")}
          flex={1}
          leftSection={<Search aria-hidden="true" size={16} />}
          placeholder={t("content.search.placeholder", {
            count: content.length,
          })}
          type="search"
          value={searchText}
          onChange={(event) => setSearchText(event.currentTarget.value)}
        />
        {availableUpdates > 0 ? (
          <Button
            aria-pressed={onlyUpdates}
            variant={onlyUpdates ? "primary" : "secondary"}
            onClick={() => setOnlyUpdates((current) => !current)}
          >
            {t("content.updates.available", { count: availableUpdates })}
          </Button>
        ) : (
          <Button
            disabled={checkUpdatesMutation.isPending}
            variant="secondary"
            onClick={() => checkUpdatesMutation.mutate()}
          >
            <RefreshCw aria-hidden="true" size={16} />
            {t("content.installed.checkUpdates")}
          </Button>
        )}
        <Menu position="bottom-end">
          <Menu.Target>
            <Button variant="secondary">
              <PackagePlus aria-hidden="true" size={16} />
              {t("content.installed.addContent")}
              <ChevronDown aria-hidden="true" size={14} />
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<Compass aria-hidden="true" size={14} />}
              onClick={() => onBrowse?.()}
            >
              {t("content.installed.browseOnline")}
            </Menu.Item>
            <Menu.Item
              leftSection={<FolderOpen aria-hidden="true" size={14} />}
              onClick={() => setShowImport(true)}
            >
              {t("content.installed.importFile")}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      {selectedIds.size > 0 ? (
        <Paper
          aria-label={t("content.selection.actions")}
          p="xs"
          role="toolbar"
        >
          <Group gap="xs">
            <Text fw={600} mr="auto" px="xs" size="sm">
              {t("content.selection.count", { count: selectedIds.size })}
            </Text>
            {selectedUpdateIds.length > 0 ? (
              <Button
                disabled={installAllUpdatesMutation.isPending}
                variant="primary"
                onClick={() => setConfirmUpdateAll(true)}
              >
                <Download aria-hidden="true" size={16} />
                {t("content.updates.updateSelected", {
                  count: selectedUpdateIds.length,
                })}
              </Button>
            ) : null}
            <Button
              disabled={batchMutation.isPending}
              variant="secondary"
              onClick={() =>
                batchMutation.mutate({ action: "enable", ids: [...selectedIds] })
              }
            >
              {t("content.selection.enable")}
            </Button>
            <Button
              disabled={batchMutation.isPending}
              variant="secondary"
              onClick={() => setBatchAction("disable")}
            >
              {t("content.selection.disable")}
            </Button>
            <Button
              disabled={batchMutation.isPending}
              variant="ghost"
              onClick={() => setBatchAction("uninstall")}
            >
              {t("content.selection.uninstall")}
            </Button>
            <Button variant="ghost" onClick={() => setSelectedIds(new Set())}>
              {t("content.selection.clear")}
            </Button>
          </Group>
        </Paper>
      ) : null}

      {operationResult ? (
        <Alert
          aria-live="polite"
          role="status"
          title={t("content.operation.complete", {
            count: operationResult.count,
          })}
        >
          {operationResult.restartRequired ? (
            <Text size="sm">{t("content.updates.restartRequired")}</Text>
          ) : null}
          {operationResult.backups > 0 ? (
            <Text size="sm">
              {t("content.updates.backupsCreated", {
                count: operationResult.backups,
              })}
            </Text>
          ) : null}
        </Alert>
      ) : null}
      {batchMutation.error ? (
        <Alert color="red" title={t("content.operation.failed")}>
          <Text size="sm">{batchMutation.error.message}</Text>
          <Text size="sm">{t("content.operation.recovery")}</Text>
        </Alert>
      ) : null}

      {showImport ? (
        <LocalImportDialog
          error={importMutation.error?.message ?? null}
          isSubmitting={importMutation.isPending}
          onCancel={() => {
            importMutation.reset();
            setShowImport(false);
          }}
          onImport={(sourcePath) => importMutation.mutate(sourcePath)}
        />
      ) : null}

      {contentQuery.error ? (
        <Alert color="red" title={t("content.installed.loadError.title")}>
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{contentQuery.error.message}</Text>
            <Button variant="secondary" onClick={() => contentQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : null}
      {updateCheck?.warnings.length ? (
        <Alert color="yellow" role="status">
          {updateCheck.warnings.map((warning) => (
            <Text key={warning} size="sm">
              {warning}
            </Text>
          ))}
        </Alert>
      ) : null}

      {contentQuery.isLoading ? (
        <LoadingState message={t("content.installed.loading")} />
      ) : null}

      {!contentQuery.isLoading &&
      !contentQuery.error &&
      content.length === 0 ? (
        <Paper p="md">
          <Stack align="flex-start" gap="xs">
            <Title order={4}>{t("content.installed.empty.title")}</Title>
            <Text c="dimmed" size="sm">
              {t("content.installed.empty.description")}
            </Text>
            <Button variant="primary" onClick={() => onBrowse?.()}>
              <Compass aria-hidden="true" size={16} />
              {t("content.installed.browseContent")}
            </Button>
          </Stack>
        </Paper>
      ) : null}

      {content.length > 0 ? (
        <Grid gap="md">
          <Grid.Col span={{ base: 12, md: 7, xl: 8 }}>
            <Paper p={0}>
              <Group gap="sm" px="md" py="xs">
                <Checkbox
                  aria-label={t("content.selection.all", {
                    count: visibleContent.length,
                  })}
                  checked={allSelected}
                  indeterminate={!allSelected && someSelected}
                  onChange={(event) =>
                    setSelectedIds(
                      event.currentTarget.checked
                        ? new Set(visibleContent.map((item) => item.id))
                        : new Set(),
                    )
                  }
                />
                <Text c="dimmed" size="xs">
                  {t("content.list.count", { count: visibleContent.length })}
                </Text>
              </Group>
              <Divider />
              {visibleContent.length === 0 ? (
                <Text c="dimmed" p="md" size="sm">
                  {t("content.search.empty")}
                </Text>
              ) : (
                <ScrollArea.Autosize mah={560} type="auto">
                  <Box
                    aria-label={t("content.installed.title")}
                    component="ul"
                    m={0}
                    p={4}
                    style={{ listStyle: "none" }}
                  >
                    {visibleContent.map((item) => {
                      const status = rowStatus(item);
                      const isFocused = item.id === focused?.id;
                      return (
                        <Group
                          key={item.id}
                          bg={
                            isFocused
                              ? "var(--mantine-color-default-hover)"
                              : undefined
                          }
                          component="li"
                          gap="sm"
                          opacity={isDisabled(item) ? 0.55 : 1}
                          pl="sm"
                          style={{ borderRadius: "var(--mantine-radius-sm)" }}
                          wrap="nowrap"
                        >
                          <Checkbox
                            aria-label={t("content.selection.item", {
                              name: item.name,
                            })}
                            checked={selectedIds.has(item.id)}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setSelectedIds((current) => {
                                const next = new Set(current);
                                if (checked) next.add(item.id);
                                else next.delete(item.id);
                                return next;
                              });
                            }}
                          />
                          <UnstyledButton
                            aria-current={isFocused ? "true" : undefined}
                            flex={1}
                            miw={0}
                            py={6}
                            pr="sm"
                            onClick={() => setFocusedId(item.id)}
                          >
                            <Group gap="sm" wrap="nowrap">
                              <ThemeIcon color="gray" size="md" variant="light">
                                <Package aria-hidden="true" size={14} />
                              </ThemeIcon>
                              <Text flex={1} fw={500} size="sm" truncate>
                                {item.name}
                              </Text>
                              <Text c="dimmed" ff="monospace" size="xs">
                                {item.version ?? t("common.unknown")}
                              </Text>
                              <Text c="dimmed" size="xs" visibleFrom="sm">
                                {item.provider ?? t("content.source.local")}
                              </Text>
                              <Badge
                                color={statusColor[status.key] ?? "gray"}
                                size="sm"
                                tt="none"
                                variant={
                                  status.key === "disabled" ? "outline" : "light"
                                }
                              >
                                {status.label}
                              </Badge>
                            </Group>
                          </UnstyledButton>
                        </Group>
                      );
                    })}
                  </Box>
                </ScrollArea.Autosize>
              )}
            </Paper>
          </Grid.Col>
          {focused ? (
            <Grid.Col span={{ base: 12, md: 5, xl: 4 }}>
              <Paper aria-label={focused.name} component="aside" p="md">
                <Stack gap="md">
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon color="gray" size={44} variant="light">
                      <Package aria-hidden="true" size={24} />
                    </ThemeIcon>
                    <Stack gap={2} miw={0}>
                      <Title order={3}>{focused.name}</Title>
                      <Text c="dimmed" size="xs">
                        {t("content.detail.source", {
                          version: focused.version ?? t("common.unknown"),
                          source: focused.provider ?? t("content.source.local"),
                        })}
                      </Text>
                    </Stack>
                  </Group>
                  {focused.warnings.length > 0 ? (
                    <Alert
                      color="yellow"
                      icon={<AlertTriangle aria-hidden="true" size={16} />}
                      role="status"
                    >
                      {focused.warnings.join("; ")}
                    </Alert>
                  ) : null}
                  <Stack gap={6}>
                    <Group justify="space-between" wrap="nowrap">
                      <Text c="dimmed" size="xs">
                        {t("content.detail.modId")}
                      </Text>
                      <Text ff="monospace" size="xs" truncate>
                        {focused.modId ??
                          focused.contentId ??
                          t("content.installed.unknownId")}
                      </Text>
                    </Group>
                    <Group justify="space-between" wrap="nowrap">
                      <Text c="dimmed" size="xs">
                        {t("content.table.loader")}
                      </Text>
                      <LoaderPill loaderType={focused.loader} />
                    </Group>
                    {focusedUpdate ? (
                      <Group justify="space-between" wrap="nowrap">
                        <Text c="dimmed" size="xs">
                          {t("content.detail.latest")}
                        </Text>
                        <Text ff="monospace" size="xs">
                          {focusedUpdate.latestVersion}
                        </Text>
                      </Group>
                    ) : null}
                    <Group justify="space-between" wrap="nowrap">
                      <Text c="dimmed" size="xs">
                        {t("content.table.installed")}
                      </Text>
                      <Text size="xs">
                        {formatDateTime(focused.installedAt, language)}
                      </Text>
                    </Group>
                  </Stack>
                  {onOpenFile ? (
                    <Stack align="flex-start" gap={4}>
                      <Text fw={600} size="sm">
                        {t("content.detail.settings")}
                      </Text>
                      {configFiles.map((entry) => (
                        <Anchor
                          key={entry.relativePath}
                          component="button"
                          ff="monospace"
                          size="xs"
                          type="button"
                          onClick={() => onOpenFile(entry.relativePath)}
                        >
                          {entry.relativePath}
                        </Anchor>
                      ))}
                      {configFiles.length === 0 ? (
                        <Text c="dimmed" size="xs">
                          {t("content.detail.settingsNone")}
                        </Text>
                      ) : null}
                      <Anchor
                        component="button"
                        size="xs"
                        type="button"
                        onClick={() => onOpenFile("config/")}
                      >
                        {t("content.detail.openConfigFolder")}
                      </Anchor>
                    </Stack>
                  ) : null}
                  <Group gap="xs">
                    {focusedUpdate ? (
                      <Button
                        aria-label={t("content.installed.updateOneAria", {
                          content: focused.name,
                        })}
                        disabled={installUpdateMutation.isPending}
                        variant="primary"
                        onClick={() => installUpdateMutation.mutate(focused.id)}
                      >
                        <Download aria-hidden="true" size={14} />
                        {t("content.installed.update")}
                      </Button>
                    ) : null}
                    {isDisabled(focused) ? (
                      <Button
                        disabled={enableMutation.isPending}
                        variant="secondary"
                        onClick={() => enableMutation.mutate(focused.id)}
                      >
                        {t("tunnels.actions.enable")}
                      </Button>
                    ) : (
                      <Button
                        disabled={disableMutation.isPending}
                        variant="secondary"
                        onClick={() => {
                          disableMutation.reset();
                          setDangerAction({ kind: "disable", item: focused });
                        }}
                      >
                        {t("tunnels.actions.disable")}
                      </Button>
                    )}
                    <Button
                      disabled={uninstallMutation.isPending}
                      variant="ghost"
                      onClick={() => {
                        uninstallMutation.reset();
                        setDangerAction({ kind: "uninstall", item: focused });
                      }}
                    >
                      {t("content.installed.uninstall")}
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            </Grid.Col>
          ) : null}
        </Grid>
      ) : null}
      <ConfirmDangerDialog
        confirmLabel={
          dangerAction?.kind === "uninstall"
            ? t("danger.labels.uninstallContent")
            : t("danger.labels.disableContent")
        }
        description={
          dangerAction?.kind === "uninstall"
            ? t("danger.content.uninstall.description", {
                content: dangerAction.item.name,
                server: server.name,
              })
            : t("danger.content.disable.description", {
                content: dangerAction?.item.name ?? "",
                server: server.name,
              })
        }
        error={
          dangerAction?.kind === "uninstall"
            ? (uninstallMutation.error?.message ?? null)
            : (disableMutation.error?.message ?? null)
        }
        isConfirming={disableMutation.isPending || uninstallMutation.isPending}
        isOpen={dangerAction !== null}
        title={
          dangerAction?.kind === "uninstall"
            ? t("danger.content.uninstall.title")
            : t("danger.content.disable.title")
        }
        onCancel={() => setDangerAction(null)}
        onConfirm={() => {
          if (!dangerAction) {
            return;
          }
          if (dangerAction.kind === "uninstall") {
            uninstallMutation.mutate(dangerAction.item.id);
            return;
          }
          disableMutation.mutate(dangerAction.item.id);
        }}
      />
      <ConfirmDangerDialog
        confirmLabel={
          batchAction === "uninstall"
            ? t("content.selection.uninstall")
            : t("content.selection.disable")
        }
        description={t(
          batchAction === "uninstall"
            ? "content.selection.confirmUninstall"
            : "content.selection.confirmDisable",
          { count: selectedIds.size, server: server.name },
        )}
        error={batchMutation.error?.message ?? null}
        isConfirming={batchMutation.isPending}
        isOpen={batchAction !== null}
        title={t(
          batchAction === "uninstall"
            ? "content.selection.uninstallTitle"
            : "content.selection.disableTitle",
        )}
        onCancel={() => setBatchAction(null)}
        onConfirm={() => {
          if (batchAction) {
            batchMutation.mutate({
              action: batchAction,
              ids: [...selectedIds],
            });
          }
        }}
      />
      <ConfirmDangerDialog
        confirmLabel={t("content.updates.updateSelected", {
          count: selectedUpdateIds.length,
        })}
        consequences={[
          t("content.updates.consequenceReplace"),
          t("danger.content.updateAll.consequenceBackup"),
          t("danger.content.updateAll.consequenceRestart"),
        ]}
        description={t("danger.content.updateAll.description", {
          count: selectedUpdateIds.length,
          server: server.name,
        })}
        error={installAllUpdatesMutation.error?.message ?? null}
        isConfirming={installAllUpdatesMutation.isPending}
        isOpen={confirmUpdateAll}
        title={t("danger.content.updateAll.title")}
        onCancel={() => setConfirmUpdateAll(false)}
        onConfirm={() =>
          installAllUpdatesMutation.mutate(selectedUpdateIds, {
            onSuccess: () => setConfirmUpdateAll(false),
          })
        }
      />
    </Stack>
  );
}
