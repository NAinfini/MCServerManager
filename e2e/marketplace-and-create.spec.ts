import { expect, test } from "./support/fixtures";

test.describe("marketplace and server creation", () => {
  test("searches server content and opens a project", async ({
    appPage: page,
  }) => {
    await page
      .getByRole("table", { name: "Server overview" })
      .getByRole("button", { name: "Fabric Workshop", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Fabric Workshop workspace" })
      .getByRole("button", { name: "Content", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Workspace views" })
      .getByRole("button", { name: "Browse", exact: true })
      .click();

    await page.getByRole("textbox", { name: "Search server packs" }).fill("fabric");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const result = page.getByRole("button", { name: /Fabric Essentials/ });
    await expect(result).toBeVisible();
    await result.click();

    await expect(
      page.getByRole("region", { name: "Marketplace project details" }),
    ).toContainText("Fabric Essentials");
    await expect(page.getByRole("button", { name: /1\.4\.0/ })).toBeVisible();
  });

  test("browses marketplace packs from the create workflow", async ({
    appPage: page,
  }) => {
    await page.getByRole("button", { name: "Create Server" }).click();
    await page.getByRole("button", { name: "Browse marketplace" }).click();

    const projects = page.getByRole("region", {
      name: "Marketplace search results",
    });
    await expect(
      projects.getByRole("button", { name: /Fabric Essentials/ }),
    ).toBeVisible();
    await projects
      .getByRole("button", { name: /Fabric Essentials/ })
      .click();

    const details = page.getByRole("region", {
      name: "Marketplace project details",
    });
    await expect(details).toContainText("Fabric Essentials");
    await expect(details.getByRole("button", { name: /1\.4\.0/ })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(projects).toBeVisible();
  });

  test("uses responsive layouts without document-level horizontal overflow", async ({
    appPage: page,
  }) => {
    for (const viewport of [
      { width: 720, height: 720 },
      { width: 880, height: 720 },
      { width: 1100, height: 800 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        )
        .toBe(0);
    }
  });
});
