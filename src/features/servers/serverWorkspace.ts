import {
  Activity,
  Archive,
  Bot,
  Gauge,
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

export const serverWorkspaceDefinitions: readonly ServerWorkspaceDefinition[] = [
  {
    id: "overview",
    icon: Activity,
    labelKey: "server.workspace.overview",
  },
  {
    id: "console",
    icon: Terminal,
    labelKey: "server.workspace.console",
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
    id: "monitor",
    icon: Gauge,
    labelKey: "server.workspace.monitor",
    defaultView: "performance",
    views: [
      { id: "performance", labelKey: "server.workspace.monitor.performance" },
      { id: "logs", labelKey: "server.workspace.monitor.logs" },
      { id: "events", labelKey: "server.workspace.monitor.events" },
      { id: "diagnostics", labelKey: "server.workspace.monitor.diagnostics" },
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
    views: [
      { id: "general", labelKey: "server.workspace.settings.general" },
      { id: "properties", labelKey: "server.workspace.settings.properties" },
      { id: "network", labelKey: "server.workspace.settings.network" },
      { id: "updates", labelKey: "server.workspace.settings.updates" },
      { id: "transfer", labelKey: "server.workspace.settings.transfer" },
    ],
  },
] as const;

export function workspaceDefinition(
  section: ServerWorkspaceSection,
): ServerWorkspaceDefinition {
  return (
    serverWorkspaceDefinitions.find((definition) => definition.id === section) ??
    serverWorkspaceDefinitions[0]
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
