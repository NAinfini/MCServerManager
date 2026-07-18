import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finished } from "node:stream/promises";
import yazl from "yazl";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ARCHIVE_LIMITS,
  extractZipLayers,
  inspectZip,
  readJsonEntry,
} from "./archive.cjs";

async function zipFixture(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-zip-fixture-"));
  const archivePath = path.join(root, "fixture.zip");
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    zip.addBuffer(Buffer.from(entry.content), entry.name, entry.options);
  }
  zip.end();
  const output = fs.createWriteStream(archivePath);
  zip.outputStream.pipe(output);
  await finished(output);
  return archivePath;
}

function replaceEntryName(archivePath, from, to) {
  expect(Buffer.byteLength(from)).toBe(Buffer.byteLength(to));
  const source = fs.readFileSync(archivePath);
  const fromBytes = Buffer.from(from);
  const toBytes = Buffer.from(to);
  let offset = 0;
  let replacements = 0;
  while ((offset = source.indexOf(fromBytes, offset)) !== -1) {
    toBytes.copy(source, offset);
    offset += toBytes.length;
    replacements += 1;
  }
  expect(replacements).toBeGreaterThan(0);
  fs.writeFileSync(archivePath, source);
  return archivePath;
}

describe("provisioning ZIP archive safety", () => {
  it("inspects, reads JSON, and extracts selected layers", async () => {
    const archive = await zipFixture([
      {
        name: "modrinth.index.json",
        content: JSON.stringify({ game: "minecraft", formatVersion: 1 }),
      },
      { name: "overrides/config/common.txt", content: "common" },
      { name: "server-overrides/config/server.txt", content: "server" },
      { name: "client-overrides/options.txt", content: "client" },
    ]);

    const inspection = await inspectZip(archive);
    expect(inspection.entries.map((entry) => entry.path)).toContain(
      "server-overrides/config/server.txt",
    );
    await expect(readJsonEntry(archive, "modrinth.index.json")).resolves.toEqual({
      game: "minecraft",
      formatVersion: 1,
    });

    const destination = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-zip-output-"));
    await extractZipLayers(archive, destination, [
      { prefix: "overrides/", stripPrefix: true },
      { prefix: "server-overrides/", stripPrefix: true },
    ]);

    expect(fs.readFileSync(path.join(destination, "config", "common.txt"), "utf8"))
      .toBe("common");
    expect(fs.readFileSync(path.join(destination, "config", "server.txt"), "utf8"))
      .toBe("server");
    expect(fs.existsSync(path.join(destination, "options.txt"))).toBe(false);
  });

  it.each([
    ["aa/escape.txt", "../escape.txt"],
    ["safe.txt", "/abs.txt"],
    ["aa/x.txt", "C:/x.txt"],
  ])("rejects unsafe entry path %s", async (safeName, unsafeName) => {
    const archive = replaceEntryName(
      await zipFixture([{ name: safeName, content: "bad" }]),
      safeName,
      unsafeName,
    );

    await expect(inspectZip(archive)).rejects.toMatchObject({
      code: "ARCHIVE_UNSAFE_PATH",
    });
  });

  it("rejects symbolic links", async () => {
    const archive = await zipFixture([
      { name: "linked-file", content: "target", options: { mode: 0o120777 } },
    ]);

    await expect(inspectZip(archive)).rejects.toMatchObject({
      code: "ARCHIVE_UNSAFE_LINK",
    });
  });

  it("enforces entry-count and total-size limits", async () => {
    const archive = await zipFixture([
      { name: "one.txt", content: "1234" },
      { name: "two.txt", content: "5678" },
    ]);

    await expect(
      inspectZip(archive, { ...DEFAULT_ARCHIVE_LIMITS, maxEntries: 1 }),
    ).rejects.toMatchObject({ code: "ARCHIVE_TOO_MANY_ENTRIES" });
    await expect(
      inspectZip(archive, { ...DEFAULT_ARCHIVE_LIMITS, maxUncompressedBytes: 7 }),
    ).rejects.toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
  });

  it("rejects suspicious compression ratios", async () => {
    const archive = await zipFixture([
      { name: "repeated.txt", content: "A".repeat(100_000) },
    ]);

    await expect(
      inspectZip(archive, { ...DEFAULT_ARCHIVE_LIMITS, maxCompressionRatio: 2 }),
    ).rejects.toMatchObject({ code: "ARCHIVE_SUSPICIOUS_RATIO" });
  });
});
