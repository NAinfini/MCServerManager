import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServerProfile } from "../servers/types";
import { useAppSettings } from "../../i18n";
import { FileBrowser } from "./FileBrowser";
import { FileEditor } from "./FileEditor";
import {
  listServerFiles,
  readServerTextFile,
  writeServerTextFile,
} from "./fileApi";

interface ServerFilesViewProps {
  server: ServerProfile;
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

  return (
    <section className="files-panel" aria-label={t("files.aria")}>
      {filesQuery.error ? (
        <div className="inline-error files-panel-error">
          {filesQuery.error.message}
        </div>
      ) : null}
      <div className="files-layout">
        <FileBrowser
          currentPath={currentPath}
          entries={filesQuery.data ?? []}
          isLoading={filesQuery.isLoading}
          selectedPath={selectedPath}
          onOpenDirectory={(path) => {
            setCurrentPath(path);
            setSelectedPath(null);
            saveMutation.reset();
          }}
          onOpenFile={(path) => {
            setSelectedPath(path);
            saveMutation.reset();
          }}
          onRefresh={() => filesQuery.refetch()}
        />
        <FileEditor
          error={
            saveMutation.error?.message ?? fileQuery.error?.message ?? null
          }
          file={fileQuery.data ?? null}
          isLoading={fileQuery.isLoading}
          isSaving={saveMutation.isPending}
          onSave={(content) => saveMutation.mutate(content)}
        />
      </div>
    </section>
  );
}
