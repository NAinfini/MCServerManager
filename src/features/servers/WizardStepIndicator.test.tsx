import userEvent from "@testing-library/user-event";
import { render, screen, within } from "../../test/render";
import { describe, expect, it, vi } from "vitest";
import { WizardStepIndicator } from "./WizardStepIndicator";

const steps = [
  { label: "Source" },
  { label: "Compatibility" },
  { label: "Java" },
  { label: "Configuration" },
];

describe("WizardStepIndicator", () => {
  it("uses an ordered list and buttons only for completed navigable steps", async () => {
    const onStepClick = vi.fn();

    render(
      <WizardStepIndicator
        currentStep={2}
        onStepClick={onStepClick}
        steps={steps}
      />,
    );

    const progress = screen.getByRole("navigation", {
      name: "Wizard progress",
    });
    const list = within(progress).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);

    const buttons = within(list).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => !button.hasAttribute("disabled"))).toBe(
      true,
    );
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Source",
      "Compatibility",
    ]);

    const activeStep = within(list)
      .getByText("Java")
      .closest(".wizard-step-item");
    expect(activeStep).toHaveAttribute("aria-current", "step");

    await userEvent.click(buttons[0]);
    expect(onStepClick).toHaveBeenCalledWith(0);
  });
});
