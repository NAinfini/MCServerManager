import { Plus, Trash2 } from "lucide-react";
import {
  ActionIcon,
  Checkbox,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Button } from "../../components/ui/button";
import {
  EditableTable,
  type EditableTableProps,
} from "../../components/data/EditableTable";
import { useAppSettings } from "../../i18n";

type JsonScalar = string | number | boolean | null;
type JsonRecord = Record<string, JsonScalar>;

type StructuredDocument =
  | { kind: "properties"; rows: PropertyRow[] }
  | { kind: "json-records"; columns: string[]; value: JsonRecord[] }
  | { kind: "json-object"; value: JsonRecord }
  | { kind: "json-values"; value: JsonScalar[] };

interface PropertyRow {
  key: string;
  lineIndex: number;
  prefix: string;
  separator: string;
  value: string;
}

interface StructuredFileEditorProps {
  content: string;
  path: string;
  readOnly: boolean;
  onChange: (content: string) => void;
}

const knownJsonColumns: Record<string, string[]> = {
  "ops.json": ["uuid", "name", "level", "bypassesPlayerLimit"],
  "whitelist.json": ["uuid", "name"],
  "banned-players.json": [
    "uuid",
    "name",
    "created",
    "source",
    "expires",
    "reason",
  ],
  "banned-ips.json": ["ip", "created", "source", "expires", "reason"],
  "usercache.json": ["name", "uuid", "expiresOn"],
};

function fileName(path: string) {
  return path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
}

function isScalar(value: unknown): value is JsonScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isScalarRecord(value: unknown): value is JsonRecord {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(isScalar)
  );
}

function parsePropertyRows(content: string): PropertyRow[] {
  const lines = content.split(/\r?\n/);
  return lines.flatMap((line, lineIndex) => {
    if (!line.trim() || /^\s*[#!]/.test(line)) {
      return [];
    }
    const match = line.match(/^(\s*)([^#!][^=:]*?)(\s*[=:]\s*)(.*)$/);
    if (!match) {
      return [];
    }
    return [
      {
        key: match[2].trim(),
        lineIndex,
        prefix: match[1],
        separator: match[3],
        value: match[4],
      },
    ];
  });
}

function parseStructuredDocument(
  path: string,
  content: string,
): StructuredDocument | null {
  if (path.toLowerCase().endsWith(".properties")) {
    return { kind: "properties", rows: parsePropertyRows(content) };
  }
  if (!path.toLowerCase().endsWith(".json")) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) {
      const knownColumns = knownJsonColumns[fileName(path)] ?? [];
      if (
        parsed.every(isScalarRecord) &&
        (parsed.length > 0 || knownColumns.length > 0)
      ) {
        const discoveredColumns = parsed.flatMap((entry) => Object.keys(entry));
        return {
          kind: "json-records",
          columns: [...new Set([...knownColumns, ...discoveredColumns])],
          value: parsed,
        };
      }
      if (parsed.every(isScalar)) {
        return { kind: "json-values", value: parsed };
      }
      return null;
    }
    if (isScalarRecord(parsed)) {
      return { kind: "json-object", value: parsed };
    }
  } catch {
    return null;
  }
  return null;
}

export function hasStructuredFileEditor(path: string, content: string) {
  return parseStructuredDocument(path, content) !== null;
}

function serializeJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function replaceLine(content: string, lineIndex: number, nextLine: string) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  lines[lineIndex] = nextLine;
  return lines.join(newline);
}

function removeLine(content: string, lineIndex: number) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  lines.splice(lineIndex, 1);
  return lines.join(newline);
}

function appendProperty(content: string) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const hasTrailingNewline = content.endsWith("\n");
  const base = hasTrailingNewline ? content : `${content}${newline}`;
  return `${base}new-property=${hasTrailingNewline ? newline : ""}`;
}

function defaultRecord(path: string, columns: string[]): JsonRecord {
  const defaults: JsonRecord = {};
  for (const column of columns) {
    if (column === "level") {
      defaults[column] = 4;
    } else if (column === "bypassesPlayerLimit") {
      defaults[column] = false;
    } else {
      defaults[column] = "";
    }
  }
  if (!columns.length) {
    defaults.value = "";
  }
  if (fileName(path) === "banned-players.json") {
    defaults.expires = "forever";
  }
  return defaults;
}

function valueForInput(value: JsonScalar | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function nextScalarValue(current: JsonScalar | undefined, value: string) {
  if (typeof current === "number") {
    return Number(value);
  }
  return value;
}

export function StructuredFileEditor({
  content,
  onChange,
  path,
  readOnly,
}: StructuredFileEditorProps) {
  const { t } = useAppSettings();
  const document = parseStructuredDocument(path, content);

  if (!document) {
    return null;
  }

  if (document.kind === "properties") {
    const columns: EditableTableProps<PropertyRow>["columns"] = [
      {
        id: "key",
        header: t("files.structured.key"),
        cell: (row) => (
          <TextInput
            aria-label={`${row.key} ${t("files.structured.key").toLowerCase()}`}
            disabled={readOnly}
            value={row.key}
            onChange={(event) =>
              onChange(
                replaceLine(
                  content,
                  row.lineIndex,
                  `${row.prefix}${event.target.value}${row.separator}${row.value}`,
                ),
              )
            }
          />
        ),
      },
      {
        id: "value",
        header: t("files.structured.value"),
        cell: (row) => (
          <TextInput
            aria-label={`${row.key} ${t("files.structured.value").toLowerCase()}`}
            disabled={readOnly}
            value={row.value}
            onChange={(event) =>
              onChange(
                replaceLine(
                  content,
                  row.lineIndex,
                  `${row.prefix}${row.key}${row.separator}${event.target.value}`,
                ),
              )
            }
          />
        ),
      },
      {
        id: "actions",
        header: "",
        cellClassName: "structured-table-actions",
        cell: (row) => (
          <Tooltip
            label={t("files.structured.removeProperty", { key: row.key })}
          >
            <ActionIcon
              aria-label={t("files.structured.removeProperty", {
                key: row.key,
              })}
              color="red"
              disabled={readOnly}
              onClick={() => onChange(removeLine(content, row.lineIndex))}
            >
              <Trash2 aria-hidden="true" size={14} />
            </ActionIcon>
          </Tooltip>
        ),
      },
    ];
    return (
      <Stack flex={1} gap={0} mih={0}>
        <Group justify="space-between" px="md" py="xs" wrap="nowrap">
          <Text c="dimmed" size="sm">
            {t("files.structured.propertiesDescription")}
          </Text>
          <Button
            disabled={readOnly}
            variant="secondary"
            onClick={() => onChange(appendProperty(content))}
          >
            <Plus aria-hidden="true" size={14} />
            {t("files.structured.addProperty")}
          </Button>
        </Group>
        {document.rows.length ? (
          <ScrollArea flex={1} mih={0}>
            <EditableTable
              caption={t("files.structured.propertiesDescription")}
              columns={columns}
              getRowKey={(row) => row.lineIndex}
              rows={document.rows}
            />
          </ScrollArea>
        ) : (
          <Text c="dimmed" px="md" py="sm" size="sm">
            {t("files.structured.emptyProperties")}
          </Text>
        )}
      </Stack>
    );
  }

  if (document.kind === "json-records") {
    const columns: EditableTableProps<JsonRecord>["columns"] = [
      ...document.columns.map((column) => ({
        id: column,
        header: column,
        cell: (row: JsonRecord, rowIndex: number) => {
          const value = row[column];
          if (typeof value === "boolean" || column === "bypassesPlayerLimit") {
            return (
              <Checkbox
                aria-label={`${column} ${t("files.structured.row", {
                  index: rowIndex + 1,
                })}`}
                checked={value === true}
                disabled={readOnly}
                onChange={(event) => {
                  const next = document.value.map((entry, entryIndex) =>
                    entryIndex === rowIndex
                      ? { ...entry, [column]: event.currentTarget.checked }
                      : entry,
                  );
                  onChange(serializeJson(next));
                }}
              />
            );
          }
          return (
            <TextInput
              aria-label={`${column} ${t("files.structured.row", {
                index: rowIndex + 1,
              })}`}
              disabled={readOnly}
              type={
                typeof value === "number" || column === "level"
                  ? "number"
                  : "text"
              }
              value={valueForInput(value)}
              onChange={(event) => {
                const next = document.value.map((entry, entryIndex) =>
                  entryIndex === rowIndex
                    ? {
                        ...entry,
                        [column]:
                          column === "level"
                            ? Number(event.target.value)
                            : nextScalarValue(value, event.target.value),
                      }
                    : entry,
                );
                onChange(serializeJson(next));
              }}
            />
          );
        },
      })),
      {
        id: "actions",
        header: "",
        cellClassName: "structured-table-actions",
        cell: (_row, rowIndex) => (
          <Tooltip
            label={t("files.structured.removeRow", {
              index: rowIndex + 1,
            })}
          >
            <ActionIcon
              aria-label={t("files.structured.removeRow", {
                index: rowIndex + 1,
              })}
              color="red"
              disabled={readOnly}
              onClick={() =>
                onChange(
                  serializeJson(
                    document.value.filter((_, index) => index !== rowIndex),
                  ),
                )
              }
            >
              <Trash2 aria-hidden="true" size={14} />
            </ActionIcon>
          </Tooltip>
        ),
      },
    ];
    return (
      <Stack flex={1} gap={0} mih={0}>
        <Group justify="space-between" px="md" py="xs" wrap="nowrap">
          <Text c="dimmed" size="sm">
            {t("files.structured.recordsDescription")}
          </Text>
          <Button
            disabled={readOnly}
            variant="secondary"
            onClick={() =>
              onChange(
                serializeJson([
                  ...document.value,
                  defaultRecord(path, document.columns),
                ]),
              )
            }
          >
            <Plus aria-hidden="true" size={14} />
            {t("files.structured.addRecord")}
          </Button>
        </Group>
        {document.value.length ? (
          <ScrollArea flex={1} mih={0}>
            <EditableTable
              caption={t("files.structured.recordsDescription")}
              columns={columns}
              getRowKey={(_, index) => index}
              rows={document.value}
            />
          </ScrollArea>
        ) : (
          <Text c="dimmed" px="md" py="sm" size="sm">
            {t("files.structured.emptyRecords")}
          </Text>
        )}
      </Stack>
    );
  }

  if (document.kind === "json-object") {
    const entries = Object.entries(document.value);
    const columns: EditableTableProps<[string, JsonScalar]>["columns"] = [
      {
        id: "key",
        header: t("files.structured.key"),
        cell: ([key, value], index) => (
          <TextInput
            aria-label={`${key} ${t("files.structured.key").toLowerCase()}`}
            disabled={readOnly}
            value={key}
            onChange={(event) => {
              const nextEntries = [...entries];
              nextEntries[index] = [event.target.value, value];
              onChange(serializeJson(Object.fromEntries(nextEntries)));
            }}
          />
        ),
      },
      {
        id: "value",
        header: t("files.structured.value"),
        cell: ([key, value]) =>
          typeof value === "boolean" ? (
            <Checkbox
              aria-label={`${key} ${t("files.structured.value").toLowerCase()}`}
              checked={value}
              disabled={readOnly}
              onChange={(event) =>
                onChange(
                  serializeJson({
                    ...document.value,
                    [key]: event.currentTarget.checked,
                  }),
                )
              }
            />
          ) : (
            <TextInput
              aria-label={`${key} ${t("files.structured.value").toLowerCase()}`}
              disabled={readOnly}
              type={typeof value === "number" ? "number" : "text"}
              value={valueForInput(value)}
              onChange={(event) =>
                onChange(
                  serializeJson({
                    ...document.value,
                    [key]: nextScalarValue(value, event.target.value),
                  }),
                )
              }
            />
          ),
      },
      {
        id: "actions",
        header: "",
        cellClassName: "structured-table-actions",
        cell: ([key], index) => (
          <Tooltip label={t("files.structured.removeProperty", { key })}>
            <ActionIcon
              aria-label={t("files.structured.removeProperty", { key })}
              color="red"
              disabled={readOnly}
              onClick={() =>
                onChange(
                  serializeJson(
                    Object.fromEntries(
                      entries.filter((_, itemIndex) => itemIndex !== index),
                    ),
                  ),
                )
              }
            >
              <Trash2 aria-hidden="true" size={14} />
            </ActionIcon>
          </Tooltip>
        ),
      },
    ];
    return (
      <Stack flex={1} gap={0} mih={0}>
        <Group justify="space-between" px="md" py="xs" wrap="nowrap">
          <Text c="dimmed" size="sm">
            {t("files.structured.objectDescription")}
          </Text>
          <Button
            disabled={readOnly}
            variant="secondary"
            onClick={() =>
              onChange(
                serializeJson({
                  ...document.value,
                  newKey: "",
                }),
              )
            }
          >
            <Plus aria-hidden="true" size={14} />
            {t("files.structured.addProperty")}
          </Button>
        </Group>
        <ScrollArea flex={1} mih={0}>
          <EditableTable
            caption={t("files.structured.propertiesDescription")}
            columns={columns}
            getRowKey={(_, index) => index}
            rows={entries}
          />
        </ScrollArea>
      </Stack>
    );
  }

  return (
    <Stack flex={1} gap={0} mih={0}>
      <Group justify="space-between" px="md" py="xs" wrap="nowrap">
        <Text c="dimmed" size="sm">
          {t("files.structured.valuesDescription")}
        </Text>
        <Button
          disabled={readOnly}
          variant="secondary"
          onClick={() => onChange(serializeJson([...document.value, ""]))}
        >
          <Plus aria-hidden="true" size={14} />
          {t("files.structured.addValue")}
        </Button>
      </Group>
      {document.value.length ? (
        <ScrollArea flex={1} mih={0}>
          <Stack gap="xs" px="md" pb="md">
            {document.value.map((value, index) => (
              <Group gap="xs" key={index} wrap="nowrap">
                {typeof value === "boolean" ? (
                  <Checkbox
                    aria-label={t("files.structured.valueRow", {
                      index: index + 1,
                    })}
                    checked={value}
                    disabled={readOnly}
                    onChange={(event) => {
                      const next = [...document.value];
                      next[index] = event.currentTarget.checked;
                      onChange(serializeJson(next));
                    }}
                  />
                ) : (
                  <TextInput
                    flex={1}
                    aria-label={t("files.structured.valueRow", {
                      index: index + 1,
                    })}
                    disabled={readOnly}
                    type={typeof value === "number" ? "number" : "text"}
                    value={valueForInput(value)}
                    onChange={(event) => {
                      const next = [...document.value];
                      next[index] = nextScalarValue(value, event.target.value);
                      onChange(serializeJson(next));
                    }}
                  />
                )}
                <Tooltip
                  label={t("files.structured.removeRow", {
                    index: index + 1,
                  })}
                >
                  <ActionIcon
                    aria-label={t("files.structured.removeRow", {
                      index: index + 1,
                    })}
                    color="red"
                    disabled={readOnly}
                    onClick={() =>
                      onChange(
                        serializeJson(
                          document.value.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        ),
                      )
                    }
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
          </Stack>
        </ScrollArea>
      ) : (
        <Text c="dimmed" px="md" py="sm" size="sm">
          {t("files.structured.emptyValues")}
        </Text>
      )}
    </Stack>
  );
}
