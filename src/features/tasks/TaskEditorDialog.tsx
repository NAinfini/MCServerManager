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

interface TaskEditorDialogProps {
  isSaving: boolean;
  initialTask?: {
    name: string;
    kind: ScheduledTaskKind;
    intervalMinutes: number;
    command?: string | null;
  };
  submitLabel?: string;
  onCreate: (input: {
    name: string;
    kind: ScheduledTaskKind;
    intervalMinutes: number;
    command?: string | null;
  }) => void;
}

export function TaskEditorDialog({
  initialTask,
  isSaving,
  onCreate,
  submitLabel,
}: TaskEditorDialogProps) {
  const { t } = useAppSettings();
  const [name, setName] = useState(initialTask?.name ?? "");
  const [kind, setKind] = useState<ScheduledTaskKind>(
    initialTask?.kind ?? "world_backup",
  );
  const [intervalMinutes, setIntervalMinutes] = useState(
    initialTask?.intervalMinutes ?? 1440,
  );
  const [command, setCommand] = useState(initialTask?.command ?? "");
  const [targetMinecraftVersion, setTargetMinecraftVersion] = useState("");
  const [targetLoaderVersion, setTargetLoaderVersion] = useState("");
  const trimmedName = name.trim();
  const trimmedCommand = command.trim();
  const trimmedTargetMinecraftVersion = targetMinecraftVersion.trim();
  const updateTarget = [
    trimmedTargetMinecraftVersion,
    targetLoaderVersion.trim(),
  ]
    .filter(Boolean)
    .join(" ");
  const canSubmit =
    Boolean(trimmedName) &&
    (kind !== "command" || Boolean(trimmedCommand)) &&
    (kind !== "server_update_check" ||
      Boolean(trimmedTargetMinecraftVersion)) &&
    !isSaving;
  const taskKindOptions = [
    { value: "start", label: t("tasks.kind.start") },
    { value: "stop", label: t("tasks.kind.stop") },
    { value: "restart", label: t("tasks.kind.restart") },
    { value: "world_backup", label: t("tasks.kind.worldBackup") },
    { value: "command", label: t("tasks.kind.command") },
    { value: "server_update_check", label: t("tasks.kind.serverUpdateCheck") },
    { value: "content_update_check", label: t("tasks.kind.contentUpdateCheck") },
  ] as const;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate({
      name: trimmedName,
      kind,
      intervalMinutes,
      command:
        kind === "command"
          ? trimmedCommand
          : kind === "server_update_check"
            ? updateTarget
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
        {t("tasks.form.everyMinutes")}
        <TextField
          min={1}
          type="number"
          value={intervalMinutes}
          onChange={(event) => setIntervalMinutes(Number(event.target.value))}
        />
      </label>
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
      {kind === "server_update_check" ? (
        <>
          <label>
            {t("tasks.form.targetMinecraftVersion")}
            <TextField
              placeholder={t("tasks.form.targetVersionPlaceholder")}
              value={targetMinecraftVersion}
              onChange={(event) =>
                setTargetMinecraftVersion(event.target.value)
              }
            />
          </label>
          <label>
            {t("tasks.form.targetLoaderBuild")}
            <TextField
              placeholder={t("tasks.form.loaderBuildPlaceholder")}
              value={targetLoaderVersion}
              onChange={(event) => setTargetLoaderVersion(event.target.value)}
            />
          </label>
        </>
      ) : null}
      <Button disabled={!canSubmit} type="submit" variant="primary">
        {submitLabel ?? t("tasks.add")}
      </Button>
    </form>
  );
}
