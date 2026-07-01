import { useState } from "react";
import { FolderOpen, Upload } from "lucide-react";
import { Button } from "../../components/ui/button";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import {
  invokeDesktopCommandWithErrorHandling,
  normalizeDesktopCommandError,
} from "../../lib/desktop-command-error";

interface LocalImportDialogProps {
  error: string | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onImport: (sourcePath: string) => void;
}

export function LocalImportDialog({
  error,
  isSubmitting,
  onCancel,
  onImport,
}: LocalImportDialogProps) {
  const { t } = useAppSettings();
  const [sourcePath, setSourcePath] = useState("");
  const [pickerError, setPickerError] = useState<string | null>(null);

  const pickJar = async () => {
    setPickerError(null);
    try {
      const result = await invokeDesktopCommandWithErrorHandling<{
        path: string | null;
      }>("show_open_dialog", {
        kind: "file",
        filters: [{ name: "Minecraft content JAR", extensions: ["jar"] }],
      });
      if (result?.path) {
        setSourcePath(result.path);
      }
    } catch (caught) {
      setPickerError(normalizeDesktopCommandError(caught).message);
    }
  };

  return (
    <form
      className="inline-dialog content-import-dialog"
      onSubmit={(event) => {
        event.preventDefault();
        onImport(sourcePath);
      }}
    >
      <div>
        <h3>{t("content.import.local.title")}</h3>
        <p>{t("content.import.local.description")}</p>
      </div>
      <label>
        <span>{t("content.import.local.sourcePath")}</span>
        <div className="field-with-action">
          <TextField
            autoFocus
            required
            placeholder={t("content.import.local.placeholder")}
            readOnly
            value={sourcePath}
            onClick={pickJar}
          />
          <Button disabled={isSubmitting} variant="secondary" onClick={pickJar}>
            <FolderOpen aria-hidden="true" size={15} />
            {t("profileSettings.browse")}
          </Button>
        </div>
      </label>
      {pickerError ? <p className="danger-text">{pickerError}</p> : null}
      {error ? <p className="danger-text">{error}</p> : null}
      <div className="dialog-actions">
        <Button
          disabled={isSubmitting}
          type="button"
          variant="secondary"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
        <Button
          disabled={isSubmitting || sourcePath.trim() === ""}
          type="submit"
          variant="primary"
        >
          <Upload aria-hidden="true" size={15} />
          {t("content.import.action")}
        </Button>
      </div>
    </form>
  );
}
