import { expect, test } from "./support/fixtures";

test.describe("settings actions", () => {
  test("persists appearance and backup defaults", async ({
    appPage: page,
    fakeDesktop,
  }) => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("switch", { name: "Compact mode" }).click();

    await expect
      .poll(() =>
        fakeDesktop.calls.some(
          (call) =>
            call.command === "save_app_preferences" &&
            (call.args as any)?.input?.appearance?.compactMode === true,
        ),
      )
      .toBe(true);

    await page.getByRole("button", { name: "Defaults", exact: true }).click();
    const retention = page.getByRole("spinbutton", { name: "Retention days" });
    await retention.fill("30");
    await retention.press("Tab");
    await expect
      .poll(() => fakeDesktop.preferences.backupDefaults.retentionDays)
      .toBe(30);
  });

  test("exports settings through the fake dialog endpoint", async ({
    appPage: page,
    fakeDesktop,
  }) => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page
      .getByRole("button", { name: "Storage & logs", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Export settings", exact: true })
      .click();

    await expect
      .poll(() =>
        fakeDesktop.calls.some(
          (call) => call.command === "export_app_settings",
        ),
      )
      .toBe(true);
    await expect(page.getByText(/exported/i)).toBeVisible();
  });
});
