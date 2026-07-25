import { expect, test as base, type Page } from "@playwright/test";
import {
  createFakeDesktopState,
  handleFakeDesktopCommand,
  type FakeDesktopState,
} from "./fakeDesktopBackend";

type Fixtures = {
  fakeDesktop: FakeDesktopState;
  appPage: Page;
};

export const test = base.extend<Fixtures>({
  fakeDesktop: async ({}, use) => {
    await use(createFakeDesktopState());
  },
  appPage: async ({ page, fakeDesktop }, use) => {
    await page.route("**/__e2e__/command", async (route) => {
      const request = route.request();
      const body = request.postDataJSON() as {
        command: string;
        args?: Record<string, unknown>;
      };
      try {
        const result = await handleFakeDesktopCommand(
          fakeDesktop,
          body.command,
          body.args,
        );
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ result }),
        });
      } catch (error) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        });
      }
    });

    await page.addInitScript(() => {
      const invoke = async <T>(
        command: string,
        args?: Record<string, unknown>,
      ): Promise<T> => {
        const response = await fetch("/__e2e__/command", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command, args }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error);
        }
        return payload.result as T;
      };

      window.mcServerManager = {
        invoke,
        openExternalUrl: async (url) => {
          await invoke("write_app_log", {
            input: { level: "info", source: "e2e", message: url },
          });
        },
        windowAction: async () => undefined,
        onCloseBehaviorRequested: () => () => undefined,
      };
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Servers" })).toBeVisible();
    await use(page);
  },
});

export { expect };
