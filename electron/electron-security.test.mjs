import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Electron window security", () => {
  it("keeps renderer Node access disabled and sandboxed", () => {
    const main = fs.readFileSync("electron/main.cjs", "utf8");

    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/sandbox:\s*true/);
  });
});
