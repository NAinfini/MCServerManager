import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Coffee,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useAppSettings } from "../../i18n";
import { toAppHash } from "../../app/router";
import { queryKeys } from "../../lib/query-keys";
import { publicAssetUrl } from "../../lib/public-asset";
import {
  DataTable,
  type DataTableColumn,
} from "../../components/data/DataTable";
import {
  listJavaRuntimes,
  removeJavaRuntime,
  type JavaRuntime,
  type JavaScanFailure,
  type ServerJavaCompatibility,
} from "./javaApi";
import { javaDiagnosis } from "./javaDiagnosis";
import { useJavaProvisioning, type JavaTarget } from "./useJavaProvisioning";

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

/* Windows paths differ in case and separator between the scan and the stored
   profile, so comparing them raw reports a runtime as unused while a server is
   running on it. */
function samePath(left?: string | null, right?: string | null) {
  if (!left || !right) return false;
  return (
    left.replace(/\\/g, "/").toLowerCase() ===
    right.replace(/\\/g, "/").toLowerCase()
  );
}

function runtimeSourceLabel(source: string, t: (key: string) => string) {
  const keyBySource: Record<string, string> = {
    managed: "java.source.managed",
    "Managed by MC Server Manager": "java.source.managed",
    "Server profile": "java.source.serverProfile",
    "Installed on this machine": "java.source.systemInstall",
    PATH: "java.source.path",
    JAVA_HOME: "java.source.javaHome",
  };
  const key = keyBySource[source];
  return key ? t(key) : source;
}

/* Scan failures arrive as data, so the English message is the fallback rather
   than the value: a code means the same locale entry the thrown errors use. */
function failureMessage(
  failure: JavaScanFailure,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (!failure.code) return failure.error;
  return t(`desktop.error.${failure.code}`, { detail: failure.detail ?? "" });
}

export function JavaRuntimesView() {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [pendingRemoval, setPendingRemoval] = useState<JavaRuntime | null>(
    null,
  );
  const javaQuery = useQuery({
    queryKey: queryKeys.java.runtimes,
    queryFn: listJavaRuntimes,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.servers.profiles,
    });
    await javaQuery.refetch();
  };

  const compatibility = javaQuery.data?.compatibility ?? [];

  const {
    apply,
    applyError,
    busy,
    dialog: installDialog,
    start: startAcquire,
  } = useJavaProvisioning({
    onFinished: refresh,
    serverNameFor: (serverId) =>
      compatibility.find((item) => item.serverId === serverId)?.serverName,
  });

  const removeMutation = useMutation({
    mutationFn: (javaPath: string) => removeJavaRuntime(javaPath),
    onSuccess: async () => {
      setPendingRemoval(null);
      await refresh();
    },
  });

  const runtimes = javaQuery.data?.runtimes ?? [];
  const unresolved = compatibility.filter(
    (item) => item.status !== "compatible",
  );

  /* Every distinct version window the installed servers need. One runtime
     cannot serve them all: a 1.7.10 profile needs Java 8 and a 1.21 profile
     needs 21, and neither runs on the other's. */
  const neededVersions = [
    ...new Map(
      compatibility
        .filter(
          (
            item,
          ): item is ServerJavaCompatibility & {
            requiredMajorVersion: number;
          } => typeof item.requiredMajorVersion === "number",
        )
        .map((item) => [
          item.requiredMajorVersion,
          {
            majorVersion: item.requiredMajorVersion,
            maxMajorVersion: item.maxMajorVersion ?? null,
            serverId: null,
          } satisfies JavaTarget,
        ]),
    ).values(),
  ].sort((left, right) => left.majorVersion - right.majorVersion);
  const acquirable =
    neededVersions.length > 0
      ? neededVersions
      : [{ majorVersion: 21, maxMajorVersion: null, serverId: null }];

  const runtimeColumns: DataTableColumn<JavaRuntime>[] = [
    {
      id: "version",
      header: t("java.table.version"),
      rowHeader: true,
      sortValue: (runtime) => runtime.majorVersion,
      cell: (runtime) => (
        <span className="java-runtime-identity">
          {isAdoptiumRuntime(runtime.vendor) ? (
            <img
              alt=""
              aria-hidden="true"
              className="provider-icon"
              height="17"
              src={publicAssetUrl("/brand/adoptium-logo.svg")}
              width="17"
            />
          ) : (
            <span className="java-runtime-icon">
              <Coffee aria-hidden="true" size={14} />
            </span>
          )}
          <span>Java {runtime.majorVersion}</span>
        </span>
      ),
    },
    {
      id: "vendor",
      header: t("java.table.vendor"),
      cell: (runtime) => runtime.vendor ?? t("common.unknown"),
      sortValue: (runtime) => runtime.vendor,
    },
    {
      id: "architecture",
      header: t("java.table.architecture"),
      cell: (runtime) => runtime.architecture ?? t("common.unknown"),
      sortValue: (runtime) => runtime.architecture,
    },
    {
      id: "usedBy",
      header: t("java.table.usedBy"),
      /* A list of runtimes says nothing about whether any of them is in use.
         Naming the servers is what turns the table from an inventory into an
         answer, and it is how a duplicate-looking row is told apart. */
      cell: (runtime) => {
        const users = compatibility.filter((item) =>
          samePath(item.configuredJavaPath, runtime.path),
        );
        if (users.length === 0) {
          return <span className="text-muted">{t("java.table.unused")}</span>;
        }
        /* One line, truncated, with the full name on hover — a server name can
           be longer than any column width worth giving it. The link is a real
           anchor so the name is also the way to go look at that server. */
        return (
          <span
            className="java-usedby"
            title={users.map((item) => item.serverName).join(", ")}
          >
            {users.map((item, index) => (
              <span key={item.serverId}>
                {index > 0 ? ", " : null}
                <a
                  href={toAppHash({
                    name: "server",
                    serverId: item.serverId,
                    section: "overview",
                  })}
                >
                  {item.serverName}
                </a>
              </span>
            ))}
          </span>
        );
      },
    },
    {
      id: "source",
      header: t("java.table.source"),
      cell: (runtime) => (
        <span className="java-source-chip">
          {runtimeSourceLabel(runtime.source, t)}
        </span>
      ),
    },
    {
      id: "path",
      header: t("java.table.path"),
      cellClassName: "path-cell",
      /* Paths run past any column width, so the cell shows what fits and keeps
         the rest one hover away rather than wrapping the whole row. */
      cell: (runtime) => <span title={runtime.path}>{runtime.path}</span>,
    },
    {
      id: "actions",
      header: t("java.table.actions"),
      cellClassName: "java-actions-cell",
      /* Only the runtimes this app downloaded. The others belong to the machine
         and are uninstalled the way they were installed; the backend refuses
         them too, so this is the honest affordance rather than the only guard. */
      cell: (runtime) =>
        runtime.managed ? (
          <Button
            disabled={removeMutation.isPending}
            type="button"
            variant="danger"
            onClick={() => {
              removeMutation.reset();
              setPendingRemoval(runtime);
            }}
          >
            <Trash2 aria-hidden="true" size={14} />
            {t("common.delete")}
          </Button>
        ) : null,
    },
  ];

  return (
    <section aria-labelledby="java-runtimes-title" className="java-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">{t("java.eyebrow")}</p>
          <h1 id="java-runtimes-title" tabIndex={-1}>
            {t("java.title")}
          </h1>
        </div>
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
        <div className="list-state list-state-error" role="alert">
          <strong>{t("java.scanError.title")}</strong>
          <span>{javaQuery.error.message}</span>
          <Button variant="secondary" onClick={() => javaQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

      {javaQuery.data ? (
        <div className="java-layout">
          {/* Servers first. The page used to open on the runtime inventory and
              bury this at the bottom, which asked the reader to translate "I
              have these four Javas" into "so can my server start?" on their
              own. That translation is the product's job. */}
          <section className="java-panel java-panel-servers">
            <div className="section-heading">
              <h2>{t("java.servers.title")}</h2>
              <span>
                {unresolved.length > 0
                  ? t("java.servers.needAttention", {
                      count: unresolved.length,
                    })
                  : t("java.servers.allReady")}
              </span>
            </div>
            <div className="compatibility-list">
              {compatibility.map((item) => {
                const Icon =
                  item.status === "compatible" ? CheckCircle2 : AlertTriangle;
                const required = item.requiredMajorVersion;
                const usable = item.recommendedJavaPath;
                return (
                  <div className="compatibility-row" key={item.serverId}>
                    <Icon
                      aria-hidden="true"
                      className={compatibilityClass(item.status)}
                      size={17}
                    />
                    <div>
                      <strong>{item.serverName}</strong>
                      <span>{javaDiagnosis(item, t)}</span>
                      {item.configuredJavaPath ? (
                        <small className="java-runtime-path">
                          {item.configuredJavaPath}
                        </small>
                      ) : null}
                    </div>
                    {item.status !== "compatible" &&
                    typeof required === "number" ? (
                      <Button
                        disabled={busy}
                        type="button"
                        variant={usable ? "secondary" : "primary"}
                        onClick={() =>
                          usable
                            ? apply(item.serverId, usable)
                            : startAcquire({
                                majorVersion: required,
                                maxMajorVersion: item.maxMajorVersion ?? null,
                                serverId: item.serverId,
                              })
                        }
                      >
                        {usable
                          ? t("java.action.use", { version: required })
                          : t("java.action.install", { version: required })}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
              {applyError ? (
                <p className="danger-text" role="alert">
                  {applyError}
                </p>
              ) : null}
              {compatibility.length === 0 ? (
                <EmptyState
                  title={t("java.compatibility.empty.title")}
                  description={t("java.compatibility.empty.description")}
                />
              ) : null}
            </div>
          </section>

          <section className="java-panel java-panel-installed">
            <div className="section-heading">
              <h2>{t("java.installed.title")}</h2>
              <span>{t("java.detected", { count: runtimes.length })}</span>
            </div>
            {runtimes.length === 0 ? (
              <EmptyState
                illustration="/illustrations/no-java.png"
                title={t("java.empty.title")}
                description={t("java.empty.description")}
              />
            ) : (
              <div className="java-table-scroll">
                <DataTable
                  caption={t("java.installed.title")}
                  className="java-table"
                  columns={runtimeColumns}
                  getRowKey={(runtime) => `${runtime.path}-${runtime.version}`}
                  rows={runtimes}
                />
              </div>
            )}
          </section>

          <section className="java-panel java-panel-acquire">
            <div className="section-heading">
              <h2>{t("java.managed.title")}</h2>
              <span>{t("java.managed.subtitle")}</span>
            </div>
            <div className="java-panel-body">
              <p>{t("java.managed.description")}</p>
              <div className="java-acquire-actions">
                {acquirable.map((entry) => (
                  <Button
                    disabled={busy}
                    key={entry.majorVersion}
                    type="button"
                    variant="secondary"
                    onClick={() => startAcquire(entry)}
                  >
                    {t("java.action.install", { version: entry.majorVersion })}
                  </Button>
                ))}
                <span className="java-acquire-links">
                  <a
                    href="https://www.java.com/download/"
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {t("java.managed.oracleLink")}
                  </a>
                  <a
                    href={javaDownloadUrl(
                      acquirable[acquirable.length - 1].majorVersion,
                    )}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {t("java.managed.temurinLink")}
                  </a>
                </span>
              </div>
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
                    <strong>{runtimeSourceLabel(failure.source, t)}</strong>
                    <span>{failure.path}</span>
                    <small>{failureMessage(failure, t)}</small>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Deleting files off disk is not undoable, so it is confirmed. The
          dialog names the exact folder that goes, because "Java 25" is not
          enough to tell two installs apart. */}
      <DialogSurface
        className="java-remove-dialog"
        description={t("java.remove.description")}
        open={pendingRemoval !== null}
        title={t("java.remove.title", {
          version: pendingRemoval?.majorVersion ?? "",
        })}
        footer={
          <>
            <Button
              disabled={removeMutation.isPending}
              variant="ghost"
              onClick={() => setPendingRemoval(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={removeMutation.isPending}
              variant="danger"
              onClick={() =>
                pendingRemoval && removeMutation.mutate(pendingRemoval.path)
              }
            >
              {t("common.delete")}
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
      >
        <p className="java-runtime-path">{pendingRemoval?.path}</p>
        {removeMutation.error ? (
          <div className="inline-error" role="alert">
            {removeMutation.error.message}
          </div>
        ) : null}
      </DialogSurface>

      {installDialog}
    </section>
  );
}
