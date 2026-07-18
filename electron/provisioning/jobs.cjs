const fs = require("node:fs");
const path = require("node:path");
const { provisioningError } = require("./contracts.cjs");
const { mergeProperties } = require("./properties.cjs");

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

const GUIDED_PROPERTY_MAP = Object.freeze({
  serverPort: "server-port",
  gameMode: "gamemode",
  difficulty: "difficulty",
  maxPlayers: "max-players",
  motd: "motd",
  onlineMode: "online-mode",
  pvp: "pvp",
  whiteList: "white-list",
  viewDistance: "view-distance",
  simulationDistance: "simulation-distance",
});

function gateError(code, message) {
  const error = provisioningError(code, message);
  error.retryable = false;
  return error;
}

function validateCommitGates(plan) {
  const acknowledged = new Set(plan.acknowledgedWarningCodes || []);
  const unacknowledged = (plan.compatibilityWarnings || []).find(
    (warning) =>
      warning?.requiresAcknowledgement === true &&
      warning?.acknowledged !== true &&
      !acknowledged.has(warning.code),
  );
  if (unacknowledged) {
    throw gateError(
      "COMPATIBILITY_ACK_REQUIRED",
      `Compatibility warning must be acknowledged: ${unacknowledged.code}`,
    );
  }
  if (
    plan.eula?.accepted !== true ||
    !plan.eula?.termsUrl ||
    !plan.eula?.acceptedAt
  ) {
    throw gateError(
      "EULA_ACCEPTANCE_REQUIRED",
      "Minecraft EULA acceptance must be explicitly confirmed by the user.",
    );
  }
  const minimum = Number(plan.configuration?.minMemoryMb);
  const maximum = Number(plan.configuration?.maxMemoryMb);
  if (
    !Number.isInteger(minimum) ||
    !Number.isInteger(maximum) ||
    minimum < 256 ||
    maximum < minimum
  ) {
    throw gateError(
      "MEMORY_CONFIGURATION_INVALID",
      "Minimum memory must be at least 256 MiB and no greater than maximum memory.",
    );
  }
  const port = Number(plan.configuration?.serverPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw gateError("SERVER_PORT_INVALID", "Server port must be between 1 and 65535.");
  }
  if (plan.javaRuntime?.validated !== true || !plan.javaRuntime?.path) {
    throw gateError(
      "JAVA_RUNTIME_INVALID",
      "A validated Java runtime is required before server creation.",
    );
  }
  if (
    plan.launchSpec?.validated !== true ||
    plan.launchSpec?.executable?.kind !== "java" ||
    !Array.isArray(plan.launchSpec?.jvmArgs) ||
    !Array.isArray(plan.launchSpec?.serverArgs)
  ) {
    throw gateError(
      "LAUNCH_SPEC_INVALID",
      "A validated server launch specification is required before server creation.",
    );
  }
}

function writeGuidedConfiguration(fileSystem, job) {
  const updates = {};
  for (const [field, property] of Object.entries(GUIDED_PROPERTY_MAP)) {
    const value = job.plan.configuration?.[field];
    if (value !== undefined && value !== null) updates[property] = value;
  }
  const propertiesPath = path.join(job.stagingDir, "server.properties");
  const existing = fileSystem.existsSync(propertiesPath)
    ? fileSystem.readFileSync(propertiesPath, "utf8")
    : "";
  const merged = mergeProperties(existing, updates);
  fileSystem.writeFileSync(propertiesPath, merged.raw, "utf8");
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
    if (plan?.useExistingTarget === true && !fileSystem.existsSync(targetDir)) {
      throw provisioningError(
        "JOB_EXISTING_TARGET_MISSING",
        "The existing server directory no longer exists.",
      );
    }
    if (fileSystem.existsSync(targetDir) && plan?.useExistingTarget !== true) {
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
          const replacingExisting = job.plan.useExistingTarget === true;
          const backupDir = `${job.targetDir}.mcsm-backup-${job.id}`;
          if (fileSystem.existsSync(job.targetDir) && !replacingExisting) {
            throw provisioningError(
              "JOB_TARGET_EXISTS",
              "Server target appeared before the atomic commit.",
            );
          }
          if (replacingExisting) {
            if (fileSystem.existsSync(backupDir)) {
              throw provisioningError(
                "JOB_BACKUP_EXISTS",
                "A prior existing-server backup blocks the atomic commit.",
              );
            }
            fileSystem.renameSync(job.targetDir, backupDir);
          }
          fileSystem.renameSync(job.stagingDir, job.targetDir);
          try {
            const commitPatch =
              typeof handlers.committing === "function"
                ? await handlers.committing({ job, plan: job.plan, stage })
                : null;
            job = update(id, {
              ...(commitPatch || {}),
              progress: {
                ...job.progress,
                committed: true,
                resumeStage: "starting",
              },
            });
            if (replacingExisting && fileSystem.existsSync(backupDir)) {
              fileSystem.rmSync(backupDir, { recursive: true, force: true });
            }
          } catch (error) {
            try {
              fileSystem.renameSync(job.targetDir, job.stagingDir);
              if (replacingExisting && fileSystem.existsSync(backupDir)) {
                fileSystem.renameSync(backupDir, job.targetDir);
              }
            } catch (rollbackError) {
              error.detail = {
                ...(error.detail || {}),
                rollbackError: rollbackError.message,
              };
            }
            throw error;
          }
        } else {
          if (stage === "writingConfiguration") {
            writeGuidedConfiguration(fileSystem, job);
          }
          if (stage === "awaitingEula") {
            validateCommitGates(job.plan);
            fileSystem.writeFileSync(
              path.join(job.stagingDir, "eula.txt"),
              "eula=true\n",
              "utf8",
            );
          }
          if (typeof handlers[stage] === "function") {
            const stagePatch = await handlers[stage]({
              job,
              plan: job.plan,
              stage,
            });
            if (stagePatch) job = update(id, stagePatch);
          }
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

module.exports = {
  EXECUTION_STAGES,
  GUIDED_PROPERTY_MAP,
  createJobExecutor,
  validateCommitGates,
};
