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

export function ServerEventsView({ serverId }: { serverId: string }) {
  const { language, t } = useAppSettings();
  const eventsQuery = useQuery({
    queryKey: processKeys.events(serverId),
    queryFn: () => listProcessEvents(serverId),
  });

  if (eventsQuery.isLoading) {
    return <LoadingState message={t("common.loadingPanel")} />;
  }
  if (eventsQuery.error) {
    return (
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
    );
  }

  const events = eventsQuery.data ?? [];
  if (events.length === 0) {
    return (
      <EmptyState
        description={t("activity.noEvents")}
        title={t("server.workspace.monitor.events")}
      />
    );
  }

  return (
    <section
      aria-label={t("server.workspace.monitor.events")}
      className="workspace-event-log"
    >
      <header className="workspace-section-heading">
        <div>
          <h2>{t("server.workspace.monitor.events")}</h2>
          <p>{t("server.workspace.monitor.eventsDescription")}</p>
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
      <div className="workspace-event-list">
        {events.map((event) => (
          <article className="workspace-event-row" key={event.id}>
            <span
              aria-hidden="true"
              className={`activity-event-dot activity-event-dot-${event.level}`}
            />
            <time dateTime={event.createdAt}>
              {formatDateTime(event.createdAt, language)}
            </time>
            <span>{formatProcessEventMessage(event.message, t)}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
