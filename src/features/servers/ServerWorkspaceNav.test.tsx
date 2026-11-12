import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "../../test/render";
import { ServerWorkspaceNav } from "./ServerWorkspaceNav";

function renderNav(extra?: React.ReactNode) {
  const onNavigate = vi.fn();
  render(
    <>
      <ServerWorkspaceNav
        serverName="Review Server"
        section="console"
        onNavigate={onNavigate}
      />
      {extra}
    </>,
  );
  return { onNavigate };
}

describe("ServerWorkspaceNav", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks only the active tab as the current page", () => {
    renderNav();

    const nav = screen.getByRole("navigation", {
      name: "Review Server workspace",
    });
    expect(
      within(nav)
        .getAllByRole("button")
        .filter((button) => button.hasAttribute("aria-current"))
        .map((button) => button.textContent),
    ).toEqual(["Console"]);
  });

  it("moves focus with left, right and boundary keys without navigating", async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderNav();
    const nav = screen.getByRole("navigation", {
      name: "Review Server workspace",
    });
    const tab = (name: string) => within(nav).getByRole("button", { name });

    tab("Console").focus();
    await user.keyboard("{ArrowRight}");
    expect(tab("Players")).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(tab("Settings")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tab("Console")).toHaveFocus();
    await user.keyboard("{End}");
    expect(tab("Settings")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(tab("Console")).toHaveFocus();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it.each([
    ["1", "console", "terminal"],
    ["2", "players", "online"],
    ["3", "content", "installed"],
    ["4", "backups", undefined],
    ["5", "files", undefined],
    ["6", "automation", undefined],
    ["7", "settings", "general"],
  ])("switches tab on key %s", async (key, section, view) => {
    const { onNavigate } = renderNav();

    await userEvent.keyboard(key);

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(section, view);
  });

  it.each(["0", "8", "9", "a", " ", "Enter"])(
    "ignores key %j, which maps to no tab",
    (key) => {
      const { onNavigate } = renderNav();

      fireEvent.keyDown(window, { key });

      expect(onNavigate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["ctrlKey", { ctrlKey: true }],
    ["altKey", { altKey: true }],
    ["metaKey", { metaKey: true }],
  ])("leaves %s shortcuts alone", (_name, modifier) => {
    const { onNavigate } = renderNav();

    fireEvent.keyDown(window, { key: "2", ...modifier });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("does not steal digits from anywhere the user is typing", async () => {
    const { onNavigate } = renderNav(
      <>
        <input aria-label="field" />
        <textarea aria-label="area" />
        <select aria-label="choice">
          <option>2</option>
        </select>
        <div aria-label="rich" contentEditable role="textbox" tabIndex={0} />
      </>,
    );

    for (const element of [
      screen.getByLabelText("field"),
      screen.getByLabelText("area"),
      screen.getByLabelText("choice"),
    ]) {
      element.focus();
      await userEvent.keyboard("2");
    }
    const rich = screen.getByLabelText("rich");
    /* jsdom does not implement isContentEditable, and the check depends on it. */
    Object.defineProperty(rich, "isContentEditable", { value: true });
    fireEvent.keyDown(rich, { key: "2" });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("field")).toHaveValue("2");
  });

  it.each(["dialog", "alertdialog"])(
    "does not switch tabs behind an open %s",
    async (role) => {
      const { onNavigate } = renderNav(
        <div role={role} aria-label="Modal">
          <button type="button">Inside</button>
        </div>,
      );

      screen.getByRole("button", { name: "Inside" }).focus();
      await userEvent.keyboard("2");

      expect(onNavigate).not.toHaveBeenCalled();
    },
  );

  it("stops listening once unmounted", () => {
    const { onNavigate } = renderNav();

    cleanup();
    fireEvent.keyDown(window, { key: "2" });

    expect(onNavigate).not.toHaveBeenCalled();
  });
});
