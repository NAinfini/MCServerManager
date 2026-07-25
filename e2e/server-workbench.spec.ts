import { expect, test } from "./support/fixtures";

async function openServer(page: import("@playwright/test").Page) {
  await page
    .getByRole("list", { name: "Server overview" })
    .getByRole("button", { name: "Fabric Workshop", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Fabric Workshop" }),
  ).toBeVisible();
}

test.describe("server workbench", () => {
  test("loads all server workspaces through the fake desktop API", async ({
    appPage: page,
  }) => {
    test.setTimeout(60_000);
    await openServer(page);
    const workspaces = [
      { section: "Overview", views: [] },
      { section: "Console", views: [] },
      {
        section: "Players",
        views: [
          "Online",
          "Operators",
          "Whitelist",
          "Bans",
        ],
      },
      {
        section: "Content",
        views: ["Installed", "Updates", "Browse"],
      },
      {
        section: "Files & backups",
        views: ["Backups", "Files"],
      },
      {
        section: "Operations",
        views: ["Performance", "Log files", "Events", "Diagnostics"],
      },
      { section: "Automation", views: [] },
      {
        section: "Server settings",
        views: [
          "General",
          "World properties",
          "Network & access",
          "Version upgrade",
          "Import & export",
        ],
      },
    ];
    const workspaceNav = page.getByRole("navigation", {
      name: "Fabric Workshop workspace",
    });

    for (const workspace of workspaces) {
      const sectionButton = workspaceNav.getByRole("button", {
        name: workspace.section,
        exact: true,
      });
      await sectionButton.click();
      await expect(sectionButton).toHaveAttribute("aria-current", "page");

      for (const viewName of workspace.views) {
        const viewNav = page.getByRole("navigation", {
          name: "Workspace views",
        });
        const viewButton = viewNav.getByRole("button", {
          name: viewName,
          exact: true,
        });
        await viewButton.click();
        await expect(viewButton).toHaveAttribute("aria-current", "page");
      }

      if (workspace.section === "Console") {
        await page.getByText("Tools", { exact: true }).click();
        await expect(
          page.getByRole("region", { name: "Gamerules" }),
        ).toBeVisible();
      }

      await expect(page.getByText("Could not load this panel")).toHaveCount(0);
    }
  });

  test("runs process and player actions", async ({
    appPage: page,
    fakeDesktop,
  }) => {
    await openServer(page);

    await page
      .getByRole("navigation", { name: "Fabric Workshop workspace" })
      .getByRole("button", { name: "Players", exact: true })
      .click();
    await expect(page.getByText("Alex", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Kick Steve" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Steve");
    await dialog.getByRole("button", { name: "Kick player" }).click();

    await expect
      .poll(() =>
        fakeDesktop.calls.some(
          (call) =>
            call.command === "apply_player_change" &&
            (call.args as any)?.input?.action === "kick",
        ),
      )
      .toBe(true);

    await page.getByRole("button", { name: "Stop Fabric Workshop" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Stop", exact: true })
      .click();
    await expect
      .poll(() =>
        fakeDesktop.calls.some((call) => call.command === "stop_server"),
      )
      .toBe(true);
  });

  test("edits a structured server file and persists it", async ({
    appPage: page,
    fakeDesktop,
  }) => {
    await openServer(page);
    await page
      .getByRole("navigation", { name: "Fabric Workshop workspace" })
      .getByRole("button", { name: "Files & backups" })
      .click();
    await page
      .getByRole("navigation", { name: "Workspace views" })
      .getByRole("button", { name: "Files", exact: true })
      .click();
    await page.getByRole("button", { name: /server\.properties/ }).click();

    const motd = page.getByRole("textbox", { name: "motd value" });
    await expect(motd).toHaveValue("Fabric Workshop");
    await motd.fill("E2E Workshop");
    await page.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(() => fakeDesktop.files["server.properties"])
      .toContain("motd=E2E Workshop");
  });

  test("creates and deletes a world backup", async ({
    appPage: page,
    fakeDesktop,
  }) => {
    await openServer(page);
    await page
      .getByRole("navigation", { name: "Fabric Workshop workspace" })
      .getByRole("button", { name: "Files & backups" })
      .click();
    await expect(page.getByText("world.zip")).toBeVisible();

    await page.getByRole("button", { name: "Backup Now" }).click();
    await expect.poll(() => fakeDesktop.backups.length).toBe(2);

    await page.getByRole("button", { name: "Delete backup" }).first().click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete backup" })
      .click();
    await expect.poll(() => fakeDesktop.backups.length).toBe(1);
  });

  test("keeps every workspace free of page-level overflow at all breakpoints", async ({
    appPage: page,
  }) => {
    test.setTimeout(60_000);
    await openServer(page);
    const workspaceNav = page.getByRole("navigation", {
      name: "Fabric Workshop workspace",
    });
    const sections = [
      "Overview",
      "Console",
      "Players",
      "Content",
      "Files & backups",
      "Operations",
      "Automation",
      "Server settings",
    ];

    for (const viewport of [
      { width: 720, height: 720 },
      { width: 880, height: 720 },
      { width: 1100, height: 800 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      for (const section of sections) {
        await workspaceNav
          .getByRole("button", { name: section, exact: true })
          .click();
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
    }
  });
});
