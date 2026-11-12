import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../../domain/server";
import {
  openPlayitSetup,
  playitKeys,
  savePlayitSettings,
  saveServerShareSettings,
  usePlayitStatus,
  useServerShareSettings,
} from "./playitApi";

/* The whole playit flow on one screen: detect it, paste the address once,
   switch it on. Nothing here downloads or installs anything. */
export function PlayitSetupPanel({ server }: { server: ServerProfile }) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const statusQuery = usePlayitStatus();
  const shareQuery = useServerShareSettings(server.id);
  const status = statusQuery.data;
  const share = shareQuery.data;
  const [address, setAddress] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setAddress(share?.publicAddress ?? "");
  }, [share?.publicAddress, server.id]);

  const saveShare = useMutation({
    mutationFn: saveServerShareSettings,
    onSuccess: (next) => {
      queryClient.setQueryData(playitKeys.share(server.id), next);
      void queryClient.invalidateQueries({ queryKey: playitKeys.status });
    },
  });
  const saveSettings = useMutation({
    mutationFn: savePlayitSettings,
    onSuccess: (next) => queryClient.setQueryData(playitKeys.status, next),
  });
  const openSetup = useMutation({ mutationFn: openPlayitSetup });

  const installed = status != null && status.state !== "not_installed";
  const trimmed = address.trim();
  const unchanged = trimmed === (share?.publicAddress ?? "");
  const error = saveShare.error ?? openSetup.error ?? saveSettings.error;

  return (
    <section
      className="tunnel-workbench-section playit-setup"
      aria-labelledby="playit-setup-title"
    >
      <div className="section-heading">
        <h2 id="playit-setup-title">{t("tunnels.playit.title")}</h2>
        <span>{t("tunnels.playit.description")}</span>
      </div>

      <div className="playit-step">
        <strong>{t("tunnels.playit.step.install")}</strong>
        {status?.state === "not_installed" ? (
          <>
            <p>{t("tunnels.playit.notInstalled")}</p>
            <div className="form-actions">
              <a
                className="button button-secondary"
                href={status.downloadUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink aria-hidden="true" size={15} />
                {t("tunnels.playit.download")}
              </a>
              <Button
                variant="secondary"
                onClick={() => statusQuery.refetch()}
              >
                <RefreshCw aria-hidden="true" size={15} />
                {t("tunnels.playit.recheck")}
              </Button>
            </div>
          </>
        ) : status?.state === "needs_setup" ? (
          <>
            <p>{t("tunnels.playit.needsSetup")}</p>
            <div className="form-actions">
              <Button
                disabled={openSetup.isPending}
                variant="primary"
                onClick={() => openSetup.mutate()}
              >
                {t("tunnels.playit.openSetup")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => statusQuery.refetch()}
              >
                <RefreshCw aria-hidden="true" size={15} />
                {t("tunnels.playit.recheck")}
              </Button>
            </div>
          </>
        ) : status ? (
          <p>{t("tunnels.playit.found", { path: status.exePath })}</p>
        ) : null}
      </div>

      <form
        className="playit-step"
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(false);
          saveShare.mutate(
            { serverId: server.id, publicAddress: trimmed },
            { onSuccess: () => setSaved(true) },
          );
        }}
      >
        <label htmlFor="playit-address">
          <strong>{t("tunnels.playit.step.address")}</strong>
        </label>
        <div className="inline-field-row">
          <TextField
            id="playit-address"
            aria-label={t("tunnels.playit.addressLabel")}
            placeholder={t("tunnels.playit.addressPlaceholder")}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setSaved(false);
            }}
          />
          <Button
            disabled={saveShare.isPending || unchanged}
            type="submit"
            variant="secondary"
          >
            {t("tunnels.playit.saveAddress")}
          </Button>
        </div>
        <p className="playit-help">
          {saved ? t("tunnels.playit.addressSaved") : t("tunnels.playit.addressHelp")}
        </p>
      </form>

      <div className="playit-step">
        <strong>{t("tunnels.playit.step.toggle")}</strong>
        <label className="switch-row">
          <Switch
            aria-label={t("tunnels.playit.startWithServer")}
            checked={share?.startTunnelWithServer ?? false}
            disabled={!installed || !share || saveShare.isPending}
            onCheckedChange={(checked) =>
              saveShare.mutate({
                serverId: server.id,
                startTunnelWithServer: checked,
              })
            }
          />
          {t("tunnels.playit.startWithServer")}
        </label>
        <p className="playit-help">{t("tunnels.playit.startWithServerHelp")}</p>
        <label className="switch-row">
          <Switch
            aria-label={t("tunnels.playit.stopWhenIdle")}
            checked={status?.stopWhenIdle ?? true}
            disabled={!status || saveSettings.isPending}
            onCheckedChange={(checked) =>
              saveSettings.mutate({ stopWhenIdle: checked })
            }
          />
          {t("tunnels.playit.stopWhenIdle")}
        </label>
        {status?.lastError ? (
          <p className="playit-help">
            {t("tunnels.playit.lastError", { error: status.lastError })}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="danger-text" role="alert">
          {error.message}
        </p>
      ) : null}
    </section>
  );
}
