import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const tempDirs = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-runtime-"));
  tempDirs.push(root);
  return root;
}

describe("managed Temurin runtimes", () => {
  afterEach(() => {
    for (const root of tempDirs.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["1.16.5", 8],
    ["1.17.1", 16],
    ["1.18.2", 17],
    ["1.20.5", 21],
    ["1.21.4", 21],
    ["26.1", 25],
  ])("maps Minecraft %s to Java %s", (minecraftVersion, expected) => {
    const { requiredJavaMajorForMinecraft } = require("./runtimes.cjs");
    expect(requiredJavaMajorForMinecraft(minecraftVersion)).toBe(expected);
  });

  it("reuses a compatible detected runtime before planning a download", async () => {
    const { createRuntimeManager } = require("./runtimes.cjs");
    const fetchJson = vi.fn();
    const manager = createRuntimeManager({
      userDataDir: tempRoot(),
      platform: "win32",
      arch: "x64",
      fetchJson,
    });

    const plan = await manager.plan({
      majorVersion: 21,
      installedRuntimes: [
        { path: "C:/Java/java.exe", majorVersion: 21, vendor: "Oracle" },
      ],
    });

    expect(plan).toMatchObject({
      action: "reuse",
      runtime: { path: "C:/Java/java.exe" },
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("requests the matching Adoptium OS and architecture asset", async () => {
    const { createRuntimeManager } = require("./runtimes.cjs");
    const fetchJson = vi.fn(async () => [
      {
        version: { semver: "21.0.8+9" },
        binary: {
          package: {
            link: "https://github.com/adoptium/temurin21-binaries/releases/download/jre.zip",
            name: "OpenJDK21U-jre_x64_windows_hotspot.zip",
            checksum: "abc123",
            size: 50,
          },
        },
      },
    ]);
    const manager = createRuntimeManager({
      userDataDir: tempRoot(),
      platform: "win32",
      arch: "x64",
      fetchJson,
    });

    const plan = await manager.plan({ majorVersion: 21, installedRuntimes: [] });

    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("architecture=x64"),
    );
    expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining("os=windows"));
    expect(plan).toMatchObject({
      action: "install",
      vendor: "Eclipse Temurin",
      majorVersion: 21,
      licenseUrl: "https://openjdk.org/legal/gplv2+ce.html",
      checksum: "abc123",
      managed: true,
    });
    expect(plan.targetDir).toContain(
      path.join("runtimes", "temurin", "21", "windows-x64"),
    );
  });

  it("requires consent, verifies SHA-256, extracts app-locally, and validates Java", async () => {
    const { createRuntimeManager } = require("./runtimes.cjs");
    const root = tempRoot();
    const archive = Buffer.from("trusted-runtime");
    const checksum = createHash("sha256").update(archive).digest("hex");
    const manager = createRuntimeManager({
      userDataDir: root,
      platform: "win32",
      arch: "x64",
      fetchJson: vi.fn(async () => [
        {
          version: { semver: "21.0.8+9" },
          binary: {
            package: {
              link: "https://github.com/adoptium/runtime.zip",
              name: "runtime.zip",
              checksum,
              size: archive.length,
            },
          },
        },
      ]),
      download: vi.fn(async (_url, target) => fs.writeFileSync(target, archive)),
      extractArchive: vi.fn(async (_archivePath, target) => {
        const executable = path.join(target, "jdk-21", "bin", "java.exe");
        fs.mkdirSync(path.dirname(executable), { recursive: true });
        fs.writeFileSync(executable, "java");
      }),
      inspectJava: vi.fn((javaPath) => ({
        path: javaPath,
        version: "21.0.8",
        majorVersion: 21,
        vendor: "Eclipse Temurin",
        architecture: "x64",
      })),
    });
    const plan = await manager.plan({ majorVersion: 21, installedRuntimes: [] });

    await expect(manager.install(plan, { consent: false })).rejects.toMatchObject({
      code: "JAVA_CONSENT_REQUIRED",
    });
    const runtime = await manager.install(plan, { consent: true });

    expect(runtime).toMatchObject({
      majorVersion: 21,
      vendor: "Eclipse Temurin",
      managed: true,
    });
    expect(runtime.path).toContain(plan.targetDir);
    expect(fs.existsSync(runtime.path)).toBe(true);
  });

  it("removes staging data after a checksum mismatch", async () => {
    const { createRuntimeManager } = require("./runtimes.cjs");
    const root = tempRoot();
    const manager = createRuntimeManager({
      userDataDir: root,
      platform: "win32",
      arch: "x64",
      fetchJson: vi.fn(async () => [
        {
          version: { semver: "21.0.8+9" },
          binary: {
            package: {
              link: "https://github.com/adoptium/runtime.zip",
              name: "runtime.zip",
              checksum: "0".repeat(64),
              size: 3,
            },
          },
        },
      ]),
      download: vi.fn(async (_url, target) => fs.writeFileSync(target, "bad")),
      extractArchive: vi.fn(),
      inspectJava: vi.fn(),
    });
    const plan = await manager.plan({ majorVersion: 21, installedRuntimes: [] });

    await expect(manager.install(plan, { consent: true })).rejects.toMatchObject({
      code: "JAVA_CHECKSUM_MISMATCH",
    });
    const parent = path.dirname(plan.targetDir);
    const leftovers = fs.existsSync(parent)
      ? fs.readdirSync(parent).filter((name) => name.includes("installing"))
      : [];
    expect(leftovers).toEqual([]);
  });

  function lockableManager(root) {
    const archive = Buffer.from("trusted-runtime");
    const checksum = createHash("sha256").update(archive).digest("hex");
    return createRuntimeManagerForArchive(root, archive, checksum);
  }

  function createRuntimeManagerForArchive(root, archive, checksum) {
    const { createRuntimeManager } = require("./runtimes.cjs");
    return createRuntimeManager({
      userDataDir: root,
      platform: "win32",
      arch: "x64",
      fetchJson: vi.fn(async () => [
        {
          version: { semver: "21.0.8+9" },
          binary: {
            package: {
              link: "https://github.com/adoptium/runtime.zip",
              name: "runtime.zip",
              checksum,
              size: archive.length,
            },
          },
        },
      ]),
      download: vi.fn(async (_url, target) => fs.writeFileSync(target, archive)),
      extractArchive: vi.fn(async (_archivePath, target) => {
        const executable = path.join(target, "jdk-21", "bin", "java.exe");
        fs.mkdirSync(path.dirname(executable), { recursive: true });
        fs.writeFileSync(executable, "java");
      }),
      inspectJava: vi.fn((javaPath) => ({
        path: javaPath,
        version: "21.0.8",
        majorVersion: 21,
        vendor: "Eclipse Temurin",
        architecture: "x64",
      })),
    });
  }

  it("commits the runtime after a transient EPERM on the staging rename", async () => {
    const root = tempRoot();
    const manager = lockableManager(root);
    const plan = await manager.plan({ majorVersion: 21, installedRuntimes: [] });

    const realRename = fs.renameSync.bind(fs);
    let attempts = 0;
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
      attempts += 1;
      if (attempts <= 2) {
        throw Object.assign(new Error("EPERM: operation not permitted"), {
          code: "EPERM",
          path: path.join(args[0], "bin", "ucrtbase.dll"),
        });
      }
      return realRename(...args);
    });

    try {
      const runtime = await manager.install(plan, { consent: true });
      expect(attempts).toBe(3);
      expect(fs.existsSync(runtime.path)).toBe(true);
    } finally {
      rename.mockRestore();
    }
  });

  it("reports a locked target when the rename never clears", async () => {
    const root = tempRoot();
    const manager = lockableManager(root);
    const plan = await manager.plan({ majorVersion: 21, installedRuntimes: [] });

    const previousBudget = process.env.MCSM_FS_RETRY_MS;
    process.env.MCSM_FS_RETRY_MS = "120";
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("EPERM: operation not permitted"), {
        code: "EPERM",
        path: path.join(plan.targetDir, "bin", "ucrtbase.dll"),
      });
    });

    try {
      await expect(
        manager.install(plan, { consent: true }),
      ).rejects.toMatchObject({ code: "JAVA_TARGET_LOCKED" });
    } finally {
      rename.mockRestore();
      if (previousBudget === undefined) {
        delete process.env.MCSM_FS_RETRY_MS;
      } else {
        process.env.MCSM_FS_RETRY_MS = previousBudget;
      }
    }
  });

  it("blocks a renderer-supplied managed Java download outside trusted hosts", async () => {
    const { createRuntimeManager } = require("./runtimes.cjs");
    const root = tempRoot();
    const download = vi.fn();
    const manager = createRuntimeManager({
      userDataDir: root,
      platform: "win32",
      arch: "x64",
      fetchJson: vi.fn(),
      download,
      extractArchive: vi.fn(),
      inspectJava: vi.fn(),
    });

    await expect(
      manager.install(
        {
          action: "install",
          majorVersion: 21,
          url: "http://127.0.0.1/runtime.zip",
          filename: "runtime.zip",
          checksum: "0".repeat(64),
          targetDir: path.join(root, "runtimes", "temurin", "21", "windows-x64"),
        },
        { consent: true },
      ),
    ).rejects.toMatchObject({ code: "JAVA_DOWNLOAD_URL_BLOCKED" });
    expect(download).not.toHaveBeenCalled();
  });
});
