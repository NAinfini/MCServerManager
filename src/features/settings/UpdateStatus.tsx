import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Badge, Group, Stack, Text } from "@mantine/core";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { SettingRow, SettingSection } from "../../components/ui/setting-row";
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
    <SettingSection
      title={t("settings.updates.title")}
      actions={
        <Button
          disabled={updateQuery.isFetching}
          variant="secondary"
          onClick={() => updateQuery.refetch()}
        >
          <RefreshCw aria-hidden="true" size={16} />
          {t("settings.updates.check")}
        </Button>
      }
    >
      {updateQuery.error ? (
        <Alert
          aria-label={t("settings.updates.error.title")}
          color="red"
          my="sm"
          role="alert"
          title={t("settings.updates.error.title")}
        >
          <Group justify="space-between" gap="sm">
            <Text size="sm">{updateQuery.error.message}</Text>
            <Button
              disabled={updateQuery.isFetching}
              variant="secondary"
              onClick={() => updateQuery.refetch()}
            >
              <RefreshCw aria-hidden="true" size={16} />
              {t("common.retry")}
            </Button>
          </Group>
        </Alert>
      ) : null}
      {status ? (
        <SettingRow label={t("settings.updates.currentVersion")}>
          <Text size="sm" ff="monospace">
            {status.currentVersion}
          </Text>
        </SettingRow>
      ) : null}
      {status ? (
        <SettingRow label={t("settings.updates.channel")}>
          <Text size="sm">
            {channelLabel(status.channel, t("settings.updates.channel.stable"))}
          </Text>
        </SettingRow>
      ) : null}
      {status ? (
        <SettingRow label={t("settings.updates.lastCheck")}>
          <Text size="sm">
            {formatCheckedAt(
              status.checkedAt,
              t("settings.updates.notChecked"),
              language,
            )}
          </Text>
        </SettingRow>
      ) : null}
      {status ? (
        <SettingRow label={t("settings.updates.status")}>
          <Badge
            variant="light"
            color={status.updateAvailable ? "azure" : "gray"}
          >
            {status.updateAvailable
              ? t("settings.updates.available")
              : t("settings.updates.current")}
          </Badge>
        </SettingRow>
      ) : null}
      {status?.latestVersion ? (
        <SettingRow label={t("settings.updates.latestVersion")}>
          <Text size="sm" ff="monospace">
            {status.latestVersion}
          </Text>
        </SettingRow>
      ) : null}
      {status?.releaseDate ? (
        <SettingRow label={t("settings.updates.published")}>
          <Text size="sm">
            {formatCheckedAt(
              status.releaseDate,
              t("settings.updates.notChecked"),
              language,
            )}
          </Text>
        </SettingRow>
      ) : null}
      {status ? (
        <Stack gap="sm" py="sm" align="flex-start">
          {status.releaseNotes ? (
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {status.releaseNotes}
            </Text>
          ) : null}
          {status.installBlockedByRunningServers ? (
            <Alert color="yellow" role="note" w="100%">
              {t("settings.updates.blockedRunningServers", {
                count: status.runningServerCount ?? 0,
              })}
            </Alert>
          ) : null}
          {installMutation.error ? (
            <Alert color="red" role="alert" w="100%">
              {installMutation.error.message}
            </Alert>
          ) : null}
          <Button
            disabled={installDisabled}
            variant="primary"
            onClick={() => {
              installMutation.reset();
              setIsInstallConfirmOpen(true);
            }}
          >
            <Download aria-hidden="true" size={16} />
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
        </Stack>
      ) : null}
    </SettingSection>
  );
}
