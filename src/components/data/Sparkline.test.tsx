import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
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

  it("shows an accessible empty state without numeric samples", () => {
    render(<Sparkline label="CPU history" values={[null, undefined]} />);

    expect(screen.getByRole("img", { name: "CPU history" })).toHaveTextContent(
      "—",
    );
  });
});
