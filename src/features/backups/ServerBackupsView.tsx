import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  Download,
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
  const { t } = useAppSettings();
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
    queryKey: ["processStatus", server.id],
    queryFn: () => getServerProcessStatus(server.id),
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
  const canRestoreTarget = isSafeRestoreTarget(targetWorldDir);
  const restoreBlocked =
    processQuery.isError ||
    processQuery.data?.status === "running" ||
    processQuery.data?.status === "externalRunning";

  return (
    <section className="backups-panel" aria-label={t("backups.aria")}>
      <div className="backups-toolbar">
        <div>
          <strong>{t("backups.title")}</strong>
          <span>{t("backups.description")}</span>
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

      <div className="warning-panel backup-warning">
        <p>
          {t("backups.liveWarning")}
        </p>
      </div>
      <BackupProfilesView server={server} />

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
        />
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
