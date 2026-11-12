import {
  Component,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { RefreshCw } from "lucide-react";
import type { ServerWorkspaceSection } from "../../app/router";
import { Button } from "../../components/ui/button";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { ServerCover } from "../../components/ui/server-cover";
import { useAppSettings } from "../../i18n";
import { ServerUpdatesView } from "../updates/ServerUpdatesView";
import { createWorldBackup } from "../backups/backupApi";
import { backupKeys } from "../backups/queries";
import { getLoaderBranding } from "../loaders/loaderBranding";
import { usePlayerViewCounts } from "../players/usePlayerViewCounts";
import { ServerActions, ServerProcessStatusBadge } from "./ServerActions";
import { CrashBanner } from "./CrashBanner";
import { ServerShareBar } from "./ServerShareBar";
import { ServerWorkspaceNav } from "./ServerWorkspaceNav";
import { ServerWorkspacePanel } from "./ServerWorkspacePanel";
import { serverKeys } from "./queries";
import { normalizeWorkspaceView, workspaceDefinition } from "./serverWorkspace";
import type { ServerProfile } from "./types";

interface ServerDetailProps {
  server: ServerProfile;
  section?: ServerWorkspaceSection;
  view?: string;
  path?: string;
  onNavigate?: (
    section: ServerWorkspaceSection,
    view?: string,
    path?: string,
  ) => void;
  onOpenJava?: () => void;
}

interface PanelErrorBoundaryProps {
  children: ReactNode;
  errorTitle: string;
  panelLabel: string;
  retryLabel: string;
  resetKey: string;
}

interface PanelErrorBoundaryState {
  error: Error | null;
}

class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `Failed to render ${this.props.panelLabel} server workspace`,
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
    if (!this.state.error) return this.props.children;
    return (
      <div className="list-state list-state-error" role="alert">
        <strong>{this.props.errorTitle}</strong>
        <details>
          <summary>{this.props.panelLabel}</summary>
          <code>{this.state.error.message}</code>
        </details>
        <Button
          variant="secondary"
          onClick={() => this.setState({ error: null })}
        >
          <RefreshCw aria-hidden="true" size={15} />
          {this.props.retryLabel}
        </Button>
      </div>
    );
  }
}

export function ServerDetail({
  server,
  section = "console",
  view,
  path,
  onNavigate = () => undefined,
  onOpenJava,
}: ServerDetailProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const definition = workspaceDefinition(section);
  const activeView = normalizeWorkspaceView(section, view);
  const playerViewCounts = usePlayerViewCounts(
    server.id,
    section === "players",
  );
  const backupMutation = useMutation({
    mutationFn: () => createWorldBackup({ serverId: server.id }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: backupKeys.list(server.id),
        }),
        queryClient.invalidateQueries({
          queryKey: serverKeys.setupStatus(server.id),
        }),
      ]);
    },
  });
  const loaderLabel = getLoaderBranding(server.loaderType).label;

  return (
    <div className="server-workspace">
      <header className="server-header">
        <ServerCover loaderType={server.loaderType} size={48} />
        <div className="server-header-identity">
          <h1 id="servers-title">{server.name}</h1>
          <p>
            <span>{loaderLabel}</span>
            {server.loaderVersion ? <span> {server.loaderVersion}</span> : null}
            <span>
              {" · "}
              {t("server.meta.mc", {
                version: server.minecraftVersion ?? "?",
              })}
            </span>
            <span className="server-header-status">
              <ServerProcessStatusBadge />
            </span>
          </p>
        </div>
        <div className="server-header-actions">
          <Button variant="ghost" onClick={() => setUpgradeOpen(true)}>
            {t("server.upgrade.open")}
          </Button>
          <Button
            disabled={backupMutation.isPending}
            type="button"
            variant="secondary"
            onClick={() => backupMutation.mutate()}
          >
            {t("servers.actions.backup")}
          </Button>
          <ServerActions server={server} />
        </div>
      </header>

      <DialogSurface
        className="server-upgrade-dialog"
        description={t("server.upgrade.description")}
        footer={
          <Button
            type="button"
            variant="secondary"
            onClick={() => setUpgradeOpen(false)}
          >
            {t("common.close")}
          </Button>
        }
        open={upgradeOpen}
        title={t("server.upgrade.title")}
        onOpenChange={setUpgradeOpen}
      >
        <ServerUpdatesView server={server} />
      </DialogSurface>

      {backupMutation.error ? (
        <p className="server-header-error" role="alert">
          {backupMutation.error.message}
        </p>
      ) : null}
      {backupMutation.isSuccess ? (
        <p className="visually-hidden" role="status">
          {t("server.backup.completed")}
        </p>
      ) : null}

      <CrashBanner serverId={server.id} />
      <ServerShareBar
        server={server}
        onOpenNetwork={() => onNavigate("settings", "network")}
      />

      <ServerWorkspaceNav
        serverName={server.name}
        section={section}
        onNavigate={onNavigate}
      />

      <section
        aria-label={t(definition.labelKey)}
        className="server-workspace-main"
      >
        {definition.views ? (
          <nav
            aria-label={t("server.workspace.views")}
            className="workspace-view-switcher"
          >
            {definition.views.map((item) => {
              const count = playerViewCounts?.[item.id];
              return (
                <button
                  aria-current={activeView === item.id ? "page" : undefined}
                  className={
                    activeView === item.id
                      ? "workspace-view-option workspace-view-option-active"
                      : "workspace-view-option"
                  }
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(section, item.id)}
                >
                  {t(item.labelKey)}
                  {/* Decorative: the panel below announces the same totals,
                      and a changing accessible name would be unstable. */}
                  {count === undefined ? null : (
                    <span aria-hidden="true" className="workspace-view-count">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        ) : null}

        <motion.div
          animate={{ opacity: 1 }}
          className="server-workspace-content"
          initial={{ opacity: 0.85 }}
          key={`${server.id}-${section}-${activeView ?? "root"}`}
          transition={{ duration: 0.12, ease: "easeOut" }}
        >
          <PanelErrorBoundary
            errorTitle={t("server.panel.errorTitle")}
            panelLabel={t(definition.labelKey)}
            resetKey={`${server.id}-${section}-${activeView ?? "root"}`}
            retryLabel={t("common.retry")}
          >
            <ServerWorkspacePanel
              onNavigate={onNavigate}
              onOpenJava={onOpenJava}
              path={path}
              section={section}
              server={server}
              view={activeView}
            />
          </PanelErrorBoundary>
        </motion.div>
      </section>
    </div>
  );
}
