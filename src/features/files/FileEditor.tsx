import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Braces, Code2, FileLock2, RefreshCw, Save } from "lucide-react";
import {
  Alert,
  Box,
  Button as MantineButton,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { Button } from "../../components/ui/button";
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
      <Group gap="xs" justify="center" p="xl">
        <Loader size="xs" />
        <Text c="dimmed" size="sm">
          {t("files.editor.loading")}
        </Text>
      </Group>
    );
  }

  if (!file) {
    if (selectedEntry?.kind === "file" && !selectedEntry.editable) {
      return (
        <Stack component="section" gap={0} h="100%">
          <Box px="md" py="xs">
            <Text ff="monospace" fw={600} size="sm" truncate>
              {selectedEntry.relativePath}
            </Text>
            <Text c="dimmed" size="xs">
              {t("files.editor.readOnly")}
            </Text>
          </Box>
          <Stack align="center" gap="xs" m="auto" maw="52ch" p="xl" ta="center">
            <FileLock2 aria-hidden="true" size={28} />
            <Text fw={600}>{t("files.editor.binary.title")}</Text>
            <Text c="dimmed" size="sm">
              {t("files.editor.binary.description")}
            </Text>
          </Stack>
        </Stack>
      );
    }
    return (
      <Stack
        align="center"
        gap={4}
        justify="center"
        h="100%"
        p="xl"
        ta="center"
      >
        <Text fw={600}>{t("files.editor.empty.title")}</Text>
        <Text c="dimmed" size="sm">
          {t("files.editor.empty.description")}
        </Text>
      </Stack>
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
    <Stack
      aria-label={t("files.editor.aria")}
      component="section"
      gap={0}
      h="100%"
      mih={0}
    >
      <Group justify="space-between" px="md" py="xs" wrap="nowrap">
        <Box miw={0}>
          <Text ff="monospace" fw={600} size="sm" truncate>
            {file.relativePath}
          </Text>
          <Text c="dimmed" size="xs">
            {file.readOnly
              ? t("files.editor.readOnly")
              : t("files.editor.bytes", { count: file.sizeBytes })}
          </Text>
        </Box>
        <Group gap="xs" wrap="nowrap">
          {structuredAvailable ? (
            <MantineButton.Group aria-label={t("files.editor.mode")}>
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
            </MantineButton.Group>
          ) : null}
          <Button
            disabled={!canSave}
            variant="primary"
            onClick={() => onSave(content)}
          >
            <Save aria-hidden="true" size={14} />
            {t("files.editor.save")}
          </Button>
        </Group>
      </Group>

      {file.warning ? (
        <Alert color="yellow" mx="md" mb="xs" py="xs">
          {file.warning}
        </Alert>
      ) : null}
      {error ? (
        <Alert
          color="red"
          mx="md"
          mb="xs"
          role="alert"
          title={t("files.editor.saveFailed")}
        >
          <Stack align="flex-start" gap={4}>
            <Text size="sm">{error}</Text>
            <Text c="dimmed" size="sm">
              {t("files.editor.draftPreserved")}
            </Text>
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
          </Stack>
        </Alert>
      ) : null}

      {showStructuredEditor ? (
        <StructuredFileEditor
          content={content}
          path={file.relativePath}
          readOnly={file.readOnly}
          onChange={setContent}
        />
      ) : (
        <Box className="monaco-host" flex={1} mih={0}>
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
        </Box>
      )}
    </Stack>
  );
}
