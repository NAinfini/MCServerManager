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
}

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
  targetWorldDir: string;
  confirm: boolean;
}

export interface ExportBackupInput {
  backupId: string;
  targetDir: string;
}

export function listServerBackups(serverId: string) {
  return invokeDesktopCommandWithErrorHandling<BackupRecord[]>(
    "list_server_backups",
    { serverId },
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
