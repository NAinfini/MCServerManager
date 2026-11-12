import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Code, Group, Stack, Text } from "@mantine/core";
import { AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAppSettings } from "../../i18n";
import {
  disableCrashedMod,
  getCrashExplanation,
  startServer,
} from "../process/api";
import { processKeys } from "../process/queries";
import { useServerRuntime } from "./ServerRuntimeContext";

/* A crashed server says why, and offers the fix when there is one. */
export function CrashBanner({ serverId }: { serverId: string }) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const runtime = useServerRuntime();
  const crashed = runtime.status === "crashed";
  const explanationQuery = useQuery({
    queryKey: [...processKeys.status(serverId), "crash"],
    queryFn: () => getCrashExplanation(serverId),
    enabled: crashed,
  });
  const fixMutation = useMutation({
    mutationFn: async (modFile: string) => {
      await disableCrashedMod(serverId, modFile);
      await startServer(serverId);
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: processKeys.status(serverId),
        }),
        queryClient.invalidateQueries({ queryKey: processKeys.summary }),
      ]),
  });
  const explanation = explanationQuery.data;
  if (!crashed || !explanation) return null;
  const mod = explanation.modName ?? explanation.modFile ?? "";

  return (
    <Alert
      color="red"
      icon={<AlertTriangle aria-hidden="true" size={16} />}
      mb="sm"
      mx="lg"
      role="alert"
      title={t(`crash.${explanation.kind}.title`, { mod })}
    >
      <Stack gap="xs">
        <Text size="sm">
          {t(`crash.${explanation.kind}.description`, { mod })}
        </Text>
        {explanation.detail ? (
          <Code block mah={160} style={{ overflow: "auto" }}>
            {explanation.detail}
          </Code>
        ) : null}
        {explanation.reportFile ? (
          <Text c="dimmed" size="xs">
            {t("crash.report", { file: explanation.reportFile })}
          </Text>
        ) : null}
        {fixMutation.error ? (
          <Text c="red" size="xs">
            {fixMutation.error.message}
          </Text>
        ) : null}
        {explanation.kind === "clientOnlyMod" && explanation.modFile ? (
          <Group>
            <Button
              disabled={fixMutation.isPending}
              variant="primary"
              onClick={() => fixMutation.mutate(explanation.modFile as string)}
            >
              {t("crash.disableAndRestart")}
            </Button>
          </Group>
        ) : null}
      </Stack>
    </Alert>
  );
}
