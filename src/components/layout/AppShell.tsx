import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  CircleAlert,
  CirclePlay,
  CircleStop,
  LayoutGrid,
  List,
  Plus,
  Server as ServerIcon,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { BottomStatusBar } from "./BottomStatusBar";
import { Sidebar, type PrimaryPage } from "./Sidebar";
import { WindowTitlebar } from "./WindowTitlebar";
import { Button } from "../ui/button";
import { ConfirmDangerDialog } from "../ui/ConfirmDangerDialog";
import { listServerProfiles } from "../../features/servers/api";
import { BatchActions } from "../../features/servers/BatchActions";
import {
  CreateServerWizard,
  type CreateServerWizardLifecycle,
  type CreateServerWizardProgress,
} from "../../features/servers/CreateServerWizard";
import { DropImportOverlay } from "../../features/servers/DropImportOverlay";
import { DropImportReviewDialog } from "../../features/servers/DropImportReviewDialog";
import { ServerCardView } from "../../features/servers/ServerCardView";
import { ServerList } from "../../features/servers/ServerList";
import { ServerDetail } from "../../features/servers/ServerDetail";
import { useServerUiStore } from "../../features/servers/serverUiStore";
import { WizardStepIndicator } from "../../features/servers/WizardStepIndicator";
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
  const [isCreateServerActive, setCreateServerActive] = useState(false);
  const [createServerLifecycle, setCreateServerLifecycle] =
    useState<CreateServerWizardLifecycle>("draft");
  const [pendingCreateServerExit, setPendingCreateServerExit] = useState<
    (() => void) | null
  >(null);
  const [createServerHeaderBack, setCreateServerHeaderBack] = useState<
    (() => void) | null
  >(null);
  const [createServerHeaderHidden, setCreateServerHeaderHidden] =
    useState(false);
  const [createServerProgress, setCreateServerProgress] =
    useState<CreateServerWizardProgress | null>(null);
  const [createServerSourcePath, setCreateServerSourcePath] = useState<string | null>(null);
  const [droppedImportPaths, setDroppedImportPaths] = useState<string[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const viewMode = useServerUiStore((s) => s.viewMode);
  const setViewMode = useServerUiStore((s) => s.setViewMode);
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

  const resetCreateServer = useCallback(() => {
    setCreateServerActive(false);
    setCreateServerLifecycle("draft");
    setCreateServerSourcePath(null);
    setCreateServerHeaderBack(null);
    setCreateServerHeaderHidden(false);
    setCreateServerProgress(null);
  }, []);

  const openCreateServer = useCallback((sourcePath: string | null = null) => {
    setActivePage("servers");
    setSelectedServerId(null);
    setCreateServerSourcePath(sourcePath);
    setCreateServerLifecycle("draft");
    setCreateServerActive(true);
  }, []);

  const requestCreateServerExit = useCallback(
    (destination: () => void) => {
      if (!isCreateServerActive) {
        destination();
        return;
      }
      if (createServerLifecycle === "draft") {
        setPendingCreateServerExit(() => destination);
        return;
      }
      resetCreateServer();
      destination();
    },
    [createServerLifecycle, isCreateServerActive, resetCreateServer],
  );

  const confirmCreateServerExit = useCallback(() => {
    const destination = pendingCreateServerExit;
    setPendingCreateServerExit(null);
    resetCreateServer();
    destination?.();
  }, [pendingCreateServerExit, resetCreateServer]);

  useEffect(() => {
    if (!isCreateServerActive) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        pendingCreateServerExit !== null
      ) {
        return;
      }
      requestCreateServerExit(openServersOverview);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [
    isCreateServerActive,
    pendingCreateServerExit,
    requestCreateServerExit,
    openServersOverview,
  ]);

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
          const sourcePath = droppedImportPaths[0] || null;
          setDroppedImportPaths([]);
          requestCreateServerExit(() => openCreateServer(sourcePath));
        }}
      />
      <ConfirmDangerDialog
        isOpen={pendingCreateServerExit !== null}
        title={t("danger.createServer.discard.title")}
        description={t("danger.createServer.discard.description")}
        confirmLabel={t("danger.labels.discardCreation")}
        onCancel={() => setPendingCreateServerExit(null)}
        onConfirm={confirmCreateServerExit}
      />

      <div className={sidebarCollapsed ? "app-body app-body-sidebar-collapsed" : "app-body"}>
        <Sidebar
          activePage={activePage}
          selectedServerId={selectedServerId ?? undefined}
          servers={servers}
          onSelectPage={(page) => {
            if (page === "servers") {
              requestCreateServerExit(openServersOverview);
              return;
            }
            requestCreateServerExit(() => {
              setSelectedServerId(null);
              setActivePage(page);
            });
          }}
          onSelectServer={(serverId) => {
            requestCreateServerExit(() => {
              setActivePage("servers");
              setSelectedServerId(serverId);
            });
          }}
        />
        <main
          className={isCreateServerActive ? "page page-create-server" : "page"}
          aria-labelledby={
            isCreateServerActive
              ? "create-server-page-title"
              : activePage === "java"
                ? "java-runtimes-title"
                : activePage === "settings"
                  ? "settings-title"
                  : activePage === "logger"
                    ? "logger-title"
                    : "servers-title"
          }
        >
          {isCreateServerActive ? (
            <section className="create-server-page">
              {createServerHeaderHidden ? (
                <>
                  <h1 id="create-server-page-title" className="visually-hidden">
                    {t("servers.create.title")}
                  </h1>
                  <p className="visually-hidden">
                    {t("servers.create.description")}
                  </p>
                  <Button
                    aria-label={t("servers.create.close")}
                    className="icon-button create-server-detail-close"
                    type="button"
                    variant="ghost"
                    onClick={() => requestCreateServerExit(openServersOverview)}
                  >
                    <X aria-hidden="true" size={16} />
                  </Button>
                </>
              ) : (
                <header className="create-server-page-header create-server-wizard-header">
                  <div className="create-server-page-title-row">
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
                      <h1 id="create-server-page-title">
                        {t("servers.create.title")}
                      </h1>
                      <p>
                        {createServerProgress
                          ? t("wizard.progress.counter", {
                              current: createServerProgress.currentStep + 1,
                              total: createServerProgress.steps.length,
                            })
                          : t("servers.create.description")}
                      </p>
                    </div>
                  </div>
                  {createServerProgress ? (
                    <WizardStepIndicator
                      currentStep={createServerProgress.currentStep}
                      steps={createServerProgress.steps}
                    />
                  ) : null}
                  <Button
                    aria-label={t("servers.create.close")}
                    className="icon-button"
                    variant="ghost"
                    onClick={() => requestCreateServerExit(openServersOverview)}
                  >
                    <X aria-hidden="true" size={16} />
                  </Button>
                </header>
              )}
              <CreateServerWizard
                initialSourcePath={createServerSourcePath}
                showHeading={false}
                onHeaderHiddenChange={setCreateServerHeaderHidden}
                onHeaderBackChange={handleCreateServerHeaderBackChange}
                onProgressChange={setCreateServerProgress}
                onLifecycleChange={setCreateServerLifecycle}
                onCreated={() => {
                  resetCreateServer();
                  openServersOverview();
                }}
              />
            </section>
          ) : activePage === "java" ? (
            <JavaRuntimesView />
          ) : activePage === "settings" ? (
            <SettingsView />
          ) : activePage === "logger" && !selectedServer ? (
            <AppLoggerView />
          ) : selectedServer ? (
            <ServerDetail server={selectedServer} onBack={openServersOverview} />
          ) : (
            <>
              <section className="page-header dashboard-page-header">
                <div className="page-header-heading">
                  <h1 id="servers-title">{t("servers.page.title")}</h1>
                </div>
                <div className="page-header-actions">
                  <div
                    className="server-view-toggle"
                    role="group"
                    aria-label={t("servers.viewMode")}
                  >
                    <Button
                      aria-label={t("servers.viewCards")}
                      aria-pressed={viewMode === "cards"}
                      variant="ghost"
                      onClick={() => setViewMode("cards")}
                    >
                      <LayoutGrid aria-hidden="true" size={14} />
                    </Button>
                    <Button
                      aria-label={t("servers.viewTable")}
                      aria-pressed={viewMode === "table"}
                      variant="ghost"
                      onClick={() => setViewMode("table")}
                    >
                      <List aria-hidden="true" size={14} />
                    </Button>
                  </div>
                  <Button
                    onClick={() => openCreateServer()}
                    variant="primary"
                  >
                    <Plus aria-hidden="true" size={15} />
                    {t("servers.create.button")}
                  </Button>
                </div>
              </section>

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
                  <span className="summary-label summary-label-total">
                    <ServerIcon aria-hidden="true" size={14} />
                    {t("servers.summary.total")}
                  </span>
                  <strong>{servers.length}</strong>
                </div>
              </section>

              {servers.length > 0 ? <BatchActions servers={servers} /> : null}

              {viewMode === "cards" ? (
                <ServerCardView
                  error={profilesQuery.error}
                  isLoading={profilesQuery.isLoading}
                  selectedServerId={selectedServerId ?? undefined}
                  servers={servers}
                  onSelectServer={setSelectedServerId}
                />
              ) : (
                <div className="server-table-panel">
                  <div className="section-heading">
                    <h2>{t("servers.overview.title")}</h2>
                    <span>{t("servers.overview.description")}</span>
                  </div>
                  <ServerList
                    error={profilesQuery.error}
                    isLoading={profilesQuery.isLoading}
                    selectedServerId={selectedServerId ?? undefined}
                    servers={servers}
                    onSelectServer={setSelectedServerId}
                  />
                </div>
              )}
            </>
          )}

        </main>
      </div>
      <BottomStatusBar
        runningCount={runningCount}
        crashedCount={crashedCount}
        selectedServer={selectedServer}
      />
    </div>
  );
}
