import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Anchor,
  Box,
  Code,
  Group,
  Paper,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { Check, Copy } from "lucide-react";
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

  const playitColor =
    playitState === "running"
      ? "green.6"
      : playitState === "starting"
        ? "yellow.6"
        : playitState === "disconnected"
          ? "red.6"
          : "gray.6";

  return (
    <Paper mb="sm" mx="lg" px="md" py={6}>
      <Group gap="xs" justify="space-between">
        <Group gap="sm" miw={0} wrap="nowrap">
          <Text c="dimmed" size="sm">
            {publicAddress
              ? t("server.share.publicLabel")
              : t("server.share.local")}
          </Text>
          <Code fw={600} fz="sm">
            {address ?? "—"}
          </Code>
          <Button
            aria-label={t("server.connection.copy")}
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
            {copyState === "copied" ? (
              <Check aria-hidden="true" size={14} />
            ) : (
              <Copy aria-hidden="true" size={14} />
            )}
            {copyState === "copied"
              ? t("server.share.copied")
              : copyState === "failed"
                ? t("server.share.copyFailed")
                : t("server.share.copy")}
          </Button>
          {publicAddress ? null : (
            <Anchor component="button" size="sm" onClick={onOpenNetwork}>
              {t("server.share.setup")}
            </Anchor>
          )}
        </Group>
        <Group gap="md" wrap="nowrap">
          {showPlayit && playitState ? (
            <UnstyledButton
              data-state={playitState}
              title={t("server.share.playit.hint")}
              onClick={onOpenNetwork}
            >
              <Group gap={6} wrap="nowrap">
                <Box
                  aria-hidden="true"
                  bg={playitColor}
                  h={8}
                  style={{ borderRadius: "50%" }}
                  w={8}
                />
                <Text size="sm">{t(playitStateLabels[playitState])}</Text>
              </Group>
            </UnstyledButton>
          ) : null}
          <Text c="dimmed" size="sm">
            {latestBackup
              ? t("server.share.lastBackup", {
                  time: formatDate(latestBackup.createdAt, language),
                })
              : t("server.share.noBackup")}
          </Text>
        </Group>
      </Group>
    </Paper>
  );
}
