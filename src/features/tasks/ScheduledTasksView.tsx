import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Power, Trash2, X } from "lucide-react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
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

function runStatusColor(status: string) {
  if (status === "completed" || status === "success") return "green";
  if (status === "failed" || status === "error") return "red";
  return "gray";
}

function runStatusLabel(status: string, t: (key: string) => string) {
  if (status === "completed" || status === "success") {
    return t("tasks.runStatus.completed");
  }
  if (status === "failed" || status === "error") {
    return t("tasks.runStatus.failed");
  }
  if (status === "skipped") {
    return t("tasks.runStatus.skipped");
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
        <Stack gap={0} miw={180}>
          <Text fw={500} size="sm">
            {task.name}
          </Text>
          <Text c="dimmed" size="xs">
            {taskKindLabel(task.kind, t)}
          </Text>
          {task.backupProfileId ? (
            <Text c="dimmed" size="xs">
              {t("tasks.backup.profile", {
                profile:
                  profileNames.get(task.backupProfileId) ?? t("common.unknown"),
              })}
            </Text>
          ) : null}
        </Stack>
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
        <Badge color={task.enabled ? "green" : "gray"} variant="dot">
          {task.enabled
            ? t("tasks.status.enabled")
            : t("tasks.status.disabled")}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: t("tasks.table.actions"),
      cell: (task) => (
        <Group gap={2} justify="flex-end" wrap="nowrap">
          <Tooltip label={t("tasks.actions.edit")}>
            <ActionIcon
              aria-label={t("tasks.actions.editNamed", { name: task.name })}
              disabled={isSaving}
              onClick={() => {
                updateMutation.reset();
                setComposing(false);
                setEditingTask(task);
              }}
            >
              <Pencil aria-hidden="true" size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip
            label={
              task.enabled
                ? t("tasks.actions.disable")
                : t("tasks.actions.enable")
            }
          >
            <ActionIcon
              aria-label={
                task.enabled
                  ? t("tasks.actions.disableNamed", { name: task.name })
                  : t("tasks.actions.enableNamed", { name: task.name })
              }
              disabled={isSaving}
              onClick={() => toggleTask(task)}
            >
              <Power aria-hidden="true" size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("tasks.actions.delete")}>
            <ActionIcon
              aria-label={t("tasks.actions.deleteNamed", { name: task.name })}
              color="red"
              disabled={deleteMutation.isPending}
              onClick={() => {
                deleteMutation.reset();
                setDeleteTask(task);
              }}
            >
              <Trash2 aria-hidden="true" size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      ),
    },
  ];

  return (
    <Stack aria-label={t("tasks.aria")} component="section" gap="md">
      <Group justify="space-between" wrap="nowrap">
        <Box>
          <Title order={3}>{t("tasks.title")}</Title>
          <Text c="dimmed" size="sm">
            {t("tasks.description")}
          </Text>
        </Box>
        <Button
          disabled={isSaving}
          variant="primary"
          onClick={() => {
            createMutation.reset();
            setEditingTask(null);
            setComposing(true);
          }}
        >
          <Plus aria-hidden="true" size={14} />
          {t("tasks.new")}
        </Button>
      </Group>
      {/* The editor used to sit permanently above the list, so the schedule the
          user came to read started below the fold. It is a composer now, opened
          on demand and closed again once the task is saved. */}
      {editorOpen ? (
        <Paper p="md">
          <Stack gap="md">
            <Group justify="space-between">
              <Title order={4}>
                {editingTask ? t("tasks.editTitle") : t("tasks.newTitle")}
              </Title>
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
                <X aria-hidden="true" size={14} />
                {t("common.cancel")}
              </Button>
            </Group>
            <TaskEditorDialog
              backupProfiles={profiles}
              key={editingTask?.id ?? "create-task"}
              initialTask={editingTask ?? undefined}
              isSaving={isSaving}
              submitLabel={editingTask ? t("tasks.save") : t("tasks.add")}
              onCreate={handleTaskSubmit}
            />
            {profilesQuery.error ? (
              <Alert color="red" py="xs">
                {t("backups.profiles.loadError")}: {profilesQuery.error.message}
              </Alert>
            ) : null}
          </Stack>
        </Paper>
      ) : null}
      {[createMutation, updateMutation, deleteMutation].map(
        (mutation, index) =>
          mutation.error ? (
            <Alert color="red" key={index} py="xs">
              {mutation.error.message}
            </Alert>
          ) : null,
      )}
      {tasksQuery.error ? (
        <Alert color="red" title={t("tasks.loadError")}>
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{tasksQuery.error.message}</Text>
            <Button variant="secondary" onClick={() => tasksQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : null}

      {!tasksQuery.error && tasks.length === 0 ? (
        <Paper p="md">
          <Text fw={600} size="sm">
            {t("tasks.empty.title")}
          </Text>
          <Text c="dimmed" size="sm">
            {t("tasks.empty.description")}
          </Text>
        </Paper>
      ) : (
        <Paper p={0}>
          <Table.ScrollContainer minWidth={720}>
            <DataTable
              caption={t("tasks.title")}
              columns={columns}
              getRowKey={(task) => task.id}
              rows={tasks}
            />
          </Table.ScrollContainer>
        </Paper>
      )}

      {runsQuery.error ? (
        <Alert color="red" title={t("tasks.runsLoadError")}>
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{runsQuery.error.message}</Text>
            <Button variant="secondary" onClick={() => runsQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : null}
      {!runsQuery.error && runs.length > 0 ? (
        <Stack gap="xs">
          <Title order={4}>{t("tasks.recentRuns")}</Title>
          <Paper p={0}>
            <Table verticalSpacing="xs">
              <Table.Tbody>
                {runs.slice(0, 5).map((run) => (
                  <Table.Tr key={run.id}>
                    <Table.Td w={1}>
                      <Badge color={runStatusColor(run.status)}>
                        {runStatusLabel(run.status, t)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={500} size="sm" truncate>
                        {tasks.find((task) => task.id === run.taskId)?.name ??
                          t("common.unknown")}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text c="dimmed" size="sm">
                        {run.message}
                      </Text>
                    </Table.Td>
                    <Table.Td
                      c="dimmed"
                      fz="sm"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {formatDateTime(run.startedAt, language)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        </Stack>
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
    </Stack>
  );
}
