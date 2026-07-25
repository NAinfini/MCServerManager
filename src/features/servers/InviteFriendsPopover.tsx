import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, Network, Play } from "lucide-react";
import { useState } from "react";
import { useAppSettings } from "../../i18n";
import { Button } from "../../components/ui/button";
import {
  listLocalNetworkAddresses,
  listTunnelBindings,
  listTunnelProviders,
  listTunnelStatuses,
  openTunnelApplication,
  tunnelKeys,
} from "../tunnels/api";
import type { ServerProfile } from "./types";

export function InviteFriendsPopover({
  server,
  onConfigureNetwork,
}: {
  server: ServerProfile;
  onConfigureNetwork: () => void;
}) {
  const { t } = useAppSettings();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const addressesQuery = useQuery({
    enabled: open,
    queryKey: tunnelKeys.localAddresses,
    queryFn: listLocalNetworkAddresses,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const providersQuery = useQuery({
    enabled: open,
    queryKey: tunnelKeys.providers,
    queryFn: listTunnelProviders,
  });
  const bindingsQuery = useQuery({
    enabled: open,
    queryKey: tunnelKeys.bindings,
    queryFn: listTunnelBindings,
  });
  const statusesQuery = useQuery({
    enabled: open,
    queryKey: tunnelKeys.statuses,
    queryFn: listTunnelStatuses,
  });
  const binding = bindingsQuery.data?.find(
    (item) => item.serverId === server.id,
  );
  const provider = providersQuery.data?.find(
    (item) => item.id === binding?.providerId,
  );
  const tunnelStatus = statusesQuery.data?.find(
    (item) => item.providerId === binding?.providerId,
  );
  const openTunnelMutation = useMutation({
    mutationFn: openTunnelApplication,
    onSuccess: () => statusesQuery.refetch(),
  });
  const host = addressesQuery.data?.[0]?.address ?? "localhost";
  const address = `${host}:${server.serverPort ?? 25565}`;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopyFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <details
      className="invite-friends"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="button button-secondary">
        <Network aria-hidden="true" size={15} />
        {t("server.invite.action")}
        <ChevronDown aria-hidden="true" size={13} />
      </summary>
      <div className="invite-friends-panel">
        <div className="invite-friends-heading">
          <strong>{t("server.invite.title")}</strong>
          <span>{t("server.invite.description")}</span>
        </div>
        <div className="invite-address">
          <div>
            <span>{t("server.invite.localAddress")}</span>
            <code>{address}</code>
          </div>
          <Button
            aria-label={t("server.invite.copy")}
            type="button"
            variant="ghost"
            onClick={() => void copyAddress()}
          >
            {copied ? (
              <Check aria-hidden="true" size={15} />
            ) : (
              <Copy aria-hidden="true" size={15} />
            )}
          </Button>
        </div>
        {copyFailed ? (
          <p className="danger-text" role="alert">
            {t("server.invite.copyFailed")}
          </p>
        ) : null}
        {binding ? (
          <div className="invite-tunnel-status">
            <div>
              <span>{t("server.invite.tunnel")}</span>
              <strong>{binding.providerName}</strong>
            </div>
            <span
              className={
                tunnelStatus?.status === "running"
                  ? "status-running"
                  : "status-stopped"
              }
            >
              {tunnelStatus?.status === "running"
                ? t("server.invite.tunnelRunning")
                : t("server.invite.tunnelStopped")}
            </span>
            {provider?.kind === "application" &&
            tunnelStatus?.status !== "running" ? (
              <Button
                disabled={openTunnelMutation.isPending}
                type="button"
                variant="secondary"
                onClick={() => openTunnelMutation.mutate(provider.id)}
              >
                <Play aria-hidden="true" size={14} />
                {t("server.invite.startTunnel")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {openTunnelMutation.error ? (
          <p className="danger-text" role="alert">
            {openTunnelMutation.error.message}
          </p>
        ) : null}
        <p>{t("server.invite.remoteHelp")}</p>
        <Button type="button" variant="secondary" onClick={onConfigureNetwork}>
          {t("server.invite.configure")}
        </Button>
      </div>
    </details>
  );
}
