import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { runToCompletion } = require("./run-process.cjs");

const script = (source) => [process.execPath, ["-e", source]];

describe("runToCompletion", () => {
  it("finishes a process that prints more than a pipe can hold", async () => {
    const [node, args] = script(
      'for (let i = 0; i < 40; i++) { process.stdout.write("x".repeat(65536)); process.stderr.write("y".repeat(65536)); } console.log("END");',
    );
    const result = await runToCompletion(spawn, node, args, {
      timeoutMs: 30_000,
    });
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.output.length).toBeLessThanOrEqual(8192);
  }, 40_000);

  it("reports a failing exit code with the end of its output", async () => {
    const [node, args] = script(
      'console.error("Processor failed: bad hash"); process.exit(3);',
    );
    const result = await runToCompletion(spawn, node, args);
    expect(result.code).toBe(3);
    expect(result.output).toContain("Processor failed: bad hash");
  });

  it("stops a process that never finishes", async () => {
    const [node, args] = script("setInterval(() => {}, 1000);");
    const result = await runToCompletion(spawn, node, args, { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
  }, 20_000);
});
