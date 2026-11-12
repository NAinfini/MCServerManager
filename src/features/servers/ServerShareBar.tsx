import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { useAppSettings } from "../../i18n";
import { formatDate } from "../../lib/date-format";
import { listServerBackups } from "../backups/backupApi";
import { backupKeys } from "../backups/queries";
import {
  usePlayitStatus,
  useServerShareSettings,
  type PlayitState,
} from "../tunnels/playitApi";
import type { ServerProfile } from "./types";

/* "What's the address?" is the question this app gets asked most, so the answer
   stays on screen. Localhost is labelled as local: it must never read like
   something a friend could use. */
const playitStateLabels: Record<PlayitState, string> = {
  not_installed: "server.share.playit.notInstalled",
  needs_setup: "server.share.playit.needsSetup",
  stopped: "server.share.playit.stopped",
  starting: "server.share.playit.starting",
  running: "server.share.playit.running",
  disconnected: "server.share.playit.disconnected",
};

export function ServerShareBar({
  server,
  onOpenNetwork,
}: {
  server: ServerProfile;
  onOpenNetwork: () => void;
}) {
  const { language, t } = useAppSettings();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  useEffect(() => setCopyState("idle"), [server.serverPort]);
  const backupsQuery = useQuery({
    queryKey: backupKeys.list(server.id),
    queryFn: () => listServerBackups(server.id),
  });
  const latestBackup = [...(backupsQuery.data ?? [])].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )[0];
  const localAddress = server.serverPort
    ? `localhost:${server.serverPort}`
    : null;
  const shareQuery = useServerShareSettings(server.id);
  const playitQuery = usePlayitStatus();
  const publicAddress = shareQuery.data?.publicAddress ?? null;
  const playitState = playitQuery.data?.state;
  const showPlayit =
    playitState != null &&
    (publicAddress != null || shareQuery.data?.startTunnelWithServer === true);
  const address = publicAddress ?? localAddress;

  return (
    <div className="server-share-bar">
      <div className="server-share-address">
        <span className="server-share-label">
          {publicAddress ? t("server.share.publicLabel") : t("server.share.local")}
        </span>
        <code>{address ?? "—"}</code>
        <Button
          aria-label={t("server.connection.copy")}
          className="button-small"
          disabled={!address}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(address ?? "");
              setCopyState("copied");
            } catch {
              setCopyState("failed");
            }
          }}
        >
          {copyState === "copied"
            ? t("server.share.copied")
            : copyState === "failed"
              ? t("server.share.copyFailed")
              : t("server.share.copy")}
        </Button>
        {publicAddress ? null : (
          <button
            className="server-share-link"
            type="button"
            onClick={onOpenNetwork}
          >
            {t("server.share.setup")}
          </button>
        )}
      </div>
      <div className="server-share-status">
        {showPlayit && playitState ? (
          <button
            className="server-share-playit"
            data-state={playitState}
            title={t("server.share.playit.hint")}
            type="button"
            onClick={onOpenNetwork}
          >
            <span aria-hidden="true" className="server-share-dot" />
            {t(playitStateLabels[playitState])}
          </button>
        ) : null}
        {latestBackup
          ? t("server.share.lastBackup", {
              time: formatDate(latestBackup.createdAt, language),
            })
          : t("server.share.noBackup")}
      </div>
    </div>
  );
}
