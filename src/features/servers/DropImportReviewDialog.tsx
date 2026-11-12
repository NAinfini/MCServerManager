import {
  ActionIcon,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { Archive, FileArchive, FileCode2, FolderOpen, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { DialogSurface } from "../../components/ui/dialog-surface";
import { useAppSettings } from "../../i18n";

interface DropImportReviewDialogProps {
  open: boolean;
  paths: string[];
  onOpenChange: (open: boolean) => void;
  onContinue: () => void;
}

type DropImportKind = "modrinthPack" | "archive" | "jar" | "folder";

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function detectKind(path: string): DropImportKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".mrpack")) return "modrinthPack";
  if (lower.endsWith(".zip")) return "archive";
  if (lower.endsWith(".jar")) return "jar";
  return "folder";
}

const kindIcon = {
  modrinthPack: Archive,
  archive: FileArchive,
  jar: FileCode2,
  folder: FolderOpen,
} satisfies Record<DropImportKind, typeof Archive>;

export function DropImportReviewDialog({
  open,
  paths,
  onOpenChange,
  onContinue,
}: DropImportReviewDialogProps) {
  const { t } = useAppSettings();
  const primaryPath = paths[0] ?? "";
  const kind = detectKind(primaryPath);
  const Icon = kindIcon[kind];

  return (
    <DialogSurface
      open={open}
      description={t("dropImport.review.description")}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={paths.length !== 1}
            type="button"
            onClick={onContinue}
          >
            {t("dropImport.review.continue")}
          </Button>
        </>
      }
      title={t("dropImport.review.title")}
      onOpenChange={onOpenChange}
      header={({ description, title }) => (
        <Group align="flex-start" justify="space-between" wrap="nowrap">
          <div>
            {title}
            {description}
          </div>
          <ActionIcon
            aria-label={t("dropImport.review.close")}
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" size={16} />
          </ActionIcon>
        </Group>
      )}
    >
      <Stack gap="md" mt="md">
        <Paper bg="var(--mantine-color-default-hover)" p="md">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon size="xl" variant="light">
              <Icon aria-hidden="true" size={22} />
            </ThemeIcon>
            <div style={{ minWidth: 0 }}>
              <Text fw={600} truncate>
                {basename(primaryPath)}
              </Text>
              <Text c="dimmed" size="sm">
                {t(`dropImport.kind.${kind}`)}
              </Text>
            </div>
          </Group>
        </Paper>
        <SimpleGrid cols={2} spacing="md">
          <div>
            <Text c="dimmed" size="xs">
              {t("dropImport.review.confidence")}
            </Text>
            <Text fw={600} size="sm">
              {t("dropImport.review.confidenceValue")}
            </Text>
          </div>
          <div>
            <Text c="dimmed" size="xs">
              {t("dropImport.review.action")}
            </Text>
            <Text fw={600} size="sm">
              {t(`dropImport.action.${kind}`)}
            </Text>
          </div>
        </SimpleGrid>
        <Text c="dimmed" size="sm">
          {paths.length > 1
            ? t("provisioning.wizard.dropSingle")
            : t("dropImport.review.note")}
        </Text>
      </Stack>
    </DialogSurface>
  );
}
