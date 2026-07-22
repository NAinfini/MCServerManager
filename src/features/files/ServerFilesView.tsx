import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FolderOpen, RefreshCw } from "lucide-react";
import type { ServerProfile } from "../servers/types";
import { Button } from "../../components/ui/button";
import { useAppSettings } from "../../i18n";
import { FileBrowser } from "./FileBrowser";
import { FileEditor } from "./FileEditor";
import {
  listServerFiles,
  openServerFolder,
  readServerTextFile,
  writeServerTextFile,
} from "./fileApi";

interface ServerFilesViewProps {
  server: ServerProfile;
}

interface Breadcrumb {
  label: string;
  path: string;
}

function buildBreadcrumbs(currentPath: string, rootLabel: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ label: rootLabel, path: "" }];
  const segments = currentPath.split("/").filter(Boolean);
  let accumulated = "";
  for (const segment of segments) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;
    crumbs.push({ label: segment, path: accumulated });
  }
  return crumbs;
}

export function ServerFilesView({ server }: ServerFilesViewProps) {
  const { t } = useAppSettings();
  const queryClient = useQueryClient();
  const [currentPath, setCurrentPath] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const filesQuery = useQuery({
    queryKey: ["serverFiles", server.id, currentPath],
    queryFn: () => listServerFiles(server.id, currentPath),
  });
  const fileQuery = useQuery({
    enabled: selectedPath !== null,
    queryKey: ["serverFile", server.id, selectedPath],
    queryFn: () => readServerTextFile(server.id, selectedPath ?? ""),
  });
  const saveMutation = useMutation({
    mutationFn: (content: string) =>
      writeServerTextFile(server.id, selectedPath ?? "", content),
    onSuccess: async (file) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["serverFiles", server.id, currentPath],
        }),
        queryClient.invalidateQueries({
          queryKey: ["serverFile", server.id, file.relativePath],
        }),
      ]);
    },
  });
  const openFolderMutation = useMutation({
    mutationFn: () => openServerFolder(server.id),
  });

  const breadcrumbs = buildBreadcrumbs(currentPath, t("files.breadcrumb.root"));

  const openDirectory = (path: string) => {
    setCurrentPath(path);
    setSelectedPath(null);
    saveMutation.reset();
  };

  return (
    <section className="files-panel" aria-label={t("files.aria")}>
      <div className="files-toolbar">
        <nav className="files-breadcrumb" aria-label={t("files.breadcrumb.aria")}>
          {breadcrumbs.map((crumb, index) => (
            <span className="files-breadcrumb-item" key={crumb.path || "root"}>
              {index > 0 ? (
                <ChevronRight
                  aria-hidden="true"
                  className="files-breadcrumb-sep"
                  size={13}
                />
              ) : null}
              <button
                className="files-breadcrumb-link"
                disabled={crumb.path === currentPath}
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

      {filesQuery.error ? (
        <div className="inline-error files-panel-error">
          {filesQuery.error.message}
        </div>
      ) : null}
      {openFolderMutation.error ? (
        <div className="inline-error files-panel-error">
          {openFolderMutation.error.message}
        </div>
      ) : null}

      <div className="files-body">
        <FileBrowser
          entries={filesQuery.data ?? []}
          isLoading={filesQuery.isLoading}
          selectedPath={selectedPath}
          onOpenDirectory={openDirectory}
          onOpenFile={(path) => {
            setSelectedPath(path);
            saveMutation.reset();
          }}
        />
        <FileEditor
          error={saveMutation.error?.message ?? fileQuery.error?.message ?? null}
          file={fileQuery.data ?? null}
          isLoading={fileQuery.isLoading}
          isSaving={saveMutation.isPending}
          onSave={(content) => saveMutation.mutate(content)}
        />
      </div>
    </section>
  );
}
