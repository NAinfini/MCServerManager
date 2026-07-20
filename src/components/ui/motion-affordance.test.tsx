import { fireEvent, render, screen, within } from "../../test/render";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Select } from "./select";
import { Switch } from "./switch";

describe("motion affordance classes", () => {
  it("marks buttons with shared press motion classes", () => {
    render(<Button>Save changes</Button>);

    expect(screen.getByRole("button", { name: "Save changes" })).toHaveClass(
      "motion-control",
      "motion-press",
    );
  });

  it("marks danger buttons with shake feedback class", () => {
    render(<Button variant="danger">Delete server</Button>);

    expect(screen.getByRole("button", { name: "Delete server" })).toHaveClass(
      "motion-danger",
    );
  });

  it("marks select triggers and popovers with motion classes", () => {
    render(
      <Select
        ariaLabel="Loader"
        onValueChange={vi.fn()}
        options={[{ label: "Paper", value: "paper" }]}
        value="paper"
      />,
    );

    expect(screen.getByRole("combobox", { name: "Loader" })).toHaveClass(
      "motion-control",
      "motion-press",
    );
  });

  it("marks checkbox and switch controls with state motion classes", () => {
    render(
      <>
        <Checkbox aria-label="Enable whitelist" />
        <Switch aria-label="Auto restart" />
      </>,
    );

    expect(screen.getByRole("checkbox", { name: "Enable whitelist" })).toHaveClass(
      "motion-check",
    );
    expect(screen.getByRole("switch", { name: "Auto restart" })).toHaveClass(
      "motion-toggle",
    );
  });

  it("distinguishes pointer focus from keyboard focus on switches", () => {
    const { container } = render(<Switch aria-label="Auto restart" />);
    const control = within(container).getByRole("switch", {
      name: "Auto restart",
    });

    fireEvent.pointerDown(control);
    expect(control).toHaveAttribute("data-pointer-focus", "true");

    fireEvent.keyDown(control, { key: "Tab" });
    expect(control).not.toHaveAttribute("data-pointer-focus");

    fireEvent.pointerDown(control);
    fireEvent.blur(control);
    expect(control).not.toHaveAttribute("data-pointer-focus");
  });
});
