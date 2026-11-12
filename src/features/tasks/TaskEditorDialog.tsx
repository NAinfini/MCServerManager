import { FormEvent, useState } from "react";
import {
  Button as MantineButton,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { useAppSettings } from "../../i18n";

export type ScheduledTaskKind =
  | "start"
  | "stop"
  | "restart"
  | "world_backup"
  | "command"
  | "server_update_check"
  | "content_update_check";

export type ScheduleKind = "interval" | "weekly";

export interface TaskFormInput {
  name: string;
  kind: ScheduledTaskKind;
  scheduleKind: ScheduleKind;
  intervalMinutes: number;
  timeOfDay: string | null;
  weekdays: number[];
  command?: string | null;
  backupProfileId: string | null;
}

interface TaskEditorDialogProps {
  isSaving: boolean;
  initialTask?: {
    name: string;
    kind: ScheduledTaskKind;
    scheduleKind: ScheduleKind;
    intervalMinutes: number;
    timeOfDay: string | null;
    weekdays: number[];
    command?: string | null;
    backupProfileId: string | null;
  };
  backupProfiles?: Array<{ id: string; name: string }>;
  submitLabel?: string;
  onCreate: (input: TaskFormInput) => void;
}

export function TaskEditorDialog({
  initialTask,
  isSaving,
  backupProfiles = [],
  onCreate,
  submitLabel,
}: TaskEditorDialogProps) {
  const { t } = useAppSettings();
  const [name, setName] = useState(initialTask?.name ?? "");
  const [kind, setKind] = useState<ScheduledTaskKind>(
    initialTask?.kind ?? "world_backup",
  );
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>(
    initialTask?.scheduleKind ?? "interval",
  );
  const [intervalMinutes, setIntervalMinutes] = useState(
    initialTask?.intervalMinutes ?? 1440,
  );
  const [command, setCommand] = useState(initialTask?.command ?? "");
  const [timeOfDay, setTimeOfDay] = useState(initialTask?.timeOfDay ?? "03:00");
  const [weekdays, setWeekdays] = useState<number[]>(
    initialTask?.weekdays?.length ? initialTask.weekdays : [1, 2, 3, 4, 5],
  );
  const [backupProfileId, setBackupProfileId] = useState(
    initialTask?.backupProfileId ?? "__default__",
  );
  const trimmedName = name.trim();
  const trimmedCommand = command.trim();
  const canSubmit =
    Boolean(trimmedName) &&
    (scheduleKind !== "interval" ||
      (Number.isFinite(intervalMinutes) && intervalMinutes > 0)) &&
    (scheduleKind !== "weekly" ||
      (/^\d{2}:\d{2}$/.test(timeOfDay) && weekdays.length > 0)) &&
    (kind !== "command" || Boolean(trimmedCommand)) &&
    !isSaving;
  const taskKindOptions = [
    { value: "start", label: t("tasks.kind.start") },
    { value: "stop", label: t("tasks.kind.stop") },
    { value: "restart", label: t("tasks.kind.restart") },
    { value: "world_backup", label: t("tasks.kind.worldBackup") },
    { value: "command", label: t("tasks.kind.command") },
    { value: "server_update_check", label: t("tasks.kind.serverUpdateCheck") },
    {
      value: "content_update_check",
      label: t("tasks.kind.contentUpdateCheck"),
    },
  ] as const;
  const scheduleKindOptions = [
    { value: "interval", label: t("tasks.schedule.interval") },
    { value: "weekly", label: t("tasks.schedule.weekly") },
  ] as const;
  const backupProfileOptions = [
    { value: "__default__", label: t("tasks.backup.defaultProfile") },
    ...backupProfiles.map((profile) => ({
      value: profile.id,
      label: profile.name,
    })),
  ];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate({
      name: trimmedName,
      kind,
      scheduleKind,
      intervalMinutes,
      timeOfDay: scheduleKind === "weekly" ? timeOfDay : null,
      weekdays: scheduleKind === "weekly" ? weekdays : [],
      command: kind === "command" ? trimmedCommand : null,
      backupProfileId:
        kind === "world_backup" && backupProfileId !== "__default__"
          ? backupProfileId
          : null,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <TextInput
            autoComplete="off"
            label={t("tasks.form.name")}
            placeholder={t("tasks.form.name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Stack gap={4}>
            <Text fw={500} size="sm">
              {t("tasks.form.action")}
            </Text>
            <Select
              ariaLabel={t("tasks.form.action")}
              options={taskKindOptions}
              value={kind}
              onValueChange={(value) => setKind(value as ScheduledTaskKind)}
            />
          </Stack>
          <Stack gap={4}>
            <Text fw={500} size="sm">
              {t("tasks.form.schedule")}
            </Text>
            <Select
              ariaLabel={t("tasks.form.schedule")}
              options={scheduleKindOptions}
              value={scheduleKind}
              onValueChange={(value) => setScheduleKind(value as ScheduleKind)}
            />
          </Stack>
        </SimpleGrid>
        {scheduleKind === "interval" ? (
          <NumberInput
            allowDecimal={false}
            allowNegative={false}
            label={t("tasks.form.everyMinutes")}
            maw={220}
            min={1}
            required
            value={intervalMinutes}
            withAsterisk={false}
            onChange={(value) => setIntervalMinutes(Number(value))}
          />
        ) : (
          <Group align="flex-end" gap="md">
            <TextInput
              label={t("tasks.form.timeOfDay")}
              required
              type="time"
              value={timeOfDay}
              w={140}
              withAsterisk={false}
              onChange={(event) => setTimeOfDay(event.target.value)}
            />
            <Stack gap={4}>
              <Text fw={500} size="sm">
                {t("tasks.form.weekdays")}
              </Text>
              {/* Fixed-width toggles in one strip: selecting or hovering a day
                  never shifts its neighbours. */}
              <MantineButton.Group aria-label={t("tasks.form.weekdays")}>
                {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                  const selected = weekdays.includes(day);
                  return (
                    <MantineButton
                      aria-pressed={selected}
                      key={day}
                      px={0}
                      variant={selected ? "filled" : "default"}
                      w={52}
                      onClick={() =>
                        setWeekdays((current) =>
                          selected
                            ? current.filter((value) => value !== day)
                            : [...current, day].sort(),
                        )
                      }
                    >
                      {t(`tasks.weekday.${day}`)}
                    </MantineButton>
                  );
                })}
              </MantineButton.Group>
            </Stack>
          </Group>
        )}
        {kind === "command" ? (
          <TextInput
            autoComplete="off"
            ff="monospace"
            label={t("tasks.form.command")}
            placeholder={t("tasks.kind.command")}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
          />
        ) : null}
        {kind === "world_backup" ? (
          <Stack gap={4} maw={320}>
            <Text fw={500} size="sm">
              {t("tasks.form.backupProfile")}
            </Text>
            <Select
              ariaLabel={t("tasks.form.backupProfile")}
              options={backupProfileOptions}
              value={backupProfileId}
              onValueChange={setBackupProfileId}
            />
          </Stack>
        ) : null}
        <Group justify="flex-end">
          <Button disabled={!canSubmit} type="submit" variant="primary">
            {submitLabel ?? t("tasks.add")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
