import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, History, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { EmptyState } from "../../components/ui/empty-state";
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
import "./content.css";

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
    <div className="content-updates-workspace">
      <AvailableUpdatesPanel server={server} />
      <ContentUpdatePolicyView server={server} />
    </div>
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
      <section
        className="settings-panel content-updates"
        aria-label={t("server.workspace.content.updates")}
      >
        <LoadingState message={t("content.updates.checking")} />
      </section>
    );
  }

  if (checkQuery.error) {
    return (
      <section
        className="settings-panel content-updates"
        aria-label={t("server.workspace.content.updates")}
      >
        <div className="list-state list-state-error" role="alert">
          <strong>{t("content.updates.checkFailed")}</strong>
          <span>{checkQuery.error.message}</span>
          <Button variant="secondary" onClick={() => checkQuery.refetch()}>
            <RefreshCw aria-hidden="true" size={15} />
            {t("common.retry")}
          </Button>
        </div>
      </section>
    );
  }

  const warnings = checkQuery.data?.warnings ?? [];
  const history = historyQuery.data ?? [];

  return (
    <section
      className="settings-panel content-updates"
      aria-label={t("server.workspace.content.updates")}
    >
      <div className="section-heading">
        <div className="section-heading-copy">
          <h2>{t("content.updates.title")}</h2>
          <p>{t("content.updates.description")}</p>
        </div>
        <div className="content-toolbar-actions">
          <Button
            disabled={busy || checkQuery.isFetching}
            variant="secondary"
            onClick={() => checkQuery.refetch()}
          >
            <RefreshCw aria-hidden="true" size={15} />
            {t("content.installed.checkUpdates")}
          </Button>
          <Button
            disabled={busy || selectedIds.size === 0}
            variant="primary"
            onClick={() => setConfirmSelectedUpdates(true)}
          >
            <Download aria-hidden="true" size={15} />
            {t("content.updates.updateSelected", { count: selectedIds.size })}
          </Button>
        </div>
      </div>

      {actionError ? (
        <div className="inline-error" role="alert">
          <strong>{t("content.updates.actionFailed")}</strong>
          <span>{actionError.message}</span>
          <span>{t("content.updates.recovery")}</span>
        </div>
      ) : null}
      {outcome ? (
        <div
          className="content-operation-result"
          role="status"
          aria-live="polite"
        >
          <strong>
            {outcome.count === 0
              ? t("content.history.rollbackComplete")
              : t("content.updates.updated", { count: outcome.count })}
          </strong>
          {outcome.count > 0 ? (
            <span>{t("content.updates.restartRequired")}</span>
          ) : null}
          {outcome.backupPaths.length > 0 ? (
            <span>
              {t("content.updates.backupsCreated", {
                count: outcome.backupPaths.length,
              })}
            </span>
          ) : null}
          {outcome.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}

      {updates.length === 0 ? (
        <EmptyState
          illustration="/illustrations/no-content.png"
          title={t("content.updates.emptyTitle")}
          description={t("content.updates.emptyDescription")}
        />
      ) : (
        <div className="content-update-table">
          <label className="content-select-all">
            <Checkbox
              checked={
                allSelected
                  ? true
                  : selectedIds.size > 0
                    ? "indeterminate"
                    : false
              }
              onCheckedChange={(checked) =>
                setSelectedIds(
                  checked === true
                    ? new Set(
                        updates.map((update) => update.installedContentId),
                      )
                    : new Set(),
                )
              }
            />
            <span>{t("content.selection.all", { count: updates.length })}</span>
          </label>
          <ul className="content-update-list">
            {updates.map((update) => (
              <li key={update.installedContentId}>
                <Checkbox
                  aria-label={t("content.selection.item", {
                    name: update.name,
                  })}
                  checked={selectedIds.has(update.installedContentId)}
                  onCheckedChange={(checked) =>
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (checked === true) next.add(update.installedContentId);
                      else next.delete(update.installedContentId);
                      return next;
                    })
                  }
                />
                <span className="content-update-identity">
                  <strong>{update.name}</strong>
                  <small>
                    {update.currentVersion ?? t("common.unknown")} {" -> "}
                    {update.latestVersion} / {update.provider}
                  </small>
                  {update.warnings.length > 0 ? (
                    <small className="danger-text">
                      {update.warnings.join(" ")}
                    </small>
                  ) : null}
                </span>
                <Button
                  aria-label={t("content.installed.updateOneAria", {
                    content: update.name,
                  })}
                  disabled={busy}
                  variant="secondary"
                  onClick={() => installOne.mutate(update.installedContentId)}
                >
                  {t("content.installed.update")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 ? (
        <div className="content-update-warnings" role="status">
          <strong>{t("content.updates.unresolved")}</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="content-history">
        <div className="content-history-heading">
          <span>
            <History aria-hidden="true" size={15} />
            <strong>{t("content.history.title")}</strong>
          </span>
          <small>{t("content.history.description")}</small>
        </div>
        {historyQuery.isLoading ? (
          <LoadingState message={t("content.history.loading")} />
        ) : historyQuery.error ? (
          <div className="inline-error" role="alert">
            <span>{historyQuery.error.message}</span>
            <Button variant="secondary" onClick={() => historyQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : history.length === 0 ? (
          <p className="settings-notice">{t("content.history.empty")}</p>
        ) : (
          <ul>
            {history.map((entry) => (
              <li key={entry.id}>
                <span>
                  <strong>{entry.name}</strong>
                  <small>
                    {entry.fromVersion ?? t("common.unknown")} {" -> "}{" "}
                    {entry.toVersion} /{" "}
                    {formatDateTime(entry.createdAt, language)}
                  </small>
                </span>
                <span className="content-history-state">
                  <span>{t(`content.history.status.${entry.status}`)}</span>
                  <Button
                    disabled={busy || !entry.rollbackAvailable}
                    variant="secondary"
                    onClick={() => setHistoryToRollback(entry)}
                  >
                    <RotateCcw aria-hidden="true" size={14} />
                    {t("content.history.rollback")}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

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
    </section>
  );
}
