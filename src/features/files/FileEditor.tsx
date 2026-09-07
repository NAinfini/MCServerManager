import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Braces, Code2, FileLock2, RefreshCw, Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { useAppSettings } from "../../i18n";
import type { ServerFileEntry, ServerTextFile } from "./fileApi";
import { useUnsavedGuard } from "../../lib/use-unsaved-guard";
import {
  hasStructuredFileEditor,
  StructuredFileEditor,
} from "./StructuredFileEditor";
// Points Monaco at the bundled copy instead of a CDN. Imported for its side
// effect, and must run before the editor mounts.
import "./monacoSetup";

interface FileEditorProps {
  file: ServerTextFile | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  selectedEntry?: ServerFileEntry | null;
  onReload?: () => void;
  onSave: (content: string) => void;
}

function languageForPath(path: string) {
  if (path.endsWith(".json")) {
    return "json";
  }
  if (
    path.endsWith(".properties") ||
    path.endsWith(".txt") ||
    path.endsWith(".log")
  ) {
    return "plaintext";
  }
  if (path.endsWith(".yml") || path.endsWith(".yaml")) {
    return "yaml";
  }
  if (path.endsWith(".toml")) {
    return "toml";
  }

  return "plaintext";
}

export function FileEditor({
  file,
  isLoading,
  isSaving,
  error,
  selectedEntry = null,
  onReload,
  onSave,
}: FileEditorProps) {
  const { resolvedTheme, t } = useAppSettings();
  const [content, setContent] = useState("");
  const [editorMode, setEditorMode] = useState<"structured" | "source">(
    "structured",
  );
  const loadedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!file) {
      loadedPathRef.current = null;
      setContent("");
      return;
    }

    if (loadedPathRef.current !== file.relativePath) {
      loadedPathRef.current = file.relativePath;
      setEditorMode(
        hasStructuredFileEditor(file.relativePath, file.content)
          ? "structured"
          : "source",
      );
      setContent(file.content);
      return;
    }

    setContent((current) => {
      return current === file.content ? file.content : current;
    });
  }, [file?.relativePath, file?.content, file?.revision]);

  const dirty = file ? content !== file.content : false;
  useUnsavedGuard({
    isDirty: dirty,
    message: t("files.editor.unsaved.confirm"),
    onDiscard: () => {
      if (file) setContent(file.content);
    },
  });

  if (isLoading) {
    return (
      <div className="files-editor-empty">{t("files.editor.loading")}</div>
    );
  }

  if (!file) {
    if (selectedEntry?.kind === "file" && !selectedEntry.editable) {
      return (
        <section className="files-editor files-binary-preview">
          <div className="files-editor-toolbar">
            <div>
              <strong>{selectedEntry.relativePath}</strong>
              <span>{t("files.editor.readOnly")}</span>
            </div>
          </div>
          <div className="files-binary-message">
            <FileLock2 aria-hidden="true" size={28} />
            <strong>{t("files.editor.binary.title")}</strong>
            <span>{t("files.editor.binary.description")}</span>
          </div>
        </section>
      );
    }
    return (
      <div className="files-editor-empty">
        <EmptyState
          illustration="/illustrations/no-file-selected.png"
          title={t("files.editor.empty.title")}
          description={t("files.editor.empty.description")}
        />
      </div>
    );
  }

  const canSave = !file.readOnly && dirty && !isSaving;
  const structuredAvailable = hasStructuredFileEditor(
    file.relativePath,
    content,
  );
  const showStructuredEditor =
    structuredAvailable && editorMode === "structured";

  return (
    <section className="files-editor" aria-label={t("files.editor.aria")}>
      <div className="files-editor-toolbar">
        <div>
          <strong>{file.relativePath}</strong>
          <span>
            {file.readOnly
              ? t("files.editor.readOnly")
              : t("files.editor.bytes", { count: file.sizeBytes })}
          </span>
        </div>
        <div className="files-editor-toolbar-actions">
          {structuredAvailable ? (
            <div
              aria-label={t("files.editor.mode")}
              className="editor-mode-toggle"
              role="group"
            >
              <Button
                aria-pressed={showStructuredEditor}
                variant={showStructuredEditor ? "secondary" : "ghost"}
                onClick={() => setEditorMode("structured")}
              >
                <Braces aria-hidden="true" size={14} />
                {t("files.editor.structured")}
              </Button>
              <Button
                aria-pressed={!showStructuredEditor}
                variant={!showStructuredEditor ? "secondary" : "ghost"}
                onClick={() => setEditorMode("source")}
              >
                <Code2 aria-hidden="true" size={14} />
                {t("files.editor.source")}
              </Button>
            </div>
          ) : null}
          <Button
            disabled={!canSave}
            variant="primary"
            onClick={() => onSave(content)}
          >
            <Save aria-hidden="true" size={15} />
            {t("files.editor.save")}
          </Button>
        </div>
      </div>

      {file.warning ? (
        <div className="inline-error files-editor-warning">{file.warning}</div>
      ) : null}
      {error ? (
        <div className="inline-error files-editor-warning" role="alert">
          <strong>{t("files.editor.saveFailed")}</strong>
          <span>{error}</span>
          <span>{t("files.editor.draftPreserved")}</span>
          {onReload ? (
            <Button
              variant="secondary"
              onClick={() => {
                loadedPathRef.current = null;
                setContent(file.content);
                onReload();
              }}
            >
              <RefreshCw aria-hidden="true" size={14} />
              {t("files.editor.reloadDisk")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showStructuredEditor ? (
        <StructuredFileEditor
          content={content}
          path={file.relativePath}
          readOnly={file.readOnly}
          onChange={setContent}
        />
      ) : (
        <div className="monaco-host">
          <Editor
            height="100%"
            language={languageForPath(file.relativePath)}
            options={{
              minimap: { enabled: false },
              readOnly: file.readOnly,
              scrollBeyondLastLine: false,
              wordWrap: "on",
            }}
            theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
            value={content}
            onChange={(value) => setContent(value ?? "")}
          />
        </div>
      )}
    </section>
  );
}
