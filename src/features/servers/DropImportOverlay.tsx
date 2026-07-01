import { useCallback, useEffect, useState } from "react";
import { FolderDown } from "lucide-react";
import { useAppSettings } from "../../i18n";

interface DropImportOverlayProps {
  onDrop: (paths: string[]) => void;
}

export function DropImportOverlay({ onDrop }: DropImportOverlayProps) {
  const { t } = useAppSettings();
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer?.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    if (
      event.relatedTarget === null ||
      !(event.currentTarget as Node)?.contains(event.relatedTarget as Node)
    ) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const path = (file as File & { path?: string }).path;
        if (path) {
          paths.push(path);
        }
      }
      if (paths.length > 0) {
        onDrop(paths);
      }
    },
    [onDrop],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.addEventListener("dragenter", handleDragEnter);
    root.addEventListener("dragleave", handleDragLeave);
    root.addEventListener("dragover", handleDragOver);
    root.addEventListener("drop", handleDrop);
    return () => {
      root.removeEventListener("dragenter", handleDragEnter);
      root.removeEventListener("dragleave", handleDragLeave);
      root.removeEventListener("dragover", handleDragOver);
      root.removeEventListener("drop", handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  if (!isDragging) return null;

  return (
    <div className="drop-import-overlay drop-import-overlay-active">
      <div className="drop-import-zone">
        <FolderDown aria-hidden="true" size={40} color="var(--accent)" />
        <h2>{t("servers.dropImport.title")}</h2>
        <p>{t("servers.dropImport.description")}</p>
      </div>
    </div>
  );
}
