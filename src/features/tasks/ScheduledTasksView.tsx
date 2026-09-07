import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { EmptyState } from "../../components/ui/empty-state";
import {
  DataTable,
  type DataTableColumn,
} from "../../components/data/DataTable";
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { formatDateTime } from "../../lib/date-format";
import { formatMinutes } from "../../lib/format-units";
import { queryKeys } from "../../lib/query-keys";
import type { ServerProfile } from "../../domain/server";
import { listBackupProfiles } from "../backups/backupApi";
import { backupKeys } from "../backups/queries";
import {
  TaskEditorDialog,
  type ScheduleKind,
  type ScheduledTaskKind,
  type TaskFormInput,
} from "./TaskEditorDialog";
import "../files/operations.css";

interface ScheduledTask {
  id: string;
  name: string;
  kind: ScheduledTaskKind;
  scheduleKind: ScheduleKind;
  intervalMinutes: number;
  timeOfDay: string | null;
  weekdays: number[];
  command: string | null;
  backupProfileId: string | null;
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
  const [composing, setComposing] = useState(false);
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
  const profilesQuery = useQuery({
    queryKey: backupKeys.profiles(server.id),
    queryFn: () => listBackupProfiles(server.id),
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
      setComposing(false);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.definitions(server.id),
      });
    },
  });
  const updateMutation = useMutation({
    mutationFn: (input: TaskFormInput & { id: string; enabled?: boolean }) =>
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
  const profiles = Array.isArray(profilesQuery.data) ? profilesQuery.data : [];
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const editorOpen = composing || editingTask !== null;

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
      scheduleKind: task.scheduleKind ?? "interval",
      intervalMinutes: task.intervalMinutes,
      timeOfDay: task.timeOfDay ?? null,
      weekdays: task.weekdays ?? [],
      command: task.command,
      backupProfileId: task.backupProfileId ?? null,
      enabled: task.enabled === 0,
    });
  }

  const profileNames = new Map(
    profiles.map((profile) => [profile.id, profile.name]),
  );
  const scheduleLabel = (task: ScheduledTask) => {
    if (task.scheduleKind === "weekly") {
      const days = (task.weekdays ?? [])
        .map((day) => t(`tasks.weekday.${day}`))
        .join(t("tasks.weekday.separator"));
      return t("tasks.weeklyAt", {
        days,
        time: task.timeOfDay ?? t("common.unknown"),
      });
    }
    return t("tasks.every", {
      interval: formatMinutes(task.intervalMinutes, t),
    });
  };
  const columns: DataTableColumn<ScheduledTask>[] = [
    {
      id: "name",
      header: t("tasks.table.task"),
      rowHeader: true,
      sortValue: (task) => task.name,
      cell: (task) => (
        <div className="task-table-name">
          <strong>{task.name}</strong>
          <span>{taskKindLabel(task.kind, t)}</span>
          {task.backupProfileId ? (
            <small>
              {t("tasks.backup.profile", {
                profile:
                  profileNames.get(task.backupProfileId) ?? t("common.unknown"),
              })}
            </small>
          ) : null}
        </div>
      ),
    },
    {
      id: "schedule",
      header: t("tasks.table.schedule"),
      cell: scheduleLabel,
    },
    {
      id: "next",
      header: t("tasks.table.next"),
      sortValue: (task) => task.nextRunAt,
      cell: (task) => formatDateTime(task.nextRunAt, language),
    },
    {
      id: "status",
      header: t("tasks.table.status"),
      sortValue: (task) => task.enabled,
      cell: (task) => (
        <span
          className={
            task.enabled
              ? "operation-status-enabled"
              : "operation-status-disabled"
          }
        >
          {task.enabled
            ? t("tasks.status.enabled")
            : t("tasks.status.disabled")}
        </span>
      ),
    },
    {
      id: "actions",
      header: t("tasks.table.actions"),
      cell: (task) => (
        <div className="operation-table-actions">
          <Button
            aria-label={t("tasks.actions.editNamed", { name: task.name })}
            className="icon-button"
            disabled={isSaving}
            title={t("tasks.actions.edit")}
            variant="ghost"
            onClick={() => {
              updateMutation.reset();
              setComposing(false);
              setEditingTask(task);
            }}
          >
            <Pencil aria-hidden="true" size={14} />
          </Button>
          <Button
            aria-label={
              task.enabled
                ? t("tasks.actions.disableNamed", { name: task.name })
                : t("tasks.actions.enableNamed", { name: task.name })
            }
            className="icon-button"
            disabled={isSaving}
            title={
              task.enabled
                ? t("tasks.actions.disable")
                : t("tasks.actions.enable")
            }
            variant="ghost"
            onClick={() => toggleTask(task)}
          >
            <Power aria-hidden="true" size={14} />
          </Button>
          <Button
            aria-label={t("tasks.actions.deleteNamed", { name: task.name })}
            className="icon-button"
            disabled={deleteMutation.isPending}
            title={t("tasks.actions.delete")}
            variant="danger"
            onClick={() => {
              deleteMutation.reset();
              setDeleteTask(task);
            }}
          >
            <Trash2 aria-hidden="true" size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section className="settings-panel" aria-label={t("tasks.aria")}>
      <div className="section-heading">
        <div className="section-heading-copy">
          <h2>{t("tasks.title")}</h2>
          <span>{t("tasks.description")}</span>
        </div>
        <Button
          disabled={isSaving}
          variant="primary"
          onClick={() => {
            createMutation.reset();
            setEditingTask(null);
            setComposing(true);
          }}
        >
          <Plus aria-hidden="true" size={15} />
          {t("tasks.new")}
        </Button>
      </div>
      {/* The editor used to sit permanently above the list, so the schedule the
          user came to read started below the fold. It is a composer now, opened
          on demand and closed again once the task is saved. */}
      {editorOpen ? (
        <div className="task-editor">
          <div className="task-editor-head">
            <strong>
              {editingTask ? t("tasks.editTitle") : t("tasks.newTitle")}
            </strong>
            <Button
              disabled={isSaving}
              variant="ghost"
              onClick={() => {
                createMutation.reset();
                updateMutation.reset();
                setEditingTask(null);
                setComposing(false);
              }}
            >
              <X aria-hidden="true" size={15} />
              {t("common.cancel")}
            </Button>
          </div>
          <TaskEditorDialog
            backupProfiles={profiles}
            key={editingTask?.id ?? "create-task"}
            initialTask={editingTask ?? undefined}
            isSaving={isSaving}
            submitLabel={editingTask ? t("tasks.save") : t("tasks.add")}
            onCreate={handleTaskSubmit}
          />
          {profilesQuery.error ? (
            <p className="danger-text" role="alert">
              {t("backups.profiles.loadError")}: {profilesQuery.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
      {createMutation.error ? (
        <p className="danger-text" role="alert">
          {createMutation.error.message}
        </p>
      ) : null}
      {updateMutation.error ? (
        <p className="danger-text" role="alert">
          {updateMutation.error.message}
        </p>
      ) : null}
      {deleteMutation.error ? (
        <p className="danger-text" role="alert">
          {deleteMutation.error.message}
        </p>
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
        <div className="operation-table-scroll tasks-table-scroll">
          <DataTable
            caption={t("tasks.title")}
            className="operation-table tasks-table"
            columns={columns}
            getRowKey={(task) => task.id}
            rows={tasks}
          />
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
              <strong className="task-run-name">
                {tasks.find((task) => task.id === run.taskId)?.name ??
                  t("common.unknown")}
              </strong>
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
