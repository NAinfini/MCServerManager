import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finished } from "node:stream/promises";
import yazl from "yazl";
import { afterEach, describe, expect, it } from "vitest";
import { readModMetadata } from "./mod-metadata.cjs";

const tempDirs = [];

async function jarFixture(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-mod-"));
  tempDirs.push(root);
  const jarPath = path.join(root, "mod.jar");
  const zip = new yazl.ZipFile();
  for (const [name, content] of entries) {
    zip.addBuffer(Buffer.from(content), name);
  }
  zip.end();
  const output = fs.createWriteStream(jarPath);
  zip.outputStream.pipe(output);
  await finished(output);
  return jarPath;
}

describe("mod metadata", () => {
  afterEach(() => {
    for (const root of tempDirs.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // The reported case: four Forge 1.7.10 mods listed as "Unknown ID" and
  // "Unknown" version, while every one of them declares both in mcmod.info.
  it("reads a legacy Forge mod from mcmod.info", async () => {
    const jarPath = await jarFixture([
      [
        "mcmod.info",
        JSON.stringify([
          { modid: "fiskheroes", name: "Fisk's Superheroes", version: "2.4.0" },
        ]),
      ],
    ]);

    await expect(readModMetadata(jarPath)).resolves.toEqual({
      modId: "fiskheroes",
      name: "Fisk's Superheroes",
      version: "2.4.0",
    });
  });

  it("reads the modList wrapper some 1.7.10 build scripts emit", async () => {
    const jarPath = await jarFixture([
      [
        "mcmod.info",
        JSON.stringify({
          modListVersion: 2,
          modList: [
            { modid: "nei", name: "NotEnoughItems", version: "2.3.83" },
          ],
        }),
      ],
    ]);

    await expect(readModMetadata(jarPath)).resolves.toMatchObject({
      modId: "nei",
      version: "2.3.83",
    });
  });

  it("reads a Fabric mod from fabric.mod.json", async () => {
    const jarPath = await jarFixture([
      [
        "fabric.mod.json",
        JSON.stringify({ id: "sodium", name: "Sodium", version: "0.5.11" }),
      ],
    ]);

    await expect(readModMetadata(jarPath)).resolves.toEqual({
      modId: "sodium",
      name: "Sodium",
      version: "0.5.11",
    });
  });

  it("resolves the jar-version placeholder modern Forge leaves in its TOML", async () => {
    const jarPath = await jarFixture([
      [
        "META-INF/mods.toml",
        [
          'modLoader="javafml"',
          "[[mods]]",
          'modId="jei"',
          'version="${file.jarVersion}"',
          'displayName="Just Enough Items"',
        ].join("\n"),
      ],
      [
        "META-INF/MANIFEST.MF",
        "Manifest-Version: 1.0\r\nImplementation-Version: 15.3.0.4\r\n",
      ],
    ]);

    // Left unresolved this reaches the content table as the literal
    // "${file.jarVersion}", which is worse than saying nothing.
    await expect(readModMetadata(jarPath)).resolves.toEqual({
      modId: "jei",
      name: "Just Enough Items",
      version: "15.3.0.4",
    });
  });

  it("reads a Paper plugin from plugin.yml", async () => {
    const jarPath = await jarFixture([
      [
        "plugin.yml",
        "name: EssentialsX\nversion: 2.20.1\nmain: com.earth2me\n",
      ],
    ]);

    await expect(readModMetadata(jarPath)).resolves.toMatchObject({
      modId: "EssentialsX",
      version: "2.20.1",
    });
  });

  it("reports nothing rather than guessing when a jar declares nothing", async () => {
    const jarPath = await jarFixture([["README.txt", "not a mod"]]);

    await expect(readModMetadata(jarPath)).resolves.toEqual({
      modId: null,
      name: null,
      version: null,
    });
  });

  it("survives a corrupt descriptor instead of failing the whole listing", async () => {
    const jarPath = await jarFixture([["fabric.mod.json", "{ not json"]]);

    await expect(readModMetadata(jarPath)).resolves.toEqual({
      modId: null,
      name: null,
      version: null,
    });
  });
});
