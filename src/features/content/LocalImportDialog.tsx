import { useState } from "react";
import { Group, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { FolderOpen, Upload } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAppSettings } from "../../i18n";
import {
  invokeDesktopCommandWithErrorHandling,
  normalizeDesktopCommandError,
} from "../../lib/desktop-command-error";

interface LocalImportDialogProps {
  error: string | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onImport: (sourcePath: string) => void;
}

export function LocalImportDialog({
  error,
  isSubmitting,
  onCancel,
  onImport,
}: LocalImportDialogProps) {
  const { t } = useAppSettings();
  const [sourcePath, setSourcePath] = useState("");
  const [pickerError, setPickerError] = useState<string | null>(null);

  const pickJar = async () => {
    setPickerError(null);
    try {
      const result = await invokeDesktopCommandWithErrorHandling<{
        path: string | null;
      }>("show_open_dialog", {
        kind: "file",
        filters: [{ name: "Minecraft content JAR", extensions: ["jar"] }],
      });
      if (result?.path) {
        setSourcePath(result.path);
      }
    } catch (caught) {
      setPickerError(normalizeDesktopCommandError(caught).message);
    }
  };

  return (
    <Paper
      component="form"
      p="md"
      onSubmit={(event) => {
        event.preventDefault();
        onImport(sourcePath);
      }}
    >
      <Stack gap="sm">
        <Stack gap={2}>
          <Title order={4}>{t("content.import.local.title")}</Title>
          <Text c="dimmed" size="sm">
            {t("content.import.local.description")}
          </Text>
        </Stack>
        <Group align="flex-end" gap="xs" wrap="nowrap">
          <TextInput
            autoFocus
            required
            ff="monospace"
            flex={1}
            label={t("content.import.local.sourcePath")}
            placeholder={t("content.import.local.placeholder")}
            readOnly
            value={sourcePath}
            onClick={pickJar}
          />
          <Button disabled={isSubmitting} variant="secondary" onClick={pickJar}>
            <FolderOpen aria-hidden="true" size={16} />
            {t("profileSettings.browse")}
          </Button>
        </Group>
        {pickerError ? (
          <Text c="red" size="sm">
            {pickerError}
          </Text>
        ) : null}
        {error ? (
          <Text c="red" size="sm">
            {error}
          </Text>
        ) : null}
        <Group gap="xs" justify="flex-end">
          <Button
            disabled={isSubmitting}
            type="button"
            variant="secondary"
            onClick={onCancel}
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={isSubmitting || sourcePath.trim() === ""}
            type="submit"
            variant="primary"
          >
            <Upload aria-hidden="true" size={16} />
            {t("content.import.action")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
