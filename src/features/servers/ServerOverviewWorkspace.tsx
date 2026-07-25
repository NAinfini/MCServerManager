import { Archive, Package, Users } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAppSettings } from "../../i18n";
import { ServerOverviewSummary } from "../activity/ServerOverviewSummary";
import type { ServerWorkspaceSection } from "../../app/router";
import { ServerSetupChecklist } from "./ServerSetupChecklist";
import type { ServerProfile } from "./types";

export function ServerOverviewWorkspace({
  server,
  onNavigate,
  onOpenJava,
}: {
  server: ServerProfile;
  onNavigate: (section: ServerWorkspaceSection, view?: string) => void;
  onOpenJava?: () => void;
}) {
  const { t } = useAppSettings();

  return (
    <div className="server-overview-workspace">
      <ServerSetupChecklist server={server} onOpenJava={onOpenJava} />
      <div className="server-overview-grid">
        <ServerOverviewSummary
          server={server}
          onViewAllActivity={() => onNavigate("monitor", "events")}
        />
        <nav
          aria-label={t("server.workspace.quickLinks")}
          className="server-overview-quick-links"
        >
          <Button variant="secondary" onClick={() => onNavigate("players", "online")}>
            <Users aria-hidden="true" size={16} />
            <span>
              <strong>{t("server.workspace.players")}</strong>
              <small>{t("server.workspace.quick.players")}</small>
            </span>
          </Button>
          <Button variant="secondary" onClick={() => onNavigate("content", "installed")}>
            <Package aria-hidden="true" size={16} />
            <span>
              <strong>{t("server.workspace.content")}</strong>
              <small>{t("server.workspace.quick.content")}</small>
            </span>
          </Button>
          <Button variant="secondary" onClick={() => onNavigate("data", "backups")}>
            <Archive aria-hidden="true" size={16} />
            <span>
              <strong>{t("server.workspace.data")}</strong>
              <small>{t("server.workspace.quick.backups")}</small>
            </span>
          </Button>
        </nav>
      </div>
    </div>
  );
}
