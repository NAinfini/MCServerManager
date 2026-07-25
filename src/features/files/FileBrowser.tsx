import { FileText, Folder, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { useAppSettings } from "../../i18n";
import { formatBytes } from "../../lib/format-bytes";
import type { ServerFileEntry } from "./fileApi";

interface FileBrowserProps {
  entries: ServerFileEntry[];
  error?: Error | null;
  isLoading: boolean;
  selectedPath: string | null;
  onOpenDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  onRetry?: () => void;
}

export function FileBrowser({
  entries,
  error = null,
  isLoading,
  selectedPath,
  onOpenDirectory,
  onOpenFile,
  onRetry,
}: FileBrowserProps) {
  const { t } = useAppSettings();
  return (
    <section className="files-browser" aria-label={t("files.browser.aria")}>
      {isLoading ? <div className="list-state">{t("files.loading")}</div> : null}

      {!isLoading && error ? (
        <div
          aria-label={t("files.loadError")}
          className="list-state list-state-error"
          role="alert"
        >
          <strong>{t("files.loadError")}</strong>
          <span>{error.message}</span>
          {onRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              <RefreshCw aria-hidden="true" size={15} />
              {t("common.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!isLoading && !error && entries.length === 0 ? (
        <EmptyState
          illustration="/illustrations/empty-folder.png"
          title={t("files.emptyDirectory.title")}
          description={t("files.emptyDirectory.description")}
        />
      ) : null}

      {!isLoading && !error && entries.length > 0 ? (
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
