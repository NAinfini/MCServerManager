import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import {
  clearAppLogs,
  listAppLogs,
  type AppLogEntry,
  type AppLogLevelFilter,
} from "./api";

function LogLevelIcon({ level }: { level: string }) {
  if (level === "error") {
    return <AlertCircle aria-hidden="true" size={14} />;
  }
  if (level === "warning") {
    return <AlertTriangle aria-hidden="true" size={14} />;
  }
  return <Info aria-hidden="true" size={14} />;
}

function levelLabel(entry: AppLogEntry) {
  return ["debug", "info", "warning", "error"].includes(entry.level)
    ? entry.level
    : "info";
}

export function AppLoggerView() {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [level, setLevel] = useState<AppLogLevelFilter>("all");
  const logsQuery = useQuery({
    queryKey: ["appLogs", level],
    queryFn: () => listAppLogs(level),
    refetchInterval: 5000,
  });
  const clearMutation = useMutation({
    mutationFn: clearAppLogs,
    onSuccess: () => {
      queryClient.setQueryData(["appLogs", level], []);
      void queryClient.invalidateQueries({ queryKey: ["appLogs"] });
    },
  });
  const logs = logsQuery.data ?? [];

  return (
    <section className="logger-page" aria-labelledby="logger-title">
      <div className="page-header">
        <div>
          <p className="eyebrow">{t("logger.eyebrow")}</p>
          <h1 id="logger-title">{t("logger.title")}</h1>
        </div>
        <div className="page-header-actions">
          <Button
            disabled={logsQuery.isFetching}
            variant="secondary"
            onClick={() => logsQuery.refetch()}
          >
            <RefreshCw aria-hidden="true" size={15} />
            {t("common.refresh")}
          </Button>
          <Button
            disabled={clearMutation.isPending}
            variant="danger"
            onClick={() => clearMutation.mutate()}
          >
            <Trash2 aria-hidden="true" size={15} />
            {t("logger.clear")}
          </Button>
        </div>
      </div>

      <div className="logger-toolbar">
        <ToggleGroup.Root
          className="severity-filter"
          type="single"
          value={level}
          onValueChange={(value) => {
            if (value) {
              setLevel(value as AppLogLevelFilter);
            }
          }}
          aria-label={t("logger.filterLevel")}
        >
          <ToggleGroup.Item className="severity-filter-item" value="all">
            {t("logger.level.all")}
          </ToggleGroup.Item>
          <ToggleGroup.Item className="severity-filter-item" value="info">
            <Info aria-hidden="true" size={14} />
            {t("logger.level.info")}
          </ToggleGroup.Item>
          <ToggleGroup.Item className="severity-filter-item" value="debug">
            <Info aria-hidden="true" size={14} />
            {t("logger.level.debug")}
          </ToggleGroup.Item>
          <ToggleGroup.Item className="severity-filter-item" value="warning">
            <AlertTriangle aria-hidden="true" size={14} />
            {t("logger.level.warning")}
          </ToggleGroup.Item>
          <ToggleGroup.Item className="severity-filter-item" value="error">
            <AlertCircle aria-hidden="true" size={14} />
            {t("logger.level.error")}
          </ToggleGroup.Item>
        </ToggleGroup.Root>
        <span className="logger-count">
          {t("logger.count", { count: logs.length })}
        </span>
      </div>

      {logsQuery.error ? (
        <div className="list-state list-state-error">
          <strong>{t("logger.loadError")}</strong>
          <span>{logsQuery.error.message}</span>
          <Button variant="secondary" onClick={() => logsQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

      {!logsQuery.error && logs.length === 0 ? (
        <EmptyState
          illustration="/illustrations/no-events.png"
          title={t("logger.empty.title")}
          description={t("logger.empty.description")}
        />
      ) : null}

      {logs.length > 0 ? (
        <div className="app-log-list" role="list">
          {logs.map((entry) => {
            const normalizedLevel = levelLabel(entry);
            return (
              <article
                className={`app-log-row app-log-row-${normalizedLevel}`}
                key={entry.id}
                role="listitem"
              >
                <div className={`app-log-icon app-log-icon-${normalizedLevel}`}>
                  <LogLevelIcon level={normalizedLevel} />
                </div>
                <div className="app-log-content">
                  <div className="app-log-heading">
                    <strong>{entry.message || t("logger.untitled")}</strong>
                    <span className={`badge badge-${normalizedLevel}`}>
                      {t(`logger.level.${normalizedLevel}`)}
                    </span>
                  </div>
                  <div className="app-log-meta">
                    <span>{entry.source}</span>
                    <span>{formatDateTime(entry.createdAt)}</span>
                  </div>
                  {entry.details ? (
                    <pre className="app-log-details">{entry.details}</pre>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
