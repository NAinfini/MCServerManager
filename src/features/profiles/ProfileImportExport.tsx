import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { Download, Upload } from "lucide-react";
import { Button } from "../../components/ui/button";
import { TextArea, TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../servers/types";

interface ProfileImportExportProps {
  server?: ServerProfile;
  onImported?: () => void;
}

interface ProfileImportPreview {
  document: {
    server: {
      name: string;
      loaderType: string;
      minecraftVersion?: string | null;
    };
  };
  warnings: string[];
}

export function ProfileImportExport({
  server,
  onImported,
}: ProfileImportExportProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [documentJson, setDocumentJson] = useState("");
  const [targetRootDir, setTargetRootDir] = useState("");
  const [javaPath, setJavaPath] = useState("");
  const [importName, setImportName] = useState("");
  const [preview, setPreview] = useState<ProfileImportPreview | null>(null);
  const [previewedDocumentJson, setPreviewedDocumentJson] = useState("");
  const exportMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<unknown>("export_server_profile", {
        input: {
          serverId: server?.id ?? "",
        },
      }),
    onSuccess: (document) => {
      setDocumentJson(JSON.stringify(document, null, 2));
    },
  });
  const previewMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<ProfileImportPreview>("preview_profile_import", {
        input: {
          documentJson,
          targetRootDir: targetRootDir || null,
          javaPath: javaPath || null,
        },
      }),
    onSuccess: (result) => {
      setPreview(result);
      setPreviewedDocumentJson(documentJson);
    },
  });
  const importMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<ServerProfile>("import_profile", {
        input: {
          documentJson,
          name: importName || null,
          targetRootDir,
          javaPath: javaPath || null,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["serverProfiles"] });
      onImported?.();
    },
  });
  const canImport =
    Boolean(
      documentJson &&
      targetRootDir &&
      preview &&
      previewedDocumentJson === documentJson,
    ) &&
    preview?.warnings.length === 0 &&
    !importMutation.isPending;

  return (
    <section className="settings-panel" aria-label={t("profileImport.aria")}>
      <div className="section-heading">
        <h2>{t("profileImport.title")}</h2>
      </div>
      {exportMutation.error ? (
        <p className="danger-text">{exportMutation.error.message}</p>
      ) : null}
      {previewMutation.error ? (
        <p className="danger-text">{previewMutation.error.message}</p>
      ) : null}
      {importMutation.error ? (
        <p className="danger-text">{importMutation.error.message}</p>
      ) : null}
      {server ? (
        <Button
          disabled={exportMutation.isPending}
          variant="secondary"
          onClick={() => exportMutation.mutate()}
        >
          <Download aria-hidden="true" size={15} />
          {t("profileImport.export")}
        </Button>
      ) : null}
      <div className="settings-grid">
        <label>
          {t("profileImport.profileJson")}
          <TextArea
            name="profileDocumentJson"
            value={documentJson}
            onChange={(event) => setDocumentJson(event.target.value)}
          />
        </label>
        <label>
          {t("profileImport.importName")}
          <TextField
            name="profileImportName"
            value={importName}
            onChange={(event) => setImportName(event.target.value)}
          />
        </label>
        <label>
          {t("profileImport.targetFolder")}
          <TextField
            name="profileTargetRootDir"
            value={targetRootDir}
            onChange={(event) => setTargetRootDir(event.target.value)}
          />
        </label>
        <label>
          {t("profileImport.javaRuntime")}
          <TextField
            name="profileJavaPath"
            value={javaPath}
            onChange={(event) => setJavaPath(event.target.value)}
          />
        </label>
      </div>
      <div className="dialog-actions">
        <Button
          disabled={!documentJson || previewMutation.isPending}
          variant="secondary"
          onClick={() => previewMutation.mutate()}
        >
          {t("profileImport.preview")}
        </Button>
        <Button disabled={!canImport} onClick={() => importMutation.mutate()}>
          <Upload aria-hidden="true" size={15} />
          {t("profileImport.import")}
        </Button>
      </div>
      {preview ? (
        <div className="compatibility-list">
          <div>
            <strong>{preview.document.server.name}</strong>
            <span>
              {preview.document.server.loaderType}{" "}
              {preview.document.server.minecraftVersion}
            </span>
          </div>
          {preview.warnings.map((warning) => (
            <div key={warning}>
              <strong>{t("profileImport.warning")}</strong>
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
