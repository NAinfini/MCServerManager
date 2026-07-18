import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const tempDirs = [];

class MemoryJobStore {
  constructor() {
    this.jobs = new Map();
    this.writes = [];
  }

  insert(job) {
    this.jobs.set(job.id, structuredClone(job));
    this.writes.push(structuredClone(job));
    return this.get(job.id);
  }

  get(id) {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : null;
  }

  update(id, patch) {
    const job = { ...this.jobs.get(id), ...structuredClone(patch) };
    this.jobs.set(id, job);
    this.writes.push(structuredClone(job));
    return this.get(id);
  }

  list() {
    return [...this.jobs.values()].map((job) => structuredClone(job));
  }
}

function tempTarget(name = "server") {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mcsm-jobs-"));
  tempDirs.push(parent);
  return path.join(parent, name);
}

function makeExecutor(options = {}) {
  const { createJobExecutor } = require("./jobs.cjs");
  const store = options.store || new MemoryJobStore();
  let id = 0;
  const executor = createJobExecutor({
    store,
    idGenerator: () => `job-${++id}`,
    clock: () => "2026-07-18T12:00:00.000Z",
    handlers: options.handlers || {},
  });
  return { executor, store };
}

describe("resumable provisioning jobs", () => {
  afterEach(() => {
    for (const root of tempDirs.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists every stage in order and commits from a same-parent staging directory", async () => {
    const targetDir = tempTarget();
    const seen = [];
    const handlers = Object.fromEntries(
      [
        "downloading",
        "verifying",
        "extracting",
        "installingRuntime",
        "installingLoader",
        "writingConfiguration",
        "awaitingEula",
      ].map((stage) => [
        stage,
        vi.fn(async ({ job }) => {
          seen.push(stage);
          if (stage === "extracting") {
            fs.writeFileSync(path.join(job.stagingDir, "server.jar"), "server");
          }
        }),
      ]),
    );
    handlers.starting = vi.fn(async () => seen.push("starting"));
    const { executor, store } = makeExecutor({ handlers });
    const job = executor.createJob({ targetDir, eulaAccepted: true });

    const ready = await executor.executeJob(job.id);

    expect(seen).toEqual([
      "downloading",
      "verifying",
      "extracting",
      "installingRuntime",
      "installingLoader",
      "writingConfiguration",
      "awaitingEula",
      "starting",
    ]);
    expect(ready.stage).toBe("ready");
    expect(path.dirname(job.stagingDir)).toBe(path.dirname(targetDir));
    expect(fs.existsSync(path.join(targetDir, "server.jar"))).toBe(true);
    expect(store.writes.map((entry) => entry.stage)).toEqual(
      expect.arrayContaining(["planned", "downloading", "committing", "ready"]),
    );
  });

  it.each([
    ["downloading", "NETWORK_DOWN"],
    ["verifying", "HASH_MISMATCH"],
  ])("persists an explicit retryable %s failure", async (stage, code) => {
    const targetDir = tempTarget();
    const { executor } = makeExecutor({
      handlers: {
        [stage]: async () => {
          throw Object.assign(new Error(`${stage} failed`), { code, retryable: true });
        },
      },
    });
    const job = executor.createJob({ targetDir, eulaAccepted: true });

    await expect(executor.executeJob(job.id)).rejects.toMatchObject({ code });
    expect(executor.getJob(job.id)).toMatchObject({
      stage: "failed",
      error: {
        code,
        stage,
        retryable: true,
        cleanupRequired: true,
      },
      progress: { resumeStage: stage },
    });
  });

  it("cancels safely before commit and removes staging data", () => {
    const targetDir = tempTarget();
    const { executor } = makeExecutor();
    const job = executor.createJob({ targetDir, eulaAccepted: true });
    fs.mkdirSync(job.stagingDir, { recursive: true });
    fs.writeFileSync(path.join(job.stagingDir, "partial"), "data");

    const cancelled = executor.cancelJob(job.id);

    expect(cancelled.stage).toBe("failed");
    expect(cancelled.error.code).toBe("JOB_CANCELLED");
    expect(fs.existsSync(job.stagingDir)).toBe(false);
    expect(fs.existsSync(targetDir)).toBe(false);
  });

  it("lists unfinished jobs after an executor is recreated", () => {
    const store = new MemoryJobStore();
    const first = makeExecutor({ store }).executor;
    const job = first.createJob({ targetDir: tempTarget(), eulaAccepted: true });
    store.update(job.id, { stage: "extracting" });

    const restarted = makeExecutor({ store }).executor;

    expect(restarted.listRecoverableJobs()).toEqual([
      expect.objectContaining({ id: job.id, stage: "extracting" }),
    ]);
  });

  it("retries from the failed stage without repeating completed stages", async () => {
    const targetDir = tempTarget();
    let verifyAttempts = 0;
    const downloading = vi.fn();
    const { executor } = makeExecutor({
      handlers: {
        downloading,
        verifying: async () => {
          verifyAttempts += 1;
          if (verifyAttempts === 1) {
            throw Object.assign(new Error("bad hash"), {
              code: "HASH_MISMATCH",
              retryable: true,
            });
          }
        },
      },
    });
    const job = executor.createJob({ targetDir, eulaAccepted: true });
    await expect(executor.executeJob(job.id)).rejects.toMatchObject({
      code: "HASH_MISMATCH",
    });

    const ready = await executor.retryJob(job.id);

    expect(ready.stage).toBe("ready");
    expect(downloading).toHaveBeenCalledTimes(1);
    expect(verifyAttempts).toBe(2);
  });

  it("rejects an existing target before writing staging data", () => {
    const targetDir = tempTarget();
    fs.mkdirSync(targetDir);
    const { executor } = makeExecutor();

    expect(() =>
      executor.createJob({ targetDir, eulaAccepted: true }),
    ).toThrowError(expect.objectContaining({ code: "JOB_TARGET_EXISTS" }));
    expect(fs.readdirSync(path.dirname(targetDir))).toEqual([path.basename(targetDir)]);
  });

  it("keeps committed files when startup fails", async () => {
    const targetDir = tempTarget();
    const { executor } = makeExecutor({
      handlers: {
        extracting: async ({ job }) => {
          fs.writeFileSync(path.join(job.stagingDir, "server.jar"), "server");
        },
        starting: async () => {
          throw Object.assign(new Error("process exited"), {
            code: "START_FAILED",
            retryable: true,
          });
        },
      },
    });
    const job = executor.createJob({ targetDir, eulaAccepted: true });

    await expect(executor.executeJob(job.id)).rejects.toMatchObject({
      code: "START_FAILED",
    });
    expect(fs.existsSync(path.join(targetDir, "server.jar"))).toBe(true);
    expect(executor.getJob(job.id).error).toMatchObject({
      stage: "starting",
      cleanupRequired: false,
    });
  });
});
