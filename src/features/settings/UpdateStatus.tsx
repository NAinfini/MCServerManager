import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { formatDateTime } from "../../lib/date-format";
import { queryKeys } from "../../lib/query-keys";

interface AppUpdateStatus {
  currentVersion: string;
  channel: string;
  checkedAt: string;
  updateAvailable: boolean;
  installerEnabled: boolean;
  installBlockedByRunningServers: boolean;
  runningServerCount?: number;
  latestVersion?: string | null;
  releaseNotes?: string | null;
  releaseDate?: string | null;
  message: string;
}

async function invokeUpdateCommand<T>(command: string) {
  return invokeDesktopCommandWithErrorHandling<T>(command, {
    input: { channel: "stable" },
  });
}

function formatCheckedAt(
  value: string | undefined,
  notCheckedLabel: string,
  locale: string,
) {
  if (!value) {
    return notCheckedLabel;
  }

  return formatDateTime(value, locale);
}

function channelLabel(channel: string, stableLabel: string) {
  return channel.toLowerCase() === "stable" ? stableLabel : channel;
}

export function UpdateStatus() {
  const { language, t } = useAppSettings();
  const [isInstallConfirmOpen, setIsInstallConfirmOpen] = useState(false);
  const updateQuery = useQuery({
    queryKey: queryKeys.updates.app,
    queryFn: () => invokeUpdateCommand<AppUpdateStatus>("check_app_update"),
  });
  const installMutation = useMutation({
    mutationFn: () => invokeUpdateCommand<void>("install_app_update"),
    onSuccess: () => {
      setIsInstallConfirmOpen(false);
      return updateQuery.refetch();
    },
  });
  const status = updateQuery.data;
  const installDisabled =
    !status?.installerEnabled ||
    status.installBlockedByRunningServers ||
    installMutation.isPending;

  return (
    <section className="settings-panel">
      <div className="section-heading">
        <h2>{t("settings.updates.title")}</h2>
        <Button
          disabled={updateQuery.isFetching}
          variant="secondary"
          onClick={() => updateQuery.refetch()}
        >
          <RefreshCw aria-hidden="true" size={15} />
          {t("settings.updates.check")}
        </Button>
      </div>

      {updateQuery.error ? (
        <div
          aria-label={t("settings.updates.error.title")}
          className="list-state list-state-error"
          role="alert"
        >
          <strong>{t("settings.updates.error.title")}</strong>
          <span>{updateQuery.error.message}</span>
          <Button
            disabled={updateQuery.isFetching}
            variant="secondary"
            onClick={() => updateQuery.refetch()}
          >
            <RefreshCw aria-hidden="true" size={15} />
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

      {status ? (
        <div className="update-status-grid">
          <div>
            <span>{t("settings.updates.currentVersion")}</span>
            <strong>{status.currentVersion}</strong>
          </div>
          <div>
            <span>{t("settings.updates.channel")}</span>
            <strong>
              {channelLabel(
                status.channel,
                t("settings.updates.channel.stable"),
              )}
            </strong>
          </div>
          <div>
            <span>{t("settings.updates.lastCheck")}</span>
            <strong>
              {formatCheckedAt(
                status.checkedAt,
                t("settings.updates.notChecked"),
                language,
              )}
            </strong>
          </div>
          <div>
            <span>{t("settings.updates.status")}</span>
            <strong>
              {status.updateAvailable
                ? t("settings.updates.available")
                : t("settings.updates.current")}
            </strong>
          </div>
          {status.latestVersion ? (
            <div>
              <span>{t("settings.updates.latestVersion")}</span>
              <strong>{status.latestVersion}</strong>
            </div>
          ) : null}
          {status.releaseDate ? (
            <div>
              <span>{t("settings.updates.published")}</span>
              <strong>
                {formatCheckedAt(
                  status.releaseDate,
                  t("settings.updates.notChecked"),
                  language,
                )}
              </strong>
            </div>
          ) : null}
          {status.releaseNotes ? <p>{status.releaseNotes}</p> : null}
          {status.installBlockedByRunningServers ? (
            <p className="danger-text">
              {t("settings.updates.blockedRunningServers", {
                count: status.runningServerCount ?? 0,
              })}
            </p>
          ) : null}
          {installMutation.error ? (
            <p className="danger-text" role="alert">
              {installMutation.error.message}
            </p>
          ) : null}
          <Button
            disabled={installDisabled}
            variant="primary"
            onClick={() => {
              installMutation.reset();
              setIsInstallConfirmOpen(true);
            }}
          >
            <Download aria-hidden="true" size={15} />
            {t("settings.updates.install")}
          </Button>
          <ConfirmDangerDialog
            confirmLabel={t("danger.labels.installUpdate")}
            description={t("danger.update.install.description")}
            error={installMutation.error?.message ?? null}
            isConfirming={installMutation.isPending}
            isOpen={isInstallConfirmOpen}
            title={t("danger.update.install.title")}
            onCancel={() => setIsInstallConfirmOpen(false)}
            onConfirm={() => installMutation.mutate()}
          />
        </div>
      ) : null}
    </section>
  );
}
