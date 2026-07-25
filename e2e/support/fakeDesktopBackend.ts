export interface FakeDesktopCall {
  command: string;
  args: Record<string, unknown> | undefined;
}

export interface FakeDesktopState {
  calls: FakeDesktopCall[];
  processStatus: "running" | "stopped" | "crashed";
  preferences: Record<string, any>;
  files: Record<string, string>;
  backups: Array<Record<string, any>>;
  scheduledTasks: Array<Record<string, any>>;
  playerLists: Record<string, Array<Record<string, any>>>;
}

const now = "2026-07-23T15:00:00.000Z";

function parseServerProperties(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      const key = separator >= 0 ? line.slice(0, separator).trim() : line;
      const value = separator >= 0 ? line.slice(separator + 1).trim() : "";
      return { key, value, known: true };
    });
}

export function createFakeDesktopState(): FakeDesktopState {
  return {
    calls: [],
    processStatus: "running",
    preferences: {
      closeBehavior: "minimize",
      launchAtLogin: false,
      defaultServerDir: "C:\\Servers",
      defaultBackupDir: "C:\\Backups",
      cacheDir: "C:\\AppData\\MCServerManager\\cache",
      appDataDir: "C:\\AppData\\MCServerManager",
      logging: { retentionDays: 14, maxSizeMb: 25, level: "info" },
      serverDefaults: {
        javaStrategy: "auto",
        minMemoryMb: 2048,
        maxMemoryMb: 6144,
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
        motion: "off",
        fontSize: "medium",
      },
      providers: {
        modrinth: true,
        hangar: true,
        bbsmc: true,
        curseforge: true,
      },
    },
    files: {
      "server.properties": "motd=Fabric Workshop\nserver-port=25565\n",
      "eula.txt": "eula=true\n",
    },
    backups: [
      {
        id: "backup-1",
        serverId: "server-1",
        kind: "world",
        archivePath: "C:\\Backups\\world.zip",
        worldName: "world",
        sizeBytes: 4_194_304,
        status: "completed",
        createdAt: now,
        error: null,
      },
    ],
    scheduledTasks: [
      {
        id: "task-1",
        serverId: "server-1",
        name: "Nightly backup",
        kind: "world_backup",
        intervalMinutes: 1440,
        command: null,
        enabled: 1,
        nextRunAt: now,
        lastRunAt: null,
      },
    ],
    playerLists: {
      ops: [
        {
          name: "Alex",
          uuid: "uuid-alex",
          level: 4,
          bypassesPlayerLimit: true,
        },
      ],
      whitelist: [{ name: "Alex", uuid: "uuid-alex" }],
      bannedPlayers: [],
      bannedIps: [],
    },
  };
}

const server = {
  id: "server-1",
  name: "Fabric Workshop",
  rootDir: "C:\\Servers\\fabric-workshop",
  minecraftVersion: "1.21.1",
  loaderType: "fabric",
  loaderVersion: "0.16.10",
  javaPath: "C:\\Java\\bin\\java.exe",
  serverPort: 25565,
  minMemoryMb: 2048,
  maxMemoryMb: 6144,
  autoStart: true,
  createdAt: now,
  updatedAt: now,
  restartPolicy: {
    enabled: true,
    maxAttempts: 3,
    cooldownSeconds: 30,
  },
};

const marketplaceProjects = Array.from({ length: 8 }, (_, index) => ({
  id: `project-${index + 1}`,
  slug: `project-${index + 1}`,
  title: [
    "Fabric Essentials",
    "Create Workshop",
    "Performance Plus",
    "Adventure Realm",
    "Vanilla Enhanced",
    "Builders Toolkit",
    "Skyblock Server",
    "Community Core",
  ][index],
  description:
    "A production-ready Minecraft server pack with curated mods, configuration, and server-side optimizations.",
  projectType: "modpack",
  loaders: ["fabric"],
  gameVersions: ["1.21.1"],
  downloads: 125_000 - index * 9_000,
  followers: 4_200 - index * 200,
  iconUrl: null,
  source: "modrinth",
}));

function argsInput(args: Record<string, any> | undefined) {
  return args?.input ?? args ?? {};
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export async function handleFakeDesktopCommand(
  state: FakeDesktopState,
  command: string,
  args?: Record<string, any>,
): Promise<any> {
  state.calls.push({ command, args: clone(args) });
  const input = argsInput(args);

  switch (command) {
    case "write_app_log":
    case "request_app_quit":
    case "open_app_data_folder":
    case "open_app_logs_folder":
    case "open_server_folder":
    case "clear_app_cache":
    case "export_app_settings":
    case "export_diagnostic_package":
    case "send_server_command":
    case "restore_world_backup":
    case "unbind_tunnel_from_server":
    case "bind_tunnel_to_server":
    case "open_tunnel_application":
      return null;
    case "list_recoverable_provisioning_jobs":
      return [];
    case "list_server_profiles":
      return [clone(server)];
    case "get_process_summary":
      return {
        runningCount: state.processStatus === "running" ? 1 : 0,
        crashedCount: state.processStatus === "crashed" ? 1 : 0,
        statuses: { "server-1": state.processStatus },
        lastBackups: { "server-1": state.backups[0]?.createdAt ?? null },
      };
    case "get_attention_items":
      return [];
    case "get_server_process_status":
      return {
        id: "process-1",
        serverId: "server-1",
        pid: state.processStatus === "running" ? 4200 : null,
        command: "java -Xmx6144M -jar server.jar nogui",
        status: state.processStatus,
        startedAt: now,
        exitedAt: state.processStatus === "running" ? null : now,
        exitCode: state.processStatus === "crashed" ? 1 : null,
      };
    case "start_server":
    case "restart_server":
      state.processStatus = "running";
      return handleFakeDesktopCommand(state, "get_server_process_status", args);
    case "stop_server":
      state.processStatus = "stopped";
      return null;
    case "restart_server_with_countdown":
      return {
        serverId: "server-1",
        stepsSeconds: [60, 30, 10],
        scheduledFor: now,
      };
    case "list_process_events":
      return [
        {
          id: "event-1",
          serverId: "server-1",
          level: "info",
          message: "Server process started.",
          createdAt: now,
        },
        {
          id: "event-2",
          serverId: "server-1",
          level: "warning",
          message: "Stop requested.",
          createdAt: "2026-07-23T14:58:00.000Z",
        },
      ];
    case "get_performance_history":
      return {
        serverId: "server-1",
        samples: [
          {
            id: "metric-1",
            cpuPercent: 18.4,
            memoryMb: 2560,
            diskFreeMb: 102400,
            uptimeSeconds: 3600,
            restartCount: 0,
            playerCount: 2,
            tps: 19.9,
            unavailableReasons: {},
            unavailableReason: null,
            sampledAt: now,
          },
        ],
        events: [],
      };
    case "sample_server_metrics":
      return {
        id: "metric-2",
        cpuPercent: 19.1,
        memoryMb: 2600,
        diskFreeMb: 102390,
        uptimeSeconds: 3660,
        restartCount: 0,
        playerCount: 2,
        tps: 19.8,
        unavailableReasons: {},
        unavailableReason: null,
        sampledAt: now,
      };
    case "list_players":
      return {
        serverId: "server-1",
        actionsAvailable: true,
        unavailableReason: null,
        whitelistEnabled: false,
        players: [
          {
            username: "Alex",
            uuid: "uuid-alex",
            online: true,
            operator: true,
            whitelisted: true,
            banned: false,
            firstSeen: now,
            lastSeen: now,
          },
          {
            username: "Steve",
            uuid: "uuid-steve",
            online: true,
            operator: false,
            whitelisted: true,
            banned: false,
            firstSeen: now,
            lastSeen: now,
          },
        ],
      };
    case "apply_player_change":
      return { commandSent: `${input.action} ${input.player}` };
    case "read_player_lists":
      return {
        serverId: "server-1",
        lists: [
          {
            listType: "ops",
            fileName: "ops.json",
            entries: clone(state.playerLists.ops),
          },
          {
            listType: "whitelist",
            fileName: "whitelist.json",
            entries: clone(state.playerLists.whitelist),
          },
          {
            listType: "bannedPlayers",
            fileName: "banned-players.json",
            entries: clone(state.playerLists.bannedPlayers),
          },
          {
            listType: "bannedIps",
            fileName: "banned-ips.json",
            entries: clone(state.playerLists.bannedIps),
          },
        ],
      };
    case "save_player_list":
      state.playerLists[input.listType] = clone(input.entries);
      return {
        listType: input.listType,
        fileName: `${input.listType}.json`,
        entries: clone(input.entries),
      };
    case "list_server_files": {
      const relativePath = args?.relativePath ?? "";
      if (relativePath === "world") {
        return [
          {
            name: "level.dat",
            relativePath: "world/level.dat",
            kind: "file",
            sizeBytes: 2048,
            modifiedAt: now,
            editable: false,
          },
        ];
      }
      return [
        {
          name: "world",
          relativePath: "world",
          kind: "directory",
          sizeBytes: 0,
          modifiedAt: now,
          editable: false,
        },
        {
          name: "mods",
          relativePath: "mods",
          kind: "directory",
          sizeBytes: 0,
          modifiedAt: now,
          editable: false,
        },
        ...Object.keys(state.files).map((relativePath) => ({
          name: relativePath,
          relativePath,
          kind: "file",
          sizeBytes: state.files[relativePath].length,
          modifiedAt: now,
          editable: true,
        })),
      ];
    }
    case "read_server_text_file": {
      const content = state.files[args?.relativePath] ?? "";
      return {
        relativePath: args?.relativePath,
        content,
        sizeBytes: content.length,
        readOnly: false,
        warning: null,
      };
    }
    case "write_server_text_file":
      state.files[args?.relativePath] = args?.content ?? "";
      return {
        relativePath: args?.relativePath,
        content: state.files[args?.relativePath],
        sizeBytes: state.files[args?.relativePath].length,
        readOnly: false,
        warning: null,
      };
    case "read_server_properties":
      {
        const raw = state.files["server.properties"] ?? "";
        return {
          serverId: "server-1",
          path: "server.properties",
          entries: parseServerProperties(raw),
          raw,
          warnings: [],
        };
      }
    case "save_server_properties": {
      const currentEntries = parseServerProperties(
        state.files["server.properties"] ?? "",
      );
      const updates = (input.updates ?? []) as Array<{
        key: string;
        value: string;
        known?: boolean;
      }>;
      const nextValues = new Map(
        currentEntries.map((entry) => [entry.key, entry.value]),
      );
      for (const update of updates) {
        nextValues.set(update.key, update.value);
      }
      const raw = `${[...nextValues]
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")}\n`;
      state.files["server.properties"] = raw;
      return {
        serverId: "server-1",
        path: "server.properties",
        entries: parseServerProperties(raw),
        raw,
        warnings: [],
        restartRequired: updates.length > 0,
      };
    }
    case "list_installed_content":
      return [
        {
          id: "content-1",
          serverId: "server-1",
          contentId: "fabric-api",
          name: "Fabric API",
          version: "0.100.1",
          loader: "fabric",
          environment: "server",
          sourcePath: "C:\\Downloads\\fabric-api.jar",
          installedPath: "C:\\Servers\\fabric-workshop\\mods\\fabric-api.jar",
          sha256: "abc123",
          warnings: [],
          installedAt: now,
        },
      ];
    case "disable_installed_content":
    case "enable_installed_content":
    case "import_local_content":
      return {
        id: input.contentId ?? "content-imported",
        serverId: "server-1",
        contentId: input.contentId ?? "local-content",
        name: "Fabric API",
        version: "0.100.1",
        loader: "fabric",
        environment: "server",
        sourcePath: input.sourcePath ?? "C:\\Downloads\\fabric-api.jar",
        installedPath: "C:\\Servers\\fabric-workshop\\mods\\fabric-api.jar",
        sha256: "abc123",
        warnings: [],
        installedAt: now,
      };
    case "uninstall_installed_content":
      return null;
    case "get_content_update_policy":
    case "save_content_update_policy":
      return {
        id: "policy-1",
        serverId: "server-1",
        contentId: input.contentId ?? args?.contentId ?? null,
        policy: input.policy ?? "notify_only",
        pinnedVersion: input.pinnedVersion ?? null,
        ignoredUpdate: input.ignoredUpdate ?? null,
        updatedAt: now,
      };
    case "plan_content_updates":
      return {
        serverId: "server-1",
        policy: "notify_only",
        plannedUpdates: [],
        warnings: [],
        requiresConfirmation: false,
      };
    case "check_content_updates":
      return {
        serverId: "server-1",
        checkedAt: now,
        updates: [],
        warnings: [],
      };
    case "install_content_update":
      return { content: await handleFakeDesktopCommand(state, "enable_installed_content", args) };
    case "install_all_content_updates":
      return { serverId: "server-1", installed: [], warnings: [] };
    case "search_modrinth_projects":
    case "search_curseforge_projects":
      return clone(marketplaceProjects);
    case "search_hangar_projects":
    case "search_bbsmc_projects":
      return [];
    case "get_modrinth_project":
    case "get_curseforge_project":
    case "get_bbsmc_project": {
      const project =
        marketplaceProjects.find(
          (item) =>
            item.id === args?.projectId ||
            item.id === input.projectId ||
            item.slug === args?.slug,
        ) ?? marketplaceProjects[0];
      return {
        ...clone(project),
        body: "A complete server pack designed for stable multiplayer operation.",
      };
    }
    case "list_modrinth_versions":
    case "list_curseforge_files":
    case "list_bbsmc_versions":
      return [
        {
          id: "version-1",
          projectId: marketplaceProjects[0].id,
          versionNumber: "1.4.0",
          name: "1.4.0",
          gameVersions: ["1.21.1"],
          loaders: ["fabric"],
          releaseType: "release",
          files: [
            {
              filename: "server-pack.mrpack",
              size: 2_048,
              primary: true,
              url: "https://example.invalid/server-pack.mrpack",
            },
          ],
          dependencies: [],
          warnings: [],
          isServerPack: true,
          serverPackFileId: null,
          serverCompatibility: "serverPack",
        },
      ];
    case "list_hangar_versions":
      return [];
    case "install_modrinth_version":
    case "install_curseforge_file":
    case "install_bbsmc_public_file":
    case "install_hangar_version":
      return handleFakeDesktopCommand(state, "import_local_content", args);
    case "list_server_backups":
      return clone(state.backups);
    case "create_world_backup": {
      const backup = {
        id: `backup-${state.backups.length + 1}`,
        serverId: "server-1",
        kind: "world",
        archivePath: `C:\\Backups\\world-${state.backups.length + 1}.zip`,
        worldName: "world",
        sizeBytes: 4_194_304,
        status: "completed",
        createdAt: now,
        error: null,
      };
      state.backups.unshift(backup);
      return clone(backup);
    }
    case "delete_server_backup":
      state.backups = state.backups.filter(
        (backup) => backup.id !== args?.backupId,
      );
      return null;
    case "export_server_backup":
      return { exportedPath: "C:\\Exports\\world.zip" };
    case "list_backup_profiles":
      return [];
    case "create_backup_profile":
    case "update_backup_profile":
      return {
        id: input.id ?? "backup-profile-1",
        serverId: "server-1",
        name: input.name ?? "Full backup",
        mode: input.mode ?? "worldOnly",
        includePaths: input.includePaths ?? [],
        excludePaths: input.excludePaths ?? [],
        retentionCount: input.retentionCount ?? 7,
        createdAt: now,
        updatedAt: now,
      };
    case "create_profile_backup":
      return clone(state.backups[0]);
    case "delete_backup_profile":
      return null;
    case "list_server_logs":
      return {
        serverId: "server-1",
        logs: [
          {
            fileName: "latest.log",
            relativePath: "logs/latest.log",
            sizeBytes: 128,
            modifiedAt: now,
            current: true,
            compressed: false,
          },
        ],
      };
    case "read_server_log":
      return {
        relativePath: args?.relativePath,
        content: "[Server thread/INFO]: Done (1.234s)! For help, type \"help\"",
        sizeBytes: 58,
        modifiedAt: now,
        compressed: false,
      };
    case "list_scheduled_tasks":
      return clone(state.scheduledTasks);
    case "list_scheduled_task_runs":
      return [];
    case "create_scheduled_task": {
      const task = {
        ...clone(input),
        id: `task-${state.scheduledTasks.length + 1}`,
        serverId: "server-1",
        createdAt: now,
        updatedAt: now,
      };
      state.scheduledTasks.push(task);
      return clone(task);
    }
    case "update_scheduled_task":
      return { ...clone(input), updatedAt: now };
    case "delete_scheduled_task":
      state.scheduledTasks = state.scheduledTasks.filter(
        (task) => task.id !== args?.taskId,
      );
      return null;
    case "get_server_setup_status":
      return {
        serverId: "server-1",
        serverName: server.name,
        checks: [
          { id: "java", status: "ready", message: "Java is configured." },
          {
            id: "serverRuntime",
            status: "ready",
            message: "Server runtime is ready.",
          },
          { id: "eula", status: "ready", message: "EULA accepted." },
          {
            id: "backup",
            status: "warning",
            message: "Create a recent backup.",
          },
        ],
      };
    case "update_server_profile":
    case "create_server_profile":
      return { ...clone(server), ...clone(input), updatedAt: now };
    case "delete_server_profile":
      return null;
    case "list_tunnel_providers":
    case "list_tunnel_statuses":
    case "list_tunnel_bindings":
      return [];
    case "create_tunnel_provider":
    case "update_tunnel_provider":
      return {
        id: input.id ?? "tunnel-1",
        name: input.name ?? "Custom tunnel",
        type: input.type ?? "custom",
        command: input.command ?? "ngrok tcp 25565",
        createdAt: now,
        updatedAt: now,
      };
    case "delete_tunnel_provider":
      return null;
    case "list_server_update_history":
      return [];
    case "check_server_update":
      return {
        serverId: "server-1",
        loaderType: "fabric",
        currentVersion: "1.21.1",
        currentLoaderVersion: "0.16.10",
        latestVersion: "1.21.1",
        latestLoaderVersion: "0.16.10",
        updateAvailable: false,
        installSupported: false,
        message: "No update available.",
      };
    case "install_server_update":
      return {
        id: "update-1",
        serverId: "server-1",
        loaderType: "fabric",
        fromVersion: "1.21.1",
        toVersion: input.targetVersion ?? "1.21.1",
        status: "installed",
        message: "Installed.",
        rollbackPath: null,
        createdAt: now,
      };
    case "list_diagnostic_runs":
      return [];
    case "run_server_diagnostics":
      return {
        id: "diagnostic-1",
        serverId: "server-1",
        status: "passed",
        summary: "All checks passed.",
        checks: [],
        createdAt: now,
      };
    case "export_server_profile":
      return { path: "C:\\Exports\\fabric-workshop.json" };
    case "preview_profile_import":
      return {
        name: input.name ?? "Imported Server",
        rootDir: input.rootDir ?? "C:\\Servers\\imported",
        minecraftVersion: "1.21.1",
        loaderType: "fabric",
        warnings: [],
      };
    case "import_profile":
      return { ...clone(server), id: "server-imported", name: input.name };
    case "list_java_runtimes":
      return {
        runtimes: [
          {
            id: "java-21",
            path: "C:\\Java\\bin\\java.exe",
            version: "21",
            majorVersion: 21,
            vendor: "Eclipse Temurin",
            architecture: "x64",
            source: "managed",
            managed: true,
          },
        ],
        failures: [],
        compatibility: [
          {
            serverId: "server-1",
            serverName: server.name,
            status: "compatible",
            requiredMajorVersion: 21,
            configuredMajorVersion: 21,
            message: "Compatible",
          },
        ],
      };
    case "plan_java_runtime":
      return {
        majorVersion: input.majorVersion ?? 21,
        vendor: "Eclipse Temurin",
        architecture: "x64",
        downloadUrl: "https://example.test/temurin.zip",
      };
    case "install_java_runtime":
      return {
        path: "C:\\AppData\\MCServerManager\\java\\21\\bin\\java.exe",
        version: "21",
        majorVersion: 21,
        vendor: "Eclipse Temurin",
        architecture: "x64",
        source: "managed",
        managed: true,
      };
    case "list_app_logs":
      return [
        {
          id: "app-log-1",
          level: "info",
          source: "renderer",
          message: "Application started",
          detail: "Renderer initialized successfully.",
          createdAt: now,
        },
      ];
    case "clear_app_logs":
      return { cleared: true };
    case "get_app_preferences":
      return clone(state.preferences);
    case "save_app_preferences":
      state.preferences = {
        ...state.preferences,
        ...clone(input),
        logging: { ...state.preferences.logging, ...clone(input.logging ?? {}) },
        serverDefaults: {
          ...state.preferences.serverDefaults,
          ...clone(input.serverDefaults ?? {}),
        },
        backupDefaults: {
          ...state.preferences.backupDefaults,
          ...clone(input.backupDefaults ?? {}),
        },
        marketplace: {
          ...state.preferences.marketplace,
          ...clone(input.marketplace ?? {}),
        },
        appearance: {
          ...state.preferences.appearance,
          ...clone(input.appearance ?? {}),
        },
        providers: {
          ...state.preferences.providers,
          ...clone(input.providers ?? {}),
        },
      };
      return clone(state.preferences);
    case "reset_app_preferences":
    case "import_app_settings":
      state.preferences = createFakeDesktopState().preferences;
      return clone(state.preferences);
    case "show_open_dialog":
      return {
        path:
          args?.kind === "folder"
            ? "C:\\Servers\\Selected"
            : "C:\\Imports\\selected.json",
      };
    case "show_save_dialog":
      return { path: "C:\\Exports\\selected.json" };
    case "get_notification_preferences":
      return {
        desktopEnabled: true,
        crashEnabled: true,
        restartFailedEnabled: true,
        backupFailedEnabled: true,
        taskFailedEnabled: true,
        updateAvailableEnabled: true,
        tunnelStoppedEnabled: true,
        informationalEnabled: false,
      };
    case "save_notification_preferences":
      return clone(args?.preferences);
    case "list_notification_events":
      return [
        {
          id: "notification-1",
          kind: "server_started",
          severity: "info",
          title: "Server started",
          message: "Fabric Workshop is running.",
          desktopDelivered: 0,
          createdAt: now,
        },
      ];
    case "check_app_update":
      return {
        currentVersion: "0.1.0",
        channel: "stable",
        checkedAt: now,
        updateAvailable: false,
        installerEnabled: false,
        installBlockedByRunningServers: false,
        message: "You are up to date.",
      };
    case "install_app_update":
      return { installed: false };
    case "list_loader_minecraft_versions":
      return [{ id: "1.21.1", name: "1.21.1", stable: true }];
    case "list_loader_versions":
      return [{ id: "0.16.10", name: "0.16.10", stable: true }];
    case "get_default_server_root":
      return { path: "C:\\Servers" };
    case "detect_server_version":
      return {
        sourceType: "folder",
        minecraftVersion: "1.21.1",
        loaderType: "fabric",
        loaderVersion: "0.16.10",
        serverJarPath: "server.jar",
        warnings: [],
      };
    default:
      throw new Error(`Unhandled fake desktop command: ${command}`);
  }
}
