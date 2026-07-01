import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Archive,
  ChevronLeft,
  CircleAlert,
  CirclePlay,
  CircleStop,
  LayoutGrid,
  List,
  Plus,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { BottomStatusBar } from "./BottomStatusBar";
import { Sidebar, type PrimaryPage } from "./Sidebar";
import { TopRuntimeBar } from "./TopRuntimeBar";
import { WindowTitlebar } from "./WindowTitlebar";
import { Button } from "../ui/button";
import { listServerProfiles } from "../../features/servers/api";
import { BatchActions } from "../../features/servers/BatchActions";
import { CreateServerWizard } from "../../features/servers/CreateServerWizard";
import { DropImportOverlay } from "../../features/servers/DropImportOverlay";
import { DropImportReviewDialog } from "../../features/servers/DropImportReviewDialog";
import { ServerCardView } from "../../features/servers/ServerCardView";
import { ServerList } from "../../features/servers/ServerList";
import { ServerDetail } from "../../features/servers/ServerDetail";
import type { ServerProfile } from "../../features/servers/types";
import {
  getProcessSummary,
  type ProcessSummary,
} from "../../features/process/api";
import { JavaRuntimesView } from "../../features/java/JavaRuntimesView";
import { AppLoggerView } from "../../features/logger/AppLoggerView";
import { SettingsView } from "../../features/settings/SettingsView";
import { useAppSettings } from "../../i18n";
import {
  isDesktopRuntimeAvailable,
  openExternalUrl,
} from "../../lib/desktop-runtime";
import { useSidebarStore } from "./sidebarStore";

type ServerViewMode = "table" | "cards";

const externalLinkProtocols = new Set(["http:", "https:", "mailto:"]);

function resolveExternalHref(link: HTMLAnchorElement) {
  const href = link.getAttribute("href");
  if (!href) {
    return null;
  }

  try {
    const url = new URL(href, window.location.href);
    return externalLinkProtocols.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

interface AppShellProps {
  processSummary?: ProcessSummary | null;
}

export function AppShell({ processSummary }: AppShellProps = {}) {
  const { t } = useAppSettings();
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const [activePage, setActivePage] = useState<PrimaryPage>("servers");
  const [isCreateServerOpen, setCreateServerOpen] = useState(false);
  const [createServerHeaderBack, setCreateServerHeaderBack] = useState<
    (() => void) | null
  >(null);
  const [createServerHeaderHidden, setCreateServerHeaderHidden] =
    useState(false);
  const [isJavaOpen, setJavaOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [droppedImportPaths, setDroppedImportPaths] = useState<string[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ServerViewMode>("cards");
  const shouldOwnProcessSummary = processSummary === undefined;
  const profilesQuery = useQuery({
    queryKey: ["serverProfiles"],
    queryFn: listServerProfiles,
  });
  const processSummaryQuery = useQuery({
    queryKey: ["processSummary"],
    queryFn: getProcessSummary,
    enabled: shouldOwnProcessSummary,
    refetchInterval: 1500,
  });
  const servers = profilesQuery.data ?? [];
  const effectiveProcessSummary = shouldOwnProcessSummary
    ? processSummaryQuery.data
    : processSummary;
  const runningCount = effectiveProcessSummary?.runningCount;
  const crashedCount = effectiveProcessSummary?.crashedCount;
  const stoppedCount = Math.max(
    servers.length - (runningCount ?? 0) - (crashedCount ?? 0),
    0,
  );
  const selectedServer: ServerProfile | null =
    selectedServerId
      ? servers.find((server) => server.id === selectedServerId) ?? null
      : null;
  const effectiveSidebarPage: PrimaryPage = isJavaOpen
    ? "java"
    : isSettingsOpen
      ? "settings"
      : activePage;

  useEffect(() => {
    if (selectedServerId && !servers.some((server) => server.id === selectedServerId)) {
      setSelectedServerId(null);
    }
  }, [selectedServerId, servers]);

  useEffect(() => {
    const openExternalLink = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link) {
        return;
      }

      const externalHref = resolveExternalHref(link);
      if (!externalHref || !isDesktopRuntimeAvailable()) {
        return;
      }

      event.preventDefault();
      void openExternalUrl(externalHref).catch((error) => {
        console.error("failed to open external link", error);
      });
    };

    document.addEventListener("click", openExternalLink, true);
    return () => document.removeEventListener("click", openExternalLink, true);
  }, []);

  const handleDropImport = useCallback((paths: string[]) => {
    if (paths.length > 0) {
      setDroppedImportPaths(paths);
    }
  }, []);

  const openServersOverview = useCallback(() => {
    setActivePage("servers");
    setSelectedServerId(null);
  }, []);

  const handleCreateServerHeaderBackChange = useCallback(
    (handler: (() => void) | null) => {
      setCreateServerHeaderBack(() => handler);
    },
    [],
  );

  const handleCreateServerOpenChange = useCallback((open: boolean) => {
    setCreateServerOpen(open);
    if (!open) {
      setCreateServerHeaderBack(null);
      setCreateServerHeaderHidden(false);
    }
  }, []);

  return (
    <div className="app-shell">
      <WindowTitlebar />
      <DropImportOverlay onDrop={handleDropImport} />
      <DropImportReviewDialog
        open={droppedImportPaths.length > 0}
        paths={droppedImportPaths}
        onOpenChange={(open) => {
          if (!open) setDroppedImportPaths([]);
        }}
        onContinue={() => {
          setDroppedImportPaths([]);
          setCreateServerOpen(true);
        }}
      />

      <div className={sidebarCollapsed ? "app-body app-body-sidebar-collapsed" : "app-body"}>
        <Sidebar
          activePage={effectiveSidebarPage}
          selectedServerId={selectedServerId ?? undefined}
          servers={servers}
          onSelectPage={(page) => {
            if (page === "servers") {
              openServersOverview();
              return;
            }
            if (page === "java") {
              setJavaOpen(true);
              return;
            }
            if (page === "settings") {
              setSettingsOpen(true);
              return;
            }
            setSelectedServerId(null);
            setActivePage(page);
          }}
          onSelectServer={(serverId) => {
            setActivePage("servers");
            setSelectedServerId(serverId);
          }}
        />
        <TopRuntimeBar
          runningCount={runningCount}
          crashedCount={crashedCount}
        />
        <main
          className="page"
          aria-labelledby={activePage === "logger" ? "logger-title" : "servers-title"}
        >
          {activePage === "logger" && !selectedServer ? (
            <AppLoggerView />
          ) : (
            <>
          <section className="page-header">
            <div>
              <h1 id="servers-title">
                {selectedServer ? selectedServer.name : t("servers.page.title")}
              </h1>
            </div>
            <div className="page-header-actions">
              {!selectedServer ? (
                <div
                  className="server-view-toggle"
                  role="group"
                  aria-label={t("servers.viewMode")}
                >
                  <Button
                    aria-pressed={viewMode === "cards"}
                    variant="ghost"
                    onClick={() => setViewMode("cards")}
                  >
                    <LayoutGrid aria-hidden="true" size={14} />
                  </Button>
                  <Button
                    aria-pressed={viewMode === "table"}
                    variant="ghost"
                    onClick={() => setViewMode("table")}
                  >
                    <List aria-hidden="true" size={14} />
                  </Button>
                </div>
              ) : null}
              <Button
                onClick={() => setCreateServerOpen(true)}
                variant="primary"
              >
                <Plus aria-hidden="true" size={15} />
                {t("servers.create.button")}
              </Button>
            </div>
          </section>

              {!selectedServer ? (
                <>
                  <section
                    className="summary-strip"
                    aria-label={t("servers.summary.aria")}
                  >
                    <div>
                      <span className="summary-label summary-label-running">
                        <CirclePlay aria-hidden="true" size={14} />
                        {t("servers.summary.running")}
                      </span>
                      <strong>{runningCount ?? t("common.unknown")}</strong>
                    </div>
                    <div>
                      <span className="summary-label summary-label-stopped">
                        <CircleStop aria-hidden="true" size={14} />
                        {t("servers.summary.stopped")}
                      </span>
                      <strong>{stoppedCount}</strong>
                    </div>
                    <div>
                      <span className="summary-label summary-label-crashed">
                        <CircleAlert aria-hidden="true" size={14} />
                        {t("servers.summary.crashed")}
                      </span>
                      <strong className="danger-text">
                        {crashedCount ?? t("common.unknown")}
                      </strong>
                    </div>
                    <div>
                      <span className="summary-label summary-label-backups">
                        <Archive aria-hidden="true" size={14} />
                        {t("servers.summary.backupFreshness")}
                      </span>
                      <strong>
                        {servers.length === 0 ? t("common.none") : t("common.missing")}
                      </strong>
                    </div>
                  </section>

                  {servers.length > 0 ? <BatchActions servers={servers} /> : null}

                  <div className="server-table-panel">
                    <div className="section-heading">
                      <h2>{t("servers.overview.title")}</h2>
                      <span>{t("servers.overview.description")}</span>
                    </div>
                    {viewMode === "cards" ? (
                      <ServerCardView
                        error={profilesQuery.error}
                        isLoading={profilesQuery.isLoading}
                        selectedServerId={selectedServerId ?? undefined}
                        servers={servers}
                        onSelectServer={setSelectedServerId}
                      />
                    ) : (
                      <ServerList
                        error={profilesQuery.error}
                        isLoading={profilesQuery.isLoading}
                        selectedServerId={selectedServerId ?? undefined}
                        servers={servers}
                        onSelectServer={setSelectedServerId}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="server-detail-panel">
                  <ServerDetail server={selectedServer} />
                </div>
              )}
            </>
          )}

              <Dialog.Root
                open={isCreateServerOpen}
                onOpenChange={handleCreateServerOpenChange}
              >
                <Dialog.Portal>
                  <Dialog.Overlay className="dialog-backdrop" />
                  <Dialog.Content
                    className="modal-dialog create-server-dialog"
                    onPointerDownOutside={(event) => event.preventDefault()}
                  >
                    {createServerHeaderHidden ? (
                      <>
                        <Dialog.Title className="visually-hidden">
                          {t("servers.create.title")}
                        </Dialog.Title>
                        <Dialog.Description className="visually-hidden">
                          {t("servers.create.description")}
                        </Dialog.Description>
                        <Dialog.Close asChild>
                          <Button
                            aria-label={t("servers.create.close")}
                            className="icon-button create-server-detail-close"
                            type="button"
                            variant="ghost"
                          >
                            <X aria-hidden="true" size={16} />
                          </Button>
                        </Dialog.Close>
                      </>
                    ) : (
                      <div className="create-server-dialog-header">
                        <div className="create-server-dialog-title-row">
                          {createServerHeaderBack ? (
                            <Button
                              className="create-server-header-back"
                              type="button"
                              variant="ghost"
                              onClick={createServerHeaderBack}
                            >
                              <ChevronLeft aria-hidden="true" size={15} />
                              {t("wizard.nav.back")}
                            </Button>
                          ) : null}
                          <div>
                            <Dialog.Title asChild>
                              <h2>{t("servers.create.title")}</h2>
                            </Dialog.Title>
                            <Dialog.Description asChild>
                              <p>{t("servers.create.description")}</p>
                            </Dialog.Description>
                          </div>
                        </div>
                        <Dialog.Close asChild>
                          <Button
                            aria-label={t("servers.create.close")}
                            className="icon-button"
                            variant="ghost"
                          >
                            <X aria-hidden="true" size={16} />
                          </Button>
                        </Dialog.Close>
                      </div>
                    )}
                    <CreateServerWizard
                      showHeading={false}
                      onHeaderHiddenChange={setCreateServerHeaderHidden}
                      onHeaderBackChange={handleCreateServerHeaderBackChange}
                      onCreated={() => setCreateServerOpen(false)}
                    />
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>

              <Dialog.Root open={isJavaOpen} onOpenChange={setJavaOpen}>
                <Dialog.Portal>
                  <Dialog.Overlay className="dialog-backdrop" />
                  <Dialog.Content className="modal-dialog fullscreen-modal">
                    <div className="fullscreen-modal-header">
                      <Dialog.Title asChild>
                        <h2>{t("java.title")}</h2>
                      </Dialog.Title>
                      <Dialog.Description className="visually-hidden">
                        {t("java.eyebrow")}
                      </Dialog.Description>
                      <Dialog.Close asChild>
                        <Button
                          aria-label={t("common.cancel")}
                          className="icon-button"
                          variant="ghost"
                        >
                          <X aria-hidden="true" size={16} />
                        </Button>
                      </Dialog.Close>
                    </div>
                    <div className="fullscreen-modal-body">
                      <JavaRuntimesView embedded />
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>

              <Dialog.Root open={isSettingsOpen} onOpenChange={setSettingsOpen}>
                <Dialog.Portal>
                  <Dialog.Overlay className="dialog-backdrop" />
                  <Dialog.Content className="modal-dialog fullscreen-modal">
                    <div className="fullscreen-modal-header">
                      <Dialog.Title asChild>
                        <h2>{t("settings.page.title")}</h2>
                      </Dialog.Title>
                      <Dialog.Description className="visually-hidden">
                        {t("settings.page.eyebrow")}
                      </Dialog.Description>
                      <Dialog.Close asChild>
                        <Button
                          aria-label={t("common.cancel")}
                          className="icon-button"
                          variant="ghost"
                        >
                          <X aria-hidden="true" size={16} />
                        </Button>
                      </Dialog.Close>
                    </div>
                    <div className="fullscreen-modal-body">
                      <SettingsView embedded />
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
        </main>
      </div>
      <BottomStatusBar selectedServer={selectedServer} />
    </div>
  );
}
