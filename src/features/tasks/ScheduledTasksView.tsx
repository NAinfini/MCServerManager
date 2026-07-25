import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Power, Trash2, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { EmptyState } from "../../components/ui/empty-state";
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { formatDateTime } from "../../lib/date-format";
import { queryKeys } from "../../lib/query-keys";
import type { ServerProfile } from "../../domain/server";
import { TaskEditorDialog, type ScheduledTaskKind } from "./TaskEditorDialog";

interface ScheduledTask {
  id: string;
  name: string;
  kind: ScheduledTaskKind;
  intervalMinutes: number;
  command: string | null;
  enabled: number;
  nextRunAt: string;
  lastRunAt: string | null;
}

interface ScheduledTaskRun {
  id: string;
  taskId: string;
  status: string;
  message: string;
  scheduledFor: string;
  startedAt: string;
}

interface ScheduledTasksViewProps {
  server: ServerProfile;
}

interface TaskFormInput {
  name: string;
  kind: ScheduledTaskKind;
  intervalMinutes: number;
  command?: string | null;
}

function runStatusClass(status: string) {
  if (status === "completed" || status === "success")
    return "task-run-status task-run-status-completed";
  if (status === "failed" || status === "error")
    return "task-run-status task-run-status-failed";
  return "task-run-status";
}

function runStatusLabel(status: string, t: (key: string) => string) {
  if (status === "completed" || status === "success") {
    return t("tasks.runStatus.completed");
  }
  if (status === "failed" || status === "error") {
    return t("tasks.runStatus.failed");
  }
  return t("tasks.runStatus.unknown");
}

function taskKindLabel(kind: ScheduledTaskKind, t: (key: string) => string) {
  const keys: Record<ScheduledTaskKind, string> = {
    start: "tasks.kind.start",
    stop: "tasks.kind.stop",
    restart: "tasks.kind.restart",
    world_backup: "tasks.kind.worldBackup",
    command: "tasks.kind.command",
    server_update_check: "tasks.kind.serverUpdateCheck",
    content_update_check: "tasks.kind.contentUpdateCheck",
  };
  return t(keys[kind]);
}

export function ScheduledTasksView({ server }: ScheduledTasksViewProps) {
  const { language, t } = useAppSettings();
  const queryClient = useQueryClient();
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [deleteTask, setDeleteTask] = useState<ScheduledTask | null>(null);
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks.definitions(server.id),
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<ScheduledTask[]>(
        "list_scheduled_tasks",
        {
          serverId: server.id,
        },
      ),
  });
  const runsQuery = useQuery({
    queryKey: queryKeys.tasks.runs(server.id),
    queryFn: () =>
      invokeDesktopCommandWithErrorHandling<ScheduledTaskRun[]>(
        "list_scheduled_task_runs",
        {
          serverId: server.id,
        },
      ),
  });
  const createMutation = useMutation({
    mutationFn: (input: TaskFormInput) =>
      invokeDesktopCommandWithErrorHandling<ScheduledTask>(
        "create_scheduled_task",
        {
          input: {
            serverId: server.id,
            ...input,
          },
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.definitions(server.id),
      });
    },
  });
  const updateMutation = useMutation({
    mutationFn: (
      input: TaskFormInput & { id: string; enabled?: boolean },
    ) =>
      invokeDesktopCommandWithErrorHandling<ScheduledTask>(
        "update_scheduled_task",
        { input },
      ),
    onSuccess: async () => {
      setEditingTask(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.definitions(server.id),
      });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (taskId: string) =>
      invokeDesktopCommandWithErrorHandling<void>("delete_scheduled_task", {
        taskId,
      }),
    onSuccess: async () => {
      setDeleteTask(null);
      setEditingTask(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.definitions(server.id),
      });
    },
  });
  const tasks = tasksQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const isSaving = createMutation.isPending || updateMutation.isPending;

  function handleTaskSubmit(input: TaskFormInput) {
    if (editingTask) {
      updateMutation.mutate({
        id: editingTask.id,
        enabled: editingTask.enabled !== 0,
        ...input,
      });
      return;
    }
    createMutation.mutate(input);
  }

  function toggleTask(task: ScheduledTask) {
    updateMutation.mutate({
      id: task.id,
      name: task.name,
      kind: task.kind,
      intervalMinutes: task.intervalMinutes,
      command: task.command,
      enabled: task.enabled === 0,
    });
  }

  return (
    <section className="settings-panel" aria-label={t("tasks.aria")}>
      <div className="section-heading">
        <h2>{t("tasks.title")}</h2>
        <span>{t("tasks.description")}</span>
      </div>
      <TaskEditorDialog
        key={editingTask?.id ?? "create-task"}
        initialTask={editingTask ?? undefined}
        isSaving={isSaving}
        submitLabel={editingTask ? t("tasks.save") : t("tasks.add")}
        onCreate={handleTaskSubmit}
      />
      {editingTask ? (
        <Button
          disabled={isSaving}
          variant="secondary"
          onClick={() => setEditingTask(null)}
        >
          <X aria-hidden="true" size={15} />
          {t("tasks.cancelEdit")}
        </Button>
      ) : null}
      {createMutation.error ? (
        <p className="danger-text" role="alert">{createMutation.error.message}</p>
      ) : null}
      {updateMutation.error ? (
        <p className="danger-text" role="alert">{updateMutation.error.message}</p>
      ) : null}
      {deleteMutation.error ? (
        <p className="danger-text" role="alert">{deleteMutation.error.message}</p>
      ) : null}
      {tasksQuery.error ? (
        <div className="list-state list-state-error" role="alert">
          <strong>{t("tasks.loadError")}</strong>
          <span>{tasksQuery.error.message}</span>
          <Button variant="secondary" onClick={() => tasksQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

      {!tasksQuery.error && tasks.length === 0 ? (
        <EmptyState
          illustration="/illustrations/no-tasks.png"
          title={t("tasks.empty.title")}
          description={t("tasks.empty.description")}
        />
      ) : (
        <div className="tasks-timeline">
          {tasks.map((task) => (
            <div className="task-item" key={task.id}>
              <div className="task-item-header">
                <span className="task-item-name">{task.name}</span>
                <span className="task-item-kind">
                  {taskKindLabel(task.kind, t)}
                </span>
              </div>
              <div className="task-item-meta">
                <span>{t("tasks.everyMinutes", { minutes: task.intervalMinutes })}</span>
                <span>{t("tasks.next", { date: formatDateTime(task.nextRunAt, language) })}</span>
                <span>
                  {task.enabled
                    ? t("tasks.status.enabled")
                    : t("tasks.status.disabled")}
                </span>
                {task.command ? <span>{task.command}</span> : null}
              </div>
              <div className="task-item-actions">
                <Button
                  disabled={isSaving}
                  variant="secondary"
                  onClick={() => setEditingTask(task)}
                >
                  <Pencil aria-hidden="true" size={14} />
                  {t("tasks.actions.edit")}
                </Button>
                <Button
                  disabled={isSaving}
                  variant="secondary"
                  onClick={() => toggleTask(task)}
                >
                  <Power aria-hidden="true" size={14} />
                  {task.enabled
                    ? t("tasks.actions.disable")
                    : t("tasks.actions.enable")}
                </Button>
                <Button
                  disabled={deleteMutation.isPending}
                  variant="danger"
                  onClick={() => {
                    deleteMutation.reset();
                    setDeleteTask(task);
                  }}
                >
                  <Trash2 aria-hidden="true" size={14} />
                  {t("tasks.actions.delete")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {runsQuery.error ? (
        <div className="list-state list-state-error" role="alert">
          <strong>{t("tasks.runsLoadError")}</strong>
          <span>{runsQuery.error.message}</span>
          <Button variant="secondary" onClick={() => runsQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      {!runsQuery.error && runs.length > 0 ? (
          <div className="task-runs-section">
            <p className="task-runs-heading">{t("tasks.recentRuns")}</p>
            {runs.slice(0, 5).map((run) => (
              <div className="task-run-item" key={run.id}>
                <span className={runStatusClass(run.status)}>
                  {runStatusLabel(run.status, t)}
                </span>
                <span className="task-run-message">{run.message}</span>
                <span className="task-run-time">
                  {formatDateTime(run.startedAt, language)}
                </span>
              </div>
            ))}
          </div>
      ) : null}
      <ConfirmDangerDialog
        confirmLabel={t("danger.labels.deleteTask")}
        description={t("danger.task.delete.description", {
          task: deleteTask?.name ?? "",
        })}
        error={deleteMutation.error?.message ?? null}
        isConfirming={deleteMutation.isPending}
        isOpen={deleteTask !== null}
        title={t("danger.task.delete.title")}
        onCancel={() => setDeleteTask(null)}
        onConfirm={() => {
          if (deleteTask) {
            deleteMutation.mutate(deleteTask.id);
          }
        }}
      />
    </section>
  );
}
