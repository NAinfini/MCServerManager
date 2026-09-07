import { FormEvent, useState } from "react";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
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
    <form className="create-server-form" onSubmit={handleSubmit}>
      <label>
        {t("tasks.form.name")}
        <TextField
          placeholder={t("tasks.form.name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        {t("tasks.form.action")}
        <Select
          ariaLabel={t("tasks.form.action")}
          options={taskKindOptions}
          value={kind}
          onValueChange={(value) => setKind(value as ScheduledTaskKind)}
        />
      </label>
      <label>
        {t("tasks.form.schedule")}
        <Select
          ariaLabel={t("tasks.form.schedule")}
          options={scheduleKindOptions}
          value={scheduleKind}
          onValueChange={(value) => setScheduleKind(value as ScheduleKind)}
        />
      </label>
      {scheduleKind === "interval" ? (
        <label>
          {t("tasks.form.everyMinutes")}
          <TextField
            min={1}
            required
            type="number"
            value={intervalMinutes}
            onChange={(event) => setIntervalMinutes(Number(event.target.value))}
          />
        </label>
      ) : (
        <>
          <label>
            {t("tasks.form.timeOfDay")}
            <TextField
              required
              type="time"
              value={timeOfDay}
              onChange={(event) => setTimeOfDay(event.target.value)}
            />
          </label>
          <fieldset className="task-weekdays">
            <legend>{t("tasks.form.weekdays")}</legend>
            <div role="group" aria-label={t("tasks.form.weekdays")}>
              {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                const selected = weekdays.includes(day);
                return (
                  <Button
                    aria-pressed={selected}
                    key={day}
                    variant={selected ? "primary" : "secondary"}
                    onClick={() =>
                      setWeekdays((current) =>
                        selected
                          ? current.filter((value) => value !== day)
                          : [...current, day].sort(),
                      )
                    }
                  >
                    {t(`tasks.weekday.${day}`)}
                  </Button>
                );
              })}
            </div>
          </fieldset>
        </>
      )}
      {kind === "command" ? (
        <label>
          {t("tasks.form.command")}
          <TextField
            placeholder={t("tasks.kind.command")}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
          />
        </label>
      ) : null}
      {kind === "world_backup" ? (
        <label>
          {t("tasks.form.backupProfile")}
          <Select
            ariaLabel={t("tasks.form.backupProfile")}
            options={backupProfileOptions}
            value={backupProfileId}
            onValueChange={setBackupProfileId}
          />
        </label>
      ) : null}
      <Button disabled={!canSubmit} type="submit" variant="primary">
        {submitLabel ?? t("tasks.add")}
      </Button>
    </form>
  );
}
