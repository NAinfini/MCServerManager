import { DataTable, type DataTableProps } from "./DataTable";

export type EditableTableProps<T> = DataTableProps<T>;

export function EditableTable<T>(props: EditableTableProps<T>) {
  return <DataTable {...props} />;
}
