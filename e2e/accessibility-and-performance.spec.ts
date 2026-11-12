import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/fixtures";

async function expectNoSeriousAxeViolations(
  page: import("@playwright/test").Page,
) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    ),
  ).toEqual([]);
}

test.describe("accessibility and idle performance", () => {
  test("has no serious accessibility violations on primary surfaces", async ({
    appPage: page,
  }) => {
    test.setTimeout(60_000);
    await expectNoSeriousAxeViolations(page);

    await page
      .getByRole("list", { name: "Server overview" })
      .getByRole("button", { name: "Fabric Workshop", exact: true })
      .click();
    await expectNoSeriousAxeViolations(page);

    // The workspace has a Settings tab too, so name the application one.
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await expectNoSeriousAxeViolations(page);

    await page.getByRole("button", { name: "Servers", exact: true }).click();
    await page.getByRole("button", { name: "Create Server" }).click();
    await expectNoSeriousAxeViolations(page);
  });

  test("supports a complete keyboard route through the workbench and settings", async ({
    appPage: page,
  }) => {
    const firstCard = page
      .getByRole("list", { name: "Server overview" })
      .getByRole("button", { name: "Fabric Workshop", exact: true });
    await firstCard.focus();
    await firstCard.press("Enter");
    await expect(page).toHaveURL(/#\/servers\/server-1\/console/);

    const workspaceNav = page.getByRole("navigation", {
      name: "Fabric Workshop workspace",
    });
    const players = workspaceNav.getByRole("button", {
      name: "Players",
      exact: true,
    });
    await players.focus();
    await players.press("Enter");
    await expect(page).toHaveURL(/#\/servers\/server-1\/players\?view=online/);

    const whitelist = page
      .getByRole("navigation", { name: "Workspace views" })
      .getByRole("button", { name: "Whitelist", exact: true });
    await whitelist.focus();
    await whitelist.press("Enter");
    await expect(page).toHaveURL(
      /#\/servers\/server-1\/players\?view=whitelist/,
    );

    const serverSettings = workspaceNav.getByRole("button", {
      name: "Settings",
      exact: true,
    });
    await serverSettings.focus();
    await serverSettings.press("Enter");
    const worldProperties = page
      .getByRole("navigation", { name: "Workspace views" })
      .getByRole("button", { name: "World properties", exact: true });
    await worldProperties.focus();
    await worldProperties.press("Enter");
    await expect(page).toHaveURL(/#\/servers\/server-1\/settings\/properties/);

    const servers = page.getByRole("button", {
      name: "Servers",
      exact: true,
    });
    await servers.focus();
    await servers.press("Enter");
    await expect(page).toHaveURL(/#\/dashboard/);
    const appSettings = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", {
        name: "Settings",
        exact: true,
      });
    await appSettings.focus();
    await appSettings.press("Enter");

    const general = page.getByRole("button", { name: "General", exact: true });
    await general.focus();
    await general.press("ArrowDown");
    await expect(
      page.getByRole("button", { name: "Appearance" }),
    ).toBeFocused();
  });

  test("moves between workspace tabs with the arrow keys", async ({
    appPage: page,
  }) => {
    await page.goto("/#/servers/server-1/console");
    const workspaceNav = page.getByRole("navigation", {
      name: "Fabric Workshop workspace",
    });
    const tab = (name: string) =>
      workspaceNav.getByRole("button", { name, exact: true });

    await tab("Console").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab("Players")).toBeFocused();
    await page.keyboard.press("End");
    await expect(tab("Settings")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tab("Console")).toBeFocused();
    await expect(page).toHaveURL(/#\/servers\/server-1\/console/);
  });

  test("keeps dashboard idle IPC at the two-second summary budget", async ({
    appPage: page,
    fakeDesktop,
  }) => {
    fakeDesktop.calls.length = 0;
    await page.waitForTimeout(2_100);
    const pollingCalls = fakeDesktop.calls.filter((call) =>
      ["get_process_summary", "get_server_process_status"].includes(
        call.command,
      ),
    );
    expect(pollingCalls.length).toBeLessThanOrEqual(2);
    expect(
      pollingCalls.filter(
        (call) => call.command === "get_server_process_status",
      ),
    ).toHaveLength(0);
  });
});
