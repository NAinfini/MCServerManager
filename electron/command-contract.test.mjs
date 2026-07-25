import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createBackend } = require("./backend.cjs");

const internalBackendCommands = new Set([
  "get_database_schema_version",
  "get_server_eula_acceptance",
  "get_server_source",
  "list_provisioning_jobs",
  // Retention is driven by the metric writer and the scheduled-task tick, so
  // the renderer has no reason to be able to delete history.
  "prune_telemetry",
]);

const mainProcessCommands = [
  "check_app_update",
  "install_app_update",
  "open_app_data_folder",
  "open_app_logs_folder",
  "open_server_folder",
  "open_tunnel_application",
  "request_app_quit",
  "show_open_dialog",
  "show_save_dialog",
];

function rendererCommands() {
  const preload = fs.readFileSync("electron/preload.cjs", "utf8");
  const body = preload.match(
    /const allowedAppCommands = new Set\(\[([\s\S]*?)\]\);/,
  )?.[1];
  if (!body) {
    throw new Error("Could not read renderer command allowlist.");
  }
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
}

describe("Electron command contract", () => {
  it("keeps the preload allowlist aligned with backend and main handlers", () => {
    const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-contract-"));
    const backend = createBackend({
      getPath: () => appDataDir,
      checkPortAvailable: async () => true,
    });

    try {
      const publicBackendCommands = backend.commandNames.filter(
        (command) => !internalBackendCommands.has(command),
      );
      expect(rendererCommands()).toEqual(
        [...publicBackendCommands, ...mainProcessCommands].sort(),
      );
    } finally {
      backend.close();
      fs.rmSync(appDataDir, { force: true, recursive: true });
    }
  });

  // A command the fake does not answer throws "Unhandled fake desktop command"
  // the moment a test reaches it, which is why the create-server flow had no
  // end-to-end coverage past its first step for so long.
  it("lets the e2e fake answer every command the renderer may send", () => {
    const fake = fs.readFileSync("e2e/support/fakeDesktopBackend.ts", "utf8");
    const covered = new Set(
      [...fake.matchAll(/case "([a-z0-9_]+)":/g)].map((match) => match[1]),
    );

    expect(rendererCommands().filter((command) => !covered.has(command))).toEqual(
      [],
    );
  });
});
