import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finished } from "node:stream/promises";
import yazl from "yazl";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyDisabledMods,
  detectPack,
  recommendMemory,
  satisfiesMinecraft,
} from "./pack-detect.cjs";
import { planLocalPack } from "./sources.cjs";

const tempDirs = [];
const GB = 1024 * 1024 * 1024;

function tempDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-detect-test-"));
  tempDirs.push(root);
  return root;
}

async function writeZip(target, entries) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const zip = new yazl.ZipFile();
  for (const [name, content] of entries) {
    zip.addBuffer(Buffer.from(content), name);
  }
  zip.end();
  const output = fs.createWriteStream(target);
  zip.outputStream.pipe(output);
  await finished(output);
  return target;
}

/* A mod jar is a real zip with a real descriptor, so the detector reads it the
   way it reads one from a pack. */
async function modJar(dir, fileName, entries) {
  const target = path.join(dir, fileName);
  await writeZip(target, Object.entries(entries));
  return target;
}

function fabricMod(id, { environment = "*", minecraft = "*", version = "1.0.0" } = {}) {
  return {
    "fabric.mod.json": JSON.stringify({
      schemaVersion: 1,
      id,
      name: id.toUpperCase(),
      version,
      environment,
      depends: { minecraft },
    }),
  };
}

/* Builds a zip whose mods/ entries are real jars. */
async function packZip(fileName, files, mods = []) {
  const dir = tempDir();
  const entries = Object.entries(files);
  const scratch = tempDir();
  for (const mod of mods) {
    const jar = await modJar(scratch, mod.name, mod.entries);
    entries.push([`${mod.folder ?? ""}mods/${mod.name}`, fs.readFileSync(jar)]);
  }
  return writeZip(path.join(dir, fileName), entries);
}

afterEach(() => {
  for (const root of tempDirs.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("server pack detection", () => {
  it("reports an accepted eula.txt only when the pack really ships one", async () => {
    const agreed = await packZip("agreed.zip", {
      "eula.txt": "#generated\neula=true\n",
      "user_jvm_args.txt": "-Xmx4G\n",
    });
    const declined = await packZip("declined.zip", {
      "eula.txt": "eula=false\n",
      "user_jvm_args.txt": "-Xmx4G\n",
    });
    expect((await detectPack(agreed)).packEulaAccepted).toBe(true);
    expect((await detectPack(declined)).packEulaAccepted).toBe(false);
  });

  it("recognises a NeoForge server pack and gives the evidence for each conclusion", async () => {
    const archive = await packZip(
      "ATM-Server.zip",
      {
        "variables.txt":
          'MINECRAFT_VERSION=1.21.1\nMODLOADER=NeoForge\nMODLOADER_VERSION=21.1.77\nRECOMMENDED_JAVA_VERSION=21\n',
        "user_jvm_args.txt": "-Xmx6G\n",
        "libraries/net/neoforged/neoforge/21.1.77/neoforge-21.1.77-server.jar":
          "x",
        "run.bat": "java @user_jvm_args.txt %*",
        "server.properties": "server-port=25570\n",
      },
      [
        { name: "a.jar", entries: fabricMod("a") },
        { name: "b.jar", entries: fabricMod("b") },
      ],
    );

    const plan = await detectPack(archive, {
      totalMemoryBytes: 32 * GB,
    });

    expect(plan.kind).toBe("serverPack");
    expect(plan.loader).toEqual({ type: "neoForge", version: "21.1.77" });
    expect(plan.minecraftVersion).toBe("1.21.1");
    expect(plan.javaMajor).toBe(21);
    expect(plan.modCount).toBe(2);
    expect(plan.port).toEqual({ value: 25570, source: "server.properties" });
    // The pack states -Xmx6G; that wins over the mod-count recommendation.
    expect(plan.memory).toMatchObject({ maxMb: 6144, source: "pack" });
    expect(plan.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "minecraftVersion",
          value: "1.21.1",
          source: "variables.txt",
        }),
        expect.objectContaining({ field: "kind", source: "variables.txt" }),
        expect.objectContaining({
          field: "kind",
          source: "libraries/net/neoforged",
        }),
        expect.objectContaining({ field: "kind", source: "run.bat" }),
      ]),
    );
    // No conflicting statements: nothing to warn about.
    expect(plan.warnings.map((item) => item.code)).not.toContain(
      "PACK_VERSION_CONFLICT",
    );
  });

  it("derives Forge and Fabric facts from installed libraries when no file states them", async () => {
    const forge = await detectPack(
      await packZip("forge.zip", {
        "libraries/net/minecraftforge/forge/1.20.1-47.3.0/forge-1.20.1-47.3.0-server.jar":
          "x",
        "run.sh": "java -jar x",
      }),
      { totalMemoryBytes: 16 * GB },
    );
    expect(forge.loader).toEqual({ type: "forge", version: "47.3.0" });
    expect(forge.minecraftVersion).toBe("1.20.1");

    const fabric = await detectPack(
      await packZip("fabric.zip", {
        ".fabric/placeholder": "x",
        "libraries/net/fabricmc/fabric-loader/0.16.10/a.jar": "x",
        "libraries/net/fabricmc/intermediary/1.21.4/a.jar": "x",
        "fabric-server-launch.jar": "x",
      }),
      { totalMemoryBytes: 16 * GB },
    );
    expect(fabric.loader).toEqual({ type: "fabric", version: "0.16.10" });
    expect(fabric.minecraftVersion).toBe("1.21.4");
  });

  it("flattens a single wrapper folder", async () => {
    const plan = await detectPack(
      await packZip("wrapped.zip", {
        "Pack-Server-1.0/variables.txt":
          "MINECRAFT_VERSION=1.20.1\nMODLOADER=Forge\nMODLOADER_VERSION=47.3.0\n",
        "Pack-Server-1.0/libraries/net/minecraftforge/forge/1.20.1-47.3.0/x.jar":
          "x",
      }),
      { totalMemoryBytes: 16 * GB },
    );
    expect(plan.root).toBe("Pack-Server-1.0/");
    expect(plan.kind).toBe("serverPack");
    expect(plan.minecraftVersion).toBe("1.20.1");
  });

  it("detects a pack from an unpacked folder", async () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "libraries/net/neoforged/neoforge/21.1.77"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "libraries/net/neoforged/neoforge/21.1.77/a.jar"),
      "x",
    );
    const plan = await detectPack(root, { totalMemoryBytes: 16 * GB });
    expect(plan.kind).toBe("serverPack");
    expect(plan.loader).toEqual({ type: "neoForge", version: "21.1.77" });
    // NeoForge 21.1.x is the 1.21.1 line.
    expect(plan.minecraftVersion).toBe("1.21.1");
  });

  it("prefers the server pack when a folder holds both", async () => {
    const root = tempDir();
    await writeZip(path.join(root, "Pack-1.0.zip"), [
      [
        "manifest.json",
        JSON.stringify({
          name: "Pack",
          minecraft: {
            version: "1.20.1",
            modLoaders: [{ id: "forge-47.3.0", primary: true }],
          },
          files: [{ projectID: 1, fileID: 2 }],
        }),
      ],
    ]);
    await writeZip(path.join(root, "Pack-Server-1.0.zip"), [
      ["variables.txt", "MINECRAFT_VERSION=1.20.1\nMODLOADER=Forge\n"],
    ]);
    const plan = await detectPack(root, {
      totalMemoryBytes: 16 * GB,
      curseForgeKeyPresent: false,
    });
    expect(plan.kind).toBe("serverPack");
    expect(plan.sourcePath).toMatch(/Pack-Server-1\.0\.zip$/);
    expect(plan.alternatives).toEqual([
      expect.objectContaining({ kind: "clientPack" }),
    ]);
  });
});

describe("version conflicts", () => {
  // The owner's job "26.2 Fabric-SmoothS v1" ran on Minecraft 1.17.1 and
  // crashed three times with mod-incompatibility errors. The version has to
  // come from what the pack states, and a disagreement has to be said out loud.
  it("uses the version the pack states and warns about a stale conflicting source", async () => {
    const archive = await packZip(
      "26.2 Fabric-SmoothS v1.zip",
      {
        "variables.txt":
          "MINECRAFT_VERSION=26.2\nMODLOADER=Fabric\nMODLOADER_VERSION=0.18.0\n",
        ".fabric/placeholder": "x",
        // Left over from an earlier build of the same pack.
        "libraries/net/fabricmc/intermediary/1.17.1/intermediary-1.17.1.jar":
          "x",
      },
      [
        { name: "a.jar", entries: fabricMod("a", { minecraft: "~26.2" }) },
        { name: "b.jar", entries: fabricMod("b", { minecraft: ">=26.2" }) },
        { name: "c.jar", entries: fabricMod("c", { minecraft: "26.2.x" }) },
      ],
    );

    const plan = await detectPack(archive, { totalMemoryBytes: 16 * GB });

    expect(plan.minecraftVersion).toBe("26.2");
    expect(plan.minecraftVersion).not.toBe("1.17.1");
    expect(plan.javaMajor).toBe(25);
    const conflict = plan.warnings.find(
      (item) => item.code === "PACK_VERSION_CONFLICT",
    );
    expect(conflict).toBeTruthy();
    expect(conflict.params.chosen).toBe("26.2");
    expect(conflict.params.chosenSource).toBe("variables.txt");
    expect(conflict.params.others).toEqual([
      { value: "1.17.1", source: "libraries/" },
    ]);
    // Every mod accepts 26.2, so no incompatibility is claimed.
    expect(plan.warnings.map((item) => item.code)).not.toContain(
      "PACK_MODS_INCOMPATIBLE",
    );
  });

  it("warns when the chosen version is one the mods say they do not support", async () => {
    const archive = await packZip(
      "SmoothS.zip",
      {
        "variables.txt": "MINECRAFT_VERSION=1.17.1\nMODLOADER=Fabric\n",
        ".fabric/placeholder": "x",
      },
      [
        { name: "a.jar", entries: fabricMod("a", { minecraft: "~26.2" }) },
        { name: "b.jar", entries: fabricMod("b", { minecraft: ">=26.2" }) },
        { name: "c.jar", entries: fabricMod("c", { minecraft: "1.17.1" }) },
      ],
    );
    const plan = await detectPack(archive, { totalMemoryBytes: 16 * GB });
    const incompatible = plan.warnings.find(
      (item) => item.code === "PACK_MODS_INCOMPATIBLE",
    );
    expect(incompatible.params).toMatchObject({
      count: 2,
      checked: 3,
      version: "1.17.1",
    });
  });

  it("infers from mods and the file name only as a flagged guess, never silently", async () => {
    const archive = await packZip(
      "26.2 Fabric-SmoothS v1.zip",
      { ".fabric/placeholder": "x" },
      [
        { name: "a.jar", entries: fabricMod("a", { minecraft: "~26.2" }) },
        { name: "b.jar", entries: fabricMod("b", { minecraft: "~26.2" }) },
        { name: "c.jar", entries: fabricMod("c", { minecraft: "~26.2" }) },
      ],
    );
    const plan = await detectPack(archive, { totalMemoryBytes: 16 * GB });
    expect(plan.minecraftVersion).toBe("26.2");
    expect(plan.loader.type).toBe("fabric");
    expect(plan.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "PACK_VERSION_INFERRED",
        "PACK_LOADER_VERSION_UNSTATED",
      ]),
    );
  });

  it("leaves the version empty instead of defaulting when nothing states it", async () => {
    const archive = await packZip("mystery.zip", {
      "run.bat": "java -jar something.jar",
      "mods/readme.txt": "x",
    });
    const plan = await detectPack(archive, { totalMemoryBytes: 16 * GB });
    expect(plan.minecraftVersion).toBeNull();
    expect(plan.javaMajor).toBeNull();
    expect(plan.warnings.map((item) => item.code)).toContain("PACK_NO_VERSION");
  });

  it("reports a loader conflict between sources", async () => {
    const archive = await packZip("conflict.zip", {
      "variables.txt": "MINECRAFT_VERSION=1.20.1\nMODLOADER=Forge\n",
      "libraries/net/neoforged/neoforge/20.4.1/x.jar": "x",
    });
    const plan = await detectPack(archive, { totalMemoryBytes: 16 * GB });
    expect(plan.loader.type).toBe("forge");
    expect(plan.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining(["PACK_LOADER_CONFLICT", "PACK_VERSION_CONFLICT"]),
    );
  });
});

describe("client-only mods", () => {
  it("lists only mods whose metadata declares them client-only, and plans to disable them", async () => {
    const archive = await packZip(
      "pack.zip",
      {
        "variables.txt": "MINECRAFT_VERSION=1.21.1\nMODLOADER=Fabric\n",
        ".fabric/placeholder": "x",
      },
      [
        {
          name: "sodium.jar",
          entries: fabricMod("sodium", { environment: "client" }),
        },
        { name: "lithium.jar", entries: fabricMod("lithium", { environment: "*" }) },
        // Says nothing about its side: must not be claimed as client-only
        // however much its name sounds like a renderer.
        {
          name: "shaders-renderer.jar",
          entries: { "fabric.mod.json": JSON.stringify({ id: "shaders", version: "1" }) },
        },
        {
          name: "neo-client.jar",
          entries: {
            "META-INF/mods.toml": [
              "[[mods]]",
              'modId="neoclient"',
              "[[dependencies.neoclient]]",
              'modId="minecraft"',
              'versionRange="[1.21.1,1.22)"',
              'side="CLIENT"',
            ].join("\n"),
          },
        },
        {
          name: "legacy.jar",
          entries: {
            "mcmod.info": JSON.stringify([
              { modid: "legacy", name: "Legacy", clientSideOnly: true },
            ]),
          },
        },
      ],
    );
    const plan = await detectPack(archive, { totalMemoryBytes: 16 * GB });
    expect(plan.clientOnlyMods.map((mod) => mod.modId).sort()).toEqual([
      "legacy",
      "neoclient",
      "sodium",
    ]);
    expect(plan.clientOnlyMods.find((mod) => mod.modId === "sodium").declared).toBe(
      "fabric.mod.json: environment=client",
    );
    expect(plan.disabledMods.sort()).toEqual([
      "mods/legacy.jar",
      "mods/neo-client.jar",
      "mods/sodium.jar",
    ]);
    expect(plan.warnings.find((item) => item.code === "PACK_CLIENT_ONLY_MODS")
      .params.count).toBe(3);
  });

  it("renames planned mods to .jar.disabled and refuses paths outside the folder", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "mods"));
    fs.writeFileSync(path.join(root, "mods", "a.jar"), "x");
    const outside = path.join(path.dirname(root), "outside.jar");
    fs.writeFileSync(outside, "x");
    try {
      const applied = applyDisabledMods(root, [
        "mods/a.jar",
        "mods/missing.jar",
        "../outside.jar",
      ]);
      expect(applied).toEqual(["mods/a.jar"]);
      expect(fs.existsSync(path.join(root, "mods", "a.jar.disabled"))).toBe(true);
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});

describe("client packs and other drops", () => {
  const manifest = {
    name: "Client Pack",
    version: "1.0",
    minecraft: {
      version: "1.20.1",
      modLoaders: [{ id: "forge-47.3.0", primary: true }],
    },
    files: [
      { projectID: 111, fileID: 1, required: true },
      { projectID: 222, fileID: 2, required: true },
    ],
    overrides: "overrides",
  };

  it("says what a CurseForge client pack is missing and lists mods that cannot be fetched", async () => {
    const archive = await packZip("client.zip", {
      "manifest.json": JSON.stringify(manifest),
      "overrides/config/a.toml": "x",
    });
    const plan = await detectPack(archive, {
      totalMemoryBytes: 16 * GB,
      curseForgeKeyPresent: false,
    });
    expect(plan.kind).toBe("clientPack");
    expect(plan.missing).toEqual(["serverFiles"]);
    expect(plan.unfetchable).toEqual([
      expect.objectContaining({ projectId: "111", fileId: "1", reason: "noApiKey" }),
      expect.objectContaining({ projectId: "222", fileId: "2", reason: "noApiKey" }),
    ]);
    expect(plan.loader).toEqual({ type: "forge", version: "47.3.0" });
    expect(plan.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining(["PACK_CLIENT_PACK", "PACK_MODS_NOT_FETCHABLE"]),
    );
  });

  it("lists nothing as unfetchable when a CurseForge key is configured", async () => {
    const archive = await packZip("client.zip", {
      "manifest.json": JSON.stringify(manifest),
    });
    const plan = await detectPack(archive, {
      totalMemoryBytes: 16 * GB,
      curseForgeKeyPresent: true,
    });
    expect(plan.unfetchable).toEqual([]);
  });

  it("recognises a Modrinth pack", async () => {
    const archive = await packZip("pack.mrpack", {
      "modrinth.index.json": JSON.stringify({
        formatVersion: 1,
        game: "minecraft",
        name: "MR",
        dependencies: { minecraft: "1.21.4", "fabric-loader": "0.16.10" },
        files: [
          { path: "mods/a.jar", env: { server: "required" } },
          { path: "mods/sodium.jar", env: { client: "required", server: "unsupported" } },
        ],
      }),
    });
    const plan = await detectPack(archive, { totalMemoryBytes: 16 * GB });
    expect(plan.kind).toBe("mrpack");
    expect(plan.loader).toEqual({ type: "fabric", version: "0.16.10" });
    expect(plan.modCount).toBe(1);
    expect(plan.clientOnlyMods).toEqual([
      expect.objectContaining({
        declared: "modrinth.index.json: env.server=unsupported",
      }),
    ]);
  });

  it("identifies bare jars without calling a mod a server", async () => {
    const dir = tempDir();
    const mod = await modJar(dir, "m.jar", fabricMod("m"));
    const modPlan = await detectPack(mod);
    expect(modPlan).toMatchObject({ kind: "bareJar", jarRole: "mod" });
    expect(modPlan.warnings[0].code).toBe("PACK_BARE_JAR_MOD");

    const installer = await modJar(dir, "installer.jar", {
      "install_profile.json": "{}",
      "version.json": JSON.stringify({ id: "neoforge-21.1.77" }),
    });
    const installerPlan = await detectPack(installer);
    expect(installerPlan).toMatchObject({
      kind: "bareJar",
      jarRole: "installer",
      loader: { type: "neoForge", version: "21.1.77" },
      minecraftVersion: "1.21.1",
    });
  });
});

describe("memory recommendation", () => {
  it("scales with mod count and keeps headroom on the machine", () => {
    expect(recommendMemory({ modCount: 20, totalMemoryMb: 32768 }).maxMb).toBe(
      4096,
    );
    expect(recommendMemory({ modCount: 460, totalMemoryMb: 32768 }).maxMb).toBe(
      10240,
    );
    const small = recommendMemory({ modCount: 460, totalMemoryMb: 8192 });
    expect(small.capped).toBe(true);
    expect(small.maxMb).toBeLessThanOrEqual(8192 - 4096);
    expect(small.minMb).toBeLessThanOrEqual(small.maxMb);
  });

  it("caps a pack's own -Xmx at what the machine can spare", () => {
    const result = recommendMemory({
      modCount: 100,
      totalMemoryMb: 8192,
      statedMaxMb: 16384,
    });
    expect(result.capped).toBe(true);
    expect(result.source).toBe("pack");
    expect(result.maxMb).toBeLessThan(8192);
  });
});

describe("minecraft range matching", () => {
  it("handles Fabric semver and Maven intervals, and answers unknown for forms it cannot read", () => {
    expect(satisfiesMinecraft("~1.20.1", "1.20.4", "semver")).toBe(true);
    expect(satisfiesMinecraft(">=1.20 <1.21", "1.21.1", "semver")).toBe(false);
    expect(satisfiesMinecraft(["1.17.x", "1.18.x"], "1.18.2", "semver")).toBe(true);
    expect(satisfiesMinecraft("[1.20.1,1.21)", "1.20.4", "maven")).toBe(true);
    expect(satisfiesMinecraft("[1.20.1,1.21)", "1.21.1", "maven")).toBe(false);
    expect(satisfiesMinecraft("[1.21,)", "26.2", "maven")).toBe(true);
    expect(satisfiesMinecraft("1.20.1", "1.20.1", "maven")).toBeNull();
    expect(satisfiesMinecraft("whatever", "1.20.1", "semver")).toBeNull();
  });
});

describe("planLocalPack integration", () => {
  it("fills version, loader, Java and layers for a generic server pack", async () => {
    const archive = await packZip("Wrapped.zip", {
      "Wrapped/variables.txt":
        "MINECRAFT_VERSION=1.21.1\nMODLOADER=NeoForge\nMODLOADER_VERSION=21.1.77\n",
      "Wrapped/libraries/net/neoforged/neoforge/21.1.77/x.jar": "x",
    });
    const plan = await planLocalPack(archive);
    expect(plan.pack.format).toBe("generic");
    expect(plan.minecraftVersion).toBe("1.21.1");
    expect(plan.loaderType).toBe("neoForge");
    expect(plan.loaderVersion).toBe("21.1.77");
    expect(plan.requiredJavaMajor).toBe(21);
    expect(plan.archiveLayers).toEqual([
      { prefix: "Wrapped/", stripPrefix: true },
    ]);
    expect(plan.detection.kind).toBe("serverPack");
    // Evidence for the loader and version was found, so the pack is no longer
    // an unknown archive.
    expect(plan.warnings.map((item) => item.code)).not.toContain(
      "PACK_UNVERIFIED",
    );
  });

  it("still marks an archive with no evidence as unverified", async () => {
    const archive = await packZip("plain.zip", {
      "mods/example.jar": "jar",
      "start-server.bat": "java -jar server.jar",
    });
    const plan = await planLocalPack(archive);
    expect(plan.minecraftVersion).toBeNull();
    expect(plan.warnings.map((item) => item.code)).toContain("PACK_UNVERIFIED");
  });

  it("rejects an archive with an unsafe entry path before reading anything", async () => {
    const dir = tempDir();
    const target = path.join(dir, "evil.zip");
    // yazl refuses "..", so the name is written with a same-length stand-in
    // and patched in the bytes, the way the archive tests do it.
    await writeZip(target, [["aa/evil.txt", "x"]]);
    const bytes = fs.readFileSync(target);
    let offset = 0;
    const from = Buffer.from("aa/evil.txt");
    const to = Buffer.from("../evil.txt");
    while ((offset = bytes.indexOf(from, offset)) !== -1) {
      to.copy(bytes, offset);
      offset += to.length;
    }
    fs.writeFileSync(target, bytes);
    await expect(detectPack(target)).rejects.toMatchObject({
      code: "ARCHIVE_UNSAFE_PATH",
    });
  });
});
