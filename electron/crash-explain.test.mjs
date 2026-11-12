import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { explainServerCrash } = require("./crash-explain.cjs");

const roots = [];
function server(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-crash-"));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("explainServerCrash", () => {
  it("names the client-only mod from a real Forge crash report", () => {
    const root = server({
      "crash-reports/crash-1-fml.txt": [
        "Description: Mod loading error has occurred",
        "\tMod File: /C:/srv/mods/oculus-mc1.20.1-1.8.0.jar",
        "\tFailure message: Oculus (oculus) has failed to load correctly",
        "\tException message: java.lang.RuntimeException: Attempted to load class net/minecraft/client/gui/screens/Screen for invalid dist DEDICATED_SERVER",
      ].join("\n"),
    });
    expect(explainServerCrash({ root })).toMatchObject({
      kind: "clientOnlyMod",
      deterministic: true,
      modFile: "oculus-mc1.20.1-1.8.0.jar",
      modName: "Oculus",
      reportFile: "crash-reports/crash-1-fml.txt",
    });
  });

  it("names a client-only Fabric mod from the log when there is no report", () => {
    const root = server({
      "mods/better_tab-2.2.3+26.2-fabric.jar": "jar",
      "mods/betterstats-5.8.0.jar": "jar",
      "logs/latest.log": [
        "[main/WARN]: Error loading class: net/minecraft/client/MouseHandler (java.lang.ClassNotFoundException: net/minecraft/client/MouseHandler)",
        "java.lang.RuntimeException: Could not execute entrypoint stage 'main' due to errors, provided by 'better_tab' at 'net.tricube.better_tab.platform.fabric.FabricEntrypoint'!",
        "Caused by: java.lang.NoClassDefFoundError: net/minecraft/client/gui/screens/Screen",
      ].join("\n"),
    });
    expect(explainServerCrash({ root })).toMatchObject({
      kind: "clientOnlyMod",
      deterministic: true,
      modFile: "better_tab-2.2.3+26.2-fabric.jar",
      modName: "better_tab",
      reportFile: null,
    });
  });

  it("does not blame a Fabric mod for a failure unrelated to client classes", () => {
    const root = server({
      "logs/latest.log": [
        "[main/WARN]: Error loading class: net/minecraft/client/MouseHandler (java.lang.ClassNotFoundException: net/minecraft/client/MouseHandler)",
        "java.lang.RuntimeException: Could not execute entrypoint stage 'main' due to errors, provided by 'some_mod' at 'a.B'!",
        "Caused by: java.lang.IllegalStateException: bad config",
      ].join("\n"),
    });
    expect(explainServerCrash({ root }).kind).toBe("unknown");
  });

  it("recognises mod incompatibility and keeps the lines that explain it", () => {
    const root = server({
      "logs/latest.log":
        "[main/ERROR]: Incompatible mods found!\nsome-mod requires version 1.21 of minecraft\n",
    });
    const result = explainServerCrash({ root });
    expect(result.kind).toBe("modIncompatible");
    expect(result.deterministic).toBe(true);
    expect(result.detail).toContain("requires version 1.21");
  });

  it("does not blame a report left over from an earlier run", () => {
    const root = server({
      "crash-reports/old.txt": "for invalid dist DEDICATED_SERVER",
    });
    expect(
      explainServerCrash({ root, sinceMs: Date.now() + 60_000 }).kind,
    ).toBe("unknown");
  });

  it("stays unknown when nothing states a cause", () => {
    expect(explainServerCrash({ root: server({}) })).toMatchObject({
      kind: "unknown",
      deterministic: false,
      reportFile: null,
    });
  });
});
