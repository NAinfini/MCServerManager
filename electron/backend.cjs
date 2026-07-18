const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { isIP } = require("node:net");
const { DatabaseSync } = require("node:sqlite");
const zlib = require("node:zlib");
const { mergeProperties } = require("./provisioning/properties.cjs");
const { planLocalPack } = require("./provisioning/sources.cjs");
const { createLoaderRegistry } = require("./provisioning/loaders.cjs");
const {
  createRuntimeManager,
  requiredJavaMajorForMinecraft: runtimeRequiredJavaMajor,
} = require("./provisioning/runtimes.cjs");
const { createJobExecutor } = require("./provisioning/jobs.cjs");
const { provisioningError } = require("./provisioning/contracts.cjs");
const {
  extractZipArchive,
  extractZipLayers,
} = require("./provisioning/archive.cjs");

const managedChildren = new Map();
const closedDatabases = new WeakSet();
const databaseAppDataDirs = new WeakMap();
const databaseProcessSpawners = new WeakMap();
const databaseMetricCollectors = new WeakMap();
const databaseMetricBaselines = new WeakMap();
const databaseRuntimeDependencies = new WeakMap();
const restartRuntimeState = new Map();
const restartCountdownTimers = new Map();
const currentSchemaVersion = 2;

const loaderToDb = {
  vanilla: "vanilla",
  paper: "paper",
  forge: "forge",
  neoForge: "neoforge",
  fabric: "fabric",
  quilt: "quilt",
};

const loaderFromDb = {
  vanilla: "vanilla",
  paper: "paper",
  forge: "forge",
  neoforge: "neoForge",
  fabric: "fabric",
  quilt: "quilt",
};

const coreSchema = `
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_dir TEXT NOT NULL,
  minecraft_version TEXT,
  loader_type TEXT NOT NULL CHECK (loader_type IN ('vanilla', 'paper', 'forge', 'neoforge', 'fabric', 'quilt')),
  loader_version TEXT,
  java_path TEXT,
  server_port INTEGER CHECK (server_port IS NULL OR (server_port >= 1 AND server_port <= 65535)),
  min_memory_mb INTEGER CHECK (min_memory_mb IS NULL OR min_memory_mb > 0),
  max_memory_mb INTEGER CHECK (max_memory_mb IS NULL OR max_memory_mb > 0),
  auto_start INTEGER NOT NULL DEFAULT 0 CHECK (auto_start IN (0, 1)),
  launch_spec_json TEXT,
  compatibility_warning_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (min_memory_mb IS NULL OR max_memory_mb IS NULL OR min_memory_mb <= max_memory_mb)
);

CREATE TABLE IF NOT EXISTS server_restart_policies (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 0),
  cooldown_seconds INTEGER NOT NULL DEFAULT 30 CHECK (cooldown_seconds >= 0)
);

CREATE TABLE IF NOT EXISTS managed_processes (
  id TEXT PRIMARY KEY,
  server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
  pid INTEGER,
  command TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  exited_at TEXT,
  exit_code INTEGER
);

CREATE TABLE IF NOT EXISTS process_events (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  desktop_enabled INTEGER NOT NULL DEFAULT 1 CHECK (desktop_enabled IN (0, 1)),
  crash_enabled INTEGER NOT NULL DEFAULT 1 CHECK (crash_enabled IN (0, 1)),
  restart_failed_enabled INTEGER NOT NULL DEFAULT 1 CHECK (restart_failed_enabled IN (0, 1)),
  backup_failed_enabled INTEGER NOT NULL DEFAULT 1 CHECK (backup_failed_enabled IN (0, 1)),
  task_failed_enabled INTEGER NOT NULL DEFAULT 1 CHECK (task_failed_enabled IN (0, 1)),
  update_available_enabled INTEGER NOT NULL DEFAULT 1 CHECK (update_available_enabled IN (0, 1)),
  tunnel_stopped_enabled INTEGER NOT NULL DEFAULT 1 CHECK (tunnel_stopped_enabled IN (0, 1)),
  informational_enabled INTEGER NOT NULL DEFAULT 0 CHECK (informational_enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY,
  server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  desktop_delivered INTEGER NOT NULL DEFAULT 0 CHECK (desktop_delivered IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_profiles (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  include_paths TEXT NOT NULL DEFAULT '[]',
  exclude_paths TEXT NOT NULL DEFAULT '[]',
  retention_count INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES backup_profiles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  world_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS installed_content (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  content_id TEXT,
  name TEXT NOT NULL,
  version TEXT,
  loader TEXT NOT NULL,
  environment TEXT,
  source_path TEXT NOT NULL,
  installed_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  installed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_update_policies (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  content_id TEXT,
  content_key TEXT NOT NULL,
  policy TEXT NOT NULL,
  pinned_version TEXT,
  ignored_update TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(server_id, content_key)
);

CREATE TABLE IF NOT EXISTS tunnel_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  command TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tunnel_bindings (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES tunnel_providers(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(provider_id, server_id)
);

CREATE TABLE IF NOT EXISTS tunnel_processes (
  provider_id TEXT PRIMARY KEY REFERENCES tunnel_providers(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  pid INTEGER,
  ref_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL,
  command TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS server_metric_samples (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  cpu_percent REAL,
  memory_mb INTEGER,
  disk_free_mb INTEGER,
  uptime_seconds INTEGER,
  restart_count INTEGER,
  player_count INTEGER,
  unavailable_reason TEXT,
  sampled_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS server_update_history (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  loader_type TEXT NOT NULL,
  from_version TEXT,
  to_version TEXT,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  rollback_path TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnostic_runs (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  results_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provisioning_jobs (
  id TEXT PRIMARY KEY,
  server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
  stage TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  progress_json TEXT NOT NULL DEFAULT '{}',
  staging_dir TEXT,
  target_dir TEXT NOT NULL,
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS server_sources (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  project_id TEXT,
  version_id TEXT,
  source_path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS server_eula_acceptances (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  terms_url TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_managed_processes_server_started_at ON managed_processes(server_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_process_events_server_created_at ON process_events(server_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_notification_events_created_at ON notification_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backups_server_created_at ON backups(server_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_installed_content_server ON installed_content(server_id, installed_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_server ON scheduled_tasks(server_id, enabled);
CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_stage ON provisioning_jobs(stage, updated_at DESC);
`;

function createBackend(app) {
  const appDataDir = app.getPath("userData");
  fs.mkdirSync(appDataDir, { recursive: true });
  const db = new DatabaseSync(
    path.join(appDataDir, "mc-server-manager.sqlite"),
  );
  databaseAppDataDirs.set(db, appDataDir);
  databaseProcessSpawners.set(db, app.spawn || spawn);
  databaseMetricCollectors.set(db, app.collectProcessMetrics || collectProcessMetrics);
  databaseMetricBaselines.set(db, new Map());
  databaseRuntimeDependencies.set(db, app.runtimeDependencies || {});
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(coreSchema);
  migrateDatabase(db);
  ensureNotificationPreferences(db);

  return {
    close: () => {
      closedDatabases.add(db);
      databaseMetricBaselines.get(db)?.clear();
      for (const [serverId, managed] of managedChildren.entries()) {
        if (managed.db === db) {
          clearRestartState(serverId);
          clearRestartCountdown(serverId);
          managed.stopRequested = true;
          managed.child.kill();
          managedChildren.delete(serverId);
        }
      }
      db.close();
    },
    handle: (command, args) => handleCommand(db, command, args),
  };
}

function handleCommand(db, command, args) {
  switch (command) {
    case "get_app_preferences":
      return getAppPreferences(db);
    case "save_app_preferences":
      return saveAppPreferences(db, args?.input);
    case "reset_app_preferences":
      return resetAppPreferences(db);
    case "export_app_settings":
      return exportAppSettings(db, args?.input);
    case "import_app_settings":
      return importAppSettings(db, args?.input);
    case "clear_app_cache":
      return clearAppCache(db);
    case "get_app_data_folder":
      return getAppDataFolder(db);
    case "get_app_logs_folder":
      return getAppLogsFolder(db);
    case "export_diagnostic_package":
      return exportDiagnosticPackage(db, args?.input);
    case "write_app_log":
      return writeAppLog(db, args?.input);
    case "list_app_logs":
      return listAppLogs(db, args?.input);
    case "clear_app_logs":
      return clearAppLogs(db);
    case "get_database_schema_version":
      return { version: databaseSchemaVersion(db) };
    case "list_server_profiles":
      return listServerProfiles(db);
    case "get_server_eula_acceptance":
      return getServerEulaAcceptance(db, args?.input?.serverId || args?.serverId);
    case "get_server_source":
      return getServerSource(db, args?.input?.serverId || args?.serverId);
    case "create_server_profile":
      return createServerProfile(db, args?.input);
    case "get_server_setup_status":
      return getServerSetupStatus(db, args?.serverId);
    case "get_default_server_root":
      return { path: managedServerRoot(db, args?.input?.name || "server", false) };
    case "detect_server_version":
      return detectServerVersion(args?.rootDir || args?.input?.rootDir);
    case "update_server_profile":
      return updateServerProfile(db, args?.input);
    case "delete_server_profile":
      return deleteServerProfile(db, args?.id);
    case "get_process_summary":
      return getProcessSummary(db);
    case "get_server_process_status":
      return getServerProcessStatus(db, args?.serverId);
    case "list_process_events":
      return listProcessEvents(db, args?.serverId);
    case "list_server_logs":
      return listServerLogs(db, args?.serverId);
    case "read_server_log":
      return readServerLog(db, args?.serverId, args?.relativePath);
    case "list_notification_events":
      return listNotificationEvents(db);
    case "get_notification_preferences":
      return getNotificationPreferences(db);
    case "save_notification_preferences":
      return saveNotificationPreferences(db, args?.input);
    case "list_java_runtimes":
      return listJavaRuntimes(db);
    case "plan_java_runtime":
      return planJavaRuntime(db, args?.input);
    case "install_java_runtime":
      return installJavaRuntime(db, args?.input);
    case "start_server":
      return startServer(db, args?.serverId);
    case "stop_server":
      return stopServer(db, args?.serverId);
    case "restart_server":
      return restartServer(db, args?.serverId);
    case "restart_server_with_countdown":
      return restartServerWithCountdown(db, args?.input);
    case "send_server_command":
      return sendServerCommand(db, args?.serverId, args?.command);
    case "list_server_files":
      return listServerFiles(db, args?.serverId, args?.relativePath || "");
    case "read_server_text_file":
      return readServerTextFile(db, args?.serverId, args?.relativePath);
    case "write_server_text_file":
      return writeServerTextFile(
        db,
        args?.serverId,
        args?.relativePath,
        args?.content,
      );
    case "read_server_properties":
      return readServerProperties(db, args?.serverId);
    case "save_server_properties":
      return saveServerProperties(
        db,
        args?.serverId ?? args?.input?.serverId,
        args?.entries ?? args?.input?.updates,
      );
    case "list_server_backups":
      return listServerBackups(db, args?.serverId);
    case "create_world_backup":
      return createWorldBackup(db, args?.input);
    case "delete_server_backup":
      return deleteServerBackup(db, args?.backupId || args?.input?.backupId);
    case "export_server_backup":
      return exportServerBackup(db, args?.input);
    case "list_backup_profiles":
      return listBackupProfiles(db, args?.serverId);
    case "create_backup_profile":
      return createBackupProfile(db, args?.input);
    case "update_backup_profile":
      return updateBackupProfile(db, args?.input);
    case "delete_backup_profile":
      return deleteBackupProfile(db, args?.profileId || args?.input?.profileId);
    case "create_profile_backup":
      return createProfileBackup(db, args?.input);
    case "restore_world_backup":
      return restoreWorldBackup(db, args?.input);
    case "list_players":
      return listPlayers(db, args?.serverId);
    case "apply_player_action":
      return applyPlayerAction(db, args?.input);
    case "read_player_lists":
      return readPlayerLists(db, args?.serverId);
    case "save_player_list":
      return savePlayerList(db, args?.input);
    case "list_installed_content":
      return listInstalledContent(db, args?.serverId);
    case "import_local_content":
      return importLocalContent(db, args?.input);
    case "disable_installed_content":
      return disableInstalledContent(db, args?.input);
    case "enable_installed_content":
      return enableInstalledContent(db, args?.input);
    case "uninstall_installed_content":
      return uninstallInstalledContent(db, args?.input);
    case "get_content_update_policy":
      return getContentUpdatePolicy(db, args);
    case "save_content_update_policy":
      return saveContentUpdatePolicy(db, args?.input);
    case "plan_content_updates":
      return planContentUpdates(db, args?.input);
    case "check_content_updates":
      return checkContentUpdates(db, args?.input);
    case "install_content_update":
      return installContentUpdate(db, args?.input);
    case "install_all_content_updates":
      return installAllContentUpdates(db, args?.input);
    case "list_tunnel_providers":
      return listTunnelProviders(db);
    case "list_tunnel_statuses":
      return listTunnelStatuses(db);
    case "get_tunnel_provider":
      return getTunnelProvider(db, args?.providerId || args?.input?.providerId);
    case "create_tunnel_provider":
      return createTunnelProvider(db, args?.input);
    case "update_tunnel_provider":
      return updateTunnelProvider(db, args?.input);
    case "delete_tunnel_provider":
      return deleteTunnelProvider(
        db,
        args?.providerId || args?.input?.providerId,
      );
    case "list_tunnel_bindings":
      return listTunnelBindings(db);
    case "bind_tunnel_to_server":
      return bindTunnelToServer(db, args?.input);
    case "unbind_tunnel_from_server":
      return unbindTunnelFromServer(db, args?.input);
    case "list_scheduled_tasks":
      return listScheduledTasks(db, args?.serverId);
    case "list_scheduled_task_runs":
      return listScheduledTaskRuns(db, args?.serverId);
    case "create_scheduled_task":
      return createScheduledTask(db, args?.input);
    case "update_scheduled_task":
      return updateScheduledTask(db, args?.input);
    case "delete_scheduled_task":
      return deleteScheduledTask(db, args?.taskId || args?.input?.taskId);
    case "run_due_scheduled_tasks":
      return runDueScheduledTasks(db);
    case "get_performance_history":
      return getPerformanceHistory(db, args?.serverId);
    case "sample_server_metrics":
      return sampleServerMetrics(db, args?.serverId);
    case "run_server_diagnostics":
      return runServerDiagnostics(db, args?.serverId);
    case "list_diagnostic_runs":
      return listDiagnosticRuns(db, args?.serverId);
    case "export_server_profile":
      return exportServerProfile(db, args?.input);
    case "preview_profile_import":
      return previewProfileImport(args?.input);
    case "import_profile":
      return importProfile(db, args?.input);
    case "preview_modpack_import_command":
      return previewModpackImport(args?.input);
    case "plan_server_provisioning":
      return planServerProvisioning(args?.input);
    case "create_provisioning_job":
      return provisioningExecutorFor(db).createJob(args?.input?.plan || args?.input);
    case "get_provisioning_job":
      return provisioningExecutorFor(db).getJob(args?.input?.jobId || args?.jobId);
    case "list_provisioning_jobs":
      return provisioningExecutorFor(db).listJobs();
    case "list_recoverable_provisioning_jobs":
      return provisioningExecutorFor(db).listRecoverableJobs();
    case "run_provisioning_job":
      return provisioningExecutorFor(db).executeJob(args?.input?.jobId || args?.jobId);
    case "retry_provisioning_job":
      return provisioningExecutorFor(db).retryJob(args?.input?.jobId || args?.jobId);
    case "cancel_provisioning_job":
      return provisioningExecutorFor(db).cancelJob(args?.input?.jobId || args?.jobId);
    case "import_modpack":
      return importModpack(db, args?.input);
    case "list_loader_minecraft_versions":
      return listLoaderMinecraftVersions(args?.input);
    case "list_loader_versions":
      return listLoaderVersions(args?.input);
    case "search_modrinth_projects":
      return searchModrinthProjects(args?.input);
    case "get_modrinth_project":
      return getModrinthProject(args?.input);
    case "list_modrinth_versions":
      return listModrinthVersions(args?.input);
    case "install_modrinth_version":
      return installModrinthVersion(db, args?.input);
    case "search_hangar_projects":
      return searchHangarProjects(args?.query);
    case "list_hangar_versions":
      return listHangarVersions(args?.input);
    case "install_hangar_version":
      return installHangarVersion(db, args?.input);
    case "search_curseforge_projects":
      return searchCurseForgeProjects(args?.input);
    case "get_curseforge_project":
      return getCurseForgeProject(args?.input);
    case "list_curseforge_files":
      return listCurseForgeFiles(args?.input);
    case "install_curseforge_file":
      return installCurseForgeFile(db, args?.input);
    case "import_curseforge_manual":
      return importCurseForgeManual(db, args?.input);
    case "search_bbsmc_projects":
      return searchBbsmcProjects(args?.input);
    case "get_bbsmc_project":
      return getBbsmcProject(args?.input);
    case "list_bbsmc_versions":
      return listBbsmcVersions(args?.input);
    case "install_bbsmc_public_file":
      return installBbsmcPublicFile(db, args?.input);
    case "check_server_update":
      return checkServerUpdate(db, args?.input);
    case "install_server_update":
      return installServerUpdate(db, args?.input);
    case "list_server_update_history":
      return listServerUpdateHistory(db, args?.serverId);
    case "create_notification_event":
      return createNotificationEvent(db, args?.input);
    default:
      return undefined;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function databaseSchemaVersion(db) {
  return Number(db.prepare("PRAGMA user_version").get().user_version || 0);
}

function tableHasColumn(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function migrateVersionOneToTwo(db) {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE servers_v2 (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_dir TEXT NOT NULL,
        minecraft_version TEXT,
        loader_type TEXT NOT NULL CHECK (loader_type IN ('vanilla', 'paper', 'forge', 'neoforge', 'fabric', 'quilt')),
        loader_version TEXT,
        java_path TEXT,
        server_port INTEGER CHECK (server_port IS NULL OR (server_port >= 1 AND server_port <= 65535)),
        min_memory_mb INTEGER CHECK (min_memory_mb IS NULL OR min_memory_mb > 0),
        max_memory_mb INTEGER CHECK (max_memory_mb IS NULL OR max_memory_mb > 0),
        auto_start INTEGER NOT NULL DEFAULT 0 CHECK (auto_start IN (0, 1)),
        launch_spec_json TEXT,
        compatibility_warning_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (min_memory_mb IS NULL OR max_memory_mb IS NULL OR min_memory_mb <= max_memory_mb)
      );
      INSERT INTO servers_v2 (
        id, name, root_dir, minecraft_version, loader_type, loader_version,
        java_path, server_port, min_memory_mb, max_memory_mb, auto_start,
        launch_spec_json, compatibility_warning_json, created_at, updated_at
      )
      SELECT
        id, name, root_dir, minecraft_version, loader_type, loader_version,
        java_path, server_port, min_memory_mb, max_memory_mb, auto_start,
        NULL, '[]', created_at, updated_at
      FROM servers;
      DROP TABLE servers;
      ALTER TABLE servers_v2 RENAME TO servers;
    `);
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error("database migration would violate foreign keys");
    }
    db.exec("PRAGMA user_version = 2; COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction may already be closed by SQLite after a fatal error.
    }
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function migrateDatabase(db) {
  const version = databaseSchemaVersion(db);
  if (version > currentSchemaVersion) {
    throw new Error(
      `database schema version ${version} is newer than supported version ${currentSchemaVersion}`,
    );
  }
  if (version === 1 && !tableHasColumn(db, "servers", "launch_spec_json")) {
    migrateVersionOneToTwo(db);
    return;
  }
  if (version < currentSchemaVersion) {
    db.exec(`PRAGMA user_version = ${currentSchemaVersion}`);
  }
}

function trimRequired(value, message) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw new Error(message);
  }
  return trimmed;
}

function unsupported(message) {
  throw new Error(message);
}

function requireServerId(serverId) {
  return trimRequired(serverId, "server id is required");
}

function serverRoot(db, serverId) {
  return getServerProfile(db, requireServerId(serverId)).rootDir;
}

function safeFolderName(value, fallback = "server") {
  const sanitized = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\.+$/g, "")
    .replace(/\s+/g, " ");
  return sanitized || fallback;
}

function stringFilePath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return path.resolve(value.trim());
}

const defaultProviders = {
  modrinth: true,
  hangar: true,
  bbsmc: true,
  curseforge: true,
};

function appDataDirFor(db) {
  const appDataDir = databaseAppDataDirs.get(db);
  if (!appDataDir) {
    throw new Error("app data directory is unavailable");
  }
  return appDataDir;
}

function appPreferencesPath(db) {
  return path.join(appDataDirFor(db), "app-preferences.json");
}

function defaultAppPreferences(db) {
  const appDataDir = appDataDirFor(db);
  return {
    closeBehavior: "minimize",
    defaultServerDir: path.join(appDataDir, "servers"),
    defaultBackupDir: path.join(appDataDir, "backups"),
    cacheDir: path.join(appDataDir, "cache"),
    appDataDir,
    logging: {
      retentionDays: 14,
      maxSizeMb: 25,
      level: "info",
    },
    serverDefaults: {
      javaStrategy: "auto",
      minMemoryMb: 1024,
      maxMemoryMb: 4096,
    },
    backupDefaults: {
      compression: "zip",
      retentionDays: 14,
      frequency: "daily",
    },
    marketplace: {
      defaultProvider: "modrinth",
      showIncompatible: false,
      autoInstallDependencies: true,
      cacheSizeMb: 1024,
    },
    appearance: {
      compactMode: false,
      motion: "full",
      fontSize: "medium",
    },
    providers: { ...defaultProviders },
  };
}

function normalizeAppPreferences(db, input = {}) {
  const defaults = defaultAppPreferences(db);
  const providers =
    input.providers && typeof input.providers === "object"
      ? input.providers
      : {};
  const stringOrDefault = (value, fallback) =>
    typeof value === "string" && value.trim() ? value.trim() : fallback;
  const objectOrEmpty = (value) =>
    value && typeof value === "object" ? value : {};
  const enumOrDefault = (value, allowed, fallback) =>
    allowed.includes(value) ? value : fallback;
  const numberOrDefault = (value, fallback, min, max) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(number)));
  };
  const logging = objectOrEmpty(input.logging);
  const serverDefaults = objectOrEmpty(input.serverDefaults);
  const backupDefaults = objectOrEmpty(input.backupDefaults);
  const marketplace = objectOrEmpty(input.marketplace);
  const appearance = objectOrEmpty(input.appearance);
  const minMemoryMb = numberOrDefault(
    serverDefaults.minMemoryMb,
    defaults.serverDefaults.minMemoryMb,
    512,
    262144,
  );
  const maxMemoryMb = Math.max(
    minMemoryMb,
    numberOrDefault(
      serverDefaults.maxMemoryMb,
      defaults.serverDefaults.maxMemoryMb,
      512,
      262144,
    ),
  );

  return {
    closeBehavior:
      input.closeBehavior === "quit" || input.closeBehavior === "minimize"
        ? input.closeBehavior
        : defaults.closeBehavior,
    defaultServerDir: stringOrDefault(
      input.defaultServerDir,
      defaults.defaultServerDir,
    ),
    defaultBackupDir: stringOrDefault(
      input.defaultBackupDir,
      defaults.defaultBackupDir,
    ),
    cacheDir: stringOrDefault(input.cacheDir, defaults.cacheDir),
    appDataDir: defaults.appDataDir,
    logging: {
      retentionDays: numberOrDefault(
        logging.retentionDays,
        defaults.logging.retentionDays,
        1,
        365,
      ),
      maxSizeMb: numberOrDefault(
        logging.maxSizeMb,
        defaults.logging.maxSizeMb,
        1,
        2048,
      ),
      level: enumOrDefault(
        logging.level,
        ["debug", "info", "warning", "error"],
        defaults.logging.level,
      ),
    },
    serverDefaults: {
      javaStrategy: enumOrDefault(
        serverDefaults.javaStrategy,
        ["auto", "latest-lts", "manual"],
        defaults.serverDefaults.javaStrategy,
      ),
      minMemoryMb,
      maxMemoryMb,
    },
    backupDefaults: {
      compression: enumOrDefault(
        backupDefaults.compression,
        ["zip", "tar.gz"],
        defaults.backupDefaults.compression,
      ),
      retentionDays: numberOrDefault(
        backupDefaults.retentionDays,
        defaults.backupDefaults.retentionDays,
        1,
        3650,
      ),
      frequency: enumOrDefault(
        backupDefaults.frequency,
        ["manual", "daily", "weekly"],
        defaults.backupDefaults.frequency,
      ),
    },
    marketplace: {
      defaultProvider: enumOrDefault(
        marketplace.defaultProvider,
        ["modrinth", "curseforge", "bbsmc", "hangar"],
        defaults.marketplace.defaultProvider,
      ),
      showIncompatible:
        typeof marketplace.showIncompatible === "boolean"
          ? marketplace.showIncompatible
          : defaults.marketplace.showIncompatible,
      autoInstallDependencies:
        typeof marketplace.autoInstallDependencies === "boolean"
          ? marketplace.autoInstallDependencies
          : defaults.marketplace.autoInstallDependencies,
      cacheSizeMb: numberOrDefault(
        marketplace.cacheSizeMb,
        defaults.marketplace.cacheSizeMb,
        1,
        102400,
      ),
    },
    appearance: {
      compactMode:
        typeof appearance.compactMode === "boolean"
          ? appearance.compactMode
          : defaults.appearance.compactMode,
      motion: enumOrDefault(
        appearance.motion,
        ["full", "reduced", "off"],
        defaults.appearance.motion,
      ),
      fontSize: enumOrDefault(
        appearance.fontSize,
        ["small", "medium", "large"],
        defaults.appearance.fontSize,
      ),
    },
    providers: {
      modrinth: true,
      hangar:
        typeof providers.hangar === "boolean"
          ? providers.hangar
          : defaults.providers.hangar,
      bbsmc:
        typeof providers.bbsmc === "boolean"
          ? providers.bbsmc
          : defaults.providers.bbsmc,
      curseforge:
        typeof providers.curseforge === "boolean"
          ? providers.curseforge
          : defaults.providers.curseforge,
    },
  };
}

function getAppPreferences(db) {
  const filePath = appPreferencesPath(db);
  if (!fs.existsSync(filePath)) {
    return defaultAppPreferences(db);
  }

  try {
    return normalizeAppPreferences(
      db,
      JSON.parse(fs.readFileSync(filePath, "utf8")),
    );
  } catch (error) {
    throw new Error(`failed to read app preferences: ${error.message}`);
  }
}

function saveAppPreferences(db, input = {}) {
  if (!input || typeof input !== "object") {
    throw new Error("app preferences input is required");
  }

  const current = getAppPreferences(db);
  const next = normalizeAppPreferences(db, {
    ...current,
    ...input,
    logging: {
      ...current.logging,
      ...(input.logging && typeof input.logging === "object"
        ? input.logging
        : {}),
    },
    serverDefaults: {
      ...current.serverDefaults,
      ...(input.serverDefaults && typeof input.serverDefaults === "object"
        ? input.serverDefaults
        : {}),
    },
    backupDefaults: {
      ...current.backupDefaults,
      ...(input.backupDefaults && typeof input.backupDefaults === "object"
        ? input.backupDefaults
        : {}),
    },
    marketplace: {
      ...current.marketplace,
      ...(input.marketplace && typeof input.marketplace === "object"
        ? input.marketplace
        : {}),
    },
    appearance: {
      ...current.appearance,
      ...(input.appearance && typeof input.appearance === "object"
        ? input.appearance
        : {}),
    },
    providers: {
      ...current.providers,
      ...(input.providers && typeof input.providers === "object"
        ? input.providers
        : {}),
    },
  });

  const filePath = appPreferencesPath(db);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function clearAppCache(db) {
  const cacheDir = path.resolve(getAppPreferences(db).cacheDir);
  if (path.parse(cacheDir).root === cacheDir) {
    throw new Error("refusing to clear filesystem root cache directory");
  }

  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  return { cleared: true };
}

function getAppDataFolder(db) {
  const folderPath = appDataDirFor(db);
  fs.mkdirSync(folderPath, { recursive: true });
  return { path: folderPath };
}

function resetAppPreferences(db) {
  const preferences = defaultAppPreferences(db);
  const filePath = appPreferencesPath(db);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
  return preferences;
}

function exportAppSettings(db, input = {}) {
  const targetPath = stringFilePath(input.path, "settings export path");
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(
    targetPath,
    `${JSON.stringify(getAppPreferences(db), null, 2)}\n`,
    "utf8",
  );
  return { path: targetPath };
}

function importAppSettings(db, input = {}) {
  const sourcePath = stringFilePath(input.path, "settings import path");
  if (!fs.existsSync(sourcePath)) {
    throw new Error("settings import file does not exist");
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  } catch (error) {
    throw new Error(`failed to read settings import file: ${error.message}`);
  }
  return saveAppPreferences(db, parsed);
}

function appLogsDir(db) {
  return path.join(appDataDirFor(db), "logs");
}

function appLogPath(db) {
  return path.join(appLogsDir(db), "app.log");
}

function normalizeLogLevel(level) {
  return ["debug", "info", "warning", "error"].includes(level) ? level : "info";
}

const logLevelPriority = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
};

function truncateLogField(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function writeAppLog(db, input = {}) {
  if (!input || typeof input !== "object") {
    throw new Error("app log input is required");
  }

  const entry = {
    id: randomUUID(),
    level: normalizeLogLevel(input.level),
    source: truncateLogField(input.source || "app", 120),
    message: truncateLogField(input.message || "", 4000),
    details: input.details ? truncateLogField(input.details, 12000) : undefined,
    createdAt: nowIso(),
  };

  const configuredLevel = getAppPreferences(db).logging.level;
  if (logLevelPriority[entry.level] < logLevelPriority[configuredLevel]) {
    return { ...entry, skipped: true };
  }

  fs.mkdirSync(appLogsDir(db), { recursive: true });
  fs.appendFileSync(appLogPath(db), `${JSON.stringify(entry)}\n`, "utf8");
  enforceAppLogPolicy(db);
  return entry;
}

function enforceAppLogPolicy(db) {
  const filePath = appLogPath(db);
  if (!fs.existsSync(filePath)) {
    return;
  }
  const preferences = getAppPreferences(db).logging;
  const cutoffTime =
    Date.now() - preferences.retentionDays * 24 * 60 * 60 * 1000;
  const maxBytes = preferences.maxSizeMb * 1024 * 1024;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const retained = lines.filter((line) => {
    try {
      const entry = JSON.parse(line);
      return Date.parse(entry.createdAt) >= cutoffTime;
    } catch {
      return true;
    }
  });
  const sized = [];
  let totalBytes = 0;
  for (let index = retained.length - 1; index >= 0; index -= 1) {
    const line = retained[index];
    const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
    if (totalBytes + lineBytes > maxBytes && sized.length > 0) {
      break;
    }
    totalBytes += lineBytes;
    sized.unshift(line);
  }
  fs.writeFileSync(filePath, sized.length > 0 ? `${sized.join("\n")}\n` : "", "utf8");
}

function getAppLogsFolder(db) {
  const folderPath = appLogsDir(db);
  fs.mkdirSync(folderPath, { recursive: true });
  return { path: folderPath };
}

function exportDiagnosticPackage(db, input = {}) {
  const targetPath = stringFilePath(input.path, "diagnostic export path");
  const payload = {
    generatedAt: nowIso(),
    platform: process.platform,
    node: process.version,
    preferences: getAppPreferences(db),
    logs: listAppLogs(db, { level: "all", limit: 2000 }).reverse(),
  };
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { path: targetPath };
}

function listAppLogs(db, input = {}) {
  const filePath = appLogPath(db);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const level = input.level || "all";
  const limit =
    Number.isInteger(input.limit) && input.limit > 0
      ? Math.min(input.limit, 2000)
      : 500;
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {
          id: randomUUID(),
          level: "warning",
          source: "logger.parser",
          message: "Invalid application log line",
          details: line,
          createdAt: nowIso(),
        };
      }
    })
    .filter((entry) => level === "all" || entry.level === level)
    .slice(-limit)
    .reverse();
}

function clearAppLogs(db) {
  fs.rmSync(appLogPath(db), { force: true });
  fs.mkdirSync(appLogsDir(db), { recursive: true });
  return { cleared: true };
}

function managedServerRoot(db, name, isExistingFolderImport) {
  if (isExistingFolderImport) {
    throw new Error("server root directory is required");
  }
  const baseDir = getAppPreferences(db).defaultServerDir;
  const baseName = safeFolderName(name);
  let candidate = path.join(baseDir, baseName);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(baseDir, `${baseName}-${suffix}`);
    suffix += 1;
  }
  return candidate;
}

function safeServerPath(db, serverId, relativePath = "") {
  const root = path.resolve(serverRoot(db, serverId));
  const target = path.resolve(root, relativePath || ".");
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("path escapes server root");
  }
  return { root, target };
}

function readPropertiesFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator === -1) {
          return [line, ""];
        }
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

function parseServerJarName(fileName) {
  const lower = fileName.toLowerCase();
  const minecraftVersion = fileName.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null;
  let loaderType = null;
  let loaderVersion = null;

  if (lower.includes("paper") || lower.includes("spigot")) {
    loaderType = "paper";
    loaderVersion =
      fileName.match(/\d+\.\d+(?:\.\d+)?[-+_ ]+(\d+)/)?.[1] ?? null;
  } else if (lower.includes("neoforge")) {
    loaderType = "neoForge";
    loaderVersion =
      fileName.match(/neoforge[-+_ ]*([0-9][\w.+-]*)/i)?.[1] ?? null;
  } else if (lower.includes("forge")) {
    loaderType = "forge";
    loaderVersion =
      fileName.match(/forge[-+_ ]*(?:\d+\.\d+(?:\.\d+)?[-+_ ])?([0-9][\w.+-]*)/i)
        ?.[1] ?? null;
  } else if (lower.includes("fabric")) {
    loaderType = "fabric";
    loaderVersion =
      fileName.match(/fabric[-+_ ]*(?:server[-+_ ])?([0-9][\w.+-]*)/i)?.[1] ??
      null;
  } else if (lower.includes("server") || lower.includes("minecraft")) {
    loaderType = "vanilla";
  }

  return { loaderType, minecraftVersion, loaderVersion };
}

function detectServerVersion(rootDir) {
  const root = stringFilePath(rootDir, "server root directory");
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error("server root path does not exist or is not a directory");
  }

  const propertiesPath = path.join(root, "server.properties");
  const properties = readPropertiesFile(propertiesPath);
  const jars = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const parsedJar =
    jars.map(parseServerJarName).find((jar) => jar.loaderType || jar.minecraftVersion) ??
    {};
  const port = Number.parseInt(properties["server-port"] || "", 10);

  return {
    loaderType: parsedJar.loaderType ?? null,
    minecraftVersion: parsedJar.minecraftVersion ?? null,
    loaderVersion: parsedJar.loaderVersion ?? null,
    serverJarName: jars[0] ?? null,
    hasEula: fs.existsSync(path.join(root, "eula.txt")),
    hasServerProperties: fs.existsSync(propertiesPath),
    serverPort: Number.isFinite(port) ? port : null,
  };
}

function directorySizeBytes(target) {
  if (!fs.existsSync(target)) {
    return 0;
  }
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return stat.size;
  }
  return fs
    .readdirSync(target)
    .reduce(
      (total, name) => total + directorySizeBytes(path.join(target, name)),
      0,
    );
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function addProcessEvent(db, serverId, level, message) {
  if (closedDatabases.has(db)) {
    return;
  }
  db.prepare(
    "INSERT INTO process_events (id, server_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(randomUUID(), serverId || null, level, message, nowIso());
}

function validateRuntimeSettings(serverPort, minMemoryMb, maxMemoryMb) {
  if (serverPort != null && (serverPort < 1 || serverPort > 65535)) {
    throw new Error("server port must be between 1 and 65535");
  }
  if (
    (minMemoryMb != null && minMemoryMb <= 0) ||
    (maxMemoryMb != null && maxMemoryMb <= 0)
  ) {
    throw new Error("memory values must be positive");
  }
  if (minMemoryMb != null && maxMemoryMb != null && minMemoryMb > maxMemoryMb) {
    throw new Error("minimum memory cannot be greater than maximum memory");
  }
}

function validateRestartPolicy(restartPolicy) {
  if (!restartPolicy) {
    return;
  }
  if (restartPolicy.maxAttempts < 0) {
    throw new Error("restart max attempts cannot be negative");
  }
  if (restartPolicy.cooldownSeconds < 0) {
    throw new Error("restart cooldown seconds cannot be negative");
  }
}

function dbLoader(loaderType) {
  const loader = loaderToDb[loaderType];
  if (!loader) {
    throw new Error(`unknown loader type: ${loaderType}`);
  }
  return loader;
}

function defaultRestartPolicy() {
  return { enabled: true, maxAttempts: 3, cooldownSeconds: 30 };
}

function processSpawnerFor(db) {
  return databaseProcessSpawners.get(db) || spawn;
}

function collectProcessMetrics(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "win32") {
    const command = `$p = Get-Process -Id ${pid} -ErrorAction Stop; [pscustomobject]@{ cpuSeconds = $p.CPU; memoryBytes = $p.WorkingSet64 } | ConvertTo-Json -Compress`;
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", timeout: 2000, windowsHide: true },
    );
    if (result.status !== 0 || !result.stdout) return null;
    try {
      const parsed = JSON.parse(result.stdout);
      return {
        cpuSeconds: Number(parsed.cpuSeconds),
        memoryMb: Number(parsed.memoryBytes) / (1024 * 1024),
      };
    } catch {
      return null;
    }
  }
  const result = spawnSync("ps", ["-p", String(pid), "-o", "%cpu=,rss="], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  const [cpuPercent, rssKb] = result.stdout.trim().split(/\s+/).map(Number);
  return { cpuPercent, memoryMb: rssKb / 1024 };
}

async function measuredProcessMetrics(db, pid) {
  const collector = databaseMetricCollectors.get(db) || collectProcessMetrics;
  const measured = await Promise.resolve(collector(pid));
  if (!measured) return { cpuPercent: null, memoryMb: null, tps: null };
  let cpuPercent = Number.isFinite(measured.cpuPercent)
    ? Number(measured.cpuPercent)
    : null;
  if (cpuPercent === null && Number.isFinite(measured.cpuSeconds)) {
    const now = Date.now();
    const baselines = databaseMetricBaselines.get(db);
    const baseline = baselines.get(pid);
    if (baseline && now > baseline.sampledAt) {
      cpuPercent = Math.max(
        0,
        ((Number(measured.cpuSeconds) - baseline.cpuSeconds) * 100000) /
          (now - baseline.sampledAt),
      );
    }
    baselines.set(pid, { cpuSeconds: Number(measured.cpuSeconds), sampledAt: now });
  }
  return {
    cpuPercent: cpuPercent === null ? null : Math.round(cpuPercent * 10) / 10,
    memoryMb: Number.isFinite(measured.memoryMb)
      ? Math.round(Number(measured.memoryMb) * 10) / 10
      : null,
    tps: Number.isFinite(measured.tps)
      ? Math.round(Number(measured.tps) * 10) / 10
      : null,
  };
}

function clearRestartState(serverId) {
  const state = restartRuntimeState.get(serverId);
  if (state?.timer) {
    clearTimeout(state.timer);
  }
  restartRuntimeState.delete(serverId);
}

function restartStateFor(serverId) {
  let state = restartRuntimeState.get(serverId);
  if (!state) {
    state = { attempts: 0, timer: null };
    restartRuntimeState.set(serverId, state);
  }
  return state;
}

function isServerCrashSignature(line) {
  return [
    /OutOfMemoryError/i,
    /Encountered an unexpected exception/i,
    /Exception in server tick loop/i,
    /This crash report has been saved/i,
    /The server has stopped responding/i,
    /A single server tick took/i,
    /Watchdog/i,
  ].some((pattern) => pattern.test(line));
}

function scheduleCrashRestart(db, profile, reason) {
  const policy = profile.restartPolicy || defaultRestartPolicy();
  if (!policy.enabled || policy.maxAttempts <= 0) {
    addProcessEvent(
      db,
      profile.id,
      "warning",
      "Auto restart skipped because restart policy is disabled.",
    );
    return;
  }

  const state = restartStateFor(profile.id);
  if (state.timer) {
    return;
  }
  if (state.attempts >= policy.maxAttempts) {
    addProcessEvent(
      db,
      profile.id,
      "error",
      `Auto restart exhausted after ${policy.maxAttempts} attempt(s).`,
    );
    return;
  }

  state.attempts += 1;
  const attempt = state.attempts;
  const delayMs = policy.cooldownSeconds * 1000;
  addProcessEvent(
    db,
    profile.id,
    "warning",
    `Auto restarting after crash (${reason}); attempt ${attempt}/${policy.maxAttempts} in ${policy.cooldownSeconds}s.`,
  );

  state.timer = setTimeout(() => {
    state.timer = null;
    if (closedDatabases.has(db) || managedChildren.has(profile.id)) {
      return;
    }
    try {
      startServer(db, profile.id, { autoRestart: true });
    } catch (error) {
      addProcessEvent(
        db,
        profile.id,
        "error",
        `Auto restart failed: ${error.message}`,
      );
    }
  }, delayMs);
  state.timer.unref?.();
}

function mapProfile(row) {
  return {
    id: row.id,
    name: row.name,
    rootDir: row.root_dir,
    minecraftVersion: row.minecraft_version,
    loaderType: loaderFromDb[row.loader_type],
    loaderVersion: row.loader_version,
    javaPath: row.java_path,
    serverPort: row.server_port,
    minMemoryMb: row.min_memory_mb,
    maxMemoryMb: row.max_memory_mb,
    autoStart: row.auto_start !== 0,
    launchSpec: row.launch_spec_json
      ? JSON.parse(row.launch_spec_json)
      : null,
    compatibilityWarnings: JSON.parse(row.compatibility_warning_json || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    restartPolicy: {
      enabled: row.restart_enabled !== 0,
      maxAttempts: row.restart_max_attempts,
      cooldownSeconds: row.restart_cooldown_seconds,
    },
  };
}

function profileSelectSql(whereClause = "") {
  return `
    SELECT
      s.id, s.name, s.root_dir, s.minecraft_version, s.loader_type,
      s.loader_version, s.java_path, s.server_port, s.min_memory_mb,
      s.max_memory_mb, s.auto_start, s.launch_spec_json,
      s.compatibility_warning_json, s.created_at, s.updated_at,
      p.enabled AS restart_enabled,
      p.max_attempts AS restart_max_attempts,
      p.cooldown_seconds AS restart_cooldown_seconds
    FROM servers s
    INNER JOIN server_restart_policies p ON p.server_id = s.id
    ${whereClause}
  `;
}

function getServerProfile(db, id) {
  const row = db.prepare(profileSelectSql("WHERE s.id = ?")).get(id);
  if (!row) {
    throw new Error(`server profile not found: ${id}`);
  }
  return mapProfile(row);
}

function listServerProfiles(db) {
  return db
    .prepare(`${profileSelectSql()} ORDER BY s.created_at DESC`)
    .all()
    .map(mapProfile);
}

function createServerProfile(db, input) {
  if (!input) {
    throw new Error("server profile input is required");
  }
  const name = trimRequired(input.name, "server name is required");
  const isExistingFolderImport = input.source?.kind === "existingFolder";
  const rootDir = input.rootDir?.trim()
    ? input.rootDir.trim()
    : managedServerRoot(db, name, isExistingFolderImport);
  if (isExistingFolderImport && !fs.existsSync(rootDir)) {
    throw new Error("import root path does not exist");
  }
  if (!isExistingFolderImport) {
    fs.mkdirSync(rootDir, { recursive: true });
  }
  validateRuntimeSettings(
    input.serverPort,
    input.minMemoryMb,
    input.maxMemoryMb,
  );
  validateRestartPolicy(input.restartPolicy);

  const id = randomUUID();
  const createdAt = nowIso();
  const restartPolicy = input.restartPolicy || defaultRestartPolicy();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO servers (
        id, name, root_dir, minecraft_version, loader_type, loader_version,
        java_path, server_port, min_memory_mb, max_memory_mb, auto_start,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      id,
      name,
      rootDir,
      input.minecraftVersion ?? null,
      dbLoader(input.loaderType),
      input.loaderVersion ?? null,
      input.javaPath ?? null,
      input.serverPort ?? null,
      input.minMemoryMb ?? null,
      input.maxMemoryMb ?? null,
      createdAt,
      createdAt,
    );
    db.prepare(
      `INSERT INTO server_restart_policies
        (server_id, enabled, max_attempts, cooldown_seconds)
       VALUES (?, ?, ?, ?)`,
    ).run(
      id,
      restartPolicy.enabled ? 1 : 0,
      restartPolicy.maxAttempts,
      restartPolicy.cooldownSeconds,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getServerProfile(db, id);
}

function updateServerProfile(db, input) {
  if (!input?.id) {
    throw new Error("server profile id is required");
  }
  const existing = getServerProfile(db, input.id);
  const name =
    input.name === undefined
      ? existing.name
      : trimRequired(input.name, "server name is required");
  const rootDir =
    input.rootDir === undefined
      ? existing.rootDir
      : trimRequired(input.rootDir, "server root directory is required");
  const loaderType =
    input.loaderType === undefined ? existing.loaderType : input.loaderType;
  const serverPort =
    input.serverPort === undefined ? existing.serverPort : input.serverPort;
  if (input.serverPort === null) {
    throw new Error("server port must be between 1 and 65535");
  }
  const minMemoryMb =
    input.minMemoryMb === undefined ? existing.minMemoryMb : input.minMemoryMb;
  const maxMemoryMb =
    input.maxMemoryMb === undefined ? existing.maxMemoryMb : input.maxMemoryMb;
  validateRuntimeSettings(serverPort, minMemoryMb, maxMemoryMb);
  validateRestartPolicy(input.restartPolicy);
  const synchronizePort =
    input.serverPort !== undefined && serverPort !== existing.serverPort;
  const synchronizedPropertiesPath = path.join(rootDir, "server.properties");
  const propertiesExisted = fs.existsSync(synchronizedPropertiesPath);
  const originalProperties = propertiesExisted
    ? fs.readFileSync(synchronizedPropertiesPath, "utf8")
    : "";
  const synchronizedProperties = synchronizePort
    ? mergeProperties(originalProperties, { "server-port": String(serverPort) }).raw
    : null;
  let propertiesWritten = false;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `UPDATE servers SET
        name = ?,
        root_dir = ?,
        minecraft_version = ?,
        loader_type = ?,
        loader_version = ?,
        java_path = ?,
        server_port = ?,
        min_memory_mb = ?,
        max_memory_mb = ?,
        auto_start = ?,
        updated_at = ?
      WHERE id = ?`,
    ).run(
      name,
      rootDir,
      input.minecraftVersion === undefined
        ? existing.minecraftVersion
        : input.minecraftVersion,
      dbLoader(loaderType),
      input.loaderVersion === undefined
        ? existing.loaderVersion
        : input.loaderVersion,
      input.javaPath === undefined ? existing.javaPath : input.javaPath,
      serverPort,
      minMemoryMb,
      maxMemoryMb,
      input.autoStart === undefined
        ? existing.autoStart
          ? 1
          : 0
        : input.autoStart
          ? 1
          : 0,
      nowIso(),
      input.id,
    );
    if (input.restartPolicy !== undefined) {
      db.prepare(
        `INSERT INTO server_restart_policies
            (server_id, enabled, max_attempts, cooldown_seconds)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(server_id) DO UPDATE SET
            enabled = excluded.enabled,
            max_attempts = excluded.max_attempts,
            cooldown_seconds = excluded.cooldown_seconds`,
      ).run(
        input.id,
        input.restartPolicy.enabled ? 1 : 0,
        input.restartPolicy.maxAttempts,
        input.restartPolicy.cooldownSeconds,
      );
    }
    if (synchronizePort) {
      fs.writeFileSync(synchronizedPropertiesPath, synchronizedProperties, "utf8");
      propertiesWritten = true;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (propertiesWritten) {
      if (propertiesExisted) {
        fs.writeFileSync(synchronizedPropertiesPath, originalProperties, "utf8");
      } else {
        fs.rmSync(synchronizedPropertiesPath, { force: true });
      }
    }
    throw error;
  }
  return getServerProfile(db, input.id);
}

function deleteServerProfile(db, id) {
  if (!id) {
    throw new Error("server profile id is required");
  }
  const result = db.prepare("DELETE FROM servers WHERE id = ?").run(id);
  if (result.changes === 0) {
    throw new Error(`server profile not found: ${id}`);
  }
  return null;
}

function getProcessSummary(db) {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM managed_processes
       WHERE status IN ('running', 'external_running', 'crashed')
       GROUP BY status`,
    )
    .all();
  return rows.reduce(
    (summary, row) => {
      if (row.status === "crashed") {
        summary.crashedCount += row.count;
      } else {
        summary.runningCount += row.count;
      }
      return summary;
    },
    { runningCount: 0, crashedCount: 0 },
  );
}

function mapProcess(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    serverId: row.server_id,
    pid: row.pid,
    command: row.command,
    status: row.status === "external_running" ? "externalRunning" : row.status,
    startedAt: row.started_at,
    exitedAt: row.exited_at,
    exitCode: row.exit_code,
  };
}

function getServerProcessStatus(db, serverId) {
  if (!serverId) {
    throw new Error("server id is required");
  }
  return mapProcess(
    db
      .prepare(
        `SELECT * FROM managed_processes
         WHERE server_id = ?
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .get(serverId),
  );
}

function listProcessEvents(db, serverId) {
  if (!serverId) {
    throw new Error("server id is required");
  }
  return db
    .prepare(
      `SELECT id, server_id, level, message, created_at
       FROM process_events
       WHERE server_id = ?
       ORDER BY created_at ASC`,
    )
    .all(serverId)
    .map((row) => ({
      id: row.id,
      serverId: row.server_id,
      level: row.level,
      message: row.message,
      createdAt: row.created_at,
    }));
}

function listServerLogs(db, serverId) {
  const { root, target } = safeServerPath(db, serverId, "logs");
  if (!fs.existsSync(target)) {
    return { serverId: requireServerId(serverId), logs: [] };
  }
  return {
    serverId: requireServerId(serverId),
    logs: fs
      .readdirSync(target, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.log(\.gz)?$/i.test(entry.name))
      .map((entry) => {
        const fullPath = path.join(target, entry.name);
        const stat = fs.statSync(fullPath);
        return {
          fileName: entry.name,
          relativePath: path.relative(root, fullPath).replace(/\\/g, "/"),
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          current: entry.name === "latest.log",
          compressed: entry.name.endsWith(".gz"),
        };
      })
      .sort((left, right) => {
        if (left.current) return -1;
        if (right.current) return 1;
        return right.modifiedAt.localeCompare(left.modifiedAt);
      }),
  };
}

function readServerLog(db, serverId, relativePath) {
  const requestedPath = trimRequired(relativePath, "log path is required");
  const normalizedPath = requestedPath.replace(/\\/g, "/");
  if (
    normalizedPath.includes("..") ||
    !normalizedPath.startsWith("logs/") ||
    !/\.log(\.gz)?$/i.test(normalizedPath)
  ) {
    throw new Error(
      "log path must be a log file inside the server logs folder",
    );
  }
  const { target } = safeServerPath(db, serverId, normalizedPath);
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    throw new Error("selected log path is not a file");
  }
  if (stat.size > 10 * 1024 * 1024) {
    throw new Error("log file is too large to open");
  }
  const compressed = normalizedPath.endsWith(".gz");
  const content = compressed
    ? zlib.gunzipSync(fs.readFileSync(target)).toString("utf8")
    : fs.readFileSync(target, "utf8");
  return {
    relativePath: normalizedPath,
    content,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    compressed,
  };
}

function ensureNotificationPreferences(db) {
  db.prepare(
    `INSERT OR IGNORE INTO notification_preferences (
      id, desktop_enabled, crash_enabled, restart_failed_enabled,
      backup_failed_enabled, task_failed_enabled, update_available_enabled,
      tunnel_stopped_enabled, informational_enabled, updated_at
    ) VALUES (1, 1, 1, 1, 1, 1, 1, 1, 0, ?)`,
  ).run(nowIso());
}

function mapNotificationPreferences(row) {
  return {
    desktopEnabled: row.desktop_enabled !== 0,
    crashEnabled: row.crash_enabled !== 0,
    restartFailedEnabled: row.restart_failed_enabled !== 0,
    backupFailedEnabled: row.backup_failed_enabled !== 0,
    taskFailedEnabled: row.task_failed_enabled !== 0,
    updateAvailableEnabled: row.update_available_enabled !== 0,
    tunnelStoppedEnabled: row.tunnel_stopped_enabled !== 0,
    informationalEnabled: row.informational_enabled !== 0,
    updatedAt: row.updated_at,
  };
}

function getNotificationPreferences(db) {
  ensureNotificationPreferences(db);
  return mapNotificationPreferences(
    db.prepare("SELECT * FROM notification_preferences WHERE id = 1").get(),
  );
}

function saveNotificationPreferences(db, input) {
  if (!input) {
    throw new Error("notification preferences input is required");
  }
  db.prepare(
    `UPDATE notification_preferences SET
      desktop_enabled = ?,
      crash_enabled = ?,
      restart_failed_enabled = ?,
      backup_failed_enabled = ?,
      task_failed_enabled = ?,
      update_available_enabled = ?,
      tunnel_stopped_enabled = ?,
      informational_enabled = ?,
      updated_at = ?
    WHERE id = 1`,
  ).run(
    input.desktopEnabled ? 1 : 0,
    input.crashEnabled ? 1 : 0,
    input.restartFailedEnabled ? 1 : 0,
    input.backupFailedEnabled ? 1 : 0,
    input.taskFailedEnabled ? 1 : 0,
    input.updateAvailableEnabled ? 1 : 0,
    input.tunnelStoppedEnabled ? 1 : 0,
    input.informationalEnabled ? 1 : 0,
    nowIso(),
  );
  return getNotificationPreferences(db);
}

function listNotificationEvents(db) {
  return db
    .prepare(
      `SELECT id, server_id, kind, severity, title, message,
              desktop_delivered, created_at
       FROM notification_events
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      serverId: row.server_id,
      kind: row.kind,
      severity: row.severity,
      title: row.title,
      message: row.message,
      desktopDelivered: row.desktop_delivered !== 0,
      createdAt: row.created_at,
    }));
}

function parseJavaVersionOutput(output) {
  const version =
    output.match(/(?:openjdk|java)\s+version\s+"([^"]+)"/i)?.[1] ||
    output.match(/openjdk\s+([0-9][^\s]+)/i)?.[1] ||
    "Unknown";
  const majorMatch = version.match(/^1\.(\d+)/) || version.match(/^(\d+)/);
  const majorVersion = majorMatch ? Number.parseInt(majorMatch[1], 10) : null;
  return {
    majorVersion: Number.isFinite(majorVersion) ? majorVersion : null,
    version,
  };
}

function detectJavaVendor(output) {
  if (/temurin|adoptium/i.test(output)) {
    return "Eclipse Temurin";
  }
  if (/openjdk/i.test(output)) {
    return "OpenJDK";
  }
  if (/oracle/i.test(output)) {
    return "Oracle";
  }
  return "Unknown";
}

function hasPathSeparator(value) {
  return value.includes("/") || value.includes("\\");
}

function javaCandidateExists(javaPath) {
  return !hasPathSeparator(javaPath) || fs.existsSync(javaPath);
}

function inspectJavaRuntime(candidate) {
  if (!javaCandidateExists(candidate.path)) {
    throw new Error("Java executable does not exist");
  }

  const result = spawnSync(candidate.path, ["-version"], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && output.trim() === "") {
    throw new Error(`java -version exited with status ${result.status}`);
  }
  const parsed = parseJavaVersionOutput(output);
  return {
    path: candidate.path,
    source: candidate.source,
    version: parsed.version,
    majorVersion: parsed.majorVersion,
    vendor: detectJavaVendor(output),
    architecture: process.arch,
  };
}

function requiredJavaMajorForMinecraft(minecraftVersion) {
  return runtimeRequiredJavaMajor(minecraftVersion);
}

function getServerEulaAcceptance(db, serverId) {
  const row = db
    .prepare(
      `SELECT server_id, terms_url, accepted_at
       FROM server_eula_acceptances WHERE server_id = ?`,
    )
    .get(String(serverId || ""));
  if (!row) return null;
  return {
    serverId: row.server_id,
    termsUrl: row.terms_url,
    acceptedAt: row.accepted_at,
  };
}

function getServerSource(db, serverId) {
  const row = db
    .prepare(
      `SELECT server_id, provider, project_id, version_id, source_path, metadata_json
       FROM server_sources WHERE server_id = ?`,
    )
    .get(String(serverId || ""));
  if (!row) return null;
  return {
    serverId: row.server_id,
    provider: row.provider,
    projectId: row.project_id,
    versionId: row.version_id,
    sourcePath: row.source_path,
    metadata: JSON.parse(row.metadata_json || "{}"),
  };
}

function normalizeJavaPath(javaPath) {
  return hasPathSeparator(javaPath)
    ? path.resolve(javaPath).toLowerCase()
    : javaPath;
}

function createJavaCompatibility(profile, runtimes) {
  const requiredMajorVersion = requiredJavaMajorForMinecraft(
    profile.minecraftVersion,
  );
  const configuredJavaPath = profile.javaPath || null;
  const runtime = configuredJavaPath
    ? runtimes.find(
        (item) =>
          normalizeJavaPath(item.path) ===
          normalizeJavaPath(configuredJavaPath),
      )
    : runtimes
        .filter((item) => Number.isFinite(item.majorVersion))
        .sort((left, right) => right.majorVersion - left.majorVersion)[0];

  if (!requiredMajorVersion) {
    return {
      serverId: profile.id,
      serverName: profile.name,
      minecraftVersion: profile.minecraftVersion,
      configuredJavaPath,
      requiredMajorVersion: null,
      status: "unknown",
      message: "Set a Minecraft version to check Java compatibility.",
    };
  }

  if (!runtime) {
    return {
      serverId: profile.id,
      serverName: profile.name,
      minecraftVersion: profile.minecraftVersion,
      configuredJavaPath,
      requiredMajorVersion,
      status: "unknown",
      message: configuredJavaPath
        ? `Configured Java runtime was not detected. Java ${requiredMajorVersion} or newer is required.`
        : `No Java runtime detected. Java ${requiredMajorVersion} or newer is required.`,
    };
  }

  if (!Number.isFinite(runtime.majorVersion)) {
    return {
      serverId: profile.id,
      serverName: profile.name,
      minecraftVersion: profile.minecraftVersion,
      configuredJavaPath,
      requiredMajorVersion,
      status: "unknown",
      message: `Detected Java version is unknown. Java ${requiredMajorVersion} or newer is required.`,
    };
  }

  const compatible = runtime.majorVersion >= requiredMajorVersion;
  return {
    serverId: profile.id,
    serverName: profile.name,
    minecraftVersion: profile.minecraftVersion,
    configuredJavaPath,
    requiredMajorVersion,
    status: compatible ? "compatible" : "warning",
    message: compatible
      ? `Java ${runtime.majorVersion} satisfies required Java ${requiredMajorVersion}.`
      : `Java ${runtime.majorVersion} is below required Java ${requiredMajorVersion}.`,
  };
}

function managedJavaCandidates(db) {
  const root = path.join(databaseAppDataDirs.get(db), "runtimes", "temurin");
  if (!fs.existsSync(root)) return [];
  const executableName = process.platform === "win32" ? "java.exe" : "java";
  const pending = [root];
  const candidates = [];
  let visited = 0;
  while (pending.length > 0 && visited < 10_000) {
    const current = pending.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      visited += 1;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.toLowerCase() === executableName) {
        candidates.push({ path: target, source: "Managed by MC Server Manager" });
      }
    }
  }
  return candidates;
}

function listJavaRuntimes(db) {
  const profiles = listServerProfiles(db);
  const candidates = [
    process.env.JAVA_HOME &&
      path.join(process.env.JAVA_HOME, "bin", "java.exe"),
    process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, "bin", "java"),
    ...profiles.map((profile) => profile.javaPath).filter(Boolean),
    ...managedJavaCandidates(db),
  ]
    .filter(Boolean)
    .map((candidate) => ({
      path: typeof candidate === "string" ? candidate : candidate.path,
      source:
        typeof candidate !== "string"
          ? candidate.source
          : process.env.JAVA_HOME && candidate.startsWith(process.env.JAVA_HOME)
          ? "JAVA_HOME"
          : "Server profile",
    }));
  const uniqueCandidates = Array.from(
    new Map(
      candidates.map((candidate) => [
        normalizeJavaPath(candidate.path),
        candidate,
      ]),
    ).values(),
  );
  const failures = [];
  const runtimes = [];

  for (const candidate of uniqueCandidates) {
    try {
      runtimes.push(inspectJavaRuntime(candidate));
    } catch (error) {
      failures.push({
        path: candidate.path,
        source: candidate.source,
        error: error.message,
      });
    }
  }

  return {
    runtimes,
    failures,
    compatibility: profiles.map((profile) =>
      createJavaCompatibility(profile, runtimes),
    ),
  };
}

function runtimeManagerFor(db) {
  const configured = databaseRuntimeDependencies.get(db) || {};
  return createRuntimeManager({
    userDataDir: databaseAppDataDirs.get(db),
    platform: configured.platform,
    arch: configured.arch,
    fetchJson:
      configured.fetchJson ||
      ((url) => fetchJson(url, {}, "Temurin runtime lookup failed")),
    download: configured.download,
    extractArchive: configured.extractArchive,
    inspectJava: configured.inspectJava,
  });
}

async function planJavaRuntime(db, input) {
  const majorVersion = Number(input?.majorVersion);
  const scan = listJavaRuntimes(db);
  return runtimeManagerFor(db).plan({
    majorVersion,
    installedRuntimes: scan.runtimes,
  });
}

async function installJavaRuntime(db, input) {
  if (input?.consent !== true) {
    throw provisioningError(
      "JAVA_CONSENT_REQUIRED",
      "You must confirm the Temurin license and managed download before installation.",
    );
  }
  const canonicalPlan = await planJavaRuntime(db, {
    majorVersion: input?.plan?.majorVersion,
  });
  const runtime = await runtimeManagerFor(db).install(canonicalPlan, {
    consent: true,
  });
  return runtime;
}

function setupStatusFromJavaCompatibility(compatibility) {
  if (compatibility.status === "compatible") {
    return "ready";
  }
  return "actionRequired";
}

function readEulaAccepted(eulaPath) {
  if (!fs.existsSync(eulaPath)) {
    return false;
  }
  const content = fs.readFileSync(eulaPath, "utf8");
  return /^\s*eula\s*=\s*true\s*$/gim.test(content);
}

function setupServerRuntime(profile) {
  if (profile.launchSpec) {
    try {
      const launch = structuredServerLaunch(profile);
      return {
        id: "serverRuntime",
        status: "ready",
        exists: true,
        kind: "structured",
        fileName: null,
        path: launch.cwd,
        message: "The provisioned server runtime is installed and validated.",
      };
    } catch (error) {
      return {
        id: "serverRuntime",
        status: "actionRequired",
        exists: false,
        kind: "structured",
        fileName: null,
        path: profile.rootDir,
        message: error.message,
      };
    }
  }

  const serverJarPath = path.join(profile.rootDir, "server.jar");
  const hasServerJar = fs.existsSync(serverJarPath);
  return {
    id: "serverRuntime",
    status: hasServerJar ? "ready" : "actionRequired",
    exists: hasServerJar,
    kind: "legacyJar",
    fileName: "server.jar",
    path: serverJarPath,
    message: hasServerJar
      ? "The legacy server.jar runtime is installed."
      : "Install a provisioned server runtime or a legacy server.jar before starting.",
  };
}

function getServerSetupStatus(db, serverId) {
  const profile = getServerProfile(db, requireServerId(serverId));
  const javaCompatibility = listJavaRuntimes(db).compatibility.find(
    (item) => item.serverId === profile.id,
  ) ?? createJavaCompatibility(profile, []);
  const eulaPath = path.join(profile.rootDir, "eula.txt");
  const hasEula = fs.existsSync(eulaPath);
  const eulaAccepted = readEulaAccepted(eulaPath);
  const backupCount = listServerBackups(db, profile.id).length;
  const java = {
    id: "java",
    status: setupStatusFromJavaCompatibility(javaCompatibility),
    message: javaCompatibility.message,
    requiredMajorVersion: javaCompatibility.requiredMajorVersion,
    configuredJavaPath: javaCompatibility.configuredJavaPath,
  };
  const serverRuntime = setupServerRuntime(profile);
  const serverJar = { ...serverRuntime, id: "serverJar" };
  const eula = {
    id: "eula",
    status: eulaAccepted ? "ready" : "actionRequired",
    exists: hasEula,
    accepted: eulaAccepted,
    fileName: "eula.txt",
    path: eulaPath,
    message: eulaAccepted
      ? "Minecraft EULA has been accepted."
      : "Read and accept the Minecraft EULA before setting eula=true.",
  };
  const backup = {
    id: "backup",
    status: backupCount > 0 ? "ready" : "warning",
    count: backupCount,
    message:
      backupCount > 0
        ? "At least one backup exists."
        : "Create a backup before changing jars, mods, configs, or worlds.",
  };

  return {
    serverId: profile.id,
    serverName: profile.name,
    checks: [java, serverRuntime, eula, backup],
    java,
    serverRuntime,
    serverJar,
    eula,
    backup,
  };
}

const MAX_LAUNCH_ARGUMENTS = 128;
const MAX_LAUNCH_ARGUMENT_LENGTH = 4096;
const SHELL_LIKE_ARGUMENT = /(?:&&|\|\||[;&|<>`]|\$\()/;

function invalidLaunchSpec(message) {
  throw new Error(`Invalid launch specification: ${message}`);
}

function validateLaunchArgument(argument) {
  if (typeof argument !== "string" || argument.length === 0) {
    invalidLaunchSpec("arguments must be non-empty strings");
  }
  if (argument.length > MAX_LAUNCH_ARGUMENT_LENGTH) {
    invalidLaunchSpec("argument exceeds the configured length limit");
  }
  if (/[\0\r\n]/.test(argument) || SHELL_LIKE_ARGUMENT.test(argument)) {
    invalidLaunchSpec("argument contains forbidden control or shell syntax");
  }
  if (/^-Xm[sx]/i.test(argument)) {
    invalidLaunchSpec("memory arguments must come from the server profile");
  }
}

function resolveLaunchPath(rootDir, relativePath, description) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    path.isAbsolute(relativePath) ||
    /^[a-zA-Z]:[\\/]/.test(relativePath)
  ) {
    invalidLaunchSpec(`${description} must be target-relative`);
  }
  const resolved = path.resolve(rootDir, relativePath);
  const relative = path.relative(rootDir, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    invalidLaunchSpec(`${description} escapes the server directory`);
  }
  return resolved;
}

function validateJavaExecutable(javaPath) {
  if (typeof javaPath !== "string" || !javaPath || /[\0\r\n]/.test(javaPath)) {
    invalidLaunchSpec("Java executable is missing or invalid");
  }
  const executableName = path.basename(javaPath).toLowerCase();
  if (executableName !== "java" && executableName !== "java.exe") {
    invalidLaunchSpec("executable must be a configured Java runtime");
  }
  if (hasPathSeparator(javaPath)) {
    const resolved = path.resolve(javaPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      invalidLaunchSpec("Java executable does not exist");
    }
    return resolved;
  }
  return javaPath;
}

function structuredServerLaunch(profile) {
  const spec = profile.launchSpec;
  if (!spec || spec.validated !== true || spec.executable?.kind !== "java") {
    invalidLaunchSpec("a validated Java specification is required");
  }
  if (!Array.isArray(spec.jvmArgs) || !Array.isArray(spec.serverArgs)) {
    invalidLaunchSpec("argument lists are required");
  }
  const launchArgs = [...spec.jvmArgs, ...spec.serverArgs];
  if (launchArgs.length === 0 || launchArgs.length > MAX_LAUNCH_ARGUMENTS) {
    invalidLaunchSpec("argument count is outside configured limits");
  }
  launchArgs.forEach(validateLaunchArgument);

  const cwd = resolveLaunchPath(
    profile.rootDir,
    spec.workingDirectory || ".",
    "working directory",
  );
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    invalidLaunchSpec("working directory does not exist");
  }
  for (let index = 0; index < spec.jvmArgs.length; index += 1) {
    const argument = spec.jvmArgs[index];
    if (argument === "@") {
      invalidLaunchSpec("argument-file reference is empty");
    }
    if (argument === "-jar" && index === spec.jvmArgs.length - 1) {
      invalidLaunchSpec("-jar requires a target-relative file");
    }
    let referencedFile = null;
    if (argument.startsWith("@")) referencedFile = argument.slice(1);
    if (index > 0 && spec.jvmArgs[index - 1] === "-jar") referencedFile = argument;
    if (!referencedFile) continue;
    const filePath = resolveLaunchPath(cwd, referencedFile, "launch file");
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      invalidLaunchSpec(`launch file does not exist: ${referencedFile}`);
    }
  }

  return {
    executable: validateJavaExecutable(profile.javaPath),
    cwd,
    args: [
      profile.minMemoryMb ? `-Xms${profile.minMemoryMb}M` : null,
      profile.maxMemoryMb ? `-Xmx${profile.maxMemoryMb}M` : null,
      ...spec.jvmArgs,
      ...spec.serverArgs,
    ].filter(Boolean),
  };
}

function legacyServerLaunch(profile) {
  const serverJar = path.join(profile.rootDir, "server.jar");
  if (!fs.existsSync(serverJar)) {
    throw new Error(
      `server.jar does not exist: ${serverJar}. Install a server jar from Settings > Server updates before starting this profile.`,
    );
  }
  return {
    executable: validateJavaExecutable(profile.javaPath || "java"),
    cwd: profile.rootDir,
    args: [
      profile.minMemoryMb ? `-Xms${profile.minMemoryMb}M` : null,
      profile.maxMemoryMb ? `-Xmx${profile.maxMemoryMb}M` : null,
      "-jar",
      serverJar,
      "nogui",
    ].filter(Boolean),
  };
}

function startServer(db, serverId, options = {}) {
  const profile = getServerProfile(db, requireServerId(serverId));
  if (!options.autoRestart) {
    clearRestartState(profile.id);
  }
  const launch = profile.launchSpec
    ? structuredServerLaunch(profile)
    : legacyServerLaunch(profile);
  const child = processSpawnerFor(db)(launch.executable, launch.args, {
    cwd: launch.cwd,
    env: process.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const id = randomUUID();
  const startedAt = nowIso();
  db.prepare(
    `INSERT INTO managed_processes
      (id, server_id, pid, command, status, started_at)
     VALUES (?, ?, ?, ?, 'running', ?)`,
  ).run(
    id,
    profile.id,
    child.pid || null,
    [launch.executable, ...launch.args].join(" "),
    startedAt,
  );
  const managed = {
    id,
    child,
    db,
    crashDetected: false,
    stopRequested: false,
    onlinePlayers: new Set(),
  };
  managedChildren.set(profile.id, managed);
  addProcessEvent(db, profile.id, "info", "Server process started.");
  const handleOutputLine = (level, line) => {
    const joined = line.match(/\b([A-Za-z0-9_]{1,16}) joined the game\b/);
    const left = line.match(/\b([A-Za-z0-9_]{1,16}) left the game\b/);
    if (joined) managed.onlinePlayers.add(joined[1]);
    if (left) managed.onlinePlayers.delete(left[1]);
    addProcessEvent(db, profile.id, level, line);
    if (
      !managed.stopRequested &&
      !managed.crashDetected &&
      isServerCrashSignature(line)
    ) {
      managed.crashDetected = true;
      db.prepare(
        "UPDATE managed_processes SET status = 'crashed', exited_at = COALESCE(exited_at, ?) WHERE id = ?",
      ).run(nowIso(), id);
      addProcessEvent(
        db,
        profile.id,
        "error",
        `Crash signature detected while process was still open: ${line}`,
      );
      child.kill();
    }
  };
  child.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
      handleOutputLine("info", line);
    }
  });
  child.stderr.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
      handleOutputLine("error", line);
    }
  });
  child.on("exit", (code) => {
    databaseMetricBaselines.get(db)?.delete(child.pid);
    managedChildren.delete(profile.id);
    if (closedDatabases.has(db)) {
      return;
    }
    const crashed = !managed.stopRequested && (managed.crashDetected || code !== 0);
    db.prepare(
      "UPDATE managed_processes SET status = ?, exited_at = ?, exit_code = ? WHERE id = ?",
    ).run(crashed ? "crashed" : "stopped", nowIso(), code, id);
    addProcessEvent(
      db,
      profile.id,
      crashed ? "error" : "info",
      `Server process exited with code ${code ?? "unknown"}.`,
    );
    if (crashed) {
      scheduleCrashRestart(
        db,
        profile,
        managed.crashDetected ? "crash signature" : `exit code ${code ?? "unknown"}`,
      );
    } else {
      clearRestartState(profile.id);
    }
  });
  return getServerProcessStatus(db, profile.id);
}

function stopServer(db, serverId) {
  const id = requireServerId(serverId);
  clearRestartCountdown(id);
  const managed = managedChildren.get(id);
  if (managed) {
    managed.stopRequested = true;
    clearRestartState(id);
    managed.child.stdin?.write("stop\n");
    setTimeout(() => {
      if (!managed.child.killed) {
        managed.child.kill();
      }
    }, 5000).unref?.();
  }
  db.prepare(
    `UPDATE managed_processes
     SET status = 'stopped', exited_at = COALESCE(exited_at, ?)
     WHERE server_id = ? AND status IN ('running', 'external_running')`,
  ).run(nowIso(), id);
  addProcessEvent(db, id, "info", "Stop requested.");
  return null;
}

function sendServerCommand(db, serverId, command) {
  const id = requireServerId(serverId);
  const value = trimRequired(command, "server command is required");
  const managed = managedChildren.get(id);
  if (!managed) {
    throw new Error("server process is not running");
  }
  managed.child.stdin.write(`${value}\n`);
  addProcessEvent(db, id, "info", `> ${value}`);
  return null;
}

function waitForManagedExitBeforeRestart(db, serverId, managed) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      managed.child.removeListener("exit", onExit);
      if (!managed.child.killed) {
        managed.child.kill();
      }
      addProcessEvent(
        db,
        serverId,
        "error",
        "Restart aborted because the previous server process did not exit.",
      );
      reject(new Error("server process did not exit before restart"));
    }, 8000);
    timer.unref?.();

    function onExit() {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    }

    managed.child.once("exit", onExit);
  });
}

async function restartServer(db, serverId) {
  const id = requireServerId(serverId);
  clearRestartCountdown(id);
  const managed = managedChildren.get(id);
  if (!managed) {
    return startServer(db, id);
  }
  const exitPromise = waitForManagedExitBeforeRestart(db, id, managed);
  stopServer(db, id);
  await exitPromise;
  return startServer(db, id);
}

function clearRestartCountdown(serverId) {
  const timers = restartCountdownTimers.get(serverId);
  if (!timers) {
    return;
  }
  for (const timer of timers) {
    clearTimeout(timer);
  }
  restartCountdownTimers.delete(serverId);
}

function normalizeCountdownSteps(steps) {
  const values = Array.isArray(steps) && steps.length > 0 ? steps : [300, 60, 10];
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value)),
    ),
  ).sort((left, right) => right - left);
}

function formatCountdownTime(seconds) {
  if (seconds % 60 === 0 && seconds >= 60) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function restartServerWithCountdown(db, input) {
  const id = requireServerId(input?.serverId);
  const managed = managedChildren.get(id);
  if (!managed) {
    return startServer(db, id);
  }
  const stepsSeconds = normalizeCountdownSteps(input?.stepsSeconds);
  const durationSeconds = stepsSeconds[0] ?? 0;
  const messageTemplate =
    typeof input?.messageTemplate === "string" && input.messageTemplate.trim()
      ? input.messageTemplate.trim()
      : "Server restarting in {time}";
  clearRestartCountdown(id);
  const timers = [];
  const sendCountdownMessage = (seconds) => {
    const current = managedChildren.get(id);
    if (!current) {
      return;
    }
    const time = formatCountdownTime(seconds);
    sendServerCommand(db, id, `say ${messageTemplate.replace("{time}", time)}`);
  };

  for (const seconds of stepsSeconds) {
    if (seconds === durationSeconds) {
      continue;
    }
    const delayMs = Math.max(0, durationSeconds - seconds) * 1000;
    const timer = setTimeout(() => sendCountdownMessage(seconds), delayMs);
    timer.unref?.();
    timers.push(timer);
  }

  const restartTimer = setTimeout(() => {
    restartCountdownTimers.delete(id);
    Promise.resolve(restartServer(db, id)).catch((error) => {
      addProcessEvent(
        db,
        id,
        "error",
        `Restart countdown failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, durationSeconds * 1000);
  restartTimer.unref?.();
  timers.push(restartTimer);
  restartCountdownTimers.set(id, timers);
  addProcessEvent(
    db,
    id,
    "info",
    `Restart countdown scheduled for ${formatCountdownTime(durationSeconds)}.`,
  );
  if (stepsSeconds.includes(durationSeconds)) {
    sendCountdownMessage(durationSeconds);
  }
  return {
    serverId: id,
    stepsSeconds,
    scheduledFor: new Date(Date.now() + durationSeconds * 1000).toISOString(),
  };
}

function listServerFiles(db, serverId, relativePath) {
  const { root, target } = safeServerPath(db, serverId, relativePath);
  if (!fs.existsSync(target)) {
    return [];
  }
  return fs.readdirSync(target, { withFileTypes: true }).map((entry) => {
    const fullPath = path.join(target, entry.name);
    const stat = fs.statSync(fullPath);
    const childRelative = path.relative(root, fullPath).replace(/\\/g, "/");
    return {
      name: entry.name,
      relativePath: childRelative,
      kind: entry.isDirectory() ? "directory" : "file",
      sizeBytes: entry.isFile() ? stat.size : 0,
      modifiedAt: stat.mtime.toISOString(),
      editable: entry.isFile() && stat.size <= 1024 * 1024,
    };
  });
}

function readServerTextFile(db, serverId, relativePath) {
  const { root, target } = safeServerPath(db, serverId, relativePath);
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    throw new Error("selected path is not a file");
  }
  if (stat.size > 1024 * 1024) {
    throw new Error("file is too large to edit");
  }
  return {
    relativePath: path.relative(root, target).replace(/\\/g, "/"),
    content: fs.readFileSync(target, "utf8"),
    sizeBytes: stat.size,
    readOnly: false,
    warning: null,
  };
}

function writeServerTextFile(db, serverId, relativePath, content) {
  const { target } = safeServerPath(db, serverId, relativePath);
  fs.writeFileSync(target, String(content ?? ""), "utf8");
  return readServerTextFile(db, serverId, relativePath);
}

function propertiesPath(db, serverId) {
  return path.join(serverRoot(db, serverId), "server.properties");
}

function readServerProperties(db, serverId) {
  const filePath = propertiesPath(db, serverId);
  if (!fs.existsSync(filePath)) {
    return { serverId, path: filePath, entries: [], raw: "", warnings: [] };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const { entries, warnings } = mergeProperties(raw, []);
  return { serverId, path: filePath, entries, raw, warnings };
}

function saveServerProperties(db, serverId, entries) {
  const filePath = propertiesPath(db, serverId);
  const requestedEntries = entries || [];
  const portEntry = [...requestedEntries]
    .reverse()
    .find((entry) => entry?.key === "server-port");
  const nextPort = portEntry ? Number(portEntry.value) : null;
  if (
    portEntry &&
    (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535)
  ) {
    throw new Error("server port must be between 1 and 65535");
  }
  const fileExisted = fs.existsSync(filePath);
  const currentRaw = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : "";
  const merged = mergeProperties(currentRaw, requestedEntries);
  fs.writeFileSync(filePath, merged.raw, "utf8");
  try {
    if (portEntry) {
      db.prepare("UPDATE servers SET server_port = ?, updated_at = ? WHERE id = ?")
        .run(nextPort, nowIso(), serverId);
    }
  } catch (error) {
    if (fileExisted) fs.writeFileSync(filePath, currentRaw, "utf8");
    else fs.rmSync(filePath, { force: true });
    throw error;
  }
  return {
    ...readServerProperties(db, serverId),
    warnings: merged.warnings,
    restartRequired: requestedEntries.length > 0,
  };
}

function mapBackup(row) {
  return {
    id: row.id,
    serverId: row.server_id,
    profileId: row.profile_id,
    kind: row.kind,
    archivePath: row.archive_path,
    worldName: row.world_name,
    sizeBytes: row.size_bytes,
    status: row.status,
    createdAt: row.created_at,
    error: row.error,
  };
}

function listServerBackups(db, serverId) {
  return db
    .prepare(
      "SELECT * FROM backups WHERE server_id = ? ORDER BY created_at DESC",
    )
    .all(requireServerId(serverId))
    .map(mapBackup);
}

function createBackupRecord(
  db,
  serverId,
  profileId = null,
  includePaths = ["world"],
) {
  const profile = getServerProfile(db, requireServerId(serverId));
  const id = randomUUID();
  const createdAt = nowIso();
  const backupRoot = path.join(profile.rootDir, "backups", id);
  const hasRunningProcess = Boolean(managedChildren.get(profile.id));
  if (hasRunningProcess) {
    sendServerCommand(db, profile.id, "save-off");
    sendServerCommand(db, profile.id, "save-all flush");
  }
  try {
    fs.mkdirSync(backupRoot, { recursive: true });
    for (const relative of includePaths.length ? includePaths : ["world"]) {
      const { target: source } = safeServerPath(db, profile.id, relative);
      if (fs.existsSync(source)) {
        const destinationRelative = path
          .relative(path.resolve(profile.rootDir), source)
          .replace(/\\/g, "/");
        fs.cpSync(source, path.join(backupRoot, destinationRelative), {
          recursive: true,
          force: true,
        });
      }
    }
  } finally {
    if (hasRunningProcess) {
      sendServerCommand(db, profile.id, "save-on");
    }
  }
  const sizeBytes = directorySizeBytes(backupRoot);
  db.prepare(
    `INSERT INTO backups
      (id, server_id, profile_id, kind, archive_path, world_name, size_bytes, status, created_at)
     VALUES (?, ?, ?, 'world', ?, 'world', ?, 'completed', ?)`,
  ).run(id, profile.id, profileId, backupRoot, sizeBytes, createdAt);
  if (profileId) {
    pruneBackupProfileRecords(db, profileId);
  }
  return mapBackup(db.prepare("SELECT * FROM backups WHERE id = ?").get(id));
}

function createWorldBackup(db, input) {
  return createBackupRecord(db, input?.serverId);
}

function deleteServerBackup(db, backupId) {
  const id = trimRequired(backupId, "backup id is required");
  const backup = db.prepare("SELECT * FROM backups WHERE id = ?").get(id);
  if (!backup) {
    throw new Error("backup not found");
  }
  fs.rmSync(backup.archive_path, { recursive: true, force: true });
  db.prepare("DELETE FROM backups WHERE id = ?").run(id);
  return null;
}

function exportServerBackup(db, input) {
  const id = trimRequired(input?.backupId, "backup id is required");
  const destinationRoot = path.resolve(
    trimRequired(input?.targetDir, "target directory is required"),
  );
  const backup = db.prepare("SELECT * FROM backups WHERE id = ?").get(id);
  if (!backup) {
    throw new Error("backup not found");
  }
  if (!fs.existsSync(backup.archive_path)) {
    throw new Error("backup archive folder does not exist");
  }
  fs.mkdirSync(destinationRoot, { recursive: true });
  const exportedPath = path.join(
    destinationRoot,
    safeFilename(
      `${backup.world_name}-${backup.created_at.slice(0, 19)}-${backup.id}`,
      `backup-${backup.id}`,
    ),
  );
  fs.cpSync(backup.archive_path, exportedPath, {
    recursive: true,
    force: true,
  });
  return { exportedPath };
}

function pruneBackupProfileRecords(db, profileId) {
  const profile = db
    .prepare("SELECT * FROM backup_profiles WHERE id = ?")
    .get(profileId);
  if (!profile?.retention_count || profile.retention_count <= 0) {
    return;
  }
  const oldBackups = db
    .prepare(
      `SELECT id FROM backups
        WHERE profile_id = ?
        ORDER BY created_at DESC
        LIMIT -1 OFFSET ?`,
    )
    .all(profileId, profile.retention_count);
  for (const backup of oldBackups) {
    deleteServerBackup(db, backup.id);
  }
}

function modeToDb(mode) {
  return String(mode || "worldOnly").replace(
    /[A-Z]/g,
    (m) => `_${m.toLowerCase()}`,
  );
}

function modeFromDb(mode) {
  return String(mode).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function mapBackupProfile(row) {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    mode: modeFromDb(row.mode),
    includePaths: JSON.parse(row.include_paths || "[]"),
    excludePaths: JSON.parse(row.exclude_paths || "[]"),
    retentionCount: row.retention_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listBackupProfiles(db, serverId) {
  return db
    .prepare(
      "SELECT * FROM backup_profiles WHERE server_id = ? ORDER BY name ASC",
    )
    .all(requireServerId(serverId))
    .map(mapBackupProfile);
}

function createBackupProfile(db, input) {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO backup_profiles
      (id, server_id, name, mode, include_paths, exclude_paths, retention_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    requireServerId(input?.serverId),
    trimRequired(input?.name, "backup profile name is required"),
    modeToDb(input?.mode),
    JSON.stringify(input?.includePaths || []),
    JSON.stringify(input?.excludePaths || []),
    input?.retentionCount ?? null,
    now,
    now,
  );
  return mapBackupProfile(
    db.prepare("SELECT * FROM backup_profiles WHERE id = ?").get(id),
  );
}

function updateBackupProfile(db, input) {
  const id = trimRequired(
    input?.id || input?.profileId,
    "backup profile id is required",
  );
  const existing = db
    .prepare("SELECT * FROM backup_profiles WHERE id = ?")
    .get(id);
  if (!existing) {
    throw new Error("backup profile not found");
  }
  const now = nowIso();
  db.prepare(
    `UPDATE backup_profiles
        SET name = ?,
            mode = ?,
            include_paths = ?,
            exclude_paths = ?,
            retention_count = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(
    trimRequired(input?.name, "backup profile name is required"),
    modeToDb(input?.mode),
    JSON.stringify(input?.includePaths || []),
    JSON.stringify(input?.excludePaths || []),
    input?.retentionCount ?? null,
    now,
    id,
  );
  return mapBackupProfile(
    db.prepare("SELECT * FROM backup_profiles WHERE id = ?").get(id),
  );
}

function deleteBackupProfile(db, profileId) {
  const id = trimRequired(profileId, "backup profile id is required");
  const existing = db
    .prepare("SELECT * FROM backup_profiles WHERE id = ?")
    .get(id);
  if (!existing) {
    throw new Error("backup profile not found");
  }
  db.prepare("DELETE FROM backup_profiles WHERE id = ?").run(id);
  return null;
}

function createProfileBackup(db, input) {
  const profile = db
    .prepare("SELECT * FROM backup_profiles WHERE id = ?")
    .get(input?.profileId);
  if (!profile) {
    throw new Error("backup profile not found");
  }
  return createBackupRecord(
    db,
    profile.server_id,
    profile.id,
    JSON.parse(profile.include_paths || "[]"),
  );
}

function restoreWorldBackup(db, input) {
  if (!input?.confirm) {
    throw new Error("restore requires explicit confirmation");
  }
  const backup = db
    .prepare("SELECT * FROM backups WHERE id = ?")
    .get(input?.backupId);
  if (!backup) {
    throw new Error("backup not found");
  }
  const managed = managedChildren.get(backup.server_id);
  const persistedActiveProcess = db
    .prepare(
      `SELECT 1 FROM managed_processes
       WHERE server_id = ? AND status IN ('running', 'external_running')
       LIMIT 1`,
    )
    .get(backup.server_id);
  if (managed?.db === db || persistedActiveProcess) {
    throw provisioningError(
      "SERVER_MUST_BE_STOPPED",
      "Stop the server before restoring a world backup.",
    );
  }
  const sourceWorld = path.join(backup.archive_path, "world");
  if (!fs.existsSync(sourceWorld)) {
    throw new Error("backup world folder does not exist");
  }
  const targetWorldDir = trimRequired(
    input.targetWorldDir,
    "target world directory is required",
  );
  if (path.isAbsolute(targetWorldDir)) {
    throw new Error("path escapes server root");
  }
  if (
    targetWorldDir === "." ||
    targetWorldDir === ".." ||
    targetWorldDir.includes("/") ||
    targetWorldDir.includes("\\")
  ) {
    throw new Error("restore target must be a world folder name");
  }
  if (targetWorldDir.toLowerCase() === "backups") {
    throw new Error("restore target must not overlap backup storage");
  }
  const { target } = safeServerPath(
    db,
    backup.server_id,
    targetWorldDir,
  );
  fs.rmSync(target, {
    recursive: true,
    force: true,
  });
  fs.cpSync(sourceWorld, target, {
    recursive: true,
    force: true,
  });
  return null;
}

function listPlayers(db, serverId) {
  const id = requireServerId(serverId);
  const lists = readPlayerLists(db, id).lists;
  const names = new Set();
  for (const doc of lists) {
    for (const entry of doc.entries) {
      if (entry.name) names.add(entry.name);
    }
  }
  return {
    serverId: id,
    players: [...names].sort().map((username) => ({
      username,
      uuid: null,
      online: false,
      operator:
        lists
          .find((doc) => doc.listType === "ops")
          ?.entries.some((entry) => entry.name === username) || false,
      whitelisted:
        lists
          .find((doc) => doc.listType === "whitelist")
          ?.entries.some((entry) => entry.name === username) || false,
      banned:
        lists
          .find((doc) => doc.listType === "bannedPlayers")
          ?.entries.some((entry) => entry.name === username) || false,
      firstSeen: null,
      lastSeen: null,
    })),
    actionsAvailable: Boolean(managedChildren.get(id)),
    unavailableReason: managedChildren.get(id)
      ? null
      : "Server process is not running.",
  };
}

function applyPlayerAction(db, input) {
  const player = trimRequired(input?.player, "player name is required");
  const actionCommands = {
    op: `op ${player}`,
    deop: `deop ${player}`,
    ban: `ban ${player}`,
    pardon: `pardon ${player}`,
    kick: `kick ${player}`,
    whitelistAdd: `whitelist add ${player}`,
    whitelistRemove: `whitelist remove ${player}`,
  };
  const command = actionCommands[input?.action];
  if (!command) {
    throw new Error("unsupported player action");
  }
  sendServerCommand(db, input.serverId, command);
  return { commandSent: command };
}

function playerListFiles(root) {
  return [
    ["ops", "ops.json"],
    ["whitelist", "whitelist.json"],
    ["bannedPlayers", "banned-players.json"],
    ["bannedIps", "banned-ips.json"],
  ].map(([listType, fileName]) => ({
    listType,
    fileName,
    path: path.join(root, fileName),
  }));
}

function readPlayerLists(db, serverId) {
  const root = serverRoot(db, serverId);
  return {
    serverId,
    lists: playerListFiles(root).map((item) => {
      try {
        return {
          listType: item.listType,
          fileName: item.fileName,
          entries: fs.existsSync(item.path)
            ? JSON.parse(fs.readFileSync(item.path, "utf8"))
            : [],
          error: null,
        };
      } catch (error) {
        return {
          listType: item.listType,
          fileName: item.fileName,
          entries: [],
          error: error.message,
        };
      }
    }),
  };
}

function savePlayerList(db, input) {
  const root = serverRoot(db, input?.serverId);
  const item = playerListFiles(root).find(
    (entry) => entry.listType === input?.listType,
  );
  if (!item) {
    throw new Error("unknown player list type");
  }
  fs.writeFileSync(
    item.path,
    JSON.stringify(input.entries || [], null, 2),
    "utf8",
  );
  return {
    listType: item.listType,
    fileName: item.fileName,
    entries: input.entries || [],
    error: null,
  };
}

function mapInstalledContent(row) {
  return {
    id: row.id,
    serverId: row.server_id,
    contentId: row.content_id,
    name: row.name,
    version: row.version,
    loader: row.loader,
    environment: row.environment,
    sourcePath: row.source_path,
    installedPath: row.installed_path,
    sha256: row.sha256,
    warnings: JSON.parse(row.warnings_json || "[]"),
    installedAt: row.installed_at,
  };
}

function listInstalledContent(db, serverId) {
  return db
    .prepare(
      "SELECT * FROM installed_content WHERE server_id = ? ORDER BY installed_at DESC",
    )
    .all(requireServerId(serverId))
    .map(mapInstalledContent);
}

function contentTargetDir(profile) {
  return profile.loaderType === "paper" ? "plugins" : "mods";
}

function safeFilename(value, fallback = "download.jar") {
  const name = path.basename(String(value || "").trim() || fallback);
  const sanitized = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
  return sanitized || fallback;
}

function uniqueTargetPath(targetDir, filename) {
  const parsed = path.parse(safeFilename(filename));
  let candidate = path.join(targetDir, `${parsed.name}${parsed.ext}`);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(targetDir, `${parsed.name}-${suffix}${parsed.ext}`);
    suffix += 1;
  }
  return candidate;
}

function marketplaceUserAgent() {
  return "MCServerManager/0.1.0 (https://github.com/NAinfini/MCServerManager)";
}

function requestHeaders(headers = {}) {
  return {
    "User-Agent": marketplaceUserAgent(),
    ...headers,
  };
}

async function fetchJson(
  url,
  options = {},
  message = "Marketplace request failed",
) {
  const response = await fetch(url, {
    ...options,
    headers: requestHeaders({
      Accept: "application/json",
      ...(options.headers || {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`${message}: ${response.status}`);
  }
  return response.json();
}

async function fetchText(
  url,
  options = {},
  message = "Remote metadata request failed",
) {
  const response = await fetch(url, {
    ...options,
    headers: requestHeaders({
      Accept: "text/plain, application/xml, text/xml",
      ...(options.headers || {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`${message}: ${response.status}`);
  }
  return response.text();
}

async function downloadRemoteFile(
  url,
  targetPath,
  headers = {},
  validateFinalUrl = null,
) {
  const response = await fetch(url, {
    headers: requestHeaders(headers),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`file download failed: ${response.status}`);
  }
  if (typeof validateFinalUrl === "function") {
    validateFinalUrl(response.url || url);
  }
  const body = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(targetPath, body);
}

async function installRemoteContent(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  const downloadUrl = trimRequired(
    input?.downloadUrl,
    "download URL is required",
  );
  const targetDir = path.join(profile.rootDir, contentTargetDir(profile));
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = uniqueTargetPath(
    targetDir,
    input?.fileName || path.basename(new URL(downloadUrl).pathname),
  );
  await downloadRemoteFile(downloadUrl, targetPath, input?.headers || {});
  const id = randomUUID();
  db.prepare(
    `INSERT INTO installed_content
      (id, server_id, content_id, name, version, loader, environment, source_path,
       installed_path, sha256, warnings_json, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    profile.id,
    input?.contentId ?? null,
    input?.name || path.basename(targetPath),
    input?.version ?? null,
    profile.loaderType,
    input?.environment ?? null,
    downloadUrl,
    targetPath,
    sha256File(targetPath),
    JSON.stringify(input?.warnings || []),
    nowIso(),
  );
  return mapInstalledContent(
    db.prepare("SELECT * FROM installed_content WHERE id = ?").get(id),
  );
}

function importLocalContent(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  const sourcePath = trimRequired(
    input?.sourcePath || input?.filePath,
    "content source path is required",
  );
  if (!fs.existsSync(sourcePath)) {
    throw new Error("content source file does not exist");
  }
  const targetDir = path.join(profile.rootDir, contentTargetDir(profile));
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, targetPath);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO installed_content
      (id, server_id, content_id, name, version, loader, environment, source_path,
       installed_path, sha256, warnings_json, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    profile.id,
    input?.contentId ?? null,
    input?.name || path.basename(sourcePath),
    input?.version ?? null,
    profile.loaderType,
    input?.environment ?? null,
    sourcePath,
    targetPath,
    sha256File(targetPath),
    "[]",
    nowIso(),
  );
  return mapInstalledContent(
    db.prepare("SELECT * FROM installed_content WHERE id = ?").get(id),
  );
}

function disableInstalledContent(db, input) {
  const content = db
    .prepare("SELECT * FROM installed_content WHERE id = ? AND server_id = ?")
    .get(input?.contentId, input?.serverId);
  if (!content) throw new Error("installed content not found");
  if (content.installed_path.endsWith(".disabled")) {
    return mapInstalledContent(content);
  }
  const disabledPath = `${content.installed_path}.disabled`;
  if (fs.existsSync(disabledPath)) {
    throw new Error("disabled content target already exists");
  }
  fs.renameSync(content.installed_path, disabledPath);
  db.prepare(
    "UPDATE installed_content SET installed_path = ? WHERE id = ?",
  ).run(disabledPath, content.id);
  return mapInstalledContent(
    db.prepare("SELECT * FROM installed_content WHERE id = ?").get(content.id),
  );
}

function enableInstalledContent(db, input) {
  const content = db
    .prepare("SELECT * FROM installed_content WHERE id = ? AND server_id = ?")
    .get(input?.contentId, input?.serverId);
  if (!content) throw new Error("installed content not found");
  if (!content.installed_path.endsWith(".disabled")) {
    return mapInstalledContent(content);
  }
  const enabledPath = content.installed_path.slice(0, -".disabled".length);
  if (fs.existsSync(enabledPath)) {
    throw new Error("enabled content target already exists");
  }
  fs.renameSync(content.installed_path, enabledPath);
  db.prepare(
    "UPDATE installed_content SET installed_path = ? WHERE id = ?",
  ).run(enabledPath, content.id);
  return mapInstalledContent(
    db.prepare("SELECT * FROM installed_content WHERE id = ?").get(content.id),
  );
}

function uninstallInstalledContent(db, input) {
  const content = db
    .prepare("SELECT * FROM installed_content WHERE id = ? AND server_id = ?")
    .get(input?.contentId, input?.serverId);
  if (!content) throw new Error("installed content not found");
  fs.rmSync(content.installed_path, { force: true });
  db.prepare("DELETE FROM installed_content WHERE id = ?").run(content.id);
  return null;
}

function contentPolicyKey(contentId) {
  return contentId || "__server__";
}

function getContentUpdatePolicy(db, args) {
  const serverId = requireServerId(args?.serverId);
  const key = contentPolicyKey(args?.contentId);
  let row = db
    .prepare(
      "SELECT * FROM content_update_policies WHERE server_id = ? AND content_key = ?",
    )
    .get(serverId, key);
  if (!row) {
    saveContentUpdatePolicy(db, {
      serverId,
      contentId: args?.contentId ?? null,
      policy: "manual_only",
    });
    row = db
      .prepare(
        "SELECT * FROM content_update_policies WHERE server_id = ? AND content_key = ?",
      )
      .get(serverId, key);
  }
  return mapContentPolicy(row);
}

function mapContentPolicy(row) {
  return {
    id: row.id,
    serverId: row.server_id,
    contentId: row.content_id,
    policy: row.policy,
    pinnedVersion: row.pinned_version,
    ignoredUpdate: row.ignored_update,
    updatedAt: row.updated_at,
  };
}

function saveContentUpdatePolicy(db, input) {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO content_update_policies
      (id, server_id, content_id, content_key, policy, pinned_version, ignored_update, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id, content_key) DO UPDATE SET
      policy = excluded.policy,
      pinned_version = excluded.pinned_version,
      ignored_update = excluded.ignored_update,
      updated_at = excluded.updated_at`,
  ).run(
    id,
    requireServerId(input?.serverId),
    input?.contentId ?? null,
    contentPolicyKey(input?.contentId),
    input?.policy || "manual_only",
    input?.pinnedVersion ?? null,
    input?.ignoredUpdate ?? null,
    now,
  );
  return getContentUpdatePolicy(db, {
    serverId: input.serverId,
    contentId: input?.contentId ?? null,
  });
}

function planContentUpdates(db, input) {
  const policy = getContentUpdatePolicy(db, {
    serverId: input?.serverId,
    contentId: null,
  });
  const candidates = input?.availableUpdates || [];
  return {
    serverId: requireServerId(input?.serverId),
    policy: policy.policy,
    plannedUpdates: candidates.map(
      (item) => `${item.name} -> ${item.latestVersion}`,
    ),
    warnings: candidates.flatMap((item) => item.warnings || []),
    requiresConfirmation:
      policy.policy === "batch_confirm" &&
      !input?.confirmBatch &&
      candidates.length > 0,
  };
}

function parseInstalledContentProvider(contentId) {
  const parts = String(contentId || "").split(":");
  if (parts.length < 3) {
    return null;
  }
  const [provider, projectId, versionId] = parts;
  if (!provider || !projectId || !versionId) {
    return null;
  }
  return { provider, projectId, versionId };
}

function versionMatchesServer(version, profile) {
  const loaders = version.loaders || [];
  const gameVersions = version.gameVersions || [];
  return (
    (loaders.length === 0 || loaders.includes(profile.loaderType)) &&
    (gameVersions.length === 0 || gameVersions.includes(profile.minecraftVersion))
  );
}

function firstCompatibleVersion(versions, profile, currentVersionId) {
  return versions.find(
    (version) =>
      version.id !== currentVersionId &&
      version.name !== currentVersionId &&
      versionMatchesServer(version, profile),
  );
}

function contentUpdateFile(update) {
  const files = update.files || [];
  return (
    files.find((file) => file.primary && file.url) ||
    files.find((file) => file.url) ||
    null
  );
}

async function resolveContentUpdate(db, profile, content) {
  const parsed = parseInstalledContentProvider(content.content_id);
  if (!parsed) {
    return {
      warning: `${content.name} has no marketplace source metadata and must be updated manually.`,
    };
  }

  if (parsed.provider === "modrinth") {
    const latest = firstCompatibleVersion(
      await listModrinthVersions({ projectId: parsed.projectId }),
      profile,
      parsed.versionId,
    );
    if (!latest) return null;
    const file = contentUpdateFile(latest);
    if (!file?.url) {
      return { warning: `${content.name} has no downloadable Modrinth file.` };
    }
    return {
      installedContentId: content.id,
      provider: "modrinth",
      projectId: parsed.projectId,
      versionId: latest.id,
      currentVersion: content.version,
      latestVersion: latest.versionNumber,
      name: content.name,
      fileName: file.filename,
      downloadUrl: file.url,
      nextContentId: `modrinth:${parsed.projectId}:${latest.id}`,
      warnings: latest.warnings || [],
    };
  }

  if (parsed.provider === "hangar") {
    const latest = (await listHangarVersions({ projectId: parsed.projectId })).find(
      (version) => version.name !== parsed.versionId,
    );
    if (!latest) return null;
    const projectName =
      parsed.projectId.split("/").filter(Boolean).pop() || parsed.projectId;
    return {
      installedContentId: content.id,
      provider: "hangar",
      projectId: parsed.projectId,
      versionId: latest.name,
      currentVersion: content.version,
      latestVersion: latest.name,
      name: content.name,
      fileName: `${projectName}-${latest.name}.jar`,
      downloadUrl: `https://hangar.papermc.io/api/v1/projects/${encodeHangarProjectId(parsed.projectId)}/versions/${encodeURIComponent(latest.name)}/PAPER/download`,
      nextContentId: `hangar:${parsed.projectId}:${latest.name}`,
      warnings: [],
    };
  }

  if (parsed.provider === "curseforge") {
    const latest = firstCompatibleVersion(
      await listCurseForgeFiles({ modId: parsed.projectId }),
      profile,
      parsed.versionId,
    );
    if (!latest) return null;
    const file = latest.files?.[0];
    return {
      installedContentId: content.id,
      provider: "curseforge",
      projectId: parsed.projectId,
      versionId: latest.id,
      currentVersion: content.version,
      latestVersion: latest.versionNumber,
      name: content.name,
      fileName: file?.filename || `${parsed.projectId}-${latest.id}.jar`,
      downloadUrl: await curseForgeDownloadUrl(parsed.projectId, latest.id),
      headers: { "x-api-key": curseForgeApiKey() },
      nextContentId: `curseforge:${parsed.projectId}:${latest.id}`,
      warnings: latest.warnings || [],
    };
  }

  if (parsed.provider === "bbsmc") {
    const latest = firstCompatibleVersion(
      await listBbsmcVersions({ projectId: parsed.projectId }),
      profile,
      parsed.versionId,
    );
    if (!latest) return null;
    const file = selectInstallableBbsmcFile(latest);
    try {
      ensureBbsmcFileIsDirect(file, latest);
    } catch (error) {
      return {
        warning: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      installedContentId: content.id,
      provider: "bbsmc",
      projectId: parsed.projectId,
      versionId: latest.id,
      currentVersion: content.version,
      latestVersion: latest.versionNumber,
      name: content.name,
      fileName: file.filename,
      downloadUrl: file.url,
      nextContentId: `bbsmc:${parsed.projectId}:${latest.id}`,
      warnings: latest.warnings || [],
    };
  }

  return {
    warning: `${content.name} uses unsupported content provider ${parsed.provider}.`,
  };
}

async function checkContentUpdates(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  const rows = db
    .prepare("SELECT * FROM installed_content WHERE server_id = ?")
    .all(profile.id);
  const updates = [];
  const warnings = [];
  for (const row of rows) {
    const result = await resolveContentUpdate(db, profile, row);
    if (!result) continue;
    if (result.warning) {
      warnings.push(result.warning);
      continue;
    }
    updates.push(result);
  }
  return {
    serverId: profile.id,
    checkedAt: nowIso(),
    updates,
    warnings,
  };
}

function uniqueBackupPath(filePath) {
  let candidate = `${filePath}.mcsm-backup`;
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${filePath}.${suffix}.mcsm-backup`;
    suffix += 1;
  }
  return candidate;
}

async function installResolvedContentUpdate(db, content, update) {
  const targetDir = path.dirname(content.installed_path);
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = uniqueTargetPath(targetDir, update.fileName);
  await downloadRemoteFile(update.downloadUrl, targetPath, update.headers || {});
  let backupPath = null;
  if (fs.existsSync(content.installed_path)) {
    backupPath = uniqueBackupPath(content.installed_path);
    fs.renameSync(content.installed_path, backupPath);
  }
  const now = nowIso();
  db.prepare(
    `UPDATE installed_content
        SET content_id = ?,
            version = ?,
            source_path = ?,
            installed_path = ?,
            sha256 = ?,
            warnings_json = ?,
            installed_at = ?
      WHERE id = ?`,
  ).run(
    update.nextContentId,
    update.latestVersion,
    update.downloadUrl,
    targetPath,
    sha256File(targetPath),
    JSON.stringify(update.warnings || []),
    now,
    content.id,
  );
  return {
    content: mapInstalledContent(
      db.prepare("SELECT * FROM installed_content WHERE id = ?").get(content.id),
    ),
    backupPath,
  };
}

async function installContentUpdate(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  const content = db
    .prepare("SELECT * FROM installed_content WHERE id = ? AND server_id = ?")
    .get(input?.installedContentId, profile.id);
  if (!content) {
    throw new Error("installed content not found");
  }
  const update = await resolveContentUpdate(db, profile, content);
  if (!update || update.warning) {
    throw new Error(update?.warning || "installed content is already current");
  }
  return installResolvedContentUpdate(db, content, update);
}

async function installAllContentUpdates(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  const plan = await checkContentUpdates(db, { serverId: profile.id });
  const installed = [];
  for (const update of plan.updates) {
    const content = db
      .prepare("SELECT * FROM installed_content WHERE id = ? AND server_id = ?")
      .get(update.installedContentId, profile.id);
    if (content) {
      installed.push(await installResolvedContentUpdate(db, content, update));
    }
  }
  return {
    serverId: profile.id,
    installed,
    warnings: plan.warnings,
  };
}

function listTunnelProviders(db) {
  return db
    .prepare("SELECT * FROM tunnel_providers ORDER BY created_at DESC")
    .all()
    .map(mapTunnelProvider);
}

function getTunnelProvider(db, providerId) {
  const provider = listTunnelProviders(db).find(
    (item) =>
      item.id === trimRequired(providerId, "tunnel provider id is required"),
  );
  if (!provider) {
    throw new Error("tunnel provider not found");
  }
  return provider;
}

function listTunnelStatuses(db) {
  return db
    .prepare("SELECT * FROM tunnel_processes")
    .all()
    .map((row) => ({
      providerId: row.provider_id,
      status: row.status,
      pid: row.pid,
      refCount: row.ref_count,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    }));
}

function validateTunnelProviderInput(input) {
  const kind = input?.kind || "custom";
  if (!["custom", "application"].includes(kind)) {
    throw new Error(`unsupported tunnel provider type: ${kind}`);
  }
  if (kind === "custom") {
    trimRequired(input?.command, "tunnel command is required");
  }
  if (kind === "application") {
    const applicationPath = trimRequired(
      input?.command,
      "tunnel application path is required",
    );
    if (!fs.existsSync(applicationPath)) {
      throw new Error("tunnel application path does not exist");
    }
  }
  return kind;
}

function normalizeTunnelProviderKind(kind) {
  return kind === "playit" ? "application" : kind;
}

function mapTunnelProvider(row) {
  return {
    id: row.id,
    name: row.name,
    kind: normalizeTunnelProviderKind(row.kind),
    command: row.command,
    enabled: row.enabled !== 0,
    createdAt: row.created_at,
  };
}

function createTunnelProvider(db, input) {
  const id = randomUUID();
  const kind = validateTunnelProviderInput(input);
  db.prepare(
    "INSERT INTO tunnel_providers (id, name, kind, command, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
  ).run(
    id,
    trimRequired(input?.name, "tunnel provider name is required"),
    kind,
    input?.command ?? null,
    nowIso(),
  );
  return listTunnelProviders(db).find((provider) => provider.id === id);
}

function updateTunnelProvider(db, input) {
  const id = trimRequired(input?.id, "tunnel provider id is required");
  const existing = getTunnelProvider(db, id);
  const existingRaw = db
    .prepare("SELECT * FROM tunnel_providers WHERE id = ?")
    .get(id);
  const kindChanged =
    input?.kind !== undefined &&
    input.kind !== normalizeTunnelProviderKind(existingRaw.kind);
  const commandChanged =
    input?.command !== undefined && input.command !== existingRaw.command;
  const nameChanged = input?.name !== undefined && input.name !== existing.name;
  const kind =
    kindChanged || commandChanged || nameChanged
      ? validateTunnelProviderInput(input)
      : normalizeTunnelProviderKind(existingRaw.kind);
  const enabled =
    input?.enabled === undefined
      ? existing.enabled
        ? 1
        : 0
      : input.enabled === false
        ? 0
        : 1;
  db.prepare(
    "UPDATE tunnel_providers SET name = ?, kind = ?, command = ?, enabled = ? WHERE id = ?",
  ).run(
    trimRequired(input?.name, "tunnel provider name is required"),
    kind,
    input?.command ?? null,
    enabled,
    id,
  );
  return getTunnelProvider(db, id);
}

function deleteTunnelProvider(db, providerId) {
  const id = trimRequired(providerId, "tunnel provider id is required");
  getTunnelProvider(db, id);
  db.prepare("DELETE FROM tunnel_providers WHERE id = ?").run(id);
  return null;
}

function listTunnelBindings(db) {
  return db
    .prepare(
      `SELECT
          tunnel_bindings.id,
          tunnel_bindings.provider_id,
          tunnel_bindings.server_id,
          tunnel_bindings.created_at,
          tunnel_providers.name AS provider_name,
          servers.name AS server_name
        FROM tunnel_bindings
        JOIN tunnel_providers ON tunnel_providers.id = tunnel_bindings.provider_id
        JOIN servers ON servers.id = tunnel_bindings.server_id
        ORDER BY tunnel_providers.name ASC, servers.name ASC`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      serverId: row.server_id,
      providerName: row.provider_name,
      serverName: row.server_name,
      createdAt: row.created_at,
    }));
}

function bindTunnelToServer(db, input) {
  db.prepare(
    "INSERT OR IGNORE INTO tunnel_bindings (id, provider_id, server_id, created_at) VALUES (?, ?, ?, ?)",
  ).run(
    randomUUID(),
    trimRequired(input?.providerId, "tunnel provider id is required"),
    requireServerId(input?.serverId),
    nowIso(),
  );
  return null;
}

function unbindTunnelFromServer(db, input) {
  const providerId = trimRequired(
    input?.providerId,
    "tunnel provider id is required",
  );
  const serverId = requireServerId(input?.serverId);
  db.prepare(
    "DELETE FROM tunnel_bindings WHERE provider_id = ? AND server_id = ?",
  ).run(providerId, serverId);
  return null;
}

function listScheduledTasks(db, serverId) {
  return db
    .prepare(
      "SELECT * FROM scheduled_tasks WHERE server_id = ? ORDER BY created_at DESC",
    )
    .all(requireServerId(serverId))
    .map((row) => ({
      id: row.id,
      serverId: row.server_id,
      name: row.name,
      kind: row.kind,
      intervalMinutes: row.interval_minutes,
      command: row.command,
      enabled: row.enabled,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

function listScheduledTaskRuns(db, serverId) {
  return db
    .prepare(
      "SELECT * FROM scheduled_task_runs WHERE server_id = ? ORDER BY started_at DESC LIMIT 50",
    )
    .all(requireServerId(serverId))
    .map((row) => ({
      id: row.id,
      taskId: row.task_id,
      serverId: row.server_id,
      status: row.status,
      message: row.message,
      scheduledFor: row.scheduled_for,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    }));
}

function createScheduledTask(db, input) {
  const id = randomUUID();
  const now = nowIso();
  const intervalMinutes = Number(input?.intervalMinutes || 0);
  if (intervalMinutes <= 0) throw new Error("task interval must be positive");
  const nextRunAt = new Date(
    Date.now() + intervalMinutes * 60_000,
  ).toISOString();
  db.prepare(
    `INSERT INTO scheduled_tasks
      (id, server_id, name, kind, interval_minutes, command, enabled, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(
    id,
    requireServerId(input?.serverId),
    trimRequired(input?.name, "task name is required"),
    input?.kind || "command",
    intervalMinutes,
    input?.command ?? null,
    nextRunAt,
    now,
    now,
  );
  return listScheduledTasks(db, input.serverId).find((task) => task.id === id);
}

function updateScheduledTask(db, input) {
  const id = trimRequired(
    input?.id || input?.taskId,
    "scheduled task id is required",
  );
  const existing = db
    .prepare("SELECT * FROM scheduled_tasks WHERE id = ?")
    .get(id);
  if (!existing) {
    throw new Error("scheduled task not found");
  }
  const intervalMinutes = Number(input?.intervalMinutes || 0);
  if (intervalMinutes <= 0) throw new Error("task interval must be positive");
  const now = nowIso();
  const enabled =
    input?.enabled === undefined
      ? existing.enabled
      : input.enabled === false
        ? 0
        : 1;
  const nextRunAt = enabled
    ? new Date(Date.now() + intervalMinutes * 60_000).toISOString()
    : existing.next_run_at;
  db.prepare(
    `UPDATE scheduled_tasks
        SET name = ?,
            kind = ?,
            interval_minutes = ?,
            command = ?,
            enabled = ?,
            next_run_at = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(
    trimRequired(input?.name, "task name is required"),
    input?.kind || "command",
    intervalMinutes,
    input?.command ?? null,
    enabled,
    nextRunAt,
    now,
    id,
  );
  return listScheduledTasks(db, existing.server_id).find(
    (task) => task.id === id,
  );
}

function deleteScheduledTask(db, taskId) {
  const id = trimRequired(taskId, "scheduled task id is required");
  const existing = db
    .prepare("SELECT * FROM scheduled_tasks WHERE id = ?")
    .get(id);
  if (!existing) {
    throw new Error("scheduled task not found");
  }
  db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
  return null;
}

async function runDueScheduledTasks(db) {
  const now = nowIso();
  const tasks = db
    .prepare(
      `SELECT * FROM scheduled_tasks
        WHERE enabled = 1 AND next_run_at <= ?
        ORDER BY next_run_at ASC`,
    )
    .all(now);
  const runs = [];
  for (const task of tasks) {
    const scheduledFor = task.next_run_at;
    const startedAt = nowIso();
    let status = "completed";
    let message = "Task completed.";
    try {
      await runScheduledTaskAction(db, task);
    } catch (error) {
      status = "failed";
      message = error instanceof Error ? error.message : String(error);
    }
    const finishedAt = nowIso();
    const nextRunAt = new Date(
      Date.now() + task.interval_minutes * 60_000,
    ).toISOString();
    const run = {
      id: randomUUID(),
      taskId: task.id,
      serverId: task.server_id,
      status,
      message,
      scheduledFor,
      startedAt,
      finishedAt,
    };
    db.prepare(
      `INSERT INTO scheduled_task_runs
        (id, task_id, server_id, status, message, scheduled_for, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      run.id,
      run.taskId,
      run.serverId,
      run.status,
      run.message,
      run.scheduledFor,
      run.startedAt,
      run.finishedAt,
    );
    db.prepare(
      `UPDATE scheduled_tasks
          SET last_run_at = ?,
              next_run_at = ?,
              updated_at = ?
        WHERE id = ?`,
    ).run(finishedAt, nextRunAt, finishedAt, task.id);
    runs.push(run);
  }
  return runs;
}

async function runScheduledTaskAction(db, task) {
  switch (task.kind) {
    case "start":
      return startServer(db, task.server_id);
    case "stop":
      return stopServer(db, task.server_id);
    case "restart":
      return restartServer(db, task.server_id);
    case "world_backup":
      return createWorldBackup(db, { serverId: task.server_id });
    case "command":
      return sendServerCommand(db, task.server_id, task.command);
    case "server_update_check":
      return checkServerUpdate(db, {
        serverId: task.server_id,
        targetVersion: task.command || undefined,
      });
    case "content_update_check":
      return checkContentUpdates(db, { serverId: task.server_id });
    default:
      throw new Error(`unsupported scheduled task kind: ${task.kind}`);
  }
}

function diskFreeMb(rootDir) {
  try {
    const stats = fs.statfsSync(rootDir);
    return Math.round((Number(stats.bavail) * Number(stats.bsize)) / (1024 * 1024));
  } catch {
    return null;
  }
}

function parseMetricAvailability(value) {
  if (!value) return { reasons: {}, tps: null };
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return { reasons: {}, tps: null };
    }
    return parsed.reasons
      ? { reasons: parsed.reasons, tps: parsed.tps ?? null }
      : { reasons: parsed, tps: null };
  } catch {
    return { reasons: { general: String(value) }, tps: null };
  }
}

async function sampleServerMetrics(db, serverId) {
  const id = randomUUID();
  const profile = getServerProfile(db, requireServerId(serverId));
  const processStatus = getServerProcessStatus(db, profile.id);
  const running = ["running", "externalRunning"].includes(processStatus?.status);
  const managed = managedChildren.get(profile.id);
  const managedForDatabase = managed?.db === db ? managed : null;
  const processMetrics = running && processStatus?.pid
    ? await measuredProcessMetrics(db, processStatus.pid)
    : { cpuPercent: null, memoryMb: null, tps: null };
  const freeDisk = diskFreeMb(profile.rootDir);
  const restartCount = Math.max(
    0,
    Number(
      db.prepare("SELECT COUNT(*) AS count FROM managed_processes WHERE server_id = ?")
        .get(profile.id).count,
    ) - 1,
  );
  const unavailableReasons = {};
  if (processMetrics.tps === null) {
    unavailableReasons.tps = "TPS_PROVIDER_UNAVAILABLE";
  }
  if (!running) {
    unavailableReasons.cpuPercent = "PROCESS_NOT_RUNNING";
    unavailableReasons.memoryMb = "PROCESS_NOT_RUNNING";
    unavailableReasons.uptimeSeconds = "PROCESS_NOT_RUNNING";
    unavailableReasons.playerCount = "PROCESS_NOT_RUNNING";
  } else {
    if (processMetrics.cpuPercent === null) {
      unavailableReasons.cpuPercent = "PROCESS_METRICS_UNAVAILABLE";
    }
    if (processMetrics.memoryMb === null) {
      unavailableReasons.memoryMb = "PROCESS_METRICS_UNAVAILABLE";
    }
    if (!managedForDatabase) {
      unavailableReasons.playerCount = "PLAYER_PROVIDER_UNAVAILABLE";
    }
  }
  if (freeDisk === null) {
    unavailableReasons.diskFreeMb = "DISK_METRICS_UNAVAILABLE";
  }
  const sample = {
    id,
    serverId: profile.id,
    cpuPercent: processMetrics.cpuPercent,
    memoryMb: processMetrics.memoryMb,
    diskFreeMb: freeDisk,
    uptimeSeconds: running && processStatus?.startedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(processStatus.startedAt).getTime()) / 1000))
      : null,
    restartCount,
    playerCount: running && managedForDatabase ? managedForDatabase.onlinePlayers.size : null,
    tps: processMetrics.tps,
    unavailableReasons,
    unavailableReason: null,
    sampledAt: nowIso(),
  };
  db.prepare(
    `INSERT INTO server_metric_samples
      (id, server_id, cpu_percent, memory_mb, disk_free_mb, uptime_seconds,
       restart_count, player_count, unavailable_reason, sampled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sample.id,
    sample.serverId,
    sample.cpuPercent,
    sample.memoryMb,
    sample.diskFreeMb,
    sample.uptimeSeconds,
    sample.restartCount,
    sample.playerCount,
    JSON.stringify({ reasons: unavailableReasons, tps: sample.tps }),
    sample.sampledAt,
  );
  return sample;
}

function getPerformanceHistory(db, serverId) {
  const id = requireServerId(serverId);
  return {
    serverId: id,
    samples: db
      .prepare(
        "SELECT * FROM server_metric_samples WHERE server_id = ? ORDER BY sampled_at DESC LIMIT 120",
      )
      .all(serverId)
      .map((row) => {
        const availability = parseMetricAvailability(row.unavailable_reason);
        return {
          id: row.id,
          serverId: row.server_id,
          cpuPercent: row.cpu_percent,
          memoryMb: row.memory_mb,
          diskFreeMb: row.disk_free_mb,
          uptimeSeconds: row.uptime_seconds,
          restartCount: row.restart_count,
          playerCount: row.player_count,
          tps: availability.tps,
          unavailableReasons: availability.reasons,
          unavailableReason: availability.reasons.general || null,
          sampledAt: row.sampled_at,
        };
      }),
    events: db
      .prepare(
        `SELECT level, message, created_at
         FROM process_events
         WHERE server_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
      )
      .all(id)
      .map((row) => ({
        level: row.level,
        message: row.message,
        createdAt: row.created_at,
      })),
  };
}

function runServerDiagnostics(db, serverId) {
  const profile = getServerProfile(db, requireServerId(serverId));
  const results = [
    {
      name: "Server folder",
      status: fs.existsSync(profile.rootDir) ? "pass" : "fail",
      message: profile.rootDir,
    },
    {
      name: "server.jar",
      status: fs.existsSync(path.join(profile.rootDir, "server.jar"))
        ? "pass"
        : "warn",
      message: "server.jar check completed",
    },
  ];
  const status = results.some((item) => item.status === "fail")
    ? "fail"
    : results.some((item) => item.status === "warn")
      ? "warn"
      : "pass";
  const id = randomUUID();
  db.prepare(
    "INSERT INTO diagnostic_runs (id, server_id, status, results_json, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, profile.id, status, JSON.stringify(results), nowIso());
  return listDiagnosticRuns(db, profile.id).find((run) => run.id === id);
}

function listDiagnosticRuns(db, serverId) {
  return db
    .prepare(
      "SELECT * FROM diagnostic_runs WHERE server_id = ? ORDER BY created_at DESC",
    )
    .all(requireServerId(serverId))
    .map((row) => ({
      id: row.id,
      serverId: row.server_id,
      status: row.status,
      results: JSON.parse(row.results_json || "[]"),
      createdAt: row.created_at,
    }));
}

function exportServerProfile(db, input) {
  const profile = getServerProfile(db, input?.serverId);
  return { version: 1, server: profile };
}

function previewProfileImport(input) {
  const document = JSON.parse(
    trimRequired(input?.documentJson, "profile JSON is required"),
  );
  return { document, warnings: [] };
}

function importProfile(db, input) {
  const document = JSON.parse(
    trimRequired(input?.documentJson, "profile JSON is required"),
  );
  const server = document.server || document;
  return createServerProfile(db, {
    source: { kind: "blank" },
    name: input?.name || server.name,
    rootDir: input?.targetRootDir,
    loaderType: server.loaderType || "paper",
    minecraftVersion: server.minecraftVersion ?? null,
    loaderVersion: server.loaderVersion ?? null,
    javaPath: input?.javaPath ?? server.javaPath ?? null,
    serverPort: server.serverPort ?? 25565,
    minMemoryMb: server.minMemoryMb ?? 1024,
    maxMemoryMb: server.maxMemoryMb ?? 4096,
    restartPolicy: server.restartPolicy ?? defaultRestartPolicy(),
  });
}

async function planServerProvisioning(input) {
  const source = input?.source || input;
  let sourcePlan;
  if (source?.kind === "localModpackFile") {
    sourcePlan = await planLocalPack(source.path);
  } else if (source?.kind === "marketplaceModpack") {
    sourcePlan = await planMarketplacePack(source);
  } else if (source?.kind === "blank") {
    sourcePlan = {
      source,
      pack: { format: "blank", name: input?.name || "Minecraft Server", versionId: null },
      minecraftVersion: input?.minecraftVersion || null,
      loaderType: input?.loaderType || null,
      loaderVersion: input?.loaderVersion || null,
      requiredJavaMajor: requiredJavaMajorForMinecraft(input?.minecraftVersion),
      artifacts: [],
      optionalFiles: [],
      archiveLayers: [],
      properties: {},
      warnings: [],
      integrity: { status: "trusted" },
      estimatedBytes: 0,
    };
  } else if (source?.kind === "existingFolder") {
    const rootDir = trimRequired(input?.rootDir, "existing server folder is required");
    const detected = detectServerVersion(rootDir);
    const hasLegacyJar = fs.existsSync(path.join(rootDir, "server.jar"));
    sourcePlan = {
      source: { ...source, rootDir },
      pack: { format: "existing", name: path.basename(rootDir), versionId: null },
      minecraftVersion: input?.minecraftVersion || detected.minecraftVersion,
      loaderType: input?.loaderType || detected.loaderType || "vanilla",
      loaderVersion: input?.loaderVersion || null,
      requiredJavaMajor: requiredJavaMajorForMinecraft(
        input?.minecraftVersion || detected.minecraftVersion,
      ),
      artifacts: [],
      optionalFiles: [],
      archiveLayers: [],
      properties: {},
      warnings: hasLegacyJar
        ? []
        : [
            {
              code: "EXISTING_RUNTIME_UNVERIFIED",
              message: "The existing folder has no legacy server.jar; verify its runtime files before continuing.",
              requiresAcknowledgement: true,
            },
          ],
      integrity: { status: "unverified" },
      estimatedBytes: 0,
      launchSpec: hasLegacyJar
        ? {
            executable: { kind: "java" },
            jvmArgs: ["-jar", "server.jar"],
            serverArgs: ["nogui"],
            workingDirectory: ".",
          }
        : null,
      useExistingTarget: true,
    };
  } else {
    throw new Error(`unsupported provisioning source: ${source?.kind || "unknown"}`);
  }

  if (input?.prepareInstall !== true) return sourcePlan;
  const loaderType = input?.loaderType || sourcePlan.loaderType;
  const minecraftVersion = input?.minecraftVersion || sourcePlan.minecraftVersion;
  if (!loaderType || !minecraftVersion) {
    return sourcePlan;
  }
  const adapter = loaderRegistry().get(loaderType);
  let loaderVersion = input?.loaderVersion || sourcePlan.loaderVersion;
  if (!loaderVersion) {
    loaderVersion = (await adapter.listLoaderVersions(minecraftVersion))[0]?.value || null;
  }
  if (!loaderVersion) {
    throw new Error(`No ${loaderType} server loader is available for Minecraft ${minecraftVersion}.`);
  }
  const loaderInstallPlan = await adapter.buildInstallPlan({
    minecraftVersion,
    loaderVersion,
    workingDirectory: ".",
  });
  return {
    ...sourcePlan,
    loaderType,
    minecraftVersion,
    loaderVersion,
    requiredJavaMajor: requiredJavaMajorForMinecraft(minecraftVersion),
    loaderInstallPlan,
    launchSpec: loaderInstallPlan.launchSpec,
  };
}

function mapProvisioningJobRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    serverId: row.server_id || null,
    stage: row.stage,
    plan: JSON.parse(row.plan_json || "{}"),
    progress: JSON.parse(row.progress_json || "{}"),
    stagingDir: row.staging_dir || null,
    targetDir: row.target_dir,
    error: row.error_json ? JSON.parse(row.error_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function provisioningJobStore(db) {
  const select = `SELECT id, server_id, stage, plan_json, progress_json,
                          staging_dir, target_dir, error_json, created_at, updated_at
                   FROM provisioning_jobs`;
  return {
    insert(job) {
      db.prepare(
        `INSERT INTO provisioning_jobs
          (id, server_id, stage, plan_json, progress_json, staging_dir,
           target_dir, error_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        job.id,
        job.serverId,
        job.stage,
        JSON.stringify(job.plan),
        JSON.stringify(job.progress),
        job.stagingDir,
        job.targetDir,
        job.error ? JSON.stringify(job.error) : null,
        job.createdAt,
        job.updatedAt,
      );
      return this.get(job.id);
    },
    get(id) {
      return mapProvisioningJobRow(
        db.prepare(`${select} WHERE id = ?`).get(String(id || "")),
      );
    },
    update(id, patch) {
      const current = this.get(id);
      if (!current) return null;
      const job = { ...current, ...patch };
      db.prepare(
        `UPDATE provisioning_jobs SET
          server_id = ?, stage = ?, plan_json = ?, progress_json = ?,
          staging_dir = ?, target_dir = ?, error_json = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        job.serverId,
        job.stage,
        JSON.stringify(job.plan),
        JSON.stringify(job.progress),
        job.stagingDir,
        job.targetDir,
        job.error ? JSON.stringify(job.error) : null,
        job.updatedAt,
        job.id,
      );
      return this.get(job.id);
    },
    list() {
      return db
        .prepare(`${select} ORDER BY created_at DESC`)
        .all()
        .map(mapProvisioningJobRow);
    },
  };
}

function createProvisionedProfile(db, jobId, plan, targetDir) {
  const profile = plan?.profile;
  if (!profile) return null;

  const existingJob = db
    .prepare("SELECT server_id FROM provisioning_jobs WHERE id = ?")
    .get(jobId);
  if (existingJob?.server_id) {
    getServerProfile(db, existingJob.server_id);
    return existingJob.server_id;
  }

  const name = trimRequired(profile.name, "server name is required");
  const configuration = plan.configuration || {};
  validateRuntimeSettings(
    configuration.serverPort,
    configuration.minMemoryMb,
    configuration.maxMemoryMb,
  );
  validateRestartPolicy(profile.restartPolicy);
  const restartPolicy = profile.restartPolicy || defaultRestartPolicy();
  const source = plan.source || { kind: "blank" };
  const isLocalPack = ["localModpack", "localModpackFile"].includes(source.kind);
  const provider =
    source.provider?.trim().toLowerCase() ||
    (isLocalPack ? "local" : source.kind || "blank");
  const id = randomUUID();
  const createdAt = nowIso();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO servers (
        id, name, root_dir, minecraft_version, loader_type, loader_version,
        java_path, server_port, min_memory_mb, max_memory_mb, auto_start,
        launch_spec_json, compatibility_warning_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      targetDir,
      profile.minecraftVersion ?? null,
      dbLoader(profile.loaderType),
      profile.loaderVersion ?? null,
      plan.javaRuntime.path,
      configuration.serverPort,
      configuration.minMemoryMb,
      configuration.maxMemoryMb,
      profile.autoStart ? 1 : 0,
      JSON.stringify(plan.launchSpec),
      JSON.stringify(plan.compatibilityWarnings || []),
      createdAt,
      createdAt,
    );
    db.prepare(
      `INSERT INTO server_restart_policies
        (server_id, enabled, max_attempts, cooldown_seconds)
       VALUES (?, ?, ?, ?)`,
    ).run(
      id,
      restartPolicy.enabled ? 1 : 0,
      restartPolicy.maxAttempts,
      restartPolicy.cooldownSeconds,
    );
    db.prepare(
      `INSERT INTO server_sources
        (server_id, provider, project_id, version_id, source_path, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      provider,
      source.projectId ?? null,
      source.versionId ?? null,
      source.path ?? source.sourcePath ?? null,
      JSON.stringify({ kind: source.kind, ...(source.metadata || {}) }),
    );
    db.prepare(
      `INSERT INTO server_eula_acceptances (server_id, terms_url, accepted_at)
       VALUES (?, ?, ?)`,
    ).run(id, plan.eula.termsUrl, plan.eula.acceptedAt);
    db.prepare("UPDATE provisioning_jobs SET server_id = ? WHERE id = ?").run(
      id,
      jobId,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return id;
}

function provisioningTargetPath(rootDir, relativePath) {
  const relative = String(relativePath || "").replace(/\\/g, "/");
  if (!relative || path.posix.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) {
    throw new Error("provisioning artifact path must be target-relative");
  }
  const target = path.resolve(rootDir, ...relative.split("/"));
  const fromRoot = path.relative(rootDir, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new Error("provisioning artifact path escapes the staging directory");
  }
  return target;
}

function verifyProvisioningHashes(filePath, hashes = {}) {
  for (const [algorithm, expected] of Object.entries(hashes)) {
    const normalized = String(algorithm).toLowerCase().replace("-", "");
    if (!["md5", "sha1", "sha256", "sha512"].includes(normalized)) continue;
    const actual = createHash(normalized).update(fs.readFileSync(filePath)).digest("hex");
    if (actual.toLowerCase() !== String(expected).toLowerCase()) {
      throw Object.assign(new Error(`${algorithm} checksum mismatch`), {
        code: "ARTIFACT_CHECKSUM_MISMATCH",
      });
    }
  }
}

const PROVISIONING_PROVIDER_HOSTS = Object.freeze({
  modrinth: new Set(["cdn.modrinth.com"]),
  curseforge: new Set([
    "edge.forgecdn.net",
    "media.forgecdn.net",
    "mediafilez.forgecdn.net",
  ]),
});

function blockedProvisioningUrl(message) {
  return Object.assign(new Error(message), { code: "PROVISIONING_URL_BLOCKED" });
}

function isPrivateProvisioningIp(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(host);
  if (family === 6) {
    return host === "::" || host === "::1" || /^(?:fc|fd|fe8|fe9|fea|feb)/.test(host);
  }
  if (family !== 4) return false;
  const [first, second] = host.split(".").map(Number);
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function validateProvisioningUrl(value, provider) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw blockedProvisioningUrl("Provisioning download URL is invalid.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isPrivateProvisioningIp(hostname)
  ) {
    throw blockedProvisioningUrl("Provisioning downloads require a public HTTPS URL.");
  }
  const normalizedProvider = String(provider || "").toLowerCase();
  const allowedHosts = PROVISIONING_PROVIDER_HOSTS[normalizedProvider];
  if (normalizedProvider && (!allowedHosts || !allowedHosts.has(hostname))) {
    throw blockedProvisioningUrl(
      `Provisioning download host is not approved for ${normalizedProvider}.`,
    );
  }
  return parsed.toString();
}

async function downloadProvisioningArtifact(artifact, stagingDir, fallbackName) {
  let url = artifact.url || artifact.urls?.[0] || null;
  let filename = artifact.filename || artifact.path || fallbackName;
  if (!url && artifact.provider === "curseforge") {
    const file = await getCurseForgeFile(artifact.projectId, artifact.fileId);
    url = await curseForgeDownloadUrl(artifact.projectId, artifact.fileId);
    filename = artifact.path || path.join("mods", file.files[0]?.filename || fallbackName);
  }
  if (!url) throw new Error(`No download URL is available for ${fallbackName}.`);
  url = validateProvisioningUrl(url, artifact.provider);
  const target = provisioningTargetPath(stagingDir, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await downloadRemoteFile(
    url,
    target,
    {},
    (finalUrl) => validateProvisioningUrl(finalUrl, artifact.provider),
  );
  verifyProvisioningHashes(target, artifact.hashes || {});
  return target;
}

function removeProvisioningScripts(rootDir) {
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && /\.(?:bat|cmd|ps1|sh)$/i.test(entry.name)) {
        fs.rmSync(target, { force: true });
      }
    }
  }
}

function provisioningLoaderRegistry(db) {
  return createLoaderRegistry({
    fetchJson: (url) => fetchJson(url, {}, "Loader metadata lookup failed"),
    fetchText: (url) => fetchText(url, {}, "Loader metadata lookup failed"),
    fileExists: fs.existsSync,
    download: async (url, target, hashes) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const expectedHost = new URL(url).hostname.toLowerCase();
      await downloadRemoteFile(url, target, {}, (finalUrl) => {
        const validated = validateProvisioningUrl(finalUrl, null);
        if (new URL(validated).hostname.toLowerCase() !== expectedHost) {
          throw blockedProvisioningUrl("Loader download redirected to an unapproved host.");
        }
      });
      verifyProvisioningHashes(target, hashes);
    },
    runProcess: (executable, args, options) =>
      new Promise((resolve, reject) => {
        const child = processSpawnerFor(db)(executable, args, {
          ...options,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        child.once("error", reject);
        child.once("exit", (code) => resolve({ code }));
      }),
  });
}

function trustedLoaderVersion(value, label) {
  const normalized = String(value || "");
  if (
    !normalized ||
    normalized.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(normalized)
  ) {
    throw Object.assign(new Error(`${label} is invalid for loader installation.`), {
      code: "LOADER_VERSION_INVALID",
    });
  }
  return normalized;
}

async function downloadProvisioningFiles(job) {
  const plan = job.plan;
  let sourcePlan = plan.resolvedSourcePlan || plan;
  let resolvedPackPath = plan.resolvedPackPath || null;
  if (
    plan.source?.kind === "marketplaceModpack" &&
    !resolvedPackPath &&
    plan.artifacts?.length > 0
  ) {
    const packArtifact = plan.artifacts?.[0];
    resolvedPackPath = await downloadProvisioningArtifact(
      { ...packArtifact, filename: path.join(".mcsm-source", packArtifact.filename) },
      job.stagingDir,
      "server-pack.zip",
    );
    sourcePlan = await planLocalPack(resolvedPackPath);
  }
  for (const [index, artifact] of (sourcePlan.artifacts || []).entries()) {
    await downloadProvisioningArtifact(
      artifact,
      job.stagingDir,
      path.join("mods", `artifact-${index + 1}.jar`),
    );
  }
  return {
    plan: {
      ...plan,
      resolvedPackPath,
      resolvedSourcePlan: sourcePlan,
    },
  };
}

async function extractProvisioningSource(job) {
  if (job.plan.useExistingTarget) {
    fs.cpSync(job.targetDir, job.stagingDir, { recursive: true });
    return;
  }
  const packPath = job.plan.resolvedPackPath || job.plan.source?.path;
  if (!packPath) return;
  const sourcePlan = job.plan.resolvedSourcePlan || job.plan;
  if ((sourcePlan.archiveLayers || []).length > 0) {
    await extractZipLayers(packPath, job.stagingDir, sourcePlan.archiveLayers);
  } else if (sourcePlan.pack?.format === "generic") {
    await extractZipArchive(packPath, job.stagingDir);
  }
  removeProvisioningScripts(job.stagingDir);
}

function provisioningExecutorFor(db) {
  return createJobExecutor({
    store: provisioningJobStore(db),
    idGenerator: randomUUID,
    clock: nowIso,
    handlers: {
      downloading: ({ job }) => downloadProvisioningFiles(job),
      extracting: ({ job }) => extractProvisioningSource(job),
      installingRuntime: ({ plan }) => {
        validateJavaExecutable(plan.javaRuntime?.path);
      },
      installingLoader: async ({ job, plan }) => {
        if (!plan.loaderInstallPlan) return;
        const registry = provisioningLoaderRegistry(db);
        const adapter = registry.get(plan.loaderType);
        const minecraftVersion = trustedLoaderVersion(
          plan.minecraftVersion,
          "Minecraft version",
        );
        const loaderVersion = trustedLoaderVersion(
          plan.loaderVersion,
          "Loader version",
        );
        const installPlan = await adapter.buildInstallPlan({
          minecraftVersion,
          loaderVersion,
          workingDirectory: job.stagingDir,
        });
        await adapter.install(installPlan, { javaPath: plan.javaRuntime.path });
        const validation = await adapter.validate(installPlan);
        if (!validation.valid) {
          throw Object.assign(
            new Error(`Loader installation is incomplete: ${validation.missing.join(", ")}`),
            { code: "LOADER_INSTALL_INCOMPLETE" },
          );
        }
        const launchSpec = {
          ...installPlan.launchSpec,
          workingDirectory: ".",
          validated: true,
        };
        return {
          plan: {
            ...plan,
            loaderInstallPlan: { ...installPlan, workingDirectory: ".", launchSpec },
            launchSpec,
          },
        };
      },
      committing: ({ job, plan }) => {
        const serverId = createProvisionedProfile(db, job.id, plan, job.targetDir);
        return serverId ? { serverId } : null;
      },
      starting: ({ job, plan }) => {
        if (plan.profile?.autoStart && job.serverId) startServer(db, job.serverId);
      },
    },
  });
}

async function previewModpackImport(input) {
  const packPath = trimRequired(input?.path, "modpack path is required");
  const plan = await planLocalPack(packPath);
  const warningMessages = plan.warnings.map((warning) => warning.message);
  return {
    manifest: {
      format: plan.pack.format,
      name: plan.pack.name,
      minecraftVersion: plan.minecraftVersion,
      loader: plan.loaderType,
      warnings: warningMessages,
    },
    plan,
    createNewProfile: true,
    rollbackRequired: Boolean(
      input?.targetRoot && fs.existsSync(input.targetRoot),
    ),
    warnings: warningMessages,
  };
}

async function importModpack(db, input) {
  const preview = await previewModpackImport(input);
  const profile = createServerProfile(db, {
    source: { kind: "blank" },
    name: input?.name || preview.manifest.name,
    rootDir: input?.targetRoot,
    loaderType: preview.plan.loaderType || "paper",
    minecraftVersion: preview.manifest.minecraftVersion,
    loaderVersion: preview.plan.loaderVersion,
    javaPath: input?.javaPath ?? null,
    serverPort: 25565,
    minMemoryMb: 1024,
    maxMemoryMb: 4096,
  });
  return {
    profile: { id: profile.id, name: profile.name },
    rollbackPath: null,
    warnings: preview.warnings,
  };
}

function loaderRegistry() {
  return createLoaderRegistry({
    fetchJson: (url) => fetchJson(url, {}, "Loader metadata lookup failed"),
    fetchText: (url) => fetchText(url, {}, "Loader metadata lookup failed"),
  });
}

async function listLoaderMinecraftVersions(input) {
  const loaderType = input?.loaderType || "paper";
  return loaderRegistry().get(loaderType).listMinecraftVersions();
}

async function listLoaderVersions(input) {
  const loaderType = input?.loaderType || "paper";
  const minecraftVersion = trimRequired(
    input?.minecraftVersion,
    "Minecraft version is required",
  );
  return loaderRegistry().get(loaderType).listLoaderVersions(minecraftVersion);
}

const marketplaceLoaderFacets = {
  fabric: "fabric",
  forge: "forge",
  neoForge: "neoforge",
  paper: "paper",
  quilt: "quilt",
};

const curseForgeLoaderTypes = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoForge: 6,
};

function marketplaceSortIndex(sort) {
  if (sort === "downloads" || sort === "updated") {
    return sort;
  }
  return "relevance";
}

function marketplaceFacets(projectType, loader) {
  const allowedProjectTypes = new Set([
    "mod",
    "modpack",
    "plugin",
    "resourcepack",
    "shader",
    "datapack",
  ]);
  const facets = [];
  if (allowedProjectTypes.has(projectType)) {
    facets.push([`project_type:${projectType}`]);
  }
  const loaderFacet = marketplaceLoaderFacets[loader];
  if (loaderFacet) {
    facets.push([`categories:${loaderFacet}`]);
  }
  return facets.length
    ? `&facets=${encodeURIComponent(JSON.stringify(facets))}`
    : "";
}

function normalizeMarketplaceGallery(gallery) {
  return (Array.isArray(gallery) ? gallery : [])
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      return (
        entry?.raw_url ||
        entry?.url ||
        entry?.thumbnailUrl ||
        entry?.image_url ||
        null
      );
    })
    .filter(Boolean);
}

function minecraftVersionLabels(values) {
  const labels = Array.isArray(values) ? values : [];
  return Array.from(
    new Set(
      labels
        .map((value) => String(value || "").trim())
        .filter((value) =>
          /^\d+(?:\.\d+){1,2}(?:[-+][0-9A-Za-z.-]+)?$/.test(value),
        ),
    ),
  );
}

function providerProjectUrl(provider, project) {
  const slug = project?.slug || project?.id || project?.project_id;
  if (!slug) return null;
  const encodedSlug = encodeURIComponent(String(slug));
  if (provider === "Modrinth") {
    const type = project?.project_type || project?.projectType || "mod";
    return `https://modrinth.com/${encodeURIComponent(type)}/${encodedSlug}`;
  }
  if (provider === "CurseForge") {
    const section =
      project?.projectType === "modpack" || project?.classId === 4471
        ? "modpacks"
        : "mc-mods";
    return `https://www.curseforge.com/minecraft/${section}/${encodedSlug}`;
  }
  if (provider === "BBSMC") {
    const type = project?.project_type || project?.projectType || "modpack";
    const section = type === "mod" ? "mod" : "modpack";
    return `https://bbsmc.net/${section}/${encodedSlug}`;
  }
  return null;
}

async function searchModrinthProjects(input) {
  const query = encodeURIComponent(input?.query || "");
  if (!query) return [];
  const facets = marketplaceFacets(input?.projectType, input?.loader);
  const index = encodeURIComponent(marketplaceSortIndex(input?.sort));
  const data = await fetchJson(
    `https://api.modrinth.com/v2/search?query=${query}&limit=20&index=${index}${facets}`,
    {},
    "Modrinth search failed",
  );
  return (data.hits || []).map((item) => ({
    id: item.project_id,
    slug: item.slug,
    title: item.title,
    description: item.description,
    projectType: item.project_type,
    loaders: item.categories || [],
    gameVersions: minecraftVersionLabels(item.versions),
    iconUrl: item.icon_url || null,
    gallery: normalizeMarketplaceGallery(item.gallery),
    downloads: item.downloads || 0,
    follows: item.follows || 0,
    updatedAt: item.date_modified || null,
    websiteUrl: providerProjectUrl("Modrinth", item),
  }));
}

async function getModrinthProject(input) {
  const projectId = trimRequired(input?.projectId, "project id is required");
  const item = await fetchJson(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`,
    {},
    "Modrinth project lookup failed",
  );
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    description: item.description,
    projectType: item.project_type,
    loaders: item.loaders || [],
    gameVersions: minecraftVersionLabels(item.game_versions),
    iconUrl: item.icon_url || null,
    gallery: normalizeMarketplaceGallery(item.gallery),
    downloads: item.downloads || 0,
    follows: item.followers || 0,
    updatedAt: item.updated || null,
    body: item.body || null,
    websiteUrl: providerProjectUrl("Modrinth", item),
  };
}

function mapModrinthVersion(item) {
  return {
    id: item.id,
    projectId: item.project_id,
    name: item.name,
    versionNumber: item.version_number,
    releaseType: item.version_type || null,
    loaders: item.loaders || [],
    gameVersions: minecraftVersionLabels(item.game_versions),
    files: (item.files || []).map((file) => ({
      filename: file.filename,
      size: file.size,
      primary: Boolean(file.primary),
      url: file.url,
      hashes: file.hashes || {},
      isServerPack: /\.mrpack$/i.test(file.filename || ""),
    })),
    dependencies: item.dependencies || [],
    warnings: [],
    isServerPack: (item.files || []).some((file) =>
      /\.mrpack$/i.test(file.filename || ""),
    ),
    serverCompatibility: (item.files || []).some((file) =>
      /\.mrpack$/i.test(file.filename || ""),
    )
      ? "serverPack"
      : "unverified",
  };
}

async function listModrinthVersions(input) {
  const projectId = trimRequired(input?.projectId, "project id is required");
  const items = await fetchJson(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`,
    {},
    "Modrinth version lookup failed",
  );
  return items.map(mapModrinthVersion);
}

async function getModrinthVersion(versionId) {
  const item = await fetchJson(
    `https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`,
    {},
    "Modrinth version lookup failed",
  );
  return mapModrinthVersion(item);
}

function selectInstallableModrinthFile(version) {
  const files = version.files || [];
  return (
    files.find((file) => file.primary && /\.jar$/i.test(file.filename)) ||
    files.find((file) => /\.jar$/i.test(file.filename)) ||
    files.find((file) => file.primary) ||
    files[0] ||
    null
  );
}

function modrinthContentKey(version) {
  return `modrinth:${version.projectId}:${version.id}`;
}

async function installModrinthResolvedVersion(db, input, version, visited) {
  const key = modrinthContentKey(version);
  if (visited.has(key)) {
    return null;
  }
  visited.add(key);

  const dependencies = [];
  for (const dependency of version.dependencies || []) {
    if (dependency.dependency_type !== "required") {
      continue;
    }
    let dependencyVersion = null;
    if (dependency.version_id) {
      dependencyVersion = await getModrinthVersion(dependency.version_id);
    } else if (dependency.project_id) {
      const dependencyVersions = await listModrinthVersions({
        serverId: input.serverId,
        projectId: dependency.project_id,
      });
      dependencyVersion = dependencyVersions[0] ?? null;
    }
    if (dependencyVersion) {
      const installed = await installModrinthResolvedVersion(
        db,
        input,
        dependencyVersion,
        visited,
      );
      if (installed) {
        dependencies.push(installed);
      }
    }
  }

  const file = selectInstallableModrinthFile(version);
  if (!file?.url) {
    throw new Error(`Modrinth version ${version.id} has no downloadable file`);
  }
  const content = await installRemoteContent(db, {
    serverId: input.serverId,
    contentId: key,
    name: version.name,
    version: version.versionNumber,
    downloadUrl: file.url,
    fileName: file.filename,
    environment: "server",
  });
  return { content, dependencies };
}

async function installModrinthVersion(db, input) {
  const versions = await listModrinthVersions(input);
  const version = versions.find((item) => item.id === input?.versionId);
  if (!version) throw new Error("Modrinth version not found");
  return installModrinthResolvedVersion(db, input, version, new Set());
}

async function searchHangarProjects(query) {
  if (!query) return [];
  const data = await fetchJson(
    `https://hangar.papermc.io/api/v1/projects?query=${encodeURIComponent(query)}&limit=20`,
    {},
    "Hangar search failed",
  );
  return (data.result || []).map((item) => ({
    id:
      item.id?.toString() ||
      `${item.namespace?.owner || item.owner || item.name}/${item.namespace?.slug || item.slug || item.name}`,
    name: item.name,
    namespace: item.namespace?.owner || "",
    description: item.description || "",
    platform: "paper",
  }));
}

function encodeHangarProjectId(projectId) {
  return String(projectId || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function listHangarVersions(input) {
  const projectId = trimRequired(
    input?.projectId,
    "Hangar project id is required",
  );
  const data = await fetchJson(
    `https://hangar.papermc.io/api/v1/projects/${encodeHangarProjectId(projectId)}/versions`,
    {},
    "Hangar version lookup failed",
  );
  const versions = Array.isArray(data) ? data : data.result || [];
  return versions.map((item) => ({
    name: item.name || item.versionString || item.version || item.id,
    description: item.description || "",
    createdAt: item.createdAt || item.created_at || null,
  }));
}

async function installHangarVersion(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  if (profile.loaderType !== "paper") {
    throw new Error("Hangar plugins can only be installed into Paper servers.");
  }
  const projectId = trimRequired(
    input?.projectId,
    "Hangar project id is required",
  );
  const versionName = trimRequired(
    input?.versionName,
    "Hangar version is required",
  );
  const projectName = projectId.split("/").filter(Boolean).pop() || projectId;
  return installRemoteContent(db, {
    serverId: profile.id,
    contentId: `hangar:${projectId}:${versionName}`,
    name: input?.name || projectName,
    version: versionName,
    downloadUrl: `https://hangar.papermc.io/api/v1/projects/${encodeHangarProjectId(projectId)}/versions/${encodeURIComponent(versionName)}/PAPER/download`,
    fileName: input?.fileName || `${projectName}-${versionName}.jar`,
    environment: "server",
  });
}

function curseForgeApiKey() {
  const key = process.env.CURSEFORGE_API_KEY;
  if (!key) {
    throw new Error(
      "CURSEFORGE_API_KEY is required for official CurseForge API downloads.",
    );
  }
  return key;
}

function curseForgeHeaders() {
  return {
    Accept: "application/json",
    "x-api-key": curseForgeApiKey(),
  };
}

function mapCurseForgeProject(item) {
  const project = {
    id: String(item.id),
    slug: item.slug || String(item.id),
    title: item.name,
    description: item.summary || "",
    projectType: item.classId === 4471 ? "modpack" : "mod",
    loaders: [],
    gameVersions: minecraftVersionLabels(
      item.latestFilesIndexes?.flatMap?.((file) => file.gameVersion) ||
        item.gameVersions,
    ),
    iconUrl: item.logo?.thumbnailUrl || item.logo?.url || null,
    gallery: normalizeMarketplaceGallery(item.screenshots),
    downloads: item.downloadCount || 0,
    follows: item.thumbsUpCount || 0,
    updatedAt: item.dateModified || null,
  };
  return { ...project, websiteUrl: providerProjectUrl("CurseForge", project) };
}

async function searchCurseForgeProjects(input) {
  const query = encodeURIComponent(input?.query || "");
  if (!query) return [];
  const classIds = {
    mod: 6,
    modpack: 4471,
  };
  const classId = classIds[input?.projectType]
    ? `&classId=${classIds[input.projectType]}`
    : "";
  const sortFields = {
    downloads: 6,
    updated: 3,
  };
  const sortField = sortFields[input?.sort]
    ? `&sortField=${sortFields[input.sort]}&sortOrder=desc`
    : "";
  const modLoaderType = curseForgeLoaderTypes[input?.loader]
    ? `&modLoaderType=${curseForgeLoaderTypes[input.loader]}`
    : "";
  const data = await fetchJson(
    `https://api.curseforge.com/v1/mods/search?gameId=432&searchFilter=${query}&pageSize=20${classId}${sortField}${modLoaderType}`,
    { headers: curseForgeHeaders() },
    "CurseForge search failed",
  );
  return (data.data || []).map(mapCurseForgeProject);
}

async function getCurseForgeProject(input) {
  const projectId = trimRequired(
    input?.projectId,
    "CurseForge project id is required",
  );
  const data = await fetchJson(
    `https://api.curseforge.com/v1/mods/${encodeURIComponent(projectId)}`,
    { headers: curseForgeHeaders() },
    "CurseForge project lookup failed",
  );
  const project = mapCurseForgeProject(data.data || {});
  return {
    ...project,
    body: data.data?.summary || null,
  };
}

function mapCurseForgeFile(item) {
  const releaseTypes = { 1: "release", 2: "beta", 3: "alpha" };
  const loaderNames = new Map([
    ["forge", "forge"],
    ["fabric", "fabric"],
    ["quilt", "quilt"],
    ["neoforge", "neoForge"],
    ["neo-forge", "neoForge"],
  ]);
  const loaders = Array.from(
    new Set(
      (item.gameVersions || [])
        .map((value) => loaderNames.get(String(value).toLowerCase()))
        .filter(Boolean),
    ),
  );
  const hashes = Object.fromEntries(
    (item.hashes || []).flatMap((hash) => {
      const key = hash?.algo === 1 ? "sha1" : hash?.algo === 2 ? "md5" : null;
      return key && hash?.value ? [[key, String(hash.value)]] : [];
    }),
  );
  return {
    id: String(item.id),
    projectId: String(item.modId),
    name: item.displayName || item.fileName,
    versionNumber: item.fileName || String(item.id),
    loaders,
    gameVersions: minecraftVersionLabels(item.gameVersions),
    releaseType: releaseTypes[item.releaseType] || String(item.releaseType || "unknown"),
    isServerPack: Boolean(item.isServerPack),
    serverPackFileId: item.serverPackFileId
      ? String(item.serverPackFileId)
      : null,
    serverCompatibility: item.isServerPack ? "serverPack" : "unverified",
    files: [
      {
        filename: item.fileName,
        size: item.fileLength || 0,
        primary: true,
        hashes,
      },
    ],
    dependencies: item.dependencies || [],
    warnings: [],
  };
}

function normalizeMarketplaceLoaderType(loaders) {
  for (const value of loaders || []) {
    const loader = String(value).toLowerCase();
    if (loader === "neoforge" || loader === "neo-forge") return "neoForge";
    if (["vanilla", "paper", "forge", "fabric", "quilt"].includes(loader)) {
      return loader;
    }
  }
  return null;
}

function unverifiedMarketplaceWarning(message) {
  return {
    code: "PACK_UNVERIFIED",
    message,
    requiresAcknowledgement: true,
  };
}

async function planModrinthMarketplacePack(source) {
  const version = await getModrinthVersion(
    trimRequired(source.versionId, "Modrinth version id is required"),
  );
  const file =
    version.files.find((candidate) => candidate.isServerPack && candidate.primary) ||
    version.files.find((candidate) => candidate.isServerPack) ||
    version.files.find((candidate) => candidate.primary) ||
    version.files[0];
  if (!file?.url) {
    throw new Error(`Modrinth version ${version.id} has no downloadable pack file`);
  }
  const minecraftVersion = version.gameVersions[0] || null;
  const warnings = file.isServerPack
    ? []
    : [
        unverifiedMarketplaceWarning(
          "This Modrinth version does not provide a .mrpack server pack.",
        ),
      ];
  return {
    source,
    pack: {
      format: "modrinth",
      name: version.name,
      versionId: version.id,
      releaseType: version.releaseType,
    },
    minecraftVersion,
    loaderType: normalizeMarketplaceLoaderType(version.loaders),
    loaderVersion: null,
    requiredJavaMajor: requiredJavaMajorForMinecraft(minecraftVersion),
    artifacts: [
      {
        provider: "modrinth",
        projectId: version.projectId,
        versionId: version.id,
        filename: file.filename,
        size: file.size,
        url: file.url,
        hashes: file.hashes || {},
        environment: "server",
      },
    ],
    optionalFiles: [],
    archiveLayers: [],
    properties: {},
    warnings,
    integrity: {
      status:
        file.isServerPack && Object.keys(file.hashes || {}).length > 0
          ? "verified"
          : "unverified",
    },
    estimatedBytes: file.size || 0,
  };
}

async function getCurseForgeFile(modId, fileId) {
  const data = await fetchJson(
    `https://api.curseforge.com/v1/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`,
    { headers: curseForgeHeaders() },
    "CurseForge file lookup failed",
  );
  return mapCurseForgeFile(data.data || {});
}

async function planCurseForgeMarketplacePack(source) {
  const projectId = trimRequired(source.projectId, "CurseForge project id is required");
  const selectedId = trimRequired(source.versionId, "CurseForge file id is required");
  const versions = await listCurseForgeFiles({ projectId });
  const selected = versions.find((version) => version.id === selectedId);
  if (!selected) throw new Error("CurseForge file not found");
  const targetId = selected.serverPackFileId || selected.id;
  const target =
    versions.find((version) => version.id === targetId) ||
    (await getCurseForgeFile(projectId, targetId));
  const url = await curseForgeDownloadUrl(projectId, target.id);
  if (!url) throw new Error("CurseForge did not provide a download URL");
  const file = target.files[0];
  const minecraftVersion = target.gameVersions[0] || null;
  const warnings = target.isServerPack
    ? []
    : [
        unverifiedMarketplaceWarning(
          "CurseForge does not identify this archive as a dedicated server pack.",
        ),
      ];
  return {
    source: { ...source, versionId: target.id },
    pack: {
      format: "curseforge",
      name: target.name,
      versionId: target.id,
      releaseType: target.releaseType,
    },
    minecraftVersion,
    loaderType: normalizeMarketplaceLoaderType(target.loaders),
    loaderVersion: null,
    requiredJavaMajor: requiredJavaMajorForMinecraft(minecraftVersion),
    artifacts: [
      {
        provider: "curseforge",
        projectId,
        fileId: target.id,
        filename: file.filename,
        size: file.size,
        url,
        hashes: file.hashes || {},
        environment: "server",
      },
    ],
    optionalFiles: [],
    archiveLayers: [],
    properties: {},
    warnings,
    integrity: {
      status:
        target.isServerPack && Object.keys(file.hashes || {}).length > 0
          ? "verified"
          : "unverified",
    },
    estimatedBytes: file.size || 0,
  };
}

async function planMarketplacePack(source) {
  const provider = String(source.provider || "").toLowerCase();
  if (provider === "modrinth") return planModrinthMarketplacePack(source);
  if (provider === "curseforge") return planCurseForgeMarketplacePack(source);
  throw new Error(`unsupported marketplace provider: ${source.provider || "unknown"}`);
}

async function listCurseForgeFiles(input) {
  const modId = trimRequired(
    input?.modId || input?.projectId,
    "CurseForge mod id is required",
  );
  const data = await fetchJson(
    `https://api.curseforge.com/v1/mods/${encodeURIComponent(modId)}/files?pageSize=20`,
    { headers: curseForgeHeaders() },
    "CurseForge file lookup failed",
  );
  return (data.data || []).map(mapCurseForgeFile);
}

async function curseForgeDownloadUrl(modId, fileId) {
  const data = await fetchJson(
    `https://api.curseforge.com/v1/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}/download-url`,
    { headers: curseForgeHeaders() },
    "CurseForge download URL lookup failed",
  );
  return typeof data.data === "string" ? data.data : data.data?.downloadUrl;
}

async function installCurseForgeFile(db, input) {
  const modId = trimRequired(
    input?.modId || input?.projectId,
    "CurseForge mod id is required",
  );
  const fileId = trimRequired(
    input?.fileId || input?.versionId,
    "CurseForge file id is required",
  );
  const downloadUrl = await curseForgeDownloadUrl(modId, fileId);
  if (!downloadUrl) {
    throw new Error("CurseForge did not return a download URL for this file.");
  }
  return installRemoteContent(db, {
    serverId: input?.serverId,
    contentId: `curseforge:${modId}:${fileId}`,
    name: input?.name || `CurseForge ${modId}`,
    version: input?.version ?? null,
    downloadUrl,
    fileName: input?.fileName || `${modId}-${fileId}.jar`,
    environment: "server",
    headers: { "x-api-key": curseForgeApiKey() },
  });
}

const BBSMC_API_BASE = "https://api.bbsmc.net/v2";

function bbsmcUrl(pathname) {
  return `${BBSMC_API_BASE}/${pathname.replace(/^\/+/, "")}`;
}

function countBbsmcModListItems(body) {
  if (typeof body !== "string" || !body.trim()) {
    return null;
  }

  const detailsBlocks = body.match(/<details[\s\S]*?<\/details>/gi) || [];
  const modListBlock =
    detailsBlocks.find((block) => /mod\s*list|mod\s*列表|模组/i.test(block)) ||
    body;
  const modLines = modListBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) && /\.jar\b/i.test(line));

  return modLines.length > 0 ? modLines.length : null;
}

function mapBbsmcProject(item) {
  const project = {
    id: item.project_id || item.id,
    slug: item.slug || item.id || item.project_id,
    title: item.title,
    description: item.description || "",
    projectType: item.project_type || "modpack",
    loaders: item.categories || item.loaders || [],
    gameVersions: minecraftVersionLabels(
      item.game_versions || item.mc_versions,
    ),
    iconUrl: item.icon_url || null,
    gallery: normalizeMarketplaceGallery(item.gallery),
    downloads: item.downloads || 0,
    follows: item.follows || 0,
    updatedAt: item.date_modified || item.updated || null,
    body: item.body || null,
    modCount:
      item.mod_count ??
      item.mods_count ??
      item.modCount ??
      countBbsmcModListItems(item.body),
  };
  return { ...project, websiteUrl: providerProjectUrl("BBSMC", project) };
}

async function searchBbsmcProjects(input) {
  const query = encodeURIComponent(input?.query || "");
  if (!query) return [];
  const facets = marketplaceFacets(input?.projectType, input?.loader);
  const index = encodeURIComponent(marketplaceSortIndex(input?.sort));
  const data = await fetchJson(
    bbsmcUrl(`search?limit=20&query=${query}&index=${index}${facets}`),
    {},
    "BBSMC search failed",
  );
  return (data.hits || []).map(mapBbsmcProject);
}

async function getBbsmcProject(input) {
  const projectId = trimRequired(
    input?.projectId,
    "BBSMC project id is required",
  );
  const item = await fetchJson(
    bbsmcUrl(`project/${encodeURIComponent(projectId)}`),
    {},
    "BBSMC project lookup failed",
  );
  return mapBbsmcProject(item);
}

function mapBbsmcVersion(item) {
  return {
    id: item.id,
    projectId: item.project_id,
    name: item.name,
    versionNumber: item.version_number,
    loaders: item.loaders || [],
    gameVersions: minecraftVersionLabels(
      item.game_versions || item.mc_versions,
    ),
    files: (item.files || []).map((file) => ({
      filename: file.filename,
      size: file.size,
      primary: Boolean(file.primary),
      url: file.url,
      hashes: file.hashes || {},
    })),
    dependencies: item.dependencies || [],
    diskUrls: item.disk_urls || [],
    diskOnly: Boolean(item.disk_only),
    warnings: item.disk_urls?.length
      ? ["This BBSMC version also provides external disk download links."]
      : [],
  };
}

async function listBbsmcVersions(input) {
  const projectId = trimRequired(
    input?.projectId,
    "BBSMC project id is required",
  );
  const items = await fetchJson(
    bbsmcUrl(`project/${encodeURIComponent(projectId)}/version`),
    {},
    "BBSMC version lookup failed",
  );
  return items.map(mapBbsmcVersion);
}

async function getBbsmcVersion(versionId) {
  const item = await fetchJson(
    bbsmcUrl(`version/${encodeURIComponent(versionId)}`),
    {},
    "BBSMC version lookup failed",
  );
  return mapBbsmcVersion(item);
}

function selectInstallableBbsmcFile(version) {
  const files = version.files || [];
  return (
    files.find((file) => file.primary && file.url) ||
    files.find((file) => file.url) ||
    null
  );
}

function ensureBbsmcFileIsDirect(file, version) {
  if (file?.url && /^https:\/\/cdn\.bbsmc\.net\//i.test(file.url)) {
    return;
  }
  const diskTargets = (version.diskUrls || [])
    .map((item) => `${item.platform || "external"}: ${item.url}`)
    .join(", ");
  throw new Error(
    diskTargets
      ? `BBSMC version ${version.versionNumber} uses external disk download links and cannot be installed automatically. Open the BBSMC page and import the downloaded file manually. Links: ${diskTargets}`
      : `BBSMC version ${version.versionNumber} does not expose a direct public file download URL.`,
  );
}

async function installBbsmcPublicFile(db, input) {
  const versionId = trimRequired(
    input?.versionId,
    "BBSMC version id is required",
  );
  const version = await getBbsmcVersion(versionId);
  const file = selectInstallableBbsmcFile(version);
  ensureBbsmcFileIsDirect(file, version);
  return installRemoteContent(db, {
    serverId: input?.serverId,
    contentId: `bbsmc:${version.projectId}:${version.id}`,
    name: input?.name || version.name,
    version: version.versionNumber,
    downloadUrl: file.url,
    fileName: input?.fileName || file.filename,
    environment: "server",
    warnings: version.warnings,
  });
}

function importCurseForgeManual(db, input) {
  const content = importLocalContent(db, {
    serverId: input?.serverId,
    sourcePath: input?.filePath,
    name: input?.name,
    version: input?.version,
  });
  return { content, dependencyResolution: "manual" };
}

function checkServerUpdate(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  const targetVersion =
    input?.targetMinecraftVersion ||
    input?.targetVersion ||
    profile.minecraftVersion;
  const current = profile.minecraftVersion || null;
  const updateAvailable = Boolean(
    targetVersion && current && targetVersion !== current,
  );
  const result = {
    serverId: profile.id,
    loaderType: profile.loaderType,
    currentVersion: current,
    targetVersion,
    updateAvailable,
    installSupported:
      profile.loaderType === "paper" || profile.loaderType === "vanilla",
    message: updateAvailable
      ? `stable ${profile.loaderType} update is available for ${targetVersion}`
      : "server is current",
    downloadedJarPath: null,
    downloadedJarSha256: null,
  };
  db.prepare(
    `INSERT INTO server_update_history
      (id, server_id, loader_type, from_version, to_version, status, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    profile.id,
    profile.loaderType,
    current,
    targetVersion,
    updateAvailable ? "available" : "current",
    result.message,
    nowIso(),
  );
  return result;
}

function installServerUpdate(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  if (!input?.confirm) {
    throw new Error("server jar installation requires explicit confirmation");
  }
  const sourceJar = trimRequired(
    input?.serverJarPath,
    "downloaded server jar path is required",
  );
  if (!fs.existsSync(sourceJar)) {
    throw new Error(`downloaded server jar does not exist: ${sourceJar}`);
  }
  const actualSha256 = sha256File(sourceJar);
  const expectedSha256 = String(input?.serverJarSha256 || "").trim();
  if (
    expectedSha256 &&
    actualSha256.toLowerCase() !== expectedSha256.toLowerCase()
  ) {
    throw new Error("downloaded server jar checksum does not match");
  }

  fs.mkdirSync(profile.rootDir, { recursive: true });
  const targetJar = path.join(profile.rootDir, "server.jar");
  const now = nowIso();
  let rollbackPath = null;
  if (fs.existsSync(targetJar)) {
    const rollbackDir = path.join(profile.rootDir, "backups", "server-jars");
    fs.mkdirSync(rollbackDir, { recursive: true });
    rollbackPath = path.join(
      rollbackDir,
      `server-${now.replace(/[:.]/g, "-")}.jar`,
    );
    fs.copyFileSync(targetJar, rollbackPath);
  }
  fs.copyFileSync(sourceJar, targetJar);

  const targetVersion =
    input?.targetMinecraftVersion ||
    input?.targetVersion ||
    profile.minecraftVersion;
  const targetLoaderVersion =
    input?.targetLoaderVersion === undefined
      ? profile.loaderVersion
      : input.targetLoaderVersion;
  updateServerProfile(db, {
    id: profile.id,
    minecraftVersion: targetVersion ?? null,
    loaderVersion: targetLoaderVersion ?? null,
  });

  const id = randomUUID();
  const message = `installed ${profile.loaderType} server jar${targetVersion ? ` for ${targetVersion}` : ""}`;
  db.prepare(
    `INSERT INTO server_update_history
      (id, server_id, loader_type, from_version, to_version, status, message, rollback_path, created_at)
     VALUES (?, ?, ?, ?, ?, 'installed', ?, ?, ?)`,
  ).run(
    id,
    profile.id,
    profile.loaderType,
    profile.minecraftVersion,
    targetVersion ?? null,
    message,
    rollbackPath,
    now,
  );
  return listServerUpdateHistory(db, profile.id).find(
    (entry) => entry.id === id,
  );
}

function listServerUpdateHistory(db, serverId) {
  return db
    .prepare(
      "SELECT * FROM server_update_history WHERE server_id = ? ORDER BY created_at DESC",
    )
    .all(requireServerId(serverId))
    .map((row) => ({
      id: row.id,
      serverId: row.server_id,
      loaderType: row.loader_type,
      fromVersion: row.from_version,
      toVersion: row.to_version,
      status: row.status,
      message: row.message,
      rollbackPath: row.rollback_path,
      createdAt: row.created_at,
    }));
}

function createNotificationEvent(db, input) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO notification_events
      (id, server_id, kind, severity, title, message, desktop_delivered, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(
    id,
    input?.serverId ?? null,
    input?.kind || "info",
    input?.severity || "info",
    input?.title || "MC Server Manager",
    input?.message || "",
    nowIso(),
  );
  return listNotificationEvents(db).find((event) => event.id === id);
}

module.exports = { createBackend };
