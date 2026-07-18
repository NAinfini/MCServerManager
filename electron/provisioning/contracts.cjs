const SUPPORTED_LOADERS = Object.freeze([
  "vanilla",
  "paper",
  "fabric",
  "forge",
  "neoForge",
  "quilt",
]);

const JOB_STAGES = Object.freeze([
  "planned",
  "downloading",
  "verifying",
  "extracting",
  "installingRuntime",
  "installingLoader",
  "writingConfiguration",
  "awaitingEula",
  "committing",
  "starting",
  "ready",
  "failed",
]);

function provisioningError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

module.exports = { JOB_STAGES, SUPPORTED_LOADERS, provisioningError };
