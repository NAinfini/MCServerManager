import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Save, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { PathField } from "../../components/ui/path-field";
import { Select } from "../../components/ui/select";
import { StickyActionBar } from "../../components/ui/sticky-action-bar";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import { useUnsavedGuard } from "../../lib/use-unsaved-guard";
import { deleteServerProfile, updateServerProfile } from "./api";
import { serverKeys } from "./queries";
import type { LoaderType, ServerProfile } from "./types";

interface ServerProfileSettingsProps {
  server: ServerProfile;
}

const loaderOptions = [
  { value: "vanilla", label: "Vanilla" },
  { value: "paper", label: "Paper" },
  { value: "fabric", label: "Fabric" },
  { value: "forge", label: "Forge" },
  { value: "neoForge", label: "NeoForge" },
  { value: "quilt", label: "Quilt" },
] as const;

const optionalInteger = z
  .string()
  .refine(
    (value) =>
      value.trim() === "" ||
      (Number.isInteger(Number(value)) && Number(value) >= 0),
    "nonNegativeInteger",
  );

const profileSchema = z
  .object({
    name: z.string().trim().min(1, "nameRequired"),
    rootDir: z.string().trim().min(1, "folderRequired"),
    minecraftVersion: z.string(),
    loaderType: z.enum([
      "vanilla",
      "paper",
      "fabric",
      "forge",
      "neoForge",
      "quilt",
    ]),
    loaderVersion: z.string(),
    javaPath: z.string(),
    serverPort: z
      .string()
      .refine(
        (value) =>
          Number.isInteger(Number(value)) &&
          Number(value) >= 1 &&
          Number(value) <= 65535,
        "port",
      ),
    minMemoryMb: optionalInteger,
    maxMemoryMb: optionalInteger,
    autoStart: z.boolean(),
    restartEnabled: z.boolean(),
    restartAttempts: optionalInteger,
    restartCooldown: optionalInteger,
  })
  .superRefine((values, context) => {
    const min = values.minMemoryMb.trim() ? Number(values.minMemoryMb) : null;
    const max = values.maxMemoryMb.trim() ? Number(values.maxMemoryMb) : null;
    if (min !== null && max !== null && min > max) {
      context.addIssue({
        code: "custom",
        message: "memoryOrder",
        path: ["maxMemoryMb"],
      });
    }
  });

type ServerProfileForm = z.infer<typeof profileSchema>;

function numberOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

function profileDefaults(server: ServerProfile): ServerProfileForm {
  return {
    name: server.name,
    rootDir: server.rootDir,
    minecraftVersion: server.minecraftVersion ?? "",
    loaderType: server.loaderType,
    loaderVersion: server.loaderVersion ?? "",
    javaPath: server.javaPath ?? "",
    serverPort: String(server.serverPort ?? ""),
    minMemoryMb: String(server.minMemoryMb ?? ""),
    maxMemoryMb: String(server.maxMemoryMb ?? ""),
    autoStart: server.autoStart,
    restartEnabled: server.restartPolicy.enabled,
    restartAttempts: String(server.restartPolicy.maxAttempts),
    restartCooldown: String(server.restartPolicy.cooldownSeconds),
  };
}

export function ServerProfileSettings({ server }: ServerProfileSettingsProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [folderPickerError, setFolderPickerError] = useState<string | null>(
    null,
  );
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteFromDisk, setDeleteFromDisk] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const form = useForm<ServerProfileForm>({
    defaultValues: profileDefaults(server),
    resolver: zodResolver(profileSchema),
  });

  useEffect(() => {
    if (!form.formState.isDirty) {
      form.reset(profileDefaults(server));
    }
  }, [form, form.formState.isDirty, server]);

  useUnsavedGuard({
    isDirty: form.formState.isDirty,
    message: t("profileSettings.unsaved.confirm"),
    onDiscard: () => form.reset(profileDefaults(server)),
  });

  const validationMessage = (message?: string) =>
    message ? t(`profileSettings.validation.${message}`) : null;

  const pickServerFolder = async () => {
    setFolderPickerError(null);
    try {
      const result = await invokeDesktopCommand<{ path: string | null }>(
        "show_open_dialog",
        { kind: "folder" },
      );
      if (result?.path) {
        form.setValue("rootDir", result.path, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    } catch (caught) {
      setFolderPickerError(
        caught instanceof Error
          ? caught.message
          : t("profileSettings.folderPickerError"),
      );
    }
  };

  const updateMutation = useMutation({
    mutationFn: (input: ServerProfileForm) =>
      updateServerProfile({
        id: server.id,
        name: input.name.trim(),
        rootDir: input.rootDir.trim(),
        minecraftVersion: input.minecraftVersion.trim() || null,
        loaderType: input.loaderType,
        loaderVersion: input.loaderVersion.trim() || null,
        javaPath: input.javaPath.trim() || null,
        serverPort: numberOrNull(input.serverPort),
        minMemoryMb: numberOrNull(input.minMemoryMb),
        maxMemoryMb: numberOrNull(input.maxMemoryMb),
        autoStart: input.autoStart,
        restartPolicy: {
          enabled: input.restartEnabled,
          maxAttempts: Number(input.restartAttempts || 0),
          cooldownSeconds: Number(input.restartCooldown || 0),
        },
      }),
    onSuccess: async (saved, submitted) => {
      setRestartRequired(
        submitted.rootDir !== server.rootDir ||
          submitted.loaderType !== server.loaderType ||
          submitted.minecraftVersion !== (server.minecraftVersion ?? "") ||
          submitted.loaderVersion !== (server.loaderVersion ?? "") ||
          submitted.javaPath !== (server.javaPath ?? "") ||
          submitted.serverPort !== String(server.serverPort ?? "") ||
          submitted.minMemoryMb !== String(server.minMemoryMb ?? "") ||
          submitted.maxMemoryMb !== String(server.maxMemoryMb ?? ""),
      );
      form.reset(saved ? profileDefaults(saved) : submitted);
      await queryClient.invalidateQueries({ queryKey: serverKeys.profiles });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteServerProfile(server.id, deleteFromDisk),
    onSuccess: async () => {
      setIsDeleteConfirmOpen(false);
      setDeleteFromDisk(false);
      await queryClient.invalidateQueries({ queryKey: serverKeys.profiles });
    },
  });

  return (
    <section
      className="settings-panel"
      aria-labelledby="profile-settings-title"
    >
      <div className="section-heading">
        <h2 id="profile-settings-title">{t("profileSettings.title")}</h2>
        <span>{t("profileSettings.description")}</span>
      </div>
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
      {restartRequired ? (
        <p className="settings-notice" role="status">
          {t("profileSettings.restartRequired")}
        </p>
      ) : null}
      <form
        onSubmit={form.handleSubmit((input) => updateMutation.mutate(input))}
      >
        <div className="settings-grid">
          <label>
            {t("profileSettings.name")}
            <TextField
              aria-invalid={Boolean(form.formState.errors.name)}
              {...form.register("name")}
            />
            {form.formState.errors.name ? (
              <span className="danger-text">
                {validationMessage(form.formState.errors.name.message)}
              </span>
            ) : null}
          </label>
          <label>
            {t("profileSettings.serverFolder")}
            <PathField
              browseLabel={t("profileSettings.browse")}
              readOnly
              {...form.register("rootDir")}
              onBrowse={pickServerFolder}
            />
            {folderPickerError ? (
              <span className="danger-text">{folderPickerError}</span>
            ) : null}
          </label>
          <label>
            {t("profileSettings.loader")}
            <Controller
              control={form.control}
              name="loaderType"
              render={({ field }) => (
                <Select
                  ariaLabel={t("profileSettings.loader")}
                  name={field.name}
                  options={loaderOptions}
                  value={field.value}
                  onValueChange={(value) => field.onChange(value as LoaderType)}
                />
              )}
            />
          </label>
          <label>
            {t("profileSettings.minecraftVersion")}
            <TextField {...form.register("minecraftVersion")} />
          </label>
          <label>
            {t("profileSettings.loaderVersion")}
            <TextField {...form.register("loaderVersion")} />
          </label>
          <label>
            {t("profileSettings.javaPath")}
            <TextField {...form.register("javaPath")} />
          </label>
          <label>
            {t("profileSettings.port")}
            <TextField
              aria-invalid={Boolean(form.formState.errors.serverPort)}
              min="1"
              max="65535"
              type="number"
              {...form.register("serverPort")}
            />
            {form.formState.errors.serverPort ? (
              <span className="danger-text">
                {validationMessage(form.formState.errors.serverPort.message)}
              </span>
            ) : null}
          </label>
          <label>
            {t("profileSettings.minMemoryMb")}
            <TextField
              min="0"
              type="number"
              {...form.register("minMemoryMb")}
            />
          </label>
          <label>
            {t("profileSettings.maxMemoryMb")}
            <TextField
              aria-invalid={Boolean(form.formState.errors.maxMemoryMb)}
              min="0"
              type="number"
              {...form.register("maxMemoryMb")}
            />
            {form.formState.errors.maxMemoryMb ? (
              <span className="danger-text">
                {validationMessage(form.formState.errors.maxMemoryMb.message)}
              </span>
            ) : null}
          </label>
          <label className="checkbox-row">
            <Controller
              control={form.control}
              name="autoStart"
              render={({ field }) => (
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) =>
                    field.onChange(checked === true)
                  }
                />
              )}
            />
            {t("profileSettings.autoStart")}
          </label>
          <label className="checkbox-row">
            <Controller
              control={form.control}
              name="restartEnabled"
              render={({ field }) => (
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) =>
                    field.onChange(checked === true)
                  }
                />
              )}
            />
            {t("profileSettings.restartAfterCrashes")}
          </label>
          <label>
            {t("profileSettings.restartAttempts")}
            <TextField
              min="0"
              type="number"
              {...form.register("restartAttempts")}
            />
          </label>
          <label>
            {t("profileSettings.restartCooldownSeconds")}
            <TextField
              min="0"
              type="number"
              {...form.register("restartCooldown")}
            />
          </label>
        </div>
        <StickyActionBar className="form-actions">
          <Button
            disabled={updateMutation.isPending || !form.formState.isDirty}
            type="submit"
            variant="primary"
          >
            <Save aria-hidden="true" size={15} />
            {t("profileSettings.save")}
          </Button>
          <Button
            disabled={deleteMutation.isPending}
            type="button"
            variant="danger"
            onClick={() => {
              deleteMutation.reset();
              setDeleteFromDisk(false);
              setIsDeleteConfirmOpen(true);
            }}
          >
            <Trash2 aria-hidden="true" size={15} />
            {t("profileSettings.delete")}
          </Button>
        </StickyActionBar>
      </form>
      <ConfirmDangerDialog
        confirmLabel={t(
          deleteFromDisk
            ? "danger.labels.deleteProfileAndFiles"
            : "danger.labels.deleteProfile",
        )}
        description={t(
          deleteFromDisk
            ? "danger.profile.delete.descriptionWithFiles"
            : "danger.profile.delete.description",
          { server: server.name },
        )}
        error={deleteMutation.error?.message ?? null}
        isConfirming={deleteMutation.isPending}
        isOpen={isDeleteConfirmOpen}
        requireTypedConfirmation={deleteFromDisk ? server.name : undefined}
        title={t("danger.profile.delete.title")}
        onCancel={() => {
          setIsDeleteConfirmOpen(false);
          setDeleteFromDisk(false);
        }}
        onConfirm={() => deleteMutation.mutate()}
      >
        <label className="confirm-danger-option">
          <Checkbox
            aria-label={t("danger.profile.delete.deleteFromDisk")}
            checked={deleteFromDisk}
            onCheckedChange={(checked) => setDeleteFromDisk(checked === true)}
          />
          <span>
            <strong>{t("danger.profile.delete.deleteFromDisk")}</strong>
            <span className="confirm-danger-option-detail">
              {server.rootDir}
            </span>
          </span>
        </label>
      </ConfirmDangerDialog>
    </section>
  );
}
