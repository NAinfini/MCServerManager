import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  Compass,
  Download,
  FolderOpen,
  Package,
  PackagePlus,
  RefreshCw,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import {
  DataTable,
  type DataTableColumn,
} from "../../components/data/DataTable";
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
import { useNotificationStore } from "../notifications/notificationStore";
import "./content.css";

interface InstalledContentViewProps {
  server: ServerProfile;
  onBrowse?: () => void;
}

export function InstalledContentView({
  server,
  onBrowse,
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
  const addMenuRef = useRef<HTMLDetailsElement>(null);
  const closeAddMenu = () => {
    if (addMenuRef.current) {
      addMenuRef.current.open = false;
    }
  };
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
  const allSelected = content.length > 0 && selectedIds.size === content.length;
  const columns: DataTableColumn<InstalledContent>[] = [
    {
      id: "select",
      header: (
        <Checkbox
          aria-label={t("content.selection.all", { count: content.length })}
          checked={
            allSelected ? true : selectedIds.size > 0 ? "indeterminate" : false
          }
          onCheckedChange={(checked) =>
            setSelectedIds(
              checked === true
                ? new Set(content.map((item) => item.id))
                : new Set(),
            )
          }
        />
      ),
      headerClassName: "content-select-cell",
      cellClassName: "content-select-cell",
      cell: (item) => (
        <Checkbox
          aria-label={t("content.selection.item", { name: item.name })}
          checked={selectedIds.has(item.id)}
          onCheckedChange={(checked) =>
            setSelectedIds((current) => {
              const next = new Set(current);
              if (checked === true) next.add(item.id);
              else next.delete(item.id);
              return next;
            })
          }
        />
      ),
    },
    {
      id: "name",
      header: t("content.table.name"),
      rowHeader: true,
      sortValue: (item) => item.name,
      cell: (item) => (
        <span className="content-name-cell">
          <span className="content-name-icon">
            <Package aria-hidden="true" size={15} />
          </span>
          <span>
            <span>{item.name}</span>
            {/* The mod's own id first: it is what the jar declares and what a
                search for it will match. The marketplace id is a fallback for
                anything installed from inside the app. */}
            <small>
              {item.modId ?? item.contentId ?? t("content.installed.unknownId")}
            </small>
          </span>
        </span>
      ),
    },
    {
      id: "loader",
      header: t("content.table.loader"),
      cell: (item) => <LoaderPill loaderType={item.loader} />,
      sortValue: (item) => item.loader,
    },
    {
      id: "version",
      header: t("content.table.version"),
      cell: (item) => item.version ?? t("common.unknown"),
      sortValue: (item) => item.version,
    },
    {
      id: "update",
      header: t("content.table.update"),
      cell: (item) => {
        const update = updateByContentId.get(item.id);
        return update ? (
          <span className="content-update-cell">
            <strong>{update.latestVersion}</strong>
            <small>{update.provider}</small>
          </span>
        ) : updateCheck ? (
          t("content.installed.current")
        ) : (
          /* Before a check has run the column has nothing to say about this row,
             and repeating "Not checked" once per mod turned it into noise. The
             toolbar button is what states the un-checked state. */
          <span className="cell-empty">-</span>
        );
      },
    },
    {
      id: "state",
      header: t("content.table.state"),
      cell: (item) =>
        item.installedPath.endsWith(".disabled")
          ? t("content.state.disabled")
          : t("content.state.enabled"),
    },
    {
      id: "installed",
      header: t("content.table.installed"),
      cell: (item) => formatDateTime(item.installedAt, language),
      sortValue: (item) => item.installedAt,
    },
    {
      id: "warnings",
      header: t("content.table.warnings"),
      cell: (item) =>
        item.warnings.length === 0 ? (
          t("common.none")
        ) : (
          <span className="content-warning">
            <AlertTriangle aria-hidden="true" size={14} />
            {item.warnings.join("; ")}
          </span>
        ),
    },
    {
      id: "actions",
      header: t("content.table.actions"),
      cell: (item) => {
        const update = updateByContentId.get(item.id);
        return (
          <span className="content-row-actions">
            {item.installedPath.endsWith(".disabled") ? (
              <Button
                disabled={enableMutation.isPending}
                variant="secondary"
                onClick={() => enableMutation.mutate(item.id)}
              >
                {t("tunnels.actions.enable")}
              </Button>
            ) : (
              <Button
                disabled={disableMutation.isPending}
                variant="secondary"
                onClick={() => {
                  disableMutation.reset();
                  setDangerAction({ kind: "disable", item });
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
                setDangerAction({ kind: "uninstall", item });
              }}
            >
              {t("content.installed.uninstall")}
            </Button>
            {update ? (
              <Button
                aria-label={t("content.installed.updateOneAria", {
                  content: item.name,
                })}
                disabled={installUpdateMutation.isPending}
                variant="primary"
                onClick={() => installUpdateMutation.mutate(item.id)}
              >
                <Download aria-hidden="true" size={14} />
                {t("content.installed.update")}
              </Button>
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <section className="content-panel" aria-label={t("content.installed.aria")}>
      <div className="content-toolbar">
        <div>
          <strong>{t("content.installed.title")}</strong>
          <span>{t("content.installed.description")}</span>
        </div>
        <div className="content-toolbar-actions">
          <Button
            disabled={checkUpdatesMutation.isPending}
            variant="secondary"
            onClick={() => checkUpdatesMutation.mutate()}
          >
            <RefreshCw aria-hidden="true" size={15} />
            {t("content.installed.checkUpdates")}
          </Button>
          <Button
            disabled={
              selectedUpdateIds.length === 0 ||
              installAllUpdatesMutation.isPending
            }
            variant="secondary"
            onClick={() => setConfirmUpdateAll(true)}
          >
            <Download aria-hidden="true" size={15} />
            {t("content.updates.updateSelected", {
              count: selectedUpdateIds.length,
            })}
          </Button>
          <details ref={addMenuRef} className="dropdown content-add-menu">
            <summary className="button button-primary">
              <PackagePlus aria-hidden="true" size={15} />
              {t("content.installed.addContent")}
              <ChevronDown aria-hidden="true" size={14} />
            </summary>
            <div className="dropdown-menu" role="menu">
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  closeAddMenu();
                  onBrowse?.();
                }}
              >
                <Compass aria-hidden="true" size={15} />
                {t("content.installed.browseOnline")}
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  closeAddMenu();
                  setShowImport(true);
                }}
              >
                <FolderOpen aria-hidden="true" size={15} />
                {t("content.installed.importFile")}
              </button>
            </div>
          </details>
        </div>
      </div>

      {selectedIds.size > 0 ? (
        <div
          className="content-selection-toolbar"
          role="toolbar"
          aria-label={t("content.selection.actions")}
        >
          <strong>
            {t("content.selection.count", { count: selectedIds.size })}
          </strong>
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
        </div>
      ) : null}

      {operationResult ? (
        <div
          className="content-operation-result"
          role="status"
          aria-live="polite"
        >
          <strong>
            {t("content.operation.complete", { count: operationResult.count })}
          </strong>
          {operationResult.restartRequired ? (
            <span>{t("content.updates.restartRequired")}</span>
          ) : null}
          {operationResult.backups > 0 ? (
            <span>
              {t("content.updates.backupsCreated", {
                count: operationResult.backups,
              })}
            </span>
          ) : null}
        </div>
      ) : null}
      {batchMutation.error ? (
        <div className="inline-error" role="alert">
          <strong>{t("content.operation.failed")}</strong>
          <span>{batchMutation.error.message}</span>
          <span>{t("content.operation.recovery")}</span>
        </div>
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
        <div className="list-state list-state-error" role="alert">
          <strong>{t("content.installed.loadError.title")}</strong>
          <span>{contentQuery.error.message}</span>
          <Button variant="secondary" onClick={() => contentQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      {updateCheck?.warnings.length ? (
        <div className="list-state list-state-warning">
          {updateCheck.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}

      {contentQuery.isLoading ? (
        <LoadingState message={t("content.installed.loading")} />
      ) : null}

      {!contentQuery.isLoading &&
      !contentQuery.error &&
      content.length === 0 ? (
        <div className="content-empty-compact">
          <EmptyState
            title={t("content.installed.empty.title")}
            description={t("content.installed.empty.description")}
          >
            <Button variant="primary" onClick={() => onBrowse?.()}>
              <Compass aria-hidden="true" size={15} />
              {t("content.installed.browseContent")}
            </Button>
          </EmptyState>
        </div>
      ) : null}

      {content.length > 0 ? (
        <div className="content-table-scroll">
          <DataTable
            caption={t("content.installed.title")}
            className="content-table"
            columns={columns}
            getRowKey={(item) => item.id}
            getRowClassName={(item) =>
              selectedIds.has(item.id) ? "content-row-selected" : undefined
            }
            rows={content}
          />
        </div>
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
    </section>
  );
}
