import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import type { ServerProfile } from "../servers/types";
import { listServerLogs, readServerLog } from "./logApi";

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function ServerLogsView({ server }: { server: ServerProfile }) {
  const { t } = useAppSettings();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const logsQuery = useQuery({
    queryKey: ["serverLogs", server.id],
    queryFn: () => listServerLogs(server.id),
    refetchInterval: 10_000,
  });
  const logs = logsQuery.data?.logs ?? [];
  const selectedLog = logs.find((log) => log.relativePath === selectedPath);
  const contentQuery = useQuery({
    queryKey: ["serverLogContent", server.id, selectedPath],
    queryFn: () => readServerLog(server.id, selectedPath ?? ""),
    enabled: Boolean(selectedPath),
  });

  useEffect(() => {
    if (!selectedPath && logs.length > 0) {
      setSelectedPath(logs[0].relativePath);
    }
  }, [logs, selectedPath]);

  return (
    <section className="logs-panel" aria-label={t("logs.aria")}>
      <div className="section-heading">
        <div>
          <h2>{t("logs.title")}</h2>
          <span>{t("logs.description")}</span>
        </div>
        <Button
          disabled={logsQuery.isFetching}
          variant="secondary"
          onClick={() => logsQuery.refetch()}
        >
          <RefreshCw aria-hidden="true" size={15} />
          {t("common.refresh")}
        </Button>
      </div>

      {logsQuery.isLoading ? <LoadingState message={t("logs.loading")} /> : null}

      {logsQuery.error ? (
        <div className="list-state list-state-error">
          <strong>{t("logs.loadError.title")}</strong>
          <span>{logsQuery.error.message}</span>
        </div>
      ) : null}

      {!logsQuery.isLoading && !logsQuery.error && logs.length === 0 ? (
        <EmptyState
          illustration="/illustrations/no-events.png"
          title={t("logs.empty.title")}
          description={t("logs.empty.description")}
        />
      ) : null}

      {logs.length > 0 ? (
        <div className="logs-layout">
          <div className="logs-list" aria-label={t("logs.filesAria")}>
            {logs.map((log) => (
              <button
                className={
                  selectedPath === log.relativePath
                    ? "log-row log-row-selected"
                    : "log-row"
                }
                key={log.relativePath}
                type="button"
                onClick={() => setSelectedPath(log.relativePath)}
              >
                <FileText aria-hidden="true" size={15} />
                <span>
                  <strong>{log.fileName}</strong>
                  <small>
                    {formatBytes(log.sizeBytes)} - {formatDateTime(log.modifiedAt)}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <div className="log-reader">
            {contentQuery.isLoading ? (
              <LoadingState message={t("logs.opening")} />
            ) : null}
            {contentQuery.error ? (
              <div className="list-state list-state-error">
                <strong>{t("logs.openError.title")}</strong>
                <span>{contentQuery.error.message}</span>
              </div>
            ) : null}
            {!contentQuery.isLoading && !contentQuery.error ? (
              <pre>
                {contentQuery.data?.content ||
                  (selectedLog ? t("logs.emptyFile") : "")}
              </pre>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
