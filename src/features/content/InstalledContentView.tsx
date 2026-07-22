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
import { useAppSettings } from "../../i18n";
import { LoaderPill } from "../loaders/LoaderIdentity";
import type { ServerProfile } from "../servers/types";
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

interface InstalledContentViewProps {
  server: ServerProfile;
  onBrowse?: () => void;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function InstalledContentView({
  server,
  onBrowse,
}: InstalledContentViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
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
    queryKey: ["installedContent", server.id],
    queryFn: () => listInstalledContent(server.id),
  });
  const importMutation = useMutation({
    mutationFn: (sourcePath: string) =>
      importLocalContent(server.id, sourcePath),
    onSuccess: async () => {
      setShowImport(false);
      await queryClient.invalidateQueries({
        queryKey: ["installedContent", server.id],
      });
    },
  });
  const disableMutation = useMutation({
    mutationFn: (contentId: string) =>
      disableInstalledContent(server.id, contentId),
    onSuccess: async () => {
      setDangerAction(null);
      await queryClient.invalidateQueries({
        queryKey: ["installedContent", server.id],
      });
    },
  });
  const enableMutation = useMutation({
    mutationFn: (contentId: string) =>
      enableInstalledContent(server.id, contentId),
    onSuccess: async () => {
      setDangerAction(null);
      await queryClient.invalidateQueries({
        queryKey: ["installedContent", server.id],
      });
    },
  });
  const uninstallMutation = useMutation({
    mutationFn: (contentId: string) =>
      uninstallInstalledContent(server.id, contentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["installedContent", server.id],
      });
    },
  });
  const checkUpdatesMutation = useMutation({
    mutationFn: () => checkContentUpdates(server.id),
    onSuccess: (result) => setUpdateCheck(result),
  });
  const installUpdateMutation = useMutation({
    mutationFn: (contentId: string) => installContentUpdate(server.id, contentId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["installedContent", server.id],
        }),
        checkUpdatesMutation.mutateAsync().catch(() => null),
      ]);
    },
  });
  const installAllUpdatesMutation = useMutation({
    mutationFn: () => installAllContentUpdates(server.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["installedContent", server.id],
        }),
        checkUpdatesMutation.mutateAsync().catch(() => null),
      ]);
    },
  });
  const content = contentQuery.data ?? [];
  const updateByContentId = new Map(
    (updateCheck?.updates ?? []).map((update) => [
      update.installedContentId,
      update,
    ]),
  );

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
              !updateCheck?.updates.length || installAllUpdatesMutation.isPending
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
        <div className="list-state list-state-error">
          <strong>{t("content.installed.loadError.title")}</strong>
          <span>{contentQuery.error.message}</span>
          <Button variant="secondary" onClick={() => contentQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      {disableMutation.error ? (
        <p className="danger-text">{disableMutation.error.message}</p>
      ) : null}
      {uninstallMutation.error ? (
        <p className="danger-text">{uninstallMutation.error.message}</p>
      ) : null}
      {enableMutation.error ? (
        <p className="danger-text">{enableMutation.error.message}</p>
      ) : null}
      {checkUpdatesMutation.error ? (
        <p className="danger-text">{checkUpdatesMutation.error.message}</p>
      ) : null}
      {installUpdateMutation.error ? (
        <p className="danger-text">{installUpdateMutation.error.message}</p>
      ) : null}
      {installAllUpdatesMutation.error ? (
        <p className="danger-text">{installAllUpdatesMutation.error.message}</p>
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
          <table className="content-table">
            <thead>
              <tr>
                <th scope="col">{t("content.table.name")}</th>
                <th scope="col">{t("content.table.loader")}</th>
                <th scope="col">{t("content.table.version")}</th>
                <th scope="col">{t("content.table.update")}</th>
                <th scope="col">{t("content.table.installed")}</th>
                <th scope="col">{t("content.table.warnings")}</th>
                <th scope="col">{t("content.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {content.map((item) => {
                const update = updateByContentId.get(item.id);
                return (
                  <tr key={item.id}>
                  <th scope="row">
                    <span className="content-name-cell">
                      <span className="content-name-icon">
                        <Package aria-hidden="true" size={15} />
                      </span>
                      <span>
                        <span>{item.name}</span>
                        <small>
                          {item.contentId ?? t("content.installed.unknownId")}
                        </small>
                      </span>
                    </span>
                  </th>
                  <td>
                    <LoaderPill loaderType={item.loader} />
                  </td>
                  <td>{item.version ?? t("common.unknown")}</td>
                  <td>
                    {update ? (
                      <span className="content-update-cell">
                        <strong>{update.latestVersion}</strong>
                        <small>{update.provider}</small>
                      </span>
                    ) : updateCheck ? (
                      t("content.installed.current")
                    ) : (
                      t("content.installed.notChecked")
                    )}
                  </td>
                  <td>{formatDate(item.installedAt)}</td>
                  <td>
                    {item.warnings.length === 0 ? (
                      t("common.none")
                    ) : (
                      <span className="content-warning">
                        <AlertTriangle aria-hidden="true" size={14} />
                        {item.warnings.join("; ")}
                      </span>
                    )}
                  </td>
                  <td>
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
                  </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
            ? uninstallMutation.error?.message ?? null
            : disableMutation.error?.message ?? null
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
