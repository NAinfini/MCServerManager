"use strict";
/*
 * Per-server automatic backup settings and the additive columns that describe
 * a restore point. Everything here is idempotent and only adds: it runs on
 * every start against the owner's existing database.
 *
 * A server with no row has automatic backups OFF. Only servers created after
 * this change get a row (see seedDefaults), so existing servers are not
 * silently switched on.
 */
const path = require("node:path");
const { codedError } = require("../provisioning/contracts.cjs");
const { normalizePolicy, DEFAULT_POLICY } = require("./retention.cjs");

const DEFAULT_INTERVAL_MINUTES = 360;
const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 43_200;

function hasColumn(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function ensureBackupSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS server_backup_settings (
    server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    interval_minutes INTEGER NOT NULL DEFAULT ${DEFAULT_INTERVAL_MINUTES},
    before_restart INTEGER NOT NULL DEFAULT 1 CHECK (before_restart IN (0, 1)),
    before_update INTEGER NOT NULL DEFAULT 1 CHECK (before_update IN (0, 1)),
    keep_recent INTEGER NOT NULL DEFAULT ${DEFAULT_POLICY.keepRecent},
    keep_daily INTEGER NOT NULL DEFAULT ${DEFAULT_POLICY.keepDaily},
    keep_weekly INTEGER NOT NULL DEFAULT ${DEFAULT_POLICY.keepWeekly},
    location TEXT,
    next_run_at TEXT,
    last_success_at TEXT,
    updated_at TEXT NOT NULL
  )`);
  for (const [column, declaration] of Object.entries({
    trigger_kind: "TEXT NOT NULL DEFAULT 'manual'",
    format: "TEXT NOT NULL DEFAULT 'full'",
    logical_bytes: "INTEGER",
    new_bytes: "INTEGER",
  })) {
    if (!hasColumn(db, "backups", column))
      db.exec(`ALTER TABLE backups ADD COLUMN ${column} ${declaration}`);
  }
  if (!hasColumn(db, "server_backup_settings", "max_total_mb"))
    db.exec("ALTER TABLE server_backup_settings ADD COLUMN max_total_mb INTEGER");
}

function mapSettings(row, serverId) {
  if (!row)
    return {
      serverId,
      configured: false,
      enabled: false,
      intervalMinutes: DEFAULT_INTERVAL_MINUTES,
      beforeRestart: true,
      beforeUpdate: true,
      keepRecent: DEFAULT_POLICY.keepRecent,
      keepDaily: DEFAULT_POLICY.keepDaily,
      keepWeekly: DEFAULT_POLICY.keepWeekly,
      maxTotalMb: null,
      location: null,
      nextRunAt: null,
      lastSuccessAt: null,
    };
  return {
    serverId,
    configured: true,
    enabled: row.enabled !== 0,
    intervalMinutes: row.interval_minutes,
    beforeRestart: row.before_restart !== 0,
    beforeUpdate: row.before_update !== 0,
    keepRecent: row.keep_recent,
    keepDaily: row.keep_daily,
    keepWeekly: row.keep_weekly,
    maxTotalMb: row.max_total_mb || null,
    location: row.location || null,
    nextRunAt: row.next_run_at || null,
    lastSuccessAt: row.last_success_at || null,
  };
}

function getBackupSettings(db, serverId) {
  return mapSettings(
    db
      .prepare("SELECT * FROM server_backup_settings WHERE server_id = ?")
      .get(serverId),
    serverId,
  );
}

function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/* New servers: every 6 hours, before a scheduled restart and before an update. */
function seedDefaults(db, serverId, now = new Date().toISOString()) {
  db.prepare(
    `INSERT OR IGNORE INTO server_backup_settings
       (server_id, enabled, interval_minutes, before_restart, before_update,
        keep_recent, keep_daily, keep_weekly, location, next_run_at, updated_at)
     VALUES (?, 1, ?, 1, 1, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    serverId,
    DEFAULT_INTERVAL_MINUTES,
    DEFAULT_POLICY.keepRecent,
    DEFAULT_POLICY.keepDaily,
    DEFAULT_POLICY.keepWeekly,
    addMinutes(now, DEFAULT_INTERVAL_MINUTES),
    now,
  );
}

/* `serverRoot` lets the caller refuse a location inside the server folder,
   which would put snapshots inside their own backup scope. */
function validate(input, serverRoot) {
  const interval = Number(input.intervalMinutes);
  if (
    !Number.isInteger(interval) ||
    interval < MIN_INTERVAL_MINUTES ||
    interval > MAX_INTERVAL_MINUTES
  )
    throw codedError(
      "BACKUP_INTERVAL_INVALID",
      "backup interval must be between 15 minutes and 30 days",
    );
  let policy;
  try {
    policy = normalizePolicy({
      keepRecent: input.keepRecent,
      keepDaily: input.keepDaily,
      keepWeekly: input.keepWeekly,
    });
  } catch {
    throw codedError(
      "BACKUP_RETENTION_INVALID",
      "retention counts must be whole numbers and keep at least one recent backup",
    );
  }
  let maxTotalMb = null;
  if (input.maxTotalMb !== undefined && input.maxTotalMb !== null) {
    maxTotalMb = Number(input.maxTotalMb);
    if (!Number.isInteger(maxTotalMb) || maxTotalMb < 1)
      throw codedError(
        "BACKUP_RETENTION_INVALID",
        "the space limit must be a positive size",
      );
  }
  let location = null;
  if (typeof input.location === "string" && input.location.trim()) {
    if (!path.isAbsolute(input.location.trim()))
      throw codedError(
        "BACKUP_LOCATION_INVALID",
        "backup location must be an absolute folder path",
      );
    location = path.resolve(input.location.trim());
    const root = path.resolve(serverRoot);
    if (location === root || location.startsWith(`${root}${path.sep}`))
      throw codedError(
        "BACKUP_LOCATION_INVALID",
        "backup location must be outside the server folder",
      );
  }
  return { interval, policy, location, maxTotalMb };
}

function saveBackupSettings(db, input, serverRoot, now = new Date().toISOString()) {
  const serverId = input.serverId;
  const { interval, policy, location, maxTotalMb } = validate(input, serverRoot);
  const existing = getBackupSettings(db, serverId);
  const enabled = Boolean(input.enabled);
  // Re-time only when something that decides the next run changed.
  const nextRunAt = !enabled
    ? null
    : existing.enabled &&
        existing.intervalMinutes === interval &&
        existing.nextRunAt
      ? existing.nextRunAt
      : addMinutes(now, interval);
  db.prepare(
    `INSERT INTO server_backup_settings
       (server_id, enabled, interval_minutes, before_restart, before_update,
        keep_recent, keep_daily, keep_weekly, max_total_mb, location, next_run_at,
        last_success_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id) DO UPDATE SET
       enabled = excluded.enabled,
       interval_minutes = excluded.interval_minutes,
       before_restart = excluded.before_restart,
       before_update = excluded.before_update,
       keep_recent = excluded.keep_recent,
       keep_daily = excluded.keep_daily,
       keep_weekly = excluded.keep_weekly,
       max_total_mb = excluded.max_total_mb,
       location = excluded.location,
       next_run_at = excluded.next_run_at,
       updated_at = excluded.updated_at`,
  ).run(
    serverId,
    enabled ? 1 : 0,
    interval,
    input.beforeRestart ? 1 : 0,
    input.beforeUpdate ? 1 : 0,
    policy.keepRecent,
    policy.keepDaily,
    policy.keepWeekly,
    maxTotalMb,
    location,
    nextRunAt,
    existing.lastSuccessAt,
    now,
  );
  return getBackupSettings(db, serverId);
}

function dueServerIds(db, now = new Date().toISOString()) {
  return db
    .prepare(
      `SELECT server_id FROM server_backup_settings
        WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
        ORDER BY next_run_at ASC`,
    )
    .all(now)
    .map((row) => row.server_id);
}

/* After a scheduled attempt: success (or "nothing changed") moves the clock a
   full interval; a failure retries sooner so one bad night is not a 6h gap. */
function recordRun(
  db,
  serverId,
  { ok, idle = false, now = new Date().toISOString() },
) {
  const settings = getBackupSettings(db, serverId);
  if (!settings.configured) return;
  const wait = ok
    ? settings.intervalMinutes
    : Math.min(settings.intervalMinutes, 30);
  db.prepare(
    `UPDATE server_backup_settings
        SET next_run_at = ?, last_success_at = COALESCE(?, last_success_at)
      WHERE server_id = ?`,
  ).run(addMinutes(now, wait), ok && !idle ? now : null, serverId);
}

function markSuccess(db, serverId, now = new Date().toISOString()) {
  db.prepare(
    "UPDATE server_backup_settings SET last_success_at = ? WHERE server_id = ?",
  ).run(now, serverId);
}

module.exports = {
  DEFAULT_INTERVAL_MINUTES,
  ensureBackupSchema,
  getBackupSettings,
  saveBackupSettings,
  seedDefaults,
  dueServerIds,
  recordRun,
  markSuccess,
};
