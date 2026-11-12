import type { PixelIconName } from "../../components/ui/pixel-icon";
import type { ServerWorkspaceSection } from "../../app/router";

export interface ServerWorkspaceView {
  id: string;
  labelKey: string;
}

export interface ServerWorkspaceDefinition {
  id: ServerWorkspaceSection;
  icon: PixelIconName;
  labelKey: string;
  defaultView?: string;
  views?: readonly ServerWorkspaceView[];
}

export const serverWorkspaceDefinitions: readonly ServerWorkspaceDefinition[] =
  [
    {
      /* The default tab: someone watching a running server wants the output.
         Performance history, diagnostics and events answer the follow-up
         question, so they sit one click away instead of on their own page. */
      id: "console",
      icon: "console",
      labelKey: "server.workspace.console",
      defaultView: "terminal",
      views: [
        { id: "terminal", labelKey: "server.workspace.console.terminal" },
        { id: "logs", labelKey: "server.workspace.console.logs" },
        { id: "health", labelKey: "server.workspace.console.health" },
      ],
    },
    {
      id: "players",
      icon: "players",
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
      icon: "mods",
      labelKey: "server.workspace.content",
      defaultView: "installed",
      views: [
        { id: "installed", labelKey: "server.workspace.content.installed" },
        { id: "updates", labelKey: "server.workspace.content.updates" },
        { id: "browse", labelKey: "server.workspace.content.browse" },
      ],
    },
    {
      id: "backups",
      icon: "chest",
      labelKey: "server.workspace.backups",
    },
    {
      id: "files",
      icon: "files",
      labelKey: "server.workspace.files",
    },
    {
      id: "automation",
      icon: "redstone",
      labelKey: "server.workspace.automation",
    },
    {
      id: "settings",
      icon: "gear",
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
