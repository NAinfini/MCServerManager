const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { createServer: createNetServer, isIP } = require("node:net");
const { DatabaseSync } = require("node:sqlite");
const { pipeline } = require("node:stream/promises");
const zlib = require("node:zlib");
const { createCommandRegistry } = require("./backend/command-registry.cjs");
const { createBackendContext } = require("./backend/context.cjs");
const serverFiles = require("./backend/server-files.cjs");
const backupFiles = require("./backend/backup-files.cjs");
const contentVersions = require("./backend/content-versions.cjs");
const taskSchedule = require("./backend/task-schedule.cjs");
const { mergeProperties } = require("./provisioning/properties.cjs");
const { planLocalPack } = require("./provisioning/sources.cjs");
const { createLoaderRegistry } = require("./provisioning/loaders.cjs");
const {
  createRuntimeManager,
  maxJavaMajorForMinecraft: runtimeMaxJavaMajor,
  requiredJavaMajorForMinecraft: runtimeRequiredJavaMajor,
  selectJavaRuntime,
} = require("./provisioning/runtimes.cjs");
const { createJobExecutor } = require("./provisioning/jobs.cjs");
const {
  codedError,
  provisioningError,
} = require("./provisioning/contracts.cjs");
const {
  extractZipArchive,
  extractZipLayers,
  inspectZip,
} = require("./provisioning/archive.cjs");
const { readModMetadata } = require("./provisioning/mod-metadata.cjs");

const managedChildren = new Map();
const closedDatabases = new WeakSet();
const databaseContexts = new WeakMap();
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
  manifest_sha256 TEXT,
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
  installed_at TEXT NOT NULL,
  mod_id TEXT,
  metadata_scanned_at TEXT
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

CREATE TABLE IF NOT EXISTS content_update_history (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  installed_content_id TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  backup_path TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
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
  schedule_kind TEXT NOT NULL DEFAULT 'interval',
  time_of_day TEXT,
  weekdays_json TEXT NOT NULL DEFAULT '[]',
  backup_profile_id TEXT REFERENCES backup_profiles(id) ON DELETE RESTRICT,
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
  metadata_json TEXT NOT NULL DEFAULT '{}',
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
-- Both telemetry tables are trimmed by age across every server, which the
-- server-scoped indexes above cannot serve.
CREATE INDEX IF NOT EXISTS idx_server_metric_samples_sampled_at ON server_metric_samples(sampled_at);
CREATE INDEX IF NOT EXISTS idx_process_events_created_at ON process_events(created_at);
`;

function createBackend(app) {
  const appDataDir = app.getPath("userData");
  fs.mkdirSync(appDataDir, { recursive: true });
  const db = new DatabaseSync(
    path.join(appDataDir, "mc-server-manager.sqlite"),
  );
  const context = createBackendContext({
    db,
    appDataDir,
    processSpawner: app.spawn || spawn,
    metricCollector: app.collectProcessMetrics || collectProcessMetrics,
    runtimeDependencies: app.runtimeDependencies || {},
    portChecker: app.checkPortAvailable || checkPortAvailable,
  });
  databaseContexts.set(db, context);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(coreSchema);
  migrateDatabase(db);
  ensureNotificationPreferences(db);
  const commands = createCommandRegistry(createCommandHandlers(context));

  const close = () => {
    closedDatabases.add(db);
    context.runtimeState.startingServers.clear();
    context.runtimeState.metricBaselines.clear();
    for (const [serverId, managed] of managedChildren.entries()) {
      if (managed.db === db) {
        clearRestartState(serverId);
        clearRestartCountdown(serverId);
        clearInterval(managed.metricTimer);
        managed.stopRequested = true;
        managed.child.kill();
        managedChildren.delete(serverId);
      }
    }
    db.prepare(
      `UPDATE managed_processes
         SET status = 'stopped', exited_at = COALESCE(exited_at, ?)
         WHERE status IN ('running', 'external_running')`,
    ).run(nowIso());
    db.close();
  };

  return {
    close,
    shutdown: async (options) => {
      await stopManagedChildrenGracefully(db, options);
      close();
    },
    runningServerCount: () =>
      [...managedChildren.values()].filter((managed) => managed.db === db)
        .length,
    commandNames: commands.names,
    supports: (command) => commands.has(command),
    handle: (command, args) => commands.execute(command, args),
    onServerEvent: (listener) => {
      if (typeof listener !== "function") {
        throw new TypeError("server event listener must be a function");
      }
      context.runtimeState.serverEventListeners.add(listener);
      return () => context.runtimeState.serverEventListeners.delete(listener);
    },
  };
}

function createCommandHandlers(context) {
  const { db } = context;
  const handlers = {
    get_app_preferences: () => getAppPreferences(db),
    save_app_preferences: (args) => saveAppPreferences(db, args?.input),
    reset_app_preferences: () => resetAppPreferences(db),
    export_app_settings: (args) => exportAppSettings(db, args?.input),
    import_app_settings: (args) => importAppSettings(db, args?.input),
    clear_app_cache: () => clearAppCache(db),
    get_app_data_folder: () => getAppDataFolder(db),
    get_app_logs_folder: () => getAppLogsFolder(db),
    export_diagnostic_package: (args) =>
      exportDiagnosticPackage(db, args?.input),
    write_app_log: (args) => writeAppLog(db, args?.input),
    list_app_logs: (args) => listAppLogs(db, args?.input),
    clear_app_logs: () => clearAppLogs(db),
    get_database_schema_version: () => ({ version: databaseSchemaVersion(db) }),
    get_local_network_addresses: () => getLocalNetworkAddresses(),
    list_server_profiles: () => listServerProfiles(db),
    get_server_eula_acceptance: (args) =>
      getServerEulaAcceptance(db, args?.input?.serverId || args?.serverId),
    get_server_source: (args) =>
      getServerSource(db, args?.input?.serverId || args?.serverId),
    create_server_profile: (args) => createServerProfile(db, args?.input),
    get_server_setup_status: (args) => getServerSetupStatus(db, args?.serverId),
    get_default_server_root: (args) => ({
      path: managedServerRoot(db, args?.input?.name || "server", false),
    }),
    suggest_server_port: () => suggestServerPort(db),
    detect_server_version: (args) =>
      detectServerVersion(args?.rootDir || args?.input?.rootDir),
    update_server_profile: (args) => updateServerProfile(db, args?.input),
    delete_server_profile: (args) =>
      deleteServerProfile(
        db,
        args?.id || args?.input?.id,
        args?.deleteFromDisk === true || args?.input?.deleteFromDisk === true,
      ),
    get_process_summary: () => getProcessSummary(db),
    get_attention_items: () => getAttentionItems(db),
    get_server_process_status: (args) =>
      getServerProcessStatus(db, args?.serverId),
    list_process_events: (args) => listProcessEvents(db, args?.serverId),
    list_server_logs: (args) => listServerLogs(db, args?.serverId),
    read_server_log: (args) =>
      readServerLog(db, args?.serverId, args?.relativePath),
    list_notification_events: () => listNotificationEvents(db),
    get_notification_preferences: () => getNotificationPreferences(db),
    save_notification_preferences: (args) =>
      saveNotificationPreferences(db, args?.input),
    list_java_runtimes: () => listJavaRuntimes(db),
    plan_java_runtime: (args) => planJavaRuntime(db, args?.input),
    install_java_runtime: (args) => installJavaRuntime(db, args?.input),
    remove_java_runtime: (args) => removeJavaRuntime(db, args?.input),
    start_server: (args) => startServer(db, args?.serverId),
    stop_server: (args) => stopServer(db, args?.serverId),
    restart_server: (args) => restartServer(db, args?.serverId),
    restart_server_with_countdown: (args) =>
      restartServerWithCountdown(db, args?.input),
    send_server_command: (args) =>
      sendServerCommand(db, args?.serverId, args?.command),
    list_server_files: (args) =>
      listServerFiles(db, args?.serverId, args?.relativePath || ""),
    read_server_text_file: (args) =>
      readServerTextFile(db, args?.serverId, args?.relativePath),
    write_server_text_file: (args) =>
      writeServerTextFile(
        db,
        args?.serverId,
        args?.relativePath,
        args?.content,
        args?.expectedRevision,
      ),
    mutate_server_files: (args) => mutateServerFiles(db, args?.input),
    read_server_properties: (args) => readServerProperties(db, args?.serverId),
    save_server_properties: (args) =>
      saveServerProperties(
        db,
        args?.serverId ?? args?.input?.serverId,
        args?.entries ?? args?.input?.updates,
      ),
    list_server_backups: (args) => listServerBackups(db, args?.serverId),
    create_world_backup: (args) => createWorldBackup(db, args?.input),
    delete_server_backup: (args) =>
      deleteServerBackup(db, args?.backupId || args?.input?.backupId),
    export_server_backup: (args) => exportServerBackup(db, args?.input),
    list_backup_profiles: (args) => listBackupProfiles(db, args?.serverId),
    create_backup_profile: (args) => createBackupProfile(db, args?.input),
    update_backup_profile: (args) => updateBackupProfile(db, args?.input),
    delete_backup_profile: (args) =>
      deleteBackupProfile(db, args?.profileId || args?.input?.profileId),
    create_profile_backup: (args) => createProfileBackup(db, args?.input),
    restore_world_backup: (args) => restoreWorldBackup(db, args?.input),
    preview_backup_restore: (args) => previewBackupRestore(db, args?.input),
    list_players: (args) => listPlayers(db, args?.serverId),
    apply_player_change: (args) => applyPlayerChange(db, args?.input),
    read_player_lists: (args) => readPlayerLists(db, args?.serverId),
    save_player_list: (args) => savePlayerList(db, args?.input),
    list_installed_content: (args) => listInstalledContent(db, args?.serverId),
    import_local_content: (args) => importLocalContent(db, args?.input),
    disable_installed_content: (args) =>
      disableInstalledContent(db, args?.input),
    enable_installed_content: (args) => enableInstalledContent(db, args?.input),
    uninstall_installed_content: (args) =>
      uninstallInstalledContent(db, args?.input),
    get_content_update_policy: (args) => getContentUpdatePolicy(db, args),
    save_content_update_policy: (args) =>
      saveContentUpdatePolicy(db, args?.input),
    check_content_updates: (args) => checkContentUpdates(db, args?.input),
    install_content_update: (args) => installContentUpdate(db, args?.input),
    install_all_content_updates: (args) =>
      installAllContentUpdates(db, args?.input),
    list_content_update_history: (args) =>
      listContentUpdateHistory(db, args?.serverId),
    rollback_content_update: (args) => rollbackContentUpdate(db, args?.input),
    list_tunnel_providers: () => listTunnelProviders(db),
    list_tunnel_statuses: () => listTunnelStatuses(db),
    get_tunnel_provider: (args) =>
      getTunnelProvider(db, args?.providerId || args?.input?.providerId),
    create_tunnel_provider: (args) => createTunnelProvider(db, args?.input),
    update_tunnel_provider: (args) => updateTunnelProvider(db, args?.input),
    delete_tunnel_provider: (args) =>
      deleteTunnelProvider(db, args?.providerId || args?.input?.providerId),
    list_tunnel_bindings: () => listTunnelBindings(db),
    bind_tunnel_to_server: (args) => bindTunnelToServer(db, args?.input),
    unbind_tunnel_from_server: (args) =>
      unbindTunnelFromServer(db, args?.input),
    list_scheduled_tasks: (args) => listScheduledTasks(db, args?.serverId),
    list_scheduled_task_runs: (args) =>
      listScheduledTaskRuns(db, args?.serverId),
    create_scheduled_task: (args) => createScheduledTask(db, args?.input),
    update_scheduled_task: (args) => updateScheduledTask(db, args?.input),
    delete_scheduled_task: (args) =>
      deleteScheduledTask(db, args?.taskId || args?.input?.taskId),
    run_due_scheduled_tasks: () => runDueScheduledTasks(db),
    prune_telemetry: (args) => pruneTelemetry(db, args?.input),
    get_performance_history: (args) =>
      getPerformanceHistory(db, args?.serverId),
    sample_server_metrics: (args) => sampleServerMetrics(db, args?.serverId),
    run_server_diagnostics: (args) => runServerDiagnostics(db, args?.serverId),
    list_diagnostic_runs: (args) => listDiagnosticRuns(db, args?.serverId),
    preview_modpack_import_command: (args) => previewModpackImport(args?.input),
    plan_server_provisioning: (args) => planServerProvisioning(args?.input),
    create_provisioning_job: (args) =>
      provisioningExecutorFor(db).createJob(args?.input?.plan || args?.input),
    get_provisioning_job: (args) =>
      provisioningExecutorFor(db).getJob(args?.input?.jobId || args?.jobId),
    list_provisioning_jobs: () => provisioningExecutorFor(db).listJobs(),
    list_recoverable_provisioning_jobs: () =>
      provisioningExecutorFor(db).listRecoverableJobs(),
    run_provisioning_job: (args) =>
      provisioningExecutorFor(db).executeJob(args?.input?.jobId || args?.jobId),
    retry_provisioning_job: (args) =>
      provisioningExecutorFor(db).retryJob(args?.input?.jobId || args?.jobId),
    cancel_provisioning_job: (args) =>
      provisioningExecutorFor(db).cancelJob(args?.input?.jobId || args?.jobId),
    import_modpack: (args) => importModpack(db, args?.input),
    list_loader_minecraft_versions: (args) =>
      listLoaderMinecraftVersions(args?.input),
    list_loader_versions: (args) => listLoaderVersions(args?.input),
    search_modrinth_projects: (args) => searchModrinthProjects(args?.input),
    get_modrinth_project: (args) => getModrinthProject(args?.input),
    list_modrinth_versions: (args) =>
      listModrinthVersions(marketplaceInput(db, args?.input)),
    install_modrinth_version: (args) => installModrinthVersion(db, args?.input),
    search_hangar_projects: (args) => searchHangarProjects(args?.input),
    get_hangar_project: (args) => getHangarProject(args?.input),
    list_hangar_versions: (args) =>
      listHangarVersions(marketplaceInput(db, args?.input)),
    install_hangar_version: (args) => installHangarVersion(db, args?.input),
    search_curseforge_projects: (args) => searchCurseForgeProjects(args?.input),
    get_curseforge_project: (args) => getCurseForgeProject(args?.input),
    list_curseforge_files: (args) =>
      listCurseForgeFiles(marketplaceInput(db, args?.input)),
    install_curseforge_file: (args) => installCurseForgeFile(db, args?.input),
    import_curseforge_manual: (args) => importCurseForgeManual(db, args?.input),
    search_bbsmc_projects: (args) => searchBbsmcProjects(args?.input),
    get_bbsmc_project: (args) => getBbsmcProject(args?.input),
    fetch_marketplace_image: (args) => fetchMarketplaceImage(args?.input),
    list_bbsmc_versions: (args) =>
      listBbsmcVersions(marketplaceInput(db, args?.input)),
    install_bbsmc_public_file: (args) =>
      installBbsmcPublicFile(db, args?.input),
    check_server_update: (args) => checkServerUpdate(db, args?.input),
    install_server_update: (args) => installServerUpdate(db, args?.input),
    rollback_server_update: (args) => rollbackServerUpdate(db, args?.input),
    list_server_update_history: (args) =>
      listServerUpdateHistory(db, args?.serverId),
    create_notification_event: (args) =>
      createNotificationEvent(db, args?.input),
  };
  const activeContentOperations = new Set();
  context.runtimeState.activeContentOperations = activeContentOperations;
  for (const name of [
    "import_local_content",
    "import_curseforge_manual",
    "install_modrinth_version",
    "install_bbsmc_public_file",
    "install_curseforge_file",
    "install_hangar_version",
    "install_content_update",
    "install_all_content_updates",
    "rollback_content_update",
  ]) {
    const execute = handlers[name];
    handlers[name] = async (args) => {
      const id = requireServerId(args?.input?.serverId);
      if (
        activeContentOperations.has(id) ||
        context.runtimeState.backingUpServers?.has(id) ||
        context.runtimeState.mutatingServerDirs?.has(id)
      )
        throw codedError(
          "CONTENT_OPERATION_IN_PROGRESS",
          "another content operation is in progress for this server",
        );
      activeContentOperations.add(id);
      try {
        return await execute(args);
      } finally {
        activeContentOperations.delete(id);
      }
    };
  }
  for (const name of [
    "disable_installed_content",
    "enable_installed_content",
    "uninstall_installed_content",
  ]) {
    const execute = handlers[name];
    handlers[name] = (args) => {
      if (
        activeContentOperations.has(args?.input?.serverId) ||
        context.runtimeState.backingUpServers?.has(args?.input?.serverId) ||
        context.runtimeState.mutatingServerDirs?.has(args?.input?.serverId)
      )
        throw codedError(
          "CONTENT_OPERATION_IN_PROGRESS",
          "another content operation is in progress for this server",
        );
      return execute(args);
    };
  }
  return handlers;
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

function migrateLegacyServersTable(db) {
  const launchSpecValue = tableHasColumn(db, "servers", "launch_spec_json")
    ? "launch_spec_json"
    : "NULL";
  const compatibilityWarningsValue = tableHasColumn(
    db,
    "servers",
    "compatibility_warning_json",
  )
    ? "COALESCE(compatibility_warning_json, '[]')"
    : "'[]'";
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
        ${launchSpecValue}, ${compatibilityWarningsValue}, created_at, updated_at
      FROM servers;
      DROP TABLE servers;
      ALTER TABLE servers_v2 RENAME TO servers;
    `);
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw codedError(
        "DB_MIGRATION_FOREIGN_KEY_VIOLATION",
        "database migration would violate foreign keys",
      );
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
    throw codedError(
      "DB_SCHEMA_TOO_NEW",
      `database schema version ${version} is newer than supported version ${currentSchemaVersion}`,
    );
  }
  if (
    !tableHasColumn(db, "servers", "launch_spec_json") ||
    !tableHasColumn(db, "servers", "compatibility_warning_json")
  ) {
    migrateLegacyServersTable(db);
    return;
  }
  /* `mod_id` is what the jar calls itself; `content_id` is where it was
     downloaded from. They are not the same thing and must not share a column —
     the update checker parses `content_id` as `provider:project:version`.
     `metadata_scanned_at` records that the jar has already been opened and
     asked, so one that carries no descriptor is not reopened on every page
     load. Null means "never looked", which every pre-existing row is. */
  if (!tableHasColumn(db, "installed_content", "mod_id")) {
    db.exec("ALTER TABLE installed_content ADD COLUMN mod_id TEXT");
  }
  if (!tableHasColumn(db, "installed_content", "metadata_scanned_at")) {
    db.exec(
      "ALTER TABLE installed_content ADD COLUMN metadata_scanned_at TEXT",
    );
  }
  for (const [column, declaration] of Object.entries({
    schedule_kind: "TEXT NOT NULL DEFAULT 'interval'",
    time_of_day: "TEXT",
    weekdays_json: "TEXT NOT NULL DEFAULT '[]'",
    backup_profile_id: "TEXT REFERENCES backup_profiles(id) ON DELETE RESTRICT",
  })) {
    if (!tableHasColumn(db, "scheduled_tasks", column))
      db.exec(
        `ALTER TABLE scheduled_tasks ADD COLUMN ${column} ${declaration}`,
      );
  }
  if (!tableHasColumn(db, "server_update_history", "metadata_json"))
    db.exec(
      "ALTER TABLE server_update_history ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'",
    );
  if (!tableHasColumn(db, "backups", "manifest_sha256"))
    db.exec("ALTER TABLE backups ADD COLUMN manifest_sha256 TEXT");
  if (version < currentSchemaVersion) {
    db.exec(`PRAGMA user_version = ${currentSchemaVersion}`);
  }
}

// Every message these two helpers are given reads "<field> is required", so the
// error code is just the field: "server name is required" -> SERVER_NAME_REQUIRED.
// Deriving it leaves the thirty-odd call sites untouched while still giving the
// renderer something to translate. electron/error-codes.test.mjs reads the call
// sites and applies the same derivation, so a new field without a locale entry
// fails the build rather than reaching a user in English.
function requiredFieldCode(message) {
  const field = /^(.+) is required$/.exec(message);
  // Not the documented shape. Surface it untranslated rather than inventing a
  // code no locale file has.
  if (!field) return null;
  return `${field[1].replace(/\s+/g, "_").toUpperCase()}_REQUIRED`;
}

function requiredFieldError(message) {
  const code = requiredFieldCode(message);
  return code ? codedError(code, message) : new Error(message);
}

function trimRequired(value, message) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw requiredFieldError(message);
  }
  return trimmed;
}

function requireServerId(serverId) {
  return trimRequired(serverId, "server id is required");
}

function serverRoot(db, serverId) {
  return getServerProfile(db, requireServerId(serverId)).rootDir;
}

// Filesystems cap a single path component at 255 characters, so a longer name
// used to reach mkdir and come back as a raw untranslated ENOENT quoting the
// full absolute path. 100 leaves room for the "-2" de-duplication suffix and is
// far beyond any name a server actually needs.
const MAX_SERVER_NAME_LENGTH = 100;

function validatedServerName(value) {
  const name = trimRequired(value, "server name is required");
  if (name.length > MAX_SERVER_NAME_LENGTH) {
    throw codedError(
      "SERVER_NAME_TOO_LONG",
      `server name must be at most ${MAX_SERVER_NAME_LENGTH} characters`,
    );
  }
  return name;
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
    throw requiredFieldError(`${label} is required`);
  }
  return path.resolve(value.trim());
}

const defaultProviders = {
  modrinth: true,
  hangar: true,
  bbsmc: true,
  curseforge: true,
};

function contextFor(db) {
  const context = databaseContexts.get(db);
  if (!context) {
    throw new Error("backend context is unavailable");
  }
  return context;
}

function appDataDirFor(db) {
  return contextFor(db).appDataDir;
}

function appPreferencesPath(db) {
  return path.join(appDataDirFor(db), "app-preferences.json");
}

function defaultAppPreferences(db) {
  const appDataDir = appDataDirFor(db);
  return {
    closeBehavior: "minimize",
    launchAtLogin: false,
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
    launchAtLogin: input.launchAtLogin === true,
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
        ["modrinth", "bbsmc", "hangar"],
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
    throw codedError(
      "APP_PREFERENCES_READ_FAILED",
      `failed to read app preferences: ${error.message}`,
    );
  }
}

function saveAppPreferences(db, input = {}) {
  if (!input || typeof input !== "object") {
    throw codedError(
      "APP_PREFERENCES_INPUT_REQUIRED",
      "app preferences input is required",
    );
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
    throw codedError(
      "CACHE_ROOT_REFUSED",
      "refusing to clear filesystem root cache directory",
    );
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
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(preferences, null, 2)}\n`,
    "utf8",
  );
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
    throw codedError(
      "SETTINGS_IMPORT_FILE_MISSING",
      "settings import file does not exist",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  } catch (error) {
    throw codedError(
      "SETTINGS_IMPORT_READ_FAILED",
      `failed to read settings import file: ${error.message}`,
    );
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
    throw codedError("APP_LOG_INPUT_REQUIRED", "app log input is required");
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
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
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
  fs.writeFileSync(
    filePath,
    sized.length > 0 ? `${sized.join("\n")}\n` : "",
    "utf8",
  );
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
    throw codedError(
      "SERVER_ROOT_DIRECTORY_REQUIRED",
      "server root directory is required",
    );
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

// A prefix check on the resolved string is not enough on its own: a symbolic
// link inside the server folder (one an imported modpack could carry) resolves
// to somewhere else entirely while still looking like a child. Resolve links
// before comparing. The target often does not exist yet, so resolve the deepest
// existing ancestor and re-attach the rest.
function resolveThroughLinks(target) {
  const pending = [];
  let current = target;
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return pending.length === 0 ? real : path.join(real, ...pending);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return target;
      }
      pending.unshift(path.basename(current));
      current = parent;
    }
  }
}

function safeServerPath(db, serverId, relativePath = "") {
  const root = resolveThroughLinks(path.resolve(serverRoot(db, serverId)));
  const target = resolveThroughLinks(path.resolve(root, relativePath || "."));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw codedError("PATH_ESCAPES_SERVER_ROOT", "path escapes server root");
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
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim(),
        ];
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
      fileName.match(
        /forge[-+_ ]*(?:\d+\.\d+(?:\.\d+)?[-+_ ])?([0-9][\w.+-]*)/i,
      )?.[1] ?? null;
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
    throw codedError(
      "SERVER_ROOT_NOT_A_DIRECTORY",
      "server root path does not exist or is not a directory",
    );
  }

  const propertiesPath = path.join(root, "server.properties");
  const properties = readPropertiesFile(propertiesPath);
  const jars = fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const parsedJar =
    jars
      .map(parseServerJarName)
      .find((jar) => jar.loaderType || jar.minecraftVersion) ?? {};
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

// Worlds, backups and server jars are large enough that the synchronous fs
// calls froze the whole window while they ran — and scheduled backups run them
// without the user asking. Everything below hands the work to the libuv thread
// pool so the main process keeps answering IPC.
async function copyTree(source, destination) {
  await fs.promises.cp(source, destination, { recursive: true, force: true });
}

async function removeTree(target) {
  await fs.promises.rm(target, { recursive: true, force: true });
}

async function directorySizeBytes(target) {
  let stat;
  try {
    stat = await fs.promises.stat(target);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
  if (stat.isFile()) {
    return stat.size;
  }
  const names = await fs.promises.readdir(target);
  let total = 0;
  for (const name of names) {
    total += await directorySizeBytes(path.join(target, name));
  }
  return total;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  // Streaming rather than readFileSync: a modpack server jar is hundreds of
  // megabytes, and reading it whole blocks the main process and spikes memory.
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

function processEventKind(message) {
  if (/\b(?:joined|left) the game\b/i.test(message)) {
    return "players";
  }
  return /^(Server process|Stop requested|Restart|Auto restarting|Crash signature)/i.test(
    message,
  )
    ? "lifecycle"
    : "console";
}

function emitServerEvent(db, event) {
  for (const listener of contextFor(db).runtimeState.serverEventListeners) {
    try {
      listener(event);
    } catch {
      // Event consumers must never interrupt process supervision.
    }
  }
}

// A running server writes one metric sample every 5 seconds and one process
// event per console line, and nothing ever deleted either, so the database grew
// without bound for the lifetime of the install. Trim by age on a slow cadence
// instead of on every insert. Raise the retention constants to keep more
// history; the numbers, not the mechanism, are the knob.
const METRIC_SAMPLE_RETENTION_DAYS = 14;
const PROCESS_EVENT_RETENTION_DAYS = 30;
const TELEMETRY_PRUNE_INTERVAL_MS = 10 * 60 * 1000;
const lastTelemetryPruneAt = new WeakMap();

function pruneTelemetry(db, input) {
  if (closedDatabases.has(db)) {
    return { metricSamplesDeleted: 0, processEventsDeleted: 0, skipped: true };
  }
  const now = Date.now();
  if (
    !input?.force &&
    now - (lastTelemetryPruneAt.get(db) ?? 0) < TELEMETRY_PRUNE_INTERVAL_MS
  ) {
    return { metricSamplesDeleted: 0, processEventsDeleted: 0, skipped: true };
  }
  lastTelemetryPruneAt.set(db, now);
  const cutoff = (days) => new Date(now - days * 86_400_000).toISOString();
  const samples = db
    .prepare("DELETE FROM server_metric_samples WHERE sampled_at < ?")
    .run(cutoff(METRIC_SAMPLE_RETENTION_DAYS));
  const events = db
    .prepare("DELETE FROM process_events WHERE created_at < ?")
    .run(cutoff(PROCESS_EVENT_RETENTION_DAYS));
  return {
    metricSamplesDeleted: Number(samples.changes || 0),
    processEventsDeleted: Number(events.changes || 0),
    skipped: false,
  };
}

function addProcessEvent(db, serverId, level, message) {
  if (closedDatabases.has(db)) {
    return;
  }
  const id = randomUUID();
  const createdAt = nowIso();
  db.prepare(
    "INSERT INTO process_events (id, server_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, serverId || null, level, message, createdAt);
  if (serverId) {
    emitServerEvent(db, {
      serverId,
      kind: processEventKind(message),
      payload: {
        id,
        serverId,
        level,
        message,
        createdAt,
      },
    });
  }
}

function validateRuntimeSettings(serverPort, minMemoryMb, maxMemoryMb) {
  if (serverPort != null && (serverPort < 1 || serverPort > 65535)) {
    throw codedError(
      "SERVER_PORT_OUT_OF_RANGE",
      "server port must be between 1 and 65535",
    );
  }
  if (
    (minMemoryMb != null && minMemoryMb <= 0) ||
    (maxMemoryMb != null && maxMemoryMb <= 0)
  ) {
    throw codedError(
      "MEMORY_MUST_BE_POSITIVE",
      "memory values must be positive",
    );
  }
  if (minMemoryMb != null && maxMemoryMb != null && minMemoryMb > maxMemoryMb) {
    throw codedError(
      "MIN_MEMORY_ABOVE_MAX",
      "minimum memory cannot be greater than maximum memory",
    );
  }
}

function validateRestartPolicy(restartPolicy) {
  if (!restartPolicy) {
    return;
  }
  if (restartPolicy.maxAttempts < 0) {
    throw codedError(
      "RESTART_ATTEMPTS_NEGATIVE",
      "restart max attempts cannot be negative",
    );
  }
  if (restartPolicy.cooldownSeconds < 0) {
    throw codedError(
      "RESTART_COOLDOWN_NEGATIVE",
      "restart cooldown seconds cannot be negative",
    );
  }
}

function dbLoader(loaderType) {
  const loader = loaderToDb[loaderType];
  if (!loader) {
    throw codedError(
      "UNKNOWN_LOADER_TYPE",
      `unknown loader type: ${loaderType}`,
    );
  }
  return loader;
}

function defaultRestartPolicy() {
  return { enabled: true, maxAttempts: 3, cooldownSeconds: 30 };
}

function processSpawnerFor(db) {
  return contextFor(db).dependencies.processSpawner;
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
  const context = contextFor(db);
  const collector = context.dependencies.metricCollector;
  const measured = await Promise.resolve(collector(pid));
  if (!measured) return { cpuPercent: null, memoryMb: null, tps: null };
  let cpuPercent = Number.isFinite(measured.cpuPercent)
    ? Number(measured.cpuPercent)
    : null;
  if (cpuPercent === null && Number.isFinite(measured.cpuSeconds)) {
    const now = Date.now();
    const baselines = context.runtimeState.metricBaselines;
    const baseline = baselines.get(pid);
    if (baseline && now > baseline.sampledAt) {
      cpuPercent = Math.max(
        0,
        ((Number(measured.cpuSeconds) - baseline.cpuSeconds) * 100000) /
          (now - baseline.sampledAt),
      );
    }
    baselines.set(pid, {
      cpuSeconds: Number(measured.cpuSeconds),
      sampledAt: now,
    });
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
    Promise.resolve(startServer(db, profile.id, { autoRestart: true })).catch(
      (error) => {
        addProcessEvent(
          db,
          profile.id,
          "error",
          `Auto restart failed: ${error.message}`,
        );
      },
    );
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
    launchSpec: row.launch_spec_json ? JSON.parse(row.launch_spec_json) : null,
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
    throw codedError(
      "SERVER_PROFILE_NOT_FOUND",
      `server profile not found: ${id}`,
    );
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
    throw codedError(
      "SERVER_PROFILE_INPUT_REQUIRED",
      "server profile input is required",
    );
  }
  const name = validatedServerName(input.name);
  const isExistingFolderImport = input.source?.kind === "existingFolder";
  const rootDir = input.rootDir?.trim()
    ? input.rootDir.trim()
    : managedServerRoot(db, name, isExistingFolderImport);
  if (isExistingFolderImport && !fs.existsSync(rootDir)) {
    throw codedError("IMPORT_ROOT_MISSING", "import root path does not exist");
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
    throw codedError(
      "SERVER_PROFILE_ID_REQUIRED",
      "server profile id is required",
    );
  }
  const existing = getServerProfile(db, input.id);
  const name =
    input.name === undefined ? existing.name : validatedServerName(input.name);
  const rootDir =
    input.rootDir === undefined
      ? existing.rootDir
      : trimRequired(input.rootDir, "server root directory is required");
  const loaderType =
    input.loaderType === undefined ? existing.loaderType : input.loaderType;
  const serverPort =
    input.serverPort === undefined ? existing.serverPort : input.serverPort;
  if (input.serverPort === null) {
    throw codedError(
      "SERVER_PORT_OUT_OF_RANGE",
      "server port must be between 1 and 65535",
    );
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
    ? mergeProperties(originalProperties, { "server-port": String(serverPort) })
        .raw
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
      fs.writeFileSync(
        synchronizedPropertiesPath,
        synchronizedProperties,
        "utf8",
      );
      propertiesWritten = true;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (propertiesWritten) {
      if (propertiesExisted) {
        fs.writeFileSync(
          synchronizedPropertiesPath,
          originalProperties,
          "utf8",
        );
      } else {
        fs.rmSync(synchronizedPropertiesPath, { force: true });
      }
    }
    throw error;
  }
  return getServerProfile(db, input.id);
}

function pathContains(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function canonicalExistingPath(filePath) {
  const resolved = path.resolve(filePath);
  return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
}

function deletableServerRoot(db, rootDir) {
  const requestedRoot = stringFilePath(rootDir, "server root directory");
  const canonicalRoot = canonicalExistingPath(requestedRoot);
  const preferences = getAppPreferences(db);
  const protectedPaths = [
    path.parse(canonicalRoot).root,
    os.homedir(),
    process.cwd(),
    __dirname,
    appDataDirFor(db),
    preferences.defaultServerDir,
    preferences.defaultBackupDir,
  ].map(canonicalExistingPath);

  if (
    protectedPaths.some((protectedPath) =>
      pathContains(canonicalRoot, protectedPath),
    )
  ) {
    throw codedError(
      "PROTECTED_DIRECTORY",
      "Refusing to delete a protected directory. Choose the exact server folder instead.",
    );
  }

  return requestedRoot;
}

function deleteServerProfile(db, id, deleteFromDisk = false) {
  const serverId = requireServerId(id);
  const profile = getServerProfile(db, serverId);

  if (deleteFromDisk) {
    const processStatus = getServerProcessStatus(db, serverId)?.status;
    if (
      contextFor(db).runtimeState.startingServers.has(serverId) ||
      managedChildren.has(serverId) ||
      processStatus === "running" ||
      processStatus === "externalRunning"
    ) {
      throw codedError(
        "STOP_SERVER_BEFORE_DELETE",
        "Stop the server before deleting its files from disk.",
      );
    }

    const rootDir = deletableServerRoot(db, profile.rootDir);
    clearRestartCountdown(serverId);
    clearRestartState(serverId);
    fs.rmSync(rootDir, { recursive: true, force: true });
  }

  const result = db.prepare("DELETE FROM servers WHERE id = ?").run(serverId);
  if (result.changes === 0) {
    throw codedError(
      "SERVER_PROFILE_NOT_FOUND",
      `server profile not found: ${serverId}`,
    );
  }
  return null;
}

function getProcessSummary(db) {
  const rows = db
    .prepare(
      `SELECT server.id AS server_id,
              (
                SELECT status
                FROM managed_processes
                WHERE server_id = server.id
                ORDER BY started_at DESC, rowid DESC
                LIMIT 1
              ) AS status,
              (
                SELECT created_at
                FROM backups
                WHERE server_id = server.id
                ORDER BY created_at DESC
                LIMIT 1
              ) AS last_backup_at
       FROM servers AS server
       ORDER BY server.id ASC`,
    )
    .all();
  return rows.reduce(
    (summary, row) => {
      const status =
        row.status === "external_running" ? "externalRunning" : row.status;
      if (status) summary.statuses[row.server_id] = status;
      summary.lastBackups[row.server_id] = row.last_backup_at || null;
      if (row.status === "crashed") {
        summary.crashedCount += 1;
      } else if (
        row.status === "running" ||
        row.status === "external_running"
      ) {
        summary.runningCount += 1;
      }
      return summary;
    },
    { runningCount: 0, crashedCount: 0, statuses: {}, lastBackups: {} },
  );
}

function getAttentionItems(db) {
  const staleBackupBefore = Date.now() - 7 * 24 * 60 * 60 * 1_000;
  return db
    .prepare(
      "SELECT id, name, created_at FROM servers ORDER BY name COLLATE NOCASE",
    )
    .all()
    .flatMap((server) => {
      const items = [];
      const process = db
        .prepare(
          `SELECT status, exited_at, started_at
           FROM managed_processes
           WHERE server_id = ?
           ORDER BY started_at DESC, rowid DESC
           LIMIT 1`,
        )
        .get(server.id);
      if (process?.status === "crashed") {
        items.push({
          id: `crash:${server.id}`,
          serverId: server.id,
          serverName: server.name,
          kind: "crash",
          severity: "error",
          createdAt: process.exited_at || process.started_at,
        });
      }

      const update = db
        .prepare(
          `SELECT status, created_at
           FROM server_update_history
           WHERE server_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT 1`,
        )
        .get(server.id);
      if (update?.status === "available") {
        items.push({
          id: `update:${server.id}`,
          serverId: server.id,
          serverName: server.name,
          kind: "update",
          severity: "info",
          createdAt: update.created_at,
        });
      }

      const backup = db
        .prepare(
          `SELECT created_at
           FROM backups
           WHERE server_id = ? AND status = 'completed'
           ORDER BY created_at DESC, rowid DESC
           LIMIT 1`,
        )
        .get(server.id);
      /* "Overdue" is a claim about elapsed time, so it needs a clock that has
         actually been running. A server with no backup yet was reported overdue
         the moment it was created, which is wrong and trains people to ignore
         the warning. With no backup the clock starts at the server's creation,
         so the notice appears only once a week of the server's life has passed
         without one. */
      const backupTime = backup
        ? new Date(backup.created_at).getTime()
        : new Date(server.created_at).getTime();
      if (!Number.isFinite(backupTime) || backupTime < staleBackupBefore) {
        items.push({
          id: `backup:${server.id}`,
          serverId: server.id,
          serverName: server.name,
          kind: "backup",
          severity: "warning",
          createdAt: backup?.created_at || null,
        });
      }
      return items;
    });
}

function getLocalNetworkAddresses() {
  const seen = new Set();
  return Object.entries(os.networkInterfaces())
    .flatMap(([interfaceName, entries]) =>
      (entries || [])
        .filter(
          (entry) =>
            entry.family === "IPv4" &&
            !entry.internal &&
            entry.address !== "0.0.0.0",
        )
        .map((entry) => ({
          address: entry.address,
          interfaceName,
        })),
    )
    .filter((entry) => {
      if (seen.has(entry.address)) return false;
      seen.add(entry.address);
      return true;
    })
    .sort((left, right) =>
      left.interfaceName.localeCompare(right.interfaceName),
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
    throw codedError("SERVER_ID_REQUIRED", "server id is required");
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
    throw codedError("SERVER_ID_REQUIRED", "server id is required");
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
    throw codedError(
      "LOG_PATH_OUTSIDE_LOGS_FOLDER",
      "log path must be a log file inside the server logs folder",
    );
  }
  const { target } = safeServerPath(db, serverId, normalizedPath);
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    throw codedError("LOG_PATH_NOT_A_FILE", "selected log path is not a file");
  }
  if (stat.size > 10 * 1024 * 1024) {
    throw codedError("LOG_FILE_TOO_LARGE", "log file is too large to open");
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
    throw codedError(
      "NOTIFICATION_PREFERENCES_INPUT_REQUIRED",
      "notification preferences input is required",
    );
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
    architecture: parseJavaArchitecture(output),
  };
}

/* Every 64-bit JVM says so on its VM line — "64-Bit Server VM", "amd64-64",
   "aarch64". A 32-bit build says nothing at all, which is exactly why it has to
   be read rather than assumed: this used to report `process.arch`, so a 32-bit
   Java 8 was listed as x64. That is not cosmetic. A 32-bit JVM cannot address
   more than roughly 1.5 GB of heap, so pointing a 6 GB server at one trades a
   version crash for a heap crash. */
function parseJavaArchitecture(output) {
  return /\b(64-bit|amd64|x86_64|aarch64|ppc64|s390x)\b/i.test(output)
    ? "64-bit"
    : "32-bit";
}

/* A 32-bit JVM cannot reserve a heap this large; the JVM refuses at startup
   with "Could not reserve enough space for object heap". */
const MAX_32_BIT_HEAP_MB = 1536;

function runtimeFitsHeap(architecture, maxMemoryMb) {
  if (architecture !== "32-bit") return true;
  return !maxMemoryMb || Number(maxMemoryMb) <= MAX_32_BIT_HEAP_MB;
}

function detectJavaVendor(output) {
  if (/temurin|adoptium/i.test(output)) {
    return "Eclipse Temurin";
  }
  if (/openjdk/i.test(output)) {
    return "OpenJDK";
  }
  /* Oracle's own builds never print "Oracle". They print `Java(TM) SE Runtime
     Environment`, which is why three of four detected runtimes read "Unknown"
     in a table whose whole job is telling them apart. */
  if (/oracle|java\(tm\)/i.test(output)) {
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
    // Distinct from JAVA_EXECUTABLE_MISSING, which means a downloaded runtime
    // archive held no java program. Here a path we were given simply is gone.
    throw codedError(
      "JAVA_PATH_NOT_FOUND",
      `Java executable does not exist: ${candidate.path}`,
    );
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
  // A non-zero exit means the probe failed even when it printed something.
  // Scanning PATH surfaces vendor stubs such as Oracle's javapath shim, which
  // exits 2 with "Error: opening registry key ..." and used to be listed as an
  // installed runtime of version "Unknown".
  // trim() again per line: on Windows the split leaves the CR of a CRLF behind,
  // which would show up as a stray break inside the translated message.
  const firstLine = output.trim().split("\n")[0].trim();
  if (result.status !== 0) {
    const detail = firstLine || `status ${result.status}`;
    throw codedError(
      "JAVA_VERSION_PROBE_FAILED",
      `java -version exited with status ${result.status}: ${detail}`,
      { detail },
    );
  }
  const parsed = parseJavaVersionOutput(output);
  if (parsed.majorVersion === null) {
    // Without a major version the runtime can never be matched against a
    // server's requirement, so reporting it as installed would be a false
    // positive. Surface what it printed instead.
    throw codedError(
      "JAVA_VERSION_UNRECOGNIZED",
      `java -version output was not recognized: ${firstLine || "(no output)"}`,
      { detail: firstLine || "" },
    );
  }
  return {
    path: candidate.path,
    source: candidate.source,
    version: parsed.version,
    majorVersion: parsed.majorVersion,
    vendor: detectJavaVendor(output),
    architecture: parsed.architecture,
  };
}

function requiredJavaMajorForMinecraft(minecraftVersion) {
  return runtimeRequiredJavaMajor(minecraftVersion);
}

function maxJavaMajorForMinecraft(minecraftVersion) {
  return runtimeMaxJavaMajor(minecraftVersion);
}

/* The version window is a launch precondition, not a report. Minecraft up to
   1.16 boots through LegacyLauncher, which casts the system class loader to
   `java.net.URLClassLoader`; on Java 9+ that cast throws before the server ever
   opens its port, and all the operator sees is a JVM stack trace about
   `jdk.internal.loader.ClassLoaders$AppClassLoader`. The app already knows the
   window, so it refuses in its own words rather than letting the JVM fail. */
function assertJavaMajorInWindow(minecraftVersion, majorVersion, javaPath) {
  const maxMajorVersion = maxJavaMajorForMinecraft(minecraftVersion);
  if (maxMajorVersion === null) return;
  if (!Number.isFinite(Number(majorVersion))) return;
  if (Number(majorVersion) <= maxMajorVersion) return;
  throw codedError(
    "JAVA_VERSION_OUT_OF_RANGE",
    `Minecraft ${minecraftVersion} cannot run on Java ${majorVersion}: it needs Java ${maxMajorVersion}. Configured runtime: ${javaPath}`,
    { detail: String(javaPath || "") },
  );
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
  const maxMajorVersion = maxJavaMajorForMinecraft(profile.minecraftVersion);
  const configuredJavaPath = profile.javaPath || null;
  /* Newest-first picked Java 21 for a 1.7.10 server and then called it
     compatible, which is how a freshly installed Forge 1.7.10 server crashed on
     its first start. The window is what counts, and the lowest runtime inside
     it is the safest member of that window. */
  const runtime = configuredJavaPath
    ? runtimes.find(
        (item) =>
          normalizeJavaPath(item.path) ===
          normalizeJavaPath(configuredJavaPath),
      )
    : selectJavaRuntime(runtimes, requiredMajorVersion, maxMajorVersion) ||
      runtimes
        .filter((item) => Number.isFinite(item.majorVersion))
        .sort((left, right) => left.majorVersion - right.majorVersion)[0];

  /* The one runtime already on this machine that would actually work for this
     server: right version window and able to hold the configured heap. The view
     offers it as a one-click fix, so the rule lives here rather than being
     re-derived — and half-derived — on the other side of the IPC boundary. */
  const recommendedJavaPath = !requiredMajorVersion
    ? null
    : (selectJavaRuntime(
        runtimes.filter((item) =>
          runtimeFitsHeap(item.architecture, profile.maxMemoryMb),
        ),
        requiredMajorVersion,
        maxMajorVersion,
      )?.path ?? null);

  if (!requiredMajorVersion) {
    return {
      serverId: profile.id,
      serverName: profile.name,
      minecraftVersion: profile.minecraftVersion,
      configuredJavaPath,
      requiredMajorVersion: null,
      maxMajorVersion,
      recommendedJavaPath,
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
      maxMajorVersion,
      recommendedJavaPath,
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
      maxMajorVersion,
      recommendedJavaPath,
      status: "unknown",
      message: `Detected Java version is unknown. Java ${requiredMajorVersion} or newer is required.`,
    };
  }

  const fitsWindow =
    runtime.majorVersion >= requiredMajorVersion &&
    (maxMajorVersion === null || runtime.majorVersion <= maxMajorVersion);
  /* Version is not the only way a runtime can be wrong for this server. A
     32-bit JVM is a valid Java 8 and still cannot start a 6 GB server. */
  const fitsHeap = runtimeFitsHeap(runtime.architecture, profile.maxMemoryMb);
  const compatible = fitsWindow && fitsHeap;
  return {
    serverId: profile.id,
    serverName: profile.name,
    minecraftVersion: profile.minecraftVersion,
    configuredJavaPath,
    requiredMajorVersion,
    maxMajorVersion,
    recommendedJavaPath,
    /* What the server runs on today, so the report can name the actual problem
       instead of restating the requirement. */
    configuredMajorVersion: runtime.majorVersion,
    configuredArchitecture: runtime.architecture ?? null,
    reason: compatible
      ? null
      : !fitsHeap
        ? "architecture"
        : runtime.majorVersion < requiredMajorVersion
          ? "tooOld"
          : "tooNew",
    status: compatible ? "compatible" : "warning",
    message: compatible
      ? `Java ${runtime.majorVersion} satisfies required Java ${requiredMajorVersion}.`
      : !fitsHeap
        ? `This is a 32-bit Java and cannot reserve the ${profile.maxMemoryMb} MB configured for this server.`
        : runtime.majorVersion < requiredMajorVersion
          ? `Java ${runtime.majorVersion} is below required Java ${requiredMajorVersion}.`
          : `Java ${runtime.majorVersion} is too new for Minecraft ${profile.minecraftVersion}, which needs Java ${requiredMajorVersion}.`,
  };
}

function javaExecutableName() {
  return process.platform === "win32" ? "java.exe" : "java";
}

// Scan failures are reported as data rather than thrown, so the code has to
// travel on the row: the IPC tagging in main.cjs only sees thrown errors.
function javaScanFailure(candidatePath, source, error) {
  return {
    path: candidatePath,
    source,
    code: error.mcsmCode || null,
    detail: error.detail || "",
    error: error.message,
  };
}

// Directories every mainstream JDK vendor installs into. Scanning them is what
// lets a machine that already has Java report it on first run: JAVA_HOME is
// frequently unset, and the profile paths below are circular before the first
// server exists.
function javaInstallRoots() {
  if (process.platform === "win32") {
    const bases = [
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.ProgramW6432,
    ].filter(Boolean);
    const vendors = [
      "Java",
      "Eclipse Adoptium",
      "Eclipse Foundation",
      "Microsoft",
      "Amazon Corretto",
      "Zulu",
      "BellSoft",
      "AdoptOpenJDK",
    ];
    return bases.flatMap((base) =>
      vendors.map((vendor) => path.join(base, vendor)),
    );
  }
  if (process.platform === "darwin") {
    return ["/Library/Java/JavaVirtualMachines"];
  }
  return ["/usr/lib/jvm", "/usr/java", "/opt/java"];
}

// Every entry of PATH that actually holds a java executable. This is the source
// a user means when they say "I already installed Java".
function pathJavaCandidates() {
  const executableName = javaExecutableName();
  const candidates = [];
  for (const entry of String(process.env.PATH || "").split(path.delimiter)) {
    const dir = entry.trim().replace(/^"|"$/g, "");
    if (!dir) continue;
    const target = path.join(dir, executableName);
    if (fs.existsSync(target))
      candidates.push({ path: target, source: "PATH" });
  }
  return candidates;
}

function installedJavaCandidates(failures) {
  const executableName = javaExecutableName();
  // macOS buries the executable one level deeper than every other platform.
  const binSuffixes =
    process.platform === "darwin"
      ? [path.join("Contents", "Home", "bin"), "bin"]
      : ["bin"];
  const candidates = [];

  for (const root of javaInstallRoots()) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (error) {
      // A vendor directory that does not exist is the normal case and says
      // nothing. Anything else (permissions, an unreadable mount) is reported
      // instead of swallowed, so a machine that hides its JDKs says why.
      if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
      failures.push(
        javaScanFailure(
          root,
          "Installed on this machine",
          codedError("JAVA_INSTALL_DIR_UNREADABLE", error.message, {
            detail: error.message,
          }),
        ),
      );
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      for (const suffix of binSuffixes) {
        const target = path.join(root, entry.name, suffix, executableName);
        if (fs.existsSync(target)) {
          candidates.push({
            path: target,
            source: "Installed on this machine",
          });
        }
      }
    }
  }
  return candidates;
}

function managedJavaCandidates(db) {
  const root = path.join(appDataDirFor(db), "runtimes", "temurin");
  if (!fs.existsSync(root)) return [];
  const executableName = javaExecutableName();
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
        candidates.push({
          path: target,
          source: "Managed by MC Server Manager",
        });
      }
    }
  }
  return candidates;
}

function listJavaRuntimes(db) {
  const profiles = listServerProfiles(db);
  const failures = [];
  // Only the executable this platform can actually run. Offering both java and
  // java.exe meant every Windows machine with JAVA_HOME set reported a
  // permanent "Java executable does not exist" failure next to a working Java.
  const javaHomeCandidate = process.env.JAVA_HOME
    ? [
        {
          path: path.join(process.env.JAVA_HOME, "bin", javaExecutableName()),
          source: "JAVA_HOME",
        },
      ]
    : [];
  const candidates = [
    ...javaHomeCandidate,
    ...profiles
      .map((profile) => profile.javaPath)
      .filter(Boolean)
      .map((javaPath) => ({ path: javaPath, source: "Server profile" })),
    ...pathJavaCandidates(),
    ...installedJavaCandidates(failures),
    ...managedJavaCandidates(db),
  ];
  // The order above is the order of preference, so the first source to claim a
  // path keeps the label. A Map built from the list would keep the last.
  const seen = new Map();
  for (const candidate of candidates) {
    const key = normalizeJavaPath(candidate.path);
    if (!seen.has(key)) seen.set(key, candidate);
  }
  const uniqueCandidates = [...seen.values()];
  const runtimes = [];
  /* Whether this app installed a runtime is decided by where it lives, not by
     which source claimed the row: a managed runtime a server points at is
     labelled "Server profile", because that source is listed first. Only these
     may be removed from inside the app. */
  const managedRoot = normalizeJavaPath(
    path.join(appDataDirFor(db), "runtimes", "temurin"),
  );

  for (const candidate of uniqueCandidates) {
    try {
      const runtime = inspectJavaRuntime(candidate);
      runtime.managed = normalizeJavaPath(runtime.path).startsWith(
        `${managedRoot}${path.sep}`,
      );
      runtimes.push(runtime);
    } catch (error) {
      failures.push(javaScanFailure(candidate.path, candidate.source, error));
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
  const configured = contextFor(db).dependencies.runtimeDependencies;
  return createRuntimeManager({
    userDataDir: appDataDirFor(db),
    platform: configured.platform,
    arch: configured.arch,
    fetchJson:
      configured.fetchJson ||
      /* Without its own code this falls back to MARKETPLACE_REQUEST_FAILED,
         which tells a user installing Java that the marketplace is down. */
      ((url) =>
        fetchJson(
          url,
          {},
          "Temurin runtime lookup failed",
          "JAVA_METADATA_REQUEST_FAILED",
        )),
    download: configured.download,
    extractArchive: configured.extractArchive,
    inspectJava: configured.inspectJava,
  });
}

async function planJavaRuntime(db, input) {
  const majorVersion = Number(input?.majorVersion);
  // The scan reads the host machine, so a test that pins platform and arch is
  // still answered by whatever Java the runner happens to have installed. This
  // seam lets such a test state the machine it is describing; production always
  // takes the real scan.
  const configured = contextFor(db).dependencies.runtimeDependencies;
  const installedRuntimes = configured.scanInstalledRuntimes
    ? configured.scanInstalledRuntimes()
    : listJavaRuntimes(db).runtimes;
  return runtimeManagerFor(db).plan({
    majorVersion,
    /* Null means "no ceiling established". Absent would read the same but is
       easy to drop by accident, so the caller states it. */
    maxMajorVersion:
      input?.maxMajorVersion === undefined || input?.maxMajorVersion === null
        ? null
        : Number(input.maxMajorVersion),
    installedRuntimes,
  });
}

async function installJavaRuntime(db, input) {
  if (input?.consent !== true) {
    throw provisioningError(
      "JAVA_CONSENT_REQUIRED",
      "You must confirm the Temurin license and managed download before installation.",
    );
  }
  /* The re-plan exists so a renderer-supplied plan cannot pick the URL or the
     target. It must also not widen the version window: without a ceiling, a
     request to install Java 8 for a legacy server would come back as "reuse the
     Java 11 already on this machine" and hand the caller the very runtime the
     original plan rejected. Installing major N means major N. */
  const canonicalPlan = await planJavaRuntime(db, {
    majorVersion: input?.plan?.majorVersion,
    maxMajorVersion: input?.plan?.majorVersion,
  });
  const runtime = await runtimeManagerFor(db).install(canonicalPlan, {
    consent: true,
  });
  return runtime;
}

async function removeJavaRuntime(db, input) {
  const javaPath = String(input?.path || "");
  if (!javaPath) {
    throw provisioningError(
      "JAVA_PATH_REQUIRED",
      "A Java runtime path is required.",
    );
  }
  /* A runtime a server is pointed at is not spare capacity. Removing it leaves
     that server unable to start, and the next thing the operator would see is a
     launch failure rather than the deletion that caused it. The servers are
     named so the refusal says what to repoint first. */
  const target = normalizeJavaPath(javaPath);
  const inUse = listServerProfiles(db)
    .filter(
      (profile) =>
        profile.javaPath && normalizeJavaPath(profile.javaPath) === target,
    )
    .map((profile) => profile.name);
  if (inUse.length > 0) {
    throw provisioningError(
      "JAVA_RUNTIME_IN_USE",
      `This Java runtime is still used by ${inUse.join(", ")}. Point those servers at another runtime first.`,
      { detail: inUse.join(", ") },
    );
  }
  return runtimeManagerFor(db).remove(javaPath);
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
  const javaCompatibility =
    listJavaRuntimes(db).compatibility.find(
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
  throw codedError(
    "INVALID_LAUNCH_SPECIFICATION",
    `Invalid launch specification: ${message}`,
  );
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
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
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
    if (index > 0 && spec.jvmArgs[index - 1] === "-jar")
      referencedFile = argument;
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
    throw codedError(
      "SERVER_JAR_MISSING",
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

function checkPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.once("error", (error) => {
      if (error?.code === "EADDRINUSE" || error?.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    });
    probe.listen({ host: "0.0.0.0", port, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

const DEFAULT_SERVER_PORT = 25565;
// One Minecraft port per server, so a handful of neighbours is plenty; stopping
// rather than scanning to 65535 keeps a hostile environment from stalling the
// wizard while it probes thousands of sockets.
const PORT_SUGGESTION_RANGE = 64;

// The wizard used to offer 25565 unconditionally, so a second server was created
// on a port the first already owned and the collision only surfaced at start.
async function suggestServerPort(db) {
  const takenPorts = new Set(
    db
      .prepare(`SELECT server_port FROM servers WHERE server_port IS NOT NULL`)
      .all()
      .map((row) => Number(row.server_port)),
  );
  const isPortFree = contextFor(db).dependencies.portChecker;

  for (
    let port = DEFAULT_SERVER_PORT;
    port < DEFAULT_SERVER_PORT + PORT_SUGGESTION_RANGE && port <= 65535;
    port += 1
  ) {
    if (takenPorts.has(port)) continue;
    if (await isPortFree(port)) {
      return { port, taken: [...takenPorts].sort((a, b) => a - b) };
    }
  }

  // Every candidate was busy. Returning the default with the occupied list is
  // honest: the user still gets a value and can see why it is not a free one.
  return {
    port: DEFAULT_SERVER_PORT,
    taken: [...takenPorts].sort((a, b) => a - b),
  };
}

async function assertServerPortAvailable(db, profile) {
  const port = Number(profile.serverPort || DEFAULT_SERVER_PORT);
  const conflictingProfile = db
    .prepare(
      `SELECT s.name
       FROM servers s
       JOIN managed_processes p ON p.server_id = s.id
       WHERE s.id <> ? AND s.server_port = ?
         AND p.status IN ('running', 'external_running')
       ORDER BY p.started_at DESC
       LIMIT 1`,
    )
    .get(profile.id, port);
  if (conflictingProfile) {
    throw provisioningError(
      "SERVER_PORT_IN_USE",
      `Port ${port} is already used by the running server ${conflictingProfile.name}.`,
    );
  }
  const available = await contextFor(db).dependencies.portChecker(port);
  if (!available) {
    throw provisioningError(
      "SERVER_PORT_IN_USE",
      `Port ${port} is already in use. Stop the other service or choose a different server port.`,
    );
  }
}

/* Checked at start, not only at creation: a profile can be repointed at another
   runtime from settings, and one created before this check existed still holds
   whatever it was given. The probe runs only for versions with an established
   ceiling — above 1.16 there is nothing to verify and nothing to pay for. */
function assertLaunchJavaSupported(db, profile, executable) {
  if (maxJavaMajorForMinecraft(profile.minecraftVersion) === null) return;
  // Same seam as the runtime scan: a test can state the machine it describes
  // instead of depending on whichever Java the runner has. Production probes.
  // The seam takes a path, matching how the runtime manager already calls it.
  const inspect = contextFor(db).dependencies.runtimeDependencies.inspectJava;
  const inspected = inspect
    ? inspect(executable)
    : inspectJavaRuntime({ path: executable, source: "Server profile" });
  assertJavaMajorInWindow(
    profile.minecraftVersion,
    inspected.majorVersion,
    executable,
  );
  /* Only the legacy window is probed, and 32-bit builds only still exist down
     there, so this is the branch where the heap ceiling is worth stating. The
     JVM's own refusal is "Could not reserve enough space for object heap",
     which reads as a machine-memory problem rather than a 32-bit one. */
  if (!runtimeFitsHeap(inspected.architecture, profile.maxMemoryMb)) {
    throw codedError(
      "JAVA_ARCHITECTURE_TOO_SMALL",
      `This 32-bit Java cannot reserve the ${profile.maxMemoryMb} MB configured for this server. Use a 64-bit Java or lower the maximum memory. Configured runtime: ${executable}`,
      { detail: String(executable || "") },
    );
  }
}

async function startServer(db, serverId, options = {}) {
  const id = requireServerId(serverId);
  if (
    contextFor(db).runtimeState.mutatingServerDirs?.has(id) ||
    contextFor(db).runtimeState.backingUpServers?.has(id)
  )
    throw codedError(
      "SERVER_FILES_BUSY",
      "server files are being restored or upgraded",
    );
  const startingServers = contextFor(db).runtimeState.startingServers;
  if (startingServers.has(id) || managedChildren.has(id)) {
    throw provisioningError(
      "SERVER_ALREADY_RUNNING",
      "This server is already starting or running.",
    );
  }
  startingServers.add(id);
  try {
    return await startReservedServer(db, id, options);
  } finally {
    startingServers.delete(id);
  }
}

async function startReservedServer(db, serverId, options = {}) {
  const profile = getServerProfile(db, requireServerId(serverId));
  if (!options.autoRestart) {
    clearRestartState(profile.id);
  }
  const launch = profile.launchSpec
    ? structuredServerLaunch(profile)
    : legacyServerLaunch(profile);
  assertLaunchJavaSupported(db, profile, launch.executable);
  await assertServerPortAvailable(db, profile);
  if (closedDatabases.has(db)) {
    throw provisioningError(
      "SERVER_START_CANCELLED",
      "The application closed before the server could start.",
    );
  }
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
    metricTimer: null,
    stopRequested: false,
    onlinePlayers: new Set(),
  };
  managedChildren.set(profile.id, managed);
  managed.metricTimer = setInterval(() => {
    void sampleServerMetrics(db, profile.id).catch(() => {
      // A transient metrics failure must never interrupt the managed server.
    });
  }, 5_000);
  managed.metricTimer.unref?.();
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
    clearInterval(managed.metricTimer);
    contextFor(db).runtimeState.metricBaselines.delete(child.pid);
    managedChildren.delete(profile.id);
    if (closedDatabases.has(db)) {
      return;
    }
    const crashed =
      !managed.stopRequested && (managed.crashDetected || code !== 0);
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
        managed.crashDetected
          ? "crash signature"
          : `exit code ${code ?? "unknown"}`,
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

// Killing a Minecraft server is not the same as stopping it: the world only
// reaches disk when the server handles its own `stop`. Quitting used to
// terminate every child outright, which throws away whatever was still in
// memory. Ask each server to stop, wait, and only force the issue after that.
const DEFAULT_SHUTDOWN_GRACE_MS = 30_000;

function shutdownGraceMs() {
  const override = Number(process.env.MCSM_SHUTDOWN_GRACE_MS);
  return Number.isFinite(override) && override >= 0
    ? override
    : DEFAULT_SHUTDOWN_GRACE_MS;
}

function stopManagedChildGracefully(serverId, managed, graceMs) {
  clearRestartState(serverId);
  clearRestartCountdown(serverId);
  clearInterval(managed.metricTimer);
  managed.stopRequested = true;
  return new Promise((resolve) => {
    // A live child reports null for both; a finished one reports a number or a
    // signal name. Anything else means the child never ran, and waiting on an
    // exit event that will not arrive would burn the whole grace period.
    if (
      typeof managed.child.exitCode === "number" ||
      typeof managed.child.signalCode === "string"
    ) {
      resolve();
      return;
    }
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      managed.child.removeListener("exit", onExit);
      // The server ignored `stop` for the whole grace period, so a hung process
      // is now the bigger risk than the unsaved chunks.
      managed.child.kill();
      resolve();
    }, graceMs);
    timer.unref?.();
    managed.child.once("exit", onExit);
    try {
      managed.child.stdin?.write("stop\n");
    } catch {
      // A closed stdin means the process is already on its way out; the exit
      // listener above still settles this wait.
    }
  });
}

async function stopManagedChildrenGracefully(db, options = {}) {
  const graceMs = Number.isFinite(options.graceMs)
    ? options.graceMs
    : shutdownGraceMs();
  const owned = [...managedChildren.entries()].filter(
    ([, managed]) => managed.db === db,
  );
  await Promise.all(
    owned.map(([serverId, managed]) =>
      stopManagedChildGracefully(serverId, managed, graceMs),
    ),
  );
}

function sendServerCommand(db, serverId, command) {
  const id = requireServerId(serverId);
  const value = trimRequired(command, "server command is required");
  const managed = managedChildren.get(id);
  if (!managed) {
    throw codedError("SERVER_NOT_RUNNING", "server process is not running");
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
  const values =
    Array.isArray(steps) && steps.length > 0 ? steps : [300, 60, 10];
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
  return serverFiles.listFiles(
    (relative) => safeServerPath(db, serverId, relative),
    relativePath,
  );
}

function readServerTextFile(db, serverId, relativePath) {
  return serverFiles.readText(
    (relative) => safeServerPath(db, serverId, relative),
    relativePath,
  );
}

function writeServerTextFile(
  db,
  serverId,
  relativePath,
  content,
  expectedRevision,
) {
  assertServerFilesAvailable(db, serverId);
  return serverFiles.writeText(
    (relative) => safeServerPath(db, serverId, relative),
    relativePath,
    content,
    expectedRevision,
  );
}

async function mutateServerFiles(db, input) {
  const serverId = requireServerId(input?.serverId);
  return withServerFiles(
    db,
    serverId,
    () =>
      serverFiles.mutateFiles(
        (relative) => safeServerPath(db, serverId, relative),
        input,
      ),
    false,
  );
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
  assertServerFilesAvailable(db, serverId);
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
    throw codedError(
      "SERVER_PORT_OUT_OF_RANGE",
      "server port must be between 1 and 65535",
    );
  }
  const fileExisted = fs.existsSync(filePath);
  const currentRaw = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : "";
  const merged = mergeProperties(currentRaw, requestedEntries);
  fs.writeFileSync(filePath, merged.raw, "utf8");
  try {
    if (portEntry) {
      db.prepare(
        "UPDATE servers SET server_port = ?, updated_at = ? WHERE id = ?",
      ).run(nextPort, nowIso(), serverId);
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
    mode: row.kind === "world" ? "worldOnly" : row.kind,
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

function requireStoppedServer(db, serverId) {
  const managed = managedChildren.get(serverId);
  const persisted = db
    .prepare(
      "SELECT 1 FROM managed_processes WHERE server_id = ? AND status IN ('running', 'external_running') LIMIT 1",
    )
    .get(serverId);
  if (
    managed?.db === db ||
    persisted ||
    contextFor(db).runtimeState.startingServers.has(serverId)
  ) {
    throw codedError(
      "SERVER_MUST_BE_STOPPED",
      "Stop the server before modifying its stored runtime or world.",
    );
  }
}

async function flushWorldForBackup(db, serverId) {
  const managed = managedChildren.get(serverId);
  if (!managed || managed.db !== db) {
    requireStoppedServer(db, serverId);
    return false;
  }
  const child = managed.child;
  let finish;
  const saved = new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer = (buffer + chunk.toString()).slice(-8192);
      if (
        /(?:^|\n)[^\n]*INFO(?:\]:|\])?:?\s+(?:Saved the game|Saved the world|Saved all (?:chunks|dimensions)|All dimensions are saved)[.!]?\r?(?:\n|$)/i.test(
          buffer,
        )
      )
        finish();
    };
    const onExit = () =>
      finish(
        codedError(
          "BACKUP_SAVE_FAILED",
          "server stopped before confirming its save",
        ),
      );
    const timeout = setTimeout(
      () =>
        finish(
          codedError(
            "BACKUP_SAVE_TIMEOUT",
            "server did not confirm save-all flush within 30 seconds",
          ),
        ),
      30_000,
    );
    finish = (error) => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
      error ? reject(error) : resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });
  try {
    sendServerCommand(db, serverId, "save-off");
    sendServerCommand(db, serverId, "save-all flush");
  } catch (error) {
    finish(error);
  }
  try {
    await saved;
  } catch (error) {
    if (managedChildren.get(serverId) === managed)
      sendServerCommand(db, serverId, "save-on");
    throw error;
  }
  return true;
}

async function createBackupRecord(
  db,
  serverId,
  backupProfile = null,
  operation = null,
) {
  const profile = getServerProfile(db, requireServerId(serverId));
  const state = contextFor(db).runtimeState;
  state.backingUpServers ||= new Set();
  if (
    state.backingUpServers.has(profile.id) ||
    state.activeContentOperations?.has(profile.id) ||
    (state.mutatingServerDirs?.has(profile.id) &&
      state.mutatingServerDirs.get(profile.id) !== operation)
  )
    throw codedError("BACKUP_IN_PROGRESS", "a backup is already in progress");
  const id = randomUUID();
  const createdAt = nowIso();
  const root = safeServerPath(db, profile.id, ".").root;
  const backupRoot = safeServerPath(db, profile.id, `backups/${id}`).target;
  const worldName =
    readPropertiesFile(path.join(root, "server.properties"))["level-name"] ||
    "world";
  const mode = backupProfile ? modeFromDb(backupProfile.mode) : "worldOnly";
  let includes = backupProfile
    ? JSON.parse(backupProfile.include_paths || "[]")
    : [];
  if (["worldOnly", "worldPlusConfigs"].includes(mode))
    includes = [
      worldName,
      `${worldName}_nether`,
      `${worldName}_the_end`,
    ].filter((relative) =>
      fs.existsSync(safeServerPath(db, profile.id, relative).target),
    );
  const excludes = backupProfile
    ? JSON.parse(backupProfile.exclude_paths || "[]")
    : [];
  if (mode === "worldPlusConfigs") {
    includes.push(
      ...fs
        .readdirSync(root, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() &&
            /\.(properties|json|ya?ml|toml|conf|cfg|txt)$/i.test(entry.name),
        )
        .map((entry) => entry.name),
    );
    includes.push(
      ...["config", "defaultconfigs", "plugins"].filter((relative) =>
        fs.existsSync(safeServerPath(db, profile.id, relative).target),
      ),
    );
    excludes.push("plugins/*.jar", "plugins/*.jar.disabled");
  }
  let savingDisabled = false,
    recorded = false;
  state.backingUpServers.add(profile.id);
  try {
    for (const relative of includes) safeServerPath(db, profile.id, relative);
    savingDisabled = await flushWorldForBackup(db, profile.id);
    const manifest = await backupFiles.writeSnapshot({
      root,
      archive: backupRoot,
      mode,
      includes,
      excludes,
      worldName,
      serverState:
        mode === "fullServer"
          ? {
              minecraftVersion: profile.minecraftVersion,
              loaderType: profile.loaderType,
              loaderVersion: profile.loaderVersion,
              launchSpec: profile.launchSpec,
              javaPath: profile.javaPath,
              installedContent: db
                .prepare("SELECT * FROM installed_content WHERE server_id = ?")
                .all(profile.id),
              contentPolicies: db
                .prepare(
                  "SELECT * FROM content_update_policies WHERE server_id = ?",
                )
                .all(profile.id),
            }
          : null,
    });
    const sizeBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
    db.prepare(
      `INSERT INTO backups (id, server_id, profile_id, kind, archive_path, world_name, size_bytes, status, created_at, manifest_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
    ).run(
      id,
      profile.id,
      backupProfile?.id || null,
      mode === "worldOnly" ? "world" : mode,
      backupRoot,
      worldName,
      sizeBytes,
      createdAt,
      createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
    );
    recorded = true;
    if (backupProfile?.id)
      await pruneBackupProfileRecords(db, backupProfile.id);
    return mapBackup(db.prepare("SELECT * FROM backups WHERE id = ?").get(id));
  } catch (error) {
    if (!recorded) await removeTree(backupRoot);
    throw error;
  } finally {
    state.backingUpServers.delete(profile.id);
    if (savingDisabled && managedChildren.get(profile.id)?.db === db)
      sendServerCommand(db, profile.id, "save-on");
  }
}

async function createWorldBackup(db, input) {
  return createBackupRecord(db, input?.serverId);
}

async function deleteServerBackup(db, backupId) {
  const id = trimRequired(backupId, "backup id is required");
  const backup = db.prepare("SELECT * FROM backups WHERE id = ?").get(id);
  if (!backup) {
    throw codedError("BACKUP_NOT_FOUND", "backup not found");
  }
  await removeTree(backup.archive_path);
  db.prepare("DELETE FROM backups WHERE id = ?").run(id);
  return null;
}

async function exportServerBackup(db, input) {
  const id = trimRequired(input?.backupId, "backup id is required");
  const destinationRoot = path.resolve(
    trimRequired(input?.targetDir, "target directory is required"),
  );
  const backup = db.prepare("SELECT * FROM backups WHERE id = ?").get(id);
  if (!backup) {
    throw codedError("BACKUP_NOT_FOUND", "backup not found");
  }
  if (!fs.existsSync(backup.archive_path)) {
    throw codedError(
      "BACKUP_ARCHIVE_FOLDER_MISSING",
      "backup archive folder does not exist",
    );
  }
  fs.mkdirSync(destinationRoot, { recursive: true });
  const exportedPath = path.join(
    destinationRoot,
    safeFilename(
      `${backup.world_name}-${backup.created_at.slice(0, 19)}-${backup.id}`,
      `backup-${backup.id}`,
    ),
  );
  await copyTree(backup.archive_path, exportedPath);
  return { exportedPath };
}

async function pruneBackupProfileRecords(db, profileId) {
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
    await deleteServerBackup(db, backup.id);
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

function validateBackupProfile(input) {
  if (
    !["worldOnly", "worldPlusConfigs", "fullServer", "custom"].includes(
      input?.mode || "worldOnly",
    )
  )
    throw codedError(
      "BACKUP_PROFILE_MODE_INVALID",
      "unsupported backup profile mode",
    );
  for (const relative of [
    ...(input?.includePaths || []),
    ...(input?.excludePaths || []),
  ])
    backupFiles.relativePath(relative);
  if (input?.mode === "custom" && !input.includePaths?.length)
    throw codedError(
      "BACKUP_EMPTY",
      "select at least one path for a custom backup",
    );
  if (
    input?.retentionCount != null &&
    (!Number.isInteger(input.retentionCount) || input.retentionCount < 1)
  )
    throw codedError(
      "BACKUP_RETENTION_INVALID",
      "backup retention count must be a positive integer",
    );
}

function createBackupProfile(db, input) {
  validateBackupProfile(input);
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
  validateBackupProfile(input);
  const id = trimRequired(
    input?.id || input?.profileId,
    "backup profile id is required",
  );
  const existing = db
    .prepare("SELECT * FROM backup_profiles WHERE id = ?")
    .get(id);
  if (!existing) {
    throw codedError("BACKUP_PROFILE_NOT_FOUND", "backup profile not found");
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
    throw codedError("BACKUP_PROFILE_NOT_FOUND", "backup profile not found");
  }
  if (
    db
      .prepare("SELECT 1 FROM scheduled_tasks WHERE backup_profile_id = ?")
      .get(id)
  )
    throw codedError(
      "BACKUP_PROFILE_IN_USE",
      "a scheduled task still uses this backup profile",
    );
  db.prepare("DELETE FROM backup_profiles WHERE id = ?").run(id);
  return null;
}

async function createProfileBackup(db, input) {
  const profile = db
    .prepare("SELECT * FROM backup_profiles WHERE id = ?")
    .get(input?.profileId);
  if (!profile)
    throw codedError("BACKUP_PROFILE_NOT_FOUND", "backup profile not found");
  return createBackupRecord(db, profile.server_id, profile);
}

async function backupRestorePlan(db, input) {
  const backup = db
    .prepare("SELECT * FROM backups WHERE id = ?")
    .get(input?.backupId);
  if (!backup || (input?.serverId && backup.server_id !== input.serverId))
    throw codedError("BACKUP_NOT_FOUND", "backup not found");
  const manifest = await backupFiles.verifiedSnapshot(
    backup.archive_path,
    backup.manifest_sha256,
  );
  const remap = backupFiles.restorePaths(manifest, input?.targetWorldDir);
  for (const relative of manifest.includes)
    safeServerPath(db, backup.server_id, remap(relative));
  return { backup, manifest, remap };
}

async function previewBackupRestore(db, input) {
  const { backup, manifest, remap } = await backupRestorePlan(db, input);
  return {
    backupId: backup.id,
    serverId: backup.server_id,
    mode: manifest.mode,
    relativePaths: backupFiles
      .restoreScope(serverRoot(db, backup.server_id), manifest)
      .map(remap),
    fileCount: manifest.files.length,
    sizeBytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
    warnings: [],
  };
}

function restoreBackupDatabaseState(db, serverId, root, manifest) {
  if (manifest.mode !== "fullServer" || !manifest.serverState) return;
  const state = manifest.serverState;
  db.prepare(
    "UPDATE servers SET minecraft_version = ?, loader_type = ?, loader_version = ?, java_path = ?, launch_spec_json = ?, updated_at = ? WHERE id = ?",
  ).run(
    state.minecraftVersion,
    dbLoader(state.loaderType),
    state.loaderVersion,
    state.javaPath,
    state.launchSpec ? JSON.stringify(state.launchSpec) : null,
    nowIso(),
    serverId,
  );
  const relativeContentPath = (installedPath) =>
    path
      .relative(root, resolveThroughLinks(path.resolve(installedPath)))
      .replace(/\\/g, "/");
  const covered = (installedPath) =>
    !backupFiles.excluded(
      relativeContentPath(installedPath),
      manifest.excludes,
    );
  for (const row of db
    .prepare("SELECT * FROM installed_content WHERE server_id = ?")
    .all(serverId)) {
    if (covered(row.installed_path))
      db.prepare("DELETE FROM installed_content WHERE id = ?").run(row.id);
  }
  const savedFiles = new Set(manifest.files.map((file) => file.path));
  const insert = db.prepare(
    "INSERT INTO installed_content (id,server_id,content_id,name,version,loader,environment,source_path,installed_path,sha256,warnings_json,installed_at,mod_id,metadata_scanned_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  for (const row of state.installedContent) {
    if (
      covered(row.installed_path) &&
      savedFiles.has(relativeContentPath(row.installed_path))
    )
      insert.run(
        row.id,
        serverId,
        row.content_id,
        row.name,
        row.version,
        row.loader,
        row.environment,
        row.source_path,
        row.installed_path,
        row.sha256,
        row.warnings_json,
        row.installed_at,
        row.mod_id,
        row.metadata_scanned_at,
      );
  }
  db.prepare("DELETE FROM content_update_policies WHERE server_id = ?").run(
    serverId,
  );
  const policyInsert = db.prepare(
    "INSERT INTO content_update_policies (id,server_id,content_id,content_key,policy,pinned_version,ignored_update,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  for (const row of state.contentPolicies)
    policyInsert.run(
      row.id,
      serverId,
      row.content_id,
      row.content_key,
      row.policy,
      row.pinned_version,
      row.ignored_update,
      row.updated_at,
    );
}

async function restoreWorldBackup(db, input) {
  if (!input?.confirm)
    throw codedError(
      "RESTORE_NEEDS_CONFIRMATION",
      "restore requires explicit confirmation",
    );
  const { backup, manifest } = await backupRestorePlan(db, input);
  requireStoppedServer(db, backup.server_id);
  await withServerFiles(db, backup.server_id, () =>
    backupFiles.restoreSnapshot({
      root: safeServerPath(db, backup.server_id, ".").root,
      archive: backup.archive_path,
      manifest,
      resolve: (relative) => safeServerPath(db, backup.server_id, relative),
      targetWorldDir: input?.targetWorldDir,
      commit: () => {
        db.exec("BEGIN");
        try {
          restoreBackupDatabaseState(
            db,
            backup.server_id,
            safeServerPath(db, backup.server_id, ".").root,
            manifest,
          );
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    }),
  );
  return null;
}

function listPlayers(db, serverId) {
  const id = requireServerId(serverId);
  const lists = readPlayerLists(db, id).lists;
  const managed = managedChildren.get(id);
  const names = new Set();
  const identities = new Map();
  for (const doc of lists) {
    for (const entry of doc.entries) {
      if (entry.name) {
        names.add(entry.name);
        if (entry.uuid) identities.set(entry.name.toLowerCase(), entry.uuid);
      }
    }
  }
  const userCachePath = path.join(serverRoot(db, id), "usercache.json");
  try {
    const cachedPlayers = fs.existsSync(userCachePath)
      ? JSON.parse(fs.readFileSync(userCachePath, "utf8"))
      : [];
    for (const entry of Array.isArray(cachedPlayers) ? cachedPlayers : []) {
      if (entry?.name) {
        names.add(entry.name);
        if (entry.uuid) identities.set(entry.name.toLowerCase(), entry.uuid);
      }
    }
  } catch {
    // Invalid usercache data must not hide the editable player lists.
  }
  for (const name of managed?.onlinePlayers ?? []) {
    names.add(name);
  }
  const bannedIps =
    lists.find((doc) => doc.listType === "bannedIps")?.entries ?? [];
  const whitelistEnabled =
    readServerProperties(db, id).entries.find(
      (entry) => entry.key === "white-list",
    )?.value === "true";
  return {
    serverId: id,
    whitelistEnabled,
    players: [
      ...[...names].sort().map((username) => ({
        username,
        uuid: identities.get(username.toLowerCase()) || null,
        kind: "player",
        online: managed?.onlinePlayers.has(username) || false,
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
      ...bannedIps
        .filter((entry) => entry.ip)
        .map((entry) => ({
          username: entry.ip,
          uuid: null,
          kind: "ip",
          online: false,
          operator: false,
          whitelisted: false,
          banned: true,
          firstSeen: null,
          lastSeen: null,
        })),
    ],
    actionsAvailable: true,
    unavailableReason: null,
  };
}

function playerIdentity(db, serverId, player, explicitUuid) {
  if (explicitUuid) return explicitUuid;
  const state = listPlayers(db, serverId);
  return (
    state.players.find(
      (entry) =>
        entry.kind !== "ip" &&
        entry.username.toLowerCase() === player.toLowerCase(),
    )?.uuid || null
  );
}

function applyPlayerChange(db, input) {
  const serverId = requireServerId(input?.serverId);
  const player = trimRequired(input?.player, "player name is required");
  const action = input?.action;
  const managed = managedChildren.get(serverId);
  const actionCommands = {
    op: `op ${player}`,
    deop: `deop ${player}`,
    ban: `ban ${player}`,
    pardon: `pardon ${player}`,
    kick: `kick ${player}`,
    whitelistAdd: `whitelist add ${player}`,
    whitelistRemove: `whitelist remove ${player}`,
    banIp: `ban-ip ${player}`,
    pardonIp: `pardon-ip ${player}`,
  };
  const command = actionCommands[action];
  if (!command) {
    throw codedError("UNSUPPORTED_PLAYER_ACTION", "unsupported player action");
  }
  if (managed?.db === db) {
    sendServerCommand(db, serverId, command);
    return { method: "command", commandSent: command };
  }
  if (action === "kick") {
    throw codedError(
      "START_SERVER_BEFORE_KICK",
      "Start the server before kicking an online player.",
    );
  }

  const listByAction = {
    op: ["ops", true],
    deop: ["ops", false],
    whitelistAdd: ["whitelist", true],
    whitelistRemove: ["whitelist", false],
    ban: ["bannedPlayers", true],
    pardon: ["bannedPlayers", false],
    banIp: ["bannedIps", true],
    pardonIp: ["bannedIps", false],
  };
  const [listType, shouldAdd] = listByAction[action] || [];
  if (!listType) {
    throw codedError(
      "UNSUPPORTED_OFFLINE_PLAYER_ACTION",
      "unsupported offline player action",
    );
  }
  const list = readPlayerLists(db, serverId).lists.find(
    (entry) => entry.listType === listType,
  );
  if (!list || list.error) {
    throw codedError(
      "PLAYER_LIST_UNAVAILABLE",
      list?.error || "player list is unavailable",
    );
  }
  const identityField = listType === "bannedIps" ? "ip" : "name";
  const matchesPlayer = (entry) =>
    String(entry[identityField] || "").toLowerCase() === player.toLowerCase();
  let entries = list.entries.filter((entry) => !matchesPlayer(entry));
  if (shouldAdd) {
    if (listType === "bannedIps") {
      entries.push({
        ip: player,
        created: nowIso(),
        source: "MC Server Manager",
        expires: "forever",
        reason: input?.reason || "Banned by an operator.",
      });
    } else {
      const uuid = playerIdentity(db, serverId, player, input?.uuid);
      if (!uuid) {
        throw codedError(
          "PLAYER_UUID_UNKNOWN",
          "The player's UUID is unknown. Start the server once so Minecraft can cache it.",
        );
      }
      const base = { uuid, name: player };
      entries.push(
        listType === "ops"
          ? { ...base, level: 4, bypassesPlayerLimit: false }
          : listType === "bannedPlayers"
            ? {
                ...base,
                created: nowIso(),
                source: "MC Server Manager",
                expires: "forever",
                reason: input?.reason || "Banned by an operator.",
              }
            : base,
      );
    }
  }
  savePlayerList(db, { serverId, listType, entries });
  addProcessEvent(
    db,
    serverId,
    "info",
    `Player access updated: ${action} ${player}.`,
  );
  return { method: "file", listType };
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
    throw codedError("UNKNOWN_PLAYER_LIST_TYPE", "unknown player list type");
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
    provider: parseInstalledContentProvider(row.content_id)?.provider || null,
    projectId: parseInstalledContentProvider(row.content_id)?.projectId || null,
    versionId: parseInstalledContentProvider(row.content_id)?.versionId || null,
    /* What the jar calls itself, read from its own descriptor. Distinct from
       contentId, which records where it was downloaded from. */
    modId: row.mod_id ?? null,
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

async function listInstalledContent(db, serverId) {
  const id = requireServerId(serverId);
  await adoptContentOnDisk(db, id);
  return db
    .prepare(
      "SELECT * FROM installed_content WHERE server_id = ? ORDER BY installed_at DESC",
    )
    .all(id)
    .map(mapInstalledContent);
}

/* The install commands are not the only way content reaches a server. A modpack
   arrives as one archive and is extracted whole, and people drop jars into
   mods/ through the file manager or Explorer. Those files run on the server but
   had no row here, so the content view was empty for exactly the servers with
   the most content in them. The directory is the truth; the table is an index
   of it, so reading the list reconciles the two first. Everything downstream —
   enable, disable, uninstall — already works off the row, so adoption is all
   that is needed to make those files manageable. */
async function adoptContentOnDisk(db, serverId) {
  const profile = getServerProfile(db, serverId);
  const targetDir = safeServerPath(
    db,
    serverId,
    contentTargetDir(profile),
  ).target;
  if (!fs.existsSync(targetDir)) return;
  const onDisk = fs
    .readdirSync(targetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.jar(\.disabled)?$/i.test(name))
    .map((name) => path.join(targetDir, name));

  const rows = db
    .prepare(
      "SELECT id, installed_path FROM installed_content WHERE server_id = ?",
    )
    .all(serverId);
  const known = new Set(
    rows.map((row) => resolveThroughLinks(path.resolve(row.installed_path))),
  );

  for (const filePath of onDisk) {
    if (known.has(path.resolve(filePath))) continue;
    const stats = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    db.prepare(
      `INSERT INTO installed_content
        (id, server_id, content_id, name, version, loader, environment, source_path,
         installed_path, sha256, warnings_json, installed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      serverId,
      null,
      fileName.replace(/\.disabled$/i, ""),
      null,
      profile.loaderType,
      null,
      filePath,
      filePath,
      await sha256File(filePath),
      "[]",
      stats.mtime.toISOString(),
    );
  }

  /* A row whose file is gone is a stale index entry, and every action it offers
     would fail. Only rows inside the directory just read are dropped, so a row
     pointing somewhere unreadable is left alone rather than silently discarded. */
  const resolvedDir = path.resolve(targetDir);
  for (const row of rows) {
    const resolved = resolveThroughLinks(path.resolve(row.installed_path));
    if (path.dirname(resolved) !== resolvedDir) continue;
    if (fs.existsSync(resolved)) continue;
    db.prepare("DELETE FROM installed_content WHERE id = ?").run(row.id);
  }

  await fillContentMetadata(db, serverId);
}

/* A jar carries its own id and version; the file name is only a guess at them.
   Adopted files were stored with both left null, so a mods folder full of
   working mods read as a column of "Unknown" — including the four the operator
   had just installed. Read once and recorded, because the answer does not
   change while the file does not. */
async function fillContentMetadata(db, serverId) {
  const pending = db
    .prepare(
      `SELECT id, installed_path FROM installed_content
       WHERE server_id = ? AND metadata_scanned_at IS NULL`,
    )
    .all(serverId);
  if (pending.length === 0) return;
  const scannedAt = new Date().toISOString();
  const update = db.prepare(
    `UPDATE installed_content
        SET mod_id = COALESCE(mod_id, ?),
            version = COALESCE(version, ?),
            metadata_scanned_at = ?
      WHERE id = ?`,
  );
  for (const row of pending) {
    if (!fs.existsSync(row.installed_path)) continue;
    const metadata = await readModMetadata(row.installed_path);
    /* The scan is marked done either way. A jar with no descriptor is a fact
       about that jar, not a reason to reopen it on every page load. */
    update.run(metadata.modId, metadata.version, scannedAt, row.id);
  }
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
  const safeName = safeFilename(filename);
  const disabledSuffix = safeName.endsWith(".jar.disabled") ? ".disabled" : "";
  const parsed = path.parse(
    disabledSuffix ? safeName.slice(0, -disabledSuffix.length) : safeName,
  );
  let candidate = path.join(
    targetDir,
    `${parsed.name}${parsed.ext}${disabledSuffix}`,
  );
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(
      targetDir,
      `${parsed.name}-${suffix}${parsed.ext}${disabledSuffix}`,
    );
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

// fetch() rejects with a bare TypeError whose message is "fetch failed" when
// the request never reaches the server: offline, DNS failure, a blocking proxy,
// a TLS error. That error carries no mcsmCode, so it used to arrive in the UI
// as the untranslated English string "fetch failed" with no way to act on it.
// The underlying cause code (ENOTFOUND, ECONNREFUSED, ...) is the diagnostic
// worth keeping, so it becomes the detail the locale entry interpolates.
async function fetchOrNetworkError(url, init, context) {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error?.mcsmCode) throw error;
    const cause = error?.cause?.code || error?.code || error?.name;
    /* A timeout is not the same failure as an unreachable host, and saying so
       matters: a request that never returns leaves whatever asked for it
       waiting on a spinner with nothing to act on. */
    if (error?.name === "TimeoutError") {
      throw codedError("NETWORK_TIMEOUT", `${context}: timed out`);
    }
    throw codedError(
      "NETWORK_UNREACHABLE",
      `${context}: ${cause ? `${cause} ` : ""}${error?.message || error}`,
    );
  }
}

/* Metadata lookups only — never the file downloads, which legitimately run
   long. Without a bound, a connection that opens and then stalls (a blocking
   proxy, a filtered route) hangs forever, and the Java install dialog sat on
   "Finding a build…" with no error and no way forward. */
const METADATA_REQUEST_TIMEOUT_MS = 20_000;

async function fetchJson(
  url,
  options = {},
  message = "Marketplace request failed",
  code = "MARKETPLACE_REQUEST_FAILED",
) {
  const response = await fetchOrNetworkError(
    url,
    {
      signal: AbortSignal.timeout(METADATA_REQUEST_TIMEOUT_MS),
      ...options,
      headers: requestHeaders({
        Accept: "application/json",
        ...(options.headers || {}),
      }),
    },
    message,
  );
  if (!response.ok) {
    throw codedError(code, `${message}: ${response.status}`);
  }
  return response.json();
}

async function fetchText(
  url,
  options = {},
  message = "Remote metadata request failed",
  code = "REMOTE_METADATA_REQUEST_FAILED",
) {
  const response = await fetchOrNetworkError(
    url,
    {
      signal: AbortSignal.timeout(METADATA_REQUEST_TIMEOUT_MS),
      ...options,
      headers: requestHeaders({
        Accept: "text/plain, application/xml, text/xml",
        ...(options.headers || {}),
      }),
    },
    message,
  );
  if (!response.ok) {
    throw codedError(code, `${message}: ${response.status}`);
  }
  return response.text();
}

async function downloadRemoteFile(
  url,
  targetPath,
  headers = {},
  validateFinalUrl = null,
) {
  const response = await fetchOrNetworkError(
    url,
    {
      headers: requestHeaders(headers),
      redirect: "follow",
    },
    "Download failed",
  );
  if (!response.ok) {
    // A bare status code is undiagnosable: the URL is what identifies which
    // artifact and which version segment the upstream API rejected.
    let detail = "";
    try {
      detail = (await response.text()).trim().slice(0, 300);
    } catch {
      detail = "";
    }
    throw Object.assign(
      new Error(
        `file download failed: ${response.status} ${response.statusText} for ${url}${
          detail ? ` -- ${detail}` : ""
        }`,
      ),
      { code: "FILE_DOWNLOAD_FAILED", status: response.status, url },
    );
  }
  if (typeof validateFinalUrl === "function") {
    validateFinalUrl(response.url || url);
  }
  const body = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(targetPath, body);
}

async function existingMarketplaceContent(db, serverId, contentId) {
  const parsed = parseInstalledContentProvider(contentId);
  if (!parsed) return null;
  const row = db
    .prepare("SELECT * FROM installed_content WHERE server_id = ?")
    .all(serverId)
    .find((item) => {
      const source = parseInstalledContentProvider(item.content_id);
      return (
        source?.provider === parsed.provider &&
        source.projectId === parsed.projectId
      );
    });
  if (row && row.content_id !== contentId)
    throw codedError(
      "CONTENT_PROJECT_ALREADY_INSTALLED",
      "another version of this project is installed; use the content update action",
    );
  if (row && !fs.existsSync(row.installed_path))
    throw codedError(
      "CONTENT_SOURCE_FILE_MISSING",
      "installed project file is missing; rescan installed content before reinstalling",
    );
  if (row && (await sha256File(row.installed_path)) !== row.sha256)
    throw codedError(
      "CONTENT_CHANGED_ON_DISK",
      "the installed project file differs from its recorded checksum",
    );
  return row ? mapInstalledContent(row) : null;
}

function recordInstalledContent(db, profile, input, targetPath, checksum) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO installed_content (id, server_id, content_id, name, version, loader, environment, source_path, installed_path, sha256, warnings_json, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    profile.id,
    input.contentId ?? null,
    input.name || path.basename(targetPath),
    input.version ?? null,
    profile.loaderType,
    input.environment ?? null,
    input.sourcePath || input.downloadUrl,
    targetPath,
    checksum,
    JSON.stringify(input.warnings || []),
    nowIso(),
  );
  return mapInstalledContent(
    db.prepare("SELECT * FROM installed_content WHERE id = ?").get(id),
  );
}

async function installRemoteContent(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  const existing = await existingMarketplaceContent(
    db,
    profile.id,
    input.contentId,
  );
  if (existing) return existing;
  const downloadUrl = trimRequired(
    input?.downloadUrl,
    "download URL is required",
  );
  const warnings = input.versionMetadata
    ? contentVersions.checkCompatibility(
        input.versionMetadata,
        profile,
        input.installAnyway,
      )
    : [];
  const targetDir = safeServerPath(
    db,
    profile.id,
    contentTargetDir(profile),
  ).target;
  fs.mkdirSync(targetDir, { recursive: true });
  const staged = path.join(targetDir, `.mcsm-download-${randomUUID()}`);
  let targetPath;
  try {
    await downloadRemoteFile(
      validateProvisioningUrl(
        downloadUrl,
        parseInstalledContentProvider(input.contentId)?.provider,
      ),
      staged,
      {},
      (url) =>
        validateProvisioningUrl(
          url,
          parseInstalledContentProvider(input.contentId)?.provider,
        ),
    );
    verifyProvisioningHashes(staged, input.hashes || {});
    const checksum = await sha256File(staged);
    const duplicate = await existingMarketplaceContent(
      db,
      profile.id,
      input.contentId,
    );
    if (duplicate) return duplicate;
    targetPath = uniqueTargetPath(
      targetDir,
      input.fileName || path.basename(new URL(downloadUrl).pathname),
    );
    fs.renameSync(staged, targetPath);
    return recordInstalledContent(
      db,
      profile,
      { ...input, warnings: [...(input.warnings || []), ...warnings] },
      targetPath,
      checksum,
    );
  } catch (error) {
    if (targetPath) fs.rmSync(targetPath, { force: true });
    throw error;
  } finally {
    fs.rmSync(staged, { force: true });
  }
}

async function importLocalContent(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  const sourcePath = trimRequired(
    input?.sourcePath || input?.filePath,
    "content source path is required",
  );
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile())
    throw codedError(
      "CONTENT_SOURCE_FILE_MISSING",
      "content source file does not exist",
    );
  const targetDir = safeServerPath(
    db,
    profile.id,
    contentTargetDir(profile),
  ).target;
  fs.mkdirSync(targetDir, { recursive: true });
  const staged = path.join(targetDir, `.mcsm-import-${randomUUID()}`);
  let targetPath;
  try {
    await fs.promises.copyFile(sourcePath, staged, fs.constants.COPYFILE_EXCL);
    const checksum = await sha256File(staged);
    const duplicate = db
      .prepare(
        "SELECT * FROM installed_content WHERE server_id = ? AND sha256 = ?",
      )
      .get(profile.id, checksum);
    if (
      duplicate &&
      fs.existsSync(duplicate.installed_path) &&
      (await sha256File(duplicate.installed_path)) === checksum
    )
      return mapInstalledContent(duplicate);
    targetPath = uniqueTargetPath(targetDir, path.basename(sourcePath));
    fs.renameSync(staged, targetPath);
    return recordInstalledContent(
      db,
      profile,
      { ...input, sourcePath },
      targetPath,
      checksum,
    );
  } catch (error) {
    if (targetPath) fs.rmSync(targetPath, { force: true });
    throw error;
  } finally {
    fs.rmSync(staged, { force: true });
  }
}

function disableInstalledContent(db, input) {
  const content = db
    .prepare("SELECT * FROM installed_content WHERE id = ? AND server_id = ?")
    .get(input?.contentId, input?.serverId);
  if (!content)
    throw codedError(
      "INSTALLED_CONTENT_NOT_FOUND",
      "installed content not found",
    );
  if (content.installed_path.endsWith(".disabled")) {
    return mapInstalledContent(content);
  }
  const disabledPath = `${content.installed_path}.disabled`;
  if (fs.existsSync(disabledPath)) {
    throw codedError(
      "DISABLED_CONTENT_TARGET_EXISTS",
      "disabled content target already exists",
    );
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
  if (!content)
    throw codedError(
      "INSTALLED_CONTENT_NOT_FOUND",
      "installed content not found",
    );
  if (!content.installed_path.endsWith(".disabled")) {
    return mapInstalledContent(content);
  }
  const enabledPath = content.installed_path.slice(0, -".disabled".length);
  if (fs.existsSync(enabledPath)) {
    throw codedError(
      "ENABLED_CONTENT_TARGET_EXISTS",
      "enabled content target already exists",
    );
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
  if (!content)
    throw codedError(
      "INSTALLED_CONTENT_NOT_FOUND",
      "installed content not found",
    );
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
  return contentVersions.compatibilityWarnings(version, profile).length === 0;
}

function firstCompatibleVersion(
  versions,
  profile,
  currentVersionId,
  currentVersion,
) {
  return contentVersions.newestCompatibleVersion(
    versions,
    profile,
    currentVersionId,
    currentVersion,
  );
}

function contentUpdateAllowed(db, content, update = null) {
  const policy = db
    .prepare(
      "SELECT * FROM content_update_policies WHERE server_id = ? AND content_key IN (?, ?, '__server__') ORDER BY CASE WHEN content_key = '__server__' THEN 1 ELSE 0 END LIMIT 1",
    )
    .get(content.server_id, content.content_id || content.id, content.id);
  if (policy?.policy === "pin_current") return false;
  if (policy?.policy === "ignore_update")
    return (
      policy.ignored_update &&
      update &&
      ![update.versionId, update.latestVersion].includes(policy.ignored_update)
    );
  return true;
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
  if (!contentUpdateAllowed(db, content, { versionId: "", latestVersion: "" }))
    return null;
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
      content.version,
    );
    if (!latest) return null;
    const file = contentUpdateFile(latest);
    if (!file?.url) {
      return { warning: `${content.name} has no downloadable Modrinth file.` };
    }
    return {
      installedContentId: content.id,
      provider: "modrinth",
      versionMetadata: latest,
      projectId: parsed.projectId,
      versionId: latest.id,
      currentVersion: content.version,
      latestVersion: latest.versionNumber,
      name: content.name,
      fileName: file.filename,
      downloadUrl: file.url,
      nextContentId: `modrinth:${parsed.projectId}:${latest.id}`,
      warnings: latest.warnings || [],
      hashes: file?.hashes || {},
    };
  }

  if (parsed.provider === "hangar") {
    const latest = firstCompatibleVersion(
      await listHangarVersions({ projectId: parsed.projectId }),
      profile,
      parsed.versionId,
      content.version,
    );
    if (!latest) return null;
    const file = contentUpdateFile(latest);
    return {
      installedContentId: content.id,
      provider: "hangar",
      versionMetadata: latest,
      projectId: parsed.projectId,
      versionId: latest.id,
      currentVersion: content.version,
      latestVersion: latest.versionNumber,
      name: content.name,
      fileName: file.filename,
      downloadUrl: file.url,
      hashes: file.hashes,
      nextContentId: `hangar:${parsed.projectId}:${latest.id}`,
      warnings: latest.warnings || [],
    };
  }

  if (parsed.provider === "curseforge") {
    const latest = firstCompatibleVersion(
      await listCurseForgeFiles({ modId: parsed.projectId }),
      profile,
      parsed.versionId,
      content.version,
    );
    if (!latest) return null;
    const file = latest.files?.[0];
    return {
      installedContentId: content.id,
      provider: "curseforge",
      versionMetadata: latest,
      projectId: parsed.projectId,
      versionId: latest.id,
      currentVersion: content.version,
      latestVersion: latest.versionNumber,
      name: content.name,
      fileName: file?.filename || `${parsed.projectId}-${latest.id}.jar`,
      downloadUrl: await curseForgeDownloadUrl(parsed.projectId, latest.id),
      nextContentId: `curseforge:${parsed.projectId}:${latest.id}`,
      warnings: latest.warnings || [],
      hashes: file?.hashes || {},
    };
  }

  if (parsed.provider === "bbsmc") {
    const latest = firstCompatibleVersion(
      await listBbsmcVersions({ projectId: parsed.projectId }),
      profile,
      parsed.versionId,
      content.version,
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
      versionMetadata: latest,
      projectId: parsed.projectId,
      versionId: latest.id,
      currentVersion: content.version,
      latestVersion: latest.versionNumber,
      name: content.name,
      fileName: file.filename,
      downloadUrl: file.url,
      nextContentId: `bbsmc:${parsed.projectId}:${latest.id}`,
      warnings: latest.warnings || [],
      hashes: file?.hashes || {},
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
    if (contentUpdateAllowed(db, row, result)) updates.push(result);
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
  if (!contentUpdateAllowed(db, content, update))
    throw codedError(
      "CONTENT_UPDATE_BLOCKED_BY_POLICY",
      "this update is blocked by the content update policy",
    );
  return installMarketplaceVersion(
    db,
    { serverId: content.server_id },
    update.provider,
    update.versionMetadata,
    () => replaceContentVersion(db, content, update),
  );
}

async function replaceContentVersion(db, content, update) {
  const targetDir = path.dirname(content.installed_path);
  fs.mkdirSync(targetDir, { recursive: true });
  const staged = path.join(targetDir, `.mcsm-update-${randomUUID()}`);
  let backupPath = null,
    targetPath = null,
    moved = false,
    installed = false;
  try {
    await downloadRemoteFile(
      validateProvisioningUrl(update.downloadUrl, update.provider),
      staged,
      {},
      (url) => validateProvisioningUrl(url, update.provider),
    );
    verifyProvisioningHashes(staged, update.hashes || {});
    const checksum = await sha256File(staged);
    const current = db
      .prepare("SELECT * FROM installed_content WHERE id = ?")
      .get(content.id);
    if (
      !current ||
      current.content_id !== content.content_id ||
      current.installed_path !== content.installed_path ||
      (await sha256File(content.installed_path)) !== content.sha256
    )
      throw codedError(
        "CONTENT_CHANGED_ON_DISK",
        "installed content changed while its update was being prepared",
      );
    if (!contentUpdateAllowed(db, content, update))
      throw codedError(
        "CONTENT_UPDATE_BLOCKED_BY_POLICY",
        "this update is blocked by the content update policy",
      );
    const disabled = content.installed_path.endsWith(".disabled");
    targetPath = uniqueTargetPath(
      targetDir,
      `${safeFilename(update.fileName)}${disabled ? ".disabled" : ""}`,
    );
    backupPath = uniqueBackupPath(content.installed_path);
    const now = nowIso();
    db.exec("BEGIN");
    try {
      fs.renameSync(content.installed_path, backupPath);
      moved = true;
      fs.renameSync(staged, targetPath);
      installed = true;
      db.prepare(
        `UPDATE installed_content SET content_id = ?, version = ?, source_path = ?, installed_path = ?, sha256 = ?, warnings_json = ?, installed_at = ?, mod_id = NULL, metadata_scanned_at = NULL WHERE id = ?`,
      ).run(
        update.nextContentId,
        update.latestVersion,
        update.downloadUrl,
        targetPath,
        checksum,
        JSON.stringify(update.warnings || []),
        now,
        content.id,
      );
      const after = db
        .prepare("SELECT * FROM installed_content WHERE id = ?")
        .get(content.id);
      db.prepare(
        "INSERT INTO content_update_history (id, server_id, installed_content_id, before_json, after_json, backup_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'installed', ?)",
      ).run(
        randomUUID(),
        content.server_id,
        content.id,
        JSON.stringify(content),
        JSON.stringify(after),
        backupPath,
        now,
      );
      db.prepare(
        "UPDATE content_update_policies SET content_id = ?, content_key = ? WHERE server_id = ? AND content_key = ?",
      ).run(
        update.nextContentId,
        update.nextContentId,
        content.server_id,
        content.content_id,
      );
      db.exec("COMMIT");
      return { content: mapInstalledContent(after), backupPath };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    if (installed) fs.rmSync(targetPath, { force: true });
    if (moved) fs.renameSync(backupPath, content.installed_path);
    throw error;
  } finally {
    fs.rmSync(staged, { force: true });
  }
}

async function installContentUpdate(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  const content = db
    .prepare("SELECT * FROM installed_content WHERE id = ? AND server_id = ?")
    .get(input?.installedContentId, profile.id);
  if (!content)
    throw codedError(
      "INSTALLED_CONTENT_NOT_FOUND",
      "installed content not found",
    );
  const update = await resolveContentUpdate(db, profile, content);
  if (!update || update.warning)
    throw codedError(
      "CONTENT_ALREADY_CURRENT",
      update?.warning ||
        "installed content is already current or its updates are disabled by policy",
    );
  return installResolvedContentUpdate(db, content, update);
}

async function installAllContentUpdates(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  const plan = await checkContentUpdates(db, { serverId: profile.id });
  const installed = [];
  for (const update of plan.updates) {
    if (
      Array.isArray(input.installedContentIds) &&
      !input.installedContentIds.includes(update.installedContentId)
    )
      continue;
    const content = db
      .prepare("SELECT * FROM installed_content WHERE id = ? AND server_id = ?")
      .get(update.installedContentId, profile.id);
    if (content)
      installed.push(await installResolvedContentUpdate(db, content, update));
  }
  return { serverId: profile.id, installed, warnings: plan.warnings };
}

function listContentUpdateHistory(db, serverId) {
  return db
    .prepare(
      "SELECT * FROM content_update_history WHERE server_id = ? ORDER BY created_at DESC",
    )
    .all(requireServerId(serverId))
    .map((row) => {
      const before = JSON.parse(row.before_json),
        after = JSON.parse(row.after_json);
      const current = db
        .prepare("SELECT * FROM installed_content WHERE id = ?")
        .get(row.installed_content_id);
      return {
        id: row.id,
        serverId: row.server_id,
        installedContentId: row.installed_content_id,
        name: before.name,
        fromVersion: before.version,
        toVersion: after.version,
        status: row.status,
        backupPath: row.backup_path,
        createdAt: row.created_at,
        rollbackAvailable:
          row.status === "installed" &&
          current?.content_id === after.content_id &&
          current?.sha256 === after.sha256 &&
          fs.existsSync(current.installed_path) &&
          fs.existsSync(row.backup_path),
      };
    });
}

async function rollbackContentUpdate(db, input) {
  if (!input?.confirm)
    throw codedError(
      "RESTORE_NEEDS_CONFIRMATION",
      "restore requires explicit confirmation",
    );
  const history = db
    .prepare(
      "SELECT * FROM content_update_history WHERE id = ? AND server_id = ? AND status = 'installed'",
    )
    .get(input.historyId, requireServerId(input.serverId));
  if (!history)
    throw codedError(
      "CONTENT_UPDATE_HISTORY_NOT_FOUND",
      "content update history is unavailable",
    );
  const before = JSON.parse(history.before_json),
    after = JSON.parse(history.after_json);
  const current = db
    .prepare("SELECT * FROM installed_content WHERE id = ?")
    .get(history.installed_content_id);
  if (
    !current ||
    current.content_id !== after.content_id ||
    current.sha256 !== after.sha256 ||
    !fs.existsSync(history.backup_path) ||
    (await sha256File(history.backup_path)) !== before.sha256 ||
    !fs.existsSync(current.installed_path) ||
    (await sha256File(current.installed_path)) !== after.sha256
  )
    throw codedError(
      "CONTENT_CHANGED_ON_DISK",
      "content or its recovery copy changed after the update",
    );
  const disabled = current.installed_path.endsWith(".disabled");
  const restoredPath =
    before.installed_path.replace(/\.disabled$/, "") +
    (disabled ? ".disabled" : "");
  if (restoredPath !== current.installed_path && fs.existsSync(restoredPath))
    throw codedError(
      "FILE_TARGET_EXISTS",
      "rollback destination already exists",
    );
  const replaced = `${current.installed_path}.mcsm-rollback-${randomUUID()}`;
  let moved = false,
    installed = false;
  db.exec("BEGIN");
  try {
    fs.renameSync(current.installed_path, replaced);
    moved = true;
    fs.renameSync(history.backup_path, restoredPath);
    installed = true;
    db.prepare(
      "UPDATE installed_content SET content_id = ?, version = ?, source_path = ?, installed_path = ?, sha256 = ?, warnings_json = ?, installed_at = ?, mod_id = ?, metadata_scanned_at = ? WHERE id = ?",
    ).run(
      before.content_id,
      before.version,
      before.source_path,
      restoredPath,
      before.sha256,
      before.warnings_json,
      before.installed_at,
      before.mod_id,
      before.metadata_scanned_at,
      before.id,
    );
    db.prepare(
      "UPDATE content_update_policies SET content_id = ?, content_key = ? WHERE server_id = ? AND content_key = ?",
    ).run(
      before.content_id,
      before.content_id,
      before.server_id,
      after.content_id,
    );
    db.prepare(
      "UPDATE content_update_history SET status = 'rolled_back' WHERE id = ?",
    ).run(history.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (installed) fs.renameSync(restoredPath, history.backup_path);
    if (moved) fs.renameSync(replaced, current.installed_path);
    throw error;
  }
  fs.rmSync(replaced, { force: true });
  return {
    content: mapInstalledContent(
      db.prepare("SELECT * FROM installed_content WHERE id = ?").get(before.id),
    ),
    backupPath: null,
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
    throw codedError("TUNNEL_PROVIDER_NOT_FOUND", "tunnel provider not found");
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
    throw codedError(
      "UNSUPPORTED_TUNNEL_PROVIDER_TYPE",
      `unsupported tunnel provider type: ${kind}`,
    );
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
      throw codedError(
        "TUNNEL_APPLICATION_PATH_MISSING",
        "tunnel application path does not exist",
      );
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
      ...taskSchedule.fromRow(row),
      backupProfileId: row.backup_profile_id,
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

function validateTask(db, input, serverId) {
  const normalized = taskSchedule.schedule(input);
  if (
    ![
      "start",
      "stop",
      "restart",
      "world_backup",
      "command",
      "server_update_check",
      "content_update_check",
    ].includes(input.kind)
  )
    throw codedError(
      "UNSUPPORTED_SCHEDULED_TASK_KIND",
      "unsupported scheduled task kind",
    );
  if (input.kind === "command")
    trimRequired(input.command, "server command is required");
  if (
    input.backupProfileId &&
    !db
      .prepare("SELECT 1 FROM backup_profiles WHERE id = ? AND server_id = ?")
      .get(input.backupProfileId, serverId)
  )
    throw codedError(
      "BACKUP_PROFILE_NOT_FOUND",
      "backup profile does not belong to this server",
    );
  return normalized;
}

function createScheduledTask(db, input) {
  const serverId = requireServerId(input?.serverId);
  const normalized = validateTask(db, input, serverId);
  const id = randomUUID(),
    now = nowIso();
  db.prepare(
    `INSERT INTO scheduled_tasks (id, server_id, name, kind, interval_minutes, schedule_kind, time_of_day, weekdays_json, backup_profile_id, command, enabled, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    serverId,
    trimRequired(input?.name, "task name is required"),
    input.kind,
    normalized.intervalMinutes,
    normalized.scheduleKind,
    normalized.timeOfDay,
    JSON.stringify(normalized.weekdays),
    input.backupProfileId || null,
    input.command || null,
    input.enabled === false ? 0 : 1,
    taskSchedule.nextRun(normalized),
    now,
    now,
  );
  return listScheduledTasks(db, serverId).find((task) => task.id === id);
}

function updateScheduledTask(db, input) {
  const id = trimRequired(
    input?.id || input?.taskId,
    "scheduled task id is required",
  );
  const existing = db
    .prepare("SELECT * FROM scheduled_tasks WHERE id = ?")
    .get(id);
  if (!existing)
    throw codedError("SCHEDULED_TASK_NOT_FOUND", "scheduled task not found");
  const merged = {
    ...taskSchedule.fromRow(existing),
    backupProfileId: existing.backup_profile_id,
    name: existing.name,
    kind: existing.kind,
    command: existing.command,
    enabled: existing.enabled !== 0,
    ...input,
  };
  const normalized = validateTask(db, merged, existing.server_id);
  db.prepare(
    "UPDATE scheduled_tasks SET name = ?, kind = ?, interval_minutes = ?, schedule_kind = ?, time_of_day = ?, weekdays_json = ?, backup_profile_id = ?, command = ?, enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?",
  ).run(
    trimRequired(merged.name, "task name is required"),
    merged.kind,
    normalized.intervalMinutes,
    normalized.scheduleKind,
    normalized.timeOfDay,
    JSON.stringify(normalized.weekdays),
    merged.backupProfileId || null,
    merged.command || null,
    merged.enabled ? 1 : 0,
    taskSchedule.nextRun(normalized),
    nowIso(),
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
    throw codedError("SCHEDULED_TASK_NOT_FOUND", "scheduled task not found");
  }
  db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
  return null;
}

async function runDueScheduledTasks(db) {
  // The 60-second tick is the only thing that runs when no server is up, so it
  // also carries telemetry retention. pruneTelemetry rate-limits itself.
  pruneTelemetry(db);
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
    const nextRunAt = taskSchedule.nextRun(taskSchedule.fromRow(task));
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
      return task.backup_profile_id
        ? createProfileBackup(db, { profileId: task.backup_profile_id })
        : createWorldBackup(db, { serverId: task.server_id });
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
      throw codedError(
        "UNSUPPORTED_SCHEDULED_TASK_KIND",
        `unsupported scheduled task kind: ${task.kind}`,
      );
  }
}

function diskFreeMb(rootDir) {
  try {
    const stats = fs.statfsSync(rootDir);
    return Math.round(
      (Number(stats.bavail) * Number(stats.bsize)) / (1024 * 1024),
    );
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
  const running = ["running", "externalRunning"].includes(
    processStatus?.status,
  );
  const managed = managedChildren.get(profile.id);
  const managedForDatabase = managed?.db === db ? managed : null;
  const processMetrics =
    running && processStatus?.pid
      ? await measuredProcessMetrics(db, processStatus.pid)
      : { cpuPercent: null, memoryMb: null, tps: null };
  const freeDisk = diskFreeMb(profile.rootDir);
  const restartCount = Math.max(
    0,
    Number(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM managed_processes WHERE server_id = ?",
        )
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
    uptimeSeconds:
      running && processStatus?.startedAt
        ? Math.max(
            0,
            Math.floor(
              (Date.now() - new Date(processStatus.startedAt).getTime()) / 1000,
            ),
          )
        : null,
    restartCount,
    playerCount:
      running && managedForDatabase
        ? managedForDatabase.onlinePlayers.size
        : null,
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
  pruneTelemetry(db);
  emitServerEvent(db, {
    serverId: profile.id,
    kind: "metrics",
    payload: sample,
  });
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
      pack: {
        format: "blank",
        name: input?.name || "Minecraft Server",
        versionId: null,
      },
      minecraftVersion: input?.minecraftVersion || null,
      loaderType: input?.loaderType || null,
      loaderVersion: input?.loaderVersion || null,
      requiredJavaMajor: requiredJavaMajorForMinecraft(input?.minecraftVersion),
      maxJavaMajor: maxJavaMajorForMinecraft(input?.minecraftVersion),
      artifacts: [],
      optionalFiles: [],
      archiveLayers: [],
      properties: {},
      warnings: [],
      integrity: { status: "trusted" },
      estimatedBytes: 0,
    };
  } else if (source?.kind === "existingFolder") {
    const rootDir = trimRequired(
      input?.rootDir,
      "existing server folder is required",
    );
    const detected = detectServerVersion(rootDir);
    const hasLegacyJar = fs.existsSync(path.join(rootDir, "server.jar"));
    sourcePlan = {
      source: { ...source, rootDir },
      pack: {
        format: "existing",
        name: path.basename(rootDir),
        versionId: null,
      },
      minecraftVersion: input?.minecraftVersion || detected.minecraftVersion,
      loaderType: input?.loaderType || detected.loaderType || "vanilla",
      loaderVersion: input?.loaderVersion || null,
      requiredJavaMajor: requiredJavaMajorForMinecraft(
        input?.minecraftVersion || detected.minecraftVersion,
      ),
      maxJavaMajor: maxJavaMajorForMinecraft(
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
              message:
                "The existing folder has no legacy server.jar; verify its runtime files before continuing.",
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
    throw codedError(
      "UNSUPPORTED_PROVISIONING_SOURCE",
      `unsupported provisioning source: ${source?.kind || "unknown"}`,
    );
  }

  if (input?.prepareInstall !== true) return sourcePlan;
  const loaderType = input?.loaderType || sourcePlan.loaderType;
  const minecraftVersion =
    input?.minecraftVersion || sourcePlan.minecraftVersion;
  if (!loaderType || !minecraftVersion) {
    return sourcePlan;
  }
  const adapter = loaderRegistry().get(loaderType);
  let loaderVersion = input?.loaderVersion || sourcePlan.loaderVersion;
  if (!loaderVersion) {
    loaderVersion =
      (await adapter.listLoaderVersions(minecraftVersion))[0]?.value || null;
  }
  if (!loaderVersion) {
    throw codedError(
      "LOADER_UNAVAILABLE_FOR_VERSION",
      `No ${loaderType} server loader is available for Minecraft ${minecraftVersion}.`,
    );
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
    maxJavaMajor: maxJavaMajorForMinecraft(minecraftVersion),
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
  /* The plan arrives from the renderer, so the runtime it names is a request,
     not a verdict. Committing it unchecked is how a Forge 1.7.10 profile ended
     up pinned to the Java 11 on this machine's PATH. */
  assertJavaMajorInWindow(
    profile.minecraftVersion,
    plan.javaRuntime?.majorVersion,
    plan.javaRuntime?.path,
  );
  const restartPolicy = profile.restartPolicy || defaultRestartPolicy();
  const source = plan.source || { kind: "blank" };
  const isLocalPack = ["localModpack", "localModpackFile"].includes(
    source.kind,
  );
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
  if (
    !relative ||
    path.posix.isAbsolute(relative) ||
    /^[a-zA-Z]:/.test(relative)
  ) {
    throw codedError(
      "ARTIFACT_PATH_NOT_RELATIVE",
      "provisioning artifact path must be target-relative",
    );
  }
  const target = path.resolve(rootDir, ...relative.split("/"));
  const fromRoot = path.relative(rootDir, target);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(fromRoot)
  ) {
    throw codedError(
      "ARTIFACT_PATH_ESCAPES_STAGING",
      "provisioning artifact path escapes the staging directory",
    );
  }
  return target;
}

function verifyProvisioningHashes(filePath, hashes = {}) {
  for (const [algorithm, expected] of Object.entries(hashes)) {
    const normalized = String(algorithm).toLowerCase().replace("-", "");
    if (!["md5", "sha1", "sha256", "sha512"].includes(normalized)) continue;
    const actual = createHash(normalized)
      .update(fs.readFileSync(filePath))
      .digest("hex");
    if (actual.toLowerCase() !== String(expected).toLowerCase()) {
      throw codedError(
        "ARTIFACT_CHECKSUM_MISMATCH",
        `${algorithm} checksum mismatch`,
      );
    }
  }
}

const PROVISIONING_PROVIDER_HOSTS = Object.freeze({
  modrinth: new Set(["cdn.modrinth.com"]),
  hangar: new Set(["hangar.papermc.io", "hangarcdn.papermc.io"]),
  bbsmc: new Set(["cdn.bbsmc.net"]),
  curseforge: new Set([
    "edge.forgecdn.net",
    "media.forgecdn.net",
    "mediafilez.forgecdn.net",
  ]),
});

function blockedProvisioningUrl(message) {
  return codedError("PROVISIONING_URL_BLOCKED", message);
}

function isPrivateProvisioningIp(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(host);
  if (family === 6) {
    return (
      host === "::" || host === "::1" || /^(?:fc|fd|fe8|fe9|fea|feb)/.test(host)
    );
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
    throw blockedProvisioningUrl(
      "Provisioning downloads require a public HTTPS URL.",
    );
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

async function downloadProvisioningArtifact(
  artifact,
  stagingDir,
  fallbackName,
) {
  let url = artifact.url || artifact.urls?.[0] || null;
  let filename = artifact.filename || artifact.path || fallbackName;
  if (!url && artifact.provider === "curseforge") {
    const file = await getCurseForgeFile(artifact.projectId, artifact.fileId);
    url = await curseForgeDownloadUrl(artifact.projectId, artifact.fileId);
    filename =
      artifact.path ||
      path.join("mods", file.files[0]?.filename || fallbackName);
  }
  if (!url)
    throw codedError(
      "NO_DOWNLOAD_URL_AVAILABLE",
      `No download URL is available for ${fallbackName}.`,
    );
  url = validateProvisioningUrl(url, artifact.provider);
  const target = provisioningTargetPath(stagingDir, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await downloadRemoteFile(url, target, {}, (finalUrl) =>
    validateProvisioningUrl(finalUrl, artifact.provider),
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
    fetchJson: (url) =>
      fetchJson(
        url,
        {},
        "Loader metadata lookup failed",
        "LOADER_METADATA_REQUEST_FAILED",
      ),
    fetchText: (url) =>
      fetchText(
        url,
        {},
        "Loader metadata lookup failed",
        "LOADER_METADATA_REQUEST_FAILED",
      ),
    fileExists: fs.existsSync,
    readDirectory: (directory) => fs.readdirSync(directory),
    download: async (url, target, hashes) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const expectedHost = new URL(url).hostname.toLowerCase();
      await downloadRemoteFile(url, target, {}, (finalUrl) => {
        const validated = validateProvisioningUrl(finalUrl, null);
        if (new URL(validated).hostname.toLowerCase() !== expectedHost) {
          throw blockedProvisioningUrl(
            "Loader download redirected to an unapproved host.",
          );
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
    throw Object.assign(
      new Error(`${label} is invalid for loader installation.`),
      {
        code: "LOADER_VERSION_INVALID",
      },
    );
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
      {
        ...packArtifact,
        filename: path.join(".mcsm-source", packArtifact.filename),
      },
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
    await fs.promises.cp(job.targetDir, job.stagingDir, { recursive: true });
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
        /* Some installers only settle their output names once they have run,
           so the plan that gets validated and launched is the resolved one. */
        const resolvedPlan = adapter.resolveInstalledOutputs
          ? await adapter.resolveInstalledOutputs(installPlan)
          : installPlan;
        const validation = await adapter.validate(resolvedPlan);
        if (!validation.valid) {
          throw Object.assign(
            new Error(
              `Loader installation is incomplete: ${validation.missing.join(", ")}`,
            ),
            { code: "LOADER_INSTALL_INCOMPLETE" },
          );
        }
        const launchSpec = {
          ...resolvedPlan.launchSpec,
          workingDirectory: ".",
          validated: true,
        };
        return {
          plan: {
            ...plan,
            loaderInstallPlan: {
              ...resolvedPlan,
              workingDirectory: ".",
              launchSpec,
            },
            launchSpec,
          },
        };
      },
      committing: ({ job, plan }) => {
        const serverId = createProvisionedProfile(
          db,
          job.id,
          plan,
          job.targetDir,
        );
        return serverId ? { serverId } : null;
      },
      starting: async ({ job, plan }) => {
        if (plan.profile?.autoStart && job.serverId) {
          await startServer(db, job.serverId);
        }
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
    fetchJson: (url) =>
      fetchJson(
        url,
        {},
        "Loader metadata lookup failed",
        "LOADER_METADATA_REQUEST_FAILED",
      ),
    fetchText: (url) =>
      fetchText(
        url,
        {},
        "Loader metadata lookup failed",
        "LOADER_METADATA_REQUEST_FAILED",
      ),
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

function marketplacePage(input) {
  return {
    limit: Math.min(100, Math.max(1, Number.parseInt(input?.limit, 10) || 20)),
    offset: Math.max(0, Number.parseInt(input?.offset, 10) || 0),
  };
}

function marketplaceInput(db, input) {
  return {
    ...input,
    server: input?.serverId
      ? getServerProfile(db, input.serverId)
      : {
          minecraftVersion: input?.minecraftVersion,
          loaderType: input?.loader,
        },
  };
}

function versionForServer(version, input) {
  return {
    ...version,
    warnings: [
      ...(version.warnings || []),
      ...contentVersions.compatibilityWarnings(
        version,
        input?.server || {
          minecraftVersion: input?.minecraftVersion,
          loaderType: input?.loader,
        },
      ),
    ],
  };
}

function marketplaceSortIndex(sort) {
  if (sort === "downloads" || sort === "updated") {
    return sort;
  }
  return "relevance";
}

function marketplaceFacets(projectType, loader, minecraftVersion) {
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
  if (minecraftVersion) facets.push([`versions:${minecraftVersion}`]);
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
  const facets = marketplaceFacets(
    input?.projectType,
    input?.loader,
    input?.minecraftVersion,
  );
  const index = encodeURIComponent(marketplaceSortIndex(input?.sort));
  const data = await fetchJson(
    `https://api.modrinth.com/v2/search?query=${query}&limit=${marketplacePage(input).limit}&offset=${marketplacePage(input).offset}&index=${index}${facets}`,
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
    publishedAt: item.date_published || null,
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
    dependencies: (item.dependencies || []).map((dependency) => ({
      projectId: dependency.project_id || null,
      versionId: dependency.version_id || null,
      dependencyType: dependency.dependency_type || "optional",
    })),
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
  return items
    .map(mapModrinthVersion)
    .map((version) => versionForServer(version, input));
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

async function marketplaceDependencyVersion(provider, dependency, profile) {
  const projectId = dependency.projectId;
  if (dependency.versionId) {
    if (provider === "modrinth")
      return getModrinthVersion(dependency.versionId);
    if (provider === "bbsmc") return getBbsmcVersion(dependency.versionId);
    if (provider === "curseforge")
      return getCurseForgeFile(projectId, dependency.versionId);
  }
  if (!projectId)
    throw codedError(
      "CONTENT_DEPENDENCY_UNAVAILABLE",
      "required dependency has no provider project identifier",
    );
  const versions =
    provider === "modrinth"
      ? await listModrinthVersions({ projectId })
      : provider === "bbsmc"
        ? await listBbsmcVersions({ projectId })
        : provider === "curseforge"
          ? await listCurseForgeFiles({ projectId })
          : await listHangarVersions({ projectId });
  return versions.find((version) => versionMatchesServer(version, profile));
}

async function installMarketplaceVersion(
  db,
  input,
  provider,
  version,
  replaceRoot,
) {
  const profile = getServerProfile(db, requireServerId(input.serverId));
  const created = [],
    visited = new Set();
  async function install(resolved, root = false) {
    if (!resolved)
      throw codedError(
        "CONTENT_DEPENDENCY_UNAVAILABLE",
        "a required dependency has no compatible version",
      );
    contentVersions.checkCompatibility(resolved, profile, input.installAnyway);
    const key = `${provider}:${resolved.projectId}:${resolved.id}`;
    const existing =
      root && replaceRoot
        ? null
        : await existingMarketplaceContent(db, profile.id, key);
    if (existing) {
      if (!root && existing.installedPath.endsWith(".disabled"))
        throw codedError(
          "CONTENT_DEPENDENCY_UNAVAILABLE",
          "a required dependency is disabled",
        );
      return { content: existing, dependencies: [] };
    }
    if (visited.has(key)) return null;
    visited.add(key);
    const file =
      provider === "modrinth"
        ? selectInstallableModrinthFile(resolved)
        : provider === "bbsmc"
          ? selectInstallableBbsmcFile(resolved)
          : resolved.files?.[0];
    if (provider === "bbsmc") ensureBbsmcFileIsDirect(file, resolved);
    if (!file)
      throw codedError(
        "CONTENT_DEPENDENCY_UNAVAILABLE",
        "marketplace version has no downloadable file",
      );
    const dependencies = [];
    for (const dependency of resolved.dependencies || []) {
      if (dependency.dependencyType !== "required") continue;
      if (!dependency.versionId && dependency.projectId) {
        const row = db
          .prepare("SELECT * FROM installed_content WHERE server_id = ?")
          .all(profile.id)
          .find((item) => {
            const source = parseInstalledContentProvider(item.content_id);
            return (
              source?.provider === provider &&
              source.projectId === dependency.projectId
            );
          });
        if (row && fs.existsSync(row.installed_path)) {
          if (
            row.installed_path.endsWith(".disabled") ||
            (await sha256File(row.installed_path)) !== row.sha256
          )
            throw codedError(
              "CONTENT_DEPENDENCY_UNAVAILABLE",
              "a required dependency is disabled or changed on disk",
            );
          dependencies.push({
            content: mapInstalledContent(row),
            dependencies: [],
          });
          continue;
        }
      }
      const dependencyVersion = await marketplaceDependencyVersion(
        provider,
        dependency,
        profile,
      );
      const installed = await install(dependencyVersion);
      if (installed) dependencies.push(installed);
    }
    if (root && replaceRoot) return replaceRoot();
    const downloadUrl =
      provider === "curseforge"
        ? await curseForgeDownloadUrl(resolved.projectId, resolved.id)
        : file.url;
    if (!downloadUrl)
      throw codedError(
        "NO_DOWNLOAD_URL_AVAILABLE",
        "marketplace version has no downloadable file",
      );
    const content = await installRemoteContent(db, {
      serverId: profile.id,
      contentId: key,
      name:
        root && input.name
          ? input.name
          : provider === "hangar"
            ? resolved.projectId.split("/").pop()
            : resolved.name,
      version: resolved.versionNumber,
      downloadUrl,
      fileName: file.filename,
      environment: "server",
      versionMetadata: resolved,
      installAnyway: input.installAnyway,
      hashes: file.hashes,
      warnings: resolved.warnings,
    });
    created.push(content);
    return { content, dependencies };
  }
  try {
    return await install(version, true);
  } catch (error) {
    for (const content of created.reverse())
      uninstallInstalledContent(db, {
        serverId: profile.id,
        contentId: content.id,
      });
    throw error;
  }
}

async function installModrinthVersion(db, input) {
  const version = (await listModrinthVersions(input)).find(
    (item) => item.id === input?.versionId,
  );
  if (!version)
    throw codedError(
      "MODRINTH_VERSION_NOT_FOUND",
      "Modrinth version not found",
    );
  return installMarketplaceVersion(db, input, "modrinth", version);
}

function mapHangarProject(item) {
  const id =
    item.namespace?.owner && item.namespace?.slug
      ? `${item.namespace.owner}/${item.namespace.slug}`
      : String(item.id);
  return {
    id,
    slug: item.namespace?.slug || String(item.id),
    title: item.name,
    description: item.description || "",
    projectType: "plugin",
    loaders: Object.keys(item.supportedPlatforms || {}).map((platform) =>
      platform.toLowerCase(),
    ),
    gameVersions: minecraftVersionLabels(item.supportedPlatforms?.PAPER),
    iconUrl: item.avatarUrl || null,
    gallery: [],
    downloads: item.stats?.downloads || 0,
    follows: item.stats?.stars || 0,
    updatedAt: item.lastUpdated || null,
    body: item.mainPageContent || null,
    websiteUrl: `https://hangar.papermc.io/${id}`,
  };
}

async function searchHangarProjects(input) {
  const page = marketplacePage(input);
  const params = new URLSearchParams({
    query: input?.query || "",
    limit: String(Math.min(25, page.limit)),
    offset: String(page.offset),
    platform: "PAPER",
  });
  if (input?.minecraftVersion) params.set("version", input.minecraftVersion);
  if (["downloads", "updated"].includes(input?.sort))
    params.set("sort", `-${input.sort}`);
  const data = await fetchJson(
    `https://hangar.papermc.io/api/v1/projects?${params}`,
    {},
    "Hangar search failed",
  );
  return (data.result || []).map(mapHangarProject);
}

function encodeHangarProjectId(projectId) {
  return String(projectId || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function getHangarProject(input) {
  const projectId = trimRequired(
    input?.projectId,
    "Hangar project id is required",
  );
  const [item, body] = await Promise.all([
    fetchJson(
      `https://hangar.papermc.io/api/v1/projects/${encodeHangarProjectId(projectId)}`,
      {},
      "Hangar project lookup failed",
    ),
    fetchText(
      `https://hangar.papermc.io/api/v1/pages/main/${encodeHangarProjectId(projectId)}`,
      {},
      "Hangar project page lookup failed",
    ),
  ]);
  return { ...mapHangarProject(item), body };
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
  return (Array.isArray(data) ? data : data.result || []).map((item) => {
    const name = item.name;
    const download = item.downloads?.PAPER;
    const file = download?.fileInfo;
    const projectName = projectId.split("/").pop();
    return versionForServer(
      {
        id: name,
        projectId,
        name,
        versionNumber: name,
        description: item.description || "",
        createdAt: item.createdAt || null,
        publishedAt: item.createdAt || null,
        releaseType: item.channel?.name?.toLowerCase() || "release",
        loaders: Object.keys(item.platformDependencies || {}).map((platform) =>
          platform.toLowerCase(),
        ),
        gameVersions: minecraftVersionLabels(item.platformDependencies?.PAPER),
        files: [
          {
            filename: file?.name || `${projectName}-${name}.jar`,
            size: file?.sizeBytes || 0,
            primary: true,
            url:
              download?.downloadUrl ||
              download?.externalUrl ||
              `https://hangar.papermc.io/api/v1/projects/${encodeHangarProjectId(projectId)}/versions/${encodeURIComponent(name)}/PAPER/download`,
            hashes: file?.sha256Hash ? { sha256: file.sha256Hash } : {},
          },
        ],
        dependencies: (item.pluginDependencies?.PAPER || []).map(
          (dependency) => ({
            projectId: dependency.projectId
              ? String(dependency.projectId)
              : dependency.namespace
                ? `${dependency.namespace.owner}/${dependency.namespace.slug}`
                : null,
            versionId: null,
            dependencyType: dependency.required ? "required" : "optional",
          }),
        ),
        warnings: [],
      },
      input,
    );
  });
}

async function installHangarVersion(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  if (profile.loaderType !== "paper")
    throw codedError(
      "HANGAR_REQUIRES_PAPER",
      "Hangar plugins can only be installed into Paper servers.",
    );
  const projectId = trimRequired(
    input?.projectId,
    "Hangar project id is required",
  );
  const versionName = trimRequired(
    input?.versionName || input?.versionId,
    "Hangar version is required",
  );
  const version = (await listHangarVersions({ projectId })).find(
    (item) => item.id === versionName,
  );
  if (!version)
    throw codedError(
      "CONTENT_VERSION_NOT_FOUND",
      "selected marketplace version was not found",
    );
  return (await installMarketplaceVersion(db, input, "hangar", version))
    .content;
}

function curseForgeApiKey() {
  const key = process.env.CURSEFORGE_API_KEY;
  if (!key) {
    throw codedError(
      "CURSEFORGE_KEY_MISSING",
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
    `https://api.curseforge.com/v1/mods/search?gameId=432&searchFilter=${query}&pageSize=${marketplacePage(input).limit}&index=${marketplacePage(input).offset}${input?.minecraftVersion ? `&gameVersion=${encodeURIComponent(input.minecraftVersion)}` : ""}${classId}${sortField}${modLoaderType}`,
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
    releaseType:
      releaseTypes[item.releaseType] || String(item.releaseType || "unknown"),
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
    publishedAt: item.fileDate || null,
    dependencies: (item.dependencies || []).map((dependency) => ({
      projectId: String(dependency.modId),
      versionId: null,
      dependencyType: dependency.relationType === 3 ? "required" : "optional",
    })),
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
    version.files.find(
      (candidate) => candidate.isServerPack && candidate.primary,
    ) ||
    version.files.find((candidate) => candidate.isServerPack) ||
    version.files.find((candidate) => candidate.primary) ||
    version.files[0];
  if (!file?.url) {
    throw codedError(
      "MODRINTH_VERSION_NO_PACK_FILE",
      `Modrinth version ${version.id} has no downloadable pack file`,
    );
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
    maxJavaMajor: maxJavaMajorForMinecraft(minecraftVersion),
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
  const projectId = trimRequired(
    source.projectId,
    "CurseForge project id is required",
  );
  const selectedId = trimRequired(
    source.versionId,
    "CurseForge file id is required",
  );
  const versions = await listCurseForgeFiles({ projectId });
  const selected = versions.find((version) => version.id === selectedId);
  if (!selected)
    throw codedError("CURSEFORGE_FILE_NOT_FOUND", "CurseForge file not found");
  const targetId = selected.serverPackFileId || selected.id;
  const target =
    versions.find((version) => version.id === targetId) ||
    (await getCurseForgeFile(projectId, targetId));
  const url = await curseForgeDownloadUrl(projectId, target.id);
  if (!url)
    throw codedError(
      "CURSEFORGE_NO_DOWNLOAD_URL",
      "CurseForge did not provide a download URL",
    );
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
    maxJavaMajor: maxJavaMajorForMinecraft(minecraftVersion),
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

async function planBbsmcMarketplacePack(source) {
  const version = await getBbsmcVersion(
    trimRequired(source.versionId, "BBSMC version id is required"),
  );
  const file = selectInstallableBbsmcFile(version);
  ensureBbsmcFileIsDirect(file, version);
  const url = validateProvisioningUrl(file.url, "bbsmc");
  const minecraftVersion = version.gameVersions[0] || null;
  return {
    source,
    pack: {
      format: "bbsmc",
      name: version.name,
      versionId: version.id,
    },
    minecraftVersion,
    loaderType: normalizeMarketplaceLoaderType(version.loaders),
    loaderVersion: null,
    requiredJavaMajor: requiredJavaMajorForMinecraft(minecraftVersion),
    maxJavaMajor: maxJavaMajorForMinecraft(minecraftVersion),
    artifacts: [
      {
        provider: "bbsmc",
        projectId: version.projectId,
        versionId: version.id,
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
    warnings: [
      unverifiedMarketplaceWarning(
        "BBSMC does not identify this archive as a dedicated server pack.",
      ),
    ],
    integrity: { status: "unverified" },
    estimatedBytes: file.size || 0,
  };
}

async function planMarketplacePack(source) {
  const provider = String(source.provider || "").toLowerCase();
  if (provider === "modrinth") return planModrinthMarketplacePack(source);
  if (provider === "curseforge") return planCurseForgeMarketplacePack(source);
  if (provider === "bbsmc") return planBbsmcMarketplacePack(source);
  throw codedError(
    "UNSUPPORTED_MARKETPLACE_PROVIDER",
    `unsupported marketplace provider: ${source.provider || "unknown"}`,
  );
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
  return (data.data || [])
    .map(mapCurseForgeFile)
    .map((version) => versionForServer(version, input));
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
  const version = await getCurseForgeFile(modId, fileId);
  return (await installMarketplaceVersion(db, input, "curseforge", version))
    .content;
}

const BBSMC_API_BASE = "https://api.bbsmc.net/v2";
const MARKETPLACE_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const MARKETPLACE_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function bbsmcUrl(pathname) {
  return `${BBSMC_API_BASE}/${pathname.replace(/^\/+/, "")}`;
}

function marketplaceImageError(message, code) {
  return Object.assign(new Error(message), { code });
}

async function fetchMarketplaceImage(input) {
  const value = trimRequired(input?.url, "Marketplace image URL is required");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw marketplaceImageError(
      "Marketplace image URL is invalid.",
      "MARKETPLACE_IMAGE_URL_BLOCKED",
    );
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hostname.toLowerCase() !== "cdn.bbsmc.net" ||
    !url.pathname.startsWith("/bbsmc/data/")
  ) {
    throw marketplaceImageError(
      "Marketplace image URL is outside the trusted BBSMC CDN path.",
      "MARKETPLACE_IMAGE_URL_BLOCKED",
    );
  }

  const response = await fetchOrNetworkError(
    url,
    {
      headers: { "User-Agent": "MCServerManager/0.1" },
      signal: AbortSignal.timeout(20_000),
    },
    "Marketplace image request failed",
  );
  if (!response.ok) {
    throw marketplaceImageError(
      `BBSMC image request failed (${response.status}).`,
      "MARKETPLACE_IMAGE_FETCH_FAILED",
    );
  }

  const contentType = String(response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!MARKETPLACE_IMAGE_TYPES.has(contentType)) {
    throw marketplaceImageError(
      "BBSMC image response has an unsupported content type.",
      "MARKETPLACE_IMAGE_INVALID_RESPONSE",
    );
  }

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MARKETPLACE_IMAGE_MAX_BYTES) {
    throw marketplaceImageError(
      "BBSMC image exceeds the 12 MiB safety limit.",
      "MARKETPLACE_IMAGE_TOO_LARGE",
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MARKETPLACE_IMAGE_MAX_BYTES) {
    throw marketplaceImageError(
      "BBSMC image exceeds the 12 MiB safety limit.",
      "MARKETPLACE_IMAGE_TOO_LARGE",
    );
  }

  return {
    contentType,
    dataUrl: `data:${contentType};base64,${bytes.toString("base64")}`,
  };
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
    follows: item.follows ?? item.followers ?? 0,
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
  const facets = marketplaceFacets(
    input?.projectType,
    input?.loader,
    input?.minecraftVersion,
  );
  const index = encodeURIComponent(marketplaceSortIndex(input?.sort));
  const data = await fetchJson(
    bbsmcUrl(
      `search?limit=${marketplacePage(input).limit}&offset=${marketplacePage(input).offset}&query=${query}&index=${index}${facets}`,
    ),
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
    publishedAt: item.date_published || null,
    dependencies: (item.dependencies || []).map((dependency) => ({
      projectId: dependency.project_id || null,
      versionId: dependency.version_id || null,
      dependencyType: dependency.dependency_type || "optional",
    })),
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
  return items
    .map(mapBbsmcVersion)
    .map((version) => versionForServer(version, input));
}

async function getBbsmcVersion(versionId) {
  const item = await fetchJson(
    bbsmcUrl(`version/${encodeURIComponent(versionId)}`),
    {},
    "BBSMC version lookup failed",
  );
  return mapBbsmcVersion(item);
}

function isDirectBbsmcFile(file) {
  return Boolean(file?.url && /^https:\/\/cdn\.bbsmc\.net\//i.test(file.url));
}

function selectInstallableBbsmcFile(version) {
  const files = version.files || [];
  return (
    files.find((file) => file.primary && isDirectBbsmcFile(file)) ||
    files.find(isDirectBbsmcFile) ||
    files.find((file) => file.primary && file.url) ||
    files.find((file) => file.url) ||
    null
  );
}

function ensureBbsmcFileIsDirect(file, version) {
  if (isDirectBbsmcFile(file)) {
    return;
  }
  const diskTargets = (version.diskUrls || [])
    .map((item) => `${item.platform || "external"}: ${item.url}`)
    .join(", ");
  throw codedError(
    "BBSMC_NO_DIRECT_DOWNLOAD",
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
  return (await installMarketplaceVersion(db, input, "bbsmc", version)).content;
}

async function importCurseForgeManual(db, input) {
  const content = await importLocalContent(db, {
    serverId: input?.serverId,
    sourcePath: input?.filePath,
    name: input?.name,
    version: input?.version,
  });
  return { content, dependencyResolution: "manual" };
}

function assertServerFilesAvailable(db, serverId) {
  const state = contextFor(db).runtimeState;
  state.mutatingServerDirs ||= new Map();
  if (
    state.mutatingServerDirs.has(serverId) ||
    state.backingUpServers?.has(serverId) ||
    state.activeContentOperations?.has(serverId)
  )
    throw codedError(
      "SERVER_FILES_BUSY",
      "server files are being restored or upgraded",
    );
}

async function withServerFiles(db, serverId, action, stopped = true) {
  if (stopped) requireStoppedServer(db, serverId);
  assertServerFilesAvailable(db, serverId);
  const state = contextFor(db).runtimeState;
  const operation = Symbol("server files operation");
  state.mutatingServerDirs.set(serverId, operation);
  try {
    return await action(operation);
  } finally {
    state.mutatingServerDirs.delete(serverId);
  }
}

async function serverUpdateChecks(db, profile, targetVersion) {
  const checks = [];
  const supported = ["paper", "vanilla"].includes(profile.loaderType);
  checks.push({
    id: "loader",
    status: supported ? "ready" : "blocked",
    message: supported
      ? `${profile.loaderType} supports managed server JAR replacement.`
      : `${profile.loaderType} requires its loader installer; direct JAR replacement is unavailable.`,
  });
  const comparison = contentVersions.compareVersions(
    targetVersion,
    profile.minecraftVersion,
  );
  checks.push({
    id: "version",
    status: comparison !== null && comparison < 0 ? "blocked" : "ready",
    message:
      comparison !== null && comparison < 0
        ? "Minecraft downgrades are not supported because existing worlds may become unreadable."
        : `Target Minecraft ${targetVersion}.`,
  });
  try {
    requireStoppedServer(db, profile.id);
    checks.push({
      id: "stopped",
      status: "ready",
      message: "Server is stopped.",
    });
  } catch (error) {
    checks.push({ id: "stopped", status: "blocked", message: error.message });
  }
  const executable = profile.javaPath || "java";
  try {
    const inspect = contextFor(db).dependencies.runtimeDependencies.inspectJava;
    const runtime = inspect
      ? await inspect(executable)
      : inspectJavaRuntime({ path: executable, source: "Server profile" });
    assertJavaMajorInWindow(targetVersion, runtime.majorVersion, executable);
    if (!runtimeFitsHeap(runtime.architecture, profile.maxMemoryMb))
      throw codedError(
        "JAVA_ARCHITECTURE_TOO_SMALL",
        "configured Java cannot hold the server heap",
      );
    checks.push({
      id: "java",
      status: "ready",
      message: `Java ${runtime.majorVersion} supports Minecraft ${targetVersion}.`,
    });
  } catch (error) {
    checks.push({ id: "java", status: "blocked", message: error.message });
  }
  if (targetVersion !== profile.minecraftVersion) {
    const target = { ...profile, minecraftVersion: targetVersion };
    for (const content of db
      .prepare("SELECT * FROM installed_content WHERE server_id = ?")
      .all(profile.id)) {
      if (content.installed_path.endsWith(".disabled")) continue;
      const source = parseInstalledContentProvider(content.content_id);
      let version;
      try {
        if (source?.provider === "modrinth")
          version = (
            await listModrinthVersions({ projectId: source.projectId })
          ).find((item) => item.id === source.versionId);
        else if (source?.provider === "bbsmc")
          version = await getBbsmcVersion(source.versionId);
        else if (source?.provider === "curseforge")
          version = await getCurseForgeFile(source.projectId, source.versionId);
        else if (source?.provider === "hangar")
          version = (
            await listHangarVersions({ projectId: source.projectId })
          ).find((item) => item.id === source.versionId);
        const warnings = version
          ? contentVersions.compatibilityWarnings(version, target)
          : ["No authoritative compatibility metadata is available."];
        checks.push({
          id: `content:${content.id}`,
          status: warnings.length ? "warning" : "ready",
          message: `${content.name}: ${warnings.join(" ") || "compatible with the target version."}`,
        });
      } catch (error) {
        checks.push({
          id: `content:${content.id}`,
          status: "warning",
          message: `${content.name}: ${error.message}`,
        });
      }
    }
  }
  return checks;
}

async function checkServerUpdate(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  const adapter = loaderRegistry().get(profile.loaderType);
  const versions = (await adapter.listMinecraftVersions())
    .filter((item) => item.stable)
    .sort((a, b) => contentVersions.compareVersions(b.value, a.value) || 0);
  const targetVersion =
    input?.targetMinecraftVersion || input?.targetVersion || versions[0]?.value;
  if (!targetVersion || !versions.some((item) => item.value === targetVersion))
    throw codedError(
      "MINECRAFT_VERSION_METADATA_NOT_FOUND",
      "the target Minecraft version is not available from the loader provider",
    );
  const loaders = (await adapter.listLoaderVersions(targetVersion))
    .filter((item) => item.stable)
    .sort((a, b) => contentVersions.compareVersions(b.value, a.value) || 0);
  const targetLoaderVersion =
    input?.targetLoaderVersion || loaders[0]?.value || null;
  const comparison = contentVersions.compareVersions(
    targetVersion,
    profile.minecraftVersion,
  );
  const loaderComparison = contentVersions.compareVersions(
    targetLoaderVersion,
    profile.loaderVersion,
  );
  const updateAvailable =
    (comparison !== null && comparison > 0) ||
    (targetVersion === profile.minecraftVersion &&
      targetLoaderVersion !== profile.loaderVersion &&
      (loaderComparison === null || loaderComparison > 0));
  const result = {
    serverId: profile.id,
    loaderType: profile.loaderType,
    currentVersion: profile.minecraftVersion,
    targetVersion,
    targetLoaderVersion,
    updateAvailable,
    installSupported: ["paper", "vanilla"].includes(profile.loaderType),
    message: updateAvailable
      ? `${profile.loaderType} ${targetVersion}${targetLoaderVersion ? ` / ${targetLoaderVersion}` : ""} is available.`
      : "The installed server version is current.",
    downloadedJarPath: null,
    downloadedJarSha256: null,
    checks: await serverUpdateChecks(db, profile, targetVersion),
  };
  db.prepare(
    "INSERT INTO server_update_history (id, server_id, loader_type, from_version, to_version, status, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    profile.id,
    profile.loaderType,
    profile.minecraftVersion,
    targetVersion,
    updateAvailable ? "available" : "current",
    result.message,
    nowIso(),
  );
  return result;
}

function serverJarTarget(db, profile) {
  const args = profile.launchSpec?.jvmArgs || [];
  const jarIndex = args.indexOf("-jar");
  if (jarIndex >= 0 && args[jarIndex + 1]) {
    const working = profile.launchSpec.workingDirectory || ".";
    return safeServerPath(
      db,
      profile.id,
      path.join(working, args[jarIndex + 1]),
    ).target;
  }
  const existing = fs.existsSync(path.join(profile.rootDir, "server.jar"))
    ? "server.jar"
    : fs.readdirSync(profile.rootDir).find((name) => /\.jar$/i.test(name));
  return safeServerPath(db, profile.id, existing || "server.jar").target;
}

async function installServerUpdate(db, input) {
  const profile = getServerProfile(db, requireServerId(input?.serverId));
  if (!input?.confirm)
    throw codedError(
      "SERVER_JAR_INSTALL_NEEDS_CONFIRMATION",
      "server jar installation requires explicit confirmation",
    );
  return withServerFiles(db, profile.id, async (operation) => {
    const found = input.serverJarPath
      ? null
      : await checkServerUpdate(db, input);
    const targetVersion =
      input.targetMinecraftVersion ||
      input.targetVersion ||
      found?.targetVersion ||
      profile.minecraftVersion;
    const targetLoaderVersion =
      input.targetLoaderVersion ||
      found?.targetLoaderVersion ||
      profile.loaderVersion;
    const checks =
      found?.checks || (await serverUpdateChecks(db, profile, targetVersion));
    const blocked = checks.filter((check) => check.status === "blocked");
    if (blocked.length)
      throw codedError(
        "SERVER_UPDATE_PREFLIGHT_FAILED",
        blocked.map((check) => check.message).join(" "),
      );
    if (
      checks.some((check) => check.status === "warning") &&
      !input.acknowledgeWarnings
    )
      throw codedError(
        "SERVER_UPDATE_WARNINGS_NEED_CONFIRMATION",
        "review and acknowledge content compatibility warnings before upgrading",
      );
    const targetJar = serverJarTarget(db, profile);
    const staged = `${targetJar}.mcsm-update-${randomUUID()}`;
    let recovery = null,
      replaced = null;
    const id = randomUUID();
    try {
      if (input.serverJarPath) {
        if (!fs.existsSync(input.serverJarPath))
          throw codedError(
            "DOWNLOADED_SERVER_JAR_MISSING",
            "downloaded server jar does not exist",
          );
        await fs.promises.copyFile(input.serverJarPath, staged);
        if (
          input.serverJarSha256 &&
          (await sha256File(staged)) !== input.serverJarSha256.toLowerCase()
        )
          throw codedError(
            "SERVER_JAR_CHECKSUM_MISMATCH",
            "downloaded server jar checksum does not match",
          );
      } else {
        const adapter = loaderRegistry().get(profile.loaderType);
        const plan = await adapter.buildInstallPlan({
          minecraftVersion: targetVersion,
          loaderVersion: targetLoaderVersion,
          workingDirectory: profile.rootDir,
        });
        const artifact = plan.artifacts.find(
          (item) => item.destination === "server.jar",
        );
        if (
          !artifact ||
          !adapter.approvedHosts.includes(new URL(artifact.url).hostname)
        )
          throw codedError(
            "UNAPPROVED_ARTIFACT_HOST",
            "server artifact is not on the approved loader host",
          );
        await downloadRemoteFile(artifact.url, staged, {}, (url) => {
          if (!adapter.approvedHosts.includes(new URL(url).hostname))
            throw codedError(
              "UNAPPROVED_ARTIFACT_HOST",
              "server artifact redirected outside approved loader hosts",
            );
        });
        verifyProvisioningHashes(staged, artifact.hashes);
      }
      await inspectZip(staged);
      const checksum = await sha256File(staged);
      if (fs.existsSync(targetJar)) {
        // Preserve worlds as well as the runtime: switching a JAR alone cannot
        // undo a world-format upgrade after the new Minecraft version starts.
        recovery = await createBackupRecord(
          db,
          profile.id,
          {
            id: null,
            mode: "full_server",
            include_paths: "[]",
            exclude_paths: JSON.stringify([
              path
                .relative(safeServerPath(db, profile.id).root, staged)
                .replace(/\\/g, "/"),
            ]),
          },
          operation,
        );
        replaced = `${targetJar}.mcsm-swap-${randomUUID()}`;
      }
      db.exec("BEGIN");
      let installed = false,
        moved = false;
      try {
        if (replaced) {
          fs.renameSync(targetJar, replaced);
          moved = true;
        }
        fs.renameSync(staged, targetJar);
        installed = true;
        const metadata = {
          before: {
            minecraftVersion: profile.minecraftVersion,
            loaderVersion: profile.loaderVersion,
            launchSpec: profile.launchSpec,
          },
          after: {
            minecraftVersion: targetVersion,
            loaderVersion: targetLoaderVersion,
            sha256: checksum,
            targetJar,
          },
          backupId: recovery?.id || null,
        };
        db.prepare(
          "UPDATE servers SET minecraft_version = ?, loader_version = ?, updated_at = ? WHERE id = ?",
        ).run(targetVersion, targetLoaderVersion, nowIso(), profile.id);
        db.prepare(
          "INSERT INTO server_update_history (id, server_id, loader_type, from_version, to_version, status, message, rollback_path, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, 'installed', ?, ?, ?, ?)",
        ).run(
          id,
          profile.id,
          profile.loaderType,
          profile.minecraftVersion,
          targetVersion,
          `Installed ${profile.loaderType} ${targetVersion}. Recovery restores the full pre-upgrade server snapshot.`,
          recovery?.archivePath || null,
          JSON.stringify(metadata),
          nowIso(),
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        if (installed) fs.rmSync(targetJar, { force: true });
        if (moved) fs.renameSync(replaced, targetJar);
        throw error;
      }
      if (replaced) fs.rmSync(replaced, { force: true });
      return listServerUpdateHistory(db, profile.id).find(
        (item) => item.id === id,
      );
    } finally {
      fs.rmSync(staged, { force: true });
    }
  });
}

function listServerUpdateHistory(db, serverId) {
  const profile = getServerProfile(db, requireServerId(serverId));
  return db
    .prepare(
      "SELECT * FROM server_update_history WHERE server_id = ? ORDER BY created_at DESC",
    )
    .all(profile.id)
    .map((row) => {
      const metadata = JSON.parse(row.metadata_json);
      return {
        id: row.id,
        serverId: row.server_id,
        loaderType: row.loader_type,
        fromVersion: row.from_version,
        toVersion: row.to_version,
        status: row.status,
        message: row.message,
        rollbackPath: row.rollback_path,
        createdAt: row.created_at,
        rollbackAvailable:
          row.status === "installed" &&
          Boolean(metadata.backupId) &&
          profile.minecraftVersion === metadata.after?.minecraftVersion &&
          profile.loaderVersion === metadata.after?.loaderVersion &&
          Boolean(row.rollback_path && fs.existsSync(row.rollback_path)),
      };
    });
}

async function rollbackServerUpdate(db, input) {
  if (!input?.confirm)
    throw codedError(
      "RESTORE_NEEDS_CONFIRMATION",
      "restore requires explicit confirmation",
    );
  const profile = getServerProfile(db, requireServerId(input.serverId));
  return withServerFiles(db, profile.id, async () => {
    const history = db
      .prepare(
        "SELECT * FROM server_update_history WHERE id = ? AND server_id = ? AND status = 'installed'",
      )
      .get(input.historyId, profile.id);
    if (!history)
      throw codedError(
        "SERVER_UPDATE_HISTORY_NOT_FOUND",
        "server update history is unavailable",
      );
    const metadata = JSON.parse(history.metadata_json);
    if (
      !metadata.backupId ||
      profile.minecraftVersion !== metadata.after.minecraftVersion ||
      profile.loaderVersion !== metadata.after.loaderVersion ||
      (await sha256File(metadata.after.targetJar)) !== metadata.after.sha256
    )
      throw codedError(
        "SERVER_UPDATE_ROLLBACK_UNAVAILABLE",
        "server runtime changed after this update; its rollback cannot be applied",
      );
    const { backup, manifest } = await backupRestorePlan(db, {
      serverId: profile.id,
      backupId: metadata.backupId,
    });
    await backupFiles.restoreSnapshot({
      root: safeServerPath(db, profile.id, ".").root,
      archive: backup.archive_path,
      manifest,
      resolve: (relative) => safeServerPath(db, profile.id, relative),
      commit: () => {
        db.exec("BEGIN");
        try {
          restoreBackupDatabaseState(
            db,
            profile.id,
            safeServerPath(db, profile.id, ".").root,
            manifest,
          );
          db.prepare(
            "UPDATE server_update_history SET status = 'rolled_back', message = ? WHERE id = ?",
          ).run(
            "Restored the complete server snapshot from before this upgrade.",
            history.id,
          );
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    });
    return listServerUpdateHistory(db, profile.id).find(
      (item) => item.id === history.id,
    );
  });
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
