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
        file={file("server.properties", "motd=old")}
        isLoading={false}
        isSaving={false}
        onSave={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Monaco editor"), {
      target: { value: "motd=draft" },
    });
    rerender(
      <FileEditor
        error={null}
        file={file("server.properties", "motd=remote")}
        isLoading={false}
        isSaving={false}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Monaco editor")).toHaveValue("motd=draft");
  });

  it("loads fresh content when switching files", () => {
    const { rerender } = render(
      <FileEditor
        error={null}
        file={file("server.properties", "motd=old")}
        isLoading={false}
        isSaving={false}
        onSave={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Monaco editor"), {
      target: { value: "motd=draft" },
    });
    rerender(
      <FileEditor
        error={null}
        file={file("ops.json", "[]")}
        isLoading={false}
        isSaving={false}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Monaco editor")).toHaveValue("[]");
  });
});

