import { useCallback, useEffect, useState } from "react";
import { Overlay, Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { FolderDown } from "lucide-react";
import { useAppSettings } from "../../i18n";
import { droppedFilePath } from "../../lib/dropped-files";

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
        const path = droppedFilePath(files[i]);
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
    <Overlay backgroundOpacity={0.6} blur={3} center fixed zIndex={400}>
      <Paper
        p="xl"
        shadow="xl"
        style={{ border: "2px dashed var(--mantine-color-azure-6)" }}
        w={420}
      >
        <Stack align="center" gap="xs" ta="center">
          <ThemeIcon radius="xl" size={56} variant="light">
            <FolderDown aria-hidden="true" size={28} />
          </ThemeIcon>
          <Title order={2} fz="lg">
            {t("servers.dropImport.title")}
          </Title>
          <Text c="dimmed" size="sm">
            {t("servers.dropImport.description")}
          </Text>
        </Stack>
      </Paper>
    </Overlay>
  );
}
