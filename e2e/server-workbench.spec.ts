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
  test("uses the application font and keeps workspace navigation in the sidebar", async ({
    appPage: page,
  }) => {
    await openServer(page);
    expect(
      await page.evaluate(() => getComputedStyle(document.body).fontFamily),
    ).toContain("Segoe UI");
    const sidebar = page.locator("aside.sidebar");
    const nav = sidebar.getByRole("navigation", {
      name: "Fabric Workshop workspace",
    });
    await expect(nav.getByRole("button")).toHaveCount(7);
    await expect(
      page
        .locator("main")
        .getByRole("navigation", { name: "Fabric Workshop workspace" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await nav.getByRole("button", { name: "Content", exact: true }).click();
    await expect(page).toHaveURL(/servers\/server-1\/content/);
    await expect(
      nav.getByRole("button", { name: "Content", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("loads all server workspaces through the fake desktop API", async ({
    appPage: page,
  }) => {
    test.setTimeout(60_000);
    await openServer(page);
    const workspaces = [
      { section: "Overview", views: [] },
      { section: "Console", views: ["Live output", "Log files"] },
      {
        section: "Players",
        views: ["Online", "Operators", "Whitelist", "Bans"],
      },
      {
        section: "Content",
        views: ["Installed", "Updates", "Browse"],
      },
      {
        section: "Files & backups",
        views: ["Backups", "Files"],
      },
      { section: "Automation", views: [] },
      {
        section: "Server settings",
        views: ["General", "World properties", "Network & access"],
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
        // The loop above finished on the log files view; the quick commands
        // belong to the live terminal.
        await page
          .getByRole("navigation", { name: "Workspace views" })
          .getByRole("button", { name: "Live output", exact: true })
          .click();
        // A quick command has to land in the input, not just be listed.
        await page.getByRole("combobox", { name: "World" }).click();
        await page.getByRole("option", { name: "Set to day" }).click();
        await expect(page.getByLabel("Command", { exact: true })).toHaveValue(
          "time set day",
        );
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
    await page
      .getByRole("button", { name: "server.properties", exact: true })
      .click();

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

  test("creates, renames and confirms deletion of a server file", async ({
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
    await page.getByRole("button", { name: "New file", exact: true }).click();
    await page
      .getByRole("textbox", { name: "File name", exact: true })
      .fill("notes.txt");
    await page
      .locator(".files-operation-bar")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "notes.txt", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Rename notes.txt", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "New name", exact: true })
      .fill("readme.txt");
    await page
      .locator(".files-operation-bar")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "readme.txt", exact: true }),
    ).toBeVisible();
    expect(fakeDesktop.files).not.toHaveProperty(["notes.txt"]);
    await page
      .getByRole("button", { name: "Delete readme.txt", exact: true })
      .click();
    expect(fakeDesktop.files).toHaveProperty(["readme.txt"]);
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "readme.txt", exact: true }),
    ).toHaveCount(0);
    expect(fakeDesktop.files).not.toHaveProperty(["readme.txt"]);
  });

  test("previews backup contents before confirming a restore", async ({
    appPage: page,
    fakeDesktop,
  }) => {
    fakeDesktop.processStatus = "stopped";
    await openServer(page);
    await page
      .getByRole("navigation", { name: "Fabric Workshop workspace" })
      .getByRole("button", { name: "Files & backups" })
      .click();
    await page
      .getByRole("button", { name: "Restore backup", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Preview restore", exact: true })
      .click();
    const review = page.getByRole("alertdialog");
    await expect(review).toContainText("world/level.dat");
    expect(
      fakeDesktop.calls.some((call) => call.command === "restore_world_backup"),
    ).toBe(false);
    await review
      .getByRole("button", { name: "Restore backup", exact: true })
      .click();
    await expect
      .poll(() =>
        fakeDesktop.calls.some(
          (call) =>
            call.command === "restore_world_backup" &&
            (call.args as any)?.input?.confirm === true,
        ),
      )
      .toBe(true);
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
