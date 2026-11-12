import {
  useMemo,
  useState,
  type ReactNode,
  type TableHTMLAttributes,
} from "react";
import { Group, Table, UnstyledButton } from "@mantine/core";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  headerClassName?: string;
  cellClassName?: string | ((row: T, index: number) => string | undefined);
  rowHeader?: boolean;
  sortValue?: (row: T) => number | string | null | undefined;
}

export interface DataTableProps<
  T,
> extends TableHTMLAttributes<HTMLTableElement> {
  columns: readonly DataTableColumn<T>[];
  caption: ReactNode;
  rows: readonly T[];
  getRowKey: (row: T, index: number) => string | number;
  getRowClassName?: (row: T, index: number) => string | undefined;
  onRowActivate?: (row: T, index: number) => void;
}

export function DataTable<T>({
  columns,
  caption,
  rows,
  getRowKey,
  getRowClassName,
  onRowActivate,
  ...tableProps
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{
    columnId: string;
    direction: "ascending" | "descending";
  } | null>(null);
  const visibleRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((candidate) => candidate.id === sort.columnId);
    if (!column?.sortValue) return rows;
    return [...rows].sort((left, right) => {
      const leftValue = column.sortValue?.(left);
      const rightValue = column.sortValue?.(right);
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue ?? "").localeCompare(
              String(rightValue ?? ""),
              undefined,
              {
                numeric: true,
                sensitivity: "base",
              },
            );
      return sort.direction === "ascending" ? comparison : -comparison;
    });
  }, [columns, rows, sort]);

  return (
    <Table highlightOnHover verticalSpacing="xs" {...tableProps}>
      <caption className="visually-hidden">{caption}</caption>
      <Table.Thead>
        <Table.Tr>
          {columns.map((column) => {
            const sorted = sort?.columnId === column.id ? sort.direction : null;
            const SortIcon =
              sorted === "ascending"
                ? ArrowUp
                : sorted === "descending"
                  ? ArrowDown
                  : ArrowUpDown;
            return (
              <Table.Th
                aria-sort={sorted ?? undefined}
                className={column.headerClassName}
                key={column.id}
                scope="col"
              >
                {column.sortValue ? (
                  <UnstyledButton
                    fw="inherit"
                    fz="inherit"
                    onClick={() =>
                      setSort((current) => ({
                        columnId: column.id,
                        direction:
                          current?.columnId === column.id &&
                          current.direction === "ascending"
                            ? "descending"
                            : "ascending",
                      }))
                    }
                  >
                    <Group gap={4} wrap="nowrap">
                      {column.header}
                      <SortIcon
                        aria-hidden="true"
                        opacity={sorted ? 1 : 0.4}
                        size={14}
                      />
                    </Group>
                  </UnstyledButton>
                ) : (
                  column.header
                )}
              </Table.Th>
            );
          })}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {visibleRows.map((row, index) => (
          <Table.Tr
            className={getRowClassName?.(row, index)}
            key={getRowKey(row, index)}
            style={onRowActivate ? { cursor: "pointer" } : undefined}
            tabIndex={onRowActivate ? 0 : undefined}
            onClick={
              onRowActivate ? () => onRowActivate(row, index) : undefined
            }
            onKeyDown={
              onRowActivate
                ? (event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRowActivate(row, index);
                    }
                  }
                : undefined
            }
          >
            {columns.map((column) => {
              const className =
                typeof column.cellClassName === "function"
                  ? column.cellClassName(row, index)
                  : column.cellClassName;
              const Cell = column.rowHeader ? Table.Th : Table.Td;
              return (
                <Cell
                  className={className}
                  key={column.id}
                  scope={column.rowHeader ? "row" : undefined}
                >
                  {column.cell(row, index)}
                </Cell>
              );
            })}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
