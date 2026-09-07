import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Upload,
} from "lucide-react";
import type { ServerProfile } from "../../domain/server";
import { Button } from "../../components/ui/button";
import { ConfirmDangerDialog } from "../../components/ui/ConfirmDangerDialog";
import { TextField } from "../../components/ui/text-field";
import { useAppSettings } from "../../i18n";
import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";
import { queryKeys } from "../../lib/query-keys";
import { FileBrowser } from "./FileBrowser";
import { FileEditor } from "./FileEditor";
import {
  listServerFiles,
  mutateServerFiles,
  openServerFolder,
  readServerTextFile,
  type ServerFileEntry,
  type ServerFileMutation,
  writeServerTextFile,
} from "./fileApi";
import "./operations.css";

interface ServerFilesViewProps {
  server: ServerProfile;
  path?: string;
  onPathChange?: (path?: string) => void;
}

interface Breadcrumb {
  label: string;
  path: string;
}

type FileOperationDraft = {
  operation: "createFile" | "createDirectory" | "rename" | "move";
  entry?: ServerFileEntry;
  value: string;
};

function joinRelativePath(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name;
}

function parentPath(relativePath: string) {
  const segments = relativePath.split("/");
  segments.pop();
  return segments.join("/");
}

function validRelativePath(value: string) {
  const trimmed = value.trim();
  return (
    trimmed !== "" &&
    !trimmed.startsWith("/") &&
    !trimmed.startsWith("\\") &&
    !/^[a-z]:/i.test(trimmed) &&
    !trimmed.split(/[\\/]+/).includes("..")
  );
}

function validOperationValue(draft: FileOperationDraft) {
  const value = draft.value.trim().replace(/\\/g, "/");
  const changesTarget =
    !draft.entry ||
    (draft.operation === "rename"
      ? value !== draft.entry.name
      : value !== draft.entry.relativePath);
  return (
    validRelativePath(draft.value) &&
    (draft.operation === "move" || !/[\\/]/.test(draft.value)) &&
    changesTarget
  );
}

function buildBreadcrumbs(
  currentPath: string,
  rootLabel: string,
): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ label: rootLabel, path: "" }];
  const segments = currentPath.split("/").filter(Boolean);
  let accumulated = "";
  for (const segment of segments) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;
    crumbs.push({ label: segment, path: accumulated });
  }
  return crumbs;
}

function routeFileState(path?: string) {
  if (!path) return { currentPath: "", selectedPath: null };
  if (path.endsWith("/")) {
    return { currentPath: path.replace(/\/+$/, ""), selectedPath: null };
  }
  const segments = path.split("/");
  segments.pop();
  return { currentPath: segments.join("/"), selectedPath: path };
}

export function ServerFilesView({
  server,
  path,
  onPathChange,
}: ServerFilesViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const initialState = routeFileState(path);
  const [currentPath, setCurrentPath] = useState(initialState.currentPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(
    initialState.selectedPath,
  );
  const [operationDraft, setOperationDraft] =
    useState<FileOperationDraft | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<ServerFileEntry | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  useEffect(() => {
    const next = routeFileState(path);
    setCurrentPath(next.currentPath);
    setSelectedPath(next.selectedPath);
  }, [path, server.id]);
  const filesQuery = useQuery({
    queryKey: queryKeys.files.directory(server.id, currentPath),
    queryFn: () => listServerFiles(server.id, currentPath),
  });
  const selectedEntry =
    filesQuery.data?.find((entry) => entry.relativePath === selectedPath) ??
    null;
  const fileQuery = useQuery({
    enabled: selectedPath !== null && selectedEntry?.editable === true,
    queryKey: queryKeys.files.content(server.id, selectedPath),
    queryFn: () => readServerTextFile(server.id, selectedPath ?? ""),
  });
  const saveMutation = useMutation({
    mutationFn: (content: string) => {
      const file = fileQuery.data;
      if (!file) throw new Error(t("files.editor.fileUnavailable"));
      return writeServerTextFile(
        server.id,
        file.relativePath,
        content,
        file.revision,
      );
    },
    onSuccess: async (file) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.files.directory(server.id, currentPath),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.files.content(server.id, file.relativePath),
        }),
      ]);
    },
  });
  const openFolderMutation = useMutation({
    mutationFn: () => openServerFolder(server.id),
  });
  const fileMutation = useMutation({
    mutationFn: (mutation: ServerFileMutation) =>
      mutateServerFiles(server.id, mutation),
    onSuccess: async (result, mutation) => {
      setOperationDraft(null);
      setDeleteEntry(null);
      setPickerError(null);
      if (
        mutation.operation === "rename" ||
        mutation.operation === "move" ||
        mutation.operation === "delete"
      ) {
        if (selectedPath === mutation.relativePath) {
          setSelectedPath(null);
          onPathChange?.(currentPath ? `${currentPath}/` : undefined);
        }
      }
      if (mutation.operation === "createFile" && result.relativePaths[0]) {
        setSelectedPath(result.relativePaths[0]);
        onPathChange?.(result.relativePaths[0]);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.files.directory(server.id, currentPath),
      });
    },
  });

  const breadcrumbs = buildBreadcrumbs(currentPath, t("files.breadcrumb.root"));

  const openDirectory = (path: string) => {
    setCurrentPath(path);
    setSelectedPath(null);
    onPathChange?.(path ? `${path}/` : undefined);
    saveMutation.reset();
    fileMutation.reset();
    setOperationDraft(null);
  };

  function submitOperation() {
    if (!operationDraft || !validOperationValue(operationDraft)) return;
    const value = operationDraft.value.trim().replace(/\\/g, "/");
    if (operationDraft.operation === "createFile") {
      fileMutation.mutate({
        operation: "createFile",
        relativePath: joinRelativePath(currentPath, value),
        content: "",
      });
      return;
    }
    if (operationDraft.operation === "createDirectory") {
      fileMutation.mutate({
        operation: "createDirectory",
        relativePath: joinRelativePath(currentPath, value),
      });
      return;
    }
    if (!operationDraft.entry) return;
    fileMutation.mutate({
      operation: operationDraft.operation,
      relativePath: operationDraft.entry.relativePath,
      targetRelativePath:
        operationDraft.operation === "rename"
          ? joinRelativePath(
              parentPath(operationDraft.entry.relativePath),
              value,
            )
          : value,
    });
  }

  async function uploadFile() {
    fileMutation.reset();
    setPickerError(null);
    try {
      const result = await invokeDesktopCommandWithErrorHandling<{
        path: string | null;
      }>("show_open_dialog", { kind: "file" });
      if (result.path) {
        fileMutation.mutate({
          operation: "upload",
          relativePath: currentPath,
          sourcePaths: [result.path],
        });
      }
    } catch (error) {
      setPickerError(
        error instanceof Error ? error.message : t("files.upload.failed"),
      );
    }
  }

  return (
    <section className="files-panel" aria-label={t("files.aria")}>
      <div className="files-toolbar">
        <nav
          className="files-breadcrumb"
          aria-label={t("files.breadcrumb.aria")}
        >
          {breadcrumbs.map((crumb, index) => (
            <span className="files-breadcrumb-item" key={crumb.path || "root"}>
              {index > 0 ? (
                <ChevronRight
                  aria-hidden="true"
                  className="files-breadcrumb-sep"
                  size={13}
                />
              ) : null}
              {/* The current crumb used to be marked with `disabled`, which
                  dropped the one item saying where you are out of the tab
                  order and told a screen reader nothing. */}
              <button
                aria-current={crumb.path === currentPath ? "page" : undefined}
                className="files-breadcrumb-link"
                type="button"
                onClick={() => openDirectory(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
        <div className="files-toolbar-actions">
          <Button
            disabled={fileMutation.isPending}
            variant="secondary"
            onClick={() => {
              fileMutation.reset();
              setOperationDraft({ operation: "createFile", value: "" });
            }}
          >
            <FilePlus2 aria-hidden="true" size={14} />
            {t("files.actions.newFile")}
          </Button>
          <Button
            disabled={fileMutation.isPending}
            variant="secondary"
            onClick={() => {
              fileMutation.reset();
              setOperationDraft({ operation: "createDirectory", value: "" });
            }}
          >
            <FolderPlus aria-hidden="true" size={14} />
            {t("files.actions.newFolder")}
          </Button>
          <Button
            disabled={fileMutation.isPending}
            variant="secondary"
            onClick={uploadFile}
          >
            <Upload aria-hidden="true" size={14} />
            {t("files.actions.upload")}
          </Button>
          <Button
            disabled={filesQuery.isFetching}
            title={t("files.refresh")}
            variant="secondary"
            onClick={() => filesQuery.refetch()}
          >
            <RefreshCw aria-hidden="true" size={14} />
            {t("common.refresh")}
          </Button>
          <Button
            disabled={openFolderMutation.isPending}
            variant="secondary"
            onClick={() => openFolderMutation.mutate()}
          >
            <FolderOpen aria-hidden="true" size={14} />
            {t("files.openFolder")}
          </Button>
        </div>
      </div>

      {openFolderMutation.error ? (
        <div className="inline-error files-panel-error" role="alert">
          {openFolderMutation.error.message}
        </div>
      ) : null}

      {operationDraft ? (
        <form
          className="files-operation-bar"
          onSubmit={(event) => {
            event.preventDefault();
            submitOperation();
          }}
        >
          <label>
            <span>
              {t(`files.operation.${operationDraft.operation}.label`)}
            </span>
            <TextField
              autoFocus
              required
              aria-invalid={!validOperationValue(operationDraft)}
              value={operationDraft.value}
              onChange={(event) =>
                setOperationDraft({
                  ...operationDraft,
                  value: event.target.value,
                })
              }
            />
          </label>
          <Button
            disabled={
              fileMutation.isPending || !validOperationValue(operationDraft)
            }
            type="submit"
            variant="primary"
          >
            {t("common.save")}
          </Button>
          <Button
            disabled={fileMutation.isPending}
            variant="ghost"
            onClick={() => setOperationDraft(null)}
          >
            {t("common.cancel")}
          </Button>
        </form>
      ) : null}

      {fileMutation.error || pickerError ? (
        <div className="inline-error files-panel-error" role="alert">
          {fileMutation.error?.message ?? pickerError}
        </div>
      ) : null}

      {fileQuery.error ? (
        <div className="inline-error files-panel-error" role="alert">
          {fileQuery.error.message}
        </div>
      ) : null}

      <div className="files-body">
        <FileBrowser
          entries={filesQuery.data ?? []}
          error={filesQuery.error}
          isLoading={filesQuery.isLoading}
          selectedPath={selectedPath}
          onOpenDirectory={openDirectory}
          onOpenFile={(path) => {
            setSelectedPath(path);
            onPathChange?.(path);
            saveMutation.reset();
          }}
          onDelete={(entry) => {
            fileMutation.reset();
            setDeleteEntry(entry);
          }}
          onMove={(entry) => {
            fileMutation.reset();
            setOperationDraft({
              operation: "move",
              entry,
              value: entry.relativePath,
            });
          }}
          onRename={(entry) => {
            fileMutation.reset();
            setOperationDraft({
              operation: "rename",
              entry,
              value: entry.name,
            });
          }}
          onRetry={() => filesQuery.refetch()}
        />
        <FileEditor
          error={saveMutation.error?.message ?? null}
          file={fileQuery.data ?? null}
          isLoading={fileQuery.isLoading}
          isSaving={saveMutation.isPending}
          selectedEntry={selectedEntry}
          onReload={() => {
            saveMutation.reset();
            fileQuery.refetch();
          }}
          onSave={(content) => saveMutation.mutate(content)}
        />
      </div>
      <ConfirmDangerDialog
        confirmLabel={t("files.actions.delete")}
        description={t("files.delete.description", {
          name: deleteEntry?.name ?? "",
        })}
        error={fileMutation.error?.message ?? null}
        isConfirming={fileMutation.isPending}
        isOpen={deleteEntry !== null}
        title={t("files.delete.title")}
        onCancel={() => setDeleteEntry(null)}
        onConfirm={() => {
          if (deleteEntry) {
            fileMutation.mutate({
              operation: "delete",
              relativePath: deleteEntry.relativePath,
              confirmDelete: true,
            });
          }
        }}
      />
    </section>
  );
}
