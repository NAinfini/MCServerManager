import { FileText, Folder } from "lucide-react";
import { EmptyState } from "../../components/ui/empty-state";
import { useAppSettings } from "../../i18n";
import type { ServerFileEntry } from "./fileApi";

interface FileBrowserProps {
  entries: ServerFileEntry[];
  isLoading: boolean;
  selectedPath: string | null;
  onOpenDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileBrowser({
  entries,
  isLoading,
  selectedPath,
  onOpenDirectory,
  onOpenFile,
}: FileBrowserProps) {
  const { t } = useAppSettings();
  return (
    <section className="files-browser" aria-label={t("files.browser.aria")}>
      {isLoading ? <div className="list-state">{t("files.loading")}</div> : null}

      {!isLoading && entries.length === 0 ? (
        <EmptyState
          illustration="/illustrations/empty-folder.png"
          title={t("files.emptyDirectory.title")}
          description={t("files.emptyDirectory.description")}
        />
      ) : null}

      {!isLoading && entries.length > 0 ? (
        <div className="files-list" role="list">
          {entries.map((entry) => {
            const isDirectory = entry.kind === "directory";
            const Icon = isDirectory ? Folder : FileText;
            return (
              <button
                className={
                  entry.relativePath === selectedPath
                    ? "files-row files-row-selected"
                    : "files-row"
                }
                key={entry.relativePath || entry.name}
                type="button"
                onClick={() =>
                  isDirectory
                    ? onOpenDirectory(entry.relativePath)
                    : onOpenFile(entry.relativePath)
                }
              >
                <Icon aria-hidden="true" size={16} />
                <span>{entry.name}</span>
                <small>
                  {isDirectory ? t("files.folder") : formatBytes(entry.sizeBytes)}
                </small>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
