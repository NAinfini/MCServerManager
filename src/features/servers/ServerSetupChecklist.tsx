import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Coffee,
  RefreshCw,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { getServerSetupStatus, type ServerSetupCheck } from "./setupApi";
import { serverKeys } from "./queries";
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

export function ServerSetupChecklist({
  server,
  onOpenJava,
}: {
  server: ServerProfile;
  onOpenJava?: () => void;
}) {
  const { t } = useAppSettings();
  const setupQuery = useQuery({
    queryKey: serverKeys.setupStatus(server.id),
    queryFn: () => getServerSetupStatus(server.id),
  });
  const checks = setupQuery.data?.checks ?? [];
  const allReady =
    checks.length > 0 && checks.every((check) => check.status === "ready");
  // Only a blocking check keeps the checklist open; a recommendation collapses
  // into the summary line so a healthy server does not bury the overview.
  const blocked = checks.some((check) => check.status === "actionRequired");
  const summaryLine = checks
    .map(
      (check) =>
        `${t(checkLabelKey(check.id))} ${check.status === "ready" ? "✓" : "⚠"}`,
    )
    .join(" · ");

  return (
    <section
      aria-label={t("server.setupChecklist.aria")}
      className="settings-panel server-setup-checklist"
    >
      <details className="server-setup-details" open={blocked}>
        <summary>
          {allReady ? (
            <CheckCircle2 aria-hidden="true" size={16} />
          ) : (
            <CircleAlert aria-hidden="true" size={16} />
          )}
          <span>
            <strong>
              {allReady
                ? t("server.setupChecklist.complete")
                : blocked
                  ? t("server.setupChecklist.title")
                  : t("server.setupChecklist.recommendations")}
            </strong>
            <small>
              {blocked || summaryLine.length === 0
                ? t("server.setupChecklist.description")
                : summaryLine}
            </small>
          </span>
        </summary>
        <div className="server-setup-details-body">
          {setupQuery.isLoading ? (
            <LoadingState message={t("server.setupChecklist.loading")} />
          ) : null}

          {setupQuery.error ? (
            <div
              aria-label={t("server.setupChecklist.loadError")}
              className="list-state list-state-error"
              role="alert"
            >
              <strong>{t("server.setupChecklist.loadError")}</strong>
              <span>{setupQuery.error.message}</span>
              <Button
                disabled={setupQuery.isFetching}
                variant="secondary"
                onClick={() => setupQuery.refetch()}
              >
                <RefreshCw aria-hidden="true" size={15} />
                {t("common.retry")}
              </Button>
            </div>
          ) : null}

          {setupQuery.data ? (
            <div className="server-setup-checks" role="list">
              {setupQuery.data.checks.map((check) => {
                const showJavaAction =
                  check.id === "java" &&
                  check.status === "actionRequired" &&
                  Boolean(onOpenJava);
                return (
                  <article
                    className={`server-setup-check server-setup-check-${check.status}`}
                    key={check.id}
                    role="listitem"
                  >
                    <span className="server-setup-check-icon">
                      <CheckIcon status={check.status} />
                    </span>
                    <div className="server-setup-check-content">
                      <div className="server-setup-check-heading">
                        <strong>{t(checkLabelKey(check.id))}</strong>
                        <span>{t(statusLabelKey(check.status))}</span>
                      </div>
                      <p>{t(checkMessageKey(check))}</p>
                      {showJavaAction ? (
                        <div className="server-setup-check-actions">
                          <Button variant="primary" onClick={onOpenJava}>
                            <Coffee aria-hidden="true" size={15} />
                            {t("server.setupChecklist.openJava")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      </details>
      <Button
        className="server-setup-refresh"
        disabled={setupQuery.isFetching}
        variant="secondary"
        onClick={() => setupQuery.refetch()}
      >
        <RefreshCw aria-hidden="true" size={15} />
        {t("common.refresh")}
      </Button>
    </section>
  );
}
