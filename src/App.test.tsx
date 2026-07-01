import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./components/layout/AppShell", () => ({
  AppShell: () => {
    throw new Error("shell render failed");
  },
}));

vi.mock("./lib/desktop-runtime", () => ({
  invokeDesktopCommand: vi.fn(async () => ({
    runningCount: 0,
    crashedCount: 0,
  })),
  isDesktopRuntimeAvailable: vi.fn(() => false),
  onDesktopCloseRequested: vi.fn(),
  runDesktopWindowAction: vi.fn(),
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a visible failure state instead of a white screen", async () => {
    render(<App />);

    expect(screen.getByRole("alert")).toHaveTextContent("shell render failed");
    expect(
      screen.getByRole("heading", {
        name: "MC Server Manager could not render this view",
      }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByText("shell render failed")).toBeInTheDocument();
  });
});
