import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import {
  Button as MantineButton,
  Divider,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Button } from "../../components/ui/button";
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
    <Paper aria-labelledby="playit-setup-title" component="section" p="md">
      <Stack gap={2} mb="sm">
        <Title id="playit-setup-title" order={3}>
          {t("tunnels.playit.title")}
        </Title>
        <Text c="dimmed" size="sm">
          {t("tunnels.playit.description")}
        </Text>
      </Stack>

      <Stack gap="md">
        <Stack gap={6}>
          <Text fw={600} size="sm">
            {t("tunnels.playit.step.install")}
          </Text>
          {status?.state === "not_installed" ? (
            <>
              <Text size="sm">{t("tunnels.playit.notInstalled")}</Text>
              <Group gap="xs">
                <MantineButton
                  component="a"
                  href={status.downloadUrl}
                  leftSection={<ExternalLink aria-hidden="true" size={16} />}
                  rel="noreferrer"
                  target="_blank"
                  variant="default"
                >
                  {t("tunnels.playit.download")}
                </MantineButton>
                <Button
                  variant="secondary"
                  onClick={() => statusQuery.refetch()}
                >
                  <RefreshCw aria-hidden="true" size={16} />
                  {t("tunnels.playit.recheck")}
                </Button>
              </Group>
            </>
          ) : status?.state === "needs_setup" ? (
            <>
              <Text size="sm">{t("tunnels.playit.needsSetup")}</Text>
              <Group gap="xs">
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
                  <RefreshCw aria-hidden="true" size={16} />
                  {t("tunnels.playit.recheck")}
                </Button>
              </Group>
            </>
          ) : status ? (
            <Text c="dimmed" ff="monospace" size="xs">
              {t("tunnels.playit.found", { path: status.exePath })}
            </Text>
          ) : null}
        </Stack>

        <Divider />

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(false);
            saveShare.mutate(
              { serverId: server.id, publicAddress: trimmed },
              { onSuccess: () => setSaved(true) },
            );
          }}
        >
          <Stack gap={6}>
            <Text component="label" fw={600} htmlFor="playit-address" size="sm">
              {t("tunnels.playit.step.address")}
            </Text>
            <Group gap="xs" wrap="nowrap">
              <TextInput
                aria-label={t("tunnels.playit.addressLabel")}
                ff="monospace"
                flex={1}
                id="playit-address"
                placeholder={t("tunnels.playit.addressPlaceholder")}
                value={address}
                onChange={(event) => {
                  setAddress(event.currentTarget.value);
                  setSaved(false);
                }}
              />
              <Button
                disabled={saveShare.isPending || unchanged}
                style={{ flexShrink: 0 }}
                type="submit"
                variant="secondary"
              >
                {t("tunnels.playit.saveAddress")}
              </Button>
            </Group>
            <Text c={saved ? "green" : "dimmed"} size="xs">
              {saved
                ? t("tunnels.playit.addressSaved")
                : t("tunnels.playit.addressHelp")}
            </Text>
          </Stack>
        </form>

        <Divider />

        <Stack gap="xs">
          <Text fw={600} size="sm">
            {t("tunnels.playit.step.toggle")}
          </Text>
          <Switch
            checked={share?.startTunnelWithServer ?? false}
            description={t("tunnels.playit.startWithServerHelp")}
            disabled={!installed || !share || saveShare.isPending}
            label={t("tunnels.playit.startWithServer")}
            onChange={(event) =>
              saveShare.mutate({
                serverId: server.id,
                startTunnelWithServer: event.currentTarget.checked,
              })
            }
          />
          <Switch
            checked={status?.stopWhenIdle ?? true}
            disabled={!status || saveSettings.isPending}
            label={t("tunnels.playit.stopWhenIdle")}
            onChange={(event) =>
              saveSettings.mutate({ stopWhenIdle: event.currentTarget.checked })
            }
          />
          {status?.lastError ? (
            <Text c="dimmed" size="xs">
              {t("tunnels.playit.lastError", { error: status.lastError })}
            </Text>
          ) : null}
        </Stack>

        {error ? (
          <Text c="red" role="alert" size="sm">
            {error.message}
          </Text>
        ) : null}
      </Stack>
    </Paper>
  );
}
