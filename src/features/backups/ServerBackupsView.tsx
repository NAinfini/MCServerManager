import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Download,
  RotateCcw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Box,
  Checkbox,
  Code,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { LoadingState } from "../../components/ui/loading-state";
import { PathField } from "../../components/ui/path-field";
import { Select } from "../../components/ui/select";
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { formatDateTime } from "../../lib/date-format";
import { formatBytes } from "../../lib/format-bytes";
import { useServerRuntime } from "../servers/ServerRuntimeContext";
import type { ServerProfile } from "../../domain/server";
import { processKeys } from "../process/queries";
import {
  createWorldBackup,
  deleteServerBackup,
  exportServerBackup,
  getBackupStatus,
  listServerBackups,
  previewBackupRestore,
  restoreWorldBackup,
  saveBackupSettings,
  type BackupRecord,
  type BackupRestorePreview,
  type BackupSettings,
} from "./backupApi";
import { BackupProfilesView } from "./BackupProfilesView";
import { backupKeys } from "./queries";

interface ServerBackupsViewProps {
  server: ServerProfile;
}

type Translate = (
  key: string,
  values?: Record<string, string | number | null | undefined>,
) => string;

const INTERVAL_HOURS = [1, 2, 3, 6, 12, 24];
const HOUR_MINUTES = 60;

function formatRelativeTime(value: string, language: string) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    return "";
  }
  const diffMs = then - Date.now();
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];
  for (const [unit, unitMs] of units) {
    if (Math.abs(diffMs) >= unitMs) {
      return rtf.format(Math.round(diffMs / unitMs), unit);
    }
  }
  return rtf.format(Math.round(diffMs / 1000), "second");
}

function isSafeRestoreTarget(value: string) {
  const trimmed = value.trim();
  return (
    trimmed !== "" &&
    trimmed !== "." &&
    trimmed !== ".." &&
    trimmed.toLowerCase() !== "backups" &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\")
  );
}

function baseName(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

function triggerLabel(backup: BackupRecord, t: Translate) {
  switch (backup.trigger) {
    case "scheduled":
      return t("backups.trigger.scheduled");
    case "pre_restart":
      return t("backups.trigger.preRestart");
    case "pre_update":
      return t("backups.trigger.preUpdate");
    default:
      return t("backups.trigger.manual");
  }
}

function settingsSummary(settings: BackupSettings, t: Translate) {
  if (!settings.enabled) return t("backups.status.off");
  const hours = settings.intervalMinutes / HOUR_MINUTES;
  return t("backups.settings.summary", {
    every: Number.isInteger(hours)
      ? t("backups.settings.everyHours", { count: hours })
      : t("backups.settings.everyMinutes", { count: settings.intervalMinutes }),
    recent: settings.keepRecent,
    daily: settings.keepDaily,
    weekly: settings.keepWeekly,
  });
}

interface SettingsDraft {
  enabled: boolean;
  intervalMinutes: number;
  beforeRestart: boolean;
  beforeUpdate: boolean;
  keepRecent: string;
  keepDaily: string;
  keepWeekly: string;
  maxTotalGb: string;
  location: string;
}

function draftFrom(settings: BackupSettings): SettingsDraft {
  return {
    enabled: settings.enabled,
    intervalMinutes: settings.intervalMinutes,
    beforeRestart: settings.beforeRestart,
    beforeUpdate: settings.beforeUpdate,
    keepRecent: String(settings.keepRecent),
    keepDaily: String(settings.keepDaily),
    keepWeekly: String(settings.keepWeekly),
    maxTotalGb: settings.maxTotalMb ? String(settings.maxTotalMb / 1024) : "",
    location: settings.location ?? "",
  };
}

function BackupSettingsPanel({
  server,
  settings,
}: {
  server: ServerProfile;
  settings: BackupSettings;
}) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFrom(settings));
  const [saved, setSaved] = useState(false);
  const patch = (changes: Partial<SettingsDraft>) => {
    setSaved(false);
    setDraft((current) => ({ ...current, ...changes }));
  };
  const intervalOptions = [
    ...new Set([
      ...INTERVAL_HOURS.map((hours) => hours * HOUR_MINUTES),
      draft.intervalMinutes,
    ]),
  ]
    .sort((a, b) => a - b)
    .map((minutes) => ({
      value: String(minutes),
      label:
        minutes % HOUR_MINUTES === 0
          ? t("backups.settings.everyHours", { count: minutes / HOUR_MINUTES })
          : t("backups.settings.everyMinutes", { count: minutes }),
    }));
  const saveMutation = useMutation({
    mutationFn: () =>
      saveBackupSettings({
        serverId: server.id,
        enabled: draft.enabled,
        intervalMinutes: draft.intervalMinutes,
        beforeRestart: draft.beforeRestart,
        beforeUpdate: draft.beforeUpdate,
        keepRecent: Number(draft.keepRecent),
        keepDaily: Number(draft.keepDaily),
        keepWeekly: Number(draft.keepWeekly),
        maxTotalMb: draft.maxTotalGb.trim()
          ? Math.round(Number(draft.maxTotalGb) * 1024)
          : null,
        location: draft.location.trim() || null,
      }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({
        queryKey: backupKeys.status(server.id),
      });
    },
  });
  const browseMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<{
        canceled: boolean;
        paths: string[];
      }>("show_open_dialog", { kind: "folder" }),
    onSuccess: (dialog) => {
      if (!dialog.canceled && dialog.paths[0]) {
        patch({ location: dialog.paths[0] });
      }
    },
  });
  const retentionValid = [draft.keepRecent, draft.keepDaily, draft.keepWeekly]
    .map(Number)
    .every((value) => Number.isInteger(value) && value >= 0);
  const capValid = !draft.maxTotalGb.trim() || Number(draft.maxTotalGb) > 0;
  const canSave = retentionValid && capValid && Number(draft.keepRecent) >= 1;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        saveMutation.mutate();
      }}
    >
      <Stack gap="md">
        <Switch
          aria-label={t("backups.settings.enabled")}
          checked={draft.enabled}
          label={t("backups.settings.enabled")}
          onChange={(event) => patch({ enabled: event.currentTarget.checked })}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Stack gap={4}>
            <Text fw={500} size="sm">
              {t("backups.settings.interval")}
            </Text>
            <Select
              ariaLabel={t("backups.settings.interval")}
              disabled={!draft.enabled}
              options={intervalOptions}
              value={String(draft.intervalMinutes)}
              onValueChange={(value) =>
                patch({ intervalMinutes: Number(value) })
              }
            />
          </Stack>
          <Stack gap={6}>
            <Text fw={500} size="sm">
              {t("backups.settings.also")}
            </Text>
            <Checkbox
              checked={draft.beforeRestart}
              label={t("backups.settings.beforeRestart")}
              onChange={(event) =>
                patch({ beforeRestart: event.currentTarget.checked })
              }
            />
            <Checkbox
              checked={draft.beforeUpdate}
              label={t("backups.settings.beforeUpdate")}
              onChange={(event) =>
                patch({ beforeUpdate: event.currentTarget.checked })
              }
            />
          </Stack>
        </SimpleGrid>
        <Stack gap={4}>
          <Text fw={500} size="sm">
            {t("backups.settings.keep")}
          </Text>
          <SimpleGrid cols={3} spacing="sm">
            {(
              [
                ["keepRecent", "backups.settings.keepRecent"],
                ["keepDaily", "backups.settings.keepDaily"],
                ["keepWeekly", "backups.settings.keepWeekly"],
              ] as const
            ).map(([key, label]) => (
              <NumberInput
                allowDecimal={false}
                allowNegative={false}
                key={key}
                label={t(label)}
                min={key === "keepRecent" ? 1 : 0}
                value={draft[key]}
                onChange={(value) => patch({ [key]: String(value) })}
              />
            ))}
          </SimpleGrid>
          <Text c="dimmed" size="xs">
            {t("backups.settings.keepHelp")}
          </Text>
        </Stack>
        <TextInput
          autoComplete="off"
          description={t("backups.settings.capHelp")}
          ff="monospace"
          id={`backup-cap-${server.id}`}
          inputMode="decimal"
          label={t("backups.settings.cap")}
          maw={240}
          placeholder={t("backups.settings.capAuto")}
          value={draft.maxTotalGb}
          onChange={(event) => patch({ maxTotalGb: event.target.value })}
        />
        <Stack gap={4}>
          <Text fw={500} size="sm">
            {t("backups.settings.location")}
          </Text>
          <PathField
            aria-label={t("backups.settings.location")}
            browseLabel={t("backups.settings.browse")}
            placeholder={t("backups.settings.locationDefault")}
            value={draft.location}
            onBrowse={() => browseMutation.mutate()}
            onChange={(event) => patch({ location: event.target.value })}
          />
          <Text c="dimmed" size="xs">
            {t("backups.settings.locationHelp")}
          </Text>
        </Stack>
        {saveMutation.error ? (
          <Alert color="red" py="xs">
            {saveMutation.error.message}
          </Alert>
        ) : null}
        <Group justify="flex-end">
          {saved ? (
            <Text c="dimmed" role="status" size="sm">
              {t("backups.settings.saved")}
            </Text>
          ) : null}
          <Button
            disabled={saveMutation.isPending || !canSave}
            type="submit"
            variant="primary"
          >
            {t("backups.settings.save")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function ServerBackupsView({ server }: ServerBackupsViewProps) {
  const { language, t } = useAppSettings();
  const queryClient = useQueryClient();
  const runtime = useServerRuntime();
  const [restoreBackup, setRestoreBackup] = useState<BackupRecord | null>(null);
  const [isRestoreConfirmOpen, setIsRestoreConfirmOpen] = useState(false);
  const [deleteBackup, setDeleteBackup] = useState<BackupRecord | null>(null);
  const [targetWorldDir, setTargetWorldDir] = useState("");
  const [restorePreview, setRestorePreview] =
    useState<BackupRestorePreview | null>(null);
  const backupsQuery = useQuery({
    queryKey: backupKeys.list(server.id),
    queryFn: () => listServerBackups(server.id),
  });
  const statusQuery = useQuery({
    queryKey: backupKeys.status(server.id),
    queryFn: () => getBackupStatus(server.id),
  });
  // "Next backup in 3 hours" must not freeze while the page stays open.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(
      () => setTick((value) => value + 1),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const refreshAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: backupKeys.list(server.id) }),
      queryClient.invalidateQueries({ queryKey: backupKeys.status(server.id) }),
    ]);
  const createMutation = useMutation({
    mutationFn: () => createWorldBackup({ serverId: server.id }),
    onSuccess: async () => {
      await Promise.all([
        refreshAll(),
        queryClient.invalidateQueries({
          queryKey: processKeys.events(server.id),
        }),
      ]);
    },
  });
  const restoreMutation = useMutation({
    mutationFn: () =>
      restoreWorldBackup({
        backupId: restoreBackup?.id ?? "",
        targetWorldDir:
          restorePreview?.mode === "worldOnly" ? targetWorldDir : undefined,
        confirm: true,
      }),
    onSuccess: async () => {
      setIsRestoreConfirmOpen(false);
      setRestoreBackup(null);
      setRestorePreview(null);
      setTargetWorldDir("");
      await refreshAll();
    },
  });
  const previewMutation = useMutation({
    mutationFn: () =>
      previewBackupRestore({
        serverId: server.id,
        backupId: restoreBackup?.id ?? "",
        targetWorldDir:
          restoreBackup?.kind === "world" || restoreBackup?.kind === "worldOnly"
            ? targetWorldDir
            : undefined,
      }),
    onSuccess: (preview) => {
      setRestorePreview(preview);
      setIsRestoreConfirmOpen(true);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (backupId: string) => deleteServerBackup(backupId),
    onSuccess: async () => {
      setDeleteBackup(null);
      await refreshAll();
    },
  });
  const exportMutation = useMutation({
    mutationFn: async (backupId: string) => {
      const dialog = await invokeDesktopCommandWithErrorHandling<{
        canceled: boolean;
        paths: string[];
      }>("show_open_dialog", { kind: "folder" });
      if (dialog.canceled || dialog.paths.length === 0) {
        return null;
      }
      // Snapshots are plain folders; a zip exists only because the user asked.
      return exportServerBackup({
        backupId,
        targetDir: dialog.paths[0],
        format: "zip",
      });
    },
  });

  const backups = backupsQuery.data ?? [];
  const status = statusQuery.data;
  const settings = status?.settings;
  const lastCompletedBackup = backups
    .filter((entry) => entry.status === "completed")
    .reduce<BackupRecord | null>(
      (latest, entry) =>
        !latest || new Date(entry.createdAt) > new Date(latest.createdAt)
          ? entry
          : latest,
      null,
    );
  const successTimes = [status?.lastSuccessAt, lastCompletedBackup?.createdAt]
    .filter((value): value is string => Boolean(value))
    .sort();
  const lastSuccessAt = successTimes[successTimes.length - 1];
  const staleAfterMs = Math.max(
    (settings?.enabled ? settings.intervalMinutes : 0) * 2 * 60_000,
    24 * 60 * 60_000,
  );
  const isStale =
    lastSuccessAt !== undefined &&
    Date.now() - new Date(lastSuccessAt).getTime() > staleAfterMs;
  const tone = !lastSuccessAt || isStale ? "warning" : "ok";
  const headline = !lastSuccessAt
    ? t("backups.status.none")
    : isStale
      ? t("backups.status.stale", {
          time: formatRelativeTime(lastSuccessAt, language),
        })
      : t("backups.status.last", {
          time: formatRelativeTime(lastSuccessAt, language),
        });
  const detailParts: string[] = [];
  if (settings) {
    detailParts.push(
      settings.enabled && status?.nextRunAt
        ? t("backups.status.next", {
            time: formatRelativeTime(status.nextRunAt, language),
          })
        : t("backups.status.off"),
    );
  }
  if (status) {
    detailParts.push(
      status.freeBytes === null
        ? t("backups.status.spaceUnknown", {
            used: formatBytes(status.usedBytes),
          })
        : t("backups.status.space", {
            used: formatBytes(status.usedBytes),
            free: formatBytes(status.freeBytes),
          }),
    );
  }
  const expectsWorldTarget =
    restoreBackup?.kind === "world" || restoreBackup?.kind === "worldOnly";
  const canRestoreTarget =
    !expectsWorldTarget || isSafeRestoreTarget(targetWorldDir);
  const restoreBlocked =
    runtime.error !== null ||
    runtime.status === "running" ||
    runtime.status === "stopping" ||
    runtime.status === "externalRunning";
  const isLegacyCopy = (backup: BackupRecord) =>
    (backup.format ?? "full") === "full";

  return (
    <Stack
      aria-label={t("backups.aria")}
      component="section"
      data-testid="backups-page"
      gap="md"
    >
      <Paper data-testid="backups-status" data-tone={tone} p="md" role="status">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" miw={0} wrap="nowrap">
            <ThemeIcon
              aria-hidden="true"
              color={tone === "ok" ? "green" : "yellow"}
              size="lg"
              variant="light"
            >
              {tone === "ok" ? (
                <ShieldCheck size={18} />
              ) : (
                <ShieldAlert size={18} />
              )}
            </ThemeIcon>
            <Box miw={0}>
              <Text fw={600}>{headline}</Text>
              {detailParts.length ? (
                <Text c="dimmed" size="sm">
                  {detailParts.join(" · ")}
                </Text>
              ) : null}
            </Box>
          </Group>
          <Button
            disabled={createMutation.isPending}
            variant="primary"
            onClick={() => createMutation.mutate()}
          >
            <Archive aria-hidden="true" size={14} />
            {createMutation.isPending
              ? t("backups.creating")
              : t("backups.now")}
          </Button>
        </Group>
      </Paper>

      {createMutation.error ? (
        <Alert color="red" py="xs" role="alert">
          {createMutation.error.message}
        </Alert>
      ) : null}
      {restoreMutation.error ? (
        <Alert color="red" py="xs">
          {restoreMutation.error.message}
        </Alert>
      ) : null}
      {deleteMutation.error ? (
        <Alert color="red" py="xs">
          {deleteMutation.error.message}
        </Alert>
      ) : null}
      {exportMutation.error ? (
        <Alert color="red" py="xs">
          {exportMutation.error.message}
        </Alert>
      ) : null}
      {exportMutation.data?.exportedPath ? (
        <Alert color="green" py="xs" role="status">
          {t("backups.exported", { path: exportMutation.data.exportedPath })}
        </Alert>
      ) : null}

      {restoreBackup ? (
        <Paper p="md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              restoreMutation.reset();
              previewMutation.mutate();
            }}
          >
            <Stack gap="sm">
              <Box>
                <Title order={4}>
                  {t("backups.restore.title", {
                    world: restoreBackup.worldName,
                  })}
                </Title>
                <Text c="dimmed" size="sm">
                  {t("backups.restore.description")}
                </Text>
              </Box>
              {expectsWorldTarget ? (
                <TextInput
                  autoFocus
                  required
                  autoComplete="off"
                  error={
                    canRestoreTarget
                      ? undefined
                      : t("backups.restore.invalidTarget")
                  }
                  ff="monospace"
                  label={t("backups.restore.target")}
                  maw={360}
                  placeholder={restoreBackup.worldName}
                  value={targetWorldDir}
                  withAsterisk={false}
                  onChange={(event) => {
                    setTargetWorldDir(event.target.value);
                    setRestorePreview(null);
                    previewMutation.reset();
                  }}
                />
              ) : (
                <Text size="sm">{t("backups.restore.fullScope")}</Text>
              )}
              {previewMutation.error ? (
                <Alert color="red" py="xs" role="alert">
                  {previewMutation.error.message}
                </Alert>
              ) : null}
              <Group gap="xs" justify="flex-end">
                <Button
                  disabled={restoreMutation.isPending}
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    restoreMutation.reset();
                    setIsRestoreConfirmOpen(false);
                    setRestoreBackup(null);
                    setRestorePreview(null);
                    setTargetWorldDir("");
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  disabled={
                    previewMutation.isPending ||
                    restoreMutation.isPending ||
                    !canRestoreTarget
                  }
                  type="submit"
                  variant="danger"
                >
                  <ScanSearch aria-hidden="true" size={14} />
                  {previewMutation.isPending
                    ? t("backups.restore.previewing")
                    : t("backups.restore.preview")}
                </Button>
              </Group>
            </Stack>
          </form>
        </Paper>
      ) : null}

      {backupsQuery.isLoading ? (
        <LoadingState message={t("backups.loading")} />
      ) : null}

      {backupsQuery.error ? (
        <Alert color="red" role="alert" title={t("backups.loadError.title")}>
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{backupsQuery.error.message}</Text>
            <Button variant="secondary" onClick={() => backupsQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : null}

      {!backupsQuery.isLoading &&
      !backupsQuery.error &&
      backups.length === 0 ? (
        <Paper p="md">
          <Text fw={600} size="sm">
            {t("backups.empty.title")}
          </Text>
          <Text c="dimmed" size="sm">
            {t("backups.empty.description")}
          </Text>
        </Paper>
      ) : null}

      {backups.length > 0 ? (
        <Paper data-testid="backups-list" p={0}>
          <Group justify="space-between" px="md" py="sm">
            <Title order={4}>{t("backups.points.title")}</Title>
            <Text c="dimmed" size="sm">
              {t("backups.points.count", { count: backups.length })}
            </Text>
          </Group>
          <Table.ScrollContainer minWidth={640}>
            <Table
              aria-label={t("backups.points.title")}
              highlightOnHover
              verticalSpacing="xs"
            >
              <Table.Tbody>
                {backups.map((backup) => {
                  const completed = backup.status === "completed";
                  return (
                    <Table.Tr data-testid="backup-row" key={backup.id}>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        <Text fw={500} size="sm">
                          {formatDateTime(backup.createdAt, language)}
                        </Text>
                        <Text c="dimmed" size="xs">
                          {formatRelativeTime(backup.createdAt, language)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group
                          gap={6}
                          preventGrowOverflow={false}
                          wrap="nowrap"
                        >
                          <Badge color="gray">{triggerLabel(backup, t)}</Badge>
                          {isLegacyCopy(backup) ? (
                            <Badge color="gray" variant="outline">
                              {t("backups.format.full")}
                            </Badge>
                          ) : backup.kind === "fullServer" ? (
                            <Badge variant="outline">
                              {t("backups.format.fullServer")}
                            </Badge>
                          ) : null}
                        </Group>
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        {completed ? (
                          <>
                            <Text ff="monospace" size="sm">
                              {formatBytes(
                                backup.logicalBytes ?? backup.sizeBytes,
                              )}
                            </Text>
                            {!isLegacyCopy(backup) &&
                            backup.newBytes !== undefined ? (
                              <Text c="dimmed" ff="monospace" size="xs">
                                {t("backups.points.added", {
                                  size: formatBytes(backup.newBytes),
                                })}
                              </Text>
                            ) : null}
                          </>
                        ) : (
                          <Badge color="red">{t("backups.failed")}</Badge>
                        )}
                      </Table.Td>
                      <Table.Td maw={0} w="100%">
                        <Text
                          c={backup.error ? "red" : "dimmed"}
                          ff="monospace"
                          size="xs"
                          title={backup.error ?? backup.archivePath}
                          truncate
                        >
                          {backup.error ?? baseName(backup.archivePath)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={2} justify="flex-end" wrap="nowrap">
                          <Tooltip
                            label={
                              restoreBlocked
                                ? t("backups.restore.runningTitle")
                                : completed
                                  ? t("backups.restore.titleAttr")
                                  : t("backups.restore.unavailableTitle")
                            }
                          >
                            <ActionIcon
                              aria-label={t("backups.restore.titleAttr")}
                              disabled={
                                !completed ||
                                restoreBlocked ||
                                restoreMutation.isPending
                              }
                              onClick={() => {
                                restoreMutation.reset();
                                setRestoreBackup(backup);
                                setRestorePreview(null);
                                previewMutation.reset();
                                setTargetWorldDir(backup.worldName || "world");
                              }}
                            >
                              <RotateCcw aria-hidden="true" size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={t("backups.export.titleAttr")}>
                            <ActionIcon
                              aria-label={t("backups.export.titleAttr")}
                              disabled={!completed || exportMutation.isPending}
                              onClick={() => exportMutation.mutate(backup.id)}
                            >
                              <Download aria-hidden="true" size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={t("backups.delete.titleAttr")}>
                            <ActionIcon
                              aria-label={t("backups.delete.titleAttr")}
                              color="red"
                              disabled={deleteMutation.isPending}
                              onClick={() => {
                                deleteMutation.reset();
                                setDeleteBackup(backup);
                              }}
                            >
                              <Trash2 aria-hidden="true" size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      ) : null}

      <Accordion chevronPosition="left" variant="separated">
        <Accordion.Item data-testid="backups-settings" value="settings">
          <Accordion.Control>
            <Group gap="sm" justify="space-between" wrap="nowrap">
              <Text fw={600}>{t("backups.settings.title")}</Text>
              {settings ? (
                <Text c="dimmed" size="sm">
                  {settingsSummary(settings, t)}
                </Text>
              ) : null}
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              {settings ? (
                <BackupSettingsPanel
                  key={server.id}
                  server={server}
                  settings={settings}
                />
              ) : statusQuery.error ? (
                <Alert color="red" py="xs" role="alert">
                  {statusQuery.error.message}
                </Alert>
              ) : (
                <LoadingState message={t("backups.loading")} />
              )}
              <Accordion chevronPosition="left">
                <Accordion.Item value="profiles">
                  <Accordion.Control>
                    <Text fw={500} size="sm">
                      {t("backups.profiles.advancedTitle")}
                    </Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <BackupProfilesView server={server} />
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      <ConfirmDangerDialog
        confirmLabel={t("danger.labels.restoreBackup")}
        description={
          restorePreview?.mode === "worldOnly"
            ? t("danger.backup.restore.description", {
                world: restoreBackup?.worldName ?? "",
                target: targetWorldDir,
              })
            : t("backups.restore.confirmFullDescription")
        }
        error={restoreMutation.error?.message ?? null}
        isConfirming={restoreMutation.isPending}
        isOpen={isRestoreConfirmOpen}
        title={t("danger.backup.restore.title")}
        onCancel={() => setIsRestoreConfirmOpen(false)}
        onConfirm={() => restoreMutation.mutate()}
      >
        {restorePreview ? (
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                {t(`backups.restore.mode.${restorePreview.mode}`)}
              </Text>
              <Text c="dimmed" size="sm">
                {t("backups.restore.previewSummary", {
                  count: restorePreview.fileCount,
                  size: formatBytes(restorePreview.sizeBytes),
                })}
              </Text>
            </Group>
            <Paper bg="var(--mantine-color-default-hover)" p="xs">
              <ScrollArea.Autosize mah={180}>
                <Stack gap={2}>
                  {restorePreview.relativePaths
                    .slice(0, 8)
                    .map((relativePath) => (
                      <Code bg="transparent" key={relativePath}>
                        {relativePath}
                      </Code>
                    ))}
                </Stack>
              </ScrollArea.Autosize>
            </Paper>
            {restorePreview.relativePaths.length > 8 ? (
              <Text c="dimmed" size="sm">
                {t("backups.restore.morePaths", {
                  count: restorePreview.relativePaths.length - 8,
                })}
              </Text>
            ) : null}
            {restorePreview.warnings.length ? (
              <Alert color="yellow" py="xs">
                <Stack gap={2}>
                  {restorePreview.warnings.map((warning) => (
                    <Text key={warning} size="sm">
                      {warning}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            ) : null}
          </Stack>
        ) : null}
      </ConfirmDangerDialog>
      <ConfirmDangerDialog
        confirmLabel={t("danger.labels.deleteBackup")}
        description={t("danger.backup.delete.description", {
          world: deleteBackup?.worldName ?? "",
        })}
        error={deleteMutation.error?.message ?? null}
        isConfirming={deleteMutation.isPending}
        isOpen={deleteBackup !== null}
        title={t("danger.backup.delete.title")}
        onCancel={() => setDeleteBackup(null)}
        onConfirm={() => {
          if (deleteBackup) {
            deleteMutation.mutate(deleteBackup.id);
          }
        }}
      />
    </Stack>
  );
}
