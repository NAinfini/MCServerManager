import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Alert,
  Button as MantineButton,
  Code,
  Group,
  Stack,
  Text,
  Title,
  VisuallyHidden,
} from "@mantine/core";
import { Archive, RefreshCw } from "lucide-react";
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
      <Alert color="red" role="alert" title={this.props.errorTitle}>
        <Stack align="flex-start" gap="sm">
          <details>
            <summary>{this.props.panelLabel}</summary>
            <Code block mt="xs">
              {this.state.error.message}
            </Code>
          </details>
          <Button
            variant="secondary"
            onClick={() => this.setState({ error: null })}
          >
            <RefreshCw aria-hidden="true" size={16} />
            {this.props.retryLabel}
          </Button>
        </Stack>
      </Alert>
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
    <Stack gap={0} h="100%" mih={0}>
      <Group component="header" gap="md" pb="sm" pt="md" px="lg" wrap="nowrap">
        <ServerCover loaderType={server.loaderType} size={48} />
        <Stack gap={4} miw={0} style={{ flex: 1 }}>
          <Group gap="sm" wrap="nowrap">
            <Title id="servers-title" order={1} fz="h2" lineClamp={1}>
              {server.name}
            </Title>
            <ServerProcessStatusBadge />
          </Group>
          <Text c="dimmed" size="sm" truncate>
            {loaderLabel}
            {server.loaderVersion ? ` ${server.loaderVersion}` : ""}
            {" · "}
            {t("server.meta.mc", {
              version: server.minecraftVersion ?? "?",
            })}
          </Text>
        </Stack>
        <Group gap="xs" wrap="nowrap">
          <Button variant="ghost" onClick={() => setUpgradeOpen(true)}>
            {t("server.upgrade.open")}
          </Button>
          <Button
            disabled={backupMutation.isPending}
            variant="secondary"
            onClick={() => backupMutation.mutate()}
          >
            <Archive aria-hidden="true" size={16} />
            {t("servers.actions.backup")}
          </Button>
          <ServerActions server={server} />
        </Group>
      </Group>

      <DialogSurface
        description={t("server.upgrade.description")}
        footer={
          <Button variant="secondary" onClick={() => setUpgradeOpen(false)}>
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
        <Text c="red" pb="xs" px="lg" role="alert" size="sm">
          {backupMutation.error.message}
        </Text>
      ) : null}
      {backupMutation.isSuccess ? (
        <VisuallyHidden role="status">
          {t("server.backup.completed")}
        </VisuallyHidden>
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

      <Stack
        aria-label={t(definition.labelKey)}
        component="section"
        gap={0}
        mih={0}
        style={{ flex: 1, overflow: "hidden" }}
      >
        {definition.views ? (
          <Group
            aria-label={t("server.workspace.views")}
            component="nav"
            gap={4}
            pt="sm"
            px="lg"
          >
            {definition.views.map((item) => {
              const count = playerViewCounts?.[item.id];
              const active = activeView === item.id;
              return (
                <MantineButton
                  aria-current={active ? "page" : undefined}
                  color={active ? "azure" : "gray"}
                  key={item.id}
                  /* Decorative: the panel below announces the same totals,
                     and a changing accessible name would be unstable. */
                  rightSection={
                    count === undefined ? undefined : (
                      <Text
                        aria-hidden="true"
                        c="dimmed"
                        component="span"
                        size="xs"
                      >
                        {count}
                      </Text>
                    )
                  }
                  size="xs"
                  variant={active ? "light" : "subtle"}
                  onClick={() => onNavigate(section, item.id)}
                >
                  {t(item.labelKey)}
                </MantineButton>
              );
            })}
          </Group>
        ) : null}

        {/* The class marks the panel scroller that workspace panels size to. */}
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
      </Stack>
    </Stack>
  );
}
