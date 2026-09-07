import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import {
  DataTable,
  type DataTableColumn,
} from "../../components/data/DataTable";
import { LoadingState } from "../../components/ui/loading-state";
import { PathField } from "../../components/ui/path-field";
import { StickyActionBar } from "../../components/ui/sticky-action-bar";
import { TextField } from "../../components/ui/text-field";
import { createWorldBackup } from "../backups/backupApi";
import { useAppSettings } from "../../i18n";
import { formatDateTime } from "../../lib/date-format";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { queryKeys } from "../../lib/query-keys";
import type { ServerProfile } from "../../domain/server";
import { serverKeys } from "../servers/queries";
import { useUnsavedGuard } from "../../lib/use-unsaved-guard";
import "../files/operations.css";

interface ServerUpdateCheckItem {
  id: string;
  status: "ready" | "warning" | "blocked";
  message: string;
}

interface ServerUpdateCheck {
  serverId: string;
  loaderType: ServerProfile["loaderType"];
  currentVersion: string | null;
  targetVersion?: string | null;
  latestVersion?: string | null;
  latestLoaderVersion?: string | null;
  targetLoaderVersion: string | null;
  updateAvailable: boolean;
  installSupported: boolean;
  message: string;
  checks: ServerUpdateCheckItem[];
}

interface ServerUpdateHistory {
  id: string;
  serverId: string;
  loaderType: string;
  fromVersion: string | null;
  toVersion: string | null;
  status: string;
  message: string;
  rollbackPath: string | null;
  rollbackAvailable: boolean;
  createdAt: string;
}

interface ServerUpdatesViewProps {
  server: ServerProfile;
}

const SOURCE_LINKS: Record<ServerProfile["loaderType"], string> = {
  vanilla: "https://www.minecraft.net/download/server",
  paper: "https://papermc.io/downloads/paper",
  fabric: "https://fabricmc.net/use/server/",
  forge: "https://files.minecraftforge.net/net/minecraftforge/forge/",
  neoForge: "https://neoforged.net/",
  quilt: "https://quiltmc.org/en/install/server/",
};

type UpdateStep = 1 | 2 | 3;
type UpdateTranslator = (
  key: string,
  values?: Record<string, string | number | null | undefined>,
) => string;

function checkedVersion(
  check: ServerUpdateCheck | undefined,
  server: ServerProfile,
) {
  return (
    check?.targetVersion ??
    check?.latestVersion ??
    server.minecraftVersion ??
    null
  );
}

function historyStatusLabel(status: string, t: UpdateTranslator) {
  const knownStatuses = new Set([
    "available",
    "current",
    "installed",
    "unsupported",
    "rolledBack",
    "rollbackFailed",
  ]);
  return knownStatuses.has(status)
    ? t(`serverUpdates.history.status.${status}`)
    : status;
}

function historyMessage(entry: ServerUpdateHistory, t: UpdateTranslator) {
  const values = {
    from: entry.fromVersion ?? t("common.unknown"),
    to: entry.toVersion ?? t("common.unknown"),
  };
  if (entry.status === "installed")
    return t("serverUpdates.history.message.installed", values);
  if (entry.status === "available")
    return t("serverUpdates.history.message.available", values);
  if (entry.status === "current")
    return t("serverUpdates.history.message.current", values);
  if (entry.status === "unsupported")
    return t("serverUpdates.history.message.unsupported", values);
  if (entry.status === "rolledBack")
    return t("serverUpdates.history.message.rolledBack", values);
  return entry.message;
}

function checkSummary(
  check: ServerUpdateCheck,
  server: ServerProfile,
  t: UpdateTranslator,
) {
  if (check.updateAvailable && !check.installSupported) {
    return t("serverUpdates.checkSummary.manual");
  }
  if (check.updateAvailable) {
    return t("serverUpdates.checkSummary.available", {
      version: checkedVersion(check, server) ?? t("common.unknown"),
    });
  }
  return t("serverUpdates.checkSummary.current");
}

async function pickServerJar() {
  const result = await invokeDesktopCommandWithErrorHandling<{
    path: string | null;
  }>("show_open_dialog", {
    kind: "file",
    filters: [{ name: "Java archive", extensions: ["jar"] }],
  });
  return result.path;
}

export function ServerUpdatesView({ server }: ServerUpdatesViewProps) {
  const { language, t } = useAppSettings();
  const queryClient = useQueryClient();
  const didStartAutomaticCheck = useRef(false);
  const [step, setStep] = useState<UpdateStep>(1);
  const [targetVersion, setTargetVersion] = useState("");
  const [targetLoaderVersion, setTargetLoaderVersion] = useState("");
  const [serverJarPath, setServerJarPath] = useState("");
  const [serverJarSha256, setServerJarSha256] = useState("");
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [rollbackEntry, setRollbackEntry] =
    useState<ServerUpdateHistory | null>(null);

  const historyQuery = useQuery({
    queryKey: queryKeys.updates.server(server.id),
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<ServerUpdateHistory[]>(
        "list_server_update_history",
        { serverId: server.id },
      ),
  });
  const checkMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<ServerUpdateCheck>(
        "check_server_update",
        {
          input: { serverId: server.id },
        },
      ),
    onSuccess: async (result) => {
      setTargetVersion(result.targetVersion ?? result.latestVersion ?? "");
      setTargetLoaderVersion(
        result.targetLoaderVersion ?? result.latestLoaderVersion ?? "",
      );
      setWarningsAcknowledged(false);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.updates.server(server.id),
      });
    },
  });
  const installMutation = useMutation({
    mutationFn: async () => {
      await createWorldBackup({ serverId: server.id });
      return invokeDesktopCommandWithErrorHandling<ServerUpdateHistory>(
        "install_server_update",
        {
          input: {
            serverId: server.id,
            targetMinecraftVersion:
              targetVersion.trim() ||
              checkedVersion(checkMutation.data, server),
            targetLoaderVersion:
              targetLoaderVersion.trim() ||
              checkMutation.data?.targetLoaderVersion ||
              server.loaderVersion ||
              null,
            serverJarPath: serverJarPath.trim() || undefined,
            serverJarSha256: serverJarSha256.trim() || null,
            acknowledgeWarnings: warningsAcknowledged,
            confirm: true,
          },
        },
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.updates.server(server.id),
        }),
        queryClient.invalidateQueries({ queryKey: serverKeys.profiles }),
      ]);
    },
  });
  const rollbackMutation = useMutation({
    mutationFn: (entry: ServerUpdateHistory) =>
      invokeDesktopCommandWithErrorHandling<ServerUpdateHistory>(
        "rollback_server_update",
        {
          input: {
            serverId: server.id,
            historyId: entry.id,
            confirm: true,
          },
        },
      ),
    onSuccess: async () => {
      setRollbackEntry(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.updates.server(server.id),
        }),
        queryClient.invalidateQueries({ queryKey: serverKeys.profiles }),
      ]);
    },
  });

  useEffect(() => {
    if (!didStartAutomaticCheck.current) {
      didStartAutomaticCheck.current = true;
      checkMutation.mutate();
    }
  }, [checkMutation]);

  const check = checkMutation.data;
  const updateChecks = check?.checks ?? [];
  const hasBlockedCheck = updateChecks.some(
    (item) => item.status === "blocked",
  );
  const hasWarnings = updateChecks.some((item) => item.status === "warning");
  const canReviewUpdate =
    Boolean(check?.installSupported) &&
    !checkMutation.isPending &&
    !hasBlockedCheck;
  const canInstall =
    Boolean(check?.installSupported) &&
    !hasBlockedCheck &&
    (!hasWarnings || warningsAcknowledged) &&
    backupConfirmed &&
    !installMutation.isPending;
  const resetDraft = () => {
    setStep(1);
    setTargetVersion("");
    setTargetLoaderVersion("");
    setServerJarPath("");
    setServerJarSha256("");
    setBackupConfirmed(false);
    setWarningsAcknowledged(false);
    setBrowseError(null);
  };
  const hasUnsavedDraft =
    !installMutation.isSuccess &&
    (step !== 1 ||
      serverJarPath !== "" ||
      serverJarSha256 !== "" ||
      backupConfirmed ||
      warningsAcknowledged);

  const historyColumns: DataTableColumn<ServerUpdateHistory>[] = [
    {
      id: "created",
      header: t("serverUpdates.history.created"),
      sortValue: (entry) => entry.createdAt,
      cell: (entry) => formatDateTime(entry.createdAt, language),
    },
    {
      id: "status",
      header: t("serverUpdates.history.result"),
      sortValue: (entry) => entry.status,
      cell: (entry) => historyStatusLabel(entry.status, t),
    },
    {
      id: "change",
      header: t("serverUpdates.history.change"),
      rowHeader: true,
      cell: (entry) => historyMessage(entry, t),
    },
    {
      id: "actions",
      header: t("serverUpdates.history.actions"),
      cell: (entry) =>
        entry.rollbackAvailable ? (
          <Button
            disabled={rollbackMutation.isPending}
            variant="secondary"
            onClick={() => {
              rollbackMutation.reset();
              setRollbackEntry(entry);
            }}
          >
            <RotateCcw aria-hidden="true" size={14} />
            {t("serverUpdates.rollback.action")}
          </Button>
        ) : (
          <span className="operation-muted">{t("common.unavailable")}</span>
        ),
    },
  ];
  useUnsavedGuard({
    isDirty: hasUnsavedDraft,
    message: t("serverUpdates.unsaved.confirm"),
    onDiscard: resetDraft,
  });

  async function handleBrowseJar() {
    setBrowseError(null);
    try {
      const path = await pickServerJar();
      if (path) setServerJarPath(path);
    } catch (error) {
      setBrowseError(
        error instanceof Error
          ? error.message
          : t("serverUpdates.jarBrowseError"),
      );
    }
  }

  return (
    <section
      className="settings-panel update-wizard"
      aria-label={t("serverUpdates.title")}
    >
      {/* The dialog that hosts this wizard already names it; repeating the
          title and its description inside the panel was two headings deep. */}
      <ol
        className="update-wizard-steps"
        aria-label={t("serverUpdates.stepsAria")}
      >
        {([1, 2, 3] as UpdateStep[]).map((value) => (
          <li
            key={value}
            data-active={step === value}
            data-complete={step > value}
          >
            <span>{value}</span>
            {t(`serverUpdates.step.${value}.title`)}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <div className="update-wizard-stage">
          <div className="update-status-grid">
            <div>
              <span>{t("serverUpdates.loader")}</span>
              <strong>{server.loaderType}</strong>
            </div>
            <div>
              <span>{t("serverUpdates.version")}</span>
              <strong>{server.minecraftVersion ?? t("common.unknown")}</strong>
            </div>
            <div>
              <span>{t("serverUpdates.status")}</span>
              <strong>
                {check
                  ? check.updateAvailable
                    ? t("settings.updates.available")
                    : t("serverUpdates.current")
                  : t("serverUpdates.pendingCheck")}
              </strong>
            </div>
            <div>
              <span>{t("serverUpdates.install")}</span>
              <strong>
                {check?.installSupported
                  ? t("serverUpdates.supported")
                  : t("serverUpdates.manualOnly")}
              </strong>
            </div>
          </div>
          {checkMutation.isPending ? (
            <LoadingState message={t("serverUpdates.checking")} />
          ) : null}
          {checkMutation.error ? (
            <p className="danger-text" role="alert">
              {checkMutation.error.message}
            </p>
          ) : null}
          {check ? (
            <div className="update-check-summary">
              <ShieldAlert aria-hidden="true" size={18} />
              <div>
                <strong>{t("serverUpdates.checkComplete")}</strong>
                <span>{checkSummary(check, server, t)}</span>
              </div>
              {!check.installSupported ? (
                <a
                  href={SOURCE_LINKS[server.loaderType]}
                  rel="noreferrer"
                  target="_blank"
                >
                  {t("serverUpdates.source.open", {
                    loader: server.loaderType,
                  })}
                </a>
              ) : null}
            </div>
          ) : null}
          {updateChecks.length ? (
            <ul className="update-check-list">
              {updateChecks.map((item) => (
                <li data-status={item.status} key={item.id}>
                  <span>{t(`serverUpdates.checkStatus.${item.status}`)}</span>
                  <p>{item.message}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="form-actions">
            <Button
              disabled={checkMutation.isPending}
              variant="secondary"
              onClick={() => checkMutation.mutate()}
            >
              <RefreshCw aria-hidden="true" size={15} />
              {t("serverUpdates.checkAgain")}
            </Button>
            <Button disabled={!canReviewUpdate} onClick={() => setStep(2)}>
              {t("serverUpdates.continue")}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="update-wizard-stage">
          <div className="update-source-note">
            <ExternalLink aria-hidden="true" size={18} />
            <div>
              <strong>{t("serverUpdates.source.title")}</strong>
              <span>{t("serverUpdates.source.automaticDescription")}</span>
            </div>
            <a
              href={SOURCE_LINKS[server.loaderType]}
              rel="noreferrer"
              target="_blank"
            >
              {t("serverUpdates.source.open", { loader: server.loaderType })}
            </a>
          </div>
          <div className="settings-grid">
            <label>
              {t("serverUpdates.targetMinecraftVersion")}
              <TextField
                placeholder={
                  checkedVersion(check, server) ??
                  t("serverUpdates.targetVersionPlaceholder")
                }
                value={targetVersion}
                onChange={(event) => setTargetVersion(event.target.value)}
              />
            </label>
            <label>
              {t("serverUpdates.targetLoaderBuild")}
              <TextField
                placeholder={
                  server.loaderType === "paper"
                    ? t("serverUpdates.paperBuild")
                    : t("serverUpdates.loaderVersion")
                }
                value={targetLoaderVersion}
                onChange={(event) => setTargetLoaderVersion(event.target.value)}
              />
            </label>
            <label className="field-span-2">
              {t("serverUpdates.downloadedJar")}
              <PathField
                browseLabel={t("serverUpdates.browseJar")}
                onBrowse={handleBrowseJar}
                placeholder={t("serverUpdates.jarPlaceholder")}
                value={serverJarPath}
                onChange={(event) => setServerJarPath(event.target.value)}
              />
              <small className="field-hint">
                {t("serverUpdates.manualJarHint")}
              </small>
            </label>
            <label>
              {t("serverUpdates.sha256")}
              <TextField
                placeholder={t("serverUpdates.optionalChecksum")}
                value={serverJarSha256}
                onChange={(event) => setServerJarSha256(event.target.value)}
              />
            </label>
          </div>
          {browseError ? (
            <p className="danger-text" role="alert">
              {browseError}
            </p>
          ) : null}
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setStep(1)}>
              {t("serverUpdates.back")}
            </Button>
            <Button disabled={!canReviewUpdate} onClick={() => setStep(3)}>
              {t("serverUpdates.continue")}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="update-wizard-stage">
          <div className="list-state update-consequences">
            <ShieldAlert aria-hidden="true" size={18} />
            <div>
              <strong>{t("serverUpdates.backup.title")}</strong>
              <span>{t("serverUpdates.backup.description")}</span>
            </div>
          </div>
          <ul className="update-consequence-list">
            <li>{t("serverUpdates.backup.world")}</li>
            <li>{t("serverUpdates.backup.rollback")}</li>
            <li>{t("serverUpdates.backup.failure")}</li>
          </ul>
          <label className="checkbox-row">
            <Checkbox
              checked={backupConfirmed}
              onCheckedChange={(checked) =>
                setBackupConfirmed(checked === true)
              }
            />
            {t("serverUpdates.backup.confirm")}
          </label>
          {hasWarnings ? (
            <label className="checkbox-row">
              <Checkbox
                checked={warningsAcknowledged}
                onCheckedChange={(checked) =>
                  setWarningsAcknowledged(checked === true)
                }
              />
              {t("serverUpdates.warnings.confirm")}
            </label>
          ) : null}
          {installMutation.error ? (
            <p className="danger-text" role="alert">
              {t("serverUpdates.installFailed")} {installMutation.error.message}
            </p>
          ) : null}
          {installMutation.data ? (
            <div className="success-panel" role="status">
              <CheckCircle2 aria-hidden="true" size={16} />
              {t("serverUpdates.installSucceeded")}
            </div>
          ) : null}
          <StickyActionBar>
            <Button variant="secondary" onClick={() => setStep(2)}>
              {t("serverUpdates.back")}
            </Button>
            <Button
              disabled={!canInstall}
              onClick={() => installMutation.mutate()}
            >
              <Upload aria-hidden="true" size={15} />
              {installMutation.isPending
                ? t("serverUpdates.installing")
                : t("serverUpdates.backupAndInstall")}
            </Button>
          </StickyActionBar>
        </div>
      ) : null}

      <section
        className="update-history"
        aria-labelledby="server-update-history-title"
      >
        <h3 id="server-update-history-title">
          {t("serverUpdates.history.title")}
        </h3>
        {historyQuery.isLoading ? (
          <LoadingState message={t("serverUpdates.history.loading")} />
        ) : null}
        {historyQuery.error ? (
          <div className="list-state list-state-error" role="alert">
            <strong>{t("serverUpdates.history.loadError")}</strong>
            <span>{historyQuery.error.message}</span>
            <Button
              disabled={historyQuery.isFetching}
              variant="secondary"
              onClick={() => historyQuery.refetch()}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
        {historyQuery.data?.length ? (
          <div className="operation-table-scroll">
            <DataTable
              caption={t("serverUpdates.history.title")}
              className="operation-table update-history-table"
              columns={historyColumns}
              getRowKey={(entry) => entry.id}
              rows={historyQuery.data}
            />
          </div>
        ) : null}
        {!historyQuery.isLoading &&
        !historyQuery.error &&
        !historyQuery.data?.length ? (
          <div className="list-state">{t("serverUpdates.history.empty")}</div>
        ) : null}
      </section>
      {rollbackMutation.error ? (
        <p className="danger-text" role="alert">
          {rollbackMutation.error.message}
        </p>
      ) : null}
      <ConfirmDangerDialog
        confirmLabel={t("serverUpdates.rollback.confirm")}
        description={t("serverUpdates.rollback.description", {
          version: rollbackEntry?.fromVersion ?? t("common.unknown"),
        })}
        error={rollbackMutation.error?.message ?? null}
        isConfirming={rollbackMutation.isPending}
        isOpen={rollbackEntry !== null}
        title={t("serverUpdates.rollback.title")}
        onCancel={() => setRollbackEntry(null)}
        onConfirm={() => {
          if (rollbackEntry) rollbackMutation.mutate(rollbackEntry);
        }}
      />
    </section>
  );
}
