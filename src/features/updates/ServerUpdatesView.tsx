import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { RefreshCw, ShieldAlert, Upload } from "lucide-react";
import { Button } from "../../components/ui/button";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../servers/types";

interface ServerUpdateCheck {
  serverId: string;
  loaderType: ServerProfile["loaderType"];
  currentVersion: string | null;
  currentLoaderVersion: string | null;
  latestVersion: string | null;
  latestLoaderVersion: string | null;
  updateAvailable: boolean;
  installSupported: boolean;
  message: string;
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
  createdAt: string;
}

interface ServerUpdatesViewProps {
  server: ServerProfile;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function versionLine(
  check: ServerUpdateCheck | undefined,
  server: ServerProfile,
  unknownLabel: string,
  stableChannelLabel: string,
) {
  if (!check) {
    return `${server.minecraftVersion ?? unknownLabel} -> ${stableChannelLabel}`;
  }
  const loaderPart = check.latestLoaderVersion
    ? ` (${check.latestLoaderVersion})`
    : "";
  return `${check.currentVersion ?? unknownLabel} -> ${check.latestVersion ?? unknownLabel}${loaderPart}`;
}

export function ServerUpdatesView({ server }: ServerUpdatesViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [targetVersion, setTargetVersion] = useState("");
  const [targetLoaderVersion, setTargetLoaderVersion] = useState("");
  const [serverJarPath, setServerJarPath] = useState("");
  const [serverJarSha256, setServerJarSha256] = useState("");
  const historyQuery = useQuery({
    queryKey: ["serverUpdateHistory", server.id],
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<ServerUpdateHistory[]>("list_server_update_history", {
        serverId: server.id,
      }),
  });
  const checkMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<ServerUpdateCheck>("check_server_update", {
        input: {
          serverId: server.id,
          targetVersion: targetVersion.trim() || null,
          targetLoaderVersion: targetLoaderVersion.trim() || null,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["serverUpdateHistory", server.id],
      });
    },
  });
  const installMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<ServerUpdateHistory>("install_server_update", {
        input: {
          serverId: server.id,
          targetVersion:
            check?.latestVersion || targetVersion.trim() || server.minecraftVersion,
          targetLoaderVersion:
            check?.latestLoaderVersion ||
            targetLoaderVersion.trim() ||
            server.loaderVersion ||
            null,
          serverJarPath: serverJarPath.trim(),
          serverJarSha256: serverJarSha256.trim() || null,
          confirm: true,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["serverUpdateHistory", server.id],
      });
    },
  });
  const check = checkMutation.data;
  const canInstall =
    Boolean(serverJarPath.trim()) && !installMutation.isPending;
  const canCheck = Boolean(targetVersion.trim()) && !checkMutation.isPending;

  return (
    <section className="settings-panel" aria-label={t("serverUpdates.aria")}>
      <div className="section-heading">
        <h2>{t("serverUpdates.title")}</h2>
        <Button
          disabled={!canCheck}
          variant="secondary"
          onClick={() => checkMutation.mutate()}
        >
          <RefreshCw aria-hidden="true" size={15} />
          {t("serverUpdates.check")}
        </Button>
      </div>
      {checkMutation.error ? (
        <p className="danger-text">{checkMutation.error.message}</p>
      ) : null}
      {installMutation.error ? (
        <p className="danger-text">{installMutation.error.message}</p>
      ) : null}
      <div className="settings-grid">
        <label>
          {t("serverUpdates.targetMinecraftVersion")}
          <TextField
            placeholder={t("serverUpdates.targetVersionPlaceholder")}
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
        <label>
          {t("serverUpdates.downloadedJar")}
          <TextField
            placeholder={t("serverUpdates.jarPlaceholder")}
            value={serverJarPath}
            onChange={(event) => setServerJarPath(event.target.value)}
          />
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
      <div className="update-status-grid">
        <div>
          <span>{t("serverUpdates.loader")}</span>
          <strong>{server.loaderType}</strong>
        </div>
        <div>
          <span>{t("serverUpdates.version")}</span>
          <strong>
            {versionLine(
              check,
              server,
              t("common.unknown"),
              t("serverUpdates.stableChannelTarget"),
            )}
          </strong>
        </div>
        <div>
          <span>{t("serverUpdates.status")}</span>
          <strong>
            {check
              ? check.updateAvailable
                ? t("settings.updates.available")
                : t("serverUpdates.current")
              : t("settings.updates.notChecked")}
          </strong>
        </div>
        <div>
          <span>{t("serverUpdates.install")}</span>
          <strong>
            {check
              ? check.installSupported
                ? t("serverUpdates.supported")
                : t("serverUpdates.manualOnly")
              : t("serverUpdates.pendingCheck")}
          </strong>
        </div>
      </div>
      {check ? (
        <div className="list-state">
          <ShieldAlert aria-hidden="true" size={18} />
          <strong>
            {check.installSupported
              ? t("serverUpdates.stableChannel")
              : t("serverUpdates.manualRequired")}
          </strong>
          <span>{check.message}</span>
        </div>
      ) : null}
      <Button
        disabled={!canInstall}
        onClick={() => installMutation.mutate()}
      >
        <Upload aria-hidden="true" size={15} />
        {t("serverUpdates.installJar")}
      </Button>
      <div className="compatibility-list">
        {(historyQuery.data ?? []).map((entry) => (
          <div key={entry.id}>
            <strong>{entry.status}</strong>
            <span>{entry.message}</span>
            <span>{formatDate(entry.createdAt)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
