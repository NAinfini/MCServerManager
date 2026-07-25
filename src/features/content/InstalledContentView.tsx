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
  const [updateCheck, setUpdateCheck] =
    useState<InstalledContentUpdateCheck | null>(null);
  const contentQuery = useQuery({
    queryKey: contentKeys.installed(server.id),
    queryFn: () => listInstalledContent(server.id),
  });
  const importMutation = useMutation({
    mutationFn: (sourcePath: string) =>
      importLocalContent(server.id, sourcePath),
    onSuccess: async () => {
      setShowImport(false);
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
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: contentKeys.installed(server.id),
        }),
        checkUpdatesMutation.mutateAsync().catch(() => null),
      ]);
    },
    onError: notifyActionError,
  });
  const installAllUpdatesMutation = useMutation({
    mutationFn: () => installAllContentUpdates(server.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: contentKeys.installed(server.id),
        }),
        checkUpdatesMutation.mutateAsync().catch(() => null),
      ]);
    },
    onError: notifyActionError,
  });
  const content = contentQuery.data ?? [];
  const updateByContentId = new Map(
    (updateCheck?.updates ?? []).map((update) => [
      update.installedContentId,
      update,
    ]),
  );
  const columns: DataTableColumn<InstalledContent>[] = [
    {
      id: "name",
      header: t("content.table.name"),
      rowHeader: true,
      cell: (item) => (
        <span className="content-name-cell">
          <span className="content-name-icon">
            <Package aria-hidden="true" size={15} />
          </span>
          <span>
            <span>{item.name}</span>
            <small>{item.contentId ?? t("content.installed.unknownId")}</small>
          </span>
        </span>
      ),
    },
    {
      id: "loader",
      header: t("content.table.loader"),
      cell: (item) => <LoaderPill loaderType={item.loader} />,
    },
    {
      id: "version",
      header: t("content.table.version"),
      cell: (item) => item.version ?? t("common.unknown"),
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
          t("content.installed.notChecked")
        );
      },
    },
    {
      id: "installed",
      header: t("content.table.installed"),
      cell: (item) => formatDateTime(item.installedAt, language),
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
          <>
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
          </>
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
              !updateCheck?.updates.length ||
              installAllUpdatesMutation.isPending
            }
            variant="secondary"
            onClick={() => installAllUpdatesMutation.mutate()}
          >
            <Download aria-hidden="true" size={15} />
            {t("content.installed.updateAll")}
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
    </section>
  );
}
