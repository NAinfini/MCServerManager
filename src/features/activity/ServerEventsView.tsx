import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import { listProcessEvents } from "../process/api";
import { formatProcessEventMessage } from "../process/eventMessage";
import { processKeys } from "../process/queries";

const knownLevels = ["debug", "info", "warning", "error"];

// The dot is decorative, so severity has to reach a screen reader as words.
function severityLabel(level: string) {
  return `logger.severity.${knownLevels.includes(level) ? level : "info"}`;
}

export function ServerEventsView({ serverId }: { serverId: string }) {
  const { language, t } = useAppSettings();
  const eventsQuery = useQuery({
    queryKey: processKeys.events(serverId),
    queryFn: () => listProcessEvents(serverId),
  });

  const events = eventsQuery.data ?? [];

  /* Loading, failing and empty used to replace the whole panel, so on a quiet
     server the timeline vanished heading and all. Now only the body swaps and
     the panel keeps its identity beside the other overview cards. */
  return (
    <section
      aria-label={t("server.events.title")}
      className="workspace-event-log"
    >
      <header className="workspace-section-heading">
        <div>
          <h2>{t("server.events.title")}</h2>
          <p>{t("server.events.description")}</p>
        </div>
        <Button
          disabled={eventsQuery.isFetching}
          variant="secondary"
          onClick={() => void eventsQuery.refetch()}
        >
          <RefreshCw aria-hidden="true" size={15} />
          {t("common.refresh")}
        </Button>
      </header>
      {eventsQuery.isLoading ? (
        <LoadingState message={t("common.loadingPanel")} />
      ) : eventsQuery.error ? (
        <div className="list-state list-state-error" role="alert">
          <strong>{t("activity.loadError")}</strong>
          <span>{eventsQuery.error.message}</span>
          <Button
            disabled={eventsQuery.isFetching}
            variant="secondary"
            onClick={() => void eventsQuery.refetch()}
          >
            <RefreshCw aria-hidden="true" size={15} />
            {t("common.retry")}
          </Button>
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          description={t("activity.noEventsDescription")}
          illustration="/illustrations/no-events.png"
          title={t("activity.noEvents")}
        />
      ) : (
        <div className="workspace-event-list">
          {events.map((event) => (
            <article className="workspace-event-row" key={event.id}>
              <span
                aria-hidden="true"
                className={`activity-event-dot activity-event-dot-${event.level}`}
              />
              <span className="visually-hidden">
                {t(severityLabel(event.level))}
              </span>
              <time dateTime={event.createdAt}>
                {formatDateTime(event.createdAt, language)}
              </time>
              <span>{formatProcessEventMessage(event.message, t)}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
