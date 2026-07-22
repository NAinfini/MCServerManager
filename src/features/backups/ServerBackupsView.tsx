import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  Download,
  Info,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import type { ServerProfile } from "../servers/types";
import { getServerProcessStatus } from "../process/api";
import {
  createWorldBackup,
  deleteServerBackup,
  exportServerBackup,
  listServerBackups,
  restoreWorldBackup,
  type BackupRecord,
} from "./backupApi";
import { BackupProfilesView } from "./BackupProfilesView";

interface ServerBackupsViewProps {
  server: ServerProfile;
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${(sizeBytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

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

function backupStatusIcon(backup: BackupRecord) {
  if (backup.status === "completed") {
    return (
      <CheckCircle2
        aria-hidden="true"
        className="backup-status-completed"
        size={16}
      />
    );
  }

  return (
    <XCircle aria-hidden="true" className="backup-status-failed" size={16} />
  );
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

export function ServerBackupsView({ server }: ServerBackupsViewProps) {
  const { language, t } = useAppSettings();
  const queryClient = useQueryClient();
  const [restoreBackup, setRestoreBackup] = useState<BackupRecord | null>(null);
  const [isRestoreConfirmOpen, setIsRestoreConfirmOpen] = useState(false);
  const [deleteBackup, setDeleteBackup] = useState<BackupRecord | null>(null);
  const [targetWorldDir, setTargetWorldDir] = useState("");
  const backupsQuery = useQuery({
    queryKey: ["backups", server.id],
    queryFn: () => listServerBackups(server.id),
  });
  const processQuery = useQuery({
    queryKey: ["serverProcessStatus", server.id],
    queryFn: () => getServerProcessStatus(server.id),
    refetchInterval: 1500,
  });
  const createMutation = useMutation({
    mutationFn: () => createWorldBackup({ serverId: server.id }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["backups", server.id] }),
        queryClient.invalidateQueries({
          queryKey: ["processEvents", server.id],
        }),
      ]);
    },
  });
  const restoreMutation = useMutation({
    mutationFn: () =>
      restoreWorldBackup({
        backupId: restoreBackup?.id ?? "",
        targetWorldDir,
        confirm: true,
      }),
    onSuccess: async () => {
      setIsRestoreConfirmOpen(false);
      setRestoreBackup(null);
      setTargetWorldDir("");
      await queryClient.invalidateQueries({ queryKey: ["backups", server.id] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (backupId: string) => deleteServerBackup(backupId),
    onSuccess: async () => {
      setDeleteBackup(null);
      await queryClient.invalidateQueries({ queryKey: ["backups", server.id] });
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
      return exportServerBackup({
        backupId,
        targetDir: dialog.paths[0],
      });
    },
  });

  const backups = backupsQuery.data ?? [];
  const lastCompletedBackup = backups
    .filter((entry) => entry.status === "completed")
    .reduce<BackupRecord | null>(
      (latest, entry) =>
        !latest || new Date(entry.createdAt) > new Date(latest.createdAt)
          ? entry
          : latest,
      null,
    );
  const lastBackupSummary = lastCompletedBackup
    ? t("backups.lastBackup", {
        time: formatRelativeTime(lastCompletedBackup.createdAt, language),
        size: formatBytes(lastCompletedBackup.sizeBytes),
      })
    : t("backups.lastBackupNone");
  const canRestoreTarget = isSafeRestoreTarget(targetWorldDir);
  const restoreBlocked =
    processQuery.isError ||
    processQuery.data?.status === "running" ||
    processQuery.data?.status === "externalRunning";

  return (
    <section className="backups-panel" aria-label={t("backups.aria")}>
      <div className="backups-hero">
        <div className="backups-hero-copy">
          <strong>{t("backups.title")}</strong>
          <span>{lastBackupSummary}</span>
        </div>
        <Button
          disabled={createMutation.isPending}
          variant="primary"
          onClick={() => createMutation.mutate()}
        >
          <Archive aria-hidden="true" size={15} />
          {t("backups.now")}
        </Button>
      </div>

      <p className="info-note backup-info-note">
        <Info aria-hidden="true" size={15} />
        <span>{t("backups.liveWarning")}</span>
      </p>

      {createMutation.error ? (
        <div className="inline-error backups-error">
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
        <div className="success-panel backups-error">
          {t("backups.exported", { path: exportMutation.data.exportedPath })}
        </div>
      ) : null}

      {restoreBackup ? (
        <form
          className="inline-dialog backup-restore-dialog"
          onSubmit={(event) => {
            event.preventDefault();
            restoreMutation.reset();
            setIsRestoreConfirmOpen(true);
          }}
        >
          <div>
            <h3>{t("backups.restore.title", { world: restoreBackup.worldName })}</h3>
            <p>{t("backups.restore.description")}</p>
          </div>
          <label>
            <span>{t("backups.restore.target")}</span>
            <TextField
              autoFocus
              required
              placeholder={restoreBackup.worldName}
              value={targetWorldDir}
              onChange={(event) => setTargetWorldDir(event.target.value)}
            />
          </label>
          {!canRestoreTarget ? (
            <p className="danger-text">{t("backups.restore.invalidTarget")}</p>
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
                setTargetWorldDir("");
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={
                restoreMutation.isPending || !canRestoreTarget
              }
              type="submit"
              variant="danger"
            >
              {t("common.restore")}
            </Button>
          </div>
        </form>
      ) : null}

      {backupsQuery.isLoading ? (
        <LoadingState message={t("backups.loading")} />
      ) : null}

      {backupsQuery.error ? (
        <div className="list-state list-state-error">
          <strong>{t("backups.loadError.title")}</strong>
          <span>{backupsQuery.error.message}</span>
        </div>
      ) : null}

      {!backupsQuery.isLoading &&
      !backupsQuery.error &&
      backups.length === 0 ? (
        <EmptyState
          illustration="/illustrations/no-backups.png"
          title={t("backups.empty.title")}
          description={t("backups.empty.description")}
        >
          <Button
            disabled={createMutation.isPending}
            variant="primary"
            onClick={() => createMutation.mutate()}
          >
            <Archive aria-hidden="true" size={15} />
            {t("backups.now")}
          </Button>
        </EmptyState>
      ) : null}

      {backups.length > 0 ? (
        <div className="backups-table-scroll">
          <table className="backups-table">
            <thead>
              <tr>
                <th scope="col">{t("backups.table.status")}</th>
                <th scope="col">{t("backups.table.world")}</th>
                <th scope="col">{t("backups.table.created")}</th>
                <th scope="col">{t("backups.table.size")}</th>
                <th scope="col">{t("backups.table.archive")}</th>
                <th scope="col">{t("backups.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.id}>
                  <td>{backupStatusIcon(backup)}</td>
                  <th scope="row">{backup.worldName}</th>
                  <td>{formatDate(backup.createdAt)}</td>
                  <td>
                    {backup.status === "completed"
                      ? formatBytes(backup.sizeBytes)
                      : t("backups.failed")}
                  </td>
                  <td className="path-cell">
                    {backup.error ?? backup.archivePath}
                  </td>
                  <td>
                    <Button
                      disabled={
                        backup.status !== "completed" ||
                        restoreBlocked ||
                        restoreMutation.isPending
                      }
                      title={
                        restoreBlocked
                          ? t("backups.restore.runningTitle")
                          : backup.status === "completed"
                          ? t("backups.restore.titleAttr")
                          : t("backups.restore.unavailableTitle")
                      }
                      variant="ghost"
                      onClick={() => {
                        restoreMutation.reset();
                        setRestoreBackup(backup);
                        setTargetWorldDir(backup.worldName);
                      }}
                    >
                      <RotateCcw aria-hidden="true" size={14} />
                    </Button>
                    <Button
                      disabled={
                        backup.status !== "completed" ||
                        exportMutation.isPending
                      }
                      title={t("backups.export.titleAttr")}
                      variant="ghost"
                      onClick={() => exportMutation.mutate(backup.id)}
                    >
                      <Download aria-hidden="true" size={14} />
                    </Button>
                    <Button
                      disabled={deleteMutation.isPending}
                      title={t("backups.delete.titleAttr")}
                      variant="ghost"
                      onClick={() => {
                        deleteMutation.reset();
                        setDeleteBackup(backup);
                      }}
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <details className="disclosure backups-advanced">
        <summary>{t("backups.profiles.advancedTitle")}</summary>
        <div className="disclosure-body">
          <BackupProfilesView server={server} />
        </div>
      </details>

      <ConfirmDangerDialog
        confirmLabel={t("danger.labels.restoreBackup")}
        description={t("danger.backup.restore.description", {
          world: restoreBackup?.worldName ?? "",
          target: targetWorldDir,
        })}
        error={restoreMutation.error?.message ?? null}
        isConfirming={restoreMutation.isPending}
        isOpen={isRestoreConfirmOpen}
        title={t("danger.backup.restore.title")}
        onCancel={() => setIsRestoreConfirmOpen(false)}
        onConfirm={() => restoreMutation.mutate()}
      />
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
