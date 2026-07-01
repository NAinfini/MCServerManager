import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, PackageOpen } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import {
  invokeDesktopCommandWithErrorHandling,
  normalizeDesktopCommandError,
} from "../../lib/desktop-command-error";

interface ModpackImportPreview {
  manifest: {
    format: string;
    name: string;
    minecraftVersion?: string | null;
    loader?: string | null;
    warnings: string[];
  };
  createNewProfile: boolean;
  rollbackRequired: boolean;
  warnings: string[];
}

interface ImportedModpack {
  profile: {
    id: string;
    name: string;
  };
  rollbackPath?: string | null;
  warnings: string[];
}

export function ModpackImportDialog() {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [path, setPath] = useState("");
  const [targetRoot, setTargetRoot] = useState("");
  const [name, setName] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [preview, setPreview] = useState<ModpackImportPreview | null>(null);
  const [imported, setImported] = useState<ImportedModpack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const previewImport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result =
        await invokeDesktopCommandWithErrorHandling<ModpackImportPreview>(
          "preview_modpack_import_command",
          {
            input: { path, targetRoot: targetRoot || null },
          },
        );
      setPreview(result);
      setImported(null);
    } catch (caught) {
      setError(normalizeDesktopCommandError(caught).message);
    } finally {
      setIsLoading(false);
    }
  };

  const importPack = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result =
        await invokeDesktopCommandWithErrorHandling<ImportedModpack>(
          "import_modpack",
          {
            input: {
              path,
              targetRoot,
              name: name.trim() || null,
              javaPath: null,
              confirmReplace,
            },
          },
        );
      setImported(result);
      await queryClient.invalidateQueries({ queryKey: ["serverProfiles"] });
    } catch (caught) {
      setError(normalizeDesktopCommandError(caught).message);
    } finally {
      setIsLoading(false);
    }
  };

  const pickPackFile = async () => {
    setError(null);
    try {
      const result = await invokeDesktopCommandWithErrorHandling<{
        path: string | null;
      }>("show_open_dialog", {
        kind: "file",
        filters: [{ name: "Modpack archive", extensions: ["zip", "mrpack"] }],
      });
      if (result?.path) {
        setPath(result.path);
        setPreview(null);
        setImported(null);
      }
    } catch (caught) {
      setError(normalizeDesktopCommandError(caught).message);
    }
  };

  const pickTargetFolder = async () => {
    setError(null);
    try {
      const result = await invokeDesktopCommandWithErrorHandling<{
        path: string | null;
      }>("show_open_dialog", { kind: "folder" });
      if (result?.path) {
        setTargetRoot(result.path);
      }
    } catch (caught) {
      setError(normalizeDesktopCommandError(caught).message);
    }
  };

  return (
    <section className="inline-dialog modpack-import-dialog">
      <div>
        <h3>{t("content.import.modpack.title")}</h3>
        <p>{t("content.import.modpack.description")}</p>
      </div>
      <label>
        <span>{t("content.import.modpack.packFile")}</span>
        <div className="field-with-action">
          <TextField
            name="modpackPath"
            placeholder={t("content.import.modpack.packPlaceholder")}
            readOnly
            value={path}
            onClick={pickPackFile}
          />
          <Button
            disabled={isLoading}
            variant="secondary"
            onClick={pickPackFile}
          >
            <FolderOpen aria-hidden="true" size={15} />
            {t("profileSettings.browse")}
          </Button>
        </div>
      </label>
      <label>
        <span>{t("content.import.modpack.targetFolder")}</span>
        <div className="field-with-action">
          <TextField
            name="modpackTargetRoot"
            placeholder={t("content.import.modpack.targetPlaceholder")}
            readOnly
            value={targetRoot}
            onClick={pickTargetFolder}
          />
          <Button
            disabled={isLoading}
            variant="secondary"
            onClick={pickTargetFolder}
          >
            <FolderOpen aria-hidden="true" size={15} />
            {t("profileSettings.browse")}
          </Button>
        </div>
      </label>
      <label>
        <span>{t("content.import.modpack.profileName")}</span>
        <TextField
          name="modpackProfileName"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {preview?.rollbackRequired ? (
        <label className="checkbox-row">
          <Checkbox
            checked={confirmReplace}
            onCheckedChange={(checked) => setConfirmReplace(checked === true)}
          />
          <span>{t("content.import.modpack.confirmReplace")}</span>
        </label>
      ) : null}
      {error ? <p className="danger-text">{error}</p> : null}
      {imported ? (
        <div className="modpack-preview">
          <strong>
            {t("content.import.modpack.imported", {
              name: imported.profile.name,
            })}
          </strong>
          {imported.rollbackPath ? (
            <span>
              {t("content.import.modpack.rollback", {
                path: imported.rollbackPath,
              })}
            </span>
          ) : null}
          {imported.warnings.map((warning) => (
            <span className="danger-text" key={warning}>
              {warning}
            </span>
          ))}
        </div>
      ) : null}
      {preview ? (
        <div className="modpack-preview">
          <strong>{preview.manifest.name}</strong>
          <span>{preview.manifest.format}</span>
          <span>
            {preview.manifest.minecraftVersion ??
              t("content.import.modpack.unknownMinecraft")}
          </span>
          <span>
            {preview.manifest.loader ??
              t("content.import.modpack.unknownLoader")}
          </span>
          {preview.warnings.map((warning) => (
            <span className="danger-text" key={warning}>
              {warning}
            </span>
          ))}
        </div>
      ) : null}
      <div className="dialog-actions">
        <Button
          disabled={path.trim() === "" || isLoading}
          variant="secondary"
          onClick={previewImport}
        >
          <PackageOpen aria-hidden="true" size={15} />
          {t("content.import.preview")}
        </Button>
        <Button
          disabled={
            !preview ||
            path.trim() === "" ||
            targetRoot.trim() === "" ||
            (preview.rollbackRequired && !confirmReplace) ||
            isLoading
          }
          variant="primary"
          onClick={importPack}
        >
          {t("content.import.action")}
        </Button>
      </div>
    </section>
  );
}
