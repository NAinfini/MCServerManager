import {
  Component,
  lazy,
  Suspense,
  type ErrorInfo,
  type ReactNode,
} from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Activity,
  Archive,
  Coffee,
  FileCode2,
  FileCheck2,
  Package,
  Play,
  Settings,
  Terminal,
  Upload,
} from "lucide-react";
import { createWorldBackup } from "../backups/backupApi";
import { ProfileImportExport } from "../profiles/ProfileImportExport";
import { TunnelProvidersView } from "../tunnels/TunnelProvidersView";
import { ServerActions, ServerProcessStatusBadge } from "./ServerActions";
import { ServerProfileSettings } from "./ServerProfileSettings";
import type { ServerProfile } from "./types";
import { useServerUiStore, type ServerDetailTab } from "./serverUiStore";
import { LoaderPill } from "../loaders/LoaderIdentity";
import { useAppSettings } from "../../i18n";
import { ServerActivityView } from "../activity/ServerActivityView";

const ConsoleView = lazy(() =>
  import("../console/ConsoleView").then((module) => ({
    default: module.ConsoleView,
  })),
);
const ServerPropertiesEditor = lazy(() =>
  import("../config/ServerPropertiesEditor").then((module) => ({
    default: module.ServerPropertiesEditor,
  })),
);
const GamerulesEditor = lazy(() =>
  import("../config/GamerulesEditor").then((module) => ({
    default: module.GamerulesEditor,
  })),
);
const ServerUpdatesView = lazy(() =>
  import("../updates/ServerUpdatesView").then((module) => ({
    default: module.ServerUpdatesView,
  })),
);
const DiagnosticsView = lazy(() =>
  import("../diagnostics/DiagnosticsView").then((module) => ({
    default: module.DiagnosticsView,
  })),
);
const ServerFilesView = lazy(() =>
  import("../files/ServerFilesView").then((module) => ({
    default: module.ServerFilesView,
  })),
);
const ServerBackupsView = lazy(() =>
  import("../backups/ServerBackupsView").then((module) => ({
    default: module.ServerBackupsView,
  })),
);
const InstalledContentView = lazy(() =>
  import("../content/InstalledContentView").then((module) => ({
    default: module.InstalledContentView,
  })),
);
const ServerMarketplaceView = lazy(() =>
  import("../marketplace/ServerMarketplaceView").then((module) => ({
    default: module.ServerMarketplaceView,
  })),
);
const ContentUpdatePolicyView = lazy(() =>
  import("../content/ContentUpdatePolicyView").then((module) => ({
    default: module.ContentUpdatePolicyView,
  })),
);
interface ServerDetailProps {
  server: ServerProfile;
}

interface PanelErrorBoundaryProps {
  children: ReactNode;
  errorTitle: string;
  panelLabel: string;
  resetKey: string;
}

interface PanelErrorBoundaryState {
  error: Error | null;
}

class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `Failed to render ${this.props.panelLabel} server detail panel`,
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(previousProps: PanelErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="list-state list-state-error" role="alert">
        <strong>{this.props.errorTitle}</strong>
        <span>{this.state.error.message}</span>
      </div>
    );
  }
}

const detailTabs: Array<{
  id: ServerDetailTab;
  labelKey: string;
  panelId: string;
  icon: typeof Terminal;
}> = [
  { id: "console", labelKey: "server.tabs.console", panelId: "server-detail-console", icon: Terminal },
  { id: "files", labelKey: "server.tabs.files", panelId: "server-detail-files", icon: FileCode2 },
  { id: "content", labelKey: "server.tabs.content", panelId: "server-detail-content", icon: Package },
  { id: "backups", labelKey: "server.tabs.backups", panelId: "server-detail-backups", icon: Archive },
  { id: "settings", labelKey: "server.tabs.settings", panelId: "server-detail-settings", icon: Settings },
  { id: "activity", labelKey: "server.tabs.activity", panelId: "server-detail-activity", icon: Activity },
];

function ServerSetupGuide() {
  const { t } = useAppSettings();
  const steps = [
    { icon: Coffee, titleKey: "server.setupGuide.java.title", bodyKey: "server.setupGuide.java.body" },
    { icon: Upload, titleKey: "server.setupGuide.jar.title", bodyKey: "server.setupGuide.jar.body" },
    { icon: FileCheck2, titleKey: "server.setupGuide.eula.title", bodyKey: "server.setupGuide.eula.body" },
    { icon: Play, titleKey: "server.setupGuide.start.title", bodyKey: "server.setupGuide.start.body" },
    { icon: Archive, titleKey: "server.setupGuide.backup.title", bodyKey: "server.setupGuide.backup.body" },
  ];

  return (
    <section
      aria-label={t("server.setupGuide.aria")}
      className="settings-panel server-setup-guide"
    >
      <div className="section-heading">
        <h2>{t("server.setupGuide.title")}</h2>
        <span>{t("server.setupGuide.description")}</span>
      </div>
      <ol className="server-setup-steps">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li key={step.titleKey}>
              <span className="server-setup-step-icon">
                <Icon aria-hidden="true" size={15} />
              </span>
              <div>
                <strong>{t(step.titleKey)}</strong>
                <span>{t(step.bodyKey)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ServerDetailPanel({
  server,
  tab,
}: {
  server: ServerProfile;
  tab: ServerDetailTab;
}) {
  switch (tab) {
    case "console":
      return <ConsoleView serverId={server.id} />;
    case "settings":
      return (
        <>
          <ServerSetupGuide />
          <ServerProfileSettings server={server} />
          <ServerPropertiesEditor server={server} />
          <GamerulesEditor server={server} />
          <TunnelProvidersView servers={[server]} />
          <ServerUpdatesView server={server} />
          <DiagnosticsView server={server} />
          <ProfileImportExport server={server} />
        </>
      );
    case "files":
      return <ServerFilesView server={server} />;
    case "backups":
      return <ServerBackupsView server={server} />;
    case "content":
      return (
        <>
          <InstalledContentView server={server} />
          <ServerMarketplaceView server={server} />
          <ContentUpdatePolicyView server={server} />
        </>
      );
    case "activity":
      return <ServerActivityView server={server} />;
  }
}

export function ServerDetail({ server }: ServerDetailProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const storedTab = useServerUiStore(
    (state) => state.selectedTabs[server.id],
  );
  const activeTab = detailTabs.some((tab) => tab.id === storedTab)
    ? storedTab
    : "console";
  const setSelectedTab = useServerUiStore((state) => state.setSelectedTab);
  const setActiveTab = (tab: ServerDetailTab) => {
    setSelectedTab(server.id, tab);
  };
  const backupMutation = useMutation({
    mutationFn: () => createWorldBackup({ serverId: server.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["backups", server.id] });
    },
  });

  return (
    <div className="detail-panel">
      <div className="detail-panel-header">
        <div className="detail-panel-title">
          <strong className="detail-panel-name">{server.name}</strong>
          <div className="detail-panel-meta">
            <LoaderPill loaderType={server.loaderType} />
            <span className="detail-meta-separator" />
            <span>
              {t("server.meta.mc", { version: server.minecraftVersion ?? "?" })}
            </span>
            <span className="detail-meta-separator" />
            <span>
              {t("server.meta.port", {
                port: server.serverPort ?? t("server.meta.unset"),
              })}
            </span>
            <span className="detail-meta-separator" />
            <span>{server.minMemoryMb ?? "?"}-{server.maxMemoryMb ?? "?"} MB</span>
          </div>
        </div>
        <div className="detail-panel-actions">
          <ServerActions server={server} />
          <button
            className="button button-secondary"
            disabled={backupMutation.isPending}
            type="button"
            onClick={() => backupMutation.mutate()}
          >
            {t("servers.actions.backup")}
          </button>
          <ServerProcessStatusBadge serverId={server.id} />
        </div>
      </div>
      {backupMutation.error ? (
        <p className="detail-panel-error">{backupMutation.error.message}</p>
      ) : null}
      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ServerDetailTab)}
      >
        <Tabs.List
          className="detail-tabs"
          aria-label={t("server.tabs.aria", { server: server.name })}
        >
          {detailTabs.map((tab) => (
            <Tabs.Trigger key={tab.id} value={tab.id}>
              <tab.icon aria-hidden="true" size={12} />
              <span>{t(tab.labelKey)}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <div className="detail-tab-content">
          {detailTabs.map((tab) => (
            <Tabs.Content key={tab.id} id={tab.panelId} value={tab.id}>
              {activeTab === tab.id ? (
                <motion.div
                  key={`${server.id}-${activeTab}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.14, ease: "easeOut" }}
                >
                  <PanelErrorBoundary
                    errorTitle={t("server.panel.errorTitle")}
                    panelLabel={t(tab.labelKey)}
                    resetKey={`${server.id}-${activeTab}`}
                  >
                    <Suspense
                      fallback={
                        <div className="list-state">
                          {t("common.loadingPanel")}
                        </div>
                      }
                    >
                      <ServerDetailPanel server={server} tab={tab.id} />
                    </Suspense>
                  </PanelErrorBoundary>
                </motion.div>
              ) : null}
            </Tabs.Content>
          ))}
        </div>
      </Tabs.Root>
    </div>
  );
}
