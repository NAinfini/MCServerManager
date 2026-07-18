import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finished } from "node:stream/promises";
import yazl from "yazl";
import { describe, expect, it } from "vitest";
import { planLocalPack } from "./sources.cjs";

async function zipFixture(extension, entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-pack-fixture-"));
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

describe("local server-pack planning", () => {
  it("plans required and optional server files from a Modrinth pack", async () => {
    const index = {
      formatVersion: 1,
      game: "minecraft",
      versionId: "pack-version",
      name: "Automation Server",
      dependencies: {
        minecraft: "1.21.4",
        "fabric-loader": "0.16.10",
      },
      files: [
        {
          path: "mods/server-required.jar",
          hashes: { sha1: "required-sha1" },
          downloads: ["https://cdn.modrinth.com/server-required.jar"],
          fileSize: 123,
          env: { client: "required", server: "required" },
        },
        {
          path: "mods/server-optional.jar",
          hashes: { sha1: "optional-sha1" },
          downloads: ["https://cdn.modrinth.com/server-optional.jar"],
          fileSize: 45,
          env: { client: "optional", server: "optional" },
        },
        {
          path: "mods/client-only.jar",
          hashes: { sha1: "client-sha1" },
          downloads: ["https://cdn.modrinth.com/client-only.jar"],
          fileSize: 67,
          env: { client: "required", server: "unsupported" },
        },
      ],
    };
    const archive = await zipFixture("mrpack", [
      ["modrinth.index.json", JSON.stringify(index)],
      ["overrides/config/common.txt", "common"],
      ["server-overrides/config/server.txt", "server"],
    ]);

    const plan = await planLocalPack(archive);

    expect(plan).toMatchObject({
      source: { kind: "localModpackFile", path: archive },
      pack: { format: "modrinth", name: "Automation Server", versionId: "pack-version" },
      minecraftVersion: "1.21.4",
      loaderType: "fabric",
      loaderVersion: "0.16.10",
      requiredJavaMajor: 21,
      integrity: { status: "verified" },
    });
    expect(plan.artifacts).toEqual([
      expect.objectContaining({
        path: "mods/server-required.jar",
        size: 123,
        hashes: { sha1: "required-sha1" },
      }),
    ]);
    expect(plan.optionalFiles).toEqual([
      expect.objectContaining({ path: "mods/server-optional.jar" }),
    ]);
    expect(plan.archiveLayers).toEqual([
      { prefix: "overrides/", stripPrefix: true },
      { prefix: "server-overrides/", stripPrefix: true },
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("normalizes Quilt dependencies", async () => {
    const archive = await zipFixture("mrpack", [
      [
        "modrinth.index.json",
        JSON.stringify({
          formatVersion: 1,
          game: "minecraft",
          name: "Quilt Server",
          dependencies: { minecraft: "1.20.1", "quilt-loader": "0.26.4" },
          files: [],
        }),
      ],
    ]);

    await expect(planLocalPack(archive)).resolves.toMatchObject({
      loaderType: "quilt",
      loaderVersion: "0.26.4",
      requiredJavaMajor: 17,
    });
  });

  it("plans CurseForge manifest dependencies", async () => {
    const archive = await zipFixture("zip", [
      [
        "manifest.json",
        JSON.stringify({
          manifestType: "minecraftModpack",
          manifestVersion: 1,
          name: "Forge Server Pack",
          version: "2.0.0",
          minecraft: {
            version: "1.20.1",
            modLoaders: [{ id: "forge-47.2.0", primary: true }],
          },
          files: [
            { projectID: 10, fileID: 20, required: true },
            { projectID: 11, fileID: 21, required: false },
          ],
          overrides: "overrides",
        }),
      ],
      ["overrides/config/server.cfg", "config"],
    ]);

    const plan = await planLocalPack(archive);

    expect(plan).toMatchObject({
      pack: { format: "curseforge", name: "Forge Server Pack", versionId: "2.0.0" },
      minecraftVersion: "1.20.1",
      loaderType: "forge",
      loaderVersion: "47.2.0",
      requiredJavaMajor: 17,
    });
    expect(plan.artifacts).toEqual([
      expect.objectContaining({ provider: "curseforge", projectId: "10", fileId: "20" }),
    ]);
    expect(plan.optionalFiles).toEqual([
      expect.objectContaining({ provider: "curseforge", projectId: "11", fileId: "21" }),
    ]);
    expect(plan.archiveLayers).toEqual([
      { prefix: "overrides/", stripPrefix: true },
    ]);
  });

  it("marks generic archives as unverified but still plannable", async () => {
    const archive = await zipFixture("zip", [
      ["mods/example.jar", "jar"],
      ["start-server.bat", "java -jar server.jar"],
    ]);

    const plan = await planLocalPack(archive);

    expect(plan.pack.format).toBe("generic");
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({
        code: "PACK_UNVERIFIED",
        requiresAcknowledgement: true,
      }),
    );
    expect(plan.ignoredScripts).toEqual(["start-server.bat"]);
  });

  it("warns when a Modrinth pack contains only client files", async () => {
    const archive = await zipFixture("mrpack", [
      [
        "modrinth.index.json",
        JSON.stringify({
          formatVersion: 1,
          game: "minecraft",
          name: "Client Pack",
          dependencies: { minecraft: "1.21.4", "fabric-loader": "0.16.10" },
          files: [
            {
              path: "mods/client.jar",
              hashes: { sha1: "hash" },
              downloads: ["https://cdn.modrinth.com/client.jar"],
              env: { client: "required", server: "unsupported" },
            },
          ],
        }),
      ],
    ]);

    const plan = await planLocalPack(archive);

    expect(plan.warnings).toContainEqual(
      expect.objectContaining({
        code: "PACK_CLIENT_ONLY",
        requiresAcknowledgement: true,
      }),
    );
  });
});
