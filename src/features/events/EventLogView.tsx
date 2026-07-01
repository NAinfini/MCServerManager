import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import * as Separator from "@radix-ui/react-separator";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { RefreshCw, Info, AlertTriangle, AlertCircle, Search } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";

interface NotificationEvent {
  id: string;
  serverId?: string | null;
  kind: string;
  severity: "info" | "warning" | "error" | string;
  title: string;
  message: string;
  desktopDelivered: number;
  createdAt: string;
}

type SeverityFilter = "all" | "info" | "warning" | "error";

async function listNotificationEvents() {
  return invokeDesktopCommandWithErrorHandling<NotificationEvent[]>(
    "list_notification_events",
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case "warning":
      return <AlertTriangle aria-hidden="true" size={14} />;
    case "error":
      return <AlertCircle aria-hidden="true" size={14} />;
    default:
      return <Info aria-hidden="true" size={14} />;
  }
}

export function EventLogView() {
  const { t } = useAppSettings();
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [visibleCount, setVisibleCount] = useState(50);

  const eventsQuery = useQuery({
    queryKey: ["notificationEvents"],
    queryFn: listNotificationEvents,
    refetchInterval: 5000,
  });
  const events = eventsQuery.data ?? [];

  const filteredEvents = useMemo(() => {
    let result = events;
    if (severityFilter !== "all") {
      result = result.filter((e) => e.severity === severityFilter);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(term) ||
          e.message.toLowerCase().includes(term) ||
          e.kind.toLowerCase().includes(term),
      );
    }
    return result;
  }, [events, severityFilter, searchTerm]);

  const visibleEvents = filteredEvents.slice(0, visibleCount);
  const hasMore = filteredEvents.length > visibleCount;

  return (
    <section className="settings-page" aria-labelledby="events-title">
      <div className="page-header">
        <div>
          <p className="eyebrow">{t("events.eyebrow")}</p>
          <h1 id="events-title">{t("events.title")}</h1>
        </div>
        <Button
          disabled={eventsQuery.isFetching}
          variant="secondary"
          onClick={() => eventsQuery.refetch()}
        >
          <RefreshCw aria-hidden="true" size={15} />
          {t("common.refresh")}
        </Button>
      </div>

      {eventsQuery.error ? (
        <div className="list-state list-state-error">
          <strong>{t("events.loadError.title")}</strong>
          <span>{eventsQuery.error.message}</span>
          <Button variant="secondary" onClick={() => eventsQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

      {!eventsQuery.error && events.length === 0 ? (
        <EmptyState
          illustration="/illustrations/no-events.png"
          title={t("events.empty.title")}
          description={t("events.empty.description")}
        />
      ) : null}

      {events.length > 0 ? (
        <>
          <div className="events-toolbar">
            <ToggleGroup.Root
              className="severity-filter"
              type="single"
              value={severityFilter}
              onValueChange={(value) => {
                if (value) {
                  setSeverityFilter(value as SeverityFilter);
                  setVisibleCount(50);
                }
              }}
              aria-label={t("events.filterSeverity")}
            >
              <ToggleGroup.Item className="severity-filter-item" value="all">
                {t("events.severity.all")}
              </ToggleGroup.Item>
              <ToggleGroup.Item className="severity-filter-item" value="info">
                <Info aria-hidden="true" size={14} />
                {t("events.severity.info")}
              </ToggleGroup.Item>
              <ToggleGroup.Item className="severity-filter-item" value="warning">
                <AlertTriangle aria-hidden="true" size={14} />
                {t("events.severity.warning")}
              </ToggleGroup.Item>
              <ToggleGroup.Item className="severity-filter-item" value="error">
                <AlertCircle aria-hidden="true" size={14} />
                {t("events.severity.error")}
              </ToggleGroup.Item>
            </ToggleGroup.Root>
            <div className="events-search">
              <Search aria-hidden="true" size={14} />
              <TextField
                placeholder={t("events.search.placeholder")}
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setVisibleCount(50);
                }}
              />
            </div>
          </div>

          <Separator.Root className="separator" />

          <p className="events-count">
            {t("events.showing", {
              shown: String(visibleEvents.length),
              total: String(filteredEvents.length),
            })}
          </p>

          <div className="timeline">
            {visibleEvents.map((event) => (
              <div className="timeline-item" key={event.id}>
                <div
                  className={`timeline-dot timeline-dot-${event.severity === "warning" || event.severity === "error" || event.severity === "info" ? event.severity : "info"}`}
                >
                  <SeverityIcon severity={event.severity} />
                </div>
                <div className="timeline-content">
                  <span className="timeline-title">{event.title}</span>
                  <span className="timeline-meta">
                    <span className="badge">{event.kind}</span>
                    {formatDateTime(event.createdAt)}
                  </span>
                  {event.message ? (
                    <span className="timeline-message">{event.message}</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {hasMore ? (
            <Button
              variant="secondary"
              onClick={() => setVisibleCount((c) => c + 50)}
            >
              {t("events.loadMore")}
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
