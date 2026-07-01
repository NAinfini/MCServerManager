import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Save, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { Select } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommand } from "../../lib/desktop-runtime";
import { deleteServerProfile, updateServerProfile } from "./api";
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
] as const;

function numberOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

export function ServerProfileSettings({ server }: ServerProfileSettingsProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [name, setName] = useState(server.name);
  const [rootDir, setRootDir] = useState(server.rootDir);
  const [minecraftVersion, setMinecraftVersion] = useState(
    server.minecraftVersion ?? "",
  );
  const [loaderType, setLoaderType] = useState<LoaderType>(server.loaderType);
  const [loaderVersion, setLoaderVersion] = useState(
    server.loaderVersion ?? "",
  );
  const [javaPath, setJavaPath] = useState(server.javaPath ?? "");
  const [serverPort, setServerPort] = useState(
    server.serverPort ? String(server.serverPort) : "",
  );
  const [minMemoryMb, setMinMemoryMb] = useState(
    server.minMemoryMb ? String(server.minMemoryMb) : "",
  );
  const [maxMemoryMb, setMaxMemoryMb] = useState(
    server.maxMemoryMb ? String(server.maxMemoryMb) : "",
  );
  const [autoStart, setAutoStart] = useState(server.autoStart);
  const [restartEnabled, setRestartEnabled] = useState(
    server.restartPolicy.enabled,
  );
  const [restartAttempts, setRestartAttempts] = useState(
    String(server.restartPolicy.maxAttempts),
  );
  const [restartCooldown, setRestartCooldown] = useState(
    String(server.restartPolicy.cooldownSeconds),
  );
  const [folderPickerError, setFolderPickerError] = useState<string | null>(
    null,
  );
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const pickServerFolder = async () => {
    setFolderPickerError(null);
    try {
      const result = await invokeDesktopCommand<{ path: string | null }>(
        "show_open_dialog",
        { kind: "folder" },
      );
      if (result?.path) {
        setRootDir(result.path);
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
    mutationFn: () =>
      updateServerProfile({
        id: server.id,
        name,
        rootDir,
        minecraftVersion: minecraftVersion.trim() || null,
        loaderType,
        loaderVersion: loaderVersion.trim() || null,
        javaPath: javaPath.trim() || null,
        serverPort: numberOrNull(serverPort),
        minMemoryMb: numberOrNull(minMemoryMb),
        maxMemoryMb: numberOrNull(maxMemoryMb),
        autoStart,
        restartPolicy: {
          enabled: restartEnabled,
          maxAttempts: Number(restartAttempts || 0),
          cooldownSeconds: Number(restartCooldown || 0),
        },
      }),
    onSuccess: async () => {
      setIsDeleteConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteServerProfile(server.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
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
        <p className="danger-text">{updateMutation.error.message}</p>
      ) : null}
      {deleteMutation.error ? (
        <p className="danger-text">{deleteMutation.error.message}</p>
      ) : null}
      <div className="settings-grid">
        <label>
          {t("profileSettings.name")}
          <TextField
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {t("profileSettings.serverFolder")}
          <div className="field-with-action">
            <TextField value={rootDir} readOnly onClick={pickServerFolder} />
            <Button variant="secondary" onClick={pickServerFolder}>
              <FolderOpen aria-hidden="true" size={15} />
              {t("profileSettings.browse")}
            </Button>
          </div>
          {folderPickerError ? (
            <span className="danger-text">{folderPickerError}</span>
          ) : null}
        </label>
        <label>
          {t("profileSettings.loader")}
          <Select
            ariaLabel={t("profileSettings.loader")}
            options={loaderOptions}
            value={loaderType}
            onValueChange={(value) => setLoaderType(value as LoaderType)}
          />
        </label>
        <label>
          {t("profileSettings.minecraftVersion")}
          <TextField
            value={minecraftVersion}
            onChange={(event) => setMinecraftVersion(event.target.value)}
          />
        </label>
        <label>
          {t("profileSettings.loaderVersion")}
          <TextField
            value={loaderVersion}
            onChange={(event) => setLoaderVersion(event.target.value)}
          />
        </label>
        <label>
          {t("profileSettings.javaPath")}
          <TextField
            value={javaPath}
            onChange={(event) => setJavaPath(event.target.value)}
          />
        </label>
        <label>
          {t("profileSettings.port")}
          <TextField
            min="1"
            type="number"
            value={serverPort}
            onChange={(event) => setServerPort(event.target.value)}
          />
        </label>
        <label>
          {t("profileSettings.minMemoryMb")}
          <TextField
            min="1"
            type="number"
            value={minMemoryMb}
            onChange={(event) => setMinMemoryMb(event.target.value)}
          />
        </label>
        <label>
          {t("profileSettings.maxMemoryMb")}
          <TextField
            min="1"
            type="number"
            value={maxMemoryMb}
            onChange={(event) => setMaxMemoryMb(event.target.value)}
          />
        </label>
        <label className="checkbox-row">
          <Checkbox
            checked={autoStart}
            onCheckedChange={(checked) => setAutoStart(checked === true)}
          />
          {t("profileSettings.autoStart")}
        </label>
        <label className="checkbox-row">
          <Checkbox
            checked={restartEnabled}
            onCheckedChange={(checked) => setRestartEnabled(checked === true)}
          />
          {t("profileSettings.restartAfterCrashes")}
        </label>
        <label>
          {t("profileSettings.restartAttempts")}
          <TextField
            min="0"
            type="number"
            value={restartAttempts}
            onChange={(event) => setRestartAttempts(event.target.value)}
          />
        </label>
        <label>
          {t("profileSettings.restartCooldownSeconds")}
          <TextField
            min="0"
            type="number"
            value={restartCooldown}
            onChange={(event) => setRestartCooldown(event.target.value)}
          />
        </label>
      </div>
      <div className="form-actions">
        <Button
          disabled={
            updateMutation.isPending ||
            name.trim() === "" ||
            rootDir.trim() === ""
          }
          variant="primary"
          onClick={() => updateMutation.mutate()}
        >
          <Save aria-hidden="true" size={15} />
          {t("profileSettings.save")}
        </Button>
        <Button
          disabled={deleteMutation.isPending}
          variant="danger"
          onClick={() => {
            deleteMutation.reset();
            setIsDeleteConfirmOpen(true);
          }}
        >
          <Trash2 aria-hidden="true" size={15} />
          {t("profileSettings.delete")}
        </Button>
      </div>
      <ConfirmDangerDialog
        confirmLabel={t("danger.labels.deleteProfile")}
        description={t("danger.profile.delete.description", {
          server: server.name,
        })}
        error={deleteMutation.error?.message ?? null}
        isConfirming={deleteMutation.isPending}
        isOpen={isDeleteConfirmOpen}
        title={t("danger.profile.delete.title")}
        onCancel={() => setIsDeleteConfirmOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </section>
  );
}
