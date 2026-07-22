import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw, Square } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { StatusBadge } from "../../components/ui/status-badge";
import { useAppSettings } from "../../i18n";
import { useState } from "react";
import {
  getServerProcessStatus,
  restartServerWithCountdown,
  startServer,
  stopServer,
} from "../process/api";
import type { ServerProfile } from "./types";

interface ServerActionsProps {
  server: ServerProfile;
  compact?: boolean;
}

function ActionTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement;
}) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tooltip-content" sideOffset={6}>
            {label}
            <Tooltip.Arrow className="tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
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

export function ServerActions({ server, compact = false }: ServerActionsProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [pendingDangerAction, setPendingDangerAction] = useState<
    "stop" | "restart" | null
  >(null);
  const processQuery = useQuery({
    queryKey: ["serverProcessStatus", server.id],
    queryFn: () => getServerProcessStatus(server.id),
    refetchInterval: 1500,
  });
  const process = processQuery.data;
  const isRunning = process?.status === "running";
  const isExternalRunning = process?.status === "externalRunning";
  const isCrashed = process?.status === "crashed";
  const isProcessStatusLoading = processQuery.isLoading;

  const refreshRuntimeState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["serverProcessStatus", server.id],
      }),
      queryClient.invalidateQueries({ queryKey: ["processEvents", server.id] }),
      queryClient.invalidateQueries({ queryKey: ["processSummary"] }),
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
  const actionError =
    startMutation.error ?? stopMutation.error ?? restartMutation.error ?? null;
  const isPending =
    startMutation.isPending ||
    stopMutation.isPending ||
    restartMutation.isPending;
  const clearActionErrors = () => {
    startMutation.reset();
    stopMutation.reset();
    restartMutation.reset();
  };
  const dangerousActionError =
    pendingDangerAction === "stop"
      ? stopMutation.error
      : pendingDangerAction === "restart"
        ? restartMutation.error
        : null;
  const startGuide = startFailureGuide(startMutation.error);

  return (
    <div className={compact ? "row-actions" : "server-actions"}>
      <ActionTooltip label={t("servers.actions.start")}>
        <Button
          aria-label={t("servers.actions.startAria", { server: server.name })}
          disabled={
            isRunning || isExternalRunning || isPending || isProcessStatusLoading
          }
          variant={compact ? "ghost" : "primary"}
          onClick={() => {
            clearActionErrors();
            startMutation.mutate();
          }}
        >
          <Play aria-hidden="true" size={15} />
          {compact ? null : t("servers.actions.start")}
        </Button>
      </ActionTooltip>
      <ActionTooltip label={t("servers.actions.stop")}>
        <Button
          aria-label={t("servers.actions.stopAria", { server: server.name })}
          disabled={
            (!isRunning && !isCrashed) || isPending || isProcessStatusLoading
          }
          variant="secondary"
          onClick={() => {
            clearActionErrors();
            setPendingDangerAction("stop");
          }}
        >
          <Square aria-hidden="true" size={15} />
          {compact ? null : t("servers.actions.stop")}
        </Button>
      </ActionTooltip>
      <ActionTooltip label={t("servers.actions.restart")}>
        <Button
          aria-label={t("servers.actions.restartAria", { server: server.name })}
          disabled={isExternalRunning || isPending || isProcessStatusLoading}
          variant="secondary"
          onClick={() => {
            clearActionErrors();
            setPendingDangerAction("restart");
          }}
        >
          <RefreshCw aria-hidden="true" size={15} />
          {compact ? null : t("servers.actions.restart")}
        </Button>
      </ActionTooltip>
      {processQuery.error ? (
        <span className="inline-error">{processQuery.error.message}</span>
      ) : null}
      {actionError ? (
        <span className="inline-error">{actionError.message}</span>
      ) : null}
      {startGuide ? (
        <div
          aria-label={t("servers.startHelp.aria")}
          className="server-action-guidance"
          role="note"
        >
          <strong>{t(startGuide.titleKey)}</strong>
          <span>{t(startGuide.descriptionKey)}</span>
        </div>
      ) : null}
      <ConfirmDangerDialog
        confirmLabel={
          pendingDangerAction === "restart"
            ? t("servers.actions.restart")
            : t("servers.actions.stop")
        }
        description={
          pendingDangerAction === "restart"
            ? t("danger.server.restart.description", { server: server.name })
            : t("danger.server.stop.description", { server: server.name })
        }
        error={dangerousActionError?.message ?? null}
        isConfirming={stopMutation.isPending || restartMutation.isPending}
        isOpen={pendingDangerAction !== null}
        title={
          pendingDangerAction === "restart"
            ? t("danger.server.restart.title")
            : t("danger.server.stop.title")
        }
        onCancel={() => setPendingDangerAction(null)}
        onConfirm={() => {
          if (pendingDangerAction === "restart") {
            restartMutation.mutate(undefined, {
              onSuccess: () => setPendingDangerAction(null),
            });
            return;
          }
          stopMutation.mutate(undefined, {
            onSuccess: () => setPendingDangerAction(null),
          });
        }}
      />
    </div>
  );
}

export function ServerProcessStatusBadge({ serverId }: { serverId: string }) {
  const processQuery = useQuery({
    queryKey: ["serverProcessStatus", serverId],
    queryFn: () => getServerProcessStatus(serverId),
    refetchInterval: 1500,
  });

  if (processQuery.error) {
    return <span className="inline-error">{processQuery.error.message}</span>;
  }

  return <StatusBadge status={processQuery.data?.status ?? "stopped"} />;
}
