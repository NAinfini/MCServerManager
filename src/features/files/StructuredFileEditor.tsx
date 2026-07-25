import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { TextField } from "../../components/ui/text-field";
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
          <TextField
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
          <TextField
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
          <Button
            aria-label={t("files.structured.removeProperty", { key: row.key })}
            className="icon-button"
            disabled={readOnly}
            title={t("files.structured.removeProperty", { key: row.key })}
            variant="ghost"
            onClick={() => onChange(removeLine(content, row.lineIndex))}
          >
            <Trash2 aria-hidden="true" size={15} />
          </Button>
        ),
      },
    ];
    return (
      <div className="structured-file-editor">
        <div className="structured-editor-toolbar">
          <span>{t("files.structured.propertiesDescription")}</span>
          <Button
            disabled={readOnly}
            variant="secondary"
            onClick={() => onChange(appendProperty(content))}
          >
            <Plus aria-hidden="true" size={15} />
            {t("files.structured.addProperty")}
          </Button>
        </div>
        {document.rows.length ? (
          <div className="structured-table-scroll">
            <EditableTable
              caption={t("files.structured.propertiesDescription")}
              className="structured-table structured-properties-table"
              columns={columns}
              getRowKey={(row) => row.lineIndex}
              rows={document.rows}
            />
          </div>
        ) : (
          <p className="structured-editor-empty">
            {t("files.structured.emptyProperties")}
          </p>
        )}
      </div>
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
                onCheckedChange={(checked) => {
                  const next = document.value.map((entry, entryIndex) =>
                    entryIndex === rowIndex
                      ? { ...entry, [column]: checked === true }
                      : entry,
                  );
                  onChange(serializeJson(next));
                }}
              />
            );
          }
          return (
            <TextField
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
          <Button
            aria-label={t("files.structured.removeRow", {
              index: rowIndex + 1,
            })}
            className="icon-button"
            disabled={readOnly}
            title={t("files.structured.removeRow", {
              index: rowIndex + 1,
            })}
            variant="ghost"
            onClick={() =>
              onChange(
                serializeJson(
                  document.value.filter((_, index) => index !== rowIndex),
                ),
              )
            }
          >
            <Trash2 aria-hidden="true" size={15} />
          </Button>
        ),
      },
    ];
    return (
      <div className="structured-file-editor">
        <div className="structured-editor-toolbar">
          <span>{t("files.structured.recordsDescription")}</span>
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
            <Plus aria-hidden="true" size={15} />
            {t("files.structured.addRecord")}
          </Button>
        </div>
        {document.value.length ? (
          <div className="structured-table-scroll">
            <EditableTable
              caption={t("files.structured.recordsDescription")}
              className="structured-table structured-json-table"
              columns={columns}
              getRowKey={(_, index) => index}
              rows={document.value}
            />
          </div>
        ) : (
          <p className="structured-editor-empty">
            {t("files.structured.emptyRecords")}
          </p>
        )}
      </div>
    );
  }

  if (document.kind === "json-object") {
    const entries = Object.entries(document.value);
    const columns: EditableTableProps<[string, JsonScalar]>["columns"] = [
      {
        id: "key",
        header: t("files.structured.key"),
        cell: ([key, value], index) => (
          <TextField
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
              onCheckedChange={(checked) =>
                onChange(
                  serializeJson({
                    ...document.value,
                    [key]: checked === true,
                  }),
                )
              }
            />
          ) : (
            <TextField
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
          <Button
            aria-label={t("files.structured.removeProperty", { key })}
            className="icon-button"
            disabled={readOnly}
            title={t("files.structured.removeProperty", { key })}
            variant="ghost"
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
            <Trash2 aria-hidden="true" size={15} />
          </Button>
        ),
      },
    ];
    return (
      <div className="structured-file-editor">
        <div className="structured-editor-toolbar">
          <span>{t("files.structured.objectDescription")}</span>
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
            <Plus aria-hidden="true" size={15} />
            {t("files.structured.addProperty")}
          </Button>
        </div>
        <div className="structured-table-scroll">
          <EditableTable
            caption={t("files.structured.propertiesDescription")}
            className="structured-table structured-properties-table"
            columns={columns}
            getRowKey={(_, index) => index}
            rows={entries}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="structured-file-editor">
      <div className="structured-editor-toolbar">
        <span>{t("files.structured.valuesDescription")}</span>
        <Button
          disabled={readOnly}
          variant="secondary"
          onClick={() => onChange(serializeJson([...document.value, ""]))}
        >
          <Plus aria-hidden="true" size={15} />
          {t("files.structured.addValue")}
        </Button>
      </div>
      {document.value.length ? (
        <div className="structured-value-list">
          {document.value.map((value, index) => (
            <div className="structured-value-row" key={index}>
              {typeof value === "boolean" ? (
                <Checkbox
                  aria-label={t("files.structured.valueRow", {
                    index: index + 1,
                  })}
                  checked={value}
                  disabled={readOnly}
                  onCheckedChange={(checked) => {
                    const next = [...document.value];
                    next[index] = checked === true;
                    onChange(serializeJson(next));
                  }}
                />
              ) : (
                <TextField
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
              <Button
                aria-label={t("files.structured.removeRow", {
                  index: index + 1,
                })}
                className="icon-button"
                disabled={readOnly}
                variant="ghost"
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
                <Trash2 aria-hidden="true" size={15} />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="structured-editor-empty">
          {t("files.structured.emptyValues")}
        </p>
      )}
    </div>
  );
}
