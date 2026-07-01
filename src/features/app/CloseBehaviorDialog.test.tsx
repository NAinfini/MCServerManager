import { render, screen } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CloseBehaviorDialog } from "./CloseBehaviorDialog";

describe("CloseBehaviorDialog", () => {
  it("offers minimize to tray, quit app, and cancel actions", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onMinimizeToTray = vi.fn();
    const onQuit = vi.fn();

    render(
      <CloseBehaviorDialog
        isOpen
        runningServerCount={1}
        onCancel={onCancel}
        onMinimizeToTray={onMinimizeToTray}
        onQuit={onQuit}
      />,
    );

    await user.click(screen.getByRole("button", { name: /minimize to tray/i }));
    await user.click(screen.getByRole("button", { name: /quit app/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onMinimizeToTray).toHaveBeenCalledTimes(1);
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not report a fake running server count when runtime status is unavailable", () => {
    render(
      <CloseBehaviorDialog
        isOpen
        runningServerCount={null}
        onCancel={vi.fn()}
        onMinimizeToTray={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/server runtime status is not available yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 running servers/i)).not.toBeInTheDocument();
  });

  it("warns when running servers are present", () => {
    render(
      <CloseBehaviorDialog
        isOpen
        runningServerCount={2}
        onCancel={vi.fn()}
        onMinimizeToTray={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        /quitting while 2 servers are running stops supervision/i,
      ),
    ).toHaveAttribute("role", "alert");
  });

  it("renders operation failures visibly", () => {
    render(
      <CloseBehaviorDialog
        isOpen
        operationError="Failed to minimize to tray."
        runningServerCount={null}
        onCancel={vi.fn()}
        onMinimizeToTray={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    expect(screen.getByText("Failed to minimize to tray.")).toHaveAttribute(
      "role",
      "alert",
    );
  });

  it("renders nothing while closed", () => {
    const { container } = render(
      <CloseBehaviorDialog
        isOpen={false}
        runningServerCount={null}
        onCancel={vi.fn()}
        onMinimizeToTray={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

