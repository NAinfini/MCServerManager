import { lazy, Suspense } from "react";
import type { ServerWorkspaceSection } from "../../app/router";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { ServerEventsView } from "../activity/ServerEventsView";
import { PlayersView } from "../players/PlayersView";
import { PerformanceHistoryView } from "../performance/PerformanceHistoryView";
import { ServerLogsView } from "../logs/ServerLogsView";
import { ScheduledTasksView } from "../tasks/ScheduledTasksView";
import { InstalledContentView } from "../content/InstalledContentView";
import { ContentUpdatePolicyView } from "../content/ContentUpdatePolicyView";
import { ServerPropertiesEditor } from "../config/ServerPropertiesEditor";
import { DiagnosticsView } from "../diagnostics/DiagnosticsView";
import { ProfileImportExport } from "../profiles/ProfileImportExport";
import { TunnelProvidersView } from "../tunnels/TunnelProvidersView";
import { ServerUpdatesView } from "../updates/ServerUpdatesView";
import { ServerProfileSettings } from "./ServerProfileSettings";
import { ServerOverviewWorkspace } from "./ServerOverviewWorkspace";
import type { ServerProfile } from "./types";

const ConsoleView = lazy(() =>
  import("../console/ConsoleView").then((module) => ({
    default: module.ConsoleView,
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
const ServerMarketplaceView = lazy(() =>
  import("../marketplace/ServerMarketplaceView").then((module) => ({
    default: module.ServerMarketplaceView,
  })),
);

function PlayerWorkspace({
  server,
  view,
}: {
  server: ServerProfile;
  view: string;
}) {
  const playerView =
    view === "ops" || view === "whitelist" || view === "bans"
      ? view
      : "online";
  return <PlayersView server={server} view={playerView} />;
}

export function ServerWorkspacePanel({
  server,
  section,
  view,
  path,
  onNavigate,
  onOpenJava,
}: {
  server: ServerProfile;
  section: ServerWorkspaceSection;
  view?: string;
  path?: string;
  onNavigate: (
    section: ServerWorkspaceSection,
    view?: string,
    path?: string,
  ) => void;
  onOpenJava?: () => void;
}) {
  const { t } = useAppSettings();
  let panel: React.ReactNode;

  switch (section) {
    case "overview":
      panel = (
        <ServerOverviewWorkspace
          server={server}
          onNavigate={onNavigate}
          onOpenJava={onOpenJava}
        />
      );
      break;
    case "console":
      panel = (
        <ConsoleView
          serverId={server.id}
          onOpenPlayers={() => onNavigate("players", "online")}
        />
      );
      break;
    case "players":
      panel = <PlayerWorkspace server={server} view={view || "online"} />;
      break;
    case "content": {
      panel =
        view === "browse" ? (
          <ServerMarketplaceView server={server} />
        ) : view === "updates" ? (
          <ContentUpdatePolicyView server={server} />
        ) : (
          <InstalledContentView
            server={server}
            onBrowse={() => onNavigate("content", "browse")}
          />
        );
      break;
    }
    case "data":
      panel =
        view === "files" ? (
          <ServerFilesView
            onPathChange={(nextPath) =>
              onNavigate("data", "files", nextPath)
            }
            path={path}
            server={server}
          />
        ) : (
          <ServerBackupsView server={server} />
        );
      break;
    case "monitor":
      if (view === "logs") {
        panel = <ServerLogsView server={server} />;
      } else if (view === "events") {
        panel = <ServerEventsView serverId={server.id} />;
      } else if (view === "diagnostics") {
        panel = <DiagnosticsView server={server} />;
      } else {
        panel = <PerformanceHistoryView server={server} />;
      }
      break;
    case "automation":
      panel = <ScheduledTasksView server={server} />;
      break;
    case "settings": {
      panel = (
        <div className="server-settings settings-sections">
          <section className="settings-section settings-section-active">
            {view === "properties" ? (
              <ServerPropertiesEditor server={server} />
            ) : view === "network" ? (
              <TunnelProvidersView embedded servers={[server]} />
            ) : view === "updates" ? (
              <ServerUpdatesView server={server} />
            ) : view === "transfer" ? (
              <ProfileImportExport server={server} />
            ) : (
              <ServerProfileSettings server={server} />
            )}
          </section>
        </div>
      );
      break;
    }
  }

  return (
    <Suspense fallback={<LoadingState message={t("common.loadingPanel")} />}>
      {panel}
    </Suspense>
  );
}
