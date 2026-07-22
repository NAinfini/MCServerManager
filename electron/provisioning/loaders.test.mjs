import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

describe("trusted loader adapters", () => {
  it("registers all six supported server loaders", async () => {
    const { createLoaderRegistry } = require("./loaders.cjs");
    const registry = createLoaderRegistry({
      fetchJson: vi.fn(),
      fetchText: vi.fn(),
    });

    expect(registry.types()).toEqual([
      "vanilla",
      "paper",
      "fabric",
      "forge",
      "neoForge",
      "quilt",
    ]);
  });

  it("discovers versions through each loader's approved metadata host", async () => {
    const { createLoaderRegistry } = require("./loaders.cjs");
    const fetchJson = vi.fn(async (url) => {
      if (url === "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json") {
        return { versions: [{ id: "1.21.4", type: "release", url: "https://piston-meta.mojang.com/v1.21.4.json" }] };
      }
      if (url === "https://fill.papermc.io/v3/projects/paper") {
        return { versions: { "1.21": ["1.21.4"] } };
      }
      if (url === "https://fill.papermc.io/v3/projects/paper/versions/1.21.4/builds") {
        return [{ id: 120, channel: "STABLE" }, { id: 119, channel: "BETA" }];
      }
      if (url === "https://meta.fabricmc.net/v2/versions/game") {
        return [{ version: "1.21.4", stable: true }];
      }
      if (url === "https://meta.fabricmc.net/v2/versions/loader/1.21.4") {
        return [{ loader: { version: "0.16.10", stable: true } }];
      }
      if (url === "https://meta.quiltmc.org/v3/versions/game") {
        return [{ version: "1.21.4", stable: true }];
      }
      if (url === "https://meta.quiltmc.org/v3/versions/loader/1.21.4") {
        return [{ loader: { version: "0.29.3" } }];
      }
      throw new Error(`unexpected JSON ${url}`);
    });
    const fetchText = vi.fn(async (url) => {
      if (url.includes("maven.minecraftforge.net")) {
        return "<metadata><versioning><versions><version>1.21.4-54.0.1</version></versions></versioning></metadata>";
      }
      if (url.includes("maven.neoforged.net")) {
        return "<metadata><versioning><versions><version>21.4.10-beta</version></versions></versioning></metadata>";
      }
      throw new Error(`unexpected text ${url}`);
    });
    const registry = createLoaderRegistry({ fetchJson, fetchText });

    for (const loaderType of registry.types()) {
      const minecraft = await registry
        .get(loaderType)
        .listMinecraftVersions();
      expect(minecraft[0].value).toBe("1.21.4");
      const loaders = await registry
        .get(loaderType)
        .listLoaderVersions("1.21.4");
      expect(loaders.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ["vanilla", "1.21.4", "1.21.4", "server.jar"],
    ["paper", "1.21.4", "120", "server.jar"],
    ["fabric", "1.21.4", "0.16.10", "server.jar"],
    ["forge", "1.21.4", "54.0.1", "forge-installer.jar"],
    ["neoForge", "1.21.4", "21.4.10-beta", "neoforge-installer.jar"],
    ["quilt", "1.21.4", "0.29.3", "quilt-installer.jar"],
  ])(
    "builds and installs an approved %s plan",
    async (loaderType, minecraftVersion, loaderVersion, destination) => {
      const { createLoaderRegistry } = require("./loaders.cjs");
      const downloaded = new Set();
      const download = vi.fn(async (_url, target) => downloaded.add(target));
      const runProcess = vi.fn(async () => ({ code: 0 }));
      const fetchJson = vi.fn(async (url) => {
        if (url.endsWith("version_manifest_v2.json")) {
          return {
            versions: [
              {
                id: "1.21.4",
                type: "release",
                url: "https://piston-meta.mojang.com/v1.21.4.json",
              },
            ],
          };
        }
        if (url === "https://piston-meta.mojang.com/v1.21.4.json") {
          return {
            downloads: {
              server: {
                url: "https://piston-data.mojang.com/server.jar",
                sha1: "mojang-sha1",
                size: 100,
              },
            },
          };
        }
        if (url.endsWith("/versions/1.21.4/builds")) {
          return [
            {
              id: 120,
              channel: "STABLE",
              downloads: {
                "server:default": {
                  url: "https://fill-data.papermc.io/paper.jar",
                  checksums: { sha256: "paper-sha256" },
                  size: 200,
                },
              },
            },
          ];
        }
        if (url === "https://meta.fabricmc.net/v2/versions/installer") {
          return [{ version: "1.0.3", stable: true }];
        }
        if (url === "https://meta.fabricmc.net/v2/versions/loader/1.21.4") {
          return [{ loader: { version: "0.16.10", stable: true } }];
        }
        if (url === "https://meta.quiltmc.org/v3/versions/installer") {
          return [{ version: "0.13.1" }];
        }
        throw new Error(`unexpected JSON ${url}`);
      });
      const registry = createLoaderRegistry({
        fetchJson,
        fetchText: vi.fn(),
        download,
        runProcess,
        fileExists: (target) => downloaded.has(target),
        platform: "win32",
      });
      const adapter = registry.get(loaderType);
      const plan = await adapter.buildInstallPlan({
        minecraftVersion,
        loaderVersion,
        workingDirectory: "C:\\servers\\demo",
      });

      expect(plan.artifacts[0].destination).toBe(destination);
      expect(plan.artifacts.every((artifact) =>
        adapter.approvedHosts.includes(new URL(artifact.url).hostname),
      )).toBe(true);

      await adapter.install(plan, { javaPath: "C:\\Java\\bin\\java.exe" });
      expect(download).toHaveBeenCalled();
      if (plan.installer) {
        expect(runProcess).toHaveBeenCalledWith(
          "C:\\Java\\bin\\java.exe",
          expect.any(Array),
          expect.objectContaining({ shell: false }),
        );
      }
      for (const output of plan.expectedOutputs) {
        downloaded.add(path.join(plan.workingDirectory, output));
      }
      await expect(adapter.validate(plan)).resolves.toEqual({
        valid: true,
        missing: [],
      });
    },
  );

  it("names an unpublished Fabric loader instead of letting the URL 400", async () => {
    const { createLoaderRegistry } = require("./loaders.cjs");
    const registry = createLoaderRegistry({
      fetchJson: vi.fn(async (url) => {
        if (url === "https://meta.fabricmc.net/v2/versions/installer") {
          return [{ version: "1.1.1", stable: true }];
        }
        if (url === "https://meta.fabricmc.net/v2/versions/loader/26.2") {
          return [{ loader: { version: "0.19.3", stable: true } }];
        }
        throw new Error(`unexpected JSON ${url}`);
      }),
      fetchText: vi.fn(),
      platform: "win32",
    });

    await expect(
      registry.get("fabric").buildInstallPlan({
        minecraftVersion: "26.2",
        loaderVersion: "latest",
        workingDirectory: ".",
      }),
    ).rejects.toMatchObject({ code: "LOADER_VERSION_UNAVAILABLE" });
  });

  it("uses structured modern Forge and NeoForge argument-file launch specs", async () => {
    const { createLoaderRegistry } = require("./loaders.cjs");
    const registry = createLoaderRegistry({
      fetchJson: vi.fn(),
      fetchText: vi.fn(),
      platform: "win32",
    });

    const forge = await registry.get("forge").buildInstallPlan({
      minecraftVersion: "1.21.4",
      loaderVersion: "54.0.1",
      workingDirectory: ".",
    });
    expect(forge.launchSpec).toEqual({
      executable: { kind: "java" },
      jvmArgs: [
        "@user_jvm_args.txt",
        "@libraries/net/minecraftforge/forge/1.21.4-54.0.1/win_args.txt",
      ],
      serverArgs: ["nogui"],
      workingDirectory: ".",
    });

    const neoForge = await registry.get("neoForge").buildInstallPlan({
      minecraftVersion: "1.21.4",
      loaderVersion: "21.4.10-beta",
      workingDirectory: ".",
    });
    expect(neoForge.launchSpec.jvmArgs).toEqual([
      "@user_jvm_args.txt",
      "@libraries/net/neoforged/neoforge/21.4.10-beta/win_args.txt",
    ]);
  });

  it("keeps legacy Forge in direct jar launch mode", async () => {
    const { createLoaderRegistry } = require("./loaders.cjs");
    const registry = createLoaderRegistry({ fetchJson: vi.fn(), fetchText: vi.fn() });
    const plan = await registry.get("forge").buildInstallPlan({
      minecraftVersion: "1.16.5",
      loaderVersion: "36.2.42",
      workingDirectory: ".",
    });

    expect(plan.launchSpec).toEqual({
      executable: { kind: "java" },
      jvmArgs: ["-jar", "forge-1.16.5-36.2.42.jar"],
      serverArgs: ["nogui"],
      workingDirectory: ".",
    });
  });

  it("reports missing loader output during validation", async () => {
    const { createLoaderRegistry } = require("./loaders.cjs");
    const registry = createLoaderRegistry({
      fetchJson: vi.fn(),
      fetchText: vi.fn(),
      fileExists: () => false,
    });
    const adapter = registry.get("quilt");
    const plan = await adapter.buildInstallPlan({
      minecraftVersion: "1.21.4",
      loaderVersion: "0.29.3",
      installerVersion: "0.13.1",
      workingDirectory: path.resolve("server"),
    });

    expect(await adapter.validate(plan)).toEqual({
      valid: false,
      missing: ["quilt-server-launch.jar"],
    });
  });
});
