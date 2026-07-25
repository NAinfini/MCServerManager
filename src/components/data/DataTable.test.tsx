import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "./DataTable";
import { EditableTable } from "./EditableTable";

describe("DataTable", () => {
  it("renders column definitions and row headers", () => {
    render(<DataTable caption="Examples" className="example" columns={[{ id: "name", header: "Name", rowHeader: true, sortValue: ({ name }) => name, cell: ({ name }) => name }]} getRowKey={({ id }) => id} rows={[{ id: "one", name: "One" }]} />);
    expect(screen.getByRole("table")).toHaveClass("example");
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "One" })).toBeInTheDocument();
  });

  it("supports editable table variant", () => {
    render(<EditableTable caption="Editable examples" columns={[{ id: "value", header: "Value", cell: ({ value }) => value }]} getRowKey={(_, index) => index} rows={[{ value: "A" }]} />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("sorts accessibly and activates rows from the keyboard", async () => {
    const onRowActivate = vi.fn();
    render(
      <DataTable
        caption="Servers"
        columns={[
          {
            id: "name",
            header: "Name",
            sortValue: ({ name }) => name,
            cell: ({ name }) => name,
          },
        ]}
        getRowKey={({ id }) => id}
        onRowActivate={onRowActivate}
        rows={[
          { id: "b", name: "Beta" },
          { id: "a", name: "Alpha" },
        ]}
      />,
    );

    const table = screen.getByRole("table", { name: "Servers" });
    await userEvent.click(within(table).getByRole("button", { name: /name/i }));
    expect(within(table).getByRole("columnheader", { name: /name/i })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    const firstDataRow = within(table).getAllByRole("row")[1];
    expect(firstDataRow).toHaveTextContent("Alpha");
    firstDataRow.focus();
    await userEvent.keyboard("{Enter}");
    expect(onRowActivate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" }),
      0,
    );
  });
});
