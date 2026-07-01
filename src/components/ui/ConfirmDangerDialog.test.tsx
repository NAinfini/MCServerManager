import { cleanup, render, screen } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDangerDialog } from "./ConfirmDangerDialog";

describe("ConfirmDangerDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("runs the dangerous action only after explicit confirmation", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDangerDialog
        description="This will stop the selected server."
        confirmLabel="Stop server"
        isOpen
        title="Stop server?"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Stop server" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
