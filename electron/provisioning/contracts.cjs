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

// The message stays English and stays useful in logs; the code is what the
// renderer translates. main.cjs carries the code across IPC, which drops custom
// Error properties, and src/lib/desktop-command-error.ts resolves it against
// `desktop.error.<CODE>`. Every code must have a locale entry, which
// electron/error-codes.test.mjs enforces.
// mcsmCode exists alongside code because Node's own errors (ENOENT, EACCES)
// already use `code`, and only our codes may be translated.
function codedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, mcsmCode: code, ...details });
}

const provisioningError = codedError;

module.exports = {
  JOB_STAGES,
  SUPPORTED_LOADERS,
  codedError,
  provisioningError,
};
