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
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { PathField } from "../../components/ui/path-field";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { TextField } from "../../components/ui/text-field";
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
import "../files/operations.css";
import "../../styles/backups.css";

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
    maxTotalGb: settings.maxTotalMb
      ? String(settings.maxTotalMb / 1024)
      : "",
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
  const capValid =
    !draft.maxTotalGb.trim() || Number(draft.maxTotalGb) > 0;
  const canSave =
    retentionValid && capValid && Number(draft.keepRecent) >= 1;

  return (
    <form
      className="bk-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        saveMutation.mutate();
      }}
    >
      <div className="bk-field bk-field-inline">
        <Switch
          aria-label={t("backups.settings.enabled")}
          checked={draft.enabled}
          onCheckedChange={(checked) => patch({ enabled: checked })}
        />
        <span>{t("backups.settings.enabled")}</span>
      </div>
      <div className="bk-field">
        <span className="bk-field-label">{t("backups.settings.interval")}</span>
        <Select
          ariaLabel={t("backups.settings.interval")}
          disabled={!draft.enabled}
          options={intervalOptions}
          value={String(draft.intervalMinutes)}
          onValueChange={(value) => patch({ intervalMinutes: Number(value) })}
        />
      </div>
      <div className="bk-field">
        <span className="bk-field-label">{t("backups.settings.also")}</span>
        <label className="bk-check">
          <Checkbox
            checked={draft.beforeRestart}
            onCheckedChange={(checked) =>
              patch({ beforeRestart: checked === true })
            }
          />
          {t("backups.settings.beforeRestart")}
        </label>
        <label className="bk-check">
          <Checkbox
            checked={draft.beforeUpdate}
            onCheckedChange={(checked) =>
              patch({ beforeUpdate: checked === true })
            }
          />
          {t("backups.settings.beforeUpdate")}
        </label>
      </div>
      <div className="bk-field bk-field-wide">
        <span className="bk-field-label">{t("backups.settings.keep")}</span>
        <div className="bk-keep">
          {(
            [
              ["keepRecent", "backups.settings.keepRecent"],
              ["keepDaily", "backups.settings.keepDaily"],
              ["keepWeekly", "backups.settings.keepWeekly"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <span>{t(label)}</span>
              <TextField
                inputMode="numeric"
                min={key === "keepRecent" ? 1 : 0}
                type="number"
                value={draft[key]}
                onChange={(event) => patch({ [key]: event.target.value })}
              />
            </label>
          ))}
        </div>
        <p className="bk-help">{t("backups.settings.keepHelp")}</p>
      </div>
      <div className="bk-field">
        <label className="bk-field-label" htmlFor={`backup-cap-${server.id}`}>
          {t("backups.settings.cap")}
        </label>
        <input
          className="text-input"
          id={`backup-cap-${server.id}`}
          inputMode="decimal"
          placeholder={t("backups.settings.capAuto")}
          value={draft.maxTotalGb}
          onChange={(event) => patch({ maxTotalGb: event.target.value })}
        />
        <p className="bk-help">{t("backups.settings.capHelp")}</p>
      </div>
      <div className="bk-field bk-field-wide">
        <span className="bk-field-label">{t("backups.settings.location")}</span>
        <PathField
          aria-label={t("backups.settings.location")}
          browseLabel={t("backups.settings.browse")}
          placeholder={t("backups.settings.locationDefault")}
          value={draft.location}
          onBrowse={() => browseMutation.mutate()}
          onChange={(event) => patch({ location: event.target.value })}
        />
        <p className="bk-help">{t("backups.settings.locationHelp")}</p>
      </div>
      {saveMutation.error ? (
        <p className="danger-text bk-form-note" role="alert">
          {saveMutation.error.message}
        </p>
      ) : null}
      {saved ? (
        <p className="bk-form-note" role="status">
          {t("backups.settings.saved")}
        </p>
      ) : null}
      <div className="bk-form-actions">
        <Button
          disabled={saveMutation.isPending || !canSave}
          type="submit"
          variant="primary"
        >
          {t("backups.settings.save")}
        </Button>
      </div>
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
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
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
    <section
      className="backups-panel bk-page"
      aria-label={t("backups.aria")}
      data-testid="backups-page"
    >
      <div
        className="bk-status"
        data-testid="backups-status"
        data-tone={tone}
        role="status"
      >
        <span aria-hidden="true" className="bk-status-icon">
          {tone === "ok" ? (
            <ShieldCheck size={20} />
          ) : (
            <ShieldAlert size={20} />
          )}
        </span>
        <div className="bk-status-copy">
          <strong>{headline}</strong>
          {detailParts.length ? <span>{detailParts.join(" · ")}</span> : null}
        </div>
        <Button
          disabled={createMutation.isPending}
          variant="primary"
          onClick={() => createMutation.mutate()}
        >
          <Archive aria-hidden="true" size={15} />
          {createMutation.isPending
            ? t("backups.creating")
            : t("backups.now")}
        </Button>
      </div>

      {createMutation.error ? (
        <div className="inline-error backups-error" role="alert">
          {createMutation.error.message}
        </div>
      ) : null}
      {restoreMutation.error ? (
        <div className="inline-error backups-error">
          {restoreMutation.error.message}
        </div>
      ) : null}
      {deleteMutation.error ? (
        <div className="inline-error backups-error">
          {deleteMutation.error.message}
        </div>
      ) : null}
      {exportMutation.error ? (
        <div className="inline-error backups-error">
          {exportMutation.error.message}
        </div>
      ) : null}
      {exportMutation.data?.exportedPath ? (
        <div className="success-panel backups-note" role="status">
          {t("backups.exported", { path: exportMutation.data.exportedPath })}
        </div>
      ) : null}

      {restoreBackup ? (
        <form
          className="inline-dialog backup-restore-dialog"
          onSubmit={(event) => {
            event.preventDefault();
            restoreMutation.reset();
            previewMutation.mutate();
          }}
        >
          <div>
            <h3>
              {t("backups.restore.title", { world: restoreBackup.worldName })}
            </h3>
            <p>{t("backups.restore.description")}</p>
          </div>
          {expectsWorldTarget ? (
            <label>
              <span>{t("backups.restore.target")}</span>
              <TextField
                autoFocus
                required
                placeholder={restoreBackup.worldName}
                value={targetWorldDir}
                onChange={(event) => {
                  setTargetWorldDir(event.target.value);
                  setRestorePreview(null);
                  previewMutation.reset();
                }}
              />
            </label>
          ) : (
            <p className="info-note">{t("backups.restore.fullScope")}</p>
          )}
          {expectsWorldTarget && !canRestoreTarget ? (
            <p className="danger-text">{t("backups.restore.invalidTarget")}</p>
          ) : null}
          {previewMutation.error ? (
            <p className="danger-text" role="alert">
              {previewMutation.error.message}
            </p>
          ) : null}
          <div className="dialog-actions">
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
          </div>
        </form>
      ) : null}

      {backupsQuery.isLoading ? (
        <LoadingState message={t("backups.loading")} />
      ) : null}

      {backupsQuery.error ? (
        <div className="list-state list-state-error" role="alert">
          <strong>{t("backups.loadError.title")}</strong>
          <span>{backupsQuery.error.message}</span>
          <Button variant="secondary" onClick={() => backupsQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

      {!backupsQuery.isLoading &&
      !backupsQuery.error &&
      backups.length === 0 ? (
        <EmptyState
          illustration="/illustrations/no-backups.png"
          title={t("backups.empty.title")}
          description={t("backups.empty.description")}
        />
      ) : null}

      {backups.length > 0 ? (
        <div className="bk-list-panel" data-testid="backups-list">
          <div className="bk-list-head">
            <span>{t("backups.points.title")}</span>
            <span>{t("backups.points.count", { count: backups.length })}</span>
          </div>
          <ul aria-label={t("backups.points.title")} className="bk-list">
            {backups.map((backup) => {
              const completed = backup.status === "completed";
              return (
                <li
                  className={`bk-row${completed ? "" : " is-failed"}`}
                  data-testid="backup-row"
                  key={backup.id}
                >
                  <div className="bk-row-when">
                    <strong>{formatDateTime(backup.createdAt, language)}</strong>
                    <span>{formatRelativeTime(backup.createdAt, language)}</span>
                  </div>
                  <span className="bk-row-kind">
                    {triggerLabel(backup, t)}
                    {isLegacyCopy(backup) ? (
                      <small>{t("backups.format.full")}</small>
                    ) : backup.kind === "fullServer" ? (
                      <small>{t("backups.format.fullServer")}</small>
                    ) : null}
                  </span>
                  <span className="bk-row-size">
                    {completed ? (
                      <>
                        {formatBytes(backup.logicalBytes ?? backup.sizeBytes)}
                        {!isLegacyCopy(backup) &&
                        backup.newBytes !== undefined ? (
                          <small>
                            {t("backups.points.added", {
                              size: formatBytes(backup.newBytes),
                            })}
                          </small>
                        ) : null}
                      </>
                    ) : (
                      t("backups.failed")
                    )}
                  </span>
                  <code
                    className="bk-row-path"
                    title={backup.error ?? backup.archivePath}
                  >
                    {backup.error ?? baseName(backup.archivePath)}
                  </code>
                  <div className="bk-row-actions">
                    <Button
                      aria-label={t("backups.restore.titleAttr")}
                      className="icon-button"
                      disabled={
                        !completed || restoreBlocked || restoreMutation.isPending
                      }
                      title={
                        restoreBlocked
                          ? t("backups.restore.runningTitle")
                          : completed
                            ? t("backups.restore.titleAttr")
                            : t("backups.restore.unavailableTitle")
                      }
                      variant="ghost"
                      onClick={() => {
                        restoreMutation.reset();
                        setRestoreBackup(backup);
                        setRestorePreview(null);
                        previewMutation.reset();
                        setTargetWorldDir(backup.worldName || "world");
                      }}
                    >
                      <RotateCcw aria-hidden="true" size={14} />
                    </Button>
                    <Button
                      aria-label={t("backups.export.titleAttr")}
                      className="icon-button"
                      disabled={!completed || exportMutation.isPending}
                      title={t("backups.export.titleAttr")}
                      variant="ghost"
                      onClick={() => exportMutation.mutate(backup.id)}
                    >
                      <Download aria-hidden="true" size={14} />
                    </Button>
                    <Button
                      aria-label={t("backups.delete.titleAttr")}
                      className="icon-button"
                      disabled={deleteMutation.isPending}
                      title={t("backups.delete.titleAttr")}
                      variant="danger"
                      onClick={() => {
                        deleteMutation.reset();
                        setDeleteBackup(backup);
                      }}
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <details className="bk-settings" data-testid="backups-settings">
        <summary>
          <span className="bk-settings-title">{t("backups.settings.title")}</span>
          {settings ? (
            <span className="bk-settings-summary">
              {settingsSummary(settings, t)}
            </span>
          ) : null}
        </summary>
        {settings ? (
          <BackupSettingsPanel
            key={server.id}
            server={server}
            settings={settings}
          />
        ) : statusQuery.error ? (
          <p className="danger-text" role="alert">
            {statusQuery.error.message}
          </p>
        ) : (
          <LoadingState message={t("backups.loading")} />
        )}
        <details className="bk-advanced">
          <summary>{t("backups.profiles.advancedTitle")}</summary>
          <BackupProfilesView server={server} />
        </details>
      </details>

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
          <div className="restore-preview">
            <div className="restore-preview-summary">
              <strong>
                {t(`backups.restore.mode.${restorePreview.mode}`)}
              </strong>
              <span>
                {t("backups.restore.previewSummary", {
                  count: restorePreview.fileCount,
                  size: formatBytes(restorePreview.sizeBytes),
                })}
              </span>
            </div>
            <ul className="restore-preview-paths">
              {restorePreview.relativePaths.slice(0, 8).map((relativePath) => (
                <li key={relativePath}>{relativePath}</li>
              ))}
            </ul>
            {restorePreview.relativePaths.length > 8 ? (
              <p>
                {t("backups.restore.morePaths", {
                  count: restorePreview.relativePaths.length - 8,
                })}
              </p>
            ) : null}
            {restorePreview.warnings.length ? (
              <ul className="restore-preview-warnings">
                {restorePreview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
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
    </section>
  );
}
