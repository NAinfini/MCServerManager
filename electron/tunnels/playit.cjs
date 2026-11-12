"use strict";

/* Runs the playit.gg agent as a child of the app and reports what can honestly
   be known about it.

   Verified against the 0.15.x CLI that is installed on the owner's machine
   (`playit.exe --help`, `run --help`, `secret-path`) and the open source
   playit-cloud/playit-agent repository:
     - `playit.exe -s run` runs the agent in the foreground and writes its
       tracing logs to stdout. There is no local status API or socket in that
       version, and the log line format is defined in a crate we could not
       observe a real session of.
     - the public address is not printed in a form we rely on. The user pastes
       it once; see playit-store in playit-service.cjs.
   So "running" means the process is alive and has stayed up past STABLE_MS. It
   is never reported as "connected": nothing here can prove the agent reached
   playit's servers. */

const fs = require("node:fs");
const path = require("node:path");
const { spawn: nodeSpawn } = require("node:child_process");

const STABLE_MS = 8_000;
const BACKOFF_MS = [2_000, 5_000, 10_000, 30_000, 60_000];
const MAX_RESTARTS = 8;
const DOWNLOAD_URL = "https://playit.gg/download";

function candidateExePaths(env, platform) {
  const exe = platform === "win32" ? "playit.exe" : "playit";
  const dirs = [];
  if (platform === "win32") {
    for (const base of [
      env.ProgramFiles,
      env["ProgramFiles(x86)"],
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs"),
    ]) {
      if (base) {
        dirs.push(path.join(base, "playit_gg", "bin"));
        dirs.push(path.join(base, "playit_gg"));
      }
    }
  } else {
    dirs.push("/usr/local/bin", "/usr/bin", "/opt/playit");
  }
  for (const dir of String(env.PATH || env.Path || "").split(path.delimiter)) {
    if (dir) dirs.push(dir);
  }
  return dirs.map((dir) => path.join(dir, exe));
}

function locatePlayit({
  override,
  existsSync = fs.existsSync,
  env = process.env,
  platform = process.platform,
} = {}) {
  if (override && existsSync(override)) return override;
  return (
    candidateExePaths(env, platform).find((candidate) =>
      existsSync(candidate),
    ) ?? null
  );
}

/* Where `playit secret-path` printed the agent's secret on this machine. Only
   its existence is checked; the file is never opened. */
function playitSecretPath({ env = process.env, platform = process.platform } = {}) {
  if (platform === "win32" && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, "playit_gg", "playit.toml");
  }
  if (platform === "darwin" && env.HOME) {
    return path.join(
      env.HOME,
      "Library",
      "Application Support",
      "playit_gg",
      "playit.toml",
    );
  }
  const config = env.XDG_CONFIG_HOME || (env.HOME && path.join(env.HOME, ".config"));
  return config ? path.join(config, "playit_gg", "playit.toml") : null;
}

/* Agent output can include claim links and key material; keep only a short,
   scrubbed line for the UI. */
function scrubLine(line) {
  return String(line)
    .replace(/[A-Fa-f0-9]{32,}/g, "[redacted]")
    .replace(/(secret|key|token)(\s*[=:]\s*)\S+/gi, "$1$2[redacted]")
    .slice(0, 200);
}

const ERROR_LINE = /\b(error|failed|invalid|expired|unauthori[sz]ed|denied)\b/i;

function createPlayitAgent({
  spawn = nodeSpawn,
  existsSync = fs.existsSync,
  env = process.env,
  platform = process.platform,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  getSettings = () => ({ exePath: null, stopWhenIdle: true }),
  onChange = () => {},
  onDrop = () => {},
} = {}) {
  const refs = new Set();
  let child = null;
  let stable = false;
  let stopping = false;
  let attempts = 0;
  let gaveUp = false;
  let dropReported = false;
  let retryTimer = null;
  let stableTimer = null;
  let lastError = null;
  let exitCode = null;

  const exePath = () =>
    locatePlayit({
      override: getSettings().exePath,
      existsSync,
      env,
      platform,
    });
  const secretPath = () => playitSecretPath({ env, platform });
  const secretFound = () => {
    const file = secretPath();
    return Boolean(file && existsSync(file));
  };

  function status() {
    const exe = exePath();
    let state;
    if (!exe) state = "not_installed";
    else if (!secretFound()) state = "needs_setup";
    else if (child) state = stable ? "running" : "starting";
    else if (retryTimer || gaveUp) state = "disconnected";
    else state = "stopped";
    return {
      state,
      exePath: exe,
      pid: child?.pid ?? null,
      activeServerIds: [...refs],
      restartAttempt: attempts,
      gaveUp,
      lastError,
      exitCode,
      stopWhenIdle: getSettings().stopWhenIdle !== false,
      downloadUrl: DOWNLOAD_URL,
    };
  }

  const changed = () => onChange(status());

  function clearTimers() {
    if (retryTimer) clearTimer(retryTimer);
    if (stableTimer) clearTimer(stableTimer);
    retryTimer = null;
    stableTimer = null;
  }

  function launch() {
    const exe = exePath();
    if (!exe || !secretFound() || child) return;
    stopping = false;
    stable = false;
    let spawned;
    try {
      spawned = spawn(exe, ["-s", "run"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      lastError = scrubLine(error?.message || "spawn failed");
      handleExit(null, null);
      return;
    }
    child = spawned;
    const mine = spawned;
    const onData = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim() && ERROR_LINE.test(line)) {
          lastError = scrubLine(line.trim());
        }
      }
    };
    mine.stdout?.on("data", onData);
    mine.stderr?.on("data", onData);
    mine.on("error", (error) => {
      lastError = scrubLine(error?.message || "process error");
      if (child === mine) handleExit(null, null);
    });
    mine.on("exit", (code) => {
      if (child === mine) handleExit(code, mine);
    });
    stableTimer = setTimer(() => {
      stableTimer = null;
      if (child !== mine) return;
      stable = true;
      attempts = 0;
      gaveUp = false;
      dropReported = false;
      lastError = null;
      changed();
    }, STABLE_MS);
    stableTimer.unref?.();
    changed();
  }

  function handleExit(code) {
    const wasStopping = stopping;
    child = null;
    stable = false;
    exitCode = code ?? null;
    if (stableTimer) clearTimer(stableTimer);
    stableTimer = null;
    if (wasStopping || refs.size === 0) {
      clearTimers();
      // A server asked for the tunnel while the old agent was still exiting.
      if (wasStopping && refs.size > 0) launch();
      else changed();
      return;
    }
    if (!dropReported) {
      dropReported = true;
      onDrop({ serverIds: [...refs], exitCode: exitCode, lastError });
    }
    if (attempts >= MAX_RESTARTS) {
      gaveUp = true;
      changed();
      return;
    }
    const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
    attempts += 1;
    retryTimer = setTimer(() => {
      retryTimer = null;
      launch();
    }, delay);
    retryTimer.unref?.();
    changed();
  }

  function stop() {
    stopping = true;
    clearTimers();
    gaveUp = false;
    attempts = 0;
    dropReported = false;
    if (child) {
      try {
        child.kill();
      } catch {
        // The process may already be gone.
      }
    } else {
      changed();
    }
  }

  return {
    status,
    /* One agent serves every server that asked for it; the Set is the refcount
       and acquiring twice for the same server counts once. */
    acquire(serverId) {
      refs.add(serverId);
      if (!child && !retryTimer) {
        gaveUp = false;
        attempts = 0;
        dropReported = false;
        launch();
      }
      changed();
      return status();
    },
    release(serverId) {
      if (!refs.delete(serverId)) return status();
      if (refs.size === 0) {
        if (getSettings().stopWhenIdle !== false) stop();
        else {
          clearTimers();
          gaveUp = false;
          changed();
        }
      } else changed();
      return status();
    },
    /* The app is quitting: the agent never outlives it. */
    dispose() {
      refs.clear();
      stop();
    },
    /* Retry now, e.g. after the user finished setup or installed the agent. */
    retry() {
      if (refs.size > 0 && !child) {
        clearTimers();
        gaveUp = false;
        attempts = 0;
        dropReported = false;
        launch();
      }
      changed();
      return status();
    },
  };
}

module.exports = {
  DOWNLOAD_URL,
  STABLE_MS,
  BACKOFF_MS,
  MAX_RESTARTS,
  createPlayitAgent,
  locatePlayit,
  playitSecretPath,
  scrubLine,
};
