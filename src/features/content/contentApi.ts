import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";

export interface InstalledContent {
  id: string;
  serverId: string;
  contentId?: string | null;
  provider?: string | null;
  projectId?: string | null;
  versionId?: string | null;
  /* What the jar calls itself, read from its own descriptor (mcmod.info,
     mods.toml, fabric.mod.json, plugin.yml). Distinct from contentId, which
     records the marketplace it was downloaded from and is null for a file
     dropped into the folder by hand. */
  modId?: string | null;
  name: string;
  version?: string | null;
  loader: string;
  environment?: string | null;
  sourcePath: string;
  installedPath: string;
  sha256: string;
  warnings: string[];
  installedAt: string;
}

export type ContentUpdatePolicyMode =
  | "manual_only"
  | "notify_only"
  | "batch_confirm"
  | "pin_current"
  | "ignore_update";

export interface ContentUpdatePolicy {
  id: string;
  serverId: string;
  contentId?: string | null;
  policy: ContentUpdatePolicyMode;
  pinnedVersion?: string | null;
  ignoredUpdate?: string | null;
  updatedAt: string;
}

export interface InstalledContentUpdate {
  installedContentId: string;
  provider: string;
  projectId: string;
  versionId: string;
  name: string;
  currentVersion?: string | null;
  latestVersion: string;
  warnings: string[];
}

export interface InstalledContentUpdateCheck {
  serverId: string;
  checkedAt: string;
  updates: InstalledContentUpdate[];
  warnings: string[];
}

export interface InstalledContentUpdateResult {
  content: InstalledContent;
  backupPath?: string | null;
}

export interface ContentUpdateHistoryEntry {
  id: string;
  serverId: string;
  installedContentId: string;
  name: string;
  fromVersion?: string | null;
  toVersion: string;
  status: "installed" | "rolled_back";
  backupPath: string;
  createdAt: string;
  rollbackAvailable: boolean;
}

export function listInstalledContent(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<InstalledContent[]>(
    "list_installed_content",
    {
      serverId,
    },
  );
}

export function importLocalContent(serverId: string, sourcePath: string) {
  return invokeDesktopCommandWithErrorHandling<InstalledContent>(
    "import_local_content",
    {
      input: { serverId, sourcePath },
    },
  );
}

export function disableInstalledContent(serverId: string, contentId: string) {
  return invokeDesktopCommandWithErrorHandling<InstalledContent>(
    "disable_installed_content",
    {
      input: { serverId, contentId },
    },
  );
}

export function enableInstalledContent(serverId: string, contentId: string) {
  return invokeDesktopCommandWithErrorHandling<InstalledContent>(
    "enable_installed_content",
    {
      input: { serverId, contentId },
    },
  );
}

export function uninstallInstalledContent(serverId: string, contentId: string) {
  return invokeDesktopCommandWithErrorHandling<void>(
    "uninstall_installed_content",
    {
      input: { serverId, contentId },
    },
  );
}

export function getContentUpdatePolicy(
  serverId: string,
  contentId?: string | null,
) {
  return invokeDesktopCommandWithErrorHandling<ContentUpdatePolicy>(
    "get_content_update_policy",
    {
      serverId,
      contentId: contentId ?? null,
    },
  );
}

export function saveContentUpdatePolicy(
  serverId: string,
  policy: ContentUpdatePolicyMode,
  options: {
    contentId?: string | null;
    pinnedVersion?: string | null;
    ignoredUpdate?: string | null;
  } = {},
) {
  return invokeDesktopCommandWithErrorHandling<ContentUpdatePolicy>(
    "save_content_update_policy",
    {
      input: {
        serverId,
        contentId: options.contentId ?? null,
        policy,
        pinnedVersion: options.pinnedVersion ?? null,
        ignoredUpdate: options.ignoredUpdate ?? null,
      },
    },
  );
}

export function checkContentUpdates(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<InstalledContentUpdateCheck>(
    "check_content_updates",
    {
      input: { serverId },
    },
  );
}

export function installContentUpdate(
  serverId: string,
  installedContentId: string,
) {
  return invokeDesktopCommandWithErrorHandling<InstalledContentUpdateResult>(
    "install_content_update",
    {
      input: { serverId, installedContentId },
    },
  );
}

export function installAllContentUpdates(
  serverId: string,
  installedContentIds?: string[],
) {
  return invokeDesktopCommandWithErrorHandling<{
    serverId: string;
    installed: InstalledContentUpdateResult[];
    warnings: string[];
  }>("install_all_content_updates", {
    input: { serverId, installedContentIds },
  });
}

export function listContentUpdateHistory(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<ContentUpdateHistoryEntry[]>(
    "list_content_update_history",
    { serverId },
  );
}

export function rollbackContentUpdate(serverId: string, historyId: string) {
  return invokeDesktopCommandWithErrorHandling<InstalledContentUpdateResult>(
    "rollback_content_update",
    { input: { serverId, historyId, confirm: true } },
  );
}
