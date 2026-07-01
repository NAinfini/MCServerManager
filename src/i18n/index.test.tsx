import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AppSettingsProvider, useAppSettings } from "./index";

function Probe() {
  const { language, setLanguage, setTheme, theme, t } = useAppSettings();

  return (
    <div>
      <span>{language}</span>
      <span>{theme}</span>
      <strong>{t("settings.language.title")}</strong>
      <em>{t("missing.key")}</em>
      <button type="button" onClick={() => setLanguage("zh-CN")}>
        Chinese
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        Dark
      </button>
      <button type="button" onClick={() => setTheme("light")}>
        Light
      </button>
      <button type="button" onClick={() => setTheme("system")}>
        System
      </button>
    </div>
  );
}

describe("i18n settings", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("loads English by default and visibly falls back for missing keys", () => {
    render(
      <AppSettingsProvider>
        <Probe />
      </AppSettingsProvider>,
    );

    expect(screen.getByText("en")).toBeInTheDocument();
    expect(screen.getByText("Language")).toBeInTheDocument();
    expect(screen.getByText("[[missing.key]]")).toBeInTheDocument();
  });

  it("loads Chinese language and supports system, light, and dark themes", async () => {
    render(
      <AppSettingsProvider>
        <Probe />
      </AppSettingsProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /chinese/i }));
    expect(screen.getByText("语言")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /dark/i }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await userEvent.click(screen.getByRole("button", { name: /light/i }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    await userEvent.click(screen.getByRole("button", { name: /system/i }));
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toMatch(/^(light|dark)$/);
  });
});
