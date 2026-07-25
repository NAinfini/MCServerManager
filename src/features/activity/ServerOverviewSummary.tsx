import { useQuery } from "@tanstack/react-query";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAppSettings } from "../../i18n";
import { formatDate, formatDateTime } from "../../lib/date-format";
import { listProcessEvents, type ProcessEvent } from "../process/api";
import { formatProcessEventMessage } from "../process/eventMessage";
import { processKeys } from "../process/queries";
import type { ServerProfile } from "../../domain/server";

function eventSeverity(event: ProcessEvent): "info" | "warning" | "error" {
  if (event.level === "error") return "error";
  if (event.level === "warning") return "warning";
  return "info";
}

function RecentActivityTimeline({ serverId }: { serverId: string }) {
  const { language, t } = useAppSettings();
  const eventsQuery = useQuery({
    queryKey: processKeys.events(serverId),
    queryFn: () => listProcessEvents(serverId),
  });

  const events = (eventsQuery.data ?? []).slice(0, 10);

  if (eventsQuery.error) {
    return (
      <div
        aria-label={t("activity.loadError")}
        className="list-state list-state-error"
        role="alert"
      >
        <strong>{t("activity.loadError")}</strong>
        <span>{eventsQuery.error.message}</span>
        <Button
          disabled={eventsQuery.isFetching}
          variant="secondary"
          onClick={() => eventsQuery.refetch()}
        >
          <RefreshCw aria-hidden="true" size={15} />
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <p className="activity-event activity-event-empty">
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
              {formatDateTime(event.createdAt, language)}
            </span>
            <span>{formatProcessEventMessage(event.message, t)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ServerOverviewSummary({
  server,
  onViewAllActivity,
}: {
  server: ServerProfile;
  onViewAllActivity: () => void;
}) {
  const { language, t } = useAppSettings();

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
          <strong>{formatDate(server.updatedAt, language)}</strong>
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
