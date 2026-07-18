import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Electron window security", () => {
  it("keeps renderer Node access disabled and sandboxed", () => {
    const main = fs.readFileSync("electron/main.cjs", "utf8");

    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/sandbox:\s*true/);
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
