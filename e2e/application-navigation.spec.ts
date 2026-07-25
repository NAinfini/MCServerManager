import { expect, test } from "./support/fixtures";

test.describe("application navigation", () => {
  test("opens every global application surface", async ({ appPage: page }) => {
    await expect(page.getByTestId("server-nav-row-server-1")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Server overview" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Java Runtimes" }).click();
    await expect(
      page.getByRole("heading", { name: "Java Runtimes" }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Eclipse Temurin", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Logger" }).click();
    await expect(
      page.getByRole("heading", { name: "Application Logger" }),
    ).toBeVisible();
    await expect(page.getByText("Application started")).toBeVisible();

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("renders every settings section without a page error", async ({
    appPage: page,
  }) => {
    await page.getByRole("button", { name: "Settings" }).click();

    const sections = [
      ["General", "General"],
      ["Appearance", "Theme"],
      ["Defaults", "Server Defaults"],
      ["Marketplace & sources", "Marketplace and Content"],
      ["Notifications", "Notifications"],
      ["Storage & logs", "Paths"],
      ["Updates", "Application updates"],
      ["About", "About MC Server Manager"],
    ] as const;

    for (const [buttonName, headingName] of sections) {
      await page.getByRole("button", { name: buttonName, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: headingName, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
    }
  });

  test("keeps a creation draft until discard is confirmed", async ({
    appPage: page,
  }) => {
    await page.getByRole("button", { name: "Create Server" }).click();
    await expect(
      page.getByRole("heading", { name: "Create server" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Logger" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Discard server creation?",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("heading", { name: "Create server" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Logger" }).click();
    await page
      .getByRole("alertdialog", { name: "Discard server creation?" })
      .getByRole("button", { name: "Discard creation" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Application Logger" }),
    ).toBeVisible();
  });

  test("normalizes an unrecoverable creation-step deep link", async ({
    appPage: page,
  }) => {
    await page.goto("/#/servers/new?step=1");

    await expect(
      page.getByRole("heading", { name: "Create server" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/servers\/new\?step=0$/);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("walks the primary shell in English and Simplified Chinese", async ({
    appPage: page,
  }) => {
    await page.evaluate(() => localStorage.setItem("mcsm.language", "zh-CN"));
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "服务器" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();

    await page.evaluate(() => localStorage.setItem("mcsm.language", "en"));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Servers" })).toBeVisible();
  });
});
