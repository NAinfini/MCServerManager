import {
  Activity,
  Archive,
  Bot,
  Package,
  Settings,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ServerWorkspaceSection } from "../../app/router";

export interface ServerWorkspaceView {
  id: string;
  labelKey: string;
}

export interface ServerWorkspaceDefinition {
  id: ServerWorkspaceSection;
  icon: LucideIcon;
  labelKey: string;
  defaultView?: string;
  views?: readonly ServerWorkspaceView[];
}

export const serverWorkspaceDefinitions: readonly ServerWorkspaceDefinition[] =
  [
    {
      id: "overview",
      icon: Activity,
      labelKey: "server.workspace.overview",
    },
    {
      /* Live output and the log files on disk answer the same question — what
         did the server say — so they sit behind one nav item instead of being
         split across two sections. */
      id: "console",
      icon: Terminal,
      labelKey: "server.workspace.console",
      defaultView: "terminal",
      views: [
        { id: "terminal", labelKey: "server.workspace.console.terminal" },
        { id: "logs", labelKey: "server.workspace.console.logs" },
      ],
    },
    {
      id: "players",
      icon: Users,
      labelKey: "server.workspace.players",
      defaultView: "online",
      views: [
        { id: "online", labelKey: "server.workspace.players.online" },
        { id: "ops", labelKey: "server.workspace.players.ops" },
        { id: "whitelist", labelKey: "server.workspace.players.whitelist" },
        { id: "bans", labelKey: "server.workspace.players.bans" },
      ],
    },
    {
      id: "content",
      icon: Package,
      labelKey: "server.workspace.content",
      defaultView: "installed",
      views: [
        { id: "installed", labelKey: "server.workspace.content.installed" },
        { id: "updates", labelKey: "server.workspace.content.updates" },
        { id: "browse", labelKey: "server.workspace.content.browse" },
      ],
    },
    {
      id: "data",
      icon: Archive,
      labelKey: "server.workspace.data",
      defaultView: "backups",
      views: [
        { id: "backups", labelKey: "server.workspace.data.backups" },
        { id: "files", labelKey: "server.workspace.data.files" },
      ],
    },
    {
      id: "automation",
      icon: Bot,
      labelKey: "server.workspace.automation",
    },
    {
      id: "settings",
      icon: Settings,
      labelKey: "server.workspace.settings",
      defaultView: "general",
      /* Version upgrade moved to the header's more menu — it is a rare, risky
         operation, not somewhere to browse to. Content update policy moved next
         to the updates it governs, under Content. */
      views: [
        { id: "general", labelKey: "server.workspace.settings.general" },
        { id: "properties", labelKey: "server.workspace.settings.properties" },
        { id: "network", labelKey: "server.workspace.settings.network" },
      ],
    },
  ] as const;

export function workspaceDefinition(
  section: ServerWorkspaceSection,
): ServerWorkspaceDefinition {
  return (
    serverWorkspaceDefinitions.find(
      (definition) => definition.id === section,
    ) ?? serverWorkspaceDefinitions[0]
  );
}

export function normalizeWorkspaceView(
  section: ServerWorkspaceSection,
  requestedView?: string,
) {
  const definition = workspaceDefinition(section);
  if (!definition.views) return undefined;
  return definition.views.some((view) => view.id === requestedView)
    ? requestedView
    : definition.defaultView;
}
