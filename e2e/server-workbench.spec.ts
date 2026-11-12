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

// The prompt glyph sits inside the label, and Playwright counts it in the name.
function commandInput(page: import("@playwright/test").Page) {
  return page.getByRole("textbox", { name: /Command$/ });
}

test.describe("server workbench", () => {
  test("uses the application font and keeps workspace tabs in the page", async ({
    appPage: page,
  }) => {
    await openServer(page);
    expect(
      await page.evaluate(() => getComputedStyle(document.body).fontFamily),
    ).toContain("Segoe UI");
    const nav = page
      .locator("main")
      .getByRole("navigation", { name: "Fabric Workshop workspace" });
    await expect(nav.getByRole("button")).toHaveCount(7);
    await expect(
      page
        .locator("aside.sidebar")
        .getByRole("navigation", { name: "Fabric Workshop workspace" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await nav.getByRole("button", { name: "Mods", exact: true }).click();
    await expect(page).toHaveURL(/servers\/server-1\/content/);
    await expect(
      nav.getByRole("button", { name: "Mods", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("switches tabs with the number keys, except while typing or in a dialog", async ({
    appPage: page,
    fakeDesktop,
  }) => {
    fakeDesktop.processStatus = "running";
    await openServer(page);
    await expect(page).toHaveURL(/servers\/server-1\/console/);

    await page.keyboard.press("4");
    await expect(page).toHaveURL(/servers\/server-1\/backups/);
    await page.keyboard.press("7");
    await expect(page).toHaveURL(/servers\/server-1\/settings\/general/);
    await page.keyboard.press("1");
    await expect(page).toHaveURL(/servers\/server-1\/console/);

    const command = commandInput(page);
    await command.fill("");
    await command.press("3");
    await expect(command).toHaveValue("3");
    await expect(page).toHaveURL(/servers\/server-1\/console/);
    await command.fill("");
    await command.blur();

    await page.getByRole("button", { name: "Stop Fabric Workshop" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm).toBeVisible();
    await page.keyboard.press("2");
    await expect(confirm).toBeVisible();
    await expect(page).toHaveURL(/servers\/server-1\/console/);
    await confirm.getByRole("button", { name: "Cancel" }).click();
  });

  test("loads all server workspaces through the fake desktop API", async ({
    appPage: page,
  }) => {
    test.setTimeout(60_000);
    await openServer(page);
    const workspaces = [
      { section: "Console", views: ["Live output", "Log files", "Health"] },
      {
        section: "Players",
        views: ["Online", "Operators", "Whitelist", "Bans"],
      },
      {
        section: "Mods",
        views: ["Installed", "Updates", "Browse"],
      },
      { section: "Backups", views: [] },
      { section: "Files", views: [] },
      { section: "Automation", views: [] },
      {
        section: "Settings",
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
        // The loop above finished on another view; the quick commands belong
        // to the live terminal.
        await page
          .getByRole("navigation", { name: "Workspace views" })
          .getByRole("button", { name: "Live output", exact: true })
          .click();
        // A quick command has to land in the input, not just be listed.
        await page.getByRole("button", { name: "Quick commands" }).click();
        await page.getByRole("menuitem", { name: "Set to day" }).click();
        await expect(
          commandInput(page),
        ).toHaveValue("time set day");
      }

      await expect(page.getByText("This panel could not load")).toHaveCount(0);
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
      .getByRole("dialog")
      .getByRole("button", { name: "Stop", exact: true })
      .click();
    await expect
      .poll(() =>
        fakeDesktop.calls.some((call) => call.command === "stop_server"),
      )
      .toBe(true);
  });

  test("explains a crash and disables the mod that caused it", async ({
    appPage: page,
    fakeDesktop,
  }) => {
    fakeDesktop.processStatus = "crashed";
    fakeDesktop.crashExplanation = {
      kind: "clientOnlyMod",
      deterministic: true,
      reportFile: "crash-reports/crash-1.txt",
      detail: "Attempted to load class net/minecraft/client/Minecraft",
      modFile: "oculus-mc1.20.1-1.8.0.jar",
      modName: "oculus",
    };
    await openServer(page);

    const banner = page.getByRole("alert").filter({ hasText: "oculus" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button").first().click();
    await expect
      .poll(() =>
        fakeDesktop.calls.find((call) => call.command === "disable_crashed_mod")
          ?.args?.input,
      )
      .toMatchObject({ modFile: "oculus-mc1.20.1-1.8.0.jar" });
    await expect
      .poll(() => fakeDesktop.calls.some((c) => c.command === "start_server"))
      .toBe(true);
  });

  test("shows only the lifecycle action a server can take next", async ({
    appPage: page,
    fakeDesktop,
  }) => {
    fakeDesktop.processStatus = "stopping";
    await openServer(page);

    const start = page.getByRole("button", {
      name: "Start Fabric Workshop",
      exact: true,
    });
    const stop = page.getByRole("button", {
      name: "Stop Fabric Workshop",
      exact: true,
    });
    const restart = page.getByRole("button", {
      name: "Restart Fabric Workshop",
      exact: true,
    });
    await page
      .getByRole("button", { name: "Force stop Fabric Workshop" })
      .click();
    await expect(start).toHaveCount(0);
    await expect(stop).toHaveCount(0);
    await expect(restart).toHaveCount(0);
    expect(
      fakeDesktop.calls.some((call) => call.command === "force_stop_server"),
    ).toBe(false);

    await page
      .getByRole("dialog", { name: "Force stop the server?" })
      .getByRole("button", { name: "Force stop", exact: true })
      .click();
    await expect
      .poll(() =>
        fakeDesktop.calls.some((call) => call.command === "force_stop_server"),
      )
      .toBe(true);

    await expect(start).toBeVisible();
    await expect(stop).toHaveCount(0);
    await expect(restart).toHaveCount(0);
  });

  test("edits a structured server file and persists it", async ({
    appPage: page,
    fakeDesktop,
  }) => {
    await openServer(page);
    await page
      .getByRole("navigation", { name: "Fabric Workshop workspace" })
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
      .getByRole("button", { name: "Backups", exact: true })
      .click();
    await expect(page.getByText("world.zip")).toBeVisible();

    await page.getByRole("button", { name: "Backup Now" }).click();
    await expect.poll(() => fakeDesktop.backups.length).toBe(2);

    await page.getByRole("button", { name: "Delete backup" }).first().click();
    await page
      .getByRole("dialog")
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
      .getByRole("dialog")
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
      .getByRole("button", { name: "Backups", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Restore backup", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Preview restore", exact: true })
      .click();
    const review = page.getByRole("dialog");
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
      "Console",
      "Players",
      "Mods",
      "Backups",
      "Files",
      "Automation",
      "Settings",
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
