import { afterEach, describe, expect, it } from "vitest";
import { normalizeDesktopCommandError } from "./desktop-command-error";

describe("normalizeDesktopCommandError", () => {
  afterEach(() => {
    localStorage.clear();
  });

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

  it("translates coded backend errors instead of showing raw English", () => {
    localStorage.setItem("mcsm.language", "zh-CN");

    const error = normalizeDesktopCommandError(
      new Error(
        "[MCSM:SERVER_MUST_BE_STOPPED] Stop the server before restoring a world backup.",
      ),
    );

    expect(error.message).toBe("请先停止服务器，再还原世界备份。");
  });

  it("translates required-field codes the backend derives from the message", () => {
    localStorage.setItem("mcsm.language", "zh-CN");

    // trimRequired turns "server name is required" into SERVER_NAME_REQUIRED
    // rather than passing a code literal, so this is the one path where the
    // backend and the locale file could drift apart without either side saying so.
    const error = normalizeDesktopCommandError(
      new Error("[MCSM:SERVER_NAME_REQUIRED] server name is required"),
    );

    expect(error.message).toBe("服务器需要填写名称。");
  });

  it("keeps the backend's own detail inside the translated message", () => {
    const error = normalizeDesktopCommandError(
      new Error("[MCSM:SERVER_PORT_IN_USE] Port 25565 is already in use."),
    );

    expect(error.message).toContain("That port is already in use");
    expect(error.message).toContain("Port 25565 is already in use.");
  });

  it("falls back to the backend message when a code has no translation", () => {
    const error = normalizeDesktopCommandError(
      new Error("[MCSM:NOT_A_REAL_CODE] Something specific went wrong."),
    );

    expect(error.message).toBe("Something specific went wrong.");
  });

  it("localizes desktop runtime guidance in the selected language", () => {
    localStorage.setItem("mcsm.language", "zh-CN");

    const error = normalizeDesktopCommandError(
      new Error("Electron desktop bridge is unavailable."),
    );

    expect(error.message).toContain("桌面运行时不可用");
    expect(error.message).toContain("桌面应用");
  });
});
