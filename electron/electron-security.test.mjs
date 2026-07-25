import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Electron window security", () => {
  it("keeps renderer Node access disabled and sandboxed", () => {
    const main = fs.readFileSync("electron/main.cjs", "utf8");

    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/sandbox:\s*true/);
  });

  it("ships a Content Security Policy that cannot execute injected script", () => {
    const config = fs.readFileSync("vite.config.ts", "utf8");

    expect(config).toContain("Content-Security-Policy");
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
    ]) {
      expect(config).toContain(directive);
    }
    // Ignored in a meta policy, and Chromium logs an error for it.
    expect(config).not.toContain("frame-ancestors 'none'\",");
  });

  it("refuses to run two instances against one database", () => {
    const main = fs.readFileSync("electron/main.cjs", "utf8");

    expect(main).toContain("app.requestSingleInstanceLock()");
    expect(main).toContain('app.on("second-instance"');
  });

  it("reports main-process and renderer failures instead of dying quietly", () => {
    const main = fs.readFileSync("electron/main.cjs", "utf8");

    expect(main).toContain('process.on("uncaughtException"');
    expect(main).toContain('process.on("unhandledRejection"');
    expect(main).toContain('"render-process-gone"');
  });

  it("never traps the user behind a window a dead renderer cannot close", () => {
    const main = fs.readFileSync("electron/main.cjs", "utf8");

    expect(main).toContain("CLOSE_RESPONSE_TIMEOUT_MS");
    expect(main).toMatch(/rendererGone \|\| mainWindow\?\.webContents\.isCrashed\(\)/);
  });

  it("rejects unsupported preload commands before IPC dispatch", () => {
    const preload = fs.readFileSync("electron/preload.cjs", "utf8");

    expect(preload).toContain("allowedAppCommands");
    expect(preload).toContain("Unsupported renderer command");
    expect(preload).toContain("request_app_quit");
    expect(preload).toContain("restore_world_backup");
    expect(preload).toContain("get_server_setup_status");
  });

  it("allows every command required by the provisioning wizard", () => {
    const preload = fs.readFileSync("electron/preload.cjs", "utf8");
    const provisioningCommands = [
      "plan_server_provisioning",
      "plan_java_runtime",
      "install_java_runtime",
      "create_provisioning_job",
      "get_provisioning_job",
      "list_recoverable_provisioning_jobs",
      "run_provisioning_job",
      "retry_provisioning_job",
      "cancel_provisioning_job",
    ];

    for (const command of provisioningCommands) {
      expect(preload).toContain(`"${command}"`);
    }
  });
});
