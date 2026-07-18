import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { getServerSetupStatus, type ServerSetupCheck } from "./setupApi";
import type { ServerProfile } from "./types";

function statusLabelKey(status: ServerSetupCheck["status"]) {
  if (status === "ready") {
    return "server.setupChecklist.status.ready";
  }
  if (status === "warning") {
    return "server.setupChecklist.status.warning";
  }
  return "server.setupChecklist.status.actionRequired";
}

function checkLabelKey(id: ServerSetupCheck["id"]) {
  const normalizedId = id === "serverJar" ? "serverRuntime" : id;
  return `server.setupChecklist.check.${normalizedId}`;
}

function checkMessageKey(check: ServerSetupCheck) {
  const normalizedId = check.id === "serverJar" ? "serverRuntime" : check.id;
  return `server.setupChecklist.message.${normalizedId}.${check.status}`;
}

function CheckIcon({ status }: { status: ServerSetupCheck["status"] }) {
  if (status === "ready") {
    return <CheckCircle2 aria-hidden="true" size={16} />;
  }
  if (status === "warning") {
    return <AlertTriangle aria-hidden="true" size={16} />;
  }
  return <CircleAlert aria-hidden="true" size={16} />;
}

export function ServerSetupChecklist({ server }: { server: ServerProfile }) {
  const { t } = useAppSettings();
  const setupQuery = useQuery({
    queryKey: ["serverSetupStatus", server.id],
    queryFn: () => getServerSetupStatus(server.id),
    refetchInterval: 10_000,
  });

  return (
    <section
      aria-label={t("server.setupChecklist.aria")}
      className="settings-panel server-setup-checklist"
    >
      <div className="section-heading">
        <div>
          <h2>{t("server.setupChecklist.title")}</h2>
          <span>{t("server.setupChecklist.description")}</span>
        </div>
        <Button
          disabled={setupQuery.isFetching}
          variant="secondary"
          onClick={() => setupQuery.refetch()}
        >
          <RefreshCw aria-hidden="true" size={15} />
          {t("common.refresh")}
        </Button>
      </div>

      {setupQuery.isLoading ? (
        <LoadingState message={t("server.setupChecklist.loading")} />
      ) : null}

      {setupQuery.error ? (
        <div className="list-state list-state-error">
          <strong>{t("server.setupChecklist.loadError")}</strong>
          <span>{setupQuery.error.message}</span>
        </div>
      ) : null}

      {setupQuery.data ? (
        <div className="server-setup-checks" role="list">
          {setupQuery.data.checks.map((check) => (
            <article
              className={`server-setup-check server-setup-check-${check.status}`}
              key={check.id}
              role="listitem"
            >
              <span className="server-setup-check-icon">
                <CheckIcon status={check.status} />
              </span>
              <div>
                <div className="server-setup-check-heading">
                  <strong>{t(checkLabelKey(check.id))}</strong>
                  <span>{t(statusLabelKey(check.status))}</span>
                </div>
                <p>{t(checkMessageKey(check))}</p>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
