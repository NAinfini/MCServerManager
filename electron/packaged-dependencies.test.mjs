import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

// electron-builder copies every production dependency into the asar as-is. The
// renderer's packages are already inlined into dist/ by Vite, so listing one as a
// production dependency ships it twice. That is how the first packaged build
// reached 148 MB, 130 MB of which was renderer source nothing ever loaded.
// Production dependencies must therefore be exactly what electron/ require()s.
const BARE_REQUIRE = /require\(\s*["']([^"'.][^"']*)["']\s*\)/g;

// Provided by the Electron runtime rather than node_modules.
const RUNTIME_PROVIDED = new Set(["electron"]);

function collectMainProcessRequires(dir, found = new Set()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMainProcessRequires(full, found);
      continue;
    }
    // Test files and the UI smoke are excluded from the package, so what they
    // require says nothing about what has to ship.
    if (!/\.(cjs|js|mjs)$/.test(entry.name)) continue;
    if (/\.test\.mjs$/.test(entry.name) || entry.name === "ui-smoke.cjs") continue;

    const source = fs.readFileSync(full, "utf8");
    for (const match of source.matchAll(BARE_REQUIRE)) {
      const request = match[1];
      if (request.startsWith("node:")) continue;
      const segments = request.split("/");
      const name = request.startsWith("@")
        ? segments.slice(0, 2).join("/")
        : segments[0];
      if (!RUNTIME_PROVIDED.has(name)) found.add(name);
    }
  }
  return found;
}

describe("packaged production dependencies", () => {
  it("lists exactly the modules the main process loads at runtime", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    const required = [...collectMainProcessRequires(path.join(root, "electron"))];

    expect(required.length).toBeGreaterThan(0);
    expect(Object.keys(manifest.dependencies).sort()).toEqual(required.sort());
  });

  it("keeps renderer packages out of the production dependency set", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );

    for (const name of [
      "react",
      "react-dom",
      "monaco-editor",
      "@monaco-editor/react",
      "lucide-react",
      "@xterm/xterm",
      "motion",
      "zustand",
    ]) {
      expect(manifest.dependencies, `${name} must not ship twice`).not.toHaveProperty(name);
      expect(manifest.devDependencies).toHaveProperty(name);
    }
  });
});
