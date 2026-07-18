import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createBackend } = require("./backend.cjs");
const originalFetch = globalThis.fetch;
const tempDirs = [];

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    writes: [],
    write(value) {
      this.writes.push(value);
    },
  };
  child.kill = vi.fn(() => {
    child.killed = true;
    child.emit("exit", 0);
    return true;
  });
  return child;
}

function finalPlan(sourcePlan, targetDir, javaPath, name, autoStart) {
  return {
    ...sourcePlan,
    targetDir,
    profile: {
      name,
      loaderType: "paper",
      minecraftVersion: "1.21.10",
      loaderVersion: "130",
      autoStart,
      restartPolicy: { enabled: true, maxAttempts: 3, cooldownSeconds: 30 },
    },
    configuration: {
      serverPort: 25565,
      minMemoryMb: 1024,
      maxMemoryMb: 2048,
      motd: "Offline smoke server",
      gameMode: "survival",
      difficulty: "normal",
      maxPlayers: 20,
      onlineMode: true,
      pvp: true,
      whiteList: false,
      viewDistance: 10,
      simulationDistance: 10,
    },
    compatibilityWarnings: sourcePlan.warnings,
    acknowledgedWarningCodes: [],
    eula: {
      accepted: true,
      termsUrl: "https://aka.ms/MinecraftEULA",
      acceptedAt: "2026-07-18T12:00:00.000Z",
    },
    javaRuntime: { path: javaPath, majorVersion: 21, validated: true },
    launchSpec: { ...sourcePlan.launchSpec, validated: true },
  };
}

describe("deterministic desktop provisioning smoke", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { force: true, recursive: true });
    }
  });

  it("provisions, starts, records output, stops, and resumes a persisted job without production network access", async () => {
    const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-smoke-"));
    tempDirs.push(appDataDir);
    const serverJar = Buffer.from("deterministic-paper-server");
    const sha256 = createHash("sha256").update(serverJar).digest("hex");
    globalThis.fetch = vi.fn(async (url) => {
      const href = String(url);
      if (href === "https://fill-data.papermc.io/fixtures/paper-server.jar") {
        return new Response(serverJar, { status: 200 });
      }
      if (href === "https://fill.papermc.io/v3/projects/paper/versions/1.21.10/builds") {
        return new Response(
          JSON.stringify([
            {
              id: 130,
              channel: "STABLE",
              downloads: {
                "server:default": {
                  url: "https://fill-data.papermc.io/fixtures/paper-server.jar",
                  checksums: { sha256 },
                  size: serverJar.length,
                },
              },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected network request: ${href}`);
    });
    const children = [];
    const spawn = vi.fn(() => {
      const child = fakeChild(31000 + children.length);
      children.push(child);
      return child;
    });
    const javaPath = path.join(appDataDir, "runtime", "bin", "java.exe");
    fs.mkdirSync(path.dirname(javaPath), { recursive: true });
    fs.writeFileSync(javaPath, "fake java runtime");
    const create = () => createBackend({ getPath: () => appDataDir, spawn });
    let backend = create();

    try {
      const sourcePlan = await backend.handle("plan_server_provisioning", {
        input: {
          source: { kind: "blank" },
          name: "Smoke Server",
          prepareInstall: true,
          loaderType: "paper",
          minecraftVersion: "1.21.10",
          loaderVersion: "130",
        },
      });
      const firstTarget = path.join(appDataDir, "servers", "smoke-server");
      const firstJob = backend.handle("create_provisioning_job", {
        input: {
          plan: finalPlan(sourcePlan, firstTarget, javaPath, "Smoke Server", true),
        },
      });
      const ready = await backend.handle("run_provisioning_job", {
        input: { jobId: firstJob.id },
      });

      expect(ready.stage).toBe("ready");
      expect(fs.readFileSync(path.join(firstTarget, "server.jar"))).toEqual(serverJar);
      expect(fs.readFileSync(path.join(firstTarget, "eula.txt"), "utf8")).toBe("eula=true\n");
      expect(spawn).toHaveBeenCalledWith(
        javaPath,
        ["-Xms1024M", "-Xmx2048M", "-jar", "server.jar", "nogui"],
        expect.objectContaining({ cwd: firstTarget, shell: false }),
      );

      children[0].stdout.emit("data", "[Server thread/INFO]: Done (1.0s)! For help, type help\n");
      expect(
        backend
          .handle("list_process_events", { serverId: ready.serverId })
          .some((event) => event.message.includes("Done (1.0s)")),
      ).toBe(true);
      backend.handle("stop_server", { serverId: ready.serverId });
      expect(children[0].stdin.writes).toContain("stop\n");

      const recoveryTarget = path.join(appDataDir, "servers", "recovered-server");
      const recoveryJob = backend.handle("create_provisioning_job", {
        input: {
          plan: finalPlan(sourcePlan, recoveryTarget, javaPath, "Recovered Server", false),
        },
      });
      backend.close();
      backend = null;
      backend = create();

      expect(backend.handle("list_recoverable_provisioning_jobs")).toEqual([
        expect.objectContaining({ id: recoveryJob.id, stage: "planned" }),
      ]);
      const recovered = await backend.handle("run_provisioning_job", {
        input: { jobId: recoveryJob.id },
      });
      expect(recovered.stage).toBe("ready");
      expect(fs.existsSync(path.join(recoveryTarget, "server.jar"))).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    } finally {
      backend?.close();
    }
  });
});
