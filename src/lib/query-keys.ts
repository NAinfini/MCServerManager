export const queryKeys = {
  servers: {
    profiles: ["serverProfiles"] as const,
    setupStatus: (serverId: string) =>
      ["serverSetupStatus", serverId] as const,
  },
  process: {
    summary: ["processSummary"] as const,
    status: (serverId: string) =>
      ["serverProcessStatus", serverId] as const,
    events: (serverId: string) => ["processEvents", serverId] as const,
  },
  backups: {
    all: ["backups"] as const,
    list: (serverId: string) => ["backups", serverId] as const,
    profiles: (serverId: string) => ["backupProfiles", serverId] as const,
  },
  players: {
    all: ["players"] as const,
    list: (serverId: string) => ["players", serverId] as const,
  },
  content: {
    installed: (serverId: string) =>
      ["installedContent", serverId] as const,
    updatePolicy: (serverId: string, contentId: string | null = null) =>
      ["contentUpdatePolicy", serverId, contentId] as const,
  },
  marketplace: {
    modrinthSearch: (
      serverId: string,
      contentType: string,
      query: string,
      loader: string,
      sort: string,
    ) =>
      ["modrinthSearch", serverId, contentType, query, loader, sort] as const,
    bbsmcSearch: (
      contentType: string,
      query: string,
      loader: string,
      sort: string,
    ) => ["bbsmcSearch", contentType, query, loader, sort] as const,
    hangarSearch: (contentType: string, query: string) =>
      ["hangarSearch", contentType, query] as const,
    project: (provider: string, projectId?: string | null) =>
      ["marketplaceProject", provider, projectId] as const,
    versions: (
      provider: string,
      serverId: string,
      projectId?: string | null,
    ) => ["marketplaceVersions", provider, serverId, projectId] as const,
    createSearch: (
      provider: string,
      query: string,
      loader: string,
      sort: string,
    ) => ["createMarketplaceSearch", provider, query, loader, sort] as const,
    createProject: (provider: string, projectId?: string | null) =>
      ["createMarketplaceProjectDetails", provider, projectId] as const,
    createVersions: (provider: string, projectId?: string | null) =>
      ["createMarketplaceVersions", provider, projectId] as const,
  },
  performance: {
    history: (serverId: string) =>
      ["servers", serverId, "performance"] as const,
  },
  attention: {
    all: ["attention"] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    events: ["notifications", "events"] as const,
    preferences: ["notifications", "preferences"] as const,
  },
  settings: {
    preferences: ["appPreferences"] as const,
  },
  tunnels: {
    providers: ["tunnelProviders"] as const,
    statuses: ["tunnelStatuses"] as const,
    bindings: ["tunnelBindings"] as const,
    localAddresses: ["localNetworkAddresses"] as const,
  },
  provisioning: {
    recoverable: ["provisioning", "recoverable"] as const,
  },
  java: {
    runtimes: ["java", "runtimes"] as const,
  },
  logs: {
    app: (level: string) => ["logs", "app", level] as const,
    appAll: ["logs", "app"] as const,
    server: (serverId: string) => ["logs", "server", serverId] as const,
    content: (serverId: string, path: string | null) =>
      ["logs", "server", serverId, "content", path] as const,
  },
  diagnostics: {
    runs: (serverId: string) => ["diagnostics", serverId, "runs"] as const,
  },
  files: {
    directory: (serverId: string, path: string) =>
      ["files", serverId, "directory", path] as const,
    content: (serverId: string, path: string | null) =>
      ["files", serverId, "content", path] as const,
  },
  properties: {
    server: (serverId: string) => ["properties", serverId] as const,
  },
  tasks: {
    definitions: (serverId: string) => ["tasks", serverId, "definitions"] as const,
    runs: (serverId: string) => ["tasks", serverId, "runs"] as const,
  },
  updates: {
    server: (serverId: string) => ["updates", "server", serverId] as const,
    app: ["updates", "app"] as const,
  },
} as const;
