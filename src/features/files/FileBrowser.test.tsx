import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileBrowser } from "./FileBrowser";

describe("FileBrowser", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a retryable error instead of an empty-directory state", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <FileBrowser
        entries={[]}
        error={new Error("folder unavailable")}
        isLoading={false}
        selectedPath={null}
        onOpenDirectory={vi.fn()}
        onOpenFile={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByRole("alert", { name: /could not load folder/i }),
    ).toHaveTextContent("folder unavailable");
    expect(screen.queryByText("Empty directory")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
