import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Coffee, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import {
  installJavaRuntime,
  listJavaRuntimes,
  planJavaRuntime,
  type ManagedJavaPlan,
} from "./javaApi";

function compatibilityClass(status: string) {
  if (status === "compatible") {
    return "java-status-compatible";
  }
  if (status === "warning") {
    return "java-status-warning";
  }
  return "java-status-unknown";
}

function isAdoptiumRuntime(vendor?: string | null) {
  return /adoptium|temurin/i.test(vendor ?? "");
}

function javaDownloadUrl(majorVersion: number) {
  return `https://adoptium.net/temurin/releases/?version=${majorVersion}`;
}

interface JavaRuntimesViewProps {
  embedded?: boolean;
}

export function JavaRuntimesView({ embedded = false }: JavaRuntimesViewProps) {
  const { t } = useAppSettings();
  const [managedPlan, setManagedPlan] = useState<ManagedJavaPlan | null>(null);
  const [managedConsent, setManagedConsent] = useState(false);
  const javaQuery = useQuery({
    queryKey: ["javaRuntimes"],
    queryFn: listJavaRuntimes,
  });
  const managedMajorVersion = Math.max(
    21,
    ...(javaQuery.data?.compatibility
      .map((item) => item.requiredMajorVersion)
      .filter((value): value is number => typeof value === "number") ?? []),
  );
  const planMutation = useMutation({
    mutationFn: () => planJavaRuntime(managedMajorVersion),
    onSuccess: (plan) => {
      setManagedPlan(plan);
      setManagedConsent(false);
    },
  });
  const installMutation = useMutation({
    mutationFn: () => installJavaRuntime(managedPlan!, managedConsent),
    onSuccess: async () => {
      setManagedPlan(null);
      setManagedConsent(false);
      await javaQuery.refetch();
    },
  });

  return (
    <section
      aria-label={embedded ? t("java.title") : undefined}
      aria-labelledby={embedded ? undefined : "java-runtimes-title"}
      className={embedded ? "java-page java-page-embedded" : "java-page"}
    >
      <div className="page-header">
        {!embedded ? (
          <div>
            <p className="eyebrow">{t("java.eyebrow")}</p>
            <h1 id="java-runtimes-title">{t("java.title")}</h1>
          </div>
        ) : (
          <div>
            <p className="eyebrow">{t("java.eyebrow")}</p>
          </div>
        )}
        <div className="page-header-actions">
          <Button
            disabled={javaQuery.isFetching}
            variant="secondary"
            onClick={() => javaQuery.refetch()}
          >
            <RefreshCw aria-hidden="true" size={15} />
            {t("java.scan")}
          </Button>
        </div>
      </div>

      {javaQuery.isLoading ? (
        <LoadingState message={t("java.scanning")} />
      ) : null}

      {javaQuery.error ? (
        <div className="list-state list-state-error">
          <strong>{t("java.scanError.title")}</strong>
          <span>{javaQuery.error.message}</span>
        </div>
      ) : null}

      {javaQuery.data ? (
        <div className="java-layout">
          <section className="java-panel java-panel-managed">
            <div className="section-heading">
              <h2>{t("java.managed.title")}</h2>
              <span>{t("java.managed.subtitle")}</span>
            </div>
            <div className="java-panel-body">
              <p>{t("java.managed.description")}</p>
              <div className="page-header-actions">
                <a
                  href="https://www.java.com/download/"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {t("java.managed.oracleLink")}
                </a>
                <a
                  href={`https://adoptium.net/temurin/releases/?version=${managedMajorVersion}`}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {t("java.managed.temurinLink")}
                </a>
                <Button
                  disabled={planMutation.isPending || installMutation.isPending}
                  type="button"
                  variant="secondary"
                  onClick={() => planMutation.mutate()}
                >
                  {t("java.managed.prepare", { version: managedMajorVersion })}
                </Button>
              </div>
              {planMutation.error ? (
                <p className="danger-text" role="alert">
                  {planMutation.error.message}
                </p>
              ) : null}
              {managedPlan?.action === "reuse" ? (
                <p>{t("java.managed.reuse")}</p>
              ) : null}
              {managedPlan?.action === "install" ? (
                <div className="compatibility-list">
                  <p>
                    {managedPlan.vendor} {managedPlan.version}
                    {" · "}
                    <a
                      href={managedPlan.licenseUrl}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      {t("java.managed.license")}
                    </a>
                  </p>
                  <label className="java-managed-consent">
                    <Checkbox
                      aria-label={t("java.managed.consent")}
                      checked={managedConsent}
                      onCheckedChange={(checked) =>
                        setManagedConsent(checked === true)
                      }
                    />
                    <span>{t("java.managed.consent")}</span>
                  </label>
                  <Button
                    className="java-managed-install"
                    disabled={!managedConsent || installMutation.isPending}
                    type="button"
                    variant="primary"
                    onClick={() => installMutation.mutate()}
                  >
                    {t("java.managed.install")}
                  </Button>
                  {installMutation.error ? (
                    <p className="danger-text" role="alert">
                      {installMutation.error.message}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
          <section className="java-panel java-panel-installed">
            <div className="section-heading">
              <h2>{t("java.installed.title")}</h2>
              <span>
                {t("java.detected", { count: javaQuery.data.runtimes.length })}
              </span>
            </div>
            {javaQuery.data.runtimes.length === 0 ? (
              <EmptyState
                illustration="/illustrations/no-java.png"
                title={t("java.empty.title")}
                description={t("java.empty.description")}
              />
            ) : (
              <div className="java-table-scroll">
                <table className="java-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("java.table.version")}</th>
                      <th scope="col">{t("java.table.vendor")}</th>
                      <th scope="col">{t("java.table.architecture")}</th>
                      <th scope="col">{t("java.table.source")}</th>
                      <th scope="col">{t("java.table.path")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {javaQuery.data.runtimes.map((runtime) => (
                      <tr key={`${runtime.path}-${runtime.version}`}>
                        <th scope="row">
                          <span className="java-runtime-identity">
                            {isAdoptiumRuntime(runtime.vendor) ? (
                              <img
                                alt=""
                                aria-hidden="true"
                                className="provider-icon"
                                src="/brand/adoptium-logo.svg"
                              />
                            ) : (
                              <span className="java-runtime-icon">
                                <Coffee aria-hidden="true" size={14} />
                              </span>
                            )}
                            <span>Java {runtime.majorVersion}</span>
                          </span>
                        </th>
                        <td>{runtime.vendor ?? t("common.unknown")}</td>
                        <td>{runtime.architecture ?? t("common.unknown")}</td>
                        <td>
                          <span className="java-source-chip">
                            {runtime.source}
                          </span>
                        </td>
                        <td className="path-cell">{runtime.path}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="java-panel java-panel-compatibility">
            <div className="section-heading">
              <h2>{t("java.compatibility.title")}</h2>
              <span>{t("java.compatibility.subtitle")}</span>
            </div>
            <div className="compatibility-list">
              {javaQuery.data.compatibility.map((item) => {
                const Icon =
                  item.status === "compatible" ? CheckCircle2 : AlertTriangle;
                const requiredMajorVersion =
                  typeof item.requiredMajorVersion === "number"
                    ? item.requiredMajorVersion
                    : null;
                return (
                  <div className="compatibility-row" key={item.serverId}>
                    <Icon
                      aria-hidden="true"
                      className={compatibilityClass(item.status)}
                      size={17}
                    />
                    <div>
                      <strong>{item.serverName}</strong>
                      <span>{item.message}</span>
                    </div>
                    {requiredMajorVersion !== null ? (
                      <div className="java-recommendation">
                        <span>{t("java.compatibility.recommended")}</span>
                        <a
                          href={javaDownloadUrl(requiredMajorVersion)}
                          rel="noreferrer noopener"
                          target="_blank"
                        >
                          Java {requiredMajorVersion}
                        </a>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {javaQuery.data.compatibility.length === 0 ? (
                <EmptyState
                  title={t("java.compatibility.empty.title")}
                  description={t("java.compatibility.empty.description")}
                />
              ) : null}
            </div>
          </section>

          {javaQuery.data.failures.length > 0 ? (
            <section className="java-panel java-panel-failures">
              <div className="section-heading">
                <h2>{t("java.failures.title")}</h2>
                <span>
                  {t("java.failures.count", {
                    count: javaQuery.data.failures.length,
                  })}
                </span>
              </div>
              <div className="failure-list">
                {javaQuery.data.failures.map((failure) => (
                  <div
                    className="failure-row"
                    key={`${failure.path}-${failure.source}`}
                  >
                    <strong>{failure.source}</strong>
                    <span>{failure.path}</span>
                    <small>{failure.error}</small>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
