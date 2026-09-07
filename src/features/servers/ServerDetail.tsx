import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Check, ChevronLeft, Copy, RefreshCw } from "lucide-react";
import type { ServerWorkspaceSection } from "../../app/router";
import { Button } from "../../components/ui/button";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { useAppSettings } from "../../i18n";
import { ServerUpdatesView } from "../updates/ServerUpdatesView";
import { createWorldBackup } from "../backups/backupApi";
import { backupKeys } from "../backups/queries";
import { LoaderPill } from "../loaders/LoaderIdentity";
import { usePlayerViewCounts } from "../players/usePlayerViewCounts";
import { ServerActions, ServerProcessStatusBadge } from "./ServerActions";
import { ServerHeaderTelemetry } from "./ServerHeaderTelemetry";
import { ServerWorkspacePanel } from "./ServerWorkspacePanel";
import { serverKeys } from "./queries";
import { normalizeWorkspaceView, workspaceDefinition } from "./serverWorkspace";
import type { ServerProfile } from "./types";

interface ServerDetailProps {
  server: ServerProfile;
  section?: ServerWorkspaceSection;
  view?: string;
  path?: string;
  onBack?: () => void;
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
  section = "overview",
  view,
  path,
  onBack,
  onNavigate = () => undefined,
  onOpenJava,
}: ServerDetailProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  useEffect(() => setCopyState("idle"), [server.serverPort]);
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

  return (
    <div className="detail-panel command-deck-detail">
      <header className="detail-panel-header command-deck-header">
        <div className="detail-panel-title">
          <div className="detail-panel-heading">
            {onBack ? (
              <Button
                aria-label={t("wizard.nav.back")}
                className="icon-button page-header-back"
                type="button"
                variant="ghost"
                onClick={onBack}
              >
                <ChevronLeft aria-hidden="true" size={17} />
              </Button>
            ) : null}
            <div>
              <div className="detail-panel-name-row">
                <h1 className="detail-panel-name" id="servers-title">
                  {server.name}
                </h1>
                <ServerProcessStatusBadge />
              </div>
              <div className="detail-panel-meta">
                <LoaderPill loaderType={server.loaderType} />
                <span className="detail-panel-version">
                  {t("server.meta.mc", {
                    version: server.minecraftVersion ?? "?",
                  })}
                </span>
                <span>
                  {t("server.meta.port", {
                    port: server.serverPort ?? t("server.meta.unset"),
                  })}
                </span>
                <span>
                  {server.minMemoryMb ?? "?"}–{server.maxMemoryMb ?? "?"} MB
                </span>
              </div>
            </div>
          </div>
          {section !== "overview" ? (
            <ServerHeaderTelemetry serverId={server.id} />
          ) : null}
        </div>
        <div className="detail-panel-actions">
          <Button variant="ghost" onClick={() => setUpgradeOpen(true)}>
            {t("server.upgrade.open")}
          </Button>
          <ServerActions server={server} />
          <Button
            disabled={backupMutation.isPending}
            type="button"
            variant="secondary"
            onClick={() => backupMutation.mutate()}
          >
            {t("servers.actions.backup")}
          </Button>
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
        <p className="detail-panel-error" role="alert">
          {backupMutation.error.message}
        </p>
      ) : null}

      <div className="server-connection-bar">
        <span>{t("server.connection.local")}</span>
        <button
          type="button"
          disabled={!server.serverPort}
          aria-label={t("server.connection.copy")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                `localhost:${server.serverPort}`,
              );
              setCopyState("copied");
            } catch {
              setCopyState("failed");
            }
          }}
        >
          <code>
            {server.serverPort ? `localhost:${server.serverPort}` : "—"}
          </code>
          {copyState === "copied" ? (
            <Check size={13} aria-hidden="true" />
          ) : (
            <Copy size={13} aria-hidden="true" />
          )}
        </button>
        <span role="status">
          {copyState === "copied"
            ? t("server.connection.copied")
            : copyState === "failed"
              ? t("server.connection.copyFailed")
              : t("server.connection.localHint")}
        </span>
        <button
          className="server-connection-settings"
          type="button"
          onClick={() => onNavigate("settings", "network")}
        >
          {t("server.workspace.settings.network")}
        </button>
        {backupMutation.isSuccess ? (
          <span role="status">{t("server.backup.completed")}</span>
        ) : null}
      </div>

      <div className="server-workspace-shell">
        <section
          aria-label={t(definition.labelKey)}
          className="server-workspace-main"
        >
          {/* The eyebrow never changed and the section title only repeated the
              nav item already highlighted beside it, so two of the four header
              rows were pure chrome. The section name lives on the <section>
              label, which is what assistive technology reads anyway. */}
          {definition.views ? (
            <header className="server-workspace-heading">
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
                        <span
                          aria-hidden="true"
                          className="workspace-view-count"
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </header>
          ) : null}

          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="server-workspace-content"
            initial={{ opacity: 0.82, y: 2 }}
            key={`${server.id}-${section}-${activeView ?? "root"}`}
            transition={{ duration: 0.14, ease: "easeOut" }}
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
    </div>
  );
}
