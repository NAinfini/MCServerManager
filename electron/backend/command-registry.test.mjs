import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createCommandRegistry } = require("./command-registry.cjs");

describe("backend command registry", () => {
  it("distinguishes unsupported commands from supported undefined results", () => {
    const commands = createCommandRegistry({
      returns_undefined: () => undefined,
    });

    expect(commands.has("returns_undefined")).toBe(true);
    expect(commands.execute("returns_undefined")).toBeUndefined();
    expect(commands.has("missing")).toBe(false);
    expect(() => commands.execute("missing")).toThrow(
      /Unsupported Electron backend command/,
    );
  });
});
