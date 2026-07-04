import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  BarChart3,
  ScrollText,
  CalendarClock,
  ChevronRight,
} from "lucide-react";
import { useAppSettings } from "../../i18n";
import { formatDate, formatDateTime } from "../../lib/date-format";
import { listProcessEvents, type ProcessEvent } from "../process/api";
import { PlayersView } from "../players/PlayersView";
import { PerformanceHistoryView } from "../performance/PerformanceHistoryView";
import { ServerLogsView } from "../logs/ServerLogsView";
import { ScheduledTasksView } from "../tasks/ScheduledTasksView";
import type { ServerProfile } from "../servers/types";

type ActivitySubTab = "overview" | "players" | "performance" | "logs" | "tasks";

const subTabs: Array<{
  id: ActivitySubTab;
  labelKey: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", labelKey: "activity.overview", icon: LayoutDashboard },
  { id: "players", labelKey: "activity.players", icon: Users },
  { id: "performance", labelKey: "activity.performance", icon: BarChart3 },
  { id: "logs", labelKey: "activity.logs", icon: ScrollText },
  { id: "tasks", labelKey: "activity.tasks", icon: CalendarClock },
];

function eventSeverity(event: ProcessEvent): "info" | "warning" | "error" {
  if (event.level === "error") return "error";
  if (event.level === "warning") return "warning";
  return "info";
}

function RecentActivityTimeline({ serverId }: { serverId: string }) {
  const { t } = useAppSettings();
  const eventsQuery = useQuery({
    queryKey: ["processEvents", serverId],
    queryFn: () => listProcessEvents(serverId),
    refetchInterval: 10_000,
  });

  const events = (eventsQuery.data ?? []).slice(0, 10);

  if (events.length === 0) {
    return (
      <p className="activity-event" style={{ color: "var(--text-muted)" }}>
        {t("activity.noEvents")}
      </p>
    );
  }

  return (
    <div className="activity-recent">
      {events.map((event) => {
        const severity = eventSeverity(event);
        return (
          <div className="activity-event" key={event.id}>
            <span className={`activity-event-dot activity-event-dot-${severity}`} />
            <span className="activity-event-time">
              {formatDateTime(event.createdAt)}
            </span>
            <span>{event.message}</span>
          </div>
        );
      })}
    </div>
  );
}

function OverviewPanel({
  server,
  onViewAllActivity,
}: {
  server: ServerProfile;
  onViewAllActivity: () => void;
}) {
  const { t } = useAppSettings();

  return (
    <div className="activity-overview">
      <div className="update-status-grid">
        <div>
          <span>{t("server.overview.rootFolder")}</span>
          <strong>{server.rootDir}</strong>
        </div>
        <div>
          <span>{t("server.overview.restartPolicy")}</span>
          <strong>
            {server.restartPolicy.enabled
              ? t("server.overview.restartOnCrash", {
                  attempts: server.restartPolicy.maxAttempts,
                })
              : t("server.overview.restartDisabled")}
          </strong>
        </div>
        <div>
          <span>{t("server.overview.autoStart")}</span>
          <strong>
            {server.autoStart
              ? t("server.overview.enabled")
              : t("server.overview.disabled")}
          </strong>
        </div>
        <div>
          <span>{t("server.overview.lastUpdated")}</span>
          <strong>{formatDate(server.updatedAt)}</strong>
        </div>
      </div>

      <section className="activity-recent-section">
        <div className="activity-recent-header">
          <h3>{t("activity.recent")}</h3>
          <button
            className="button-link"
            type="button"
            onClick={onViewAllActivity}
          >
            {t("activity.viewAll")}
            <ChevronRight aria-hidden="true" size={12} />
          </button>
        </div>
        <RecentActivityTimeline serverId={server.id} />
      </section>
    </div>
  );
}

export function ServerActivityView({ server }: { server: ServerProfile }) {
  const { t } = useAppSettings();
  const [activeSubTab, setActiveSubTab] = useState<ActivitySubTab>("overview");

  return (
    <Tabs.Root
      value={activeSubTab}
      onValueChange={(value) => setActiveSubTab(value as ActivitySubTab)}
    >
      <Tabs.List className="activity-sub-tabs" aria-label={t("activity.overview")}>
        {subTabs.map((tab) => (
          <Tabs.Trigger key={tab.id} value={tab.id}>
            <tab.icon aria-hidden="true" size={12} />
            <span>{t(tab.labelKey)}</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      <Tabs.Content value="overview">
        <OverviewPanel
          server={server}
          onViewAllActivity={() => setActiveSubTab("logs")}
        />
      </Tabs.Content>
      <Tabs.Content value="players">
        <PlayersView server={server} />
      </Tabs.Content>
      <Tabs.Content value="performance">
        <PerformanceHistoryView server={server} />
      </Tabs.Content>
      <Tabs.Content value="logs">
        <ServerLogsView server={server} />
      </Tabs.Content>
      <Tabs.Content value="tasks">
        <ScheduledTasksView server={server} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
