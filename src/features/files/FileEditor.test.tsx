import { cleanup, fireEvent, render, screen } from "../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileEditor } from "./FileEditor";
import type { ServerTextFile } from "./fileApi";

vi.mock("@monaco-editor/react", () => ({
  default: ({
    onChange,
    value,
  }: {
    onChange: (value: string) => void;
    value: string;
  }) => (
    <textarea
      aria-label="Monaco editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

function file(relativePath: string, content: string): ServerTextFile {
  return {
    relativePath,
    content,
    readOnly: false,
    sizeBytes: content.length,
    warning: null,
  };
}

describe("FileEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps an unsaved draft when the selected file refetches", () => {
    const { rerender } = render(
      <FileEditor
        error={null}
        file={file("notes.txt", "old")}
        isLoading={false}
        isSaving={false}
        onSave={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Monaco editor"), {
      target: { value: "draft" },
    });
    rerender(
      <FileEditor
        error={null}
        file={file("notes.txt", "remote")}
        isLoading={false}
        isSaving={false}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Monaco editor")).toHaveValue("draft");
  });

  it("loads fresh content when switching files", () => {
    const { rerender } = render(
      <FileEditor
        error={null}
        file={file("notes.txt", "old")}
        isLoading={false}
        isSaving={false}
        onSave={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Monaco editor"), {
      target: { value: "draft" },
    });
    rerender(
      <FileEditor
        error={null}
        file={file("other-notes.txt", "fresh")}
        isLoading={false}
        isSaving={false}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Monaco editor")).toHaveValue("fresh");
  });

  it("uses a key-value table for properties files", () => {
    const onSave = vi.fn();
    render(
      <FileEditor
        error={null}
        file={file(
          "server.properties",
          "# server settings\nmotd=Old server\nmax-players=20\n",
        )}
        isLoading={false}
        isSaving={false}
        onSave={onSave}
      />,
    );

    expect(screen.queryByLabelText("Monaco editor")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "motd value" }), {
      target: { value: "Friendly server" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      "# server settings\nmotd=Friendly server\nmax-players=20\n",
    );
  });

  it("uses an editable table for JSON object arrays", () => {
    const onSave = vi.fn();
    render(
      <FileEditor
        error={null}
        file={file("whitelist.json", '[{"uuid":"one","name":"Alex"}]\n')}
        isLoading={false}
        isSaving={false}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "name row 1" }), {
      target: { value: "Steve" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      `${JSON.stringify([{ uuid: "one", name: "Steve" }], null, 2)}\n`,
    );
  });
});

