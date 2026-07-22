/*
 * Windows denies file operations while another process holds the target open.
 * The two observed sources during provisioning are antivirus real-time scanning
 * (which opens each freshly written DLL, and is especially eager about names it
 * recognises from the system directory, e.g. ucrtbase.dll) and the image-section
 * handles the OS keeps for a process we just spawned. Both clear on their own;
 * retrying inside a bounded window is the remedy for that specific transient
 * condition. A block that never clears -- a hard antivirus deny -- still throws.
 *
 * Set MCSM_FS_RETRY_MS=0 to disable this and observe the raw error.
 */
const TRANSIENT_FS_ERROR_CODES = new Set([
  "EPERM",
  "EACCES",
  "EBUSY",
  "ENOTEMPTY",
]);

function isTransientFsError(error) {
  return TRANSIENT_FS_ERROR_CODES.has(error?.code);
}

async function retryTransientFsOperation(operation, description) {
  const budgetMs = Number(process.env.MCSM_FS_RETRY_MS ?? 5000);
  const deadline = Date.now() + budgetMs;
  let delayMs = 50;
  for (;;) {
    try {
      return await operation();
    } catch (caught) {
      if (!isTransientFsError(caught) || Date.now() >= deadline) {
        throw caught;
      }
      console.warn(
        `[provisioning] ${description} failed with ${caught.code}; retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 500);
    }
  }
}

module.exports = {
  TRANSIENT_FS_ERROR_CODES,
  isTransientFsError,
  retryTransientFsOperation,
};
