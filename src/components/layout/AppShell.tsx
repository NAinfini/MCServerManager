import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  CircleAlert,
  Plus,
  Server as ServerIcon,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { BottomStatusBar } from "./BottomStatusBar";
import { Sidebar, type PrimaryPage } from "./Sidebar";
import { WindowTitlebar } from "./WindowTitlebar";
import { Button } from "../ui/button";
import { TextField } from "../ui/text-field";
import { AttentionBar } from "../ui/attention-bar";
import { ConfirmDangerDialog } from "../ui/ConfirmDangerDialog";
import { listServerProfiles } from "../../features/servers/api";
import {
  CreateServerWizard,
  type CreateServerWizardLifecycle,
  type CreateServerWizardProgress,
} from "../../features/servers/CreateServerWizard";
import { DropImportOverlay } from "../../features/servers/DropImportOverlay";
import { DropImportReviewDialog } from "../../features/servers/DropImportReviewDialog";
import { ServerList } from "../../features/servers/ServerList";
import { ServerDetail } from "../../features/servers/ServerDetail";
import { ServerRuntimeProvider } from "../../features/servers/ServerRuntimeContext";
import { WizardStepIndicator } from "../../features/servers/WizardStepIndicator";
import type { ServerProfile } from "../../domain/server";
import type { ProcessSummary } from "../../features/process/api";
import { serverKeys } from "../../features/servers/queries";
import {
  attentionKeys,
  getAttentionItems,
  type AttentionItem,
} from "../../features/attention/api";
import { JavaRuntimesView } from "../../features/java/JavaRuntimesView";
import { AppLoggerView } from "../../features/logger/AppLoggerView";
import { SettingsView } from "../../features/settings/SettingsView";
import { useAppSettings } from "../../i18n";
import {
  isDesktopRuntimeAvailable,
  openExternalUrl,
} from "../../lib/desktop-runtime";
import { useSidebarStore } from "./sidebarStore";
import {
  navigateTo,
  useAppRoute,
  type ServerWorkspaceSection,
} from "../../app/router";

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
  processSummary: ProcessSummary | null;
}

export function AppShell({ processSummary }: AppShellProps) {
  const { t } = useAppSettings();
  const route = useAppRoute();
  const routeFocusKey = window.location.hash;
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  const activePage: PrimaryPage =
    route.name === "java"
      ? "java"
      : route.name === "activity"
        ? "logger"
        : route.name === "settings"
          ? "settings"
          : "servers";
  const isCreateServerActive = route.name === "create-server";
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
  const [droppedImportPaths, setDroppedImportPaths] = useState<string[]>([]);
  const [serverFilter, setServerFilter] = useState("");
  const selectedServerId = route.name === "server" ? route.serverId : null;
  const profilesQuery = useQuery({
    queryKey: serverKeys.profiles,
    queryFn: listServerProfiles,
  });
  const servers = profilesQuery.data ?? [];
  const normalizedServerFilter = serverFilter.trim().toLowerCase();
  const filteredServers = normalizedServerFilter
    ? servers.filter((server) =>
        server.name.toLowerCase().includes(normalizedServerFilter),
      )
    : servers;
  const runningCount = processSummary?.runningCount;
  const crashedCount = processSummary?.crashedCount;
  const stoppedCount = Math.max(
    servers.length - (runningCount ?? 0) - (crashedCount ?? 0),
    0,
  );
  const selectedServer: ServerProfile | null = selectedServerId
    ? (servers.find((server) => server.id === selectedServerId) ?? null)
    : null;
  const isDashboard =
    activePage === "servers" && !selectedServer && !isCreateServerActive;
  const attentionQuery = useQuery({
    enabled: isDashboard && isDesktopRuntimeAvailable(),
    queryKey: attentionKeys.all,
    queryFn: getAttentionItems,
  });
  const attentionItems = attentionQuery.data ?? [];
  const fallbackCrashItems: AttentionItem[] =
    attentionItems.length === 0 && (crashedCount ?? 0) > 0
      ? servers
          .filter(
            (server, index) =>
              processSummary?.statuses?.[server.id] === "crashed" ||
              (!processSummary?.statuses && index < (crashedCount ?? 0)),
          )
          .map((server) => ({
            id: `crash-${server.id}`,
            serverId: server.id,
            serverName: server.name,
            kind: "crash" as const,
            severity: "warning" as const,
            createdAt: null,
          }))
      : [];
  const dashboardAttentionItems =
    attentionItems.length > 0 ? attentionItems : fallbackCrashItems;
  const isCrashFallback =
    attentionItems.length === 0 && fallbackCrashItems.length > 0;

  const openAttentionItem = (item: AttentionItem) => {
    navigateTo({
      name: "server",
      serverId: item.serverId,
      section:
        item.kind === "update"
          ? "content"
          : item.kind === "backup"
            ? "data"
            : "monitor",
      view:
        item.kind === "update"
          ? "updates"
          : item.kind === "backup"
            ? "backups"
            : "diagnostics",
    });
  };

  useEffect(() => {
    if (!window.location.hash) {
      navigateTo({ name: "dashboard" }, true);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>("main h1");
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [routeFocusKey]);

  useEffect(() => {
    if (
      profilesQuery.isSuccess &&
      selectedServerId &&
      !servers.some((server) => server.id === selectedServerId)
    ) {
      navigateTo({ name: "dashboard" }, true);
    }
  }, [profilesQuery.isSuccess, selectedServerId, servers]);

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
    navigateTo({ name: "dashboard" });
  }, []);

  const openJavaRuntimes = useCallback(() => {
    navigateTo({ name: "java" });
  }, []);

  const handleCreateServerHeaderBackChange = useCallback(
    (handler: (() => void) | null) => {
      setCreateServerHeaderBack(() => handler);
    },
    [],
  );

  const resetCreateServer = useCallback(() => {
    setCreateServerLifecycle("draft");
    setCreateServerHeaderBack(null);
    setCreateServerHeaderHidden(false);
    setCreateServerProgress(null);
  }, []);

  const openCreateServer = useCallback((sourcePath: string | null = null) => {
    setCreateServerLifecycle("draft");
    navigateTo({
      name: "create-server",
      ...(sourcePath ? { sourcePath } : {}),
    });
  }, []);

  const handleCreateServerRouteState = useCallback(
    (state: { step: number; jobId?: string | null }) => {
      if (route.name !== "create-server") return;
      const jobId = state.jobId || undefined;
      if (route.step === state.step && route.jobId === jobId) return;
      navigateTo({
        name: "create-server",
        ...(route.sourcePath ? { sourcePath: route.sourcePath } : {}),
        step: state.step,
        ...(jobId ? { jobId } : {}),
      });
    },
    [route],
  );

  const handleCreateServerCompletionAction = useCallback(
    (
      serverId: string,
      action: "overview" | "invite" | "content" | "backup",
    ) => {
      resetCreateServer();
      navigateTo({
        name: "server",
        serverId,
        section:
          action === "content"
            ? "content"
            : action === "backup"
              ? "data"
              : action === "invite"
                ? "settings"
                : "overview",
        view:
          action === "content"
            ? "browse"
            : action === "backup"
              ? "backups"
              : action === "invite"
                ? "network"
                : undefined,
      });
    },
    [resetCreateServer],
  );

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

      <div
        className={
          sidebarCollapsed ? "app-body app-body-sidebar-collapsed" : "app-body"
        }
      >
        <Sidebar
          activePage={activePage}
          selectedServerId={selectedServerId ?? undefined}
          serverStatuses={processSummary?.statuses}
          servers={servers}
          onSelectPage={(page) => {
            if (page === "servers") {
              requestCreateServerExit(openServersOverview);
              return;
            }
            requestCreateServerExit(() => {
              navigateTo(
                page === "java"
                  ? { name: "java" }
                  : page === "logger"
                    ? { name: "activity" }
                    : { name: "settings", section: "general" },
              );
            });
          }}
          onSelectServer={(serverId) => {
            requestCreateServerExit(() => {
              navigateTo({
                name: "server",
                serverId,
                section: "overview",
              });
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
                          ? [
                              t("wizard.progress.counter", {
                                current: createServerProgress.currentStep + 1,
                                total: createServerProgress.steps.length,
                              }),
                              /* A step made of several screens leaves the
                                 counter frozen, so name the current one. */
                              createServerProgress.steps[
                                createServerProgress.currentStep
                              ]?.description,
                            ]
                              .filter(Boolean)
                              .join(" · ")
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
                initialSourcePath={
                  route.name === "create-server"
                    ? (route.sourcePath ?? null)
                    : null
                }
                initialStep={
                  route.name === "create-server" ? route.step : undefined
                }
                initialJobId={
                  route.name === "create-server" ? (route.jobId ?? null) : null
                }
                showHeading={false}
                onHeaderHiddenChange={setCreateServerHeaderHidden}
                onHeaderBackChange={handleCreateServerHeaderBackChange}
                onProgressChange={setCreateServerProgress}
                onLifecycleChange={setCreateServerLifecycle}
                onRouteStateChange={handleCreateServerRouteState}
                onCompletionAction={handleCreateServerCompletionAction}
                onCreated={() => {
                  void profilesQuery.refetch();
                }}
              />
            </section>
          ) : activePage === "java" ? (
            <JavaRuntimesView />
          ) : activePage === "settings" ? (
            <SettingsView
              activeSection={
                route.name === "settings" ? route.section : "general"
              }
              onSectionChange={(section) =>
                navigateTo({ name: "settings", section })
              }
            />
          ) : activePage === "logger" && !selectedServer ? (
            <AppLoggerView />
          ) : selectedServer ? (
            <ServerRuntimeProvider serverId={selectedServer.id}>
              <ServerDetail
                server={selectedServer}
                section={route.name === "server" ? route.section : "overview"}
                view={route.name === "server" ? route.view : undefined}
                path={route.name === "server" ? route.path : undefined}
                onBack={openServersOverview}
                onNavigate={(
                  section: ServerWorkspaceSection,
                  view?: string,
                  path?: string,
                ) =>
                  navigateTo({
                    name: "server",
                    serverId: selectedServer.id,
                    section,
                    ...(view ? { view } : {}),
                    ...(path ? { path } : {}),
                  })
                }
                onOpenJava={() => requestCreateServerExit(openJavaRuntimes)}
              />
            </ServerRuntimeProvider>
          ) : (
            <>
              <section className="page-header dashboard-page-header">
                <div className="page-header-heading">
                  <h1 id="servers-title">{t("servers.page.title")}</h1>
                </div>
                <div className="page-header-actions">
                  {servers.length > 1 ? (
                    <TextField
                      aria-label={t("servers.filter.label")}
                      className="dashboard-filter"
                      placeholder={t("servers.filter.placeholder")}
                      type="search"
                      value={serverFilter}
                      onChange={(event) => setServerFilter(event.target.value)}
                    />
                  ) : null}
                  <Button onClick={() => openCreateServer()} variant="primary">
                    <Plus aria-hidden="true" size={15} />
                    {t("servers.create.button")}
                  </Button>
                </div>
              </section>

              <section
                className="dashboard-status-rail"
                aria-label={t("servers.summary.aria")}
              >
                <div className="dashboard-status-item">
                  <span
                    aria-hidden="true"
                    className="status-indicator status-indicator-running"
                  />
                  <span>{t("servers.summary.running")}</span>
                  <strong>{runningCount ?? t("common.unknown")}</strong>
                </div>
                <div className="dashboard-status-item">
                  <span
                    aria-hidden="true"
                    className="status-indicator status-indicator-stopped"
                  />
                  <span>{t("servers.summary.stopped")}</span>
                  <strong>{stoppedCount}</strong>
                </div>
                <div className="dashboard-status-item">
                  <span
                    aria-hidden="true"
                    className="status-indicator status-indicator-crashed"
                  />
                  <span>{t("servers.summary.crashed")}</span>
                  <strong>{crashedCount ?? t("common.unknown")}</strong>
                </div>
                <div className="dashboard-status-item dashboard-status-total">
                  <ServerIcon aria-hidden="true" size={13} />
                  <span>{t("servers.summary.total")}</span>
                  <strong>{servers.length}</strong>
                </div>
              </section>

              {dashboardAttentionItems.length > 0 ? (
                <AttentionBar
                  aria-label={
                    isCrashFallback
                      ? t("servers.incident.aria")
                      : t("attention.aria")
                  }
                  className="dashboard-attention"
                  tone={
                    dashboardAttentionItems.some(
                      (item) => item.severity === "error",
                    )
                      ? "danger"
                      : dashboardAttentionItems.some(
                            (item) => item.severity === "warning",
                          )
                        ? "warning"
                        : "info"
                  }
                >
                  <CircleAlert aria-hidden="true" size={17} />
                  <div>
                    <strong>
                      {isCrashFallback
                        ? t(
                            dashboardAttentionItems.length === 1
                              ? "servers.incident.titleOne"
                              : "servers.incident.titleMany",
                            { count: dashboardAttentionItems.length },
                          )
                        : t("attention.title", {
                            count: dashboardAttentionItems.length,
                          })}
                    </strong>
                    <span>
                      {t(
                        isCrashFallback
                          ? "servers.incident.description"
                          : "attention.description",
                      )}
                    </span>
                  </div>
                  <div className="dashboard-attention-actions">
                    {dashboardAttentionItems.slice(0, 4).map((item) => (
                      <Button
                        key={item.id}
                        variant="ghost"
                        onClick={() => openAttentionItem(item)}
                      >
                        {item.serverName}
                        <span>{t(`attention.kind.${item.kind}`)}</span>
                      </Button>
                    ))}
                  </div>
                </AttentionBar>
              ) : null}

              <div className="dashboard-servers">
                <ServerList
                  error={profilesQuery.error}
                  filtered={normalizedServerFilter.length > 0}
                  isLoading={profilesQuery.isLoading}
                  selectedServerId={selectedServerId ?? undefined}
                  servers={filteredServers}
                  lastBackups={processSummary?.lastBackups}
                  serverStatuses={processSummary?.statuses}
                  onCreateServer={() => openCreateServer()}
                  onImportServer={() => openCreateServer()}
                  onRetry={() => void profilesQuery.refetch()}
                  onSelectServer={(serverId) =>
                    navigateTo({
                      name: "server",
                      serverId,
                      section: "overview",
                    })
                  }
                />
              </div>
            </>
          )}
        </main>
      </div>
      <BottomStatusBar
        runningCount={runningCount}
        crashedCount={crashedCount}
        selectedServer={selectedServer}
        onOpenJava={() => requestCreateServerExit(openJavaRuntimes)}
        onOpenNotifications={() =>
          requestCreateServerExit(() =>
            navigateTo({ name: "settings", section: "notifications" }),
          )
        }
      />
    </div>
  );
}
