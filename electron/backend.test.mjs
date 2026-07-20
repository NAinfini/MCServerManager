import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { finished } from "node:stream/promises";
import zlib from "node:zlib";
import yazl from "yazl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createBackend } = require("./backend.cjs");
const { DatabaseSync } = require("node:sqlite");
const tempDirs = [];
const originalFetch = globalThis.fetch;
const originalCurseForgeApiKey = process.env.CURSEFORGE_API_KEY;

function createTestBackend(options = {}) {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-backend-"));
  tempDirs.push(appDataDir);
  return createBackend({
    getPath: () => appDataDir,
    checkPortAvailable: async () => true,
    ...options,
  });
}

function createTestBackendWithAppData() {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-backend-"));
  tempDirs.push(appDataDir);
  return {
    appDataDir,
    backend: createBackend({
      getPath: () => appDataDir,
      checkPortAvailable: async () => true,
    }),
  };
}

describe("Electron backend Java runtime contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.CURSEFORGE_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalCurseForgeApiKey === undefined) {
      delete process.env.CURSEFORGE_API_KEY;
    } else {
      process.env.CURSEFORGE_API_KEY = originalCurseForgeApiKey;
    }
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { force: true, recursive: true });
    }
  });

  it("returns the complete Java runtimes page payload", () => {
    const backend = createTestBackend();

    try {
      const result = backend.handle("list_java_runtimes");

      expect(Array.isArray(result.runtimes)).toBe(true);
      expect(Array.isArray(result.failures)).toBe(true);
      expect(Array.isArray(result.compatibility)).toBe(true);
    } finally {
      backend.close();
    }
  });
});

describe("Electron backend marketplace image loading", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { force: true, recursive: true });
    }
  });

  it("loads trusted BBSMC CDN images through the desktop backend", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async () =>
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/webp" },
      }),
    );

    try {
      const result = await backend.handle("fetch_marketplace_image", {
        input: {
          url: "https://cdn.bbsmc.net/bbsmc/data/cached_images/example.webp",
        },
      });

      expect(result).toEqual({
        contentType: "image/webp",
        dataUrl: "data:image/webp;base64,AQID",
      });
    } finally {
      backend.close();
    }
  });

  it("rejects marketplace image URLs outside the trusted BBSMC CDN path", async () => {
    const backend = createTestBackend();

    try {
      await expect(
        backend.handle("fetch_marketplace_image", {
          input: { url: "https://example.com/image.png" },
        }),
      ).rejects.toMatchObject({ code: "MARKETPLACE_IMAGE_URL_BLOCKED" });
    } finally {
      backend.close();
    }
  });
});

describe("Electron backend loader version catalogs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { force: true, recursive: true });
    }
  });

  it("lists Paper Minecraft versions from the current Fill downloads service", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      expect(String(url)).toBe("https://fill.papermc.io/v3/projects/paper");
      expect(options.headers?.["User-Agent"]).toMatch(/MCServerManager/);
      return jsonResponse({
        versions: {
          1.21: ["1.21.10", "1.21.9"],
          "1.20": ["1.20.6"],
        },
      });
    });

    try {
      const versions = await backend.handle("list_loader_minecraft_versions", {
        input: { loaderType: "paper" },
      });

      expect(versions.map((option) => option.value)).toEqual([
        "1.21.10",
        "1.21.9",
        "1.20.6",
      ]);
      expect(versions[0]).toMatchObject({
        label: "1.21.10",
        stable: true,
      });
    } finally {
      backend.close();
    }
  });

  it("lists stable Paper builds for the selected Minecraft version", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      expect(String(url)).toBe(
        "https://fill.papermc.io/v3/projects/paper/versions/1.21.10/builds",
      );
      expect(options.headers?.["User-Agent"]).toMatch(/MCServerManager/);
      return jsonResponse([
        { id: 130, channel: "STABLE" },
        { id: 129, channel: "BETA" },
      ]);
    });

    try {
      const versions = await backend.handle("list_loader_versions", {
        input: { loaderType: "paper", minecraftVersion: "1.21.10" },
      });

      expect(versions).toEqual([
        { value: "130", label: "Build 130", stable: true },
      ]);
    } finally {
      backend.close();
    }
  });

  it("lists Fabric loader versions compatible with a Minecraft version", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toBe(
        "https://meta.fabricmc.net/v2/versions/loader/1.21.4",
      );
      return jsonResponse([
        { loader: { version: "0.19.3", stable: true } },
        { loader: { version: "0.19.2", stable: false } },
      ]);
    });

    try {
      const versions = await backend.handle("list_loader_versions", {
        input: { loaderType: "fabric", minecraftVersion: "1.21.4" },
      });

      expect(versions).toEqual([
        { value: "0.19.3", label: "0.19.3", stable: true },
      ]);
    } finally {
      backend.close();
    }
  });

  it("lists Quilt loader versions compatible with a Minecraft version", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      expect(String(url)).toBe(
        "https://meta.quiltmc.org/v3/versions/loader/1.21.4",
      );
      expect(options.headers?.["User-Agent"]).toMatch(/MCServerManager/);
      return jsonResponse([
        { loader: { version: "0.29.3" } },
        { loader: { version: "0.29.2" } },
      ]);
    });

    try {
      const versions = await backend.handle("list_loader_versions", {
        input: { loaderType: "quilt", minecraftVersion: "1.21.4" },
      });

      expect(versions.map((option) => option.value)).toEqual([
        "0.29.3",
        "0.29.2",
      ]);
    } finally {
      backend.close();
    }
  });

  it("filters Forge Maven versions by Minecraft version", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toBe(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
      );
      return textResponse(`
        <metadata>
          <versioning>
            <versions>
              <version>1.20.1-47.4.0</version>
              <version>1.20.1-47.3.0</version>
              <version>1.19.4-45.2.0</version>
            </versions>
          </versioning>
        </metadata>
      `);
    });

    try {
      const versions = await backend.handle("list_loader_versions", {
        input: { loaderType: "forge", minecraftVersion: "1.20.1" },
      });

      expect(versions.map((option) => option.value)).toEqual([
        "47.4.0",
        "47.3.0",
      ]);
    } finally {
      backend.close();
    }
  });
});

describe("Electron backend tunnel providers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { force: true, recursive: true });
    }
  });

  it("stores external application tunnel providers", () => {
    const backend = createTestBackend();
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-tunnel-app-"));
    tempDirs.push(appDir);
    const appPath = path.join(appDir, "playit.exe");
    fs.writeFileSync(appPath, "stub");

    try {
      const provider = backend.handle("create_tunnel_provider", {
        input: {
          name: "Playit app",
          kind: "application",
          command: appPath,
        },
      });
      const loaded = backend.handle("get_tunnel_provider", {
        input: { providerId: provider.id },
      });

      expect(loaded.kind).toBe("application");
      expect(loaded.command).toBe(appPath);
    } finally {
      backend.close();
    }
  });

  it("rejects missing external tunnel application paths", () => {
    const backend = createTestBackend();

    try {
      expect(() =>
        backend.handle("create_tunnel_provider", {
          input: {
            name: "Missing app",
            kind: "application",
            command: path.join(os.tmpdir(), "missing-playit.exe"),
          },
        }),
      ).toThrow(/does not exist/);
    } finally {
      backend.close();
    }
  });

  it("updates, disables, and deletes tunnel providers", () => {
    const backend = createTestBackend();

    try {
      const provider = backend.handle("create_tunnel_provider", {
        input: {
          name: "Ngrok",
          kind: "custom",
          command: "ngrok tcp 25565",
        },
      });

      const updated = backend.handle("update_tunnel_provider", {
        input: {
          id: provider.id,
          name: "Ngrok local",
          kind: "custom",
          command: "ngrok tcp 25566",
          enabled: false,
        },
      });

      expect(updated.name).toBe("Ngrok local");
      expect(updated.command).toBe("ngrok tcp 25566");
      expect(updated.enabled).toBe(false);

      backend.handle("delete_tunnel_provider", {
        input: { providerId: provider.id },
      });

      expect(backend.handle("list_tunnel_providers")).toEqual([]);
    } finally {
      backend.close();
    }
  });

  it("can disable and delete legacy playit tunnel providers", () => {
    const { appDataDir, backend } = createTestBackendWithAppData();
    const legacyId = "legacy-playit";
    const db = new DatabaseSync(
      path.join(appDataDir, "mc-server-manager.sqlite"),
    );
    try {
      db.prepare(
        "INSERT INTO tunnel_providers (id, name, kind, command, enabled, created_at) VALUES (?, ?, 'playit', NULL, 1, ?)",
      ).run(legacyId, "Legacy playit", new Date().toISOString());
    } finally {
      db.close();
    }

    try {
      const [provider] = backend.handle("list_tunnel_providers");
      expect(provider).toMatchObject({
        id: legacyId,
        kind: "application",
        command: null,
        enabled: true,
      });

      const disabled = backend.handle("update_tunnel_provider", {
        input: {
          id: legacyId,
          name: "Legacy playit",
          kind: "application",
          command: null,
          enabled: false,
        },
      });

      expect(disabled.enabled).toBe(false);

      backend.handle("delete_tunnel_provider", { providerId: legacyId });

      expect(backend.handle("list_tunnel_providers")).toEqual([]);
    } finally {
      backend.close();
    }
  });

  it("rejects new playit monitor tunnel providers", () => {
    const backend = createTestBackend();

    try {
      expect(() =>
        backend.handle("create_tunnel_provider", {
          input: {
            name: "Playit monitor",
            kind: "playit",
          },
        }),
      ).toThrow(/unsupported tunnel provider type/);
    } finally {
      backend.close();
    }
  });
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { "content-type": "application/xml" },
  });
}

function binaryResponse(text, status = 200) {
  return new Response(Buffer.from(text), { status });
}

function createServer(backend, rootDir, loaderType = "paper") {
  return backend.handle("create_server_profile", {
    input: {
      source: { kind: "blank" },
      name: "Marketplace Server",
      rootDir,
      loaderType,
      minecraftVersion: "1.21.4",
      serverPort: 25565,
      minMemoryMb: 1024,
      maxMemoryMb: 4096,
    },
  });
}

function createFakeChild(pid) {
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
    child.emit("exit", null);
    return true;
  });
  return child;
}

async function createProvisionedServer(
  backend,
  targetDir,
  launchSpec,
  profileOverrides = {},
) {
  const javaPath = path.join(
    path.dirname(targetDir),
    "runtime",
    "bin",
    process.platform === "win32" ? "java.exe" : "java",
  );
  fs.mkdirSync(path.dirname(javaPath), { recursive: true });
  fs.writeFileSync(javaPath, "test runtime");
  const job = backend.handle("create_provisioning_job", {
    input: {
      plan: validProvisioningPlan(targetDir, {
        javaRuntime: {
          path: javaPath,
          majorVersion: 21,
          validated: true,
        },
        launchSpec: { ...launchSpec, validated: true },
        profile: {
          name: "Structured Server",
          loaderType: "forge",
          minecraftVersion: "1.21.4",
          loaderVersion: "54.0.1",
          ...profileOverrides,
        },
        source: { kind: "blank" },
      }),
    },
  });
  const ready = await backend.handle("run_provisioning_job", {
    input: { jobId: job.id },
  });
  return backend
    .handle("list_server_profiles")
    .find((profile) => profile.id === ready.serverId);
}

async function createZipFixture(entries, extension = "zip") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-backend-pack-"));
  tempDirs.push(root);
  const archivePath = path.join(root, `fixture.${extension}`);
  const zip = new yazl.ZipFile();
  for (const [name, content] of entries) {
    zip.addBuffer(Buffer.from(content), name);
  }
  zip.end();
  const output = fs.createWriteStream(archivePath);
  zip.outputStream.pipe(output);
  await finished(output);
  return archivePath;
}

function validProvisioningPlan(targetDir, overrides = {}) {
  return {
    targetDir,
    compatibilityWarnings: [],
    acknowledgedWarningCodes: [],
    eula: {
      accepted: true,
      termsUrl: "https://aka.ms/MinecraftEULA",
      acceptedAt: "2026-07-18T12:00:00.000Z",
    },
    configuration: {
      minMemoryMb: 1024,
      maxMemoryMb: 2048,
      serverPort: 25565,
    },
    javaRuntime: { path: "java", majorVersion: 21, validated: true },
    launchSpec: {
      executable: { kind: "java" },
      jvmArgs: ["-jar", "server.jar"],
      serverArgs: ["nogui"],
      workingDirectory: ".",
      validated: true,
    },
    ...overrides,
  };
}

describe("Electron backend provisioning plan contract", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { force: true, recursive: true });
    }
  });

  it("prepares a trusted blank Paper server with an executable loader plan", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toBe(
        "https://fill.papermc.io/v3/projects/paper/versions/1.21.10/builds",
      );
      return jsonResponse([
        {
          id: 130,
          channel: "STABLE",
          downloads: {
            "server:default": {
              url: "https://fill-data.papermc.io/server.jar",
              checksums: { sha256: "abc" },
              size: 1024,
            },
          },
        },
      ]);
    });

    try {
      const plan = await backend.handle("plan_server_provisioning", {
        input: {
          source: { kind: "blank" },
          name: "Quilted Paper",
          prepareInstall: true,
          loaderType: "paper",
          minecraftVersion: "1.21.10",
          loaderVersion: "130",
        },
      });

      expect(plan).toMatchObject({
        pack: { name: "Quilted Paper" },
        loaderType: "paper",
        minecraftVersion: "1.21.10",
        loaderVersion: "130",
        requiredJavaMajor: 21,
        launchSpec: {
          executable: { kind: "java" },
          jvmArgs: ["-jar", "server.jar"],
          serverArgs: ["nogui"],
          workingDirectory: ".",
        },
        loaderInstallPlan: {
          artifacts: [
            expect.objectContaining({
              url: "https://fill-data.papermc.io/server.jar",
              destination: "server.jar",
            }),
          ],
        },
      });
    } finally {
      backend.close();
    }
  });

  it("prepares an explicitly selected runtime for an unverified existing folder", async () => {
    const backend = createTestBackend();
    const rootDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcsm-existing-unverified-"),
    );
    tempDirs.push(rootDir);
    const serverJar = Buffer.from("paper-server");
    const serverJarHash = createHash("sha256").update(serverJar).digest("hex");
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url) === "https://fill-data.papermc.io/server.jar") {
        return new Response(serverJar, { status: 200 });
      }
      return jsonResponse([
        {
          id: 130,
          channel: "STABLE",
          downloads: {
            "server:default": {
              url: "https://fill-data.papermc.io/server.jar",
              checksums: { sha256: serverJarHash },
              size: 1024,
            },
          },
        },
      ]);
    });

    try {
      const plan = await backend.handle("plan_server_provisioning", {
        input: {
          source: { kind: "existingFolder" },
          rootDir,
          prepareInstall: true,
          loaderType: "paper",
          minecraftVersion: "1.21.10",
          loaderVersion: "130",
        },
      });

      expect(plan).toMatchObject({
        source: { kind: "existingFolder", rootDir },
        useExistingTarget: true,
        loaderType: "paper",
        minecraftVersion: "1.21.10",
        launchSpec: { jvmArgs: ["-jar", "server.jar"] },
        warnings: [
          expect.objectContaining({
            code: "EXISTING_RUNTIME_UNVERIFIED",
            requiresAcknowledgement: true,
          }),
        ],
      });

      const javaPath = path.join(rootDir, "java.exe");
      fs.writeFileSync(javaPath, "test-java");
      const job = backend.handle("create_provisioning_job", {
        input: {
          plan: validProvisioningPlan(rootDir, {
            ...plan,
            compatibilityWarnings: plan.warnings,
            acknowledgedWarningCodes: ["EXISTING_RUNTIME_UNVERIFIED"],
            javaRuntime: { path: javaPath, majorVersion: 21, validated: true },
            launchSpec: { ...plan.launchSpec, validated: true },
            profile: {
              name: "Existing Paper Server",
              loaderType: "paper",
              minecraftVersion: "1.21.10",
              loaderVersion: "130",
              autoStart: false,
            },
          }),
        },
      });
      const ready = await backend.handle("run_provisioning_job", {
        input: { jobId: job.id },
      });

      expect(ready.stage).toBe("ready");
      expect(fs.readFileSync(path.join(rootDir, "server.jar"))).toEqual(
        serverJar,
      );
    } finally {
      backend.close();
    }
  });

  it("returns detected metadata for a local Modrinth server pack", async () => {
    const backend = createTestBackend();
    const packPath = await createZipFixture(
      [
        [
          "modrinth.index.json",
          JSON.stringify({
            formatVersion: 1,
            game: "minecraft",
            name: "Backend Pack",
            dependencies: { minecraft: "1.21.4", "quilt-loader": "0.26.4" },
            files: [],
          }),
        ],
      ],
      "mrpack",
    );

    try {
      await expect(
        backend.handle("plan_server_provisioning", {
          input: { source: { kind: "localModpackFile", path: packPath } },
        }),
      ).resolves.toMatchObject({
        pack: { format: "modrinth", name: "Backend Pack" },
        minecraftVersion: "1.21.4",
        loaderType: "quilt",
        loaderVersion: "0.26.4",
      });
    } finally {
      backend.close();
    }
  });

  it("plans and installs managed Temurin only after explicit consent", async () => {
    const archive = Buffer.from("managed-java");
    const checksum = createHash("sha256").update(archive).digest("hex");
    const download = vi.fn(async (_url, target) =>
      fs.writeFileSync(target, archive),
    );
    const backend = createTestBackend({
      runtimeDependencies: {
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
        download,
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
      },
    });

    try {
      const plan = await backend.handle("plan_java_runtime", {
        input: { majorVersion: 21 },
      });
      expect(plan).toMatchObject({ action: "install", majorVersion: 21 });

      await expect(
        backend.handle("install_java_runtime", {
          input: { plan, consent: false },
        }),
      ).rejects.toMatchObject({ code: "JAVA_CONSENT_REQUIRED" });
      expect(download).not.toHaveBeenCalled();

      const rendererTamperedPlan = {
        ...plan,
        url: "https://github.com/attacker/fake-java.zip",
        checksum: "0".repeat(64),
      };
      const runtime = await backend.handle("install_java_runtime", {
        input: { plan: rendererTamperedPlan, consent: true },
      });
      expect(runtime).toMatchObject({ managed: true, majorVersion: 21 });
      expect(download).toHaveBeenCalledWith(
        "https://github.com/adoptium/runtime.zip",
        expect.any(String),
      );
      expect(download).not.toHaveBeenCalledWith(
        "https://github.com/attacker/fake-java.zip",
        expect.any(String),
      );
    } finally {
      backend.close();
    }
  });
});

describe("Electron backend provisioning job commands", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { force: true, recursive: true });
    }
  });

  it("persists, lists, runs, and reloads a provisioning job", async () => {
    const backend = createTestBackend();
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-job-target-"));
    tempDirs.push(parent);
    const targetDir = path.join(parent, "server");

    try {
      const job = backend.handle("create_provisioning_job", {
        input: { plan: validProvisioningPlan(targetDir) },
      });
      expect(job).toMatchObject({ stage: "planned", targetDir });
      expect(backend.handle("list_provisioning_jobs")).toEqual([
        expect.objectContaining({ id: job.id }),
      ]);

      const ready = await backend.handle("run_provisioning_job", {
        input: { jobId: job.id },
      });
      expect(ready.stage).toBe("ready");
      expect(fs.existsSync(targetDir)).toBe(true);
      expect(
        backend.handle("get_provisioning_job", {
          input: { jobId: job.id },
        }),
      ).toMatchObject({ id: job.id, stage: "ready" });
    } finally {
      backend.close();
    }
  });

  it("blocks pack-controlled provisioning downloads to private network addresses", async () => {
    const backend = createTestBackend();
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcsm-private-download-"),
    );
    tempDirs.push(parent);
    const fetchAttempt = vi.fn(async () => binaryResponse("private data"));
    globalThis.fetch = fetchAttempt;

    try {
      const job = backend.handle("create_provisioning_job", {
        input: {
          plan: validProvisioningPlan(path.join(parent, "server"), {
            source: {
              kind: "localModpackFile",
              path: path.join(parent, "pack.mrpack"),
            },
            artifacts: [
              {
                provider: "modrinth",
                path: "mods/private.jar",
                url: "http://127.0.0.1/internal.jar",
                hashes: { sha1: "deadbeef" },
              },
            ],
          }),
        },
      });

      await expect(
        backend.handle("run_provisioning_job", { input: { jobId: job.id } }),
      ).rejects.toMatchObject({ code: "PROVISIONING_URL_BLOCKED" });
      expect(fetchAttempt).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      backend.close();
    }
  });

  it("blocks an approved provisioning URL that redirects to a private address", async () => {
    const backend = createTestBackend();
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcsm-private-redirect-"),
    );
    tempDirs.push(parent);
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: "http://127.0.0.1/redirected.jar",
      arrayBuffer: async () => Buffer.from("private data"),
    }));

    try {
      const job = backend.handle("create_provisioning_job", {
        input: {
          plan: validProvisioningPlan(path.join(parent, "server"), {
            source: {
              kind: "localModpackFile",
              path: path.join(parent, "pack.mrpack"),
            },
            artifacts: [
              {
                provider: "modrinth",
                path: "mods/redirected.jar",
                url: "https://cdn.modrinth.com/redirected.jar",
                hashes: {},
              },
            ],
          }),
        },
      });

      await expect(
        backend.handle("run_provisioning_job", { input: { jobId: job.id } }),
      ).rejects.toMatchObject({ code: "PROVISIONING_URL_BLOCKED" });
      expect(fs.existsSync(path.join(parent, ".server"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      backend.close();
    }
  });

  it("rebuilds loader installation plans instead of executing renderer-supplied installer arguments", async () => {
    const spawnImpl = vi.fn(() => {
      throw new Error("tampered installer arguments were executed");
    });
    const backend = createTestBackend({ spawn: spawnImpl });
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcsm-trusted-loader-plan-"),
    );
    tempDirs.push(parent);
    const serverJar = Buffer.from("trusted paper server");
    const sha256 = createHash("sha256").update(serverJar).digest("hex");
    globalThis.fetch = vi.fn(async (url) => {
      const href = String(url);
      if (href === "https://fill-data.papermc.io/server.jar") {
        return binaryResponse(serverJar);
      }
      if (
        href ===
        "https://fill.papermc.io/v3/projects/paper/versions/1.21.10/builds"
      ) {
        return jsonResponse([
          {
            id: 130,
            channel: "STABLE",
            downloads: {
              "server:default": {
                url: "https://fill-data.papermc.io/server.jar",
                checksums: { sha256 },
                size: serverJar.length,
              },
            },
          },
        ]);
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    try {
      const targetDir = path.join(parent, "server");
      const job = backend.handle("create_provisioning_job", {
        input: {
          plan: validProvisioningPlan(targetDir, {
            loaderType: "paper",
            minecraftVersion: "1.21.10",
            loaderVersion: "130",
            loaderInstallPlan: {
              loaderType: "paper",
              minecraftVersion: "1.21.10",
              loaderVersion: "130",
              workingDirectory: ".",
              artifacts: [],
              installer: {
                artifactDestination: "renderer-controlled.jar",
                args: ["-jar", "{installer}", "--renderer-controlled"],
              },
              expectedOutputs: [],
              launchSpec: {
                executable: { kind: "java" },
                jvmArgs: ["-jar", "renderer-controlled.jar"],
                serverArgs: ["nogui"],
                workingDirectory: ".",
              },
            },
          }),
        },
      });

      const ready = await backend.handle("run_provisioning_job", {
        input: { jobId: job.id },
      });
      expect(ready.stage).toBe("ready");
      expect(spawnImpl).not.toHaveBeenCalled();
      expect(fs.readFileSync(path.join(targetDir, "server.jar"))).toEqual(
        serverJar,
      );
      expect(ready.plan.launchSpec.jvmArgs).toEqual(["-jar", "server.jar"]);
    } finally {
      globalThis.fetch = originalFetch;
      backend.close();
    }
  });

  it("cancels a planned provisioning job through the command bridge", () => {
    const backend = createTestBackend();
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-job-cancel-"));
    tempDirs.push(parent);

    try {
      const job = backend.handle("create_provisioning_job", {
        input: { plan: { targetDir: path.join(parent, "server") } },
      });
      const cancelled = backend.handle("cancel_provisioning_job", {
        input: { jobId: job.id },
      });
      expect(cancelled).toMatchObject({
        stage: "failed",
        error: { code: "JOB_CANCELLED" },
      });
    } finally {
      backend.close();
    }
  });

  it("creates the profile, source, and EULA record only after file commit", async () => {
    const backend = createTestBackend();
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcsm-atomic-profile-"),
    );
    tempDirs.push(parent);
    const targetDir = path.join(parent, "quilt-server");
    const plan = validProvisioningPlan(targetDir, {
      profile: {
        name: "Quilt Server",
        loaderType: "quilt",
        minecraftVersion: "1.21.4",
        loaderVersion: "0.29.3",
        restartPolicy: { enabled: false, maxAttempts: 0, cooldownSeconds: 0 },
      },
      source: {
        kind: "marketplaceModpack",
        provider: "Modrinth",
        projectId: "project-1",
        versionId: "version-1",
      },
    });

    try {
      const job = backend.handle("create_provisioning_job", {
        input: { plan },
      });
      expect(backend.handle("list_server_profiles")).toEqual([]);

      const ready = await backend.handle("run_provisioning_job", {
        input: { jobId: job.id },
      });

      expect(ready.serverId).toEqual(expect.any(String));
      expect(backend.handle("list_server_profiles")).toEqual([
        expect.objectContaining({
          id: ready.serverId,
          name: "Quilt Server",
          rootDir: targetDir,
          loaderType: "quilt",
          launchSpec: expect.objectContaining({
            jvmArgs: ["-jar", "server.jar"],
          }),
        }),
      ]);
      expect(
        backend.handle("get_server_eula_acceptance", {
          input: { serverId: ready.serverId },
        }),
      ).toMatchObject({
        termsUrl: "https://aka.ms/MinecraftEULA",
        acceptedAt: "2026-07-18T12:00:00.000Z",
      });
      expect(
        backend.handle("get_server_source", {
          input: { serverId: ready.serverId },
        }),
      ).toMatchObject({
        provider: "modrinth",
        projectId: "project-1",
        versionId: "version-1",
        metadata: { kind: "marketplaceModpack" },
      });
      expect(fs.readFileSync(path.join(targetDir, "eula.txt"), "utf8")).toBe(
        "eula=true\n",
      );
    } finally {
      backend.close();
    }
  });
});

describe("Electron backend server properties contract", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { force: true, recursive: true });
    }
  });

  it("preserves comments and unknown properties when saving explicit updates", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcsm-properties-"),
    );
    tempDirs.push(serverRoot);
    const server = createServer(backend, serverRoot);
    fs.writeFileSync(
      path.join(serverRoot, "server.properties"),
      "# Pack settings\nmotd=Pack server\nunknown-pack-key=keep\n",
    );

    try {
      const saved = backend.handle("save_server_properties", {
        input: {
          serverId: server.id,
          updates: [{ key: "motd", value: "Managed server", known: true }],
        },
      });

      expect(saved.serverId).toBe(server.id);
      expect(saved.raw).toBe(
        "# Pack settings\nmotd=Managed server\nunknown-pack-key=keep\n",
      );
      expect(saved.entries).toEqual([
        { key: "motd", value: "Managed server" },
        { key: "unknown-pack-key", value: "keep" },
      ]);
    } finally {
      backend.close();
    }
  });
});

describe("Electron backend resource lifecycle management", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { force: true, recursive: true });
    }
  });

  it("creates new blank servers in the managed app data servers folder when no root is provided", () => {
    const { appDataDir, backend } = createTestBackendWithAppData();

    try {
      const server = backend.handle("create_server_profile", {
        input: {
          source: { kind: "blank" },
          name: "My First: Server!",
          loaderType: "paper",
          minecraftVersion: "1.21.4",
          serverPort: 25565,
          minMemoryMb: 1024,
          maxMemoryMb: 4096,
        },
      });

      expect(server.rootDir).toBe(
        path.join(appDataDir, "servers", "My First- Server!"),
      );
      expect(fs.existsSync(server.rootDir)).toBe(true);
    } finally {
      backend.close();
    }
  });

  it("reports the same managed default root used for new servers", () => {
    const { appDataDir, backend } = createTestBackendWithAppData();

    try {
      const result = backend.handle("get_default_server_root", {
        input: { name: "My First: Server!" },
      });

      expect(result).toEqual({
        path: path.join(appDataDir, "servers", "My First- Server!"),
      });
    } finally {
      backend.close();
    }
  });

  it("detects existing server folders from server properties and jar names", () => {
    const backend = createTestBackend();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-import-"));
    tempDirs.push(rootDir);
    fs.writeFileSync(
      path.join(rootDir, "server.properties"),
      "motd=Imported\nserver-port=25570\n",
    );
    fs.writeFileSync(path.join(rootDir, "eula.txt"), "eula=true\n");
    fs.writeFileSync(path.join(rootDir, "paper-1.21.4-120.jar"), "jar");

    try {
      const detected = backend.handle("detect_server_version", { rootDir });

      expect(detected).toMatchObject({
        loaderType: "paper",
        minecraftVersion: "1.21.4",
        loaderVersion: "120",
        serverJarName: "paper-1.21.4-120.jar",
        hasEula: true,
        hasServerProperties: true,
        serverPort: 25570,
      });
    } finally {
      backend.close();
    }
  });

  it("persists app preferences and clears only the cache directory", () => {
    const { appDataDir, backend } = createTestBackendWithAppData();

    try {
      const cacheFile = path.join(appDataDir, "cache", "marketplace.json");
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, "cached");

      const saved = backend.handle("save_app_preferences", {
        input: {
          closeBehavior: "quit",
          defaultServerDir: "D:/ManagedServers",
          logging: { level: "debug", retentionDays: 30 },
          serverDefaults: { javaStrategy: "latest-lts", maxMemoryMb: 8192 },
          backupDefaults: { compression: "tar.gz", frequency: "weekly" },
          marketplace: { defaultProvider: "bbsmc", showIncompatible: true },
          appearance: { compactMode: true, motion: "reduced" },
          providers: { bbsmc: false },
        },
      });

      expect(saved.closeBehavior).toBe("quit");
      expect(saved.defaultServerDir).toBe("D:/ManagedServers");
      expect(saved.logging).toMatchObject({
        level: "debug",
        retentionDays: 30,
      });
      expect(saved.serverDefaults).toMatchObject({
        javaStrategy: "latest-lts",
        maxMemoryMb: 8192,
      });
      expect(saved.backupDefaults).toMatchObject({
        compression: "tar.gz",
        frequency: "weekly",
      });
      expect(saved.marketplace).toMatchObject({
        defaultProvider: "bbsmc",
        showIncompatible: true,
      });
      expect(saved.appearance).toMatchObject({
        compactMode: true,
        motion: "reduced",
      });
      expect(saved.providers.bbsmc).toBe(false);

      expect(backend.handle("get_app_preferences")).toMatchObject({
        closeBehavior: "quit",
        defaultServerDir: "D:/ManagedServers",
        providers: expect.objectContaining({ bbsmc: false }),
      });

      expect(backend.handle("clear_app_cache")).toEqual({ cleared: true });
      expect(fs.existsSync(cacheFile)).toBe(false);
      expect(fs.existsSync(path.join(appDataDir, "cache"))).toBe(true);
    } finally {
      backend.close();
    }
  });

  it("does not persist CurseForge as a discoverable default provider without credentials", () => {
    const backend = createTestBackend();

    try {
      const saved = backend.handle("save_app_preferences", {
        input: { marketplace: { defaultProvider: "curseforge" } },
      });

      expect(saved.marketplace.defaultProvider).toBe("modrinth");
    } finally {
      backend.close();
    }
  });

  it("exports, imports, and resets app preferences", () => {
    const { appDataDir, backend } = createTestBackendWithAppData();

    try {
      const exportPath = path.join(appDataDir, "prefs.json");
      backend.handle("save_app_preferences", {
        input: {
          defaultServerDir: "D:/Servers",
          serverDefaults: { javaStrategy: "manual" },
        },
      });

      expect(
        backend.handle("export_app_settings", {
          input: { path: exportPath },
        }),
      ).toEqual({ path: exportPath });

      const exported = JSON.parse(fs.readFileSync(exportPath, "utf8"));
      expect(exported.defaultServerDir).toBe("D:/Servers");

      fs.writeFileSync(
        exportPath,
        JSON.stringify({
          defaultServerDir: "E:/Servers",
          serverDefaults: { javaStrategy: "latest-lts" },
        }),
      );
      const imported = backend.handle("import_app_settings", {
        input: { path: exportPath },
      });
      expect(imported.defaultServerDir).toBe("E:/Servers");
      expect(imported.serverDefaults.javaStrategy).toBe("latest-lts");

      const reset = backend.handle("reset_app_preferences");
      expect(reset.defaultServerDir).toBe(path.join(appDataDir, "servers"));
    } finally {
      backend.close();
    }
  });

  it("writes, lists, and clears application logs", () => {
    const { appDataDir, backend } = createTestBackendWithAppData();

    try {
      backend.handle("write_app_log", {
        input: {
          level: "warning",
          source: "renderer.console",
          message: "Renderer warning",
          details: "stack trace",
        },
      });
      backend.handle("write_app_log", {
        input: {
          level: "error",
          source: "main.ipc",
          message: "IPC failed",
        },
      });

      const logs = backend.handle("list_app_logs", {
        input: { level: "all", limit: 10 },
      });

      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({
        level: "error",
        source: "main.ipc",
        message: "IPC failed",
      });
      expect(logs[1]).toMatchObject({
        level: "warning",
        source: "renderer.console",
        message: "Renderer warning",
        details: "stack trace",
      });
      expect(fs.existsSync(path.join(appDataDir, "logs", "app.log"))).toBe(
        true,
      );

      expect(backend.handle("clear_app_logs")).toEqual({ cleared: true });
      expect(backend.handle("list_app_logs", { input: { limit: 10 } })).toEqual(
        [],
      );
    } finally {
      backend.close();
    }
  });

  it("honors configured log level and exports diagnostics", () => {
    const { appDataDir, backend } = createTestBackendWithAppData();

    try {
      backend.handle("save_app_preferences", {
        input: { logging: { level: "warning" } },
      });
      const skipped = backend.handle("write_app_log", {
        input: { level: "info", message: "Ignored info" },
      });
      backend.handle("write_app_log", {
        input: { level: "error", message: "Visible error" },
      });

      expect(skipped.skipped).toBe(true);
      expect(
        backend.handle("list_app_logs", { input: { level: "all" } }),
      ).toHaveLength(1);

      const diagnosticsPath = path.join(appDataDir, "diagnostics.json");
      backend.handle("export_diagnostic_package", {
        input: { path: diagnosticsPath },
      });
      const diagnostics = JSON.parse(fs.readFileSync(diagnosticsPath, "utf8"));
      expect(diagnostics.logs[0].message).toBe("Visible error");
      expect(backend.handle("get_app_logs_folder").path).toBe(
        path.join(appDataDir, "logs"),
      );
      expect(backend.handle("get_app_data_folder").path).toBe(appDataDir);
    } finally {
      backend.close();
    }
  });

  it("updates and deletes backup profiles", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);

    try {
      const server = createServer(backend, serverRoot);
      const profile = backend.handle("create_backup_profile", {
        input: {
          serverId: server.id,
          name: "Daily",
          mode: "worldOnly",
          includePaths: ["world"],
          excludePaths: [],
          retentionCount: 7,
        },
      });

      const updated = backend.handle("update_backup_profile", {
        input: {
          id: profile.id,
          serverId: server.id,
          name: "Nightly",
          mode: "custom",
          includePaths: ["world", "plugins"],
          excludePaths: ["logs"],
          retentionCount: 3,
        },
      });

      expect(updated.name).toBe("Nightly");
      expect(updated.includePaths).toEqual(["world", "plugins"]);
      expect(updated.excludePaths).toEqual(["logs"]);
      expect(updated.retentionCount).toBe(3);

      backend.handle("delete_backup_profile", { profileId: profile.id });

      expect(
        backend.handle("list_backup_profiles", { serverId: server.id }),
      ).toEqual([]);
    } finally {
      backend.close();
    }
  });

  it("deletes backup archives and prunes backup profile retention", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);
    fs.mkdirSync(path.join(serverRoot, "world"), { recursive: true });
    fs.writeFileSync(path.join(serverRoot, "world", "level.dat"), "world");

    try {
      const server = createServer(backend, serverRoot);
      const backup = backend.handle("create_world_backup", {
        input: { serverId: server.id },
      });
      expect(fs.existsSync(backup.archivePath)).toBe(true);

      backend.handle("delete_server_backup", { backupId: backup.id });

      expect(fs.existsSync(backup.archivePath)).toBe(false);
      expect(
        backend.handle("list_server_backups", { serverId: server.id }),
      ).toEqual([]);

      const profile = backend.handle("create_backup_profile", {
        input: {
          serverId: server.id,
          name: "Keep one",
          mode: "worldOnly",
          includePaths: ["world"],
          excludePaths: [],
          retentionCount: 1,
        },
      });
      const first = backend.handle("create_profile_backup", {
        input: { profileId: profile.id },
      });
      const second = backend.handle("create_profile_backup", {
        input: { profileId: profile.id },
      });

      const backups = backend.handle("list_server_backups", {
        serverId: server.id,
      });
      expect(backups.map((item) => item.id)).toEqual([second.id]);
      expect(fs.existsSync(first.archivePath)).toBe(false);
      expect(fs.existsSync(second.archivePath)).toBe(true);
    } finally {
      backend.close();
    }
  });

  it("lists and reads latest and archived server logs", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);
    const logsDir = path.join(serverRoot, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, "latest.log"), "[INFO] ready\n");
    fs.writeFileSync(
      path.join(logsDir, "2026-07-02-1.log.gz"),
      zlib.gzipSync("[WARN] archived\n"),
    );

    try {
      const server = createServer(backend, serverRoot);
      const logs = backend.handle("list_server_logs", { serverId: server.id });

      expect(logs.logs.map((log) => log.relativePath)).toEqual([
        "logs/latest.log",
        "logs/2026-07-02-1.log.gz",
      ]);
      expect(logs.logs[0].current).toBe(true);

      expect(
        backend.handle("read_server_log", {
          serverId: server.id,
          relativePath: "logs/latest.log",
        }).content,
      ).toContain("[INFO] ready");
      expect(
        backend.handle("read_server_log", {
          serverId: server.id,
          relativePath: "logs/2026-07-02-1.log.gz",
        }).content,
      ).toContain("[WARN] archived");
    } finally {
      backend.close();
    }
  });

  it("reports first-run setup status without mutating server files", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);

    try {
      const server = createServer(backend, serverRoot);
      const status = backend.handle("get_server_setup_status", {
        serverId: server.id,
      });

      expect(status.serverId).toBe(server.id);
      expect(status.checks.map((check) => check.id)).toEqual([
        "java",
        "serverRuntime",
        "eula",
        "backup",
      ]);
      expect(status.serverRuntime).toMatchObject({
        status: "actionRequired",
        exists: false,
        fileName: "server.jar",
      });
      expect(status.eula).toMatchObject({
        status: "actionRequired",
        exists: false,
        accepted: false,
        fileName: "eula.txt",
      });
      expect(status.backup).toMatchObject({
        status: "warning",
        count: 0,
      });
      expect(fs.existsSync(path.join(serverRoot, "server.jar"))).toBe(false);
      expect(fs.existsSync(path.join(serverRoot, "eula.txt"))).toBe(false);
    } finally {
      backend.close();
    }
  });

  it("marks jar, EULA, and backup setup checks ready when the user completed them", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);
    fs.writeFileSync(path.join(serverRoot, "server.jar"), "jar");
    fs.writeFileSync(path.join(serverRoot, "eula.txt"), "eula=true\n");
    fs.mkdirSync(path.join(serverRoot, "world"), { recursive: true });
    fs.writeFileSync(path.join(serverRoot, "world", "level.dat"), "world");

    try {
      const server = createServer(backend, serverRoot);
      backend.handle("create_world_backup", { input: { serverId: server.id } });
      const status = backend.handle("get_server_setup_status", {
        serverId: server.id,
      });

      expect(status.serverRuntime).toMatchObject({
        status: "ready",
        exists: true,
      });
      expect(status.serverJar).toMatchObject({
        status: "ready",
        fileName: "server.jar",
      });
      expect(status.eula).toMatchObject({
        status: "ready",
        exists: true,
        accepted: true,
      });
      expect(status.backup).toMatchObject({
        status: "ready",
        count: 1,
      });
    } finally {
      backend.close();
    }
  });

  it("marks a validated argument-file server runtime ready without server.jar", async () => {
    const backend = createTestBackend();
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcsm-runtime-ready-"),
    );
    tempDirs.push(parent);
    const targetDir = path.join(parent, "server");

    try {
      const server = await createProvisionedServer(backend, targetDir, {
        executable: { kind: "java" },
        jvmArgs: ["@user_jvm_args.txt", "@libraries/forge/win_args.txt"],
        serverArgs: ["nogui"],
        workingDirectory: ".",
      });
      fs.mkdirSync(path.join(targetDir, "libraries/forge"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(targetDir, "user_jvm_args.txt"), "");
      fs.writeFileSync(
        path.join(targetDir, "libraries/forge/win_args.txt"),
        "",
      );

      const status = backend.handle("get_server_setup_status", {
        serverId: server.id,
      });

      expect(status.serverRuntime).toMatchObject({
        id: "serverRuntime",
        status: "ready",
        exists: true,
        kind: "structured",
      });
      expect(status.serverJar).toMatchObject({ status: "ready" });
      expect(fs.existsSync(path.join(targetDir, "server.jar"))).toBe(false);
    } finally {
      backend.close();
    }
  });

  it("exports backup folders and keeps restore targets inside the server root", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-export-"));
    tempDirs.push(serverRoot, exportRoot);
    fs.mkdirSync(path.join(serverRoot, "world"), { recursive: true });
    fs.writeFileSync(path.join(serverRoot, "world", "level.dat"), "world");

    try {
      const server = createServer(backend, serverRoot);
      const backup = backend.handle("create_world_backup", {
        input: { serverId: server.id },
      });
      const exported = backend.handle("export_server_backup", {
        input: { backupId: backup.id, targetDir: exportRoot },
      });

      expect(
        fs.existsSync(path.join(exported.exportedPath, "world", "level.dat")),
      ).toBe(true);
      fs.writeFileSync(path.join(serverRoot, "world", "stale.dat"), "stale");
      backend.handle("restore_world_backup", {
        input: {
          backupId: backup.id,
          targetWorldDir: "world",
          confirm: true,
        },
      });

      expect(
        fs.readFileSync(path.join(serverRoot, "world", "level.dat"), "utf8"),
      ).toBe("world");
      expect(fs.existsSync(path.join(serverRoot, "world", "stale.dat"))).toBe(
        false,
      );
      expect(() =>
        backend.handle("restore_world_backup", {
          input: {
            backupId: backup.id,
            targetWorldDir: path.join(os.tmpdir(), "outside-world"),
            confirm: true,
          },
        }),
      ).toThrow(/path escapes server root/);
      expect(() =>
        backend.handle("restore_world_backup", {
          input: {
            backupId: backup.id,
            targetWorldDir: ".",
            confirm: true,
          },
        }),
      ).toThrow(/restore target must be a world folder/);
      expect(fs.existsSync(path.join(serverRoot, "world", "level.dat"))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(backup.archivePath, "world"))).toBe(true);
      expect(() =>
        backend.handle("restore_world_backup", {
          input: {
            backupId: backup.id,
            targetWorldDir: "backups",
            confirm: true,
          },
        }),
      ).toThrow(/restore target must not overlap backup storage/);
    } finally {
      backend.close();
    }
  });

  it("rejects world restore while the server is running", async () => {
    const child = createFakeChild(7124);
    const backend = createTestBackend({ spawn: vi.fn(() => child) });
    const serverRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcsm-live-restore-"),
    );
    tempDirs.push(serverRoot);
    fs.mkdirSync(path.join(serverRoot, "world"), { recursive: true });
    fs.writeFileSync(
      path.join(serverRoot, "world", "level.dat"),
      "backup-state",
    );
    fs.writeFileSync(path.join(serverRoot, "server.jar"), "jar");

    try {
      const server = createServer(backend, serverRoot);
      const backup = backend.handle("create_world_backup", {
        input: { serverId: server.id },
      });
      fs.writeFileSync(
        path.join(serverRoot, "world", "level.dat"),
        "live-state",
      );
      await backend.handle("start_server", { serverId: server.id });

      expect(() =>
        backend.handle("restore_world_backup", {
          input: {
            backupId: backup.id,
            targetWorldDir: "world",
            confirm: true,
          },
        }),
      ).toThrow(expect.objectContaining({ code: "SERVER_MUST_BE_STOPPED" }));
      expect(
        fs.readFileSync(path.join(serverRoot, "world", "level.dat"), "utf8"),
      ).toBe("live-state");
    } finally {
      backend.close();
    }
  });

  it("initializes the database schema version for future migrations", () => {
    const backend = createTestBackend();

    try {
      expect(backend.handle("get_database_schema_version")).toEqual({
        version: 2,
      });
    } finally {
      backend.close();
    }
  });

  it.each([0, 1, 2])(
    "migrates legacy profiles marked as schema version %i and accepts Quilt profiles",
    (legacyVersion) => {
      const appDataDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "mcsm-schema-v1-"),
      );
      tempDirs.push(appDataDir);
      const databasePath = path.join(appDataDir, "mc-server-manager.sqlite");
      const legacyDb = new DatabaseSync(databasePath);
      legacyDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_dir TEXT NOT NULL,
        minecraft_version TEXT,
        loader_type TEXT NOT NULL CHECK (loader_type IN ('vanilla', 'paper', 'forge', 'neoforge', 'fabric')),
        loader_version TEXT,
        java_path TEXT,
        server_port INTEGER,
        min_memory_mb INTEGER,
        max_memory_mb INTEGER,
        auto_start INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE server_restart_policies (
        server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        cooldown_seconds INTEGER NOT NULL
      );
      INSERT INTO servers (
        id, name, root_dir, minecraft_version, loader_type, loader_version,
        java_path, server_port, min_memory_mb, max_memory_mb, auto_start,
        created_at, updated_at
      ) VALUES (
        'legacy-paper', 'Legacy Paper', 'C:/Servers/Legacy', '1.21.4',
        'paper', '120', NULL, 25565, 1024, 4096, 0,
        '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
      );
      INSERT INTO server_restart_policies
        (server_id, enabled, max_attempts, cooldown_seconds)
      VALUES ('legacy-paper', 1, 3, 30);
      PRAGMA user_version = ${legacyVersion};
    `);
      legacyDb.close();

      const backend = createBackend({ getPath: () => appDataDir });
      const quiltRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-quilt-"));
      tempDirs.push(quiltRoot);

      try {
        expect(backend.handle("get_database_schema_version")).toEqual({
          version: 2,
        });
        expect(backend.handle("list_server_profiles")).toContainEqual(
          expect.objectContaining({
            id: "legacy-paper",
            name: "Legacy Paper",
            loaderType: "paper",
            loaderVersion: "120",
            serverPort: 25565,
            minMemoryMb: 1024,
            maxMemoryMb: 4096,
          }),
        );
        expect(createServer(backend, quiltRoot, "quilt")).toMatchObject({
          loaderType: "quilt",
        });
      } finally {
        backend.close();
      }

      const migratedDb = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const columns = migratedDb.prepare("PRAGMA table_info(servers)").all();
        expect(columns.map((column) => column.name)).toEqual(
          expect.arrayContaining([
            "launch_spec_json",
            "compatibility_warning_json",
          ]),
        );
        const legacyRow = migratedDb
          .prepare("SELECT launch_spec_json FROM servers WHERE id = ?")
          .get("legacy-paper");
        expect(legacyRow.launch_spec_json).toBeNull();
        const tables = migratedDb
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => row.name);
        expect(tables).toEqual(
          expect.arrayContaining([
            "provisioning_jobs",
            "server_sources",
            "server_eula_acceptances",
          ]),
        );
      } finally {
        migratedDb.close();
      }
    },
  );

  it("maps whitelist player actions to fixed server commands", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);

    try {
      const server = createServer(backend, serverRoot);
      expect(() =>
        backend.handle("apply_player_action", {
          input: {
            serverId: server.id,
            player: "Alex",
            action: "whitelistAdd",
          },
        }),
      ).toThrow(/server process is not running/);
    } finally {
      backend.close();
    }
  });

  it("updates server profile restart policy", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);

    try {
      const server = createServer(backend, serverRoot);

      const updated = backend.handle("update_server_profile", {
        input: {
          id: server.id,
          name: "Runtime tuned",
          restartPolicy: {
            enabled: false,
            maxAttempts: 0,
            cooldownSeconds: 5,
          },
        },
      });

      expect(updated.name).toBe("Runtime tuned");
      expect(updated.restartPolicy).toEqual({
        enabled: false,
        maxAttempts: 0,
        cooldownSeconds: 5,
      });
    } finally {
      backend.close();
    }
  });

  it("updates only requested server properties and preserves pack-owned content", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcsm-guided-properties-"),
    );
    tempDirs.push(serverRoot);
    fs.writeFileSync(
      path.join(serverRoot, "server.properties"),
      "# pack configuration\nmotd=Original\ncustom-pack-setting=keep\nview-distance=10\n",
    );

    try {
      const server = createServer(backend, serverRoot);
      const saved = backend.handle("save_server_properties", {
        input: {
          serverId: server.id,
          updates: [{ key: "motd", value: "Updated", known: true }],
        },
      });

      expect(saved.restartRequired).toBe(true);
      expect(saved.raw).toBe(
        "# pack configuration\nmotd=Updated\ncustom-pack-setting=keep\nview-distance=10\n",
      );

      backend.handle("save_server_properties", {
        input: {
          serverId: server.id,
          updates: [{ key: "server-port", value: "25570", known: true }],
        },
      });
      expect(
        backend
          .handle("list_server_profiles")
          .find((item) => item.id === server.id),
      ).toMatchObject({ serverPort: 25570 });
    } finally {
      backend.close();
    }
  });

  it("keeps profile port changes synchronized with server.properties", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcsm-profile-port-"),
    );
    tempDirs.push(serverRoot);
    fs.writeFileSync(
      path.join(serverRoot, "server.properties"),
      "server-port=25565\ncustom-pack-setting=keep\n",
    );

    try {
      const server = createServer(backend, serverRoot);
      backend.handle("update_server_profile", {
        input: { id: server.id, serverPort: 25571 },
      });

      expect(
        fs.readFileSync(path.join(serverRoot, "server.properties"), "utf8"),
      ).toBe("server-port=25571\ncustom-pack-setting=keep\n");
    } finally {
      backend.close();
    }
  });

  it("samples measured process, player, restart, uptime, and disk metrics without inventing TPS", async () => {
    const children = [];
    const spawnImpl = vi.fn(() => {
      const child = createFakeChild(23000 + children.length);
      children.push(child);
      return child;
    });
    const collectProcessMetrics = vi.fn(() => ({
      cpuPercent: 12.5,
      memoryMb: 768,
    }));
    const backend = createTestBackend({
      spawn: spawnImpl,
      collectProcessMetrics,
    });
    const serverRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcsm-honest-metrics-"),
    );
    tempDirs.push(serverRoot);
    fs.writeFileSync(path.join(serverRoot, "server.jar"), "jar");

    try {
      const server = createServer(backend, serverRoot);
      await backend.handle("start_server", { serverId: server.id });
      children[0].emit("exit", 0);
      await backend.handle("start_server", { serverId: server.id });
      children[1].stdout.emit(
        "data",
        "[Server thread/INFO]: Alex joined the game\n",
      );

      const sample = await backend.handle("sample_server_metrics", {
        serverId: server.id,
      });

      expect(collectProcessMetrics).toHaveBeenCalledWith(23001);
      expect(sample).toMatchObject({
        cpuPercent: 12.5,
        memoryMb: 768,
        diskFreeMb: expect.any(Number),
        uptimeSeconds: expect.any(Number),
        restartCount: 1,
        playerCount: 1,
        tps: null,
        unavailableReasons: { tps: "TPS_PROVIDER_UNAVAILABLE" },
      });
      expect(
        backend.handle("get_performance_history", { serverId: server.id })
          .samples[0],
      ).toMatchObject({
        cpuPercent: 12.5,
        memoryMb: 768,
        playerCount: 1,
        tps: null,
        unavailableReasons: { tps: "TPS_PROVIDER_UNAVAILABLE" },
      });
    } finally {
      backend.close();
    }
  });

  describe("launch specification process contract", () => {
    it("persists managed processes as stopped when the backend closes", async () => {
      const appDataDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "mcsm-close-process-"),
      );
      const serverRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "mcsm-close-server-"),
      );
      tempDirs.push(appDataDir, serverRoot);
      fs.writeFileSync(path.join(serverRoot, "server.jar"), "jar");
      const app = {
        getPath: () => appDataDir,
        spawn: vi.fn(() => createFakeChild(18989)),
        checkPortAvailable: async () => true,
      };
      const backend = createBackend(app);
      const server = createServer(backend, serverRoot);
      await backend.handle("start_server", { serverId: server.id });

      backend.close();

      const reopened = createBackend(app);
      try {
        expect(
          reopened.handle("get_server_process_status", { serverId: server.id }),
        ).toMatchObject({ status: "stopped" });
      } finally {
        reopened.close();
      }
    });

    it("rejects start when the operating-system port probe reports a conflict", async () => {
      const spawnImpl = vi.fn(() => createFakeChild(18990));
      const checkPortAvailable = vi.fn(async () => false);
      const backend = createTestBackend({
        spawn: spawnImpl,
        checkPortAvailable,
      });
      const serverRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "mcsm-port-busy-"),
      );
      tempDirs.push(serverRoot);
      fs.writeFileSync(path.join(serverRoot, "server.jar"), "jar");

      try {
        const server = createServer(backend, serverRoot);

        await expect(
          backend.handle("start_server", { serverId: server.id }),
        ).rejects.toMatchObject({ code: "SERVER_PORT_IN_USE" });
        expect(checkPortAvailable).toHaveBeenCalledWith(25565);
        expect(spawnImpl).not.toHaveBeenCalled();
      } finally {
        backend.close();
      }
    });

    it("rejects two active managed servers configured on the same port", async () => {
      const spawnImpl = vi.fn(() => createFakeChild(18991));
      const backend = createTestBackend({
        spawn: spawnImpl,
        checkPortAvailable: vi.fn(async () => true),
      });
      const firstRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "mcsm-port-first-"),
      );
      const secondRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "mcsm-port-second-"),
      );
      tempDirs.push(firstRoot, secondRoot);
      fs.writeFileSync(path.join(firstRoot, "server.jar"), "jar");
      fs.writeFileSync(path.join(secondRoot, "server.jar"), "jar");

      try {
        const first = createServer(backend, firstRoot);
        const second = createServer(backend, secondRoot);
        await backend.handle("start_server", { serverId: first.id });

        await expect(
          backend.handle("start_server", { serverId: second.id }),
        ).rejects.toMatchObject({ code: "SERVER_PORT_IN_USE" });
        expect(spawnImpl).toHaveBeenCalledTimes(1);
      } finally {
        backend.close();
      }
    });

    it("rejects concurrent starts of the same server before the port probe completes", async () => {
      let releaseFirstProbe;
      const checkPortAvailable = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseFirstProbe = resolve;
            }),
        )
        .mockResolvedValue(true);
      const spawnImpl = vi.fn(() => createFakeChild(18992));
      const backend = createTestBackend({
        spawn: spawnImpl,
        checkPortAvailable,
      });
      const serverRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "mcsm-concurrent-start-"),
      );
      tempDirs.push(serverRoot);
      fs.writeFileSync(path.join(serverRoot, "server.jar"), "jar");

      try {
        const server = createServer(backend, serverRoot);
        const firstStart = backend.handle("start_server", {
          serverId: server.id,
        });
        await vi.waitFor(() =>
          expect(checkPortAvailable).toHaveBeenCalledTimes(1),
        );

        const secondStart = backend.handle("start_server", {
          serverId: server.id,
        });
        releaseFirstProbe(true);

        await expect(secondStart).rejects.toMatchObject({
          code: "SERVER_ALREADY_RUNNING",
        });
        await firstStart;
        expect(spawnImpl).toHaveBeenCalledTimes(1);
      } finally {
        backend.close();
      }
    });

    it("starts a structured jar launch specification with exact safe spawn options", async () => {
      const spawnImpl = vi.fn(() => createFakeChild(19001));
      const backend = createTestBackend({ spawn: spawnImpl });
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-launch-jar-"));
      tempDirs.push(parent);
      const targetDir = path.join(parent, "server");

      try {
        const server = await createProvisionedServer(backend, targetDir, {
          executable: { kind: "java" },
          jvmArgs: ["-jar", "server.jar"],
          serverArgs: ["nogui"],
          workingDirectory: ".",
        });
        fs.writeFileSync(path.join(targetDir, "server.jar"), "jar");

        await backend.handle("start_server", { serverId: server.id });

        expect(spawnImpl).toHaveBeenCalledWith(
          server.javaPath,
          ["-Xms1024M", "-Xmx2048M", "-jar", "server.jar", "nogui"],
          {
            cwd: targetDir,
            env: process.env,
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          },
        );
      } finally {
        backend.close();
      }
    });

    it("starts an argument-file launch specification with memory flags first", async () => {
      const spawnImpl = vi.fn(() => createFakeChild(19002));
      const backend = createTestBackend({ spawn: spawnImpl });
      const parent = fs.mkdtempSync(
        path.join(os.tmpdir(), "mcsm-launch-args-"),
      );
      tempDirs.push(parent);
      const targetDir = path.join(parent, "server");

      try {
        const server = await createProvisionedServer(backend, targetDir, {
          executable: { kind: "java" },
          jvmArgs: [
            "@user_jvm_args.txt",
            "@libraries/net/minecraftforge/forge/1.21.4/win_args.txt",
          ],
          serverArgs: ["nogui"],
          workingDirectory: ".",
        });
        fs.mkdirSync(
          path.join(targetDir, "libraries/net/minecraftforge/forge/1.21.4"),
          { recursive: true },
        );
        fs.writeFileSync(path.join(targetDir, "user_jvm_args.txt"), "");
        fs.writeFileSync(
          path.join(
            targetDir,
            "libraries/net/minecraftforge/forge/1.21.4/win_args.txt",
          ),
          "",
        );

        await backend.handle("start_server", { serverId: server.id });

        expect(spawnImpl).toHaveBeenCalledWith(
          server.javaPath,
          [
            "-Xms1024M",
            "-Xmx2048M",
            "@user_jvm_args.txt",
            "@libraries/net/minecraftforge/forge/1.21.4/win_args.txt",
            "nogui",
          ],
          expect.objectContaining({ cwd: targetDir, shell: false }),
        );
      } finally {
        backend.close();
      }
    });

    it.each([
      [["-jar", "server.jar && calc.exe"], "shell operators"],
      [["@../outside.txt"], "target traversal"],
      [["-Dvalue=bad\nnext"], "line breaks"],
      [["-jar"], "missing jar file"],
      [["@"], "empty argument-file reference"],
    ])(
      "rejects malformed launch specification arguments: %s",
      async (jvmArgs) => {
        const spawnImpl = vi.fn(() => createFakeChild(19003));
        const backend = createTestBackend({ spawn: spawnImpl });
        const parent = fs.mkdtempSync(
          path.join(os.tmpdir(), "mcsm-launch-bad-"),
        );
        tempDirs.push(parent);
        const targetDir = path.join(parent, "server");

        try {
          const server = await createProvisionedServer(backend, targetDir, {
            executable: { kind: "java" },
            jvmArgs,
            serverArgs: ["nogui"],
            workingDirectory: ".",
          });

          await expect(
            backend.handle("start_server", { serverId: server.id }),
          ).rejects.toThrow(/launch specification/i);
          expect(spawnImpl).not.toHaveBeenCalled();
        } finally {
          backend.close();
        }
      },
    );

    it("keeps legacy server.jar profiles startable without a launch specification", async () => {
      const spawnImpl = vi.fn(() => createFakeChild(19004));
      const backend = createTestBackend({ spawn: spawnImpl });
      const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-legacy-"));
      tempDirs.push(serverRoot);
      fs.writeFileSync(path.join(serverRoot, "server.jar"), "jar");

      try {
        const server = createServer(backend, serverRoot);
        await backend.handle("start_server", { serverId: server.id });

        expect(spawnImpl).toHaveBeenCalledWith(
          "java",
          [
            "-Xms1024M",
            "-Xmx4096M",
            "-jar",
            path.join(serverRoot, "server.jar"),
            "nogui",
          ],
          expect.objectContaining({ cwd: serverRoot, shell: false }),
        );
      } finally {
        backend.close();
      }
    });

    it("rejects a configured Java path that is not an installed executable", async () => {
      const spawnImpl = vi.fn(() => createFakeChild(19005));
      const backend = createTestBackend({ spawn: spawnImpl });
      const parent = fs.mkdtempSync(
        path.join(os.tmpdir(), "mcsm-launch-java-"),
      );
      tempDirs.push(parent);
      const targetDir = path.join(parent, "server");

      try {
        const server = await createProvisionedServer(backend, targetDir, {
          executable: { kind: "java" },
          jvmArgs: ["-jar", "server.jar"],
          serverArgs: ["nogui"],
          workingDirectory: ".",
        });
        fs.writeFileSync(path.join(targetDir, "server.jar"), "jar");
        backend.handle("update_server_profile", {
          input: {
            id: server.id,
            javaPath: path.join(parent, "missing", "java.exe"),
          },
        });

        await expect(
          backend.handle("start_server", { serverId: server.id }),
        ).rejects.toThrow(/Java executable/i);
        expect(spawnImpl).not.toHaveBeenCalled();
      } finally {
        backend.close();
      }
    });
  });

  it("auto restarts a managed server after the Java process exits crashed", async () => {
    vi.useFakeTimers();
    const children = [];
    const spawnImpl = vi.fn(() => {
      const child = createFakeChild(18000 + children.length);
      children.push(child);
      return child;
    });
    const backend = createTestBackend({ spawn: spawnImpl });
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);
    fs.writeFileSync(path.join(serverRoot, "server.jar"), "jar");

    try {
      const server = createServer(backend, serverRoot);
      backend.handle("update_server_profile", {
        input: {
          id: server.id,
          restartPolicy: {
            enabled: true,
            maxAttempts: 2,
            cooldownSeconds: 1,
          },
        },
      });

      await backend.handle("start_server", { serverId: server.id });
      expect(spawnImpl).toHaveBeenCalledTimes(1);

      children[0].emit("exit", 1);
      expect(
        backend.handle("get_server_process_status", { serverId: server.id }),
      ).toMatchObject({ status: "crashed" });

      await vi.advanceTimersByTimeAsync(1000);

      expect(spawnImpl).toHaveBeenCalledTimes(2);
      expect(
        backend.handle("get_server_process_status", { serverId: server.id }),
      ).toMatchObject({ status: "running", pid: 18001 });
      expect(
        backend
          .handle("list_process_events", { serverId: server.id })
          .some((event) => event.message.includes("Auto restarting")),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
      backend.close();
    }
  });

  it("auto restarts a managed server when crash output appears but the process stays open", async () => {
    vi.useFakeTimers();
    const children = [];
    const spawnImpl = vi.fn(() => {
      const child = createFakeChild(19000 + children.length);
      children.push(child);
      return child;
    });
    const backend = createTestBackend({ spawn: spawnImpl });
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);
    fs.writeFileSync(path.join(serverRoot, "server.jar"), "jar");

    try {
      const server = createServer(backend, serverRoot);
      backend.handle("update_server_profile", {
        input: {
          id: server.id,
          restartPolicy: {
            enabled: true,
            maxAttempts: 2,
            cooldownSeconds: 1,
          },
        },
      });

      await backend.handle("start_server", { serverId: server.id });
      expect(spawnImpl).toHaveBeenCalledTimes(1);

      children[0].stdout.emit(
        "data",
        "[Server thread/ERROR]: Encountered an unexpected exception\n",
      );
      expect(children[0].kill).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);

      expect(spawnImpl).toHaveBeenCalledTimes(2);
      expect(
        backend.handle("get_server_process_status", { serverId: server.id }),
      ).toMatchObject({ status: "running", pid: 19001 });
      expect(
        backend
          .handle("list_process_events", { serverId: server.id })
          .some((event) => event.message.includes("Crash signature detected")),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
      backend.close();
    }
  });

  it("waits for the old managed process to exit before manual restart starts a replacement", async () => {
    const children = [];
    const spawnImpl = vi.fn(() => {
      const child = createFakeChild(20000 + children.length);
      children.push(child);
      return child;
    });
    const backend = createTestBackend({ spawn: spawnImpl });
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);
    fs.writeFileSync(path.join(serverRoot, "server.jar"), "jar");

    try {
      const server = createServer(backend, serverRoot);
      await backend.handle("start_server", { serverId: server.id });
      expect(spawnImpl).toHaveBeenCalledTimes(1);

      const restartPromise = backend.handle("restart_server", {
        serverId: server.id,
      });

      expect(children[0].stdin.writes).toContain("stop\n");
      expect(spawnImpl).toHaveBeenCalledTimes(1);

      children[0].emit("exit", 0);
      await restartPromise;

      expect(spawnImpl).toHaveBeenCalledTimes(2);
      expect(
        backend.handle("get_server_process_status", { serverId: server.id }),
      ).toMatchObject({ status: "running", pid: 20001 });
    } finally {
      backend.close();
    }
  });

  it("schedules restart countdown broadcasts before restarting a running server", async () => {
    vi.useFakeTimers();
    const children = [];
    const spawnImpl = vi.fn(() => {
      const child = createFakeChild(21000 + children.length);
      children.push(child);
      return child;
    });
    const backend = createTestBackend({ spawn: spawnImpl });
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);
    fs.writeFileSync(path.join(serverRoot, "server.jar"), "jar");

    try {
      const server = createServer(backend, serverRoot);
      await backend.handle("start_server", { serverId: server.id });

      const scheduled = await backend.handle("restart_server_with_countdown", {
        input: {
          serverId: server.id,
          stepsSeconds: [2, 1],
          messageTemplate: "Restarting in {time}",
        },
      });

      expect(scheduled).toMatchObject({
        serverId: server.id,
        stepsSeconds: [2, 1],
      });
      expect(children[0].stdin.writes).toEqual([
        "say Restarting in 2 seconds\n",
      ]);

      await vi.advanceTimersByTimeAsync(1000);
      expect(children[0].stdin.writes).toContain(
        "say Restarting in 1 second\n",
      );
      expect(spawnImpl).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(children[0].stdin.writes).toContain("stop\n");
      children[0].emit("exit", 0);
      await vi.runOnlyPendingTimersAsync();

      expect(spawnImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      backend.close();
    }
  });

  it("installs a local server jar and records rollback history", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    const downloadDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcsm-download-"),
    );
    tempDirs.push(serverRoot, downloadDir);
    const sourceJar = path.join(downloadDir, "paper.jar");
    fs.writeFileSync(sourceJar, "new jar");
    const checksum = createHash("sha256")
      .update(fs.readFileSync(sourceJar))
      .digest("hex");

    try {
      const server = createServer(backend, serverRoot);
      const history = backend.handle("install_server_update", {
        input: {
          serverId: server.id,
          targetVersion: "1.21.5",
          targetLoaderVersion: "125",
          serverJarPath: sourceJar,
          serverJarSha256: checksum,
          confirm: true,
        },
      });

      expect(fs.readFileSync(path.join(serverRoot, "server.jar"), "utf8")).toBe(
        "new jar",
      );
      expect(history).toMatchObject({
        serverId: server.id,
        loaderType: "paper",
        toVersion: "1.21.5",
        status: "installed",
      });
      const updated = backend.handle("list_server_profiles")[0];
      expect(updated.minecraftVersion).toBe("1.21.5");
      expect(updated.loaderVersion).toBe("125");
    } finally {
      backend.close();
    }
  });

  it("reenables disabled installed content", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-content-"));
    tempDirs.push(serverRoot, sourceDir);
    const sourcePath = path.join(sourceDir, "sample.jar");
    fs.writeFileSync(sourcePath, "sample");

    try {
      const server = createServer(backend, serverRoot, "fabric");
      const content = backend.handle("import_local_content", {
        input: { serverId: server.id, sourcePath },
      });

      const disabled = backend.handle("disable_installed_content", {
        input: { serverId: server.id, contentId: content.id },
      });
      expect(disabled.installedPath.endsWith(".disabled")).toBe(true);

      const enabled = backend.handle("enable_installed_content", {
        input: { serverId: server.id, contentId: content.id },
      });

      expect(enabled.installedPath.endsWith(".disabled")).toBe(false);
      expect(fs.existsSync(enabled.installedPath)).toBe(true);
    } finally {
      backend.close();
    }
  });

  it("checks and manually installs updates for installed Modrinth content", async () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);
    const server = createServer(backend, serverRoot, "fabric");
    globalThis.fetch = vi.fn(async (url) => {
      const href = String(url);
      if (href.endsWith("/project/main-project/version")) {
        return jsonResponse([
          {
            id: "latest-version",
            project_id: "main-project",
            name: "Main Mod",
            version_number: "2.0.0",
            loaders: ["fabric"],
            game_versions: ["1.21.4"],
            files: [
              {
                filename: "main-2.jar",
                size: 6,
                primary: true,
                url: "https://cdn.modrinth.com/main-2.jar",
              },
            ],
            dependencies: [],
          },
          {
            id: "current-version",
            project_id: "main-project",
            name: "Main Mod",
            version_number: "1.0.0",
            loaders: ["fabric"],
            game_versions: ["1.21.4"],
            files: [
              {
                filename: "main-1.jar",
                size: 6,
                primary: true,
                url: "https://cdn.modrinth.com/main-1.jar",
              },
            ],
            dependencies: [],
          },
        ]);
      }
      if (href === "https://cdn.modrinth.com/main-1.jar") {
        return binaryResponse("old");
      }
      if (href === "https://cdn.modrinth.com/main-2.jar") {
        return binaryResponse("new");
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    try {
      const installed = await backend.handle("install_modrinth_version", {
        input: {
          serverId: server.id,
          projectId: "main-project",
          versionId: "current-version",
        },
      });

      const plan = await backend.handle("check_content_updates", {
        input: { serverId: server.id },
      });

      expect(plan.updates).toMatchObject([
        {
          installedContentId: installed.content.id,
          currentVersion: "1.0.0",
          latestVersion: "2.0.0",
          provider: "modrinth",
        },
      ]);

      const result = await backend.handle("install_content_update", {
        input: {
          serverId: server.id,
          installedContentId: installed.content.id,
        },
      });

      expect(result.content.version).toBe("2.0.0");
      expect(fs.existsSync(path.join(serverRoot, "mods", "main-2.jar"))).toBe(
        true,
      );
      expect(fs.existsSync(installed.content.installedPath)).toBe(false);
      expect(fs.existsSync(result.backupPath)).toBe(true);
      expect(result.backupPath.endsWith(".mcsm-backup")).toBe(true);
    } finally {
      backend.close();
    }
  });

  it("updates, disables, and deletes scheduled tasks", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);

    try {
      const server = createServer(backend, serverRoot);
      const task = backend.handle("create_scheduled_task", {
        input: {
          serverId: server.id,
          name: "Restart",
          kind: "restart",
          intervalMinutes: 60,
        },
      });

      const updated = backend.handle("update_scheduled_task", {
        input: {
          id: task.id,
          name: "Safe restart",
          kind: "command",
          command: "say restarting",
          intervalMinutes: 120,
          enabled: false,
        },
      });

      expect(updated.name).toBe("Safe restart");
      expect(updated.command).toBe("say restarting");
      expect(updated.intervalMinutes).toBe(120);
      expect(updated.enabled).toBe(0);

      backend.handle("delete_scheduled_task", { taskId: task.id });

      expect(
        backend.handle("list_scheduled_tasks", { serverId: server.id }),
      ).toEqual([]);
    } finally {
      backend.close();
    }
  });

  it("runs due scheduled tasks and records failures", async () => {
    const { appDataDir, backend } = createTestBackendWithAppData();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);

    try {
      const server = createServer(backend, serverRoot);
      const task = backend.handle("create_scheduled_task", {
        input: {
          serverId: server.id,
          name: "Start missing jar",
          kind: "start",
          intervalMinutes: 60,
        },
      });
      const db = new DatabaseSync(
        path.join(appDataDir, "mc-server-manager.sqlite"),
      );
      try {
        db.prepare(
          "UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?",
        ).run(new Date(Date.now() - 60_000).toISOString(), task.id);
      } finally {
        db.close();
      }

      const runs = await backend.handle("run_due_scheduled_tasks");

      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        taskId: task.id,
        serverId: server.id,
        status: "failed",
      });
      expect(runs[0].message).toMatch(/server\.jar does not exist/);
      expect(
        backend.handle("list_scheduled_task_runs", { serverId: server.id }),
      ).toHaveLength(1);
    } finally {
      backend.close();
    }
  });

  it("lists and removes tunnel bindings", () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);

    try {
      const server = createServer(backend, serverRoot);
      const provider = backend.handle("create_tunnel_provider", {
        input: {
          name: "Ngrok",
          kind: "custom",
          command: "ngrok tcp 25565",
        },
      });

      backend.handle("bind_tunnel_to_server", {
        input: { providerId: provider.id, serverId: server.id },
      });

      expect(backend.handle("list_tunnel_bindings")).toMatchObject([
        {
          providerId: provider.id,
          serverId: server.id,
          providerName: "Ngrok",
          serverName: server.name,
        },
      ]);

      backend.handle("unbind_tunnel_from_server", {
        input: { providerId: provider.id, serverId: server.id },
      });

      expect(backend.handle("list_tunnel_bindings")).toEqual([]);
    } finally {
      backend.close();
    }
  });
});

describe("Electron backend marketplace installation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.CURSEFORGE_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalCurseForgeApiKey === undefined) {
      delete process.env.CURSEFORGE_API_KEY;
    } else {
      process.env.CURSEFORGE_API_KEY = originalCurseForgeApiKey;
    }
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { force: true, recursive: true });
    }
  });

  it("downloads a Modrinth version and required dependencies into the server", async () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);
    const server = createServer(backend, serverRoot, "fabric");
    const fetchMock = vi.fn(async (url) => {
      const href = String(url);
      if (href.endsWith("/project/main-project/version")) {
        return jsonResponse([
          {
            id: "main-version",
            project_id: "main-project",
            name: "Main Pack",
            version_number: "1.0.0",
            loaders: ["fabric"],
            game_versions: ["1.21.4"],
            files: [
              {
                filename: "main-pack.jar",
                size: 4,
                primary: true,
                url: "https://cdn.modrinth.com/main-pack.jar",
              },
            ],
            dependencies: [
              {
                project_id: "dependency-project",
                version_id: "dependency-version",
                dependency_type: "required",
              },
            ],
          },
        ]);
      }
      if (href.endsWith("/version/dependency-version")) {
        return jsonResponse({
          id: "dependency-version",
          project_id: "dependency-project",
          name: "Dependency",
          version_number: "2.0.0",
          loaders: ["fabric"],
          game_versions: ["1.21.4"],
          files: [
            {
              filename: "dependency.jar",
              size: 3,
              primary: true,
              url: "https://cdn.modrinth.com/dependency.jar",
            },
          ],
          dependencies: [],
        });
      }
      if (href === "https://cdn.modrinth.com/main-pack.jar") {
        return binaryResponse("main");
      }
      if (href === "https://cdn.modrinth.com/dependency.jar") {
        return binaryResponse("dep");
      }
      throw new Error(`unexpected fetch ${href}`);
    });
    globalThis.fetch = fetchMock;

    try {
      const result = await backend.handle("install_modrinth_version", {
        input: {
          serverId: server.id,
          projectId: "main-project",
          versionId: "main-version",
        },
      });

      expect(result.content.name).toBe("Main Pack");
      expect(result.dependencies).toHaveLength(1);
      expect(
        fs.existsSync(path.join(serverRoot, "mods", "main-pack.jar")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(serverRoot, "mods", "dependency.jar")),
      ).toBe(true);
      expect(
        backend.handle("list_installed_content", { serverId: server.id }),
      ).toHaveLength(2);
    } finally {
      backend.close();
    }
  });

  it("downloads a Hangar plugin version into a Paper server", async () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);
    const server = createServer(backend, serverRoot, "paper");
    globalThis.fetch = vi.fn(async (url) => {
      const href = String(url);
      if (href.endsWith("/api/v1/projects/ViaVersion/ViaVersion/versions")) {
        return jsonResponse({
          result: [{ name: "5.0.0", description: "Stable" }],
        });
      }
      if (
        href.endsWith(
          "/api/v1/projects/ViaVersion/ViaVersion/versions/5.0.0/PAPER/download",
        )
      ) {
        return binaryResponse("hangar");
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    try {
      const result = await backend.handle("install_hangar_version", {
        input: {
          serverId: server.id,
          projectId: "ViaVersion/ViaVersion",
          versionName: "5.0.0",
        },
      });

      expect(result.name).toBe("ViaVersion");
      expect(
        fs.existsSync(path.join(serverRoot, "plugins", "ViaVersion-5.0.0.jar")),
      ).toBe(true);
    } finally {
      backend.close();
    }
  });

  it("requires a CurseForge API key before using official CurseForge downloads", async () => {
    const backend = createTestBackend();

    try {
      await expect(
        backend.handle("search_curseforge_projects", {
          input: { query: "sodium" },
        }),
      ).rejects.toThrow(/CURSEFORGE_API_KEY/);
    } finally {
      backend.close();
    }
  });

  it("downloads a CurseForge file with the configured API key", async () => {
    process.env.CURSEFORGE_API_KEY = "test-key";
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);
    const server = createServer(backend, serverRoot, "forge");
    globalThis.fetch = vi.fn(async (url, options) => {
      const href = String(url);
      expect(options?.headers?.["x-api-key"]).toBe("test-key");
      if (href.endsWith("/v1/mods/123/files/456/download-url")) {
        return jsonResponse({ data: "https://edge.forgecdn.net/mod.jar" });
      }
      if (href === "https://edge.forgecdn.net/mod.jar") {
        return binaryResponse("curse");
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    try {
      const result = await backend.handle("install_curseforge_file", {
        input: {
          serverId: server.id,
          modId: 123,
          fileId: 456,
          name: "Curse Mod",
          version: "1.0.0",
          fileName: "curse-mod.jar",
        },
      });

      expect(result.name).toBe("Curse Mod");
      expect(
        fs.existsSync(path.join(serverRoot, "mods", "curse-mod.jar")),
      ).toBe(true);
    } finally {
      backend.close();
    }
  });

  it("lists BBSMC versions through the public BBSMC API", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async (url) => {
      const href = String(url);
      if (href === "https://api.bbsmc.net/v2/project/project-1/version") {
        return jsonResponse([
          {
            id: "version-1",
            project_id: "project-1",
            name: "BBSMC Pack",
            version_number: "1.0.0",
            loaders: ["fabric"],
            game_versions: ["1.21.4"],
            files: [
              {
                filename: "pack.mrpack",
                size: 12,
                primary: true,
                url: "https://cdn.bbsmc.net/files/pack.mrpack",
              },
            ],
            dependencies: [],
            disk_urls: [],
            disk_only: false,
          },
        ]);
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    try {
      const versions = await backend.handle("list_bbsmc_versions", {
        input: { projectId: "project-1" },
      });

      expect(versions[0].id).toBe("version-1");
      expect(versions[0].files[0].url).toBe(
        "https://cdn.bbsmc.net/files/pack.mrpack",
      );
    } finally {
      backend.close();
    }
  });

  it("searches BBSMC mods and modpacks with project type facets", async () => {
    const backend = createTestBackend();
    const requestedFacets = [];
    globalThis.fetch = vi.fn(async (url) => {
      const parsed = new URL(String(url));
      requestedFacets.push(JSON.parse(parsed.searchParams.get("facets")));
      if (requestedFacets.length === 1) {
        return jsonResponse({
          hits: [
            {
              project_id: "mod-1",
              slug: "bbsmc-mod",
              title: "BBSMC Mod",
              description: "A public mod",
              project_type: "mod",
              versions: ["6WawJDbL"],
              game_versions: ["1.20.1"],
              icon_url: "https://cdn.bbsmc.net/mod.webp",
              gallery: [
                {
                  url: "https://assets.bbsmc.net/mod-screen.webp",
                },
              ],
            },
          ],
        });
      }
      return jsonResponse({
        hits: [
          {
            project_id: "pack-1",
            slug: "bbsmc-pack",
            title: "BBSMC Pack",
            description: "A public modpack",
            project_type: "modpack",
            versions: ["ufr7N45P", "isDlDHcA"],
            game_versions: ["1.21.8"],
            icon_url: "https://cdn.bbsmc.net/pack.webp",
            body: [
              "<details>",
              "<summary>mod list</summary>",
              "",
              "- fabric-api.jar",
              "- lithium.jar",
              "- not-a-mod.txt",
              "</details>",
            ].join("\n"),
          },
        ],
      });
    });

    try {
      const mods = await backend.handle("search_bbsmc_projects", {
        input: { query: "ae2", projectType: "mod" },
      });
      const modpacks = await backend.handle("search_bbsmc_projects", {
        input: { query: "bff", projectType: "modpack" },
      });

      expect(requestedFacets).toEqual([
        [["project_type:mod"]],
        [["project_type:modpack"]],
      ]);
      expect(mods[0]).toMatchObject({
        id: "mod-1",
        projectType: "mod",
        gameVersions: ["1.20.1"],
        iconUrl: "https://cdn.bbsmc.net/mod.webp",
        gallery: ["https://assets.bbsmc.net/mod-screen.webp"],
        websiteUrl: "https://bbsmc.net/mod/bbsmc-mod",
      });
      expect(modpacks[0]).toMatchObject({
        id: "pack-1",
        projectType: "modpack",
        gameVersions: ["1.21.8"],
        iconUrl: "https://cdn.bbsmc.net/pack.webp",
        modCount: 2,
        websiteUrl: "https://bbsmc.net/modpack/bbsmc-pack",
      });
    } finally {
      backend.close();
    }
  });

  it("maps the BBSMC detail followers field to marketplace follows", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        project_id: "bbsmc-pack-1",
        slug: "public-pack",
        title: "Public Pack",
        project_type: "modpack",
        followers: 809,
      }),
    );

    try {
      const project = await backend.handle("get_bbsmc_project", {
        input: { projectId: "bbsmc-pack-1" },
      });

      expect(project.follows).toBe(809);
    } finally {
      backend.close();
    }
  });

  it("returns BBSMC discovery results for an empty query", async () => {
    const backend = createTestBackend();
    let requestedUrl = null;
    globalThis.fetch = vi.fn(async (url) => {
      requestedUrl = new URL(String(url));
      return jsonResponse({
        hits: [
          {
            project_id: "pack-1",
            slug: "first-pack",
            title: "First Pack",
            project_type: "modpack",
          },
          {
            project_id: "pack-2",
            slug: "second-pack",
            title: "Second Pack",
            project_type: "modpack",
          },
        ],
      });
    });

    try {
      const projects = await backend.handle("search_bbsmc_projects", {
        input: { query: "", projectType: "modpack" },
      });

      expect(requestedUrl?.searchParams.get("query")).toBe("");
      expect(JSON.parse(requestedUrl.searchParams.get("facets"))).toEqual([
        ["project_type:modpack"],
      ]);
      expect(projects.map((project) => project.id)).toEqual(["pack-1", "pack-2"]);
    } finally {
      backend.close();
    }
  });

  it("downloads a BBSMC version when it exposes a direct CDN file", async () => {
    const backend = createTestBackend();
    const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-server-"));
    tempDirs.push(serverRoot);
    const server = createServer(backend, serverRoot, "fabric");
    globalThis.fetch = vi.fn(async (url) => {
      const href = String(url);
      if (href === "https://api.bbsmc.net/v2/version/version-1") {
        return jsonResponse({
          id: "version-1",
          project_id: "project-1",
          name: "BBSMC Pack",
          version_number: "1.0.0",
          loaders: ["fabric"],
          game_versions: ["1.21.4"],
          files: [
            {
              filename: "bbsmc-pack.mrpack",
              size: 12,
              primary: true,
              url: "https://cdn.bbsmc.net/files/bbsmc-pack.mrpack",
            },
          ],
          dependencies: [],
          disk_urls: [],
          disk_only: false,
        });
      }
      if (href === "https://cdn.bbsmc.net/files/bbsmc-pack.mrpack") {
        return binaryResponse("bbsmc");
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    try {
      const result = await backend.handle("install_bbsmc_public_file", {
        input: { serverId: server.id, versionId: "version-1" },
      });

      expect(result.name).toBe("BBSMC Pack");
      expect(
        fs.existsSync(path.join(serverRoot, "mods", "bbsmc-pack.mrpack")),
      ).toBe(true);
    } finally {
      backend.close();
    }
  });

  it("rejects BBSMC cloud-disk-only versions instead of pretending to install", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async (url) => {
      const href = String(url);
      if (href === "https://api.bbsmc.net/v2/version/version-2") {
        return jsonResponse({
          id: "version-2",
          project_id: "project-1",
          name: "Disk Pack",
          version_number: "2.0.0",
          loaders: ["fabric"],
          game_versions: ["1.21.4"],
          files: [],
          dependencies: [],
          disk_urls: [{ platform: "quark", url: "https://pan.quark.cn/s/abc" }],
          disk_only: true,
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    try {
      await expect(
        backend.handle("install_bbsmc_public_file", {
          input: { serverId: "server", versionId: "version-2" },
        }),
      ).rejects.toThrow(/external disk download links/);
    } finally {
      backend.close();
    }
  });
});

describe("Electron backend server pack metadata", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CURSEFORGE_API_KEY = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalCurseForgeApiKey === undefined) {
      delete process.env.CURSEFORGE_API_KEY;
    } else {
      process.env.CURSEFORGE_API_KEY = originalCurseForgeApiKey;
    }
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop(), { force: true, recursive: true });
    }
  });

  it("preserves Modrinth server pack metadata and plans the mrpack artifact", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toContain("/v2/version/version-1");
      return jsonResponse({
        id: "version-1",
        project_id: "project-1",
        name: "Dedicated Pack",
        version_number: "1.2.0",
        version_type: "release",
        loaders: ["quilt"],
        game_versions: ["1.21.4"],
        files: [
          {
            filename: "dedicated-pack.mrpack",
            size: 4096,
            primary: true,
            url: "https://cdn.modrinth.com/dedicated-pack.mrpack",
            hashes: { sha512: "abc", sha1: "def" },
          },
        ],
        dependencies: [],
      });
    });

    try {
      const plan = await backend.handle("plan_server_provisioning", {
        input: {
          source: {
            kind: "marketplaceModpack",
            provider: "Modrinth",
            projectId: "project-1",
            versionId: "version-1",
          },
        },
      });

      expect(plan).toMatchObject({
        pack: { format: "modrinth", releaseType: "release" },
        minecraftVersion: "1.21.4",
        loaderType: "quilt",
        artifacts: [
          {
            filename: "dedicated-pack.mrpack",
            size: 4096,
            url: "https://cdn.modrinth.com/dedicated-pack.mrpack",
            hashes: { sha512: "abc", sha1: "def" },
          },
        ],
        integrity: { status: "verified" },
        warnings: [],
      });
    } finally {
      backend.close();
    }
  });

  it("plans a public BBSMC archive as an unverified marketplace pack", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toContain("/v2/version/bbsmc-version-1");
      return jsonResponse({
        id: "bbsmc-version-1",
        project_id: "bbsmc-project-1",
        name: "BBSMC Public Pack",
        version_number: "2.0.0",
        loaders: ["quilt"],
        game_versions: ["1.21.4"],
        files: [
          {
            filename: "external-primary.zip",
            size: 2048,
            primary: true,
            url: "https://example.com/external-primary.zip",
          },
          {
            filename: "bbsmc-pack.mrpack",
            size: 8192,
            primary: false,
            url: "https://cdn.bbsmc.net/files/bbsmc-pack.mrpack",
            hashes: { sha512: "bbsmc-sha512" },
          },
        ],
        dependencies: [],
      });
    });

    try {
      const plan = await backend.handle("plan_server_provisioning", {
        input: {
          source: {
            kind: "marketplaceModpack",
            provider: "BBSMC",
            projectId: "bbsmc-project-1",
            versionId: "bbsmc-version-1",
          },
        },
      });

      expect(plan).toMatchObject({
        pack: {
          format: "bbsmc",
          name: "BBSMC Public Pack",
          versionId: "bbsmc-version-1",
        },
        minecraftVersion: "1.21.4",
        loaderType: "quilt",
        artifacts: [
          {
            provider: "bbsmc",
            projectId: "bbsmc-project-1",
            versionId: "bbsmc-version-1",
            filename: "bbsmc-pack.mrpack",
            size: 8192,
            url: "https://cdn.bbsmc.net/files/bbsmc-pack.mrpack",
            hashes: { sha512: "bbsmc-sha512" },
          },
        ],
        integrity: { status: "unverified" },
      });
      expect(plan.warnings).toContainEqual(
        expect.objectContaining({
          code: "PACK_UNVERIFIED",
          requiresAcknowledgement: true,
        }),
      );
    } finally {
      backend.close();
    }
  });

  it("rejects BBSMC versions that only provide external disk links", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        id: "bbsmc-disk-version",
        project_id: "bbsmc-project-2",
        name: "External Disk Pack",
        version_number: "1.0.0",
        loaders: ["forge"],
        game_versions: ["1.20.1"],
        files: [],
        disk_only: true,
        disk_urls: [
          { platform: "Baidu", url: "https://pan.baidu.com/example" },
        ],
      }),
    );

    try {
      await expect(
        backend.handle("plan_server_provisioning", {
          input: {
            source: {
              kind: "marketplaceModpack",
              provider: "BBSMC",
              projectId: "bbsmc-project-2",
              versionId: "bbsmc-disk-version",
            },
          },
        }),
      ).rejects.toThrow(/external disk download links/i);
    } finally {
      backend.close();
    }
  });

  it("rejects a BBSMC archive hosted outside the public BBSMC CDN", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        id: "bbsmc-untrusted-version",
        project_id: "bbsmc-project-3",
        name: "Untrusted Pack",
        version_number: "1.0.0",
        loaders: ["fabric"],
        game_versions: ["1.20.1"],
        files: [
          {
            filename: "pack.zip",
            primary: true,
            url: "https://example.com/pack.zip",
          },
        ],
      }),
    );

    try {
      await expect(
        backend.handle("plan_server_provisioning", {
          input: {
            source: {
              kind: "marketplaceModpack",
              provider: "BBSMC",
              projectId: "bbsmc-project-3",
              versionId: "bbsmc-untrusted-version",
            },
          },
        }),
      ).rejects.toThrow(/does not expose a direct public file download URL/i);
    } finally {
      backend.close();
    }
  });

  it("preserves CurseForge metadata and resolves a client file to its server pack", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      expect(options.headers?.["x-api-key"]).toBe("test-key");
      const href = String(url);
      if (href.includes("/v1/mods/123/files?pageSize=20")) {
        return jsonResponse({
          data: [
            {
              id: 20,
              modId: 123,
              displayName: "Pack client",
              fileName: "pack-client.zip",
              fileLength: 9000,
              releaseType: 1,
              gameVersions: ["1.20.1", "Forge"],
              isServerPack: false,
              serverPackFileId: 21,
              hashes: [{ algo: 1, value: "sha1-client" }],
            },
            {
              id: 21,
              modId: 123,
              displayName: "Pack server",
              fileName: "pack-server.zip",
              fileLength: 5000,
              releaseType: 1,
              gameVersions: ["1.20.1", "Forge"],
              isServerPack: true,
              hashes: [{ algo: 1, value: "sha1-server" }],
            },
          ],
        });
      }
      if (href.endsWith("/v1/mods/123/files/21/download-url")) {
        return jsonResponse({
          data: "https://edge.forgecdn.net/pack-server.zip",
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    try {
      const versions = await backend.handle("list_curseforge_files", {
        input: { projectId: "123" },
      });
      expect(versions[0]).toMatchObject({
        id: "20",
        isServerPack: false,
        serverPackFileId: "21",
        loaders: ["forge"],
        releaseType: "release",
        files: [{ size: 9000, hashes: { sha1: "sha1-client" } }],
      });
      expect(versions[1]).toMatchObject({ isServerPack: true });

      const plan = await backend.handle("plan_server_provisioning", {
        input: {
          source: {
            kind: "marketplaceModpack",
            provider: "CurseForge",
            projectId: "123",
            versionId: "20",
          },
        },
      });
      expect(plan).toMatchObject({
        pack: { format: "curseforge", versionId: "21" },
        loaderType: "forge",
        artifacts: [
          {
            fileId: "21",
            filename: "pack-server.zip",
            url: "https://edge.forgecdn.net/pack-server.zip",
            hashes: { sha1: "sha1-server" },
          },
        ],
        warnings: [],
      });
    } finally {
      backend.close();
    }
  });

  it("keeps a CurseForge client archive selectable only as unverified", async () => {
    const backend = createTestBackend();
    globalThis.fetch = vi.fn(async (url) => {
      const href = String(url);
      if (href.includes("/v1/mods/456/files?pageSize=20")) {
        return jsonResponse({
          data: [
            {
              id: 30,
              modId: 456,
              displayName: "Client archive",
              fileName: "client.zip",
              fileLength: 1200,
              releaseType: 2,
              gameVersions: ["1.20.1", "Fabric"],
              isServerPack: false,
              serverPackFileId: null,
              hashes: [],
            },
          ],
        });
      }
      if (href.endsWith("/v1/mods/456/files/30/download-url")) {
        return jsonResponse({ data: "https://edge.forgecdn.net/client.zip" });
      }
      throw new Error(`unexpected fetch ${href}`);
    });

    try {
      const plan = await backend.handle("plan_server_provisioning", {
        input: {
          source: {
            kind: "marketplaceModpack",
            provider: "CurseForge",
            projectId: "456",
            versionId: "30",
          },
        },
      });
      expect(plan.integrity.status).toBe("unverified");
      expect(plan.warnings).toContainEqual(
        expect.objectContaining({
          code: "PACK_UNVERIFIED",
          requiresAcknowledgement: true,
        }),
      );
    } finally {
      backend.close();
    }
  });
});
