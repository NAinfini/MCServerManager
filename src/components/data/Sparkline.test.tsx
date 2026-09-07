import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the complete numeric series as a compact chart", () => {
    render(<Sparkline label="TPS history" values={[20, 19, 18, 17]} />);

    expect(screen.getByRole("img", { name: "TPS history" })).toHaveClass(
      "sparkline",
    );
    expect(screen.getByRole("img").querySelector("polyline")).toHaveAttribute(
      "points",
      expect.stringContaining("100,"),
    );
  });

  it("draws a steady series against its ceiling instead of filling the box", () => {
    render(<Sparkline label="CPU history" max={100} values={[12, 12, 12]} />);

    // 12% of a 100% ceiling has to sit near the baseline. Scaled to its own
    // range the same run would be a full-height block.
    const points = screen
      .getByRole("img")
      .querySelector("polyline")
      ?.getAttribute("points")
      ?.split(" ")
      .map((point) => Number(point.split(",")[1]));
    expect(points).toEqual([26.76, 26.76, 26.76]);
  });

  it("names every sample for the pointer", () => {
    render(
      <Sparkline
        formatValue={(value) => `${value}%`}
        label="CPU history"
        values={[20, 40]}
      />,
    );

    expect(
      Array.from(screen.getByRole("img").querySelectorAll("title")).map(
        (title) => title.textContent,
      ),
    ).toEqual(["20%", "40%"]);
  });

  it("shows an accessible empty state without numeric samples", () => {
    render(<Sparkline label="CPU history" values={[null, undefined]} />);

    expect(screen.getByRole("img", { name: "CPU history" })).toHaveTextContent(
      "—",
    );
  });
});
