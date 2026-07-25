import { ChangeEvent, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import {
  Check,
  Clipboard,
  Download,
  FileJson,
  FolderOpen,
  Upload,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import type { ServerProfile } from "../../domain/server";
import { serverKeys } from "../servers/queries";

interface ProfileImportExportProps {
  server?: ServerProfile;
  onImported?: () => void;
}

interface ProfileDocument {
  formatVersion?: number;
  server: {
    name: string;
    loaderType: string;
    minecraftVersion?: string | null;
  };
}

interface ProfileImportPreview {
  document: ProfileDocument;
  warnings: string[];
}

export function ProfileImportExport({
  server,
  onImported,
}: ProfileImportExportProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const documentInputRef = useRef<HTMLInputElement>(null);
  const [documentJson, setDocumentJson] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [document, setDocument] = useState<ProfileDocument | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [copyComplete, setCopyComplete] = useState(false);
  const [targetRootDir, setTargetRootDir] = useState("");
  const [javaPath, setJavaPath] = useState("");
  const [importName, setImportName] = useState("");
  const [preview, setPreview] = useState<ProfileImportPreview | null>(null);
  const [previewedDocumentJson, setPreviewedDocumentJson] = useState("");
  const [pickerError, setPickerError] = useState<string | null>(null);

  function loadDocument(nextDocument: ProfileDocument, name: string) {
    const nextJson = JSON.stringify(nextDocument, null, 2);
    setDocumentJson(nextJson);
    setDocumentName(name);
    setDocument(nextDocument);
    setDocumentError(null);
    setCopyComplete(false);
    setPreview(null);
    setPreviewedDocumentJson("");
  }

  const exportMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<ProfileDocument>(
        "export_server_profile",
        {
          input: {
            serverId: server?.id ?? "",
          },
        },
      ),
    onSuccess: (exportedDocument) => {
      loadDocument(
        exportedDocument,
        `${exportedDocument.server.name || "server"}-profile.json`,
      );
    },
  });
  const previewMutation = useMutation({
    mutationFn: () =>
      invokeDesktopCommandWithErrorHandling<ProfileImportPreview>(
        "preview_profile_import",
        {
          input: {
            documentJson,
            targetRootDir: targetRootDir || null,
            javaPath: javaPath || null,
          },
        },
      ),
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
      await queryClient.invalidateQueries({ queryKey: serverKeys.profiles });
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

  async function handleDocumentFile(event: ChangeEvent<HTMLInputElement>) {
    const profileFile = event.currentTarget.files?.[0];
    if (!profileFile) {
      return;
    }
    try {
      const nextJson = await profileFile.text();
      const parsed = JSON.parse(nextJson) as ProfileDocument;
      if (!parsed?.server?.name || !parsed.server.loaderType) {
        throw new Error(t("profileImport.invalidDocument"));
      }
      setDocumentJson(nextJson);
      setDocumentName(profileFile.name);
      setDocument(parsed);
      setDocumentError(null);
      setCopyComplete(false);
      setPreview(null);
      setPreviewedDocumentJson("");
    } catch (error) {
      setDocumentJson("");
      setDocumentName(profileFile.name);
      setDocument(null);
      setPreview(null);
      setDocumentError(
        error instanceof Error ? error.message : t("profileImport.invalidDocument"),
      );
    }
  }

  async function copyDocument() {
    try {
      await navigator.clipboard.writeText(documentJson);
      setCopyComplete(true);
      setDocumentError(null);
    } catch {
      setDocumentError(t("profileImport.copyFailed"));
    }
  }

  async function pickPath(kind: "folder" | "file") {
    setPickerError(null);
    try {
      const result = await invokeDesktopCommandWithErrorHandling<{
        path: string | null;
      }>("show_open_dialog", {
        kind,
      });
      return result?.path ?? null;
    } catch (error) {
      setPickerError(
        error instanceof Error ? error.message : t("profileImport.pickerError"),
      );
      return null;
    }
  }

  return (
    <section className="settings-panel" aria-label={t("profileImport.aria")}>
      <div className="section-heading">
        <div>
          <h2>{t("profileImport.title")}</h2>
          <span>{t("profileImport.description")}</span>
        </div>
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
      {documentError ? <p className="danger-text">{documentError}</p> : null}
      {pickerError ? (
        <p className="danger-text" role="alert">{pickerError}</p>
      ) : null}

      <div className="profile-document-actions">
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
        {documentJson ? (
          <Button variant="secondary" onClick={copyDocument}>
            {copyComplete ? (
              <Check aria-hidden="true" size={15} />
            ) : (
              <Clipboard aria-hidden="true" size={15} />
            )}
            {copyComplete
              ? t("profileImport.copied")
              : t("profileImport.copyExported")}
          </Button>
        ) : null}
      </div>

      <div className="profile-document-picker">
        <FileJson aria-hidden="true" size={20} />
        <div>
          <strong>{t("profileImport.chooseFile")}</strong>
          <span>{t("profileImport.chooseFileDescription")}</span>
        </div>
        <input
          ref={documentInputRef}
          accept="application/json,.json"
          aria-label={t("profileImport.chooseFile")}
          className="visually-hidden"
          id="profile-document-file"
          name="profileDocumentFile"
          type="file"
          onChange={handleDocumentFile}
        />
        <div className="profile-file-control">
          <Button
            type="button"
            variant="secondary"
            onClick={() => documentInputRef.current?.click()}
          >
            {t("profileImport.selectFileButton")}
          </Button>
          <span>
            {document
              ? t("profileImport.fileSelected")
              : documentName || t("profileImport.noFileSelected")}
          </span>
        </div>
      </div>

      {document ? (
        <div className="profile-document-summary" role="status">
          <FileJson aria-hidden="true" size={18} />
          <div>
            <strong>{document.server.name}</strong>
            <span>
              {document.server.loaderType}{" "}
              {document.server.minecraftVersion ?? ""}
            </span>
          </div>
          <span>{documentName}</span>
        </div>
      ) : null}

      <div className="settings-grid">
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
          <span className="inline-field-row">
            <TextField
              name="profileTargetRootDir"
              value={targetRootDir}
              onChange={(event) => setTargetRootDir(event.target.value)}
            />
            <Button
              aria-label={t("profileImport.browseTargetFolder")}
              type="button"
              variant="secondary"
              onClick={async () => {
                const path = await pickPath("folder");
                if (path) setTargetRootDir(path);
              }}
            >
              <FolderOpen aria-hidden="true" size={15} />
              {t("profileImport.browse")}
            </Button>
          </span>
        </label>
        <label>
          {t("profileImport.javaRuntime")}
          <span className="inline-field-row">
            <TextField
              name="profileJavaPath"
              value={javaPath}
              onChange={(event) => setJavaPath(event.target.value)}
            />
            <Button
              aria-label={t("profileImport.browseJavaRuntime")}
              type="button"
              variant="secondary"
              onClick={async () => {
                const path = await pickPath("file");
                if (path) setJavaPath(path);
              }}
            >
              <FolderOpen aria-hidden="true" size={15} />
              {t("profileImport.browse")}
            </Button>
          </span>
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
