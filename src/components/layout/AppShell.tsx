import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  CircleAlert,
  Plus,
  Search,
  Server as ServerIcon,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { NotificationCenter } from "./NotificationCenter";
import { Sidebar, type PrimaryPage } from "./Sidebar";
import { WindowTitlebar } from "./WindowTitlebar";
import {
  ActionIcon,
  Box,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { Button } from "../ui/button";
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
import { PackDropCard } from "../../features/servers/PackDropCard";
import { isPackFilePath } from "../../features/servers/packDetection";
import { ServerList } from "../../features/servers/ServerList";
import { ServerDetail } from "../../features/servers/ServerDetail";
import { ServerRuntimeProvider } from "../../features/servers/ServerRuntimeContext";
import { WizardStepIndicator } from "../../features/servers/WizardStepIndicator";
import type { ServerProfile } from "../../domain/server";
import type { ProcessSummary } from "../../features/process/api";
import { useQueryClient } from "@tanstack/react-query";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import { serverKeys } from "../../features/servers/queries";
import { importLocalContent } from "../../features/content/contentApi";
import { contentKeys } from "../../features/content/queries";
import { errorMessage } from "../../lib/error-message";
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
  const queryClient = useQueryClient();
  const pushNotification = useNotificationStore((state) => state.push);
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
  const [droppedPackPath, setDroppedPackPath] = useState<string | null>(null);
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
      /* Crashes land on the overview, which is where diagnostics, the event
         timeline and the performance history now sit together. */
      section:
        item.kind === "update"
          ? "content"
          : item.kind === "backup"
            ? "backups"
            : "console",
      view:
        item.kind === "update"
          ? "updates"
          : item.kind === "backup"
            ? "backups"
            : undefined,
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

  const handleDropImport = useCallback(
    (paths: string[]) => {
      /* On a server's Mods tab a dropped jar is a mod for that server. */
      if (
        route.name === "server" &&
        route.section === "content" &&
        paths.length > 0 &&
        paths.every((path) => /\.jar$/i.test(path))
      ) {
        const serverId = route.serverId;
        void (async () => {
          for (const path of paths) {
            try {
              await importLocalContent(serverId, path);
            } catch (error) {
              pushNotification({
                severity: "error",
                title: t("notifications.actionFailed"),
                message: errorMessage(error),
              });
            }
          }
          await queryClient.invalidateQueries({
            queryKey: contentKeys.installed(serverId),
          });
        })();
        return;
      }
      if (paths.length === 1 && isPackFilePath(paths[0])) {
        setDroppedPackPath(paths[0]);
      } else if (paths.length > 0) {
        setDroppedImportPaths(paths);
      }
    },
    [route, pushNotification, queryClient, t],
  );

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

  const openCreateServer = useCallback(
    (sourcePath: string | null = null, intent?: "import") => {
      setCreateServerLifecycle("draft");
      navigateTo({
        name: "create-server",
        ...(sourcePath ? { sourcePath } : {}),
        ...(intent ? { intent } : {}),
      });
    },
    [],
  );

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
      action: "overview" | "network" | "content" | "backup",
    ) => {
      resetCreateServer();
      navigateTo({
        name: "server",
        serverId,
        section:
          action === "content"
            ? "content"
            : action === "backup"
              ? "backups"
              : action === "network"
                ? "settings"
                : "console",
        view:
          action === "content"
            ? "browse"
            : action === "backup"
              ? "backups"
              : action === "network"
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
      <PackDropCard
        path={droppedPackPath}
        onClose={() => setDroppedPackPath(null)}
        onCreated={(serverId) => {
          setDroppedPackPath(null);
          if (serverId) {
            navigateTo({ name: "server", serverId, section: "console" });
          }
        }}
        onOpenWizard={(sourcePath) => {
          setDroppedPackPath(null);
          requestCreateServerExit(() => openCreateServer(sourcePath));
        }}
      />
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
          onCreateServer={() =>
            requestCreateServerExit(() => openCreateServer())
          }
          notifications={
            <NotificationCenter
              onOpenSettings={() =>
                requestCreateServerExit(() =>
                  navigateTo({ name: "settings", section: "notifications" }),
                )
              }
            />
          }
          onSelectServer={(serverId) => {
            requestCreateServerExit(() => {
              navigateTo({
                name: "server",
                serverId,
                section: "console",
              });
            });
          }}
        />
        <main
          className="page"
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
            <Stack component="section" gap={0} h="100%" mih={0}>
              {createServerHeaderHidden ? (
                <>
                  <VisuallyHidden component="h1" id="create-server-page-title">
                    {t("servers.create.title")}
                  </VisuallyHidden>
                  <VisuallyHidden component="p">
                    {t("servers.create.description")}
                  </VisuallyHidden>
                </>
              ) : (
                <Group
                  component="header"
                  data-create-server-header
                  gap="md"
                  px="lg"
                  py="sm"
                  wrap="nowrap"
                >
                  <Group gap="sm" w={220} wrap="nowrap">
                    {createServerHeaderBack ? (
                      <Button variant="ghost" onClick={createServerHeaderBack}>
                        <ChevronLeft aria-hidden="true" size={16} />
                        {t("wizard.nav.back")}
                      </Button>
                    ) : null}
                    <Box miw={0}>
                      <Title id="create-server-page-title" order={1} fz="lg">
                        {t("servers.create.title")}
                      </Title>
                      <Text c="dimmed" size="sm" truncate>
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
                      </Text>
                    </Box>
                  </Group>
                  <Box miw={0} style={{ flex: 1 }}>
                    {createServerProgress ? (
                      <WizardStepIndicator
                        currentStep={createServerProgress.currentStep}
                        steps={createServerProgress.steps}
                      />
                    ) : null}
                  </Box>
                  <Group justify="flex-end" w={220}>
                    <Tooltip label={t("servers.create.close")}>
                      <ActionIcon
                        aria-label={t("servers.create.close")}
                        size="lg"
                        onClick={() =>
                          requestCreateServerExit(openServersOverview)
                        }
                      >
                        <X aria-hidden="true" size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
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
                openFolderPickerOnMount={
                  route.name === "create-server" && route.intent === "import"
                }
                initialJobId={
                  route.name === "create-server" ? (route.jobId ?? null) : null
                }
                showHeading={false}
                /* The pack page hides the wizard header for the full canvas,
                   so the exit rides along in the detail bar rather than being
                   floated into a corner the search row already owns. */
                marketplaceDetailAction={
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => requestCreateServerExit(openServersOverview)}
                  >
                    <X aria-hidden="true" size={15} />
                    {t("servers.create.exit")}
                  </Button>
                }
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
            </Stack>
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
                key={selectedServer.id}
                server={selectedServer}
                section={route.name === "server" ? route.section : "console"}
                view={route.name === "server" ? route.view : undefined}
                path={route.name === "server" ? route.path : undefined}
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
            <ScrollArea h="100%">
              <Stack gap="md" p="lg">
                <Group justify="space-between" wrap="nowrap">
                  <Title id="servers-title" order={1}>
                    {t("servers.page.title")}
                  </Title>
                  <Group gap="sm" wrap="nowrap">
                    {servers.length > 1 ? (
                      <TextInput
                        aria-label={t("servers.filter.label")}
                        autoComplete="off"
                        leftSection={<Search aria-hidden="true" size={14} />}
                        placeholder={t("servers.filter.placeholder")}
                        type="search"
                        value={serverFilter}
                        w={240}
                        onChange={(event) =>
                          setServerFilter(event.currentTarget.value)
                        }
                      />
                    ) : null}
                    <Button
                      onClick={() => openCreateServer()}
                      variant="primary"
                    >
                      <Plus aria-hidden="true" size={16} />
                      {t("servers.create.button")}
                    </Button>
                  </Group>
                </Group>

                <Paper
                  aria-label={t("servers.summary.aria")}
                  component="section"
                  px="md"
                  py="sm"
                >
                  <Group gap="xl">
                    <SummaryItem
                      color="green.6"
                      label={t("servers.summary.running")}
                      value={runningCount ?? t("common.unknown")}
                    />
                    <SummaryItem
                      color="gray.6"
                      label={t("servers.summary.stopped")}
                      value={stoppedCount}
                    />
                    <SummaryItem
                      color="red.6"
                      label={t("servers.summary.crashed")}
                      value={crashedCount ?? t("common.unknown")}
                    />
                    <Group gap={6} ml="auto" wrap="nowrap">
                      <ServerIcon aria-hidden="true" size={14} />
                      <Text c="dimmed" size="sm">
                        {t("servers.summary.total")}
                      </Text>
                      <Text ff="monospace" fw={600} size="sm">
                        {servers.length}
                      </Text>
                    </Group>
                  </Group>
                </Paper>

                {dashboardAttentionItems.length > 0 ? (
                  <AttentionBar
                    aria-label={
                      isCrashFallback
                        ? t("servers.incident.aria")
                        : t("attention.aria")
                    }
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
                    <CircleAlert aria-hidden="true" size={16} />
                    <Stack gap={0} miw={180}>
                      <Text fw={600} size="sm">
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
                      </Text>
                      <Text c="dimmed" size="xs">
                        {t(
                          isCrashFallback
                            ? "servers.incident.description"
                            : "attention.description",
                        )}
                      </Text>
                    </Stack>
                    <Group gap={4} justify="flex-end" ml="auto">
                      {dashboardAttentionItems.slice(0, 4).map((item) => (
                        <Button
                          key={item.id}
                          variant="ghost"
                          onClick={() => openAttentionItem(item)}
                        >
                          {item.serverName}
                          <Text c="dimmed" component="span" size="xs">
                            {t(`attention.kind.${item.kind}`)}
                          </Text>
                        </Button>
                      ))}
                    </Group>
                  </AttentionBar>
                ) : null}

                <ServerList
                  error={profilesQuery.error}
                  filtered={normalizedServerFilter.length > 0}
                  isLoading={profilesQuery.isLoading}
                  selectedServerId={selectedServerId ?? undefined}
                  servers={filteredServers}
                  lastBackups={processSummary?.lastBackups}
                  serverStatuses={processSummary?.statuses}
                  onCreateServer={() => openCreateServer()}
                  onImportServer={() => openCreateServer(null, "import")}
                  onRetry={() => void profilesQuery.refetch()}
                  onSelectServer={(serverId) =>
                    navigateTo({
                      name: "server",
                      serverId,
                      section: "console",
                    })
                  }
                />
              </Stack>
            </ScrollArea>
          )}
        </main>
      </div>
    </div>
  );
}

function SummaryItem({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number | string;
}) {
  return (
    <Group gap={6} wrap="nowrap">
      <Box
        aria-hidden="true"
        bg={color}
        h={8}
        style={{ borderRadius: "50%" }}
        w={8}
      />
      <Text c="dimmed" size="sm">
        {label}
      </Text>
      <Text ff="monospace" fw={600} size="sm">
        {value}
      </Text>
    </Group>
  );
}
