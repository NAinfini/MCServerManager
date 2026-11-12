"use strict";

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const OUTPUT_TAIL_BYTES = 8 * 1024;
const CLOSE_GRACE_MS = 5_000;

/* Runs an installer to completion. Its output must always be read: a child that
   fills an unread pipe blocks on its next write and never exits. Forge and
   NeoForge installers print far more than a pipe holds. */
function runToCompletion(spawnProcess, executable, args, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, args, {
      ...spawnOptions,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let tail = "";
    const keep = (chunk) => {
      tail = (tail + chunk.toString("utf8")).slice(-OUTPUT_TAIL_BYTES);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    const finish = (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, output: tail });
    };
    // "close" fires after the pipes are drained, so the tail is complete.
    child.once("close", finish);
    /* A grandchild that inherited the pipes can hold "close" back indefinitely
       after the installer itself has exited. */
    child.once("exit", (code) => {
      if (!child.stdout && !child.stderr) finish(code);
      else setTimeout(() => finish(code), CLOSE_GRACE_MS).unref?.();
    });
  });
}

module.exports = { runToCompletion };
