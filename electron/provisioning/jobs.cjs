const fs = require("node:fs");
const path = require("node:path");
const { provisioningError } = require("./contracts.cjs");

const EXECUTION_STAGES = Object.freeze([
  "downloading",
  "verifying",
  "extracting",
  "installingRuntime",
  "installingLoader",
  "writingConfiguration",
  "awaitingEula",
  "committing",
  "starting",
]);

function requireJob(store, id) {
  const job = store.get(id);
  if (!job) throw provisioningError("JOB_NOT_FOUND", "Provisioning job not found.");
  return job;
}

function errorPayload(error, stage, committed) {
  return {
    code: error?.code || "JOB_STAGE_FAILED",
    stage,
    message: error?.message || String(error),
    detail: error?.detail || null,
    retryable: error?.retryable !== false,
    cleanupRequired: !committed,
  };
}

function createJobExecutor(dependencies) {
  const store = dependencies?.store;
  const handlers = dependencies?.handlers || {};
  const clock = dependencies?.clock || (() => new Date().toISOString());
  const idGenerator = dependencies?.idGenerator;
  const fileSystem = dependencies?.fs || fs;
  if (!store || typeof idGenerator !== "function") {
    throw new Error("job store and id generator are required");
  }

  function update(id, patch) {
    return store.update(id, { ...patch, updatedAt: clock() });
  }

  function createJob(plan) {
    const targetDir = path.resolve(String(plan?.targetDir || ""));
    if (!plan?.targetDir) {
      throw provisioningError("JOB_TARGET_REQUIRED", "Server target directory is required.");
    }
    if (fileSystem.existsSync(targetDir)) {
      throw provisioningError(
        "JOB_TARGET_EXISTS",
        "Server target directory already exists.",
      );
    }
    const id = idGenerator();
    const stagingDir = path.join(
      path.dirname(targetDir),
      `.${path.basename(targetDir)}.mcsm-stage-${id}`,
    );
    const timestamp = clock();
    return store.insert({
      id,
      serverId: null,
      stage: "planned",
      plan: structuredClone(plan),
      progress: { completedStages: [], resumeStage: "downloading" },
      stagingDir,
      targetDir,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async function executeJob(id) {
    let job = requireJob(store, id);
    if (job.stage === "ready") return job;
    if (job.stage === "failed") {
      const error = provisioningError(
        "JOB_RETRY_REQUIRED",
        "Retry the failed provisioning job before executing it again.",
      );
      error.retryable = false;
      throw error;
    }
    const completed = new Set(job.progress?.completedStages || []);
    let startStage = job.stage === "planned" ? "downloading" : job.stage;
    if (!EXECUTION_STAGES.includes(startStage)) startStage = "downloading";
    const startIndex = EXECUTION_STAGES.indexOf(startStage);
    fileSystem.mkdirSync(job.stagingDir, { recursive: true });

    for (let index = startIndex; index < EXECUTION_STAGES.length; index += 1) {
      const stage = EXECUTION_STAGES[index];
      if (completed.has(stage)) continue;
      job = update(id, {
        stage,
        error: null,
        progress: { ...job.progress, resumeStage: stage, completedStages: [...completed] },
      });
      try {
        if (stage === "committing") {
          if (fileSystem.existsSync(job.targetDir)) {
            throw provisioningError(
              "JOB_TARGET_EXISTS",
              "Server target appeared before the atomic commit.",
            );
          }
          fileSystem.renameSync(job.stagingDir, job.targetDir);
          job = update(id, {
            progress: { ...job.progress, committed: true, resumeStage: "starting" },
          });
        } else if (typeof handlers[stage] === "function") {
          await handlers[stage]({ job, plan: job.plan, stage });
        }
        completed.add(stage);
        job = update(id, {
          progress: {
            ...job.progress,
            completedStages: [...completed],
            resumeStage: EXECUTION_STAGES[index + 1] || "ready",
          },
        });
      } catch (error) {
        const committed = Boolean(job.progress?.committed || stage === "starting");
        const payload = errorPayload(error, stage, committed);
        update(id, {
          stage: "failed",
          error: payload,
          progress: {
            ...job.progress,
            completedStages: [...completed],
            resumeStage: stage,
          },
        });
        Object.assign(error, payload);
        throw error;
      }
    }
    return update(id, {
      stage: "ready",
      error: null,
      progress: { ...job.progress, completedStages: [...completed], resumeStage: null },
    });
  }

  async function retryJob(id) {
    let job = requireJob(store, id);
    if (job.stage !== "failed" || job.error?.retryable !== true) {
      throw provisioningError(
        "JOB_NOT_RETRYABLE",
        "Provisioning job is not in a retryable failed state.",
      );
    }
    const resumeStage = job.progress?.resumeStage || job.error.stage;
    job = update(id, { stage: resumeStage, error: null });
    return executeJob(job.id);
  }

  function cancelJob(id) {
    const job = requireJob(store, id);
    if (job.progress?.committed) {
      throw provisioningError(
        "JOB_ALREADY_COMMITTED",
        "Committed server files cannot be cancelled as a provisioning job.",
      );
    }
    if (fileSystem.existsSync(job.stagingDir)) {
      fileSystem.rmSync(job.stagingDir, { recursive: true, force: true });
    }
    return update(id, {
      stage: "failed",
      error: {
        code: "JOB_CANCELLED",
        stage: job.stage,
        message: "Provisioning was cancelled.",
        detail: null,
        retryable: false,
        cleanupRequired: false,
      },
    });
  }

  function listRecoverableJobs() {
    return store
      .list()
      .filter(
        (job) =>
          job.stage !== "ready" &&
          job.error?.code !== "JOB_CANCELLED" &&
          (job.stage !== "failed" || job.error?.retryable === true),
      );
  }

  return {
    cancelJob,
    createJob,
    executeJob,
    getJob: (id) => requireJob(store, id),
    listJobs: () => store.list(),
    listRecoverableJobs,
    retryJob,
  };
}

module.exports = { EXECUTION_STAGES, createJobExecutor };
