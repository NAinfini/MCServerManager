import { useMemo, useState } from "react";
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
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
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

interface GroupedLogEntry {
  count: number;
  entry: AppLogEntry;
  key: string;
}

function groupLogs(logs: AppLogEntry[]): GroupedLogEntry[] {
  const groups = new Map<string, GroupedLogEntry>();
  for (const entry of logs) {
    const key = JSON.stringify([
      entry.level,
      entry.source,
      entry.message,
      entry.details ?? "",
    ]);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { count: 1, entry, key });
    }
  }
  return [...groups.values()];
}

export function AppLoggerView() {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [level, setLevel] = useState<AppLogLevelFilter>("all");
  const [selectedLogKey, setSelectedLogKey] = useState<string | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const logsQuery = useQuery({
    queryKey: ["appLogs", level],
    queryFn: () => listAppLogs(level),
    refetchInterval: 5000,
  });
  const clearMutation = useMutation({
    mutationFn: clearAppLogs,
    onSuccess: () => {
      setIsClearConfirmOpen(false);
      queryClient.setQueryData(["appLogs", level], []);
      void queryClient.invalidateQueries({ queryKey: ["appLogs"] });
    },
  });
  const logs = logsQuery.data ?? [];
  const groupedLogs = useMemo(() => groupLogs(logs), [logs]);
  const selectedGroup =
    groupedLogs.find((group) => group.key === selectedLogKey) ??
    groupedLogs[0] ??
    null;

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
            onClick={() => {
              clearMutation.reset();
              setIsClearConfirmOpen(true);
            }}
          >
            <Trash2 aria-hidden="true" size={15} />
            {t("logger.clear")}
          </Button>
        </div>
      </div>
      <ConfirmDangerDialog
        confirmLabel={t("danger.labels.clearLogs")}
        description={t("danger.logger.clear.description")}
        error={clearMutation.error?.message ?? null}
        isConfirming={clearMutation.isPending}
        isOpen={isClearConfirmOpen}
        title={t("danger.logger.clear.title")}
        onCancel={() => setIsClearConfirmOpen(false)}
        onConfirm={() => clearMutation.mutate()}
      />

      <div className="logger-toolbar">
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

      {!logsQuery.error && logsQuery.data ? (
        <div
          className={`app-log-workspace${
            selectedGroup ? "" : " app-log-workspace-empty"
          }`}
        >
          <aside className="logger-filter-rail">
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
          </aside>
          <div
            aria-label={t("logger.list")}
            className="app-log-list"
            role="list"
          >
            {groupedLogs.length === 0 ? (
              <EmptyState
                illustration="/illustrations/no-events.png"
                title={t("logger.empty.title")}
                description={t("logger.empty.description")}
              />
            ) : null}
            {groupedLogs.map((group) => {
              const { entry } = group;
              const normalizedLevel = levelLabel(group.entry);
              const isSelected = group.key === selectedGroup?.key;
              return (
                <div key={group.key} role="listitem">
                  <button
                    aria-pressed={isSelected}
                    className={`app-log-row app-log-row-${normalizedLevel}${
                      isSelected ? " app-log-row-selected" : ""
                    }`}
                    type="button"
                    onClick={() => setSelectedLogKey(group.key)}
                  >
                    <div
                      className={`app-log-icon app-log-icon-${normalizedLevel}`}
                    >
                      <LogLevelIcon level={normalizedLevel} />
                    </div>
                    <div className="app-log-content">
                      <div className="app-log-heading">
                        <strong>{entry.message || t("logger.untitled")}</strong>
                        {group.count > 1 ? (
                          <span className="app-log-repeat-count">
                            ×{group.count}
                          </span>
                        ) : null}
                      </div>
                      <div className="app-log-meta">
                        <span>{entry.source}</span>
                        <span>{formatDateTime(entry.createdAt)}</span>
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
          {selectedGroup ? (
            <aside
              aria-label={t("logger.details")}
              className="app-log-detail-pane"
            >
              <div className="app-log-detail-heading">
                <strong>{t("logger.details")}</strong>
                <span
                  className={`badge badge-${levelLabel(selectedGroup.entry)}`}
                >
                  {t(`logger.level.${levelLabel(selectedGroup.entry)}`)}
                </span>
              </div>
              <dl className="app-log-detail-meta">
                <div>
                  <dt>{t("logger.source")}</dt>
                  <dd>{selectedGroup.entry.source}</dd>
                </div>
                <div>
                  <dt>{t("logger.time")}</dt>
                  <dd>{formatDateTime(selectedGroup.entry.createdAt)}</dd>
                </div>
              </dl>
              {selectedGroup.count > 1 ? (
                <p className="app-log-repeat-summary">
                  {t("logger.repeated", { count: selectedGroup.count })}
                </p>
              ) : null}
              <pre className="app-log-details">
                {selectedGroup.entry.details || t("logger.noDetails")}
              </pre>
            </aside>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
