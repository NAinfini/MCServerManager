import { describe, expect, it } from "vitest";
import { normalizeDesktopCommandError } from "./desktop-command-error";

describe("normalizeDesktopCommandError", () => {
  it("turns missing desktop runtime failures into user-facing guidance", () => {
    const error = normalizeDesktopCommandError(
      new Error("Electron desktop bridge is unavailable."),
    );

    expect(error.message).toContain("Desktop runtime is unavailable");
    expect(error.message).toContain("desktop app");
  });

  it("keeps backend validation messages intact", () => {
    const error = normalizeDesktopCommandError(
      "validation error: server.jar is missing",
    );

    expect(error.message).toBe("validation error: server.jar is missing");
  });

  it("explains stale Electron main process command failures", () => {
    const error = normalizeDesktopCommandError(
      "Unsupported Electron backend command: delete_tunnel_provider.",
    );

    expect(error.message).toContain("Desktop runtime is out of date");
    expect(error.message).toContain("Restart MC Server Manager");
  });
});
