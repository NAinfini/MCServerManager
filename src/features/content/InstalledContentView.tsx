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
  Search,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { EmptyState } from "../../components/ui/empty-state";
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
import "./content.css";

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

  return (
    <section className="mods-page" aria-label={t("content.installed.aria")}>
      <div className="mods-toolbar">
        <label className="mods-search">
          <Search aria-hidden="true" size={15} />
          <input
            aria-label={t("content.search.label")}
            placeholder={t("content.search.placeholder", {
              count: content.length,
            })}
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </label>
        {availableUpdates > 0 ? (
          <Button
            aria-pressed={onlyUpdates}
            variant="secondary"
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
            <RefreshCw aria-hidden="true" size={15} />
            {t("content.installed.checkUpdates")}
          </Button>
        )}
        <details ref={addMenuRef} className="dropdown content-add-menu">
          <summary className="button button-secondary">
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

      {selectedIds.size > 0 ? (
        <div
          className="content-selection-toolbar"
          role="toolbar"
          aria-label={t("content.selection.actions")}
        >
          <strong>
            {t("content.selection.count", { count: selectedIds.size })}
          </strong>
          {selectedUpdateIds.length > 0 ? (
            <Button
              disabled={installAllUpdatesMutation.isPending}
              variant="primary"
              onClick={() => setConfirmUpdateAll(true)}
            >
              <Download aria-hidden="true" size={15} />
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
        <div className="mods-layout">
          <div className="mods-list-panel">
            <div className="mods-list-head">
              <Checkbox
                aria-label={t("content.selection.all", {
                  count: visibleContent.length,
                })}
                checked={
                  allSelected ? true : someSelected ? "indeterminate" : false
                }
                onCheckedChange={(checked) =>
                  setSelectedIds(
                    checked === true
                      ? new Set(visibleContent.map((item) => item.id))
                      : new Set(),
                  )
                }
              />
              <span>
                {t("content.list.count", { count: visibleContent.length })}
              </span>
            </div>
            {visibleContent.length === 0 ? (
              <p className="mods-no-match">{t("content.search.empty")}</p>
            ) : (
              <ul
                aria-label={t("content.installed.title")}
                className="mods-list"
              >
                {visibleContent.map((item) => {
                  const status = rowStatus(item);
                  return (
                    <li
                      key={item.id}
                      className={[
                        "mods-row",
                        item.id === focused?.id ? "is-focused" : "",
                        isDisabled(item) ? "is-disabled" : "",
                      ].join(" ")}
                    >
                      <Checkbox
                        aria-label={t("content.selection.item", {
                          name: item.name,
                        })}
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
                      <button
                        aria-current={
                          item.id === focused?.id ? "true" : undefined
                        }
                        className="mods-row-main"
                        type="button"
                        onClick={() => setFocusedId(item.id)}
                      >
                        <span className="mods-row-icon">
                          <Package aria-hidden="true" size={16} />
                        </span>
                        <span className="mods-row-name">{item.name}</span>
                        <span className="mods-row-version">
                          {item.version ?? t("common.unknown")}
                        </span>
                        <span className="mods-row-source">
                          {item.provider ?? t("content.source.local")}
                        </span>
                        <span className={`mods-row-status is-${status.key}`}>
                          {status.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {focused ? (
            <aside aria-label={focused.name} className="mods-detail">
              <span className="mods-detail-icon">
                <Package aria-hidden="true" size={26} />
              </span>
              <h3>{focused.name}</h3>
              <p className="mods-detail-source">
                {t("content.detail.source", {
                  version: focused.version ?? t("common.unknown"),
                  source: focused.provider ?? t("content.source.local"),
                })}
              </p>
              {focused.warnings.length > 0 ? (
                <p className="mods-detail-warning">
                  <AlertTriangle aria-hidden="true" size={14} />
                  {focused.warnings.join("; ")}
                </p>
              ) : null}
              <dl className="mods-detail-facts">
                <div>
                  <dt>{t("content.detail.modId")}</dt>
                  <dd>
                    {focused.modId ??
                      focused.contentId ??
                      t("content.installed.unknownId")}
                  </dd>
                </div>
                <div>
                  <dt>{t("content.table.loader")}</dt>
                  <dd>
                    <LoaderPill loaderType={focused.loader} />
                  </dd>
                </div>
                {focusedUpdate ? (
                  <div>
                    <dt>{t("content.detail.latest")}</dt>
                    <dd>{focusedUpdate.latestVersion}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{t("content.table.installed")}</dt>
                  <dd>{formatDateTime(focused.installedAt, language)}</dd>
                </div>
              </dl>
              {onOpenFile ? (
                <div className="mods-detail-config">
                  <strong>{t("content.detail.settings")}</strong>
                  {configFilesFor(focused, configEntriesQuery.data ?? []).map(
                    (entry) => (
                      <button
                        key={entry.relativePath}
                        type="button"
                        onClick={() => onOpenFile(entry.relativePath)}
                      >
                        {entry.relativePath}
                      </button>
                    ),
                  )}
                  {configFilesFor(focused, configEntriesQuery.data ?? [])
                    .length === 0 ? (
                    <p>{t("content.detail.settingsNone")}</p>
                  ) : null}
                  <button type="button" onClick={() => onOpenFile("config/")}>
                    {t("content.detail.openConfigFolder")}
                  </button>
                </div>
              ) : null}
              <div className="mods-detail-actions">
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
              </div>
            </aside>
          ) : null}
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
