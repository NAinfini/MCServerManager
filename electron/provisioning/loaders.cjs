const path = require("node:path");

const ENDPOINTS = Object.freeze({
  mojangManifest:
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
  paper: "https://fill.papermc.io/v3/projects/paper",
  fabric: "https://meta.fabricmc.net/v2",
  forge:
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
  neoForge:
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
  quilt: "https://meta.quiltmc.org/v3",
});

function versionOption(value, label = value, stable = true) {
  return { value: String(value), label: String(label), stable: Boolean(stable) };
}

function compareVersionsDesc(left, right) {
  const leftParts = String(left).match(/\d+|[a-z]+/gi) || [];
  const rightParts = String(right).match(/\d+|[a-z]+/gi) || [];
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? "";
    const rightPart = rightParts[index] ?? "";
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      if (leftNumber !== rightNumber) return rightNumber - leftNumber;
    } else if (leftPart !== rightPart) {
      return rightPart.localeCompare(leftPart);
    }
  }
  return 0;
}

function uniqueOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    if (!option.value || seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function parseMavenVersions(xml) {
  return [...String(xml).matchAll(/<version>([^<]+)<\/version>/g)].map(
    (match) => match[1],
  );
}

function neoForgeMinecraftVersion(artifactVersion) {
  const release = String(artifactVersion).split("-")[0];
  const parts = release.split(".");
  const major = Number(parts[0]);
  return major <= 21 ? `1.${parts[0]}.${parts[1]}` : parts.slice(0, 3).join(".");
}

function neoForgeMatches(artifactVersion, minecraftVersion) {
  const normalized = String(minecraftVersion).startsWith("1.")
    ? String(minecraftVersion).slice(2)
    : String(minecraftVersion);
  return (
    String(artifactVersion).startsWith(`${normalized}.`) ||
    String(artifactVersion).startsWith(`${normalized}-`)
  );
}

function jarLaunchSpec(jar, workingDirectory) {
  return {
    executable: { kind: "java" },
    jvmArgs: ["-jar", jar],
    serverArgs: ["nogui"],
    workingDirectory,
  };
}

function modernArgsLaunchSpec(libraryArgs, workingDirectory) {
  return {
    executable: { kind: "java" },
    jvmArgs: ["@user_jvm_args.txt", `@${libraryArgs}`],
    serverArgs: ["nogui"],
    workingDirectory,
  };
}

function isLegacyForge(minecraftVersion) {
  const match = String(minecraftVersion).match(/^1\.(\d+)/);
  return match ? Number(match[1]) <= 16 : false;
}

function basePlan(loaderType, input, values) {
  return {
    loaderType,
    minecraftVersion: input.minecraftVersion,
    loaderVersion: input.loaderVersion,
    workingDirectory: input.workingDirectory,
    installer: null,
    expectedOutputs: [],
    ...values,
  };
}

function createAdapter(loaderType, approvedHosts, deps, methods) {
  const adapter = {
    type: loaderType,
    approvedHosts,
    ...methods,
    async install(plan, options = {}) {
      if (typeof deps.download !== "function") {
        throw new Error("loader download function is not configured");
      }
      for (const artifact of plan.artifacts) {
        const host = new URL(artifact.url).hostname;
        if (!approvedHosts.includes(host)) {
          throw new Error(`unapproved ${loaderType} artifact host: ${host}`);
        }
        await deps.download(
          artifact.url,
          path.join(plan.workingDirectory, artifact.destination),
          artifact.hashes || {},
        );
      }
      if (plan.installer) {
        if (typeof deps.runProcess !== "function") {
          throw new Error("loader process runner is not configured");
        }
        const javaPath = options.javaPath || "java";
        const args = plan.installer.args.map((arg) =>
          arg === "{installer}" ? plan.installer.artifactDestination : arg,
        );
        const result = await deps.runProcess(javaPath, args, {
          cwd: plan.workingDirectory,
          shell: false,
        });
        if (result?.code !== 0) {
          throw new Error(`${loaderType} installer exited with code ${result?.code}`);
        }
      }
      return plan.launchSpec;
    },
    async validate(plan) {
      const missing = plan.expectedOutputs.filter((relativePath) =>
        typeof deps.fileExists === "function"
          ? !deps.fileExists(path.join(plan.workingDirectory, relativePath))
          : false,
      );
      return { valid: missing.length === 0, missing };
    },
  };
  return adapter;
}

function createLoaderRegistry(dependencies = {}) {
  const deps = {
    fetchJson: dependencies.fetchJson,
    fetchText: dependencies.fetchText,
    download: dependencies.download,
    runProcess: dependencies.runProcess,
    fileExists: dependencies.fileExists,
    platform: dependencies.platform || process.platform,
  };
  if (typeof deps.fetchJson !== "function" || typeof deps.fetchText !== "function") {
    throw new Error("loader metadata clients are required");
  }

  const releaseMinecraftVersions = async () => {
    const manifest = await deps.fetchJson(ENDPOINTS.mojangManifest);
    return (manifest.versions || [])
      .filter((version) => version.type === "release")
      .map((version) => versionOption(version.id));
  };

  const vanilla = createAdapter(
    "vanilla",
    ["piston-data.mojang.com", "piston-meta.mojang.com"],
    deps,
    {
      listMinecraftVersions: releaseMinecraftVersions,
      async listLoaderVersions(minecraftVersion) {
        return [versionOption(minecraftVersion, "Vanilla server")];
      },
      async buildInstallPlan(input) {
        const manifest = await deps.fetchJson(ENDPOINTS.mojangManifest);
        const selected = (manifest.versions || []).find(
          (version) => version.id === input.minecraftVersion,
        );
        if (!selected?.url) throw new Error("Minecraft version metadata not found");
        const metadata = await deps.fetchJson(selected.url);
        const server = metadata.downloads?.server;
        if (!server?.url) throw new Error("Minecraft server download not found");
        return basePlan("vanilla", input, {
          artifacts: [
            {
              url: server.url,
              destination: "server.jar",
              hashes: server.sha1 ? { sha1: server.sha1 } : {},
              size: server.size || 0,
            },
          ],
          expectedOutputs: ["server.jar"],
          launchSpec: jarLaunchSpec("server.jar", input.workingDirectory),
        });
      },
    },
  );

  const paper = createAdapter(
    "paper",
    ["fill.papermc.io", "fill-data.papermc.io"],
    deps,
    {
      async listMinecraftVersions() {
        const data = await deps.fetchJson(ENDPOINTS.paper);
        return uniqueOptions(
          Object.values(data.versions || {})
            .flat()
            .map((version) => versionOption(version)),
        );
      },
      async listLoaderVersions(minecraftVersion) {
        const builds = await deps.fetchJson(
          `${ENDPOINTS.paper}/versions/${encodeURIComponent(minecraftVersion)}/builds`,
        );
        return (Array.isArray(builds) ? builds : [])
          .filter((build) => build.channel === "STABLE")
          .map((build) => versionOption(build.id, `Build ${build.id}`));
      },
      async buildInstallPlan(input) {
        const builds = await deps.fetchJson(
          `${ENDPOINTS.paper}/versions/${encodeURIComponent(input.minecraftVersion)}/builds`,
        );
        const build = (Array.isArray(builds) ? builds : []).find(
          (candidate) => String(candidate.id) === String(input.loaderVersion),
        );
        if (!build) throw new Error("Paper build not found");
        const download =
          build.downloads?.["server:default"] ||
          Object.values(build.downloads || {})[0];
        if (!download?.url) throw new Error("Paper server download not found");
        return basePlan("paper", input, {
          artifacts: [
            {
              url: download.url,
              destination: "server.jar",
              hashes: download.checksums || {},
              size: download.size || 0,
            },
          ],
          expectedOutputs: ["server.jar"],
          launchSpec: jarLaunchSpec("server.jar", input.workingDirectory),
        });
      },
    },
  );

  const fabric = createAdapter(
    "fabric",
    ["meta.fabricmc.net"],
    deps,
    {
      async listMinecraftVersions() {
        const versions = await deps.fetchJson(`${ENDPOINTS.fabric}/versions/game`);
        return versions
          .filter((version) => version.stable)
          .map((version) => versionOption(version.version, version.version, version.stable));
      },
      async listLoaderVersions(minecraftVersion) {
        const versions = await deps.fetchJson(
          `${ENDPOINTS.fabric}/versions/loader/${encodeURIComponent(minecraftVersion)}`,
        );
        return versions
          .map((entry) => entry.loader)
          .filter((loader) => loader?.stable)
          .map((loader) => versionOption(loader.version, loader.version, loader.stable));
      },
      async buildInstallPlan(input) {
        const installers = await deps.fetchJson(`${ENDPOINTS.fabric}/versions/installer`);
        const installerVersion =
          input.installerVersion ||
          installers.find((installer) => installer.stable)?.version ||
          installers[0]?.version;
        if (!installerVersion) throw new Error("Fabric installer version not found");
        const url = `${ENDPOINTS.fabric}/versions/loader/${encodeURIComponent(input.minecraftVersion)}/${encodeURIComponent(input.loaderVersion)}/${encodeURIComponent(installerVersion)}/server/jar`;
        return basePlan("fabric", input, {
          artifacts: [{ url, destination: "server.jar", hashes: {}, size: 0 }],
          expectedOutputs: ["server.jar"],
          launchSpec: jarLaunchSpec("server.jar", input.workingDirectory),
        });
      },
    },
  );

  const forge = createAdapter(
    "forge",
    ["maven.minecraftforge.net"],
    deps,
    {
      async listMinecraftVersions() {
        const xml = await deps.fetchText(ENDPOINTS.forge);
        return uniqueOptions(
          parseMavenVersions(xml)
            .map((version) => version.split("-")[0])
            .sort(compareVersionsDesc)
            .map((version) => versionOption(version)),
        );
      },
      async listLoaderVersions(minecraftVersion) {
        const xml = await deps.fetchText(ENDPOINTS.forge);
        return parseMavenVersions(xml)
          .filter((version) => version.startsWith(`${minecraftVersion}-`))
          .map((version) => version.slice(`${minecraftVersion}-`.length))
          .sort(compareVersionsDesc)
          .map((version) => versionOption(version));
      },
      async buildInstallPlan(input) {
        const coordinate = `${input.minecraftVersion}-${input.loaderVersion}`;
        const installerJar = `forge-${coordinate}-installer.jar`;
        const legacyJar = `forge-${coordinate}.jar`;
        const modernArgs = `libraries/net/minecraftforge/forge/${coordinate}/${deps.platform === "win32" ? "win_args.txt" : "unix_args.txt"}`;
        return basePlan("forge", input, {
          artifacts: [
            {
              url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${coordinate}/${installerJar}`,
              destination: "forge-installer.jar",
              hashes: {},
              size: 0,
            },
          ],
          installer: {
            artifactDestination: "forge-installer.jar",
            args: ["-jar", "{installer}", "--installServer"],
          },
          expectedOutputs: isLegacyForge(input.minecraftVersion)
            ? [legacyJar]
            : ["user_jvm_args.txt", modernArgs],
          launchSpec: isLegacyForge(input.minecraftVersion)
            ? jarLaunchSpec(legacyJar, input.workingDirectory)
            : modernArgsLaunchSpec(modernArgs, input.workingDirectory),
        });
      },
    },
  );

  const neoForge = createAdapter(
    "neoForge",
    ["maven.neoforged.net"],
    deps,
    {
      async listMinecraftVersions() {
        const xml = await deps.fetchText(ENDPOINTS.neoForge);
        return uniqueOptions(
          parseMavenVersions(xml)
            .map(neoForgeMinecraftVersion)
            .sort(compareVersionsDesc)
            .map((version) => versionOption(version)),
        );
      },
      async listLoaderVersions(minecraftVersion) {
        const xml = await deps.fetchText(ENDPOINTS.neoForge);
        return parseMavenVersions(xml)
          .filter((version) => neoForgeMatches(version, minecraftVersion))
          .sort(compareVersionsDesc)
          .map((version) => versionOption(version));
      },
      async buildInstallPlan(input) {
        const installerJar = `neoforge-${input.loaderVersion}-installer.jar`;
        const argsFile = `libraries/net/neoforged/neoforge/${input.loaderVersion}/${deps.platform === "win32" ? "win_args.txt" : "unix_args.txt"}`;
        return basePlan("neoForge", input, {
          artifacts: [
            {
              url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${input.loaderVersion}/${installerJar}`,
              destination: "neoforge-installer.jar",
              hashes: {},
              size: 0,
            },
          ],
          installer: {
            artifactDestination: "neoforge-installer.jar",
            args: ["-jar", "{installer}", "--installServer"],
          },
          expectedOutputs: ["user_jvm_args.txt", argsFile],
          launchSpec: modernArgsLaunchSpec(argsFile, input.workingDirectory),
        });
      },
    },
  );

  const quilt = createAdapter(
    "quilt",
    ["maven.quiltmc.org"],
    deps,
    {
      async listMinecraftVersions() {
        const versions = await deps.fetchJson(`${ENDPOINTS.quilt}/versions/game`);
        return versions
          .filter((version) => version.stable !== false)
          .map((version) => versionOption(version.version, version.version, version.stable !== false));
      },
      async listLoaderVersions(minecraftVersion) {
        const versions = await deps.fetchJson(
          `${ENDPOINTS.quilt}/versions/loader/${encodeURIComponent(minecraftVersion)}`,
        );
        return versions
          .map((entry) => entry.loader || entry)
          .filter((loader) => loader?.version)
          .map((loader) => versionOption(loader.version));
      },
      async buildInstallPlan(input) {
        let installerVersion = input.installerVersion;
        if (!installerVersion) {
          const installers = await deps.fetchJson(`${ENDPOINTS.quilt}/versions/installer`);
          installerVersion = installers[0]?.version;
        }
        if (!installerVersion) throw new Error("Quilt installer version not found");
        const installerJar = `quilt-installer-${installerVersion}.jar`;
        return basePlan("quilt", input, {
          artifacts: [
            {
              url: `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${installerVersion}/${installerJar}`,
              destination: "quilt-installer.jar",
              hashes: {},
              size: 0,
            },
          ],
          installer: {
            artifactDestination: "quilt-installer.jar",
            args: [
              "-jar",
              "{installer}",
              "install",
              "server",
              input.minecraftVersion,
              input.loaderVersion,
              "--download-server",
              "--install-dir=.",
            ],
          },
          expectedOutputs: ["quilt-server-launch.jar"],
          launchSpec: jarLaunchSpec(
            "quilt-server-launch.jar",
            input.workingDirectory,
          ),
        });
      },
    },
  );

  const adapters = new Map(
    [vanilla, paper, fabric, forge, neoForge, quilt].map((adapter) => [
      adapter.type,
      adapter,
    ]),
  );
  return {
    types: () => [...adapters.keys()],
    get(loaderType) {
      const adapter = adapters.get(loaderType);
      if (!adapter) throw new Error(`unsupported loader type: ${loaderType}`);
      return adapter;
    },
  };
}

module.exports = { ENDPOINTS, createLoaderRegistry };
