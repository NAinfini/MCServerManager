import { useMutation, useQueryClient } from "@tanstack/react-query";
import { OctagonX, Play, Square } from "lucide-react";
import { Alert, Group, Text, Tooltip } from "@mantine/core";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { StatusBadge } from "../../components/ui/status-badge";
import { useAppSettings } from "../../i18n";
import { useState } from "react";
import {
  forceStopServer,
  restartServerWithCountdown,
  startServer,
  stopServer,
} from "../process/api";
import { processKeys } from "../process/queries";
import type { ServerProfile } from "./types";
import type { ManagedProcessStatus } from "../process/api";
import { useServerRuntime } from "./ServerRuntimeContext";

interface ServerActionsProps {
  server: ServerProfile;
  processStatus?: ManagedProcessStatus;
}

type StartFailureGuide = {
  titleKey: string;
  descriptionKey: string;
};

function startFailureGuide(error: Error | null): StartFailureGuide | null {
  const message = error?.message ?? "";
  if (/server\.jar/i.test(message)) {
    return {
      titleKey: "servers.startHelp.missingJar.title",
      descriptionKey: "servers.startHelp.missingJar.description",
    };
  }
  if (/eula/i.test(message)) {
    return {
      titleKey: "servers.startHelp.eula.title",
      descriptionKey: "servers.startHelp.eula.description",
    };
  }
  if (/java/i.test(message)) {
    return {
      titleKey: "servers.startHelp.java.title",
      descriptionKey: "servers.startHelp.java.description",
    };
  }
  return null;
}

export function ServerActions({ server, processStatus }: ServerActionsProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const runtime = useServerRuntime();
  const [pendingDangerAction, setPendingDangerAction] = useState<
    "stop" | "restart" | "forceStop" | null
  >(null);
  const resolvedStatus = processStatus ?? runtime.status;
  const isRunning = resolvedStatus === "running";
  const isStopping = resolvedStatus === "stopping";
  const isExternalRunning = resolvedStatus === "externalRunning";
  const isCrashed = resolvedStatus === "crashed";
  const isProcessStatusLoading =
    processStatus === undefined && runtime.isLoading;

  const refreshRuntimeState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: processKeys.status(server.id),
      }),
      queryClient.invalidateQueries({
        queryKey: processKeys.events(server.id),
      }),
      queryClient.invalidateQueries({ queryKey: processKeys.summary }),
    ]);
  };

  const startMutation = useMutation({
    mutationFn: () => startServer(server.id),
    onSuccess: refreshRuntimeState,
  });
  const stopMutation = useMutation({
    mutationFn: () => stopServer(server.id),
    onSuccess: refreshRuntimeState,
  });
  const restartMutation = useMutation({
    mutationFn: () => restartServerWithCountdown(server.id),
    onSuccess: refreshRuntimeState,
  });
  const forceStopMutation = useMutation({
    mutationFn: () => forceStopServer(server.id),
    onSuccess: refreshRuntimeState,
  });
  const actionError =
    startMutation.error ??
    stopMutation.error ??
    restartMutation.error ??
    forceStopMutation.error ??
    null;
  const isPending =
    startMutation.isPending ||
    stopMutation.isPending ||
    restartMutation.isPending ||
    forceStopMutation.isPending;
  const clearActionErrors = () => {
    startMutation.reset();
    stopMutation.reset();
    restartMutation.reset();
    forceStopMutation.reset();
  };
  const dangerousActionError =
    pendingDangerAction === "stop"
      ? stopMutation.error
      : pendingDangerAction === "restart"
        ? restartMutation.error
        : pendingDangerAction === "forceStop"
          ? forceStopMutation.error
          : null;
  const dangerKey = pendingDangerAction ?? "stop";
  const startGuide = startFailureGuide(startMutation.error);

  return (
    <Group gap="xs">
      {/* Restart only means something for a server that is up. */}
      {isRunning ? (
        <Tooltip label={t("servers.actions.restart")}>
          <Button
            aria-label={t("servers.actions.restartAria", {
              server: server.name,
            })}
            disabled={isPending || isProcessStatusLoading}
            variant="secondary"
            onClick={() => {
              clearActionErrors();
              setPendingDangerAction("restart");
            }}
          >
            {t("servers.actions.restart")}
          </Button>
        </Tooltip>
      ) : null}
      {/* One primary button: whatever the server can do next. */}
      {isStopping ? (
        <Tooltip label={t("servers.actions.forceStop")}>
          <Button
            aria-label={t("servers.actions.forceStopAria", {
              server: server.name,
            })}
            disabled={isPending}
            variant="danger"
            onClick={() => {
              clearActionErrors();
              setPendingDangerAction("forceStop");
            }}
          >
            <OctagonX aria-hidden="true" size={16} />
            {t("servers.actions.forceStop")}
          </Button>
        </Tooltip>
      ) : isRunning || isExternalRunning ? (
        <Tooltip label={t("servers.actions.stop")}>
          <Button
            aria-label={t("servers.actions.stopAria", { server: server.name })}
            disabled={isExternalRunning || isPending || isProcessStatusLoading}
            variant="danger"
            onClick={() => {
              clearActionErrors();
              setPendingDangerAction("stop");
            }}
          >
            <Square aria-hidden="true" size={16} />
            {t("servers.actions.stop")}
          </Button>
        </Tooltip>
      ) : (
        <Tooltip label={t("servers.actions.start")}>
          <Button
            aria-label={t("servers.actions.startAria", { server: server.name })}
            disabled={isPending || isProcessStatusLoading}
            variant="success"
            onClick={() => {
              clearActionErrors();
              startMutation.mutate();
            }}
          >
            <Play aria-hidden="true" size={16} />
            {t("servers.actions.start")}
          </Button>
        </Tooltip>
      )}
      {/* A crashed server may have an auto-restart pending; stop cancels it. */}
      {isCrashed ? (
        <Tooltip label={t("servers.actions.stop")}>
          <Button
            aria-label={t("servers.actions.stopAria", { server: server.name })}
            disabled={isPending || isProcessStatusLoading}
            variant="secondary"
            onClick={() => {
              clearActionErrors();
              setPendingDangerAction("stop");
            }}
          >
            {t("servers.actions.stop")}
          </Button>
        </Tooltip>
      ) : null}
      {processStatus === undefined && runtime.error ? (
        <Text c="red" size="xs">
          {runtime.error.message}
        </Text>
      ) : null}
      {actionError ? (
        <Text c="red" size="xs">
          {actionError.message}
        </Text>
      ) : null}
      {startGuide ? (
        <Alert
          aria-label={t("servers.startHelp.aria")}
          color="yellow"
          p="xs"
          role="note"
          title={t(startGuide.titleKey)}
          w="100%"
        >
          {t(startGuide.descriptionKey)}
        </Alert>
      ) : null}
      <ConfirmDangerDialog
        confirmLabel={t(`servers.actions.${dangerKey}`)}
        description={t(`danger.server.${dangerKey}.description`, {
          server: server.name,
        })}
        error={dangerousActionError?.message ?? null}
        isConfirming={
          stopMutation.isPending ||
          restartMutation.isPending ||
          forceStopMutation.isPending
        }
        isOpen={pendingDangerAction !== null}
        title={t(`danger.server.${dangerKey}.title`)}
        onCancel={() => setPendingDangerAction(null)}
        onConfirm={() => {
          const close = { onSuccess: () => setPendingDangerAction(null) };
          if (pendingDangerAction === "restart") {
            restartMutation.mutate(undefined, close);
          } else if (pendingDangerAction === "forceStop") {
            forceStopMutation.mutate(undefined, close);
          } else {
            stopMutation.mutate(undefined, close);
          }
        }}
      />
    </Group>
  );
}

export function ServerProcessStatusBadge() {
  const runtime = useServerRuntime();

  if (runtime.error) {
    return (
      <Text c="red" component="span" size="xs">
        {runtime.error.message}
      </Text>
    );
  }

  return <StatusBadge status={runtime.status} />;
}
