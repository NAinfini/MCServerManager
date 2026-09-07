import {
  ArrowRightLeft,
  FileText,
  Folder,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { useAppSettings } from "../../i18n";
import { formatBytes } from "../../lib/format-bytes";
import { formatDateTime } from "../../lib/date-format";
import type { ServerFileEntry } from "./fileApi";

interface FileBrowserProps {
  entries: ServerFileEntry[];
  error?: Error | null;
  isLoading: boolean;
  selectedPath: string | null;
  onOpenDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  onDelete?: (entry: ServerFileEntry) => void;
  onMove?: (entry: ServerFileEntry) => void;
  onRename?: (entry: ServerFileEntry) => void;
  onRetry?: () => void;
}

export function FileBrowser({
  entries,
  error = null,
  isLoading,
  selectedPath,
  onOpenDirectory,
  onOpenFile,
  onDelete,
  onMove,
  onRename,
  onRetry,
}: FileBrowserProps) {
  const { language, t } = useAppSettings();
  return (
    <section className="files-browser" aria-label={t("files.browser.aria")}>
      {isLoading ? (
        <div className="list-state">{t("files.loading")}</div>
      ) : null}

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
        <div className="files-table-scroll">
          <table className="files-table">
            <caption className="visually-hidden">
              {t("files.browser.aria")}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("files.table.name")}</th>
                <th scope="col">{t("files.table.size")}</th>
                <th scope="col">{t("files.table.modified")}</th>
                <th scope="col">{t("files.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isDirectory = entry.kind === "directory";
                const Icon = isDirectory ? Folder : FileText;
                return (
                  <tr
                    className={
                      entry.relativePath === selectedPath
                        ? "files-table-row files-table-row-selected"
                        : "files-table-row"
                    }
                    key={entry.relativePath || entry.name}
                  >
                    <th scope="row">
                      <button
                        className="files-name-button"
                        type="button"
                        onClick={() =>
                          isDirectory
                            ? onOpenDirectory(entry.relativePath)
                            : onOpenFile(entry.relativePath)
                        }
                      >
                        <Icon aria-hidden="true" size={16} />
                        <span title={entry.name}>{entry.name}</span>
                      </button>
                    </th>
                    <td>
                      {isDirectory
                        ? t("files.folder")
                        : formatBytes(entry.sizeBytes)}
                    </td>
                    <td>
                      {entry.modifiedAt
                        ? formatDateTime(entry.modifiedAt, language)
                        : t("common.unknown")}
                    </td>
                    <td>
                      <div className="files-row-actions">
                        {onRename ? (
                          <Button
                            aria-label={t("files.actions.renameNamed", {
                              name: entry.name,
                            })}
                            className="icon-button"
                            title={t("files.actions.rename")}
                            variant="ghost"
                            onClick={() => onRename(entry)}
                          >
                            <Pencil aria-hidden="true" size={14} />
                          </Button>
                        ) : null}
                        {onMove ? (
                          <Button
                            aria-label={t("files.actions.moveNamed", {
                              name: entry.name,
                            })}
                            className="icon-button"
                            title={t("files.actions.move")}
                            variant="ghost"
                            onClick={() => onMove(entry)}
                          >
                            <ArrowRightLeft aria-hidden="true" size={14} />
                          </Button>
                        ) : null}
                        {onDelete ? (
                          <Button
                            aria-label={t("files.actions.deleteNamed", {
                              name: entry.name,
                            })}
                            className="icon-button"
                            title={t("files.actions.delete")}
                            variant="danger"
                            onClick={() => onDelete(entry)}
                          >
                            <Trash2 aria-hidden="true" size={14} />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
