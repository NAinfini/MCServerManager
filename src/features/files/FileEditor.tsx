import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { useAppSettings } from "../../i18n";
import type { ServerTextFile } from "./fileApi";

interface FileEditorProps {
  file: ServerTextFile | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
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
  onSave,
}: FileEditorProps) {
  const { t } = useAppSettings();
  const [content, setContent] = useState("");
  const loadedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!file) {
      loadedPathRef.current = null;
      setContent("");
      return;
    }

    setContent((current) => {
      if (loadedPathRef.current !== file.relativePath) {
        loadedPathRef.current = file.relativePath;
        return file.content;
      }

      return current === file.content ? file.content : current;
    });
  }, [file?.relativePath, file?.content]);

  if (isLoading) {
    return <div className="files-editor-empty">{t("files.editor.loading")}</div>;
  }

  if (!file) {
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

  const dirty = content !== file.content;
  const canSave = !file.readOnly && dirty && !isSaving;

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
        <Button
          disabled={!canSave}
          variant="primary"
          onClick={() => onSave(content)}
        >
          <Save aria-hidden="true" size={15} />
          {t("files.editor.save")}
        </Button>
      </div>

      {file.warning ? (
        <div className="inline-error files-editor-warning">{file.warning}</div>
      ) : null}
      {error ? (
        <div className="inline-error files-editor-warning">{error}</div>
      ) : null}

      <div className="monaco-host">
        <Editor
          height="360px"
          language={languageForPath(file.relativePath)}
          options={{
            minimap: { enabled: false },
            readOnly: file.readOnly,
            scrollBeyondLastLine: false,
            wordWrap: "on",
          }}
          theme="vs-dark"
          value={content}
          onChange={(value) => setContent(value ?? "")}
        />
      </div>
    </section>
  );
}
