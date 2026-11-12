import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createBackend } = require("./backend.cjs");

let root, backend, profile, modsDir;
const call = (command, input) => backend.handle(command, { input });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-crash-mod-"));
  backend = createBackend({
    getPath: () => path.join(root, "data"),
    getVersion: () => "0",
  });
  profile = await call("create_server_profile", {
    source: { kind: "blank" },
    name: "server",
    rootDir: path.join(root, "server"),
    loaderType: "forge",
    minecraftVersion: "1.20.1",
    serverPort: 25565,
    minMemoryMb: 1024,
    maxMemoryMb: 2048,
  });
  modsDir = path.join(profile.rootDir, "mods");
  fs.mkdirSync(modsDir, { recursive: true });
});

afterEach(() => {
  backend.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("disable_crashed_mod", () => {
  it("disables a mod that the app never tracked", async () => {
    fs.writeFileSync(path.join(modsDir, "oculus.jar"), "jar");
    await call("disable_crashed_mod", {
      serverId: profile.id,
      modFile: "oculus.jar",
    });
    expect(fs.readdirSync(modsDir)).toEqual(["oculus.jar.disabled"]);
  });

  it.each(["../evil.jar", "..\evil.jar", "a/b.jar", "notes.txt", ".hidden.jar"])(
    "refuses %s",
    async (modFile) => {
      expect(() =>
        call("disable_crashed_mod", { serverId: profile.id, modFile }),
      ).toThrow(expect.objectContaining({ code: "INVALID_MOD_FILE" }));
    },
  );

  it("refuses a jar that is not there", async () => {
    expect(() =>
      call("disable_crashed_mod", {
        serverId: profile.id,
        modFile: "gone.jar",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_MOD_FILE" }));
  });
});
