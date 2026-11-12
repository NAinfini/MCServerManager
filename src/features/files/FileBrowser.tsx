import {
  ActionIcon,
  Alert,
  Box,
  Group,
  Loader,
  ScrollArea,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowRightLeft,
  FileText,
  Folder,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
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
    <Box
      aria-label={t("files.browser.aria")}
      component="section"
      h="100%"
      mih={0}
    >
      {isLoading ? (
        <Group gap="xs" p="md">
          <Loader size="xs" />
          <Text c="dimmed" size="sm">
            {t("files.loading")}
          </Text>
        </Group>
      ) : null}

      {!isLoading && error ? (
        <Alert
          aria-label={t("files.loadError")}
          color="red"
          m="sm"
          role="alert"
          title={t("files.loadError")}
        >
          <Text size="sm">{error.message}</Text>
          {onRetry ? (
            <Group mt="xs">
              <Button variant="secondary" onClick={onRetry}>
                <RefreshCw aria-hidden="true" size={14} />
                {t("common.retry")}
              </Button>
            </Group>
          ) : null}
        </Alert>
      ) : null}

      {!isLoading && !error && entries.length === 0 ? (
        <Box p="md">
          <Text fw={600} size="sm">
            {t("files.emptyDirectory.title")}
          </Text>
          <Text c="dimmed" size="sm">
            {t("files.emptyDirectory.description")}
          </Text>
        </Box>
      ) : null}

      {!isLoading && !error && entries.length > 0 ? (
        <ScrollArea h="100%">
          <Table highlightOnHover stickyHeader verticalSpacing="xs">
            <caption className="visually-hidden">
              {t("files.browser.aria")}
            </caption>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("files.table.name")}</Table.Th>
                <Table.Th>{t("files.table.size")}</Table.Th>
                <Table.Th>{t("files.table.modified")}</Table.Th>
                <Table.Th ta="end">{t("files.table.actions")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((entry) => {
                const isDirectory = entry.kind === "directory";
                const Icon = isDirectory ? Folder : FileText;
                return (
                  <Table.Tr
                    bg={
                      entry.relativePath === selectedPath
                        ? "var(--mantine-primary-color-light)"
                        : undefined
                    }
                    key={entry.relativePath || entry.name}
                  >
                    <Table.Th fw={500} maw={0} scope="row" w="100%">
                      <UnstyledButton
                        maw="100%"
                        onClick={() =>
                          isDirectory
                            ? onOpenDirectory(entry.relativePath)
                            : onOpenFile(entry.relativePath)
                        }
                      >
                        <Group gap={8} wrap="nowrap">
                          <Icon aria-hidden="true" size={14} />
                          <Text size="sm" title={entry.name} truncate>
                            {entry.name}
                          </Text>
                        </Group>
                      </UnstyledButton>
                    </Table.Th>
                    <Table.Td
                      c="dimmed"
                      ff="monospace"
                      fz="xs"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {isDirectory
                        ? t("files.folder")
                        : formatBytes(entry.sizeBytes)}
                    </Table.Td>
                    <Table.Td c="dimmed" style={{ whiteSpace: "nowrap" }}>
                      {entry.modifiedAt
                        ? formatDateTime(entry.modifiedAt, language)
                        : t("common.unknown")}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={2} justify="flex-end" wrap="nowrap">
                        {onRename ? (
                          <Tooltip label={t("files.actions.rename")}>
                            <ActionIcon
                              aria-label={t("files.actions.renameNamed", {
                                name: entry.name,
                              })}
                              onClick={() => onRename(entry)}
                            >
                              <Pencil aria-hidden="true" size={14} />
                            </ActionIcon>
                          </Tooltip>
                        ) : null}
                        {onMove ? (
                          <Tooltip label={t("files.actions.move")}>
                            <ActionIcon
                              aria-label={t("files.actions.moveNamed", {
                                name: entry.name,
                              })}
                              onClick={() => onMove(entry)}
                            >
                              <ArrowRightLeft aria-hidden="true" size={14} />
                            </ActionIcon>
                          </Tooltip>
                        ) : null}
                        {onDelete ? (
                          <Tooltip label={t("files.actions.delete")}>
                            <ActionIcon
                              aria-label={t("files.actions.deleteNamed", {
                                name: entry.name,
                              })}
                              color="red"
                              onClick={() => onDelete(entry)}
                            >
                              <Trash2 aria-hidden="true" size={14} />
                            </ActionIcon>
                          </Tooltip>
                        ) : null}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      ) : null}
    </Box>
  );
}
