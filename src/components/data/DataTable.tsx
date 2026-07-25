import {
  useMemo,
  useState,
  type ReactNode,
  type TableHTMLAttributes,
} from "react";

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
    <table {...tableProps}>
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              aria-sort={
                sort?.columnId === column.id ? sort.direction : undefined
              }
              className={column.headerClassName}
              key={column.id}
              scope="col"
            >
              {column.sortValue ? (
                <button
                  className="data-table-sort"
                  type="button"
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
                  {column.header}
                  <span aria-hidden="true">
                    {sort?.columnId === column.id
                      ? sort.direction === "ascending"
                        ? " ↑"
                        : " ↓"
                      : " ↕"}
                  </span>
                </button>
              ) : (
                column.header
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {visibleRows.map((row, index) => (
          <tr
            className={getRowClassName?.(row, index)}
            key={getRowKey(row, index)}
            tabIndex={onRowActivate ? 0 : undefined}
            onKeyDown={
              onRowActivate
                ? (event) => {
                    if (
                      event.key === "Enter" &&
                      event.target === event.currentTarget
                    ) {
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
              const Cell = column.rowHeader ? "th" : "td";
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}
