import { useState } from "react";
import { useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Square, Archive } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { useAppSettings } from "../../i18n";
import { startServer, stopServer, getServerProcessStatus } from "../process/api";
import { createWorldBackup } from "../backups/backupApi";
import type { ServerProfile } from "./types";

interface BatchActionsProps {
  servers: ServerProfile[];
}

interface BatchProgress {
  action: "start" | "stop" | "backup";
  completed: number;
  total: number;
  failures: number;
}

export function BatchActions({ servers }: BatchActionsProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [isStopAllConfirmOpen, setIsStopAllConfirmOpen] = useState(false);

  const statusQueries = useQueries({
    queries: servers.map((server) => ({
      queryKey: ["serverProcessStatus", server.id],
      queryFn: () => getServerProcessStatus(server.id),
      refetchInterval: 3000,
    })),
  });

  const stoppedServers = servers.filter((_, i) => {
    const status = statusQueries[i]?.data?.status;
    return !status || status === "stopped" || status === "crashed";
  });

  const runningServers = servers.filter((_, i) => {
    const status = statusQueries[i]?.data?.status;
    return status === "running" || status === "externalRunning";
  });

  const startAllMutation = useMutation({
    mutationFn: async () => {
      const targets = stoppedServers;
      setProgress({ action: "start", completed: 0, total: targets.length, failures: 0 });
      let failures = 0;
      for (let i = 0; i < targets.length; i++) {
        try {
          await startServer(targets[i].id);
        } catch {
          failures++;
        }
        setProgress({ action: "start", completed: i + 1, total: targets.length, failures });
      }
      if (failures > 0) {
        throw new Error(`${failures} server(s) failed to start`);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["serverProcessStatus"] });
      queryClient.invalidateQueries({ queryKey: ["processSummary"] });
      setIsStopAllConfirmOpen(false);
      setTimeout(() => setProgress(null), 2000);
    },
  });

  const stopAllMutation = useMutation({
    mutationFn: async () => {
      const targets = runningServers;
      setProgress({ action: "stop", completed: 0, total: targets.length, failures: 0 });
      let failures = 0;
      for (let i = 0; i < targets.length; i++) {
        try {
          await stopServer(targets[i].id);
        } catch {
          failures++;
        }
        setProgress({ action: "stop", completed: i + 1, total: targets.length, failures });
      }
      if (failures > 0) {
        throw new Error(`${failures} server(s) failed to stop`);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["serverProcessStatus"] });
      queryClient.invalidateQueries({ queryKey: ["processSummary"] });
      setTimeout(() => setProgress(null), 2000);
    },
  });

  const backupAllMutation = useMutation({
    mutationFn: async () => {
      const targets = servers;
      setProgress({ action: "backup", completed: 0, total: targets.length, failures: 0 });
      let failures = 0;
      for (let i = 0; i < targets.length; i++) {
        try {
          await createWorldBackup({ serverId: targets[i].id });
        } catch {
          failures++;
        }
        setProgress({ action: "backup", completed: i + 1, total: targets.length, failures });
      }
      if (failures > 0) {
        throw new Error(`${failures} backup(s) failed`);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["serverBackups"] });
      setTimeout(() => setProgress(null), 2000);
    },
  });

  const isBusy = startAllMutation.isPending || stopAllMutation.isPending || backupAllMutation.isPending;

  return (
    <section className="batch-actions" aria-label={t("servers.batch.aria")}>
      <div className="batch-actions-bar">
        <Button
          variant="secondary"
          disabled={stoppedServers.length === 0 || isBusy}
          onClick={() => startAllMutation.mutate()}
        >
          <Play aria-hidden="true" size={14} />
          {t("servers.batch.startAll")} ({stoppedServers.length})
        </Button>
        <Button
          variant="secondary"
          disabled={runningServers.length === 0 || isBusy}
          onClick={() => {
            stopAllMutation.reset();
            setIsStopAllConfirmOpen(true);
          }}
        >
          <Square aria-hidden="true" size={14} />
          {t("servers.batch.stopAll")} ({runningServers.length})
        </Button>
        <Button
          variant="secondary"
          disabled={servers.length === 0 || isBusy}
          onClick={() => backupAllMutation.mutate()}
        >
          <Archive aria-hidden="true" size={14} />
          {t("servers.batch.backupAll")} ({servers.length})
        </Button>
      </div>

      {progress ? (
        <p className="batch-progress">
          {t("servers.batch.progress", {
            action: t(`servers.batch.${progress.action}Label`),
            completed: progress.completed,
            total: progress.total,
          })}
          {progress.failures > 0
            ? ` — ${t("servers.batch.failures", { count: progress.failures })}`
            : null}
        </p>
      ) : null}

      {!isBusy && startAllMutation.isError ? (
        <p className="batch-error">{startAllMutation.error.message}</p>
      ) : null}
      {!isBusy && stopAllMutation.isError ? (
        <p className="batch-error">{stopAllMutation.error.message}</p>
      ) : null}
      {!isBusy && backupAllMutation.isError ? (
        <p className="batch-error">{backupAllMutation.error.message}</p>
      ) : null}
      <ConfirmDangerDialog
        confirmLabel={t("danger.labels.stopAllServers")}
        description={t("danger.batch.stopAll.description", {
          count: runningServers.length,
        })}
        error={stopAllMutation.error?.message ?? null}
        isConfirming={stopAllMutation.isPending}
        isOpen={isStopAllConfirmOpen}
        title={t("danger.batch.stopAll.title")}
        onCancel={() => setIsStopAllConfirmOpen(false)}
        onConfirm={() => stopAllMutation.mutate()}
      />
    </section>
  );
}
