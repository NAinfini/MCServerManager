import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { LoaderSelect } from "./LoaderSelect";

describe("LoaderSelect", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows supported loaders as selectable", () => {
    render(<LoaderSelect />);

    expect(screen.getByRole("combobox", { name: "Loader" })).toHaveTextContent(
      "Paper",
    );
  });

  it("renders loader options when opened", async () => {
    render(<LoaderSelect />);

    await userEvent.click(screen.getByRole("combobox", { name: "Loader" }));

    expect(screen.getByRole("option", { name: "Vanilla" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Paper" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Forge" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "NeoForge" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Fabric" })).toBeEnabled();
  });
});

