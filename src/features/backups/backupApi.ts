import { invokeDesktopCommandWithErrorHandling } from "../../lib/desktop-command-error";

export interface BackupRecord {
  id: string;
  serverId: string;
  profileId?: string | null;
  kind: "world" | string;
  archivePath: string;
  worldName: string;
  sizeBytes: number;
  status: "completed" | "failed";
  createdAt: string;
  error?: string | null;
  /* Rows written before incremental snapshots (including old zip-shaped
     rows) have none of these; they are full copies. */
  trigger?: "manual" | "scheduled" | "pre_restart" | "pre_update";
  format?: "full" | "incremental";
  logicalBytes?: number;
  newBytes?: number;
}

export interface BackupSettings {
  serverId: string;
  configured: boolean;
  enabled: boolean;
  intervalMinutes: number;
  beforeRestart: boolean;
  beforeUpdate: boolean;
  keepRecent: number;
  keepDaily: number;
  keepWeekly: number;
  /* Null: up to five times the world's size. */
  maxTotalMb: number | null;
  location: string | null;
  nextRunAt: string | null;
  lastSuccessAt: string | null;
}

export interface BackupStatus {
  serverId: string;
  settings: BackupSettings;
  restorePointCount: number;
  lastBackupAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  usedBytes: number;
  freeBytes: number | null;
  location: string;
}

export type SaveBackupSettingsInput = Omit<
  BackupSettings,
  "configured" | "nextRunAt" | "lastSuccessAt"
>;

export interface CreateWorldBackupInput {
  serverId: string;
}

export type BackupProfileMode =
  "worldOnly" | "worldPlusConfigs" | "fullServer" | "custom";

export interface BackupProfile {
  id: string;
  serverId: string;
  name: string;
  mode: BackupProfileMode;
  includePaths: string[];
  excludePaths: string[];
  retentionCount?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBackupProfileInput {
  serverId: string;
  name: string;
  mode: BackupProfileMode;
  includePaths: string[];
  excludePaths: string[];
  retentionCount?: number | null;
  confirmFullServer: boolean;
}

export interface UpdateBackupProfileInput extends CreateBackupProfileInput {
  id: string;
}

export interface CreateProfileBackupInput {
  profileId: string;
}

export interface RestoreBackupInput {
  backupId: string;
  targetWorldDir?: string;
  confirm: boolean;
}

export interface BackupRestorePreview {
  backupId: string;
  serverId: string;
  mode: "worldOnly" | "worldPlusConfigs" | "fullServer" | "custom";
  relativePaths: string[];
  fileCount: number;
  sizeBytes: number;
  warnings: string[];
}

export interface PreviewBackupRestoreInput {
  serverId: string;
  backupId: string;
  targetWorldDir?: string;
}

export interface ExportBackupInput {
  backupId: string;
  targetDir: string;
  format?: "zip" | "folder";
}

export function listServerBackups(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<BackupRecord[]>(
    "list_server_backups",
    { serverId },
  );
}

export function getBackupStatus(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<BackupStatus>(
    "get_backup_status",
    { serverId },
  );
}

export function saveBackupSettings(input: SaveBackupSettingsInput) {
  return invokeDesktopCommandWithErrorHandling<BackupSettings>(
    "save_backup_settings",
    { input },
  );
}

export function createWorldBackup(input: CreateWorldBackupInput) {
  return invokeDesktopCommandWithErrorHandling<BackupRecord>(
    "create_world_backup",
    { input },
  );
}

export function deleteServerBackup(backupId: string) {
  return invokeDesktopCommandWithErrorHandling<void>("delete_server_backup", {
    backupId,
  });
}

export function exportServerBackup(input: ExportBackupInput) {
  return invokeDesktopCommandWithErrorHandling<{ exportedPath: string }>(
    "export_server_backup",
    { input },
  );
}

export function listBackupProfiles(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<BackupProfile[]>(
    "list_backup_profiles",
    { serverId },
  );
}

export function createBackupProfile(input: CreateBackupProfileInput) {
  return invokeDesktopCommandWithErrorHandling<BackupProfile>(
    "create_backup_profile",
    { input },
  );
}

export function updateBackupProfile(input: UpdateBackupProfileInput) {
  return invokeDesktopCommandWithErrorHandling<BackupProfile>(
    "update_backup_profile",
    { input },
  );
}

export function deleteBackupProfile(profileId: string) {
  return invokeDesktopCommandWithErrorHandling<void>("delete_backup_profile", {
    profileId,
  });
}

export function createProfileBackup(input: CreateProfileBackupInput) {
  return invokeDesktopCommandWithErrorHandling<BackupRecord>(
    "create_profile_backup",
    { input },
  );
}

export function restoreWorldBackup(input: RestoreBackupInput) {
  return invokeDesktopCommandWithErrorHandling<void>("restore_world_backup", {
    input,
  });
}

export function previewBackupRestore(input: PreviewBackupRestoreInput) {
  return invokeDesktopCommandWithErrorHandling<BackupRestorePreview>(
    "preview_backup_restore",
    { input },
  );
}
