import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { EditableStringList } from "../../components/ui/editable-string-list";
import { LoadingState } from "../../components/ui/loading-state";
import { Select } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
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
  t: (key: string, values?: Record<string, string | number | null | undefined>) => string,
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
  const [deleteProfile, setDeleteProfile] = useState<BackupProfile | null>(null);
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
    setEditingProfileId(profile.id);
    setName(profile.name);
    setMode(profile.mode);
    setIncludePaths(profile.includePaths);
    setExcludePaths(profile.excludePaths);
    setRetentionCount(profile.retentionCount ? String(profile.retentionCount) : "");
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
    <section className="settings-panel" aria-label={t("backups.profiles.aria")}>
      <div className="section-heading">
        <h2>{t("backups.profiles.title")}</h2>
      </div>
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
      {runMutation.error ? (
        <p className="danger-text" role="alert">
          {runMutation.error.message}
        </p>
      ) : null}
      {deleteMutation.error ? (
        <p className="danger-text" role="alert">
          {deleteMutation.error.message}
        </p>
      ) : null}
      <div className="settings-grid">
        <label>
          {t("backups.profiles.name")}
          <TextField
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {t("backups.profiles.mode")}
          <Select
            ariaLabel={t("backups.profiles.modeAria")}
            options={backupModeOptions}
            value={mode}
            onValueChange={(value) => setMode(value as BackupProfileMode)}
          />
        </label>
        <div className="structured-field structured-field-wide">
          <span className="structured-field-label">
            {t("backups.profiles.includePaths")}
          </span>
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
        </div>
        <div className="structured-field structured-field-wide">
          <span className="structured-field-label">
            {t("backups.profiles.excludePaths")}
          </span>
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
        </div>
        <label>
          {t("backups.profiles.retentionCount")}
          <TextField
            min="1"
            type="number"
            value={retentionCount}
            onChange={(event) => setRetentionCount(event.target.value)}
          />
          <small className="field-hint">
            {t("backups.profiles.retentionHelp")}
          </small>
        </label>
        {mode === "fullServer" ? (
          <label className="checkbox-row">
            <Checkbox
              checked={confirmFullServer}
              onCheckedChange={(checked) =>
                setConfirmFullServer(checked === true)
              }
            />
            {t("backups.profiles.includeFullServer")}
          </label>
        ) : null}
      </div>
      <div className="form-actions">
        <Button disabled={isSaving || name.trim() === ""} onClick={saveProfile}>
          <Plus aria-hidden="true" size={15} />
          {editingProfileId
            ? t("backups.profiles.save")
            : t("backups.profiles.add")}
        </Button>
        {editingProfileId ? (
          <Button disabled={isSaving} variant="secondary" onClick={clearForm}>
            <X aria-hidden="true" size={15} />
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
      {profilesQuery.isLoading ? (
        <LoadingState message={t("backups.profiles.loading")} />
      ) : profilesQuery.error ? (
        <div
          aria-label={t("backups.profiles.loadError")}
          className="list-state list-state-error"
          role="alert"
        >
          <strong>{t("backups.profiles.loadError")}</strong>
          <span>{profilesQuery.error.message}</span>
          <Button
            disabled={profilesQuery.isFetching}
            variant="secondary"
            onClick={() => profilesQuery.refetch()}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : profiles.length ? (
        <div className="compatibility-list">
          {profiles.map((profile) => (
            <div key={profile.id}>
              <strong>{profile.name}</strong>
              <span>{profileSummary(profile, t)}</span>
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
                variant="secondary"
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
            </div>
          ))}
        </div>
      ) : (
        <div className="list-state">{t("backups.profiles.empty")}</div>
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
    </section>
  );
}
