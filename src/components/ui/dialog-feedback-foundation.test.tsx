import { cleanup, render, screen } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttentionBar } from "./attention-bar";
import { DialogSurface } from "./dialog-surface";
import { LoadingState } from "./loading-state";
import { PathField } from "./path-field";
import { StickyActionBar } from "./sticky-action-bar";

describe("dialog and feedback foundation", () => {
  afterEach(cleanup);

  it("keeps modal semantics and routes dismissals through the shared dialog surface", async () => {
    const onOpenChange = vi.fn();
    render(
      <DialogSurface
        description="Discard the current changes."
        footer={<button type="button">Keep editing</button>}
        open
        title="Discard changes?"
        onOpenChange={onOpenChange}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Discard changes?" }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders an accessible path field with a disabled browse action", () => {
    const onBrowse = vi.fn();
    render(
      <PathField
        aria-label="Server directory"
        browseLabel="Browse"
        disabled
        value="C:\\servers"
        onBrowse={onBrowse}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Server directory" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Browse" })).toBeDisabled();
  });

  it("provides sticky actions, severity-aware attention, and localized skeleton loading", () => {
    localStorage.setItem("mcsm.language", "zh-CN");
    const { container } = render(
      <>
        <StickyActionBar aria-label="Save actions">
          <button type="button">Save</button>
        </StickyActionBar>
        <AttentionBar tone="danger">Restart required</AttentionBar>
        <LoadingState variant="skeleton" />
      </>,
    );

    expect(screen.getByLabelText("Save actions")).toHaveClass(
      "sticky-action-bar",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Restart required");
    expect(screen.getByRole("status")).toHaveTextContent("正在加载…");
    expect(container.querySelector(".loading-skeleton")).toBeInTheDocument();
  });
});
