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
import { queryKeys } from "../../lib/query-keys";
import { listJavaRuntimes } from "../java/javaApi";
import { javaDiagnosis } from "../java/javaDiagnosis";
import { useJavaProvisioning } from "../java/useJavaProvisioning";
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
  /* The checklist knows Java is wrong; only the scan knows why and what fixes
     it. Reading it here is what turns "select a compatible runtime" — which is
     where users got stuck — into a button that selects one. */
  const javaQuery = useQuery({
    queryKey: queryKeys.java.runtimes,
    queryFn: listJavaRuntimes,
  });
  const javaState =
    javaQuery.data?.compatibility.find((item) => item.serverId === server.id) ??
    null;
  const {
    apply,
    applyError,
    busy: javaBusy,
    dialog: javaInstallDialog,
    start: startJavaInstall,
  } = useJavaProvisioning({
    onFinished: async () => {
      await setupQuery.refetch();
    },
    serverNameFor: () => server.name,
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
                const isJavaProblem =
                  check.id === "java" && check.status !== "ready";
                /* A runtime already on this machine that fits this server. The
                   backend picks it, so "use it" is one press and no reading. */
                const usable = isJavaProblem
                  ? (javaState?.recommendedJavaPath ?? null)
                  : null;
                const required = javaState?.requiredMajorVersion;
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
                      {/* The generic line says to select a compatible runtime;
                          the scan says which one and why the current one is
                          not. Prefer the sentence that names the problem. */}
                      <p>
                        {isJavaProblem && javaState
                          ? javaDiagnosis(javaState, t)
                          : t(checkMessageKey(check))}
                      </p>
                      {isJavaProblem && javaState?.configuredJavaPath ? (
                        <small className="java-runtime-path">
                          {javaState.configuredJavaPath}
                        </small>
                      ) : null}
                      {isJavaProblem ? (
                        <div className="server-setup-check-actions">
                          {usable ? (
                            <Button
                              disabled={javaBusy}
                              variant="primary"
                              onClick={() => apply(server.id, usable)}
                            >
                              <Coffee aria-hidden="true" size={15} />
                              {t("java.action.use", {
                                version: required ?? "",
                              })}
                            </Button>
                          ) : typeof required === "number" ? (
                            <Button
                              disabled={javaBusy}
                              variant="primary"
                              onClick={() =>
                                startJavaInstall({
                                  majorVersion: required,
                                  maxMajorVersion:
                                    javaState?.maxMajorVersion ?? null,
                                  serverId: server.id,
                                })
                              }
                            >
                              <Coffee aria-hidden="true" size={15} />
                              {t("java.action.install", { version: required })}
                            </Button>
                          ) : null}
                          {onOpenJava ? (
                            <Button variant="secondary" onClick={onOpenJava}>
                              {t("server.setupChecklist.openJava")}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                      {isJavaProblem && applyError ? (
                        <span className="danger-text" role="alert">
                          {applyError}
                        </span>
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
      {javaInstallDialog}
    </section>
  );
}
