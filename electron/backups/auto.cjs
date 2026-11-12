"use strict";
/*
 * Automatic backups: when to take one, what to do when it fails, and which old
 * restore points to drop. The mechanics (hot flush, snapshot, DB row) live in
 * backend.cjs and are passed in, so this file has no knowledge of processes.
 */
const settings = require("./settings.cjs");
const { capBytesFor, pruneToCap, selectRetention } = require("./retention.cjs");

const TRIGGERS = {
  scheduled: () => true,
  pre_restart: (config) => config.beforeRestart,
  pre_update: (config) => config.beforeUpdate,
};

// Not a failure: there was simply nothing to back up yet, or a backup is
// already running.
const QUIET_CODES = new Set(["BACKUP_EMPTY", "BACKUP_IN_PROGRESS"]);

/* An update can change mods and config, so its point must be able to roll
   those back too. The newest few are kept out of retention (they still count
   toward used space). */
const PROTECTED_PRE_UPDATE_POINTS = 2;
const isFullPreUpdate = (backup) =>
  backup.trigger === "pre_update" && backup.kind === "fullServer";

function createAutoBackups({
  createBackup,
  deleteBackup,
  listBackups,
  measureBytes,
  notifyFailure,
  getActivity = null,
}) {
  /* A scheduled point is pointless when nobody has played since the last one:
     it would only push useful points out of retention. Unknown activity never
     skips: no earlier success, or we were not watching the whole time. */
  function isIdle(db, serverId, config) {
    if (!getActivity || !config.lastSuccessAt) return false;
    const lastSuccessMs = Date.parse(config.lastSuccessAt);
    if (Number.isNaN(lastSuccessMs)) return false;
    if (!listBackups(db, serverId).some((b) => b.status === "completed"))
      return false;
    const activity = getActivity(serverId);
    if (activity.online) return false;
    if (activity.lastActivityMs === null)
      return activity.trackingSinceMs <= lastSuccessMs;
    return activity.lastActivityMs < lastSuccessMs;
  }

  async function prune(db, serverId) {
    const config = settings.getBackupSettings(db, serverId);
    if (!config.configured) return [];
    const automatic = listBackups(db, serverId).filter(
      (backup) => backup.status === "completed" && backup.trigger !== "manual",
    );
    const protectedIds = new Set(
      automatic
        .filter(isFullPreUpdate)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, PROTECTED_PRE_UPDATE_POINTS)
        .map((backup) => backup.id),
    );
    const eligible = automatic.filter((backup) => !protectedIds.has(backup.id));
    const { remove } = selectRetention(eligible, config);
    for (const id of remove) await deleteBackup(db, id);
    const kept = eligible
      .filter((backup) => !remove.includes(backup.id))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (!measureBytes || kept.length < 2) return remove;
    const overCap = await pruneToCap({
      automatic: kept,
      capBytes: capBytesFor(config.maxTotalMb, kept[0].logicalBytes ?? 0),
      measureBytes: () => measureBytes(db, serverId),
      remove: (id) => deleteBackup(db, id),
    });
    return [...remove, ...overCap];
  }

  /* Never throws: callers are a scheduler tick and the paths in front of a
     restart or update, none of which may be derailed by a backup problem. */
  async function run(db, serverId, trigger, operation = null) {
    const config = settings.getBackupSettings(db, serverId);
    if (!config.enabled || !TRIGGERS[trigger]?.(config))
      return { status: "skipped" };
    if (trigger === "scheduled" && isIdle(db, serverId, config))
      return { status: "idle" };
    try {
      const backup = await createBackup(db, serverId, null, operation, {
        trigger,
        ...(trigger === "pre_update" ? { mode: "fullServer" } : {}),
      });
      if (!backup) {
        settings.markSuccess(db, serverId);
        return { status: "unchanged" };
      }
      settings.markSuccess(db, serverId);
      await prune(db, serverId).catch((error) =>
        notifyFailure(db, serverId, trigger, error),
      );
      return { status: "created", backup };
    } catch (error) {
      if (QUIET_CODES.has(error?.code)) return { status: "skipped", error };
      // createBackup has already raised the notification for this failure.
      return { status: "failed", error };
    }
  }

  async function runDue(db, now = new Date().toISOString()) {
    const results = [];
    for (const serverId of settings.dueServerIds(db, now)) {
      const result = await run(db, serverId, "scheduled");
      settings.recordRun(db, serverId, {
        ok: result.status !== "failed",
        idle: result.status === "idle",
      });
      results.push({ serverId, ...result });
    }
    return results;
  }

  return { run, runDue, prune };
}

module.exports = { createAutoBackups };
