import { expect, test } from "./support/fixtures";

/* A real drag needs the OS; this dispatches the same DOM events the browser
   would, with a File whose path the fake bridge resolves. */
async function dropFile(
  page: import("@playwright/test").Page,
  name: string,
) {
  await page.evaluate((fileName) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], fileName));
    for (const type of ["dragenter", "dragover", "drop"]) {
      document.documentElement.dispatchEvent(
        new DragEvent(type, {
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  }, name);
}

test.describe("dropping a modpack", () => {
  test("recognises a pack anywhere in the window and asks for one confirmation", async ({
    appPage: page,
  }) => {
    await dropFile(page, "Dropped Pack.zip");

    const card = page.getByRole("dialog");
    await expect(card).toContainText("Recognised as a server pack");
    await expect(card).toContainText("Fabric 0.16.10");
    await expect(card).toContainText("1.21.1");
    await expect(
      card.getByRole("link", { name: /End User License Agreement/ }),
    ).toBeVisible();

    await card.getByRole("button", { name: "Agree and start" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("closes without creating anything when cancelled", async ({
    appPage: page,
  }) => {
    await dropFile(page, "Dropped Pack.zip");
    const card = page.getByRole("dialog");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
