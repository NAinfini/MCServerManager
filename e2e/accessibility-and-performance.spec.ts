import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/fixtures";

async function expectNoCriticalAxeViolations(
  page: import("@playwright/test").Page,
) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations.filter((violation) => violation.impact === "critical"),
  ).toEqual([]);
}

test.describe("accessibility and idle performance", () => {
  test("has no critical accessibility violations on primary surfaces", async ({
    appPage: page,
  }) => {
    test.setTimeout(60_000);
    await expectNoCriticalAxeViolations(page);

    await page
      .getByRole("table", { name: "Server overview" })
      .getByRole("button", { name: "Fabric Workshop", exact: true })
      .click();
    await expectNoCriticalAxeViolations(page);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expectNoCriticalAxeViolations(page);

    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.getByRole("button", { name: "Create Server" }).click();
    await expectNoCriticalAxeViolations(page);
  });

  test("supports a complete keyboard route through the workbench and settings", async ({
    appPage: page,
  }) => {
    const firstRow = page
      .getByRole("table", { name: "Server overview" })
      .getByRole("row")
      .nth(1);
    await firstRow.focus();
    await firstRow.press("Enter");
    await expect(page).toHaveURL(/#\/servers\/server-1\/overview/);

    const workspaceNav = page.getByRole("navigation", {
      name: "Fabric Workshop workspace",
    });
    const players = workspaceNav.getByRole("button", {
      name: "Players",
      exact: true,
    });
    await players.focus();
    await players.press("Enter");
    await expect(page).toHaveURL(
      /#\/servers\/server-1\/players\?view=online/,
    );

    const whitelist = page
      .getByRole("navigation", { name: "Workspace views" })
      .getByRole("button", { name: "Whitelist", exact: true });
    await whitelist.focus();
    await whitelist.press("Enter");
    await expect(page).toHaveURL(
      /#\/servers\/server-1\/players\?view=whitelist/,
    );

    const serverSettings = workspaceNav.getByRole("button", {
      name: "Server settings",
      exact: true,
    });
    await serverSettings.focus();
    await serverSettings.press("Enter");
    const worldProperties = page
      .getByRole("navigation", { name: "Workspace views" })
      .getByRole("button", { name: "World properties", exact: true });
    await worldProperties.focus();
    await worldProperties.press("Enter");
    await expect(page).toHaveURL(
      /#\/servers\/server-1\/settings\/properties/,
    );

    const dashboard = page.getByRole("button", {
      name: "Dashboard",
      exact: true,
    });
    await dashboard.focus();
    await dashboard.press("Enter");
    const appSettings = page.getByRole("button", {
      name: "Settings",
      exact: true,
    });
    await appSettings.focus();
    await appSettings.press("Enter");

    const general = page.getByRole("button", { name: "General", exact: true });
    await general.focus();
    await general.press("ArrowDown");
    await expect(page.getByRole("button", { name: "Appearance" })).toBeFocused();
  });

  test("keeps dashboard idle IPC at the two-second summary budget", async ({
    appPage: page,
    fakeDesktop,
  }) => {
    fakeDesktop.calls.length = 0;
    await page.waitForTimeout(2_100);
    const pollingCalls = fakeDesktop.calls.filter((call) =>
      ["get_process_summary", "get_server_process_status"].includes(call.command),
    );
    expect(pollingCalls.length).toBeLessThanOrEqual(2);
    expect(
      pollingCalls.filter((call) => call.command === "get_server_process_status"),
    ).toHaveLength(0);
  });
});
