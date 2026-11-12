import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  Alert,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { EditableStringList } from "../../components/ui/editable-string-list";
import { LoadingState } from "../../components/ui/loading-state";
import { Select } from "../../components/ui/select";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../../domain/server";
import { useUnsavedGuard } from "../../lib/use-unsaved-guard";
import {
  createBackupProfile,
  createProfileBackup,
  deleteBackupProfile,
  listBackupProfiles,
  updateBackupProfile,
  type BackupProfile,
  type BackupProfileMode,
} from "./backupApi";
import { backupKeys } from "./queries";

interface BackupProfilesViewProps {
  server: ServerProfile;
}

function modeLabel(mode: BackupProfileMode, t: (key: string) => string) {
  switch (mode) {
    case "worldOnly":
      return t("backups.profiles.mode.worldOnly");
    case "worldPlusConfigs":
      return t("backups.profiles.mode.worldPlusConfigs");
    case "fullServer":
      return t("backups.profiles.mode.fullServer");
    case "custom":
      return t("backups.profiles.mode.custom");
  }
}

function profileSummary(
  profile: BackupProfile,
  t: (
    key: string,
    values?: Record<string, string | number | null | undefined>,
  ) => string,
) {
  const retention = profile.retentionCount
    ? t("backups.profiles.keep", { count: profile.retentionCount })
    : t("backups.profiles.noRetentionLimit");
  const includes = profile.includePaths.length
    ? profile.includePaths.join(", ")
    : t("backups.profiles.activeWorld");
  return t("backups.profiles.summary", {
    mode: modeLabel(profile.mode, t),
    includes,
    retention,
  });
}

export function BackupProfilesView({ server }: BackupProfilesViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<BackupProfileMode>("worldOnly");
  const [includePaths, setIncludePaths] = useState<string[]>([]);
  const [excludePaths, setExcludePaths] = useState<string[]>([]);
  const [retentionCount, setRetentionCount] = useState("5");
  const [confirmFullServer, setConfirmFullServer] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [deleteProfile, setDeleteProfile] = useState<BackupProfile | null>(
    null,
  );
  const profilesQuery = useQuery({
    queryKey: backupKeys.profiles(server.id),
    queryFn: () => listBackupProfiles(server.id),
  });
  const profileInput = () => ({
    serverId: server.id,
    name,
    mode,
    includePaths: includePaths.map((path) => path.trim()).filter(Boolean),
    excludePaths: excludePaths.map((path) => path.trim()).filter(Boolean),
    retentionCount: retentionCount.trim() ? Number(retentionCount) : null,
    confirmFullServer,
  });
  const clearForm = () => {
    setName("");
    setMode("worldOnly");
    setIncludePaths([]);
    setExcludePaths([]);
    setRetentionCount("5");
    setConfirmFullServer(false);
    setEditingProfileId(null);
    setComposing(false);
  };
  const createMutation = useMutation({
    mutationFn: () => createBackupProfile(profileInput()),
    onSuccess: async () => {
      clearForm();
      await queryClient.invalidateQueries({
        queryKey: backupKeys.profiles(server.id),
      });
    },
  });
  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editingProfileId) throw new Error("backup profile id is required");
      return updateBackupProfile({
        ...profileInput(),
        id: editingProfileId,
      });
    },
    onSuccess: async () => {
      clearForm();
      await queryClient.invalidateQueries({
        queryKey: backupKeys.profiles(server.id),
      });
    },
  });
  const runMutation = useMutation({
    mutationFn: (profileId: string) => createProfileBackup({ profileId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: backupKeys.list(server.id) }),
        queryClient.invalidateQueries({
          queryKey: backupKeys.profiles(server.id),
        }),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (profileId: string) => deleteBackupProfile(profileId),
    onSuccess: async () => {
      setDeleteProfile(null);
      clearForm();
      await queryClient.invalidateQueries({
        queryKey: backupKeys.profiles(server.id),
      });
    },
  });
  const profiles = profilesQuery.data ?? [];
  const isSaving = createMutation.isPending || updateMutation.isPending;
  /* The form used to sit above the profiles it creates, so the list an operator
     came to read started below three screens of inputs. */
  const editorOpen = composing || editingProfileId !== null;
  const editingProfile =
    profiles.find((profile) => profile.id === editingProfileId) ?? null;
  const isDirty = editingProfile
    ? name !== editingProfile.name ||
      mode !== editingProfile.mode ||
      JSON.stringify(includePaths) !==
        JSON.stringify(editingProfile.includePaths) ||
      JSON.stringify(excludePaths) !==
        JSON.stringify(editingProfile.excludePaths) ||
      retentionCount !==
        (editingProfile.retentionCount
          ? String(editingProfile.retentionCount)
          : "") ||
      confirmFullServer !== (editingProfile.mode === "fullServer")
    : name !== "" ||
      mode !== "worldOnly" ||
      includePaths.length > 0 ||
      excludePaths.length > 0 ||
      retentionCount !== "5" ||
      confirmFullServer;
  useUnsavedGuard({
    isDirty,
    message: t("backups.profiles.unsaved.confirm"),
    onDiscard: clearForm,
  });
  const backupModeOptions = [
    { value: "worldOnly", label: t("backups.profiles.mode.worldOnly") },
    {
      value: "worldPlusConfigs",
      label: t("backups.profiles.mode.worldPlusConfigs"),
    },
    { value: "fullServer", label: t("backups.profiles.mode.fullServer") },
    { value: "custom", label: t("backups.profiles.mode.custom") },
  ] as const;

  function editProfile(profile: BackupProfile) {
    setComposing(false);
    setEditingProfileId(profile.id);
    setName(profile.name);
    setMode(profile.mode);
    setIncludePaths(profile.includePaths);
    setExcludePaths(profile.excludePaths);
    setRetentionCount(
      profile.retentionCount ? String(profile.retentionCount) : "",
    );
    setConfirmFullServer(profile.mode === "fullServer");
  }

  function saveProfile() {
    if (editingProfileId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  return (
    <Stack aria-label={t("backups.profiles.aria")} component="section" gap="sm">
      <Group justify="space-between">
        <Title order={4}>{t("backups.profiles.title")}</Title>
        <Button
          disabled={isSaving}
          variant="secondary"
          onClick={() => {
            createMutation.reset();
            clearForm();
            setComposing(true);
          }}
        >
          <Plus aria-hidden="true" size={14} />
          {/* Not "Add profile": that is the composer's own submit button, and
              two controls with the same name are two controls nobody can tell
              apart — by name or by screen reader. */}
          {t("backups.profiles.new")}
        </Button>
      </Group>
      {[createMutation, updateMutation, runMutation, deleteMutation].map(
        (mutation, index) =>
          mutation.error ? (
            <Alert color="red" key={index} py="xs">
              {mutation.error.message}
            </Alert>
          ) : null,
      )}
      {editorOpen ? (
        <Paper bg="var(--mantine-color-default-hover)" p="md">
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput
                autoComplete="off"
                label={t("backups.profiles.name")}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Stack gap={4}>
                <Text fw={500} size="sm">
                  {t("backups.profiles.mode")}
                </Text>
                <Select
                  ariaLabel={t("backups.profiles.modeAria")}
                  options={backupModeOptions}
                  value={mode}
                  onValueChange={(value) => setMode(value as BackupProfileMode)}
                />
              </Stack>
              <Stack gap={4}>
                <Text fw={500} size="sm">
                  {t("backups.profiles.includePaths")}
                </Text>
                <EditableStringList
                  addLabel={t("backups.profiles.addIncludePath")}
                  emptyText={t("backups.profiles.includePathsEmpty")}
                  inputLabel={t("backups.profiles.newIncludePath")}
                  itemLabel={(index) =>
                    t("backups.profiles.includePathItem", { index: index + 1 })
                  }
                  placeholder={t("backups.profiles.pathPlaceholder")}
                  removeLabel={(path) =>
                    t("backups.profiles.removeIncludePath", { path })
                  }
                  values={includePaths}
                  onChange={setIncludePaths}
                />
              </Stack>
              <Stack gap={4}>
                <Text fw={500} size="sm">
                  {t("backups.profiles.excludePaths")}
                </Text>
                <EditableStringList
                  addLabel={t("backups.profiles.addExcludePath")}
                  emptyText={t("backups.profiles.excludePathsEmpty")}
                  inputLabel={t("backups.profiles.newExcludePath")}
                  itemLabel={(index) =>
                    t("backups.profiles.excludePathItem", { index: index + 1 })
                  }
                  placeholder={t("backups.profiles.pathPlaceholder")}
                  removeLabel={(path) =>
                    t("backups.profiles.removeExcludePath", { path })
                  }
                  values={excludePaths}
                  onChange={setExcludePaths}
                />
              </Stack>
              <NumberInput
                allowDecimal={false}
                allowNegative={false}
                description={t("backups.profiles.retentionHelp")}
                label={t("backups.profiles.retentionCount")}
                min={1}
                value={retentionCount}
                onChange={(value) => setRetentionCount(String(value))}
              />
            </SimpleGrid>
            {mode === "fullServer" ? (
              <Checkbox
                checked={confirmFullServer}
                label={t("backups.profiles.includeFullServer")}
                onChange={(event) =>
                  setConfirmFullServer(event.currentTarget.checked)
                }
              />
            ) : null}
            <Group gap="xs" justify="flex-end">
              <Button disabled={isSaving} variant="ghost" onClick={clearForm}>
                <X aria-hidden="true" size={14} />
                {t("common.cancel")}
              </Button>
              <Button
                disabled={isSaving || name.trim() === ""}
                variant="primary"
                onClick={saveProfile}
              >
                <Plus aria-hidden="true" size={14} />
                {editingProfileId
                  ? t("backups.profiles.save")
                  : t("backups.profiles.add")}
              </Button>
            </Group>
          </Stack>
        </Paper>
      ) : null}
      {profilesQuery.isLoading ? (
        <LoadingState message={t("backups.profiles.loading")} />
      ) : profilesQuery.error ? (
        <Alert
          aria-label={t("backups.profiles.loadError")}
          color="red"
          title={t("backups.profiles.loadError")}
        >
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{profilesQuery.error.message}</Text>
            <Button
              disabled={profilesQuery.isFetching}
              variant="secondary"
              onClick={() => profilesQuery.refetch()}
            >
              {t("common.retry")}
            </Button>
          </Stack>
        </Alert>
      ) : profiles.length ? (
        <Table highlightOnHover verticalSpacing="xs">
          <Table.Tbody>
            {profiles.map((profile) => (
              <Table.Tr key={profile.id}>
                <Table.Td>
                  <Text fw={500} size="sm">
                    {profile.name}
                  </Text>
                  <Text c="dimmed" size="xs">
                    {profileSummary(profile, t)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button
                      disabled={runMutation.isPending}
                      variant="secondary"
                      onClick={() => runMutation.mutate(profile.id)}
                    >
                      <Archive aria-hidden="true" size={14} />
                      {t("backups.profiles.run")}
                    </Button>
                    <Button
                      disabled={isSaving}
                      variant="ghost"
                      onClick={() => editProfile(profile)}
                    >
                      <Pencil aria-hidden="true" size={14} />
                      {t("backups.profiles.actions.edit")}
                    </Button>
                    <Button
                      disabled={deleteMutation.isPending}
                      variant="danger"
                      onClick={() => {
                        deleteMutation.reset();
                        setDeleteProfile(profile);
                      }}
                    >
                      <Trash2 aria-hidden="true" size={14} />
                      {t("backups.profiles.actions.delete")}
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Text c="dimmed" size="sm">
          {t("backups.profiles.empty")}
        </Text>
      )}
      <ConfirmDangerDialog
        confirmLabel={t("danger.labels.deleteBackupProfile")}
        description={t("danger.backupProfile.delete.description", {
          profile: deleteProfile?.name ?? "",
        })}
        error={deleteMutation.error?.message ?? null}
        isConfirming={deleteMutation.isPending}
        isOpen={deleteProfile !== null}
        title={t("danger.backupProfile.delete.title")}
        onCancel={() => setDeleteProfile(null)}
        onConfirm={() => {
          if (deleteProfile) {
            deleteMutation.mutate(deleteProfile.id);
          }
        }}
      />
    </Stack>
  );
}
