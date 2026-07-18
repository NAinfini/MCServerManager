import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AppSettingsProvider, useAppSettings } from "./index";

function Probe() {
  const { formatCompactNumber, language, setLanguage, setTheme, theme, t } =
    useAppSettings();

  return (
    <div>
      <span>{language}</span>
      <span>{theme}</span>
      <span data-testid="compact-number">{formatCompactNumber(12000)}</span>
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
    document.documentElement.style.removeProperty("color-scheme");
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
    expect(document.documentElement.style.colorScheme).toBe("dark");

    await userEvent.click(screen.getByRole("button", { name: /light/i }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");

    await userEvent.click(screen.getByRole("button", { name: /system/i }));
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toMatch(/^(light|dark)$/);
  });

  it("formats compact numbers with the active language", async () => {
    render(
      <AppSettingsProvider>
        <Probe />
      </AppSettingsProvider>,
    );

    expect(screen.getByTestId("compact-number")).toHaveTextContent("12K");

    await userEvent.click(screen.getByRole("button", { name: /chinese/i }));

    expect(screen.getByTestId("compact-number")).toHaveTextContent("1.2万");
  });
});
