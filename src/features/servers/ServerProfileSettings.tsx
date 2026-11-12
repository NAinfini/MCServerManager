import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import {
  Alert,
  Box,
  Checkbox,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Save, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { PathField } from "../../components/ui/path-field";
import { Select } from "../../components/ui/select";
import { SettingRow, SettingSection } from "../../components/ui/setting-row";
import { StickyActionBar } from "../../components/ui/sticky-action-bar";
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import { queryKeys } from "../../lib/query-keys";
import { useUnsavedGuard } from "../../lib/use-unsaved-guard";
import { listJavaRuntimes } from "../java/javaApi";
import { deleteServerProfile, updateServerProfile } from "./api";
import { serverKeys } from "./queries";
import type { LoaderType, ServerProfile } from "./types";

interface ServerProfileSettingsProps {
  server: ServerProfile;
}

const FIELD_WIDTH = 240;

/* The select treats an empty value as no selection, so the two choices that
   are not a path carry sentinels. They never reach the profile: both are translated back
   before the form value changes. */
const SYSTEM_JAVA = "__system__";
const CUSTOM_JAVA = "__custom__";

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
  const [customJavaPath, setCustomJavaPath] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteFromDisk, setDeleteFromDisk] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const form = useForm<ServerProfileForm>({
    defaultValues: profileDefaults(server),
    resolver: zodResolver(profileSchema),
  });
  const javaQuery = useQuery({
    queryKey: queryKeys.java.runtimes,
    queryFn: listJavaRuntimes,
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

  /* Empty means the profile launches whatever `java` the PATH resolves to —
     the backend falls back to the bare command — so that is a real choice with
     a name, not a blank field. */
  const javaOptions = (current: string) => {
    const runtimes = javaQuery.data?.runtimes ?? [];
    const options = [
      { value: SYSTEM_JAVA, label: t("profileSettings.javaSystem") },
      ...runtimes.map((runtime) => ({
        value: runtime.path,
        label: [
          `Java ${runtime.majorVersion}`,
          runtime.vendor,
          runtime.architecture,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    ];
    /* A path the scan did not find is still what this server runs on today.
       Dropping it from the list would silently repoint the server on the next
       save. */
    if (current && !runtimes.some((runtime) => runtime.path === current)) {
      options.push({ value: current, label: current });
    }
    options.push({
      value: CUSTOM_JAVA,
      label: t("profileSettings.javaCustom"),
    });
    return options;
  };

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

  const errors = form.formState.errors;

  return (
    <Stack
      component="section"
      gap="md"
      aria-labelledby="profile-settings-title"
    >
      <div>
        <Title order={2} size="h3" id="profile-settings-title">
          {t("profileSettings.title")}
        </Title>
        <Text size="sm" c="dimmed" mt={4}>
          {t("profileSettings.description")}
        </Text>
      </div>
      {updateMutation.error ? (
        <Alert color="red" role="alert">
          {updateMutation.error.message}
        </Alert>
      ) : null}
      {deleteMutation.error ? (
        <Alert color="red" role="alert">
          {deleteMutation.error.message}
        </Alert>
      ) : null}
      {restartRequired ? (
        <Alert color="yellow" role="status">
          {t("profileSettings.restartRequired")}
        </Alert>
      ) : null}
      <Stack
        component="form"
        gap="md"
        onSubmit={form.handleSubmit((input) => updateMutation.mutate(input))}
      >
        <SettingSection order={3} title={t("profileSettings.group.identity")}>
          <SettingRow label={t("profileSettings.name")}>
            <TextInput
              w={FIELD_WIDTH}
              aria-label={t("profileSettings.name")}
              error={validationMessage(errors.name?.message)}
              {...form.register("name")}
            />
          </SettingRow>
          <SettingRow
            label={t("profileSettings.serverFolder")}
            description={
              folderPickerError ? (
                <Text span inherit c="red">
                  {folderPickerError}
                </Text>
              ) : undefined
            }
          >
            <Box w={360}>
              <PathField
                aria-label={t("profileSettings.serverFolder")}
                browseLabel={t("profileSettings.browse")}
                readOnly
                {...form.register("rootDir")}
                onBrowse={pickServerFolder}
              />
            </Box>
          </SettingRow>
        </SettingSection>
        <SettingSection order={3} title={t("profileSettings.group.runtime")}>
          <SettingRow label={t("profileSettings.loader")}>
            <Box w={FIELD_WIDTH}>
              <Controller
                control={form.control}
                name="loaderType"
                render={({ field }) => (
                  <Select
                    ariaLabel={t("profileSettings.loader")}
                    name={field.name}
                    options={loaderOptions}
                    value={field.value}
                    onValueChange={(value) =>
                      field.onChange(value as LoaderType)
                    }
                  />
                )}
              />
            </Box>
          </SettingRow>
          <SettingRow label={t("profileSettings.minecraftVersion")}>
            <TextInput
              w={FIELD_WIDTH}
              aria-label={t("profileSettings.minecraftVersion")}
              {...form.register("minecraftVersion")}
            />
          </SettingRow>
          <SettingRow label={t("profileSettings.loaderVersion")}>
            <TextInput
              w={FIELD_WIDTH}
              aria-label={t("profileSettings.loaderVersion")}
              {...form.register("loaderVersion")}
            />
          </SettingRow>
          {/* A bare text box asked the operator to know a path Windows hides
              in three different places. The scan already found them, so this
              offers what is installed and keeps typing for the case the scan
              cannot reach. */}
          <SettingRow label={t("profileSettings.javaPath")}>
            <Stack gap="xs" w={FIELD_WIDTH}>
              <Controller
                control={form.control}
                name="javaPath"
                render={({ field }) => (
                  <Select
                    ariaLabel={t("profileSettings.javaPath")}
                    name={field.name}
                    options={javaOptions(field.value)}
                    value={
                      customJavaPath ? CUSTOM_JAVA : field.value || SYSTEM_JAVA
                    }
                    onValueChange={(value) => {
                      if (value === CUSTOM_JAVA) {
                        setCustomJavaPath(true);
                        return;
                      }
                      setCustomJavaPath(false);
                      field.onChange(value === SYSTEM_JAVA ? "" : value);
                    }}
                  />
                )}
              />
              {customJavaPath ? (
                <TextInput
                  aria-label={t("profileSettings.javaCustom")}
                  placeholder={t("profileSettings.javaCustomPlaceholder")}
                  {...form.register("javaPath")}
                />
              ) : null}
            </Stack>
          </SettingRow>
          <SettingRow label={t("profileSettings.port")}>
            <TextInput
              w={FIELD_WIDTH}
              aria-label={t("profileSettings.port")}
              error={validationMessage(errors.serverPort?.message)}
              min="1"
              max="65535"
              type="number"
              {...form.register("serverPort")}
            />
          </SettingRow>
        </SettingSection>
        <SettingSection order={3} title={t("profileSettings.group.lifecycle")}>
          <SettingRow label={t("profileSettings.minMemoryMb")}>
            <TextInput
              w={FIELD_WIDTH}
              aria-label={t("profileSettings.minMemoryMb")}
              min="0"
              type="number"
              {...form.register("minMemoryMb")}
            />
          </SettingRow>
          <SettingRow label={t("profileSettings.maxMemoryMb")}>
            <TextInput
              w={FIELD_WIDTH}
              aria-label={t("profileSettings.maxMemoryMb")}
              error={validationMessage(errors.maxMemoryMb?.message)}
              min="0"
              type="number"
              {...form.register("maxMemoryMb")}
            />
          </SettingRow>
          <SettingRow label={t("profileSettings.autoStart")}>
            <Controller
              control={form.control}
              name="autoStart"
              render={({ field }) => (
                <Switch
                  aria-label={t("profileSettings.autoStart")}
                  checked={field.value}
                  onChange={(event) =>
                    field.onChange(event.currentTarget.checked)
                  }
                />
              )}
            />
          </SettingRow>
          <SettingRow label={t("profileSettings.restartAfterCrashes")}>
            <Controller
              control={form.control}
              name="restartEnabled"
              render={({ field }) => (
                <Switch
                  aria-label={t("profileSettings.restartAfterCrashes")}
                  checked={field.value}
                  onChange={(event) =>
                    field.onChange(event.currentTarget.checked)
                  }
                />
              )}
            />
          </SettingRow>
          <SettingRow label={t("profileSettings.restartAttempts")}>
            <TextInput
              w={FIELD_WIDTH}
              aria-label={t("profileSettings.restartAttempts")}
              min="0"
              type="number"
              {...form.register("restartAttempts")}
            />
          </SettingRow>
          <SettingRow label={t("profileSettings.restartCooldownSeconds")}>
            <TextInput
              w={FIELD_WIDTH}
              aria-label={t("profileSettings.restartCooldownSeconds")}
              min="0"
              type="number"
              {...form.register("restartCooldown")}
            />
          </SettingRow>
        </SettingSection>
        <StickyActionBar>
          <Button
            disabled={updateMutation.isPending || !form.formState.isDirty}
            type="submit"
            variant="primary"
          >
            <Save aria-hidden="true" size={16} />
            {t("profileSettings.save")}
          </Button>
        </StickyActionBar>
      </Stack>
      {/* Kept apart from the form and its save bar so the destructive action
          is never one stray click from the primary one. */}
      <Paper
        p="md"
        style={{ border: "1px solid var(--mantine-color-red-outline)" }}
      >
        <Group justify="space-between" gap="md" wrap="nowrap">
          <Text size="sm" c="dimmed">
            {t("danger.profile.delete.description", { server: server.name })}
          </Text>
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
            <Trash2 aria-hidden="true" size={16} />
            {t("profileSettings.delete")}
          </Button>
        </Group>
      </Paper>
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
        <Checkbox
          aria-label={t("danger.profile.delete.deleteFromDisk")}
          checked={deleteFromDisk}
          label={t("danger.profile.delete.deleteFromDisk")}
          description={
            <Text span inherit ff="monospace">
              {server.rootDir}
            </Text>
          }
          onChange={(event) => setDeleteFromDisk(event.currentTarget.checked)}
        />
      </ConfirmDangerDialog>
    </Stack>
  );
}
